import React, {useState, useEffect, useRef} from 'react';
import {View, Text, TextInput, TouchableOpacity, StyleSheet, Vibration, ActivityIndicator, ScrollView, Alert} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {User, Group, Buzz, BuzzResponse} from '../types';
import {useReasons} from '../hooks/useReasons';
import {createGroupBuzz, subscribeToBuzz, subscribeToUsers, respondToBuzz} from '../services/firebase';
import {sendBuzzPush, sendBuzzCancelledPush} from '../services/pushNotification';
import {BUZZ_SOUNDS} from '../services/soundPreference';
import {MAX_NOTE_LENGTH} from '../constants';

interface Props {
  sender: User;
  group: Group;
  onClose: () => void;
}

const RESPONSE_CONFIG: Record<BuzzResponse, {label: string; color: string; icon: string}> = {
  ack: {label: 'Coming', color: '#4CAF50', icon: 'check-circle'},
  five_min: {label: '5 min', color: '#FF9800', icon: 'timer'},
  busy: {label: 'Busy', color: '#F44336', icon: 'cancel'},
  cancelled: {label: 'Cancelled', color: '#888', icon: 'block'},
  dismissed: {label: 'Not responded', color: '#FF9800', icon: 'warning'},
  none: {label: 'Waiting...', color: '#555', icon: 'hourglass-empty'},
};

const GroupBuzzSheet: React.FC<Props> = ({sender, group, onClose}) => {
  const insets = useSafeAreaInsets();
  const reasons = useReasons();
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [isOther, setIsOther] = useState(false);
  const [customReason, setCustomReason] = useState('');
  const [note, setNote] = useState('');
  const [selectedSound, setSelectedSound] = useState<string>('buzz_alarm');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [responses, setResponses] = useState<Record<string, BuzzResponse>>({});
  const [usersMap, setUsersMap] = useState<Record<string, string>>({});
  const unsubsRef = useRef<(() => void)[]>([]);
  const buzzIdsRef = useRef<string[]>([]);
  const buzzToMemberRef = useRef<Record<string, string>>({});

  const memberIds = group.member_ids.filter(id => id !== sender.id);

  useEffect(() => {
    const unsub = subscribeToUsers(users => {
      const map: Record<string, string> = {};
      users.forEach(u => { map[u.id] = u.name; });
      setUsersMap(map);
    });
    return () => {
      unsub();
      unsubsRef.current.forEach(u => u());
    };
  }, []);

  const handleSend = async () => {
    const reason = isOther ? customReason.trim() : selectedReason;
    if (!reason) return;

    setSending(true);
    let docs;
    try {
      docs = await createGroupBuzz(sender.id, sender.name, memberIds, reason, note.trim() || null, group.id, group.name, selectedSound);
    } catch (err: any) {
      setSending(false);
      Alert.alert('Buzz Failed', 'Could not send group buzz. Check your internet connection and try again.');
      return;
    }
    buzzIdsRef.current = docs.map(d => d.id);
    const mapping: Record<string, string> = {};
    docs.forEach((doc, index) => { mapping[doc.id] = memberIds[index]; });
    buzzToMemberRef.current = mapping;
    Vibration.vibrate(200);
    setSending(false);
    setSent(true);

    // Send FCM push to each member via Supabase Edge Function
    docs.forEach((doc, index) => {
      const memberId = memberIds[index];
      sendBuzzPush(memberId, doc.id, sender.id, sender.name, reason, note.trim() || null, selectedSound).catch(() => {});
    });

    // Initialize all responses as 'none'
    const initial: Record<string, BuzzResponse> = {};
    memberIds.forEach(id => { initial[id] = 'none'; });
    setResponses(initial);

    // Subscribe to each buzz for real-time response tracking
    docs.forEach((doc, index) => {
      const memberId = memberIds[index];
      const unsub = subscribeToBuzz(doc.id, (buzz: Buzz) => {
        if (buzz.response !== 'none') {
          setResponses(prev => ({...prev, [memberId]: buzz.response}));
        }
      });
      unsubsRef.current.push(unsub);
    });
  };

  const handleCancelAll = async () => {
    unsubsRef.current.forEach(u => u());
    unsubsRef.current = [];
    for (const buzzId of buzzIdsRef.current) {
      const memberId = buzzToMemberRef.current[buzzId];
      if (memberId && responses[memberId] === 'none') {
        await respondToBuzz(buzzId, 'cancelled');
        sendBuzzCancelledPush(memberId, buzzId, sender.name).catch(() => {});
      }
    }
    onClose();
  };

  const respondedCount = Object.values(responses).filter(r => r !== 'none').length;
  const allResponded = respondedCount === memberIds.length && memberIds.length > 0;

  if (sent) {
    return (
      <View style={[styles.container, {paddingBottom: insets.bottom}]}>
        <View style={[styles.header, {paddingTop: insets.top + 12}]}>
          <View style={{width: 32}} />
          <Text style={styles.headerTitle}>{group.name}</Text>
          <TouchableOpacity onPress={allResponded ? onClose : handleCancelAll}><Icon name="close" size={24} color="#888" /></TouchableOpacity>
        </View>

        <Text style={styles.statusSummary}>
          {respondedCount}/{memberIds.length} responded
        </Text>

        <ScrollView style={styles.responseList} contentContainerStyle={{paddingBottom: 16}}>
          {memberIds.map(id => {
            const response = responses[id] || 'none';
            const config = RESPONSE_CONFIG[response];
            const name = usersMap[id] || '?';
            return (
              <View key={id} style={styles.memberRow}>
                <View style={[styles.memberAvatar, {borderColor: config.color}]}>
                  <Text style={styles.memberAvatarText}>{name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.memberInfo}>
                  <Text style={styles.memberName}>{name}</Text>
                  <View style={[styles.responseBadge, {backgroundColor: config.color + '20', borderColor: config.color + '40'}]}>
                    <Icon name={config.icon} size={14} color={config.color} />
                    <Text style={[styles.responseLabel, {color: config.color}]}>{config.label}</Text>
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>

        {allResponded ? (
          <TouchableOpacity style={styles.doneButton} onPress={onClose}>
            <Text style={styles.doneButtonText}>Done</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.endButton} onPress={handleCancelAll}>
            <Text style={styles.endButtonText}>End</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, {paddingBottom: insets.bottom}]}>
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <TouchableOpacity onPress={onClose}><Icon name="close" size={24} color="#888" /></TouchableOpacity>
        <Text style={styles.headerTitle}>Buzz {group.name}</Text>
        <View style={{width: 32}} />
      </View>
      <Text style={styles.memberCount}>{memberIds.length} members will be buzzed</Text>
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
        <TextInput style={styles.noteInput} placeholder="Enter custom reason" placeholderTextColor="#666" value={customReason} onChangeText={setCustomReason} maxLength={50} autoFocus />
      )}
      <TextInput style={styles.noteInput} placeholder="Optional note (40 chars)" placeholderTextColor="#666" value={note} onChangeText={setNote} maxLength={MAX_NOTE_LENGTH} />
      <Text style={styles.label}>Sound</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.soundScroll} contentContainerStyle={styles.soundScrollContent}>
        {BUZZ_SOUNDS.map(s => (
          <TouchableOpacity key={s.id} style={[styles.soundChip, selectedSound === s.id && styles.soundChipSelected]} onPress={() => setSelectedSound(s.id)}>
            <Icon name={s.icon} size={18} color={selectedSound === s.id ? s.color : '#888'} />
            <Text style={[styles.soundChipText, selectedSound === s.id && {color: s.color}]}>{s.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <TouchableOpacity
        style={[styles.buzzButton, (sending || !(isOther ? customReason.trim() : selectedReason)) && styles.buzzButtonDisabled]}
        onPress={handleSend}
        disabled={sending || !(isOther ? customReason.trim() : selectedReason)}
        activeOpacity={0.8}>
        {sending ? <ActivityIndicator color="#fff" /> : <Text style={styles.buzzButtonText}>BUZZ GROUP</Text>}
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0D0D0D', paddingHorizontal: 20},
  header: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 16},
  headerTitle: {color: '#fff', fontSize: 20, fontWeight: '700'},
  memberCount: {color: '#FF9800', fontSize: 14, fontWeight: '600', marginBottom: 16, textAlign: 'center'},
  label: {color: '#888', fontSize: 14, fontWeight: '600', marginBottom: 12, marginTop: 8},
  chipsContainer: {flexDirection: 'row', flexWrap: 'wrap', gap: 8},
  chip: {backgroundColor: '#1A1A1A', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5, borderColor: '#333'},
  chipSelected: {backgroundColor: '#3a1515', borderColor: '#FF4D4D'},
  chipText: {color: '#ccc', fontSize: 15},
  chipTextSelected: {color: '#FF4D4D', fontWeight: '600'},
  noteInput: {backgroundColor: '#1A1A1A', color: '#fff', fontSize: 18, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 10, marginTop: 16, borderWidth: 1, borderColor: '#333'},
  soundScroll: {maxHeight: 48, marginBottom: 4},
  soundScrollContent: {gap: 8},
  soundChip: {flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#1A1A1A', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5, borderColor: '#333'},
  soundChipSelected: {backgroundColor: '#1a1a2a', borderColor: '#64B5F6'},
  soundChipText: {color: '#888', fontSize: 14, fontWeight: '600'},
  buzzButton: {backgroundColor: '#4CAF50', paddingVertical: 20, borderRadius: 14, alignItems: 'center', marginTop: 24},
  buzzButtonDisabled: {opacity: 0.4},
  buzzButtonText: {color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: 2},
  statusSummary: {color: '#888', fontSize: 14, fontWeight: '600', textAlign: 'center', marginBottom: 16},
  responseList: {flex: 1},
  memberRow: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A1A', borderRadius: 12, padding: 14, marginBottom: 8},
  memberAvatar: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#252525', alignItems: 'center', justifyContent: 'center', marginRight: 12, borderWidth: 2},
  memberAvatarText: {color: '#fff', fontSize: 18, fontWeight: '700'},
  memberInfo: {flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  memberName: {color: '#fff', fontSize: 16, fontWeight: '600'},
  responseBadge: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, gap: 4},
  responseLabel: {fontSize: 13, fontWeight: '700'},
  doneButton: {backgroundColor: '#1A1A1A', paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 8},
  doneButtonText: {color: '#ccc', fontSize: 18, fontWeight: '600'},
  endButton: {backgroundColor: '#F44336', paddingVertical: 18, borderRadius: 14, alignItems: 'center', marginTop: 8},
  endButtonText: {color: '#fff', fontSize: 18, fontWeight: '800'},
});

export default GroupBuzzSheet;
