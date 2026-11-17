import AsyncStorage from '@react-native-async-storage/async-storage';
import {Platform, NativeModules} from 'react-native';

const STORAGE_KEY = '@buzzer_sound';

export interface BuzzSoundOption {
  id: string;
  label: string;
  file: string;
  icon: string; // MaterialIcons name
  color: string;
}

export const BUZZ_SOUNDS: BuzzSoundOption[] = [
  {id: 'buzz_alarm', label: 'Classic', file: 'buzz_alarm.wav', icon: 'notifications-active', color: '#FF4D4D'},
  {id: 'buzz_alarm_2', label: 'Urgent', file: 'buzz_alarm_2.wav', icon: 'warning', color: '#FF9800'},
  {id: 'buzz_alarm_3', label: 'Siren', file: 'buzz_alarm_3.wav', icon: 'campaign', color: '#E91E63'},
  {id: 'buzz_alarm_4', label: 'Radar', file: 'buzz_alarm_4.wav', icon: 'radar', color: '#2196F3'},
  {id: 'buzz_alarm_5', label: 'Chime', file: 'buzz_alarm_5.wav', icon: 'music-note', color: '#4CAF50'},
  {id: 'buzz_alarm_6', label: 'Emergency', file: 'buzz_alarm_6.wav', icon: 'error', color: '#F44336'},
  {id: 'buzz_alarm_7', label: 'Doorbell', file: 'buzz_alarm_7.wav', icon: 'doorbell', color: '#9C27B0'},
  {id: 'buzz_alarm_8', label: 'Alarm Clock', file: 'buzz_alarm_8.wav', icon: 'alarm', color: '#00BCD4'},
  {id: 'buzz_alarm_9', label: 'Sonar', file: 'buzz_alarm_9.wav', icon: 'waves', color: '#607D8B'},
  {id: 'buzz_alarm_10', label: 'Whistle', file: 'buzz_alarm_10.wav', icon: 'air', color: '#8BC34A'},
];

export async function getSelectedSound(): Promise<string> {
  const val = await AsyncStorage.getItem(STORAGE_KEY);
  return val || 'buzz_alarm';
}

export async function setSelectedSound(soundId: string): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, soundId);
  if (Platform.OS === 'android') {
    NativeModules.BuzzerService?.setBuzzSound?.(soundId);
  }
}
