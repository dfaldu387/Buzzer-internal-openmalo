import {Alert, NativeModules, Platform} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BATTERY_PROMPT_KEY = '@openmalo_battery_prompted';
const BATTERY_RECHEK_KEY = '@openmalo_battery_recheck_ts';
// Don't re-prompt more than once per 24 hours to avoid nagging
const RECHECK_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const {BuzzerService} = NativeModules;

interface BatteryInfo {
  oem: string;
  oemName: string;
  steps: string;
  hasAutostart: boolean;
  needsManualStep: boolean;
  isIgnoringBatteryOptimizations: boolean;
  manufacturer: string;
  model: string;
}

/**
 * OEM-aware battery optimization prompt.
 *
 * Stock Android only needs the standard battery exemption dialog.
 * Xiaomi, Huawei, Samsung, Oppo, Vivo, and OnePlus each have their own
 * autostart / protected-app / sleeping-app systems that must be configured
 * separately.
 *
 * This prompt runs on first login. For OEMs that require manual steps,
 * it shows device-specific instructions and opens the correct settings screen.
 */
export const promptBatteryOptimization = async () => {
  if (Platform.OS !== 'android') return;

  const prompted = await AsyncStorage.getItem(BATTERY_PROMPT_KEY);
  if (prompted) return;

  await AsyncStorage.setItem(BATTERY_PROMPT_KEY, 'true');

  let info: BatteryInfo | null = null;
  try {
    info = await BuzzerService?.getBatteryInfo?.();
  } catch {}

  if (!info) {
    // Fallback: native module not available
    showGenericPrompt();
    return;
  }

  // Step 1: Request standard Android battery exemption (the system dialog)
  if (!info.isIgnoringBatteryOptimizations) {
    try {
      await BuzzerService?.requestBatteryExemption?.();
    } catch {}
  }

  // Step 2: If OEM needs additional manual steps, show instructions
  if (info.needsManualStep && info.oem !== 'STOCK') {
    // Small delay so the system dialog (if shown) settles first
    setTimeout(() => {
      Alert.alert(
        `Important for ${info!.oemName} Users`,
        `Your phone (${info!.manufacturer}) requires extra settings to receive buzzes reliably when the app is closed.\n\n${info!.steps}`,
        [
          {
            text: 'Open Settings',
            onPress: () => {
              BuzzerService?.openOemBatterySettings?.().catch(() => {});
            },
          },
          {
            text: 'Later',
            style: 'cancel',
          },
        ],
      );
    }, 1500);
  }
};

/**
 * Periodic re-check on app resume. If battery exemption was revoked
 * (e.g. OEM update, user toggled it off), re-prompt.
 * Rate-limited to once per 24 hours to avoid nagging.
 */
export const recheckBatteryOptimization = async () => {
  if (Platform.OS !== 'android') return;

  // Rate-limit: once per 24 hours
  const lastCheck = await AsyncStorage.getItem(BATTERY_RECHEK_KEY);
  if (lastCheck && Date.now() - parseInt(lastCheck, 10) < RECHECK_COOLDOWN_MS) return;

  let info: BatteryInfo | null = null;
  try {
    info = await BuzzerService?.getBatteryInfo?.();
  } catch {}
  if (!info) return;

  // Only prompt if exemption was LOST (user had it before, now revoked)
  if (!info.isIgnoringBatteryOptimizations) {
    await AsyncStorage.setItem(BATTERY_RECHEK_KEY, String(Date.now()));
    Alert.alert(
      'Battery Optimization Re-enabled',
      `Your phone's battery settings were changed and may block incoming buzzes.\n\n${info.needsManualStep ? info.steps : 'Please disable battery optimization for Buzzer.'}`,
      [
        {
          text: 'Fix Now',
          onPress: () => {
            BuzzerService?.requestBatteryExemption?.().catch(() => {});
            if (info!.needsManualStep) {
              setTimeout(() => {
                BuzzerService?.openOemBatterySettings?.().catch(() => {});
              }, 500);
            }
          },
        },
        {text: 'Later', style: 'cancel'},
      ],
    );
  } else {
    // Exemption is fine — record timestamp so we don't check again for 24h
    await AsyncStorage.setItem(BATTERY_RECHEK_KEY, String(Date.now()));
  }
};

/**
 * Re-check battery status. Unlike the initial prompt, this can be called
 * from a settings screen or help section to let users re-configure.
 * Does NOT check the "prompted once" flag.
 */
export const checkAndPromptBattery = async (): Promise<BatteryInfo | null> => {
  if (Platform.OS !== 'android') return null;

  let info: BatteryInfo | null = null;
  try {
    info = await BuzzerService?.getBatteryInfo?.();
  } catch {}

  if (!info) return null;

  const issues: string[] = [];

  if (!info.isIgnoringBatteryOptimizations) {
    issues.push('Battery optimization is still enabled — the system may stop buzzes after a while.');
  }

  if (info.hasAutostart) {
    issues.push(`${info.oemName} devices require Autostart permission for reliable background buzzes.`);
  }

  // Check DND access — required for alarm to override silent/DND mode
  try {
    const dndGranted = await BuzzerService?.isDndAccessGranted?.();
    if (!dndGranted) {
      issues.push('Do Not Disturb access is not granted — buzzes will be silent when your phone is on silent or DND mode.');
    }
  } catch {}

  if (issues.length > 0) {
    Alert.alert(
      'Background Buzz Check',
      `${issues.join('\n\n')}\n\n${info.steps}`,
      [
        {
          text: 'Fix Now',
          onPress: () => {
            if (!info!.isIgnoringBatteryOptimizations) {
              BuzzerService?.requestBatteryExemption?.().catch(() => {});
            }
            setTimeout(() => {
              BuzzerService?.openOemBatterySettings?.().catch(() => {});
            }, 500);
          },
        },
        {text: 'Dismiss', style: 'cancel'},
      ],
    );
  } else {
    Alert.alert(
      'Background Buzzes OK',
      'Your device settings look correct. Buzzes should arrive reliably.',
    );
  }

  return info;
};

const showGenericPrompt = () => {
  Alert.alert(
    'Important: Allow Background Activity',
    'To receive buzzes when the app is closed, you must disable battery optimization for this app.\n\nGo to:\nSettings → Apps → OpenMalo Buzzer → Battery → Unrestricted',
    [
      {
        text: 'Open Settings',
        onPress: () => {
          const {Linking} = require('react-native');
          Linking.openSettings().catch(() => {});
        },
      },
      {
        text: 'Skip',
        style: 'cancel',
      },
    ],
  );
};

/**
 * iOS: Check if notification permissions are still granted.
 * If the user disabled notifications in iOS Settings after initial grant,
 * the app gets no pushes and no sound. This prompts them to re-enable.
 * Rate-limited to once per session to avoid nagging.
 */
let notifPermissionCheckedThisSession = false;

export const checkNotificationPermission = async () => {
  if (Platform.OS !== 'ios') return;
  if (notifPermissionCheckedThisSession) return;
  notifPermissionCheckedThisSession = true;

  try {
    const {getMessaging, getNotificationPermission} = require('@react-native-firebase/messaging');
    const messaging = getMessaging();
    const status = await getNotificationPermission(messaging);
    // status: -1 = not determined, 0 = denied, 1 = authorized, 2 = provisional
    if (status === 0) {
      const {Linking} = require('react-native');
      Alert.alert(
        'Notifications Disabled',
        'Buzzer notifications are turned off. You will not hear incoming buzzes until you re-enable them.\n\nGo to Settings → Notifications → Buzzer → Allow Notifications',
        [
          {
            text: 'Open Settings',
            onPress: () => Linking.openSettings().catch(() => {}),
          },
          {text: 'Later', style: 'cancel'},
        ],
      );
    }
  } catch {}
};

let dndPromptedThisSession = false;

export const promptDndAccess = async () => {
  if (Platform.OS !== 'android') return;
  if (dndPromptedThisSession) return;

  // Check if DND access is already granted — if so, no need to prompt
  try {
    const granted = await BuzzerService?.isDndAccessGranted?.();
    if (granted) return;
  } catch {}

  // Rate-limit: only prompt once per session
  dndPromptedThisSession = true;

  const {Linking} = require('react-native');
  Alert.alert(
    'Allow Do Not Disturb Access',
    'Buzzer needs DND access to ring loud even when your phone is on silent or Do Not Disturb mode. Without it, you may miss buzzes.',
    [
      {
        text: 'Allow',
        onPress: () => {
          try {
            Linking.sendIntent('android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS').catch(() => {
              Linking.openSettings().catch(() => {});
            });
          } catch {
            Linking.openSettings().catch(() => {});
          }
        },
      },
      {
        text: 'Skip',
        style: 'cancel',
      },
    ],
  );
};
