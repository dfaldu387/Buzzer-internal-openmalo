import {useState, useEffect, useCallback} from 'react';
import {AppState, Platform, Alert} from 'react-native';
import {User} from '../types';
import {
  login as authLogin,
  signup as authSignup,
  deleteAccount as authDeleteAccount,
  updateProfile as authUpdateProfile,
  changePin as authChangePin,
  getStoredUser,
  logout as authLogout,
} from '../services/auth';
import {updateLastSeen, updateFcmToken, getFcmToken} from '../services/firebase';

const refreshFcmToken = async (userId: string) => {
  try {
    const {getMessaging, requestPermission, getToken} = require('@react-native-firebase/messaging');
    const messaging = getMessaging();
    const permStatus = await requestPermission(messaging);
    console.log('[FCM] Permission status:', permStatus);
    const token = await getToken(messaging);
    console.log('[FCM] Token:', token ? token.substring(0, 20) + '...' : 'NULL');
    if (token) {
      await updateFcmToken(userId, token, Platform.OS);
      console.log('[FCM] Token saved to Supabase for user:', userId);
    } else {
      console.warn('[FCM] No token returned — APNs registration may have failed');
    }
    // Check iOS notification sound settings
    if (Platform.OS === 'ios') {
      try {
        const notifee = require('@notifee/react-native').default;
        const settings = await notifee.getNotificationSettings();
        console.log('[Notif] Settings:', JSON.stringify(settings));
        // authorizationStatus: 1=AUTHORIZED, 0=DENIED, -1=NOT_DETERMINED
        // soundSetting: 1=ENABLED, 0=DISABLED
        if (settings.authorizationStatus === 1 && settings.ios?.sound === 0) {
          Alert.alert(
            'Notification Sound Disabled',
            'Buzzer notification sounds are turned OFF in iOS Settings.\n\nGo to: Settings → Notifications → Buzzer → turn ON "Sounds"',
          );
        }
      } catch {}
    }
  } catch (err: any) {
    console.warn('[FCM] Token refresh failed:', err?.message || err);
  }
};

export const useAuth = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getStoredUser()
      .then(u => {
        setUser(u);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  // Refresh FCM token on every app open and when app returns to foreground
  useEffect(() => {
    if (!user) return;
    refreshFcmToken(user.id);
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') refreshFcmToken(user.id);
    });
    return () => sub.remove();
  }, [user]);

  // Listen for FCM token rotation and update Supabase immediately
  useEffect(() => {
    if (!user) return;
    try {
      const {getMessaging, onTokenRefresh} = require('@react-native-firebase/messaging');
      const messaging = getMessaging();
      const unsub = onTokenRefresh(messaging, async (newToken: string) => {
        if (newToken) await updateFcmToken(user.id, newToken, Platform.OS).catch(() => {});
      });
      return unsub;
    } catch (err: any) {
      console.warn('FCM onTokenRefresh setup failed:', err?.message || err);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    updateLastSeen(user.id).catch(() => {});
    let interval: ReturnType<typeof setInterval> | null = setInterval(() => updateLastSeen(user.id).catch(() => {}), 15000);
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        updateLastSeen(user.id).catch(() => {});
        if (!interval) interval = setInterval(() => updateLastSeen(user.id).catch(() => {}), 15000);
      } else {
        if (interval) { clearInterval(interval); interval = null; }
      }
    });
    return () => { if (interval) clearInterval(interval); sub.remove(); };
  }, [user]);

  const login = useCallback(async (phone: string, pin: string) => {
    const u = await authLogin(phone, pin);
    if (u) setUser(u);
    return u;
  }, []);

  const signUp = useCallback(async (name: string, phone: string, pin: string, role: 'manager' | 'member' = 'member') => {
    const u = await authSignup(name, phone, pin, role);
    setUser(u);
    return u;
  }, []);

  const deleteAccount = useCallback(async () => {
    if (!user) return;
    await authDeleteAccount(user.id);
    setUser(null);
  }, [user]);

  const updateProfile = useCallback(async (data: {name?: string; phone?: string}) => {
    if (!user) return;
    const updated = await authUpdateProfile(user, data);
    setUser(updated);
  }, [user]);

  const changePin = useCallback(async (currentPin: string, newPin: string) => {
    if (!user) return;
    await authChangePin(user, currentPin, newPin);
  }, [user]);

  const logout = useCallback(async () => {
    await authLogout();
    setUser(null);
  }, []);

  return {user, loading, login, signUp, deleteAccount, updateProfile, changePin, logout};
};
