import React, {useState, useEffect} from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {User} from '../types';

interface Props {
  currentUser: User;
  onBack: () => void;
  onLogout: () => void;
  onDeleteAccount: () => Promise<void>;
  onUpdateProfile: (data: {name?: string; phone?: string}) => Promise<void>;
  onChangePin: (currentPin: string, newPin: string) => Promise<void>;
}

const ProfileScreen: React.FC<Props> = ({
  currentUser,
  onBack,
  onLogout,
  onDeleteAccount,
  onUpdateProfile,
  onChangePin,
}) => {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(currentUser.name);
  const [phone, setPhone] = useState(currentUser.phone);
  const [saving, setSaving] = useState(false);

  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [changingPin, setChangingPin] = useState(false);
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [alertModal, setAlertModal] = useState<{
    visible: boolean;
    type: 'success' | 'error';
    title: string;
    message: string;
  }>({visible: false, type: 'error', title: '', message: ''});

  const showAlert = (type: 'success' | 'error', title: string, message: string) => {
    setAlertModal({visible: true, type, title, message});
  };

  const hasProfileChanges =
    name.trim() !== currentUser.name || phone.trim() !== currentUser.phone;

  const handleSaveProfile = async () => {
    if (!name.trim()) {
      showAlert('error', 'Error', 'Name cannot be empty');
      return;
    }
    if (phone.trim().length < 10) {
      showAlert('error', 'Error', 'Enter a valid phone number');
      return;
    }
    setSaving(true);
    try {
      const data: {name?: string; phone?: string} = {};
      if (name.trim() !== currentUser.name) data.name = name.trim();
      if (phone.trim() !== currentUser.phone) data.phone = phone.trim();
      await onUpdateProfile(data);
      showAlert('success', 'Success', 'Profile updated');
    } catch (e: any) {
      showAlert('error', 'Error', e?.message || 'Failed to update profile');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePin = async () => {
    if (currentPin.length !== 4) {
      showAlert('error', 'Error', 'Enter your current 4-digit PIN');
      return;
    }
    if (newPin.length !== 4) {
      showAlert('error', 'Error', 'Enter a new 4-digit PIN');
      return;
    }
    if (newPin !== confirmPin) {
      showAlert('error', 'Error', 'New PINs do not match');
      return;
    }
    setChangingPin(true);
    try {
      await onChangePin(currentPin, newPin);
      showAlert('success', 'Success', 'PIN changed successfully');
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
    } catch (e: any) {
      showAlert('error', 'Error', e?.message || 'Failed to change PIN');
    } finally {
      setChangingPin(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <TouchableOpacity onPress={onBack}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Profile</Text>
        <View style={{width: 50}} />
      </View>

      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {currentUser.name.charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.roleBadge}>{currentUser.role}</Text>
        </View>

        {/* Profile Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>PROFILE INFO</Text>
          <Text style={styles.label}>Name</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Full name"
            placeholderTextColor="#666"
            maxLength={50}
          />
          <Text style={styles.label}>Phone</Text>
          <TextInput
            style={[styles.input, phone.length > 0 && phone.length < 10 && {borderColor: '#F44336'}]}
            value={phone}
            onChangeText={t => setPhone(t.replace(/[^0-9]/g, ''))}
            placeholder="Phone number (min 10 digits)"
            placeholderTextColor="#666"
            keyboardType="phone-pad"
            maxLength={15}
          />
          {phone.length > 0 && phone.length < 10 && (
            <Text style={{color: '#F44336', fontSize: 12, marginTop: 2, marginBottom: 4}}>Phone number must be at least 10 digits</Text>
          )}
          <TouchableOpacity
            style={[
              styles.saveBtn,
              (!hasProfileChanges || saving) && styles.saveBtnDisabled,
            ]}
            onPress={handleSaveProfile}
            disabled={!hasProfileChanges || saving}>
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Save Changes</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Change PIN */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>CHANGE PIN</Text>
          <TextInput
            style={styles.input}
            value={currentPin}
            onChangeText={setCurrentPin}
            placeholder="Current PIN"
            placeholderTextColor="#666"
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
          />
          <TextInput
            style={styles.input}
            value={newPin}
            onChangeText={setNewPin}
            placeholder="New PIN"
            placeholderTextColor="#666"
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
          />
          <TextInput
            style={styles.input}
            value={confirmPin}
            onChangeText={setConfirmPin}
            placeholder="Confirm new PIN"
            placeholderTextColor="#666"
            keyboardType="number-pad"
            secureTextEntry
            maxLength={4}
          />
          <TouchableOpacity
            style={[
              styles.saveBtn,
              (changingPin ||
                currentPin.length !== 4 ||
                newPin.length !== 4 ||
                confirmPin.length !== 4) &&
                styles.saveBtnDisabled,
            ]}
            onPress={handleChangePin}
            disabled={
              changingPin ||
              currentPin.length !== 4 ||
              newPin.length !== 4 ||
              confirmPin.length !== 4
            }>
            {changingPin ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Change PIN</Text>
            )}
          </TouchableOpacity>
        </View>


        {/* Account Actions */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>ACCOUNT</Text>
          <TouchableOpacity
            style={styles.logoutRow}
            onPress={() => setShowLogoutModal(true)}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.deleteRow}
            onPress={() => setShowDeleteModal(true)}>
            <Text style={styles.deleteText}>Delete Account</Text>
          </TouchableOpacity>
        </View>

        <View style={{height: insets.bottom + 24}} />
      </ScrollView>

      {/* Logout Modal */}
      <Modal
        visible={showLogoutModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLogoutModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalIconWrap}>
              <Icon name="logout" size={30} color="#FF4D4D" />
            </View>
            <Text style={styles.modalTitle}>Logout</Text>
            <Text style={styles.modalMessage}>
              Are you sure you want to logout?
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowLogoutModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalConfirmBtn}
                onPress={() => {
                  setShowLogoutModal(false);
                  onLogout();
                }}>
                <Text style={styles.modalConfirmText}>Logout</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Alert Modal */}
      <Modal
        visible={alertModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setAlertModal(prev => ({...prev, visible: false}))}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View
              style={[
                styles.modalIconWrap,
                alertModal.type === 'success'
                  ? styles.modalIconSuccess
                  : styles.modalIconDanger,
              ]}>
              <Text style={styles.modalIcon}>
                <Icon name={alertModal.type === 'success' ? 'check-circle' : 'error-outline'} size={30} color={alertModal.type === 'success' ? '#4CAF50' : '#FF4D4D'} />
              </Text>
            </View>
            <Text style={styles.modalTitle}>{alertModal.title}</Text>
            <Text style={styles.modalMessage}>{alertModal.message}</Text>
            <TouchableOpacity
              style={[
                styles.modalFullBtn,
                alertModal.type === 'success'
                  ? styles.modalSuccessBtn
                  : styles.modalErrorBtn,
              ]}
              onPress={() =>
                setAlertModal(prev => ({...prev, visible: false}))
              }>
              <Text style={styles.modalConfirmText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Delete Account Modal */}
      <Modal
        visible={showDeleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDeleteModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={[styles.modalIconWrap, styles.modalIconDanger]}>
              <Icon name="delete-forever" size={30} color="#F44336" />
            </View>
            <Text style={styles.modalTitle}>Delete Account</Text>
            <Text style={styles.modalMessage}>
              Are you sure you want to delete your account? This action cannot
              be undone.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setShowDeleteModal(false)}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalDeleteBtn, deleting && {opacity: 0.5}]}
                disabled={deleting}
                onPress={async () => {
                  setDeleting(true);
                  try {
                    await onDeleteAccount();
                  } catch {
                    setDeleting(false);
                    setShowDeleteModal(false);
                  }
                }}>
                <Text style={styles.modalConfirmText}>{deleting ? 'Deleting...' : 'Delete'}</Text>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: {color: '#FF4D4D', fontSize: 20, fontWeight: '700'},
  headerTitle: {color: '#fff', fontSize: 22, fontWeight: '700'},
  scroll: {flex: 1},
  avatarSection: {alignItems: 'center', paddingVertical: 24},
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1A1A1A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FF4D4D',
    marginBottom: 12,
  },
  avatarText: {color: '#FF4D4D', fontSize: 34, fontWeight: '800'},
  roleBadge: {
    color: '#FF4D4D',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    backgroundColor: '#2a1515',
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 12,
    overflow: 'hidden',
    letterSpacing: 1,
  },
  section: {paddingHorizontal: 16, marginBottom: 24},
  sectionTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 12,
  },
  label: {color: '#999', fontSize: 14, fontWeight: '600', marginBottom: 6},
  input: {
    backgroundColor: '#1A1A1A',
    color: '#fff',
    fontSize: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#333',
  },
  saveBtn: {
    backgroundColor: '#FF4D4D',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  saveBtnDisabled: {opacity: 0.5},
  saveBtnText: {color: '#fff', fontSize: 18, fontWeight: '700'},
  logoutRow: {
    backgroundColor: '#1A1A1A',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 10,
  },
  logoutText: {color: '#FF4D4D', fontSize: 18, fontWeight: '600'},
  deleteRow: {
    backgroundColor: '#1A1A1A',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F44336',
  },
  deleteText: {color: '#F44336', fontSize: 18, fontWeight: '600'},
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1A1A1A',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  navRowLeft: {flexDirection: 'row', alignItems: 'center', gap: 12},
  navRowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#2a1515',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navRowTitle: {color: '#fff', fontSize: 16, fontWeight: '700'},
  navRowSub: {color: '#FF4D4D', fontSize: 13, fontWeight: '600', marginTop: 1},
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  modalBox: {
    backgroundColor: '#1A1A1A',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  modalIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#2a1515',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  modalIconDanger: {
    backgroundColor: '#3a1010',
  },
  modalIcon: {fontSize: 30},
  modalTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 8,
  },
  modalMessage: {
    color: '#888',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 24,
  },
  modalButtons: {flexDirection: 'row', gap: 12, width: '100%'},
  modalCancelBtn: {
    flex: 1,
    backgroundColor: '#252525',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  modalCancelText: {color: '#ccc', fontSize: 18, fontWeight: '700'},
  modalConfirmBtn: {
    flex: 1,
    backgroundColor: '#FF4D4D',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  deletePinInput: {
    backgroundColor: '#1A1A1A',
    color: '#fff',
    fontSize: 18,
    fontWeight: '700' as const,
    textAlign: 'center' as const,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#333',
    marginBottom: 16,
    letterSpacing: 8,
  },
  modalDeleteBtn: {
    flex: 1,
    backgroundColor: '#F44336',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalConfirmText: {color: '#fff', fontSize: 18, fontWeight: '700'},
  modalIconSuccess: {backgroundColor: '#1a3a1a'},
  modalFullBtn: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalSuccessBtn: {backgroundColor: '#4CAF50'},
  modalErrorBtn: {backgroundColor: '#FF4D4D'},
});

export default ProfileScreen;
