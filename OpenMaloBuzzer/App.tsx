import React, {useState, useEffect, useCallback, useRef} from 'react';
import {StatusBar, ActivityIndicator, View, Text, StyleSheet, AppState, NativeModules, Platform, PermissionsAndroid, DeviceEventEmitter, Linking, TouchableOpacity} from 'react-native';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {useAuth} from './src/hooks/useAuth';
import {createNotificationChannel, setupNotificationListeners, cancelBuzzNotification} from './src/services/notification';
import {respondToBuzz, subscribeToIncomingBuzzes, subscribeToUsers, requestFcmPermission, getUserName} from './src/services/firebase';
import {MISSED_BUZZ_WINDOW_MS} from './src/constants';
import {promptBatteryOptimization, promptDndAccess, recheckBatteryOptimization, checkNotificationPermission} from './src/services/batteryOptimization';
import {getSelectedSound} from './src/services/soundPreference';
import {supabase} from './src/services/supabase';
import {BuzzPayload, User, Group} from './src/types';

import LoginScreen from './src/screens/LoginScreen';
import SignupScreen from './src/screens/SignupScreen';
import HomeScreen from './src/screens/HomeScreen';
import BuzzSheet from './src/screens/BuzzSheet';
import IncomingBuzzScreen from './src/screens/IncomingBuzzScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import GroupsScreen from './src/screens/GroupsScreen';
import GroupBuzzSheet from './src/screens/GroupBuzzSheet';
import VoiceMailScreen from './src/screens/VoiceMailScreen';

const {BuzzerService, BuzzerAlarmModule} = NativeModules;

/** Safely convert created_at to epoch ms — handles both raw numbers and ISO strings. */
const toEpochMs = (v: any): number => {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return new Date(v).getTime();
  return 0;
};

type Screen = 'home' | 'buzz' | 'settings' | 'profile' | 'history' | 'groups' | 'group-buzz' | 'voice-mail';

function App() {
  const {user, loading, login, signUp, deleteAccount, updateProfile, changePin, logout} = useAuth();
  const [screen, setScreen] = useState<Screen>('home');
  const [authScreen, setAuthScreen] = useState<'login' | 'signup'>('login');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [incomingPayload, setIncomingPayload] = useState<BuzzPayload | null>(null);
  const [initialReason, setInitialReason] = useState<string | undefined>(undefined);
  const [autoSend, setAutoSend] = useState(false);
  const [pendingChecked, setPendingChecked] = useState(false);
  const [homeTab, setHomeTab] = useState<'recent' | 'people' | 'groups' | 'voice'>('recent');
  const [realtimeEpoch, setRealtimeEpoch] = useState(0);
  const [editGroup, setEditGroup] = useState<Group | null>(null);
  const usersMapRef = useRef<Record<string, string>>({});
  const userRef = useRef(user);
  userRef.current = user;

  useEffect(() => {
    const requestPermissions = async () => {
      if (Platform.OS === 'android' && Platform.Version >= 33) {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
        );
      }
      await requestFcmPermission();
      await createNotificationChannel();
    };
    requestPermissions().catch(() => {});
  }, []);

  useEffect(() => {
    if (user) {
      BuzzerService?.startService(user.id);
      // Sync sound preference to native SharedPreferences
      if (Platform.OS === 'android') {
        getSelectedSound().then(s => BuzzerService?.setBuzzSound?.(s)).catch(() => {});
      }
      promptBatteryOptimization();
      setTimeout(() => promptDndAccess(), 2000);
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') {
          // Use health check: only restarts the service if OEM killed it
          BuzzerService?.checkAndRecoverService?.().catch(() => {
            // Fallback if health check not available
            BuzzerService?.startService(user.id);
          });
          // Re-check permissions on resume — OEM may have revoked battery
          // exemption, or user may have disabled notifications in Settings
          promptDndAccess();
          recheckBatteryOptimization();
          checkNotificationPermission();
          // Force Realtime re-subscribe — WebSocket often silently dies
          // after backgrounding on mobile, causing buzzes to not arrive
          setRealtimeEpoch(e => e + 1);
        }
      });
      return () => sub.remove();
    }
    // Only stop service after loading is complete and user is definitely null (logged out)
    // Don't stop during initial load — native service may already be running
    if (!loading && !user) {
      BuzzerService?.stopService();
    }
  }, [user, loading]);

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeToUsers(users => {
      const map: Record<string, string> = {};
      users.forEach(u => { map[u.id] = u.name; });
      usersMapRef.current = map;
    });
    return unsub;
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const unsubscribe = subscribeToIncomingBuzzes(
      user.id,
      (buzz) => {
        console.log(`[T6-RT] Supabase Realtime received buzz ${buzz.id} at ${Date.now()}`);
        if (AppState.currentState === 'active') {
          const name = buzz.from_user_name || usersMapRef.current[buzz.from_user_id] || 'User';
          setIncomingPayload(prev => {
            if (prev?.buzz_id === buzz.id) return prev;
            return {
              buzz_id: buzz.id,
              from_user_id: buzz.from_user_id,
              from_user_name: name,
              reason: buzz.reason,
              note: buzz.note,
              sound_id: buzz.sound_id || null,
              created_at: toEpochMs(buzz.created_at),
            };
          });
        }
        // Background/killed notifications are handled by FCM setBackgroundMessageHandler
      },
      (buzzId) => {
        // Clear incomingPayload if the removed buzz is the one being shown.
        // This is safe: the race with FCM onMessage that originally motivated
        // the "don't clear" comment is avoided by checking the buzz_id —
        // a new buzz arriving via FCM will have a different buzz_id and won't
        // be cleared. Clearing here ensures the screen + alarm tear down
        // immediately when the Realtime UPDATE arrives (especially for
        // cancellations, which are no longer suppressed by initialFetchIds).
        setIncomingPayload(prev => {
          if (prev?.buzz_id === buzzId) {
            BuzzerService?.stopAlarm?.();
            BuzzerAlarmModule?.stopAlarm?.();
            return null;
          }
          return prev;
        });
        cancelBuzzNotification(buzzId).catch(() => {});
      },
    );
    return unsubscribe;
    // realtimeEpoch forces re-subscribe on app resume (WebSocket may have died)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, realtimeEpoch]);

  // JS-side polling fallback: if FCM + Realtime both fail, poll Supabase
  // directly every 5s to catch incoming buzzes. This ensures IncomingBuzzScreen
  // shows even when push/websocket are down (the native BuzzerService poll
  // only shows a notification, not the full-screen UI).
  useEffect(() => {
    if (!user) return;
    const poll = setInterval(async () => {
      if (AppState.currentState !== 'active') return;
      // Skip if we're already showing a buzz
      if (incomingPayload) return;
      try {
        const {data} = await supabase.from('buzzes').select('*')
          .eq('to_user_id', user.id).eq('response', 'none')
          .order('created_at', {ascending: false}).limit(1);
        if (data && data.length > 0) {
          const buzz = data[0] as any;
          if (!buzz.id) return; // Guard against malformed rows
          const ts = toEpochMs(buzz.created_at);
          if (ts > 0 && Date.now() - ts <= MISSED_BUZZ_WINDOW_MS) {
            const name = buzz.from_user_name || usersMapRef.current[buzz.from_user_id] || 'User';
            setIncomingPayload(prev => {
              if (prev?.buzz_id === buzz.id) return prev;
              return {
                buzz_id: buzz.id,
                from_user_id: buzz.from_user_id,
                from_user_name: name,
                reason: buzz.reason,
                note: buzz.note,
                sound_id: buzz.sound_id || null,
                created_at: ts,
              };
            });
          }
        }
      } catch {}
    }, 5000);
    return () => clearInterval(poll);
  }, [user, incomingPayload]);

  useEffect(() => {
    try {
      const {getMessaging, onMessage, onNotificationOpenedApp} = require('@react-native-firebase/messaging');
      const messaging = getMessaging();
      const unsub = onMessage(messaging, (remoteMessage: any) => {
        const data = remoteMessage.data;
        if (!data) return;
        // Don't process buzzes before auth is complete — checkPending
        // will pick them up once the user is loaded.
        if (!userRef.current) return;
        if (data.type === 'buzz' && data.buzz_id) {
          console.log(`[T6] FCM onMessage received buzz ${data.buzz_id} at ${Date.now()}`);
          // Show IncomingBuzzScreen immediately from FCM data — don't wait
          // for Supabase Realtime which may have variable latency.
          setIncomingPayload(prev => {
            if (prev?.buzz_id === data.buzz_id) return prev;
            return {
              buzz_id: data.buzz_id,
              from_user_id: data.from_user_id || '',
              from_user_name: data.from_user_name || 'User',
              reason: data.reason || '',
              note: data.note && data.note !== 'null' ? data.note : null,
              sound_id: data.sound_id || null,
              created_at: Date.now(), // Live push — always fresh
            };
          });
          // Start native alarm immediately on Android
          if (Platform.OS === 'android') {
            BuzzerService?.showBuzz?.(
              data.buzz_id,
              data.from_user_id || '',
              data.from_user_name || 'User',
              data.reason || '',
              data.note || null,
              data.sound_id || 'buzz_alarm',
            ).catch(() => {});
          }
        }
        if (data.type === 'buzz_cancelled' && data.buzz_id) {
          // Only stop the alarm if the cancelled buzz is the one currently
          // active. Without this check, cancelling an old already-answered
          // buzz would kill a newer buzz's alarm.
          setIncomingPayload(prev => {
            if (prev?.buzz_id === data.buzz_id) {
              BuzzerService?.stopAlarm?.();
              BuzzerAlarmModule?.stopAlarm?.();
              return null;
            }
            return prev;
          });
          cancelBuzzNotification(data.buzz_id).catch(() => {});
        }
      });

      // Handle notification tap when app was in background (not killed).
      // FIX: Verify buzz is still active before showing IncomingBuzzScreen.
      // A cancelled buzz's notification may still be in the notification center
      // if the cancellation push was delayed or the app was killed.
      const unsubOpen = onNotificationOpenedApp(messaging, async (remoteMessage: any) => {
        const data = remoteMessage.data;
        if (!data) return;
        if (data.type === 'voice_message') {
          setSelectedUser(null);
          setScreen('voice-mail');
          return;
        }
        if (data.buzz_id) {
          // Check if buzz was already cancelled/responded
          try {
            const {data: buzzRow} = await supabase.from('buzzes').select('response')
              .eq('id', data.buzz_id).single();
            if (buzzRow && buzzRow.response !== 'none') return;
          } catch {}
          setIncomingPayload(prev => {
            if (prev?.buzz_id === data.buzz_id) return prev;
            return {
              buzz_id: data.buzz_id,
              from_user_id: data.from_user_id || '',
              from_user_name: data.from_user_name || 'User',
              reason: data.reason || '',
              note: data.note && data.note !== 'null' ? data.note : null,
              sound_id: data.sound_id || null,
              created_at: Date.now(),
            };
          });
        }
      });

      return () => { unsub(); unsubOpen(); };
    } catch (err) {
      console.warn('FCM foreground handler setup error:', err);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = setupNotificationListeners(
      (buzzId, response) => {
        respondToBuzz(buzzId, response as any).catch(() => {});
        // Stop alarm and dismiss IncomingBuzzScreen when responding from notification
        BuzzerService?.stopAlarm?.();
        setIncomingPayload(prev => prev?.buzz_id === buzzId ? null : prev);
      },
      payload => { setIncomingPayload(prev => prev?.buzz_id === payload.buzz_id ? prev : payload); },
      () => { setSelectedUser(null); setScreen('voice-mail'); },
    );
    return unsubscribe;
  }, []);

  // Listen for native navigation events (foreground notification tap)
  useEffect(() => {
    if (!user) return;
    const sub = DeviceEventEmitter.addListener('onNavigate', (event: any) => {
      if (event?.screen === 'voice_mail') {
        setSelectedUser(null);
        setScreen('voice-mail');
      }
    });
    return () => sub.remove();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const checkPending = async () => {
      try {
        const nav = await BuzzerService?.getPendingNavigation?.();
        if (nav === 'voice_mail') {
          setSelectedUser(null);
          setScreen('voice-mail');
          setPendingChecked(true);
          return;
        }
        const data = await BuzzerService?.getPendingBuzz?.();
        if (data?.buzz_id) {
          const immediateName = data.from_user_name && data.from_user_name !== 'Someone'
            ? data.from_user_name : 'User';
          setIncomingPayload(prev => {
            if (prev?.buzz_id === data.buzz_id) return prev;
            return {
              buzz_id: data.buzz_id,
              from_user_id: data.from_user_id,
              from_user_name: immediateName,
              reason: data.reason,
              note: data.note || null,
              sound_id: data.sound_id || null,
            };
          });
          setPendingChecked(true);
          // Resolve real name in background
          if (!data.from_user_name || data.from_user_name === 'Someone') {
            getUserName(data.from_user_id).then(resolvedName => {
              setIncomingPayload(prev => {
                if (prev && prev.buzz_id === data.buzz_id) {
                  return {...prev, from_user_name: resolvedName};
                }
                return prev;
              });
            }).catch(() => {});
          }
          return;
        }

        // iOS: check if app was opened from a notification tap (killed state).
        // Check both Firebase (APNs system notifications) and notifee.
        try {
          const {getMessaging, getInitialNotification: fcmGetInitial} = require('@react-native-firebase/messaging');
          const fcmInitial = await fcmGetInitial(getMessaging());
          if (fcmInitial?.data) {
            const nData = fcmInitial.data;
            if (nData.type === 'voice_message') {
              setSelectedUser(null);
              setScreen('voice-mail');
              setPendingChecked(true);
              return;
            }
            if (nData.buzz_id) {
              setIncomingPayload(prev => {
                if (prev?.buzz_id === nData.buzz_id) return prev;
                return {
                  buzz_id: nData.buzz_id as string,
                  from_user_id: (nData.from_user_id as string) || '',
                  from_user_name: (nData.from_user_name as string) || 'User',
                  reason: (nData.reason as string) || '',
                  note: nData.note && nData.note !== 'null' ? (nData.note as string) : null,
                  sound_id: (nData.sound_id as string) || null,
                };
              });
              setPendingChecked(true);
              return;
            }
          }
        } catch {}

        // Also check notifee's initial notification (for notifee-managed notifications)
        try {
          const notifee = require('@notifee/react-native').default;
          const initial = await notifee.getInitialNotification();
          if (initial?.notification?.data) {
            const nData = initial.notification.data;
            if (nData.type === 'voice_message') {
              setSelectedUser(null);
              setScreen('voice-mail');
              setPendingChecked(true);
              return;
            }
            if (nData.buzz_id) {
              setIncomingPayload(prev => {
                if (prev?.buzz_id === nData.buzz_id) return prev;
                return {
                  buzz_id: nData.buzz_id as string,
                  from_user_id: (nData.from_user_id as string) || '',
                  from_user_name: (nData.from_user_name as string) || 'User',
                  reason: (nData.reason as string) || '',
                  note: nData.note && nData.note !== 'null' ? (nData.note as string) : null,
                  sound_id: (nData.sound_id as string) || null,
                };
              });
              setPendingChecked(true);
              return;
            }
          }
        } catch {}

        // Check for buzz data stored by notifee onBackgroundEvent PRESS handler.
        // This is the most reliable path for iOS notification taps from
        // background/killed state — Firebase's handlers are unreliable for APNs.
        try {
          const tapData = await AsyncStorage.getItem('@openmalo_pending_tap');
          if (tapData) {
            await AsyncStorage.removeItem('@openmalo_pending_tap');
            const parsed = JSON.parse(tapData);
            if (parsed.buzz_id) {
              setIncomingPayload(prev => {
                if (prev?.buzz_id === parsed.buzz_id) return prev;
                return parsed;
              });
              setPendingChecked(true);
              return;
            }
          }
        } catch {}

        // Safety net: check Supabase for any missed unanswered buzzes.
        // This catches buzzes sent while the app was inactive and the
        // FCM token was stale (e.g., iOS app not opened for days).
        // No time limit — any unanswered buzz is shown. The receiver
        // sees "Sent X ago" for stale ones and gets a gentle vibrate
        // instead of a loud alarm. Never silently drop a buzz.
        try {
          const {data: missed} = await supabase.from('buzzes').select('*')
            .eq('to_user_id', userRef.current?.id || '').eq('response', 'none')
            .order('created_at', {ascending: false});
          if (missed && missed.length > 0) {
            // Show the newest buzz first. Remaining buzzes will be picked
            // up on subsequent checkPending calls (each app resume) after
            // the user dismisses the current one.
            const buzz = missed[0] as any;
            const ts = toEpochMs(buzz.created_at);
            if (buzz.id) {
              const name = buzz.from_user_name || usersMapRef.current[buzz.from_user_id] || 'User';
              setIncomingPayload(prev => {
                if (prev?.buzz_id === buzz.id) return prev;
                return {
                  buzz_id: buzz.id,
                  from_user_id: buzz.from_user_id,
                  from_user_name: name,
                  reason: buzz.reason,
                  note: buzz.note,
                  sound_id: buzz.sound_id || null,
                  created_at: ts || null,
                };
              });
              setPendingChecked(true);
              return;
            }
          }
        } catch {}
      } catch (err: any) {
        console.warn('checkPending failed:', err?.message || err);
      }
      setPendingChecked(true);
    };
    checkPending();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        checkPending();
        // Delayed retry — gives notifee/Firebase handlers time to store
        // tap data before checkPending reads it. Crucial for iOS where
        // onBackgroundEvent PRESS fires slightly after AppState 'active'.
        setTimeout(checkPending, 1500);
      }
    });
    return () => sub.remove();
  }, [user]);

  const handleLogout = useCallback(async () => {
    BuzzerService?.stopService();
    setScreen('home');
    setSelectedUser(null);
    setSelectedGroup(null);
    setIncomingPayload(null);
    setPendingChecked(false);
    setAuthScreen('login');
    await logout();
  }, [logout]);

  const handleDeleteAccount = useCallback(async () => {
    BuzzerService?.stopService();
    setScreen('home');
    setSelectedUser(null);
    setSelectedGroup(null);
    setIncomingPayload(null);
    setPendingChecked(false);
    setAuthScreen('login');
    await deleteAccount();
  }, [deleteAccount]);

  const [initialSound, setInitialSound] = useState<string | undefined>(undefined);
  const handleSelectUser = useCallback((u: User) => { setAutoSend(false); setInitialReason(undefined); setInitialSound(undefined); setSelectedUser(u); setScreen('buzz'); }, []);
  const handleBuzzAgain = useCallback((u: User, reason: string, soundId?: string) => { setAutoSend(true); setInitialReason(reason); setInitialSound(soundId); setSelectedUser(u); setScreen('buzz'); }, []);
  const handleEditBuzz = useCallback((u: User, reason: string) => { setAutoSend(false); setInitialReason(reason); setInitialSound(undefined); setSelectedUser(u); setScreen('buzz'); }, []);
  const handleCloseBuzz = useCallback(() => { setSelectedUser(null); setInitialReason(undefined); setInitialSound(undefined); setAutoSend(false); setScreen('home'); }, []);
  const handleDismissIncoming = useCallback(() => { setIncomingPayload(null); }, []);
  const handleCallUser = useCallback((u: User) => {
    Linking.openURL(`tel:${u.phone}`).catch(() => {});
  }, []);
  const handleVoiceMail = useCallback((u?: User) => { setSelectedUser(u || null); setScreen('voice-mail'); }, []);
  const handleBuzzGroup = useCallback((g: Group) => { setSelectedGroup(g); setScreen('group-buzz'); }, []);
  const handleEditGroup = useCallback((g: Group) => { setEditGroup(g); setScreen('groups'); }, []);
  const handleCloseGroup = useCallback(() => { setSelectedGroup(null); setHomeTab('groups'); setScreen('home'); }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" backgroundColor="#0D0D0D" />
      {loading || (user && !pendingChecked) ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#FF4D4D" />
        </View>
      ) : !user ? (
        authScreen === 'login' ? (
          <LoginScreen onLogin={login} onGoToSignup={() => setAuthScreen('signup')} />
        ) : (
          <SignupScreen onSignup={signUp} onGoToLogin={() => setAuthScreen('login')} />
        )
      ) : (
        <>
          {screen === 'home' && (
            <HomeScreen
              currentUser={user}
              onSelectUser={handleSelectUser}
              onBuzzAgain={handleBuzzAgain}
              onEditBuzz={handleEditBuzz}
              onCallUser={handleCallUser}
              onVoiceMail={handleVoiceMail}
              onSettings={() => setScreen('settings')}
              onProfile={() => setScreen('profile')}
              onHistory={() => setScreen('history')}
              onGroups={() => setScreen('groups')}
              onBuzzGroup={handleBuzzGroup}
              onEditGroup={handleEditGroup}
              initialTab={homeTab}
            />
          )}
          {screen === 'buzz' && selectedUser && <BuzzSheet key={selectedUser.id + (initialReason || '') + (autoSend ? '_auto' : '')} sender={user} receiver={selectedUser} onClose={handleCloseBuzz} initialReason={initialReason} autoSend={autoSend} initialSound={initialSound} />}
          {screen === 'groups' && <GroupsScreen currentUser={user} onBack={() => { setEditGroup(null); setHomeTab('groups'); setScreen('home'); }} onBuzzGroup={handleBuzzGroup} initialEditGroup={editGroup || undefined} />}
          {screen === 'group-buzz' && selectedGroup && <GroupBuzzSheet sender={user} group={selectedGroup} onClose={handleCloseGroup} />}
          {screen === 'voice-mail' && <VoiceMailScreen currentUser={user} targetUser={selectedUser || undefined} onBack={() => { setSelectedUser(null); setScreen('home'); }} />}
          {screen === 'settings' && <SettingsScreen currentUser={user} onBack={() => setScreen('home')} />}
          {screen === 'profile' && <ProfileScreen currentUser={user} onBack={() => setScreen('home')} onLogout={handleLogout} onDeleteAccount={handleDeleteAccount} onUpdateProfile={updateProfile} onChangePin={changePin} />}
          {screen === 'history' && <HistoryScreen currentUser={user} onBack={() => setScreen('home')} />}

          {/* Incoming buzz overlay — renders on TOP of any screen without unmounting it */}
          {incomingPayload && <IncomingBuzzScreen payload={incomingPayload} onDismiss={handleDismissIncoming} />}
        </>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {flex: 1, backgroundColor: '#0D0D0D', alignItems: 'center', justifyContent: 'center'},
  errorContainer: {flex: 1, backgroundColor: '#0D0D0D', alignItems: 'center', justifyContent: 'center', padding: 32},
  errorTitle: {color: '#FF4D4D', fontSize: 24, fontWeight: '800', marginBottom: 12},
  errorMessage: {color: '#999', fontSize: 16, textAlign: 'center', marginBottom: 24},
  errorButton: {backgroundColor: '#FF4D4D', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12},
  errorButtonText: {color: '#fff', fontSize: 18, fontWeight: '700'},
});

class ErrorBoundary extends React.Component<{children: React.ReactNode}, {hasError: boolean}> {
  state = {hasError: false};
  static getDerivedStateFromError() { return {hasError: true}; }
  componentDidCatch(error: Error) { console.warn('App ErrorBoundary caught:', error); }
  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.errorContainer}>
          <Text style={styles.errorTitle}>Something went wrong</Text>
          <Text style={styles.errorMessage}>The app encountered an unexpected error. Please restart.</Text>
          <TouchableOpacity style={styles.errorButton} onPress={() => this.setState({hasError: false})}>
            <Text style={styles.errorButtonText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

export default () => <ErrorBoundary><App /></ErrorBoundary>;
