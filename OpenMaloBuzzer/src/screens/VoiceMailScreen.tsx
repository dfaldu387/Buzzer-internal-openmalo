import React, {useState, useEffect, useRef} from 'react';
import {View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, Platform, PermissionsAndroid, NativeModules, Alert, Modal} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Sound from 'react-native-sound';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {User, VoiceMail} from '../types';
import {subscribeToVoiceMails, markVoiceMailListened, deleteVoiceMail, addVoiceMail, subscribeToUsers} from '../services/firebase';
import {uploadVoiceMail} from '../services/supabase';
import {sendVoiceMailPush} from '../services/pushNotification';

Sound.setCategory('Playback');

interface Props {
  currentUser: User;
  targetUser?: User;
  onBack: () => void;
}

const VoiceMailScreen: React.FC<Props> = ({currentUser, targetUser, onBack}) => {
  const insets = useSafeAreaInsets();
  const isRecordMode = !!targetUser;
  const [mails, setMails] = useState<VoiceMail[]>([]);
  const [usersMap, setUsersMap] = useState<Record<string, string>>({});
  const [recording, setRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const [playing, setPlaying] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [recordedPath, setRecordedPath] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [deleteModal, setDeleteModal] = useState<VoiceMail | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteMultiModal, setDeleteMultiModal] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const soundRef = useRef<Sound | null>(null);

  useEffect(() => {
    const unsub1 = subscribeToVoiceMails(currentUser.id, setMails);
    const unsub2 = subscribeToUsers(users => {
      const map: Record<string, string> = {};
      users.forEach(u => { map[u.id] = u.name; });
      setUsersMap(map);
    });
    return () => {
      unsub1();
      unsub2();
      stopTimer();
      stopSound();
    };
  }, [currentUser.id]);

  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };

  const stopSound = () => {
    if (soundRef.current) {
      soundRef.current.stop();
      soundRef.current.release();
      soundRef.current = null;
    }
  };

  const requestPermission = async () => {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
  };

  // ─── RECORD ───
  const getRecorder = () => {
    if (Platform.OS === 'ios') {
      return NativeModules.AudioRecorderModule;
    }
    return NativeModules.BuzzerService;
  };

  const startRecording = async () => {
    const hasPermission = await requestPermission();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'Microphone permission is required.');
      return;
    }
    try {
      const recorder = getRecorder();
      if (!recorder) {
        Alert.alert('Error', 'Recording is not available on this device');
        return;
      }
      await recorder.startRecording();
      setRecording(true);
      setRecordedPath(null);
      setRecordTime(0);
      setSent(false);
      const start = Date.now();
      timerRef.current = setInterval(() => {
        setRecordTime(Math.floor((Date.now() - start) / 1000));
      }, 500);
    } catch (err: any) {
      Alert.alert('Recording Failed', err?.message || 'Could not start recording');
    }
  };

  const stopRecording = async () => {
    stopTimer();
    try {
      const recorder = getRecorder();
      const path = await recorder?.stopRecording();
      if (path) {
        setRecordedPath(path);
      } else {
        Alert.alert('Recording Failed', 'The recording could not be saved. Please try again.');
        setRecordedPath(null);
      }
    } catch (err: any) {
      console.warn('stopRecording error:', err);
      Alert.alert('Recording Failed', err?.message || 'Could not stop recording. Please try again.');
      setRecordedPath(null);
    }
    setRecording(false);
  };

  const discardRecording = () => {
    setRecordedPath(null);
    setRecordTime(0);
  };

  // ─── SEND ───
  const sendVoiceMail = async () => {
    if (!targetUser || !recordedPath) return;
    setSending(true);
    try {
      // Upload file to Supabase Storage → get public URL
      const fileName = `${currentUser.id}_${Date.now()}.m4a`;
      const publicUrl = await uploadVoiceMail(recordedPath, fileName);

      // Save metadata with URL to Supabase
      await addVoiceMail({
        from_user_id: currentUser.id,
        from_user_name: currentUser.name,
        to_user_id: targetUser.id,
        audio_url: publicUrl,
        duration_seconds: recordTime,
        created_at: Date.now(),
        listened: false,
      });

      // Send push notification to receiver
      sendVoiceMailPush(targetUser.id, currentUser.name, recordTime).catch(() => {});

      setRecordedPath(null);
      setRecordTime(0);
      setSent(true);
    } catch (err: any) {
      Alert.alert('Send Failed', err?.message || 'Could not send voice message');
    }
    setSending(false);
  };

  // ─── PLAY ───
  const playUrl = (url: string) => {
    return new Promise<void>((resolve) => {
      const s = new Sound(url, '', (err) => {
        if (err) {
          Alert.alert('Playback Error', `Could not load audio: ${JSON.stringify(err)}`);
          setPlaying(null);
          resolve();
          return;
        }
        s.setVolume(1.0);
        s.play((success) => {
          if (!success) {
            setPlaying(null);
          }
          s.release();
          soundRef.current = null;
          setPlaying(null);
          resolve();
        });
      });
      soundRef.current = s;
    });
  };

  const playVoiceMail = async (mail: VoiceMail) => {
    if (playing === mail.id) {
      stopSound();
      setPlaying(null);
      return;
    }
    stopSound();
    setPlaying(mail.id);
    if (!mail.listened) markVoiceMailListened(mail.id).catch(() => {});
    await playUrl(mail.audio_url);
  };

  const playPreview = async () => {
    if (!recordedPath) return;
    if (playing === 'preview') {
      stopSound();
      setPlaying(null);
      return;
    }
    stopSound();
    setPlaying('preview');
    // Play local file
    const s = new Sound(recordedPath, '', (err) => {
      if (err) { Alert.alert('Error', 'Could not play preview'); setPlaying(null); return; }
      s.setVolume(1.0);
      s.play(() => { s.release(); soundRef.current = null; setPlaying(null); });
    });
    soundRef.current = s;
  };

  // ─── FORMAT ───
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    if (isToday) return `Today ${time}`;
    return `${d.toLocaleDateString([], {month: 'short', day: 'numeric'})} ${time}`;
  };

  const handleDeleteMail = (mail: VoiceMail) => {
    setDeleteModal(mail);
  };

  const confirmDelete = async () => {
    if (!deleteModal) return;
    stopSound();
    setPlaying(null);
    const id = deleteModal.id;
    setDeleteModal(null);
    try {
      await deleteVoiceMail(id);
    } catch {
      Alert.alert('Error', 'Failed to delete voice message');
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === mails.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(mails.map(m => m.id)));
    }
  };

  const confirmDeleteMulti = async () => {
    stopSound();
    setPlaying(null);
    const ids = Array.from(selectedIds);
    setSelectedIds(new Set());
    setSelectMode(false);
    setDeleteMultiModal(false);
    try {
      await Promise.all(ids.map(id => deleteVoiceMail(id)));
    } catch {
      Alert.alert('Error', 'Some messages could not be deleted');
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  // ─── RENDER ───
  const renderMail = ({item}: {item: VoiceMail}) => {
    const isPlaying = playing === item.id;
    const isSelected = selectedIds.has(item.id);
    return (
      <TouchableOpacity
        style={[styles.mailRow, !item.listened && styles.mailRowUnread, selectMode && isSelected && styles.mailRowSelected]}
        onPress={() => selectMode ? toggleSelect(item.id) : playVoiceMail(item)}
        onLongPress={() => { if (!selectMode) { setSelectMode(true); toggleSelect(item.id); } }}
        activeOpacity={0.7}>
        {selectMode && (
          <View style={[styles.checkbox, isSelected && styles.checkboxSelected]}>
            {isSelected && <Icon name="check" size={14} color="#fff" />}
          </View>
        )}
        <View style={styles.mailAvatar}>
          <Text style={styles.mailAvatarText}>{(item.from_user_name || usersMap[item.from_user_id] || '?').charAt(0)}</Text>
        </View>
        <View style={styles.mailContent}>
          <Text style={styles.mailFrom}>{item.from_user_name || usersMap[item.from_user_id] || 'Unknown'}</Text>
          <Text style={styles.mailMeta}>{formatTime(item.duration_seconds)} · {formatDate(item.created_at)}</Text>
        </View>
        {!selectMode && (
          <>
            <View style={[styles.playBtn, isPlaying && styles.playBtnActive]}>
              <Icon name={isPlaying ? 'pause' : 'play-arrow'} size={18} color={isPlaying ? '#fff' : '#ccc'} />
            </View>
            <TouchableOpacity style={styles.deleteMailBtn} onPress={() => handleDeleteMail(item)}>
              <Icon name="delete-outline" size={18} color="#666" />
            </TouchableOpacity>
          </>
        )}
        {!item.listened && <View style={styles.unreadDot} />}
      </TouchableOpacity>
    );
  };

  const hasNativeRecorder = Platform.OS === 'ios' ? !!NativeModules.AudioRecorderModule : !!NativeModules.BuzzerService;

  return (
    <View style={styles.container}>
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <TouchableOpacity onPress={selectMode ? exitSelectMode : onBack}>
          <Text style={styles.backBtn}>{selectMode ? 'Cancel' : '← Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {selectMode ? `${selectedIds.size} selected` : isRecordMode ? `To ${targetUser!.name}` : 'Voice Message'}
        </Text>
        {!isRecordMode && mails.length > 0 && !selectMode ? (
          <TouchableOpacity onPress={() => setSelectMode(true)}>
            <Text style={styles.selectBtn}>Select</Text>
          </TouchableOpacity>
        ) : (
          <View style={{width: 50}} />
        )}
      </View>
      {selectMode && (
        <View style={styles.selectBar}>
          <TouchableOpacity style={styles.selectAllBtn} onPress={selectAll}>
            <Icon name={selectedIds.size === mails.length ? 'check-box' : 'check-box-outline-blank'} size={20} color="#ccc" />
            <Text style={styles.selectAllText}>Select All</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.deleteSelectedBtn, selectedIds.size === 0 && {opacity: 0.4}]}
            onPress={() => selectedIds.size > 0 && setDeleteMultiModal(true)}
            disabled={selectedIds.size === 0}>
            <Icon name="delete" size={18} color="#F44336" />
            <Text style={styles.deleteSelectedText}>Delete ({selectedIds.size})</Text>
          </TouchableOpacity>
        </View>
      )}

      {!isRecordMode ? (
        mails.length === 0 ? (
          <View style={styles.emptyState}>
            <Icon name="voicemail" size={40} color="#888" style={{marginBottom: 12}} />
            <Text style={styles.emptyText}>No voice messages yet</Text>
          </View>
        ) : (
          <FlatList data={mails} renderItem={renderMail} keyExtractor={item => item.id} contentContainerStyle={[styles.list, {paddingBottom: insets.bottom + 24}]} showsVerticalScrollIndicator={false} />
        )
      ) : (
        <View style={[styles.recordArea, {paddingBottom: insets.bottom + 20}]}>
          {sent ? (
            <View style={styles.sentState}>
              <Icon name="check-circle" size={48} color="#4CAF50" style={{marginBottom: 12}} />
              <Text style={styles.sentText}>Voice message sent!</Text>
              <TouchableOpacity style={styles.sentBtn} onPress={onBack}>
                <Text style={styles.sentBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : !hasNativeRecorder ? (
            <View style={styles.emptyState}>
              <Icon name="error-outline" size={40} color="#888" style={{marginBottom: 12}} />
              <Text style={styles.emptyText}>Recording not available</Text>
            </View>
          ) : (
            <>
              <Text style={styles.timer}>{formatTime(recordTime)}</Text>
              {recording && <Text style={styles.recordingDot}>● Recording</Text>}

              <View style={styles.controls}>
                {!recording && !recordedPath && (
                  <TouchableOpacity style={styles.recordButton} onPress={startRecording}>
                    <View style={styles.recordInner} />
                  </TouchableOpacity>
                )}
                {recording && (
                  <TouchableOpacity style={styles.stopButton} onPress={stopRecording}>
                    <View style={styles.stopInner} />
                  </TouchableOpacity>
                )}
                {recordedPath && !recording && (
                  <View style={styles.afterRecord}>
                    <TouchableOpacity style={styles.discardBtn} onPress={discardRecording}>
                      <Icon name="close" size={24} color="#888" />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.previewBtn} onPress={playPreview}>
                      <Icon name={playing === 'preview' ? 'pause' : 'play-arrow'} size={24} color="#4CAF50" />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.sendBtn, sending && {opacity: 0.4}]} onPress={sendVoiceMail} disabled={sending}>
                      {sending ? <ActivityIndicator color="#fff" /> : <Icon name="send" size={20} color="#fff" />}
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {!recording && !recordedPath && <Text style={styles.hintText}>Tap to record</Text>}
            </>
          )}
        </View>
      )}
      <Modal visible={!!deleteModal} transparent animationType="fade" onRequestClose={() => setDeleteModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalIconWrap}>
              <Icon name="delete-forever" size={30} color="#F44336" />
            </View>
            <Text style={styles.modalTitle}>Delete Voice Message</Text>
            <Text style={styles.modalMessage}>
              Delete voice message from {deleteModal ? (deleteModal.from_user_name || usersMap[deleteModal.from_user_id] || 'Unknown') : ''}?
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setDeleteModal(null)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalDeleteBtn} onPress={confirmDelete}>
                <Text style={styles.modalConfirmText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={deleteMultiModal} transparent animationType="fade" onRequestClose={() => setDeleteMultiModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalIconWrap}>
              <Icon name="delete-forever" size={30} color="#F44336" />
            </View>
            <Text style={styles.modalTitle}>Delete {selectedIds.size} Message{selectedIds.size > 1 ? 's' : ''}</Text>
            <Text style={styles.modalMessage}>
              {selectedIds.size === mails.length ? 'Delete all voice messages?' : `Delete ${selectedIds.size} selected voice message${selectedIds.size > 1 ? 's' : ''}?`}
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setDeleteMultiModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalDeleteBtn} onPress={confirmDeleteMulti}>
                <Text style={styles.modalConfirmText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0D0D0D'},
  header: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12},
  backBtn: {color: '#FF4D4D', fontSize: 20, fontWeight: '700'},
  selectBtn: {color: '#FF4D4D', fontSize: 18, fontWeight: '600'},
  selectBar: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 10},
  selectAllBtn: {flexDirection: 'row', alignItems: 'center', gap: 8},
  selectAllText: {color: '#ccc', fontSize: 14, fontWeight: '600'},
  deleteSelectedBtn: {flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#3a1010', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8},
  deleteSelectedText: {color: '#F44336', fontSize: 14, fontWeight: '700'},
  checkbox: {width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#555', alignItems: 'center', justifyContent: 'center', marginRight: 10},
  checkboxSelected: {backgroundColor: '#FF4D4D', borderColor: '#FF4D4D'},
  mailRowSelected: {backgroundColor: '#2a1515'},
  headerTitle: {color: '#fff', fontSize: 20, fontWeight: '700'},
  list: {paddingHorizontal: 16},
  mailRow: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#141414', borderRadius: 12, padding: 12, marginBottom: 8},
  mailRowUnread: {borderLeftWidth: 3, borderLeftColor: '#FF4D4D'},
  mailAvatar: {width: 40, height: 40, borderRadius: 20, backgroundColor: '#252525', alignItems: 'center', justifyContent: 'center', marginRight: 10},
  mailAvatarText: {color: '#fff', fontSize: 18, fontWeight: '700'},
  mailContent: {flex: 1},
  mailFrom: {color: '#fff', fontSize: 16, fontWeight: '600'},
  mailMeta: {color: '#666', fontSize: 12, marginTop: 2},
  playBtn: {width: 34, height: 34, borderRadius: 17, backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center', marginLeft: 8},
  playBtnActive: {backgroundColor: '#FF4D4D'},
  deleteMailBtn: {width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginLeft: 4},
  unreadDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF4D4D', position: 'absolute', top: 8, right: 8},
  emptyState: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  emptyText: {color: '#888', fontSize: 18, fontWeight: '600'},
  recordArea: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20},
  timer: {color: '#fff', fontSize: 52, fontWeight: '200', marginBottom: 8},
  recordingDot: {color: '#F44336', fontSize: 18, fontWeight: '600', marginBottom: 24},
  controls: {alignItems: 'center', marginTop: 16},
  recordButton: {width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: '#FF4D4D', alignItems: 'center', justifyContent: 'center'},
  recordInner: {width: 28, height: 28, borderRadius: 14, backgroundColor: '#FF4D4D'},
  stopButton: {width: 72, height: 72, borderRadius: 36, borderWidth: 3, borderColor: '#F44336', backgroundColor: '#3a1515', alignItems: 'center', justifyContent: 'center'},
  stopInner: {width: 24, height: 24, borderRadius: 4, backgroundColor: '#F44336'},
  afterRecord: {flexDirection: 'row', gap: 16, alignItems: 'center'},
  discardBtn: {width: 50, height: 50, borderRadius: 25, backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center'},
  previewBtn: {width: 50, height: 50, borderRadius: 25, backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#4CAF50'},
  sendBtn: {backgroundColor: '#4CAF50', width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center'},
  hintText: {color: '#444', fontSize: 18, marginTop: 16, textAlign: 'center'},
  sentState: {alignItems: 'center'},
  sentText: {color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 20},
  sentBtn: {backgroundColor: '#1A1A1A', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10},
  sentBtnText: {color: '#FF4D4D', fontSize: 18, fontWeight: '600'},
  modalOverlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32},
  modalBox: {backgroundColor: '#1A1A1A', borderRadius: 20, padding: 28, width: '100%', alignItems: 'center', borderWidth: 1, borderColor: '#333'},
  modalIconWrap: {width: 64, height: 64, borderRadius: 32, backgroundColor: '#3a1010', alignItems: 'center', justifyContent: 'center', marginBottom: 16},
  modalTitle: {color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 8},
  modalMessage: {color: '#888', fontSize: 18, textAlign: 'center', marginBottom: 24, lineHeight: 22},
  modalButtons: {flexDirection: 'row', gap: 12, width: '100%'},
  modalCancelBtn: {flex: 1, backgroundColor: '#252525', paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#333'},
  modalCancelText: {color: '#ccc', fontSize: 18, fontWeight: '700'},
  modalDeleteBtn: {flex: 1, backgroundColor: '#F44336', paddingVertical: 14, borderRadius: 12, alignItems: 'center'},
  modalConfirmText: {color: '#fff', fontSize: 18, fontWeight: '700'},
});

export default VoiceMailScreen;
