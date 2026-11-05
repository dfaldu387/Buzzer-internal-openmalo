import React, {useEffect, useRef, useState} from 'react';
import {View, Text, TouchableOpacity, StyleSheet, NativeModules, Platform, Vibration} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Sound from 'react-native-sound';
import {BuzzPayload, BuzzResponse, Buzz} from '../types';
import {respondToBuzz, subscribeToBuzz} from '../services/firebase';
import {cancelBuzzNotification} from '../services/notification';
import {NO_RESPONSE_TIMEOUT_MS} from '../constants';
import {BUZZ_SOUNDS} from '../services/soundPreference';

const {BuzzerAlarmModule} = NativeModules;

interface Props {
  payload: BuzzPayload;
  onDismiss: () => void;
}

const IncomingBuzzScreen: React.FC<Props> = ({payload, onDismiss}) => {
  const insets = useSafeAreaInsets();
  const soundRef = useRef<Sound | null>(null);
  const vibrationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopIOSAlarm = () => {
    if (soundRef.current) {
      soundRef.current.stop();
      soundRef.current.release();
      soundRef.current = null;
    }
    if (vibrationRef.current) {
      clearInterval(vibrationRef.current);
      vibrationRef.current = null;
    }
    Vibration.cancel();
    // Deactivate audio session so ducked apps restore their volume.
    // Equivalent to Android's abandonAudioFocusRequest().
    if (Platform.OS === 'ios') {
      try { BuzzerAlarmModule?.deactivateAlarmSession?.()?.catch(() => {}); } catch {}
    }
  };

  const stopAllAlarms = () => {
    NativeModules.BuzzerService?.stopAlarm();
    stopIOSAlarm();
  };

  // iOS: play alarm sound + vibration since there's no native BuzzerService.
  // Uses BuzzerAlarmModule to configure AVAudioSession with:
  //   - .playback category: bypasses the hardware mute switch
  //   - .duckOthers option: lowers other apps' audio (iOS audio focus equivalent)
  // The audio background mode in Info.plist keeps playback alive if the user
  // switches apps while the alarm is ringing.
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const startAlarm = async () => {
      // Check in-app mute toggle
      const isMuted = (await AsyncStorage.getItem('@openmalo_muted')) === 'true';

      if (!isMuted) {
        // Always set Playback category as baseline — bypasses the mute switch.
        // The native module call below adds .duckOthers on top of this.
        // If the native module is unavailable, Playback alone still works.
        Sound.setCategory('Playback');
        // Activate alarm audio session (duck other audio on top of Playback)
        try {
          await BuzzerAlarmModule?.activateAlarmSession?.();
        } catch {
          // Native module unavailable or failed — Playback category is still set above
        }
        const soundId = payload.sound_id || 'buzz_alarm';
        const file = BUZZ_SOUNDS.find(s => s.id === soundId)?.file || 'buzz_alarm.wav';
        const s = new Sound(file, Sound.MAIN_BUNDLE, (err) => {
          if (err) {
            console.warn('iOS alarm sound load failed:', file, err);
            // Fallback to default sound if custom sound fails
            if (file !== 'buzz_alarm.wav') {
              const fallback = new Sound('buzz_alarm.wav', Sound.MAIN_BUNDLE, (err2) => {
                if (err2) { console.warn('iOS fallback sound also failed:', err2); return; }
                fallback.setVolume(1.0);
                fallback.setNumberOfLoops(-1);
                fallback.play();
                soundRef.current = fallback;
              });
            }
            return;
          }
          s.setVolume(1.0);
          s.setNumberOfLoops(-1); // loop indefinitely
          s.play();
        });
        soundRef.current = s;
      }
      // Vibrate even when muted — so user still feels the buzz
      Vibration.vibrate([0, 500, 200, 500, 200, 500, 200, 500], true);
    };
    startAlarm();
    return () => stopIOSAlarm();
  }, []);

  // Listen for response changes (sender cancelled, or already responded from notification).
  // Subscribe immediately with skipInitialFetch=true so we don't race with the alarm
  // starting (the old 1.5s delay meant cancellations during that window were missed).
  // The Realtime channel fires for any UPDATE after subscription — no initial fetch needed
  // because the App-level subscribeToIncomingBuzzes and FCM handlers also cover the
  // already-cancelled case.
  useEffect(() => {
    const unsub = subscribeToBuzz(payload.buzz_id, (buzz: Buzz) => {
      if (buzz.response !== 'none') {
        stopAllAlarms();
        NativeModules.BuzzerService?.cancelBuzzNotification?.(payload.buzz_id);
        cancelBuzzNotification(payload.buzz_id);
        onDismiss();
      }
    }, true);
    return () => { unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.buzz_id, onDismiss]);

  // Android: Trigger native alarm immediately when this screen mounts.
  // The BuzzerService poll may not have detected the buzz yet (up to 10s delay),
  // so we explicitly call showBuzz to start the alarm right away.
  // seenBuzzIds dedup in the native service prevents double-processing.
  useEffect(() => {
    if (Platform.OS === 'android') {
      NativeModules.BuzzerService?.showBuzz?.(
        payload.buzz_id,
        payload.from_user_id || '',
        payload.from_user_name || 'User',
        payload.reason || '',
        payload.note || null,
        payload.sound_id || 'buzz_alarm',
      ).catch(() => {});
      // Cancel the native notification after a short delay — this full-screen
      // UI is already handling the buzz, so the notification in the shade is
      // redundant and causes "duplicate" perception.
      const cancelTimer = setTimeout(() => {
        NativeModules.BuzzerService?.cancelBuzzNotification?.(payload.buzz_id);
        cancelBuzzNotification(payload.buzz_id).catch(() => {});
      }, 1500);
      return () => { clearTimeout(cancelTimer); stopAllAlarms(); };
    }
    return () => {
      stopAllAlarms();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-dismiss after 2 minutes if no response
  useEffect(() => {
    const timeout = setTimeout(() => {
      stopAllAlarms();
      NativeModules.BuzzerService?.cancelBuzzNotification?.(payload.buzz_id);
      respondToBuzz(payload.buzz_id, 'dismissed').catch(() => {});
      cancelBuzzNotification(payload.buzz_id).catch(() => {});
      onDismiss();
    }, NO_RESPONSE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload.buzz_id, onDismiss]);

  const handleResponse = (response: BuzzResponse) => {
    stopAllAlarms();
    NativeModules.BuzzerService?.cancelBuzzNotification?.(payload.buzz_id);
    // Dismiss immediately — don't block on network. The response is sent
    // in the background. If it fails, the buzz auto-dismisses server-side
    // after 2 minutes anyway.
    respondToBuzz(payload.buzz_id, response).catch(() => {});
    cancelBuzzNotification(payload.buzz_id).catch(() => {});
    onDismiss();
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.avatarLarge}>
          <Text style={styles.avatarText}>
            {payload.from_user_name.charAt(0).toUpperCase()}
          </Text>
        </View>

        <Text style={styles.fromName}>{payload.from_user_name}</Text>
        <Text style={styles.reason}>{payload.reason}</Text>
        {!!payload.note && payload.note !== 'null' && <Text style={styles.note}>{payload.note}</Text>}
      </View>

      <View style={[styles.buttons, {paddingBottom: insets.bottom + 20}]}>
        <TouchableOpacity
          style={[styles.responseBtn, styles.ackBtn]}
          onPress={() => handleResponse('ack')}
          activeOpacity={0.8}>
          <Text style={styles.responseBtnText}>Ack</Text>
          <Text style={styles.responseBtnSub}>Coming</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.responseBtn, styles.fiveMinBtn]}
          onPress={() => handleResponse('five_min')}
          activeOpacity={0.8}>
          <Text style={styles.responseBtnText}>5 min</Text>
          <Text style={styles.responseBtnSub}>Need a moment</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.responseBtn, styles.busyBtn]}
          onPress={() => handleResponse('busy')}
          activeOpacity={0.8}>
          <Text style={styles.responseBtnText}>Busy</Text>
          <Text style={styles.responseBtnSub}>Can't come now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#0D0D0D',
    justifyContent: 'space-between',
    zIndex: 999,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  avatarLarge: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#FF4D4D',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  avatarText: {
    color: '#fff',
    fontSize: 44,
    fontWeight: '800',
  },
  fromName: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '800',
    marginBottom: 12,
  },
  reason: {
    color: '#FF4D4D',
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  note: {
    color: '#999',
    fontSize: 18,
    textAlign: 'center',
  },
  buttons: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 12,
  },
  responseBtn: {
    paddingVertical: 20,
    borderRadius: 16,
    alignItems: 'center',
  },
  ackBtn: {
    backgroundColor: '#4CAF50',
  },
  fiveMinBtn: {
    backgroundColor: '#FF9800',
  },
  busyBtn: {
    backgroundColor: '#F44336',
  },
  responseBtnText: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
  },
  responseBtnSub: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 18,
    marginTop: 2,
  },
});

export default IncomingBuzzScreen;
