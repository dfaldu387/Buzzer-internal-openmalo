import AsyncStorage from '@react-native-async-storage/async-storage';
import {Platform} from 'react-native';
import {User} from '../types';
import {getUserByPhone, addUser, removeUser, removeInactiveByPhone, updateFcmToken, updateUserProfile, resetUserPin, updateOwnPin} from './firebase';
import {hashPin, verifyPin} from './crypto';
import {clearUserCache} from '../hooks/useUsers';
import {clearReasonCache} from '../hooks/useReasons';
import {clearGroupCache} from '../hooks/useGroups';

const AUTH_KEY = '@openmalo_user';

const storeUser = async (user: User) => {
  const {pin_hash: _, ...safeUser} = user;
  await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(safeUser));
};

export const login = async (phone: string, pin: string): Promise<User | null> => {
  const user = await getUserByPhone(phone);
  if (!user) throw new Error('No account found with this phone number');
  if (!verifyPin(pin, user.pin_hash)) throw new Error('Incorrect PIN');

  // Migrate legacy DJB2 hash to SHA-256
  if (!user.pin_hash.startsWith('v2:')) {
    try {
      await updateOwnPin(user.id, pin, pin);
    } catch {
      // Fallback if Edge Function not deployed yet
      try { await resetUserPin(user.id, hashPin(pin)); } catch {}
    }
  }

  await storeUser(user);

  // FCM token update — don't block login
  setTimeout(async () => {
    try {
      const {getMessaging, getToken, requestPermission} = require('@react-native-firebase/messaging');
      const messaging = getMessaging();
      await requestPermission(messaging);
      const token = await getToken(messaging);
      if (token) await updateFcmToken(user.id, token, Platform.OS);
    } catch (err) {
      console.warn('FCM token update after login failed:', err);
    }
  }, 2000);

  return user;
};

export const signup = async (
  name: string,
  phone: string,
  pin: string,
  role: 'manager' | 'member' = 'member',
): Promise<User> => {
  const existing = await getUserByPhone(phone);
  if (existing) throw new Error('Phone number already registered');

  // Remove any inactive user with same phone (soft-deleted accounts)
  await removeInactiveByPhone(phone);

  // Signup inserts via anon key — the DB trigger allows INSERT and member role.
  // NOTE: Only 'member' role works here. Admin user creation goes through
  // the admin-action Edge Function (adminAddUser).
  const {hashPin} = require('./crypto');
  const userData: Omit<User, 'id'> = {
    name: name.trim(),
    phone,
    pin_hash: hashPin(pin),
    role,
    last_seen_at: Date.now(),
    is_active: true,
  };

  const docRef = await addUser(userData);
  const user: User = {id: docRef.id, ...userData};
  await storeUser(user);

  setTimeout(async () => {
    try {
      const {getMessaging, getToken, requestPermission} = require('@react-native-firebase/messaging');
      const messaging = getMessaging();
      await requestPermission(messaging);
      const token = await getToken(messaging);
      if (token) await updateFcmToken(user.id, token, Platform.OS);
    } catch (err) {
      console.warn('FCM token update after signup failed:', err);
    }
  }, 2000);

  return user;
};

export const deleteAccount = async (userId: string): Promise<void> => {
  await removeUser(userId);
  await AsyncStorage.removeItem(AUTH_KEY);
};

export const getStoredUser = async (): Promise<User | null> => {
  const data = await AsyncStorage.getItem(AUTH_KEY);
  if (!data) return null;
  const parsed = JSON.parse(data);
  // pin_hash is intentionally stripped during storage for security.
  // Set a sentinel value so code doesn't accidentally use it for verification.
  return {...parsed, pin_hash: '__stored_locally__'};
};

export const logout = async () => {
  // Clear FCM token from server so logged-out user doesn't receive ghost pushes
  try {
    const data = await AsyncStorage.getItem(AUTH_KEY);
    if (data) {
      const user = JSON.parse(data);
      if (user?.id) {
        const {supabase} = require('./supabase');
        await supabase.from('user_tokens').delete().eq('user_id', user.id);
      }
    }
  } catch {}
  await AsyncStorage.removeItem(AUTH_KEY);
  // Clear module-level caches to prevent data leaking between user sessions
  clearUserCache();
  clearReasonCache();
  clearGroupCache();
};

export const updateProfile = async (
  user: User,
  data: {name?: string; phone?: string},
): Promise<User> => {
  if (data.phone && data.phone !== user.phone) {
    const existing = await getUserByPhone(data.phone);
    if (existing) throw new Error('Phone number already in use');
  }
  await updateUserProfile(user.id, data);
  const updated = {...user, ...data};
  await storeUser(updated);
  return updated;
};

export const changePin = async (
  user: User,
  currentPin: string,
  newPin: string,
): Promise<void> => {
  // Try Edge Function first (server-side verification). Fall back to direct
  // Supabase if the Edge Function isn't deployed yet.
  try {
    await updateOwnPin(user.id, currentPin, newPin);
    return;
  } catch (e: any) {
    if (!e?.message?.includes('404')) throw e;
  }
  // Fallback: verify locally, update directly
  const freshUser = await getUserByPhone(user.phone);
  if (!freshUser) throw new Error('User not found');
  if (!verifyPin(currentPin, freshUser.pin_hash)) throw new Error('Current PIN is incorrect');
  await resetUserPin(user.id, hashPin(newPin));
};
