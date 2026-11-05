// ─── React Native modules ─────────────────────────────────
// NativeAnimatedHelper mock skipped — handled by RN preset in 0.87+

// ─── @react-native-async-storage/async-storage ───────────
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(() => Promise.resolve(null)),
    setItem: jest.fn(() => Promise.resolve()),
    removeItem: jest.fn(() => Promise.resolve()),
    clear: jest.fn(() => Promise.resolve()),
  },
}));

// ─── react-native-safe-area-context ──────────────────────
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({children}) => children,
  useSafeAreaInsets: () => ({top: 0, bottom: 0, left: 0, right: 0}),
}));

// ─── react-native-sound ─────────────────────────────────
jest.mock('react-native-sound', () => {
  const Sound = jest.fn().mockImplementation((file, bundle, cb) => {
    if (cb) setTimeout(() => cb(null), 0);
  });
  Sound.setCategory = jest.fn();
  Sound.prototype.play = jest.fn(cb => cb && cb(true));
  Sound.prototype.stop = jest.fn();
  Sound.prototype.release = jest.fn();
  Sound.prototype.setVolume = jest.fn();
  Sound.prototype.setNumberOfLoops = jest.fn();
  Sound.MAIN_BUNDLE = '';
  return Sound;
});

// ─── react-native-vector-icons ──────────────────────────
jest.mock('react-native-vector-icons/MaterialIcons', () => 'Icon');

// ─── @notifee/react-native ──────────────────────────────
jest.mock('@notifee/react-native', () => ({
  __esModule: true,
  default: {
    displayNotification: jest.fn(() => Promise.resolve()),
    cancelNotification: jest.fn(() => Promise.resolve()),
    cancelAllNotifications: jest.fn(() => Promise.resolve()),
    createChannel: jest.fn(() => Promise.resolve()),
    onBackgroundEvent: jest.fn(),
    onForegroundEvent: jest.fn(() => jest.fn()),
    setNotificationCategories: jest.fn(() => Promise.resolve()),
    getInitialNotification: jest.fn(() => Promise.resolve(null)),
  },
  EventType: {ACTION_PRESS: 1, PRESS: 4},
  AndroidImportance: {HIGH: 4, DEFAULT: 3},
  AndroidVisibility: {PUBLIC: 1},
}));

// ─── @react-native-firebase/messaging ───────────────────
jest.mock('@react-native-firebase/messaging', () => ({
  getMessaging: jest.fn(() => ({})),
  onMessage: jest.fn(() => jest.fn()),
  onNotificationOpenedApp: jest.fn(() => jest.fn()),
  getInitialNotification: jest.fn(() => Promise.resolve(null)),
  setBackgroundMessageHandler: jest.fn(),
  requestPermission: jest.fn(() => Promise.resolve(1)),
  getToken: jest.fn(() => Promise.resolve('mock-token')),
  onTokenRefresh: jest.fn(() => jest.fn()),
}));

// ─── react-native-url-polyfill ──────────────────────────
jest.mock('react-native-url-polyfill/auto', () => {});

// ─── @supabase/supabase-js ──────────────────────────────
// Supabase is mocked per-test-file (App.test.tsx and buzz.test.ts each
// provide their own jest.mock for src/services/supabase) so that tests
// can control query results independently.

// ─── Global fetch ───────────────────────────────────────
global.fetch = jest.fn(() =>
  Promise.resolve({ok: true, json: () => Promise.resolve({})}),
);
