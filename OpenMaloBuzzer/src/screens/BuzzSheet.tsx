import React, {useState, useEffect, useRef} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Linking,
  Vibration,
  ScrollView,
  Modal,
  Alert,
  Platform,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import Sound from 'react-native-sound';
import {User, Buzz, BuzzResponse} from '../types';
import {useReasons} from '../hooks/useReasons';
import {useUsers} from '../hooks/useUsers';
import {createBuzz, subscribeToBuzz, markEscalated, respondToBuzz} from '../services/firebase';
import {supabase} from '../services/supabase';
import {sendBuzzPush, sendBuzzCancelledPush, sendEscalationPush} from '../services/pushNotification';
import {BUZZ_SOUNDS} from '../services/soundPreference';
import {
  MAX_NOTE_LENGTH,
  REBUZZ_TIMEOUT_MS,
  NO_RESPONSE_TIMEOUT_MS,
} from '../constants';

interface Props {
  sender: User;
  receiver: User;
  onClose: () => void;
  initialReason?: string;
  autoSend?: boolean;
  initialSound?: string;
}

type BuzzState = 'select' | 'sent';

interface ActiveBuzzEntry {
  id: string;
  receiver: User;
  response: BuzzResponse;
  startTime: number;
  rebuzzSent: boolean;
}

const RESPONSE_CONFIG: Record<BuzzResponse, {label: string; color: string; icon: string}> = {
  ack: {label: 'Coming', color: '#4CAF50', icon: 'check-circle'},
  five_min: {label: '5 min', color: '#FF9800', icon: 'timer'},
  busy: {label: 'Busy', color: '#F44336', icon: 'cancel'},
  cancelled: {label: 'Cancelled', color: '#888', icon: 'block'},
  dismissed: {label: 'Not responded', color: '#FF9800', icon: 'warning'},
  none: {label: 'Waiting...', color: '#555', icon: 'hourglass-empty'},
};

const ADD_BUZZ_DELAY_MS = 10000;
// Re-send push every 10s — iOS cuts notification sound at ~10-12s.
// Each re-push restarts the sound → continuous ringing until response.
const REPUSH_INTERVAL_MS = 10000;

const BuzzSheet: React.FC<Props> = ({sender, receiver, onClose, initialReason, autoSend, initialSound}) => {
  const insets = useSafeAreaInsets();
  const reasons = useReasons();
  const {users, isOnline} = useUsers(sender.id);
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [isOther, setIsOther] = useState(false);
  const [customReason, setCustomReason] = useState('');
  const initialReasonApplied = useRef(false);

  useEffect(() => {
    if (!initialReason || initialReasonApplied.current || reasons.length === 0) return;
    initialReasonApplied.current = true;
    const match = reasons.find(r => r.label === initialReason);
    if (match) {
      setSelectedReason(match.label);
    } else {
      setIsOther(true);
      setCustomReason(initialReason);
    }
  }, [initialReason, reasons]);

  const [note, setNote] = useState('');
  const [selectedSound, setSelectedSound] = useState<string>(initialSound || 'buzz_alarm');
  const previewSoundRef = useRef<Sound | null>(null);

  const [playingPreview, setPlayingPreview] = useState<string | null>(null);

  const stopPreview = () => {
    if (previewSoundRef.current) {
      previewSoundRef.current.stop();
      previewSoundRef.current.release();
      previewSoundRef.current = null;
    }
    setPlayingPreview(null);
  };

  const previewSound = (soundId: string) => {
    // Tap same sound again → stop (toggle)
    if (playingPreview === soundId && previewSoundRef.current) {
      stopPreview();
      return;
    }
    stopPreview();
    const soundOption = BUZZ_SOUNDS.find(s => s.id === soundId);
    if (!soundOption) return;
    const s = new Sound(soundOption.file, Sound.MAIN_BUNDLE, (err) => {
      if (err) return;
      s.setVolume(1.0);
      s.play(() => { s.release(); if (previewSoundRef.current === s) { previewSoundRef.current = null; setPlayingPreview(null); } });
    });
    previewSoundRef.current = s;
    setPlayingPreview(soundId);
  };

  // Cleanup preview on unmount
  useEffect(() => {
    return () => { stopPreview(); };
  }, []);

  const [buzzState, setBuzzState] = useState<BuzzState>('select');
  const [activeBuzzes, setActiveBuzzes] = useState<ActiveBuzzEntry[]>([]);
  const [showUserPicker, setShowUserPicker] = useState(false);
  const [sending, setSending] = useState(false);
  const [tick, setTick] = useState(0);
  const sentReasonRef = useRef('');
  const sentNoteRef = useRef<string | null>(null);
  const sentSoundRef = useRef('buzz_alarm');
  const unsubsRef = useRef<Record<string, () => void>>({});

  const autoSendDone = useRef(false);
  const receiverRef = useRef(receiver);
  receiverRef.current = receiver;
  useEffect(() => {
    if (!autoSend || !initialReason || autoSendDone.current || buzzState !== 'select') return;
    autoSendDone.current = true;
    sendBuzzToUser(receiverRef.current, initialReason, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSend, initialReason, buzzState]);

  // Tick timer for elapsed updates
  useEffect(() => {
    if (buzzState !== 'sent' || activeBuzzes.length === 0) return;
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [buzzState, activeBuzzes.length]);

  // Polling fallback: Supabase Realtime may drop the websocket on mobile/emulators.
  // Poll every 3s to catch responses Realtime missed.
  const activeBuzzesRef = useRef(activeBuzzes);
  activeBuzzesRef.current = activeBuzzes;
  useEffect(() => {
    if (buzzState !== 'sent') return;
    const poll = setInterval(() => {
      const waiting = activeBuzzesRef.current.filter(b => b.response === 'none');
      if (waiting.length === 0) return;
      supabase.from('buzzes').select('id,response').in('id', waiting.map(b => b.id)).then(({data}) => {
        if (!data) return;
        const updates = data.filter((b: any) => b.response !== 'none');
        if (updates.length > 0) {
          setActiveBuzzes(prev =>
            prev.map(b => {
              const match = updates.find((u: any) => u.id === b.id);
              return match ? {...b, response: match.response} : b;
            }),
          );
        }
      });
    }, 3000);
    return () => clearInterval(poll);
  }, [buzzState]);

  // Re-push: re-send push every 10s for unanswered buzzes so iOS
  // notification sound keeps playing (iOS cuts sound at ~10-12s).
  useEffect(() => {
    if (buzzState !== 'sent') return;
    const repush = setInterval(() => {
      const waiting = activeBuzzesRef.current.filter(b => b.response === 'none');
      if (waiting.length === 0) return;
      waiting.forEach(b => {
        sendBuzzPush(
          b.receiver.id, b.id, sender.id, sender.name,
          sentReasonRef.current, sentNoteRef.current,
          sentSoundRef.current,
        ).catch(() => {});
      });
    }, REPUSH_INTERVAL_MS);
    return () => clearInterval(repush);
  }, [buzzState, sender.id, sender.name]);

  // Per-buzz escalation
  useEffect(() => {
    if (buzzState !== 'sent') return;
    const now = Date.now();
    const toEscalate: string[] = [];

    activeBuzzes.forEach(buzz => {
      if (buzz.response !== 'none' || buzz.rebuzzSent) return;
      const elapsed = now - buzz.startTime;
      if (elapsed >= REBUZZ_TIMEOUT_MS) {
        toEscalate.push(buzz.id);
        markEscalated(buzz.id);
        sendEscalationPush(buzz.receiver.id, buzz.id, sender.id, sender.name, sentReasonRef.current, sentNoteRef.current, sentSoundRef.current).catch(() => {});
      }
    });

    if (toEscalate.length > 0) {
      Vibration.vibrate([0, 300, 100, 300]);
      setActiveBuzzes(prev => prev.map(b =>
        toEscalate.includes(b.id) ? {...b, rebuzzSent: true} : b,
      ));
    }
  }, [tick]);

  // Cleanup
  useEffect(() => {
    return () => {
      Object.values(unsubsRef.current).forEach(unsub => unsub());
    };
  }, []);

  // Auto-close when all responded (but not if picker is open)
  const allResponded = activeBuzzes.length > 0 && activeBuzzes.every(b => b.response !== 'none');
  useEffect(() => {
    if (!allResponded || showUserPicker) return;
    const timeout = setTimeout(() => onClose(), 3000);
    return () => clearTimeout(timeout);
  }, [allResponded, showUserPicker]);

  const checkInactiveAndSend = (targetUser: User, reason: string, buzzNote: string | null) => {
    const offlineMs = Date.now() - (targetUser.last_seen_at || 0);
    const INACTIVE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
    if (offlineMs > INACTIVE_THRESHOLD_MS) {
      const days = Math.floor(offlineMs / (24 * 60 * 60 * 1000));
      const label = days >= 1 ? `${days} day${days > 1 ? 's' : ''}` : 'over 24 hours';
      Alert.alert(
        'User Inactive',
        `${targetUser.name} has been offline for ${label}. The buzz may not be delivered. Send anyway?`,
        [
          {text: 'Cancel', style: 'cancel'},
          {text: 'Send Anyway', onPress: () => sendBuzzToUser(targetUser, reason, buzzNote)},
        ],
      );
    } else {
      sendBuzzToUser(targetUser, reason, buzzNote);
    }
  };

  const sendBuzzToUser = async (targetUser: User, reason: string, buzzNote: string | null) => {
    if (sending) return;
    stopPreview();
    setSending(true);

    // Network check — quick ping to verify connectivity before sending
    try {
      const {supabase} = require('../services/supabase');
      const {error} = await supabase.from('users').select('id').limit(1);
      if (error) throw error;
    } catch {
      setSending(false);
      Alert.alert('No Internet', 'Please check your internet connection and try again.');
      return;
    }

    sentReasonRef.current = reason;
    sentNoteRef.current = buzzNote;
    sentSoundRef.current = selectedSound;

    const buzzData: Omit<Buzz, 'id'> = {
      from_user_id: sender.id,
      from_user_name: sender.name,
      to_user_id: targetUser.id,
      reason,
      note: buzzNote,
      sound_id: selectedSound,
      created_at: Date.now(),
      responded_at: null,
      response: 'none',
      escalated: false,
    };

    const t1 = Date.now();
    console.log(`[T1] Buzz send initiated at ${t1}`);
    let doc;
    try {
      doc = await createBuzz(buzzData);
    } catch (err: any) {
      setSending(false);
      Alert.alert('Buzz Failed', err?.message || 'Could not send buzz. Check your internet connection and try again.');
      return;
    }
    setSending(false);
    console.log(`[T2] Buzz created: ${doc.id} at ${Date.now()} (+${Date.now() - t1}ms)`);

    // Send FCM push via Supabase Edge Function (for killed/background state)
    sendBuzzPush(targetUser.id, doc.id, sender.id, sender.name, reason, buzzNote, selectedSound)
      .then(pushResult => console.log(`[T4] FCM push result for ${doc.id}: ${pushResult} at ${Date.now()} (+${Date.now() - t1}ms)`))
      .catch(() => {});

    const newEntry: ActiveBuzzEntry = {
      id: doc.id,
      receiver: targetUser,
      response: 'none',
      startTime: Date.now(),
      rebuzzSent: false,
    };

    setActiveBuzzes(prev => [...prev, newEntry]);
    setBuzzState('sent');

    // Short vibration only — no sound. Playing buzz_alarm.wav here caused
    // the sender to play the same alarm as the receiver, sounding like a
    // duplicate when both devices are in the same room.
    Vibration.vibrate(200);

    const unsub = subscribeToBuzz(doc.id, (buzz: Buzz) => {
      if (buzz.response !== 'none') {
        setActiveBuzzes(prev =>
          prev.map(b => (b.id === doc.id ? {...b, response: buzz.response} : b)),
        );
      }
    });
    unsubsRef.current[doc.id] = unsub;
  };

  const sendBuzz = () => {
    const reason = isOther ? customReason.trim() : selectedReason;
    if (!reason) return;
    checkInactiveAndSend(receiver, reason, note.trim() || null);
  };

  const handleCancelAll = async () => {
    Object.values(unsubsRef.current).forEach(unsub => unsub());
    unsubsRef.current = {};
    for (const buzz of activeBuzzes) {
      if (buzz.response === 'none') {
        await respondToBuzz(buzz.id, 'cancelled');
        sendBuzzCancelledPush(buzz.receiver.id, buzz.id, sender.name).catch(() => {});
      }
    }
    onClose();
  };

  const handleAddUser = (targetUser: User) => {
    setShowUserPicker(false);
    checkInactiveAndSend(targetUser, sentReasonRef.current, sentNoteRef.current);
  };

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  const buzzedUserIds = activeBuzzes.map(b => b.receiver.id);
  const availableUsers = users.filter(
    u => u.id !== sender.id && !buzzedUserIds.includes(u.id),
  );
  const firstBuzzElapsed = activeBuzzes.length > 0 ? Date.now() - activeBuzzes[0].startTime : 0;
  const hasWaitingBuzzes = activeBuzzes.some(b => b.response === 'none');
  const showAddButton =
    buzzState === 'sent' &&
    hasWaitingBuzzes &&
    firstBuzzElapsed >= ADD_BUZZ_DELAY_MS &&
    (sender.role === 'owner' || sender.role === 'manager');

  if (buzzState === 'select') {
    return (
      <View style={[styles.container, {paddingBottom: insets.bottom}]}>
        <View style={[styles.header, {paddingTop: insets.top + 12}]}>
          <TouchableOpacity onPress={onClose}><Icon name="close" size={24} color="#888" /></TouchableOpacity>
          <Text style={styles.headerTitle}>Buzz {receiver.name}</Text>
          <View style={{width: 32}} />
        </View>
        <Text style={styles.label}>Select reason</Text>
        <View style={styles.chipsContainer}>
          {reasons.map(r => (
            <TouchableOpacity key={r.id} style={[styles.chip, !isOther && selectedReason === r.label && styles.chipSelected]} onPress={() => { setSelectedReason(r.label); setIsOther(false); }}>
              <Text style={[styles.chipText, !isOther && selectedReason === r.label && styles.chipTextSelected]}>{r.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={[styles.chip, isOther && styles.chipSelected]} onPress={() => { setIsOther(true); setSelectedReason(null); }}>
            <Text style={[styles.chipText, isOther && styles.chipTextSelected]}>Other</Text>
          </TouchableOpacity>
        </View>
        {isOther && (
          <TextInput
            style={styles.noteInput}
            placeholder="Enter custom reason"
            placeholderTextColor="#666"
            value={customReason}
            onChangeText={setCustomReason}
            maxLength={50}
            autoFocus
          />
        )}
        <TextInput
          style={styles.noteInput}
          placeholder="Optional note (40 chars)"
          placeholderTextColor="#666"
          value={note}
          onChangeText={setNote}
          maxLength={MAX_NOTE_LENGTH}
        />
        <Text style={styles.label}>Sound</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.soundScroll} contentContainerStyle={styles.soundScrollContent}>
          {BUZZ_SOUNDS.map(s => (
            <TouchableOpacity key={s.id} style={[styles.soundChip, selectedSound === s.id && styles.soundChipSelected]} onPress={() => { setSelectedSound(s.id); previewSound(s.id); }}>
              <Icon name={s.icon} size={18} color={selectedSound === s.id ? s.color : '#888'} />
              <Text style={[styles.soundChipText, selectedSound === s.id && {color: s.color}]}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity
          style={[styles.buzzButton, (sending || !(isOther ? customReason.trim() : selectedReason)) && styles.buzzButtonDisabled]}
          onPress={sendBuzz}
          disabled={sending || !(isOther ? customReason.trim() : selectedReason)}
          activeOpacity={0.8}>
          <Text style={styles.buzzButtonText}>{sending ? 'SENDING...' : 'BUZZ'}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Sent state - multi-buzz tracking
  const respondedCount = activeBuzzes.filter(b => b.response !== 'none').length;

  return (
    <View style={[styles.container, {paddingBottom: insets.bottom}]}>
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <TouchableOpacity onPress={handleCancelAll}><Icon name="close" size={24} color="#888" /></TouchableOpacity>
        <Text style={styles.headerTitle}>
          {activeBuzzes.length === 1 ? `Buzzing ${activeBuzzes[0].receiver.name}` : `Buzzing ${activeBuzzes.length} people`}
        </Text>
        <View style={{width: 32}} />
      </View>

      <Text style={styles.sentReason}>{sentReasonRef.current}</Text>

      {activeBuzzes.length > 1 && (
        <Text style={styles.statusSummary}>
          {respondedCount}/{activeBuzzes.length} responded
        </Text>
      )}

      <ScrollView style={{flex: 1}} contentContainerStyle={{paddingBottom: 16}}>
        {activeBuzzes.map(buzz => {
          const elapsed = Date.now() - buzz.startTime;
          const config = RESPONSE_CONFIG[buzz.response];
          const isWaiting = buzz.response === 'none';
          const isTimedOut = isWaiting && elapsed >= NO_RESPONSE_TIMEOUT_MS;

          return (
            <View key={buzz.id} style={styles.buzzRow}>
              <View style={[styles.buzzAvatar, {borderColor: isWaiting ? (isTimedOut ? '#FF9800' : '#FF4D4D') : config.color}]}>
                <Text style={styles.buzzAvatarText}>{buzz.receiver.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.buzzInfo}>
                <Text style={styles.buzzName}>{buzz.receiver.name}</Text>
                <View style={[styles.buzzBadge, {backgroundColor: (isTimedOut ? '#FF9800' : config.color) + '20', borderColor: (isTimedOut ? '#FF9800' : config.color) + '40'}]}>
                  <Icon name={isTimedOut ? 'warning' : isWaiting ? 'notifications-active' : config.icon} size={14} color={isTimedOut ? '#FF9800' : config.color} />
                  <Text style={[styles.buzzBadgeText, {color: isTimedOut ? '#FF9800' : config.color}]}>
                    {isTimedOut ? 'No response' : isWaiting ? 'Waiting...' : config.label}
                  </Text>
                </View>
                {buzz.rebuzzSent && isWaiting && !isTimedOut && (
                  <Text style={styles.escalatedText}>Escalated</Text>
                )}
              </View>
              <View style={styles.buzzRight}>
                <Text style={styles.buzzElapsed}>{formatTime(elapsed)}</Text>
                {isTimedOut && (
                  <TouchableOpacity onPress={() => Linking.openURL(`tel:${buzz.receiver.phone}`)} style={styles.callIcon}>
                    <Icon name="call" size={18} color="#4CAF50" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        })}

        {showAddButton && (
          <TouchableOpacity style={styles.addBuzzBtn} onPress={() => setShowUserPicker(true)} activeOpacity={0.7}>
            <Icon name="add-circle" size={24} color="#64B5F6" />
            <Text style={styles.addBuzzBtnText}>Add another person</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {allResponded ? (
        <TouchableOpacity style={styles.doneButton} onPress={onClose}>
          <Text style={styles.doneButtonText}>Done</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.endButton} onPress={handleCancelAll} activeOpacity={0.8}>
          <Text style={styles.endButtonText}>End</Text>
        </TouchableOpacity>
      )}

      <Modal visible={showUserPicker} transparent animationType="slide" onRequestClose={() => setShowUserPicker(false)}>
        <View style={styles.pickerOverlay}>
          <View style={[styles.pickerSheet, {paddingBottom: insets.bottom + 16}]}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Add person to buzz</Text>
              <TouchableOpacity onPress={() => setShowUserPicker(false)}>
                <Icon name="close" size={24} color="#888" />
              </TouchableOpacity>
            </View>
            <Text style={styles.pickerReason}>Reason: {sentReasonRef.current}</Text>
            <ScrollView>
              {availableUsers.map(u => {
                const online = isOnline(u);
                return (
                  <TouchableOpacity key={u.id} style={styles.pickerUser} onPress={() => handleAddUser(u)} activeOpacity={0.7}>
                    <View style={styles.pickerAvatar}>
                      <Text style={styles.pickerAvatarText}>{u.name.charAt(0).toUpperCase()}</Text>
                      <View style={[styles.pickerDot, !online && styles.pickerDotOff]} />
                    </View>
                    <View style={styles.pickerInfo}>
                      <Text style={styles.pickerName}>{u.name}</Text>
                      <Text style={styles.pickerRole}>{u.role}{!online ? ' · Offline' : ''}</Text>
                    </View>
                    <Icon name="notifications" size={20} color="#FF4D4D" />
                  </TouchableOpacity>
                );
              })}
              {availableUsers.length === 0 && (
                <Text style={styles.pickerEmpty}>No other users available</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0D0D0D', paddingHorizontal: 20},
  header: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 16},
  headerTitle: {color: '#fff', fontSize: 22, fontWeight: '700'},
  label: {color: '#888', fontSize: 14, fontWeight: '600', marginBottom: 12, marginTop: 8},
  chipsContainer: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  chip: {backgroundColor: '#1A1A1A', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: '#333'},
  chipSelected: {backgroundColor: '#3a1515', borderColor: '#FF4D4D'},
  chipText: {color: '#ccc', fontSize: 16},
  chipTextSelected: {color: '#FF4D4D', fontWeight: '600'},
  noteInput: {backgroundColor: '#1A1A1A', color: '#fff', fontSize: 18, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 10, marginTop: 16, borderWidth: 1, borderColor: '#333'},
  soundScroll: {maxHeight: 48, marginBottom: 4},
  soundScrollContent: {gap: 8},
  soundChip: {flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1A1A1A', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: '#333'},
  soundChipSelected: {backgroundColor: '#1a1a2a', borderColor: '#64B5F6'},
  soundChipText: {color: '#888', fontSize: 14, fontWeight: '600'},
  buzzButton: {backgroundColor: '#4CAF50', paddingVertical: 20, borderRadius: 14, alignItems: 'center', marginTop: 24},
  buzzButtonDisabled: {opacity: 0.4},
  buzzButtonText: {color: '#fff', fontSize: 24, fontWeight: '900', letterSpacing: 2},

  sentReason: {color: '#FF4D4D', fontSize: 18, fontWeight: '600', textAlign: 'center', marginBottom: 8},
  statusSummary: {color: '#888', fontSize: 14, fontWeight: '600', textAlign: 'center', marginBottom: 12},

  buzzRow: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A1A', borderRadius: 12, padding: 14, marginBottom: 8},
  buzzAvatar: {width: 48, height: 48, borderRadius: 24, backgroundColor: '#252525', alignItems: 'center', justifyContent: 'center', marginRight: 12, borderWidth: 2},
  buzzAvatarText: {color: '#fff', fontSize: 20, fontWeight: '700'},
  buzzInfo: {flex: 1},
  buzzName: {color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 4},
  buzzBadge: {flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, gap: 4},
  buzzBadgeText: {fontSize: 13, fontWeight: '700'},
  buzzRight: {alignItems: 'flex-end', gap: 6},
  buzzElapsed: {color: '#999', fontSize: 14, fontWeight: '600'},
  escalatedText: {color: '#FF9800', fontSize: 12, fontWeight: '600', marginTop: 2},
  callIcon: {width: 32, height: 32, borderRadius: 16, backgroundColor: '#1a3a1a', alignItems: 'center', justifyContent: 'center'},

  addBuzzBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#1A1A1A', borderRadius: 12, padding: 16, marginTop: 8, borderWidth: 1, borderColor: '#333', borderStyle: 'dashed'},
  addBuzzBtnText: {color: '#64B5F6', fontSize: 15, fontWeight: '700'},

  endButton: {backgroundColor: '#F44336', paddingVertical: 18, borderRadius: 14, alignItems: 'center', marginBottom: 32},
  endButtonText: {color: '#fff', fontSize: 19, fontWeight: '800'},
  doneButton: {backgroundColor: '#1A1A1A', paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginBottom: 32},
  doneButtonText: {color: '#ccc', fontSize: 18, fontWeight: '600'},

  pickerOverlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end'},
  pickerSheet: {backgroundColor: '#1A1A1A', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingHorizontal: 20, maxHeight: '60%'},
  pickerHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4},
  pickerTitle: {color: '#fff', fontSize: 20, fontWeight: '800'},
  pickerReason: {color: '#FF4D4D', fontSize: 14, fontWeight: '600', marginBottom: 16},
  pickerUser: {flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#252525'},
  pickerAvatar: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#252525', alignItems: 'center', justifyContent: 'center', marginRight: 12},
  pickerAvatarText: {color: '#fff', fontSize: 18, fontWeight: '700'},
  pickerDot: {position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, backgroundColor: '#4CAF50', borderWidth: 2, borderColor: '#1A1A1A'},
  pickerDotOff: {backgroundColor: '#444'},
  pickerInfo: {flex: 1},
  pickerName: {color: '#fff', fontSize: 16, fontWeight: '600'},
  pickerRole: {color: '#999', fontSize: 13, textTransform: 'capitalize'},
  pickerEmpty: {color: '#666', fontSize: 15, textAlign: 'center', paddingVertical: 24},
});

export default BuzzSheet;
