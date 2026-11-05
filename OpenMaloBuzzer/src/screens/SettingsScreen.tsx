import React, {useState, useEffect} from 'react';
import {View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Modal} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {User, Reason} from '../types';
import {subscribeToUsers, subscribeToReasons, addUser, removeUser, resetUserPin, updateUserRole, addReason, removeReason} from '../services/firebase';
import {hashPin} from '../services/crypto';
import {MAX_REASONS} from '../constants';

interface Props {
  currentUser: User;
  onBack: () => void;
}

const generateRandomPin = () => String(Math.floor(1000 + Math.random() * 9000));

const SettingsScreen: React.FC<Props> = ({currentUser, onBack}) => {
  const insets = useSafeAreaInsets();
  const isAdmin = currentUser.role === 'owner' || currentUser.role === 'manager';
  const [users, setUsers] = useState<User[]>([]);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newRole, setNewRole] = useState<'manager' | 'member'>('member');
  const [newReasonLabel, setNewReasonLabel] = useState('');
  const [modal, setModal] = useState<{
    visible: boolean;
    title: string;
    message: string;
    confirmText?: string;
    destructive?: boolean;
    onConfirm?: () => void;
  }>({visible: false, title: '', message: ''});

  useEffect(() => {
    const unsub1 = subscribeToUsers(setUsers);
    const unsub2 = subscribeToReasons(setReasons);
    return () => { unsub1(); unsub2(); };
  }, []);

  const showAlert = (title: string, message: string) => {
    setModal({visible: true, title, message});
  };

  const showConfirm = (
    title: string,
    message: string,
    confirmText: string,
    onConfirm: () => void,
    destructive = false,
  ) => {
    setModal({visible: true, title, message, confirmText, onConfirm, destructive});
  };

  const handleAddUser = async () => {
    if (!isAdmin) return;
    if (!newName.trim() || !newPhone.trim()) {
      showAlert('Error', 'Name and phone are required');
      return;
    }
    const pin = generateRandomPin();
    await addUser({name: newName.trim(), phone: newPhone.trim(), pin_hash: hashPin(pin), role: newRole, last_seen_at: 0, is_active: true});
    showAlert('User Added', `${newName} added with PIN: ${pin}\n\nShare this PIN with the user. They should change it after first login.`);
    setNewName(''); setNewPhone(''); setShowAddUser(false);
  };

  const handleRemoveUser = (user: User) => {
    if (!isAdmin) return;
    showConfirm('Remove User', `Remove ${user.name}?`, 'Remove', () => removeUser(user.id), true);
  };

  const handleResetPin = (user: User) => {
    const pin = generateRandomPin();
    showConfirm(
      'Reset PIN',
      `Reset ${user.name}'s PIN to a new random PIN?`,
      'Reset',
      async () => {
        await resetUserPin(user.id, hashPin(pin));
        showAlert('PIN Reset', `${user.name}'s new PIN: ${pin}\n\nShare this PIN with the user.`);
      },
    );
  };

  const handleChangeRole = (user: User) => {
    const targetRole = user.role === 'manager' ? 'member' : 'manager';
    showConfirm(
      'Change Role',
      `Change ${user.name}'s role to ${targetRole}?`,
      'Change',
      () => updateUserRole(user.id, targetRole),
    );
  };

  const handleAddReason = async () => {
    if (!isAdmin) return;
    if (!newReasonLabel.trim()) return;
    if (reasons.length >= MAX_REASONS) {
      showAlert('Limit Reached', `Maximum ${MAX_REASONS} reasons allowed`);
      return;
    }
    await addReason(newReasonLabel.trim(), reasons.length);
    setNewReasonLabel('');
  };

  const handleRemoveReason = (reason: Reason) => {
    if (!isAdmin) return;
    showConfirm('Remove Reason', `Remove "${reason.label}"?`, 'Remove', () => removeReason(reason.id), true);
  };

  const dismissModal = () => setModal(prev => ({...prev, visible: false}));

  return (
    <View style={styles.container}>
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <TouchableOpacity onPress={onBack}><Text style={styles.backBtn}>← Back</Text></TouchableOpacity>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={{width: 50}} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={{paddingBottom: insets.bottom + 16}}>
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>USERS</Text>
            <TouchableOpacity onPress={() => setShowAddUser(!showAddUser)}>{showAddUser ? <Icon name="close" size={18} color="#FF4D4D" /> : <Text style={styles.addBtn}>+ Add</Text>}</TouchableOpacity>
          </View>
          {showAddUser && (
            <View style={styles.addForm}>
              <TextInput style={styles.formInput} placeholder="Name" placeholderTextColor="#666" value={newName} onChangeText={setNewName} />
              <TextInput style={styles.formInput} placeholder="Phone" placeholderTextColor="#666" keyboardType="phone-pad" value={newPhone} onChangeText={t => setNewPhone(t.replace(/[^0-9]/g, ''))} />
              <View style={styles.roleRow}>
                {(['manager', 'member'] as const).map(role => (
                  <TouchableOpacity key={role} style={[styles.roleChip, newRole === role && styles.roleChipActive]} onPress={() => setNewRole(role)}>
                    <Text style={[styles.roleChipText, newRole === role && styles.roleChipTextActive]}>{role}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity style={styles.submitBtn} onPress={handleAddUser}><Text style={styles.submitBtnText}>Add User</Text></TouchableOpacity>
            </View>
          )}
          {users.map(user => (
            <View key={user.id} style={styles.listItem}>
              <View style={styles.listItemLeft}>
                <View style={styles.nameRow}>
                  <Text style={styles.listItemName}>{user.name}</Text>
                  <View style={[styles.roleBadge, user.role === 'owner' ? styles.roleBadgeOwner : user.role === 'manager' ? styles.roleBadgeManager : styles.roleBadgeMember]}>
                    <Text style={[styles.roleBadgeText, user.role === 'owner' ? styles.roleBadgeTextOwner : user.role === 'manager' ? styles.roleBadgeTextManager : styles.roleBadgeTextMember]}>{user.role}</Text>
                  </View>
                </View>
                <Text style={styles.listItemSub}>{user.phone}</Text>
              </View>
              {user.id !== currentUser.id && user.role !== 'owner' && (
                <View style={styles.listItemActions}>
                  <TouchableOpacity onPress={() => handleChangeRole(user)}>
                    <Text style={styles.actionTextRole}>{user.role === 'manager' ? '↓' : '↑'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleResetPin(user)}><Text style={styles.actionText}>PIN</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => handleRemoveUser(user)}><Icon name="close" size={18} color="#F44336" /></TouchableOpacity>
                </View>
              )}
            </View>
          ))}
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>BUZZ REASONS</Text>
          <View style={styles.addReasonRow}>
            <TextInput style={[styles.formInput, {flex: 1, marginBottom: 0}]} placeholder="New reason" placeholderTextColor="#666" value={newReasonLabel} onChangeText={setNewReasonLabel} />
            <TouchableOpacity style={styles.addReasonBtn} onPress={handleAddReason}><Text style={styles.addReasonBtnText}>+</Text></TouchableOpacity>
          </View>
          {reasons.map(reason => (
            <View key={reason.id} style={styles.listItem}>
              <Text style={styles.listItemName}>{reason.label}</Text>
              <TouchableOpacity onPress={() => handleRemoveReason(reason)}><Icon name="close" size={18} color="#F44336" /></TouchableOpacity>
            </View>
          ))}
        </View>
      </ScrollView>

      <Modal
        visible={modal.visible}
        transparent
        animationType="fade"
        onRequestClose={dismissModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={[styles.modalIconWrap, modal.destructive && styles.modalIconDanger]}>
              <Icon name={modal.onConfirm ? 'help-outline' : 'info-outline'} size={32} color="#FF4D4D" />
            </View>
            <Text style={styles.modalTitle}>{modal.title}</Text>
            <Text style={styles.modalMessage}>{modal.message}</Text>
            {modal.onConfirm ? (
              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={dismissModal}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalConfirmBtn, modal.destructive && styles.modalDestructiveBtn]}
                  onPress={() => { dismissModal(); modal.onConfirm?.(); }}>
                  <Text style={styles.modalConfirmText}>{modal.confirmText}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.modalFullBtn} onPress={dismissModal}>
                <Text style={styles.modalConfirmText}>OK</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0D0D0D'},
  header: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12},
  backBtn: {color: '#FF4D4D', fontSize: 18, fontWeight: '600'},
  headerTitle: {color: '#fff', fontSize: 20, fontWeight: '700'},
  scroll: {flex: 1},
  section: {paddingHorizontal: 16, marginBottom: 32},
  sectionHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12},
  sectionTitle: {color: '#666', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginBottom: 12},
  addBtn: {color: '#FF4D4D', fontSize: 14, fontWeight: '600', marginBottom: 12},
  addForm: {backgroundColor: '#1A1A1A', borderRadius: 12, padding: 16, marginBottom: 12},
  formInput: {backgroundColor: '#252525', color: '#fff', fontSize: 18, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 8, marginBottom: 10},
  roleRow: {flexDirection: 'row', gap: 8, marginBottom: 12},
  roleChip: {paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, backgroundColor: '#252525'},
  roleChipActive: {backgroundColor: '#3a1515', borderWidth: 1, borderColor: '#FF4D4D'},
  roleChipText: {color: '#888', fontSize: 14, textTransform: 'capitalize'},
  roleChipTextActive: {color: '#FF4D4D'},
  submitBtn: {backgroundColor: '#FF4D4D', paddingVertical: 12, borderRadius: 8, alignItems: 'center'},
  submitBtnText: {color: '#fff', fontSize: 18, fontWeight: '700'},
  listItem: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#1A1A1A', paddingHorizontal: 16, paddingVertical: 14, borderRadius: 10, marginBottom: 6},
  listItemLeft: {flex: 1},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  listItemName: {color: '#fff', fontSize: 16, fontWeight: '600'},
  roleBadge: {paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6},
  roleBadgeOwner: {backgroundColor: '#FF4D4D20'},
  roleBadgeManager: {backgroundColor: '#FF980020'},
  roleBadgeMember: {backgroundColor: '#33333380'},
  roleBadgeText: {fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5},
  roleBadgeTextOwner: {color: '#FF4D4D'},
  roleBadgeTextManager: {color: '#FF9800'},
  roleBadgeTextMember: {color: '#888'},
  listItemSub: {color: '#666', fontSize: 13, marginTop: 2},
  listItemActions: {flexDirection: 'row', gap: 16, alignItems: 'center'},
  actionText: {color: '#888', fontSize: 13, fontWeight: '600'},
  actionTextRole: {color: '#FF9800', fontSize: 16, fontWeight: '800'},
  actionDanger: {color: '#F44336'},
  addReasonRow: {flexDirection: 'row', gap: 8, marginBottom: 12},
  addReasonBtn: {backgroundColor: '#FF4D4D', width: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center'},
  addReasonBtnText: {color: '#fff', fontSize: 24, fontWeight: '700'},
  modalOverlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32},
  modalBox: {backgroundColor: '#1A1A1A', borderRadius: 20, padding: 28, width: '100%', alignItems: 'center', borderWidth: 1, borderColor: '#333'},
  modalIconWrap: {width: 64, height: 64, borderRadius: 32, backgroundColor: '#2a1515', alignItems: 'center', justifyContent: 'center', marginBottom: 16},
  modalIconDanger: {backgroundColor: '#3a1010'},
  modalIcon: {color: '#FF4D4D', fontSize: 32, fontWeight: '900'},
  modalTitle: {color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 8},
  modalMessage: {color: '#888', fontSize: 18, textAlign: 'center', marginBottom: 24, lineHeight: 22},
  modalButtons: {flexDirection: 'row', gap: 12, width: '100%'},
  modalCancelBtn: {flex: 1, backgroundColor: '#252525', paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#333'},
  modalCancelText: {color: '#ccc', fontSize: 18, fontWeight: '700'},
  modalConfirmBtn: {flex: 1, backgroundColor: '#FF4D4D', paddingVertical: 14, borderRadius: 12, alignItems: 'center'},
  modalDestructiveBtn: {backgroundColor: '#F44336'},
  modalConfirmText: {color: '#fff', fontSize: 18, fontWeight: '700'},
  modalFullBtn: {width: '100%', backgroundColor: '#FF4D4D', paddingVertical: 14, borderRadius: 12, alignItems: 'center'},
});

export default SettingsScreen;
