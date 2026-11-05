/**
 * Tests for batteryOptimization.ts — covers promptBatteryOptimization,
 * checkAndPromptBattery, and promptDndAccess across platforms and states.
 */

jest.mock('../src/services/supabase', () => ({
  supabase: {from: jest.fn()},
  VOICE_MAIL_BUCKET: 'voice-mails',
  uploadVoiceMail: jest.fn(),
}));
jest.mock('@env', () => ({SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'test-key'}));
jest.mock('react-native-url-polyfill/auto', () => {});

import {Alert, Platform, NativeModules} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Spy on Alert.alert before importing the module
const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

beforeEach(() => {
  jest.clearAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  // Default to Android for these tests
  (Platform as any).OS = 'android';
});

afterAll(() => {
  alertSpy.mockRestore();
});

describe('promptBatteryOptimization', () => {
  it('does nothing on iOS', async () => {
    (Platform as any).OS = 'ios';
    const {promptBatteryOptimization} = require('../src/services/batteryOptimization');
    await promptBatteryOptimization();
    expect(AsyncStorage.getItem).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('skips if already prompted', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('true');
    const {promptBatteryOptimization} = require('../src/services/batteryOptimization');
    await promptBatteryOptimization();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('marks as prompted in AsyncStorage', async () => {
    const {promptBatteryOptimization} = require('../src/services/batteryOptimization');
    await promptBatteryOptimization();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('@openmalo_battery_prompted', 'true');
  });

  it('shows generic prompt when native module unavailable', async () => {
    NativeModules.BuzzerService = undefined;
    const {promptBatteryOptimization} = require('../src/services/batteryOptimization');
    await promptBatteryOptimization();
    expect(alertSpy).toHaveBeenCalledWith(
      'Important: Allow Background Activity',
      expect.stringContaining('battery optimization'),
      expect.any(Array),
    );
  });
});

describe('checkAndPromptBattery', () => {
  it('returns null on iOS', async () => {
    (Platform as any).OS = 'ios';
    const {checkAndPromptBattery} = require('../src/services/batteryOptimization');
    const result = await checkAndPromptBattery();
    expect(result).toBeNull();
  });

  it('returns null when native module unavailable', async () => {
    NativeModules.BuzzerService = undefined;
    const {checkAndPromptBattery} = require('../src/services/batteryOptimization');
    const result = await checkAndPromptBattery();
    expect(result).toBeNull();
  });
});

describe('promptDndAccess', () => {
  it('does nothing on iOS', async () => {
    (Platform as any).OS = 'ios';
    const {promptDndAccess} = require('../src/services/batteryOptimization');
    await promptDndAccess();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('skips if DND access already granted', async () => {
    NativeModules.BuzzerService = {
      isDndAccessGranted: jest.fn().mockResolvedValue(true),
    };
    const {promptDndAccess} = require('../src/services/batteryOptimization');
    await promptDndAccess();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('shows DND access prompt when not granted (Android)', async () => {
    NativeModules.BuzzerService = {
      isDndAccessGranted: jest.fn().mockResolvedValue(false),
    };
    const {promptDndAccess} = require('../src/services/batteryOptimization');
    await promptDndAccess();
    expect(alertSpy).toHaveBeenCalledWith(
      'Allow Do Not Disturb Access',
      expect.stringContaining('DND'),
      expect.any(Array),
    );
  });
});
