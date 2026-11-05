import React, {useState, useEffect} from 'react';
import {View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Modal} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {User, Group} from '../types';
import {useGroups} from '../hooks/useGroups';
import {subscribeToUsers, createGroup, updateGroup, deleteGroup} from '../services/firebase';

interface Props {
  currentUser: User;
  onBack: () => void;
  onBuzzGroup: (group: Group) => void;
  initialEditGroup?: Group;
}

const GroupsScreen: React.FC<Props> = ({currentUser, onBack, onBuzzGroup, initialEditGroup}) => {
  const insets = useSafeAreaInsets();
  const {groups} = useGroups();
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [modal, setModal] = useState<{visible: boolean; title: string; message: string; onConfirm?: () => void}>({visible: false, title: '', message: ''});

  useEffect(() => {
    const unsub = subscribeToUsers(users => {
      setAllUsers(users);
    });
    return unsub;
  }, [currentUser.id]);

  useEffect(() => {
    if (initialEditGroup) {
      setEditingGroup(initialEditGroup);
      setGroupName(initialEditGroup.name);
      setSelectedIds(new Set(initialEditGroup.member_ids));
      setShowCreate(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEditGroup]);

  const toggleMember = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    if (currentUser.role === 'member') return;
    if (!groupName.trim()) return;
    if (selectedIds.size < 2) {
      setModal({visible: true, title: 'Error', message: 'Select at least 2 members'});
      return;
    }
    await createGroup({
      name: groupName.trim(),
      member_ids: Array.from(selectedIds),
      created_by: currentUser.id,
      created_at: Date.now(),
      is_active: true,
    });
    setGroupName('');
    setSelectedIds(new Set());
    setShowCreate(false);
  };

  const handleEdit = (group: Group) => {
    setEditingGroup(group);
    setGroupName(group.name);
    setSelectedIds(new Set(group.member_ids));
    setShowCreate(true);
  };

  const handleSaveEdit = async () => {
    if (currentUser.role === 'member') return;
    if (!editingGroup || !groupName.trim() || selectedIds.size < 2) return;
    await updateGroup(editingGroup.id, {name: groupName.trim(), member_ids: Array.from(selectedIds)});
    setEditingGroup(null);
    setGroupName('');
    setSelectedIds(new Set());
    setShowCreate(false);
  };

  const handleDelete = (group: Group) => {
    const groupId = group.id;
    setModal({
      visible: true,
      title: 'Delete Group',
      message: `Delete "${group.name}"?`,
      onConfirm: () => {
        deleteGroup(groupId).catch(() => {});
        setEditingGroup(null);
        setGroupName('');
        setSelectedIds(new Set());
        setShowCreate(false);
      },
    });
  };

  const dismissModal = () => setModal(prev => ({...prev, visible: false}));

  const canCreateGroup = currentUser.role === 'owner' || currentUser.role === 'manager';

  const myGroups = groups.filter(
    g => g.created_by === currentUser.id || g.member_ids.includes(currentUser.id),
  );

  return (
    <View style={styles.container}>
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <TouchableOpacity onPress={onBack}><Text style={styles.backBtn}>← Back</Text></TouchableOpacity>
        <Text style={styles.headerTitle}>Groups</Text>
        {canCreateGroup ? (
          <TouchableOpacity onPress={() => { setShowCreate(!showCreate); setEditingGroup(null); setGroupName(''); setSelectedIds(new Set()); }}>
            {showCreate ? <Icon name="close" size={22} color="#FF4D4D" /> : <Text style={styles.addBtn}>+ New</Text>}
          </TouchableOpacity>
        ) : <View />}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={{paddingBottom: insets.bottom + 16}}>
        {showCreate && canCreateGroup && (
          <View style={styles.createForm}>
            <TextInput
              style={styles.input}
              placeholder="Group name"
              placeholderTextColor="#666"
              value={groupName}
              onChangeText={setGroupName}
              maxLength={30}
            />
            <Text style={styles.label}>Select members ({selectedIds.size} selected)</Text>
            <View style={styles.memberList}>
              {allUsers.filter(u => u.id !== currentUser.id).map(u => (
                <TouchableOpacity
                  key={u.id}
                  style={[styles.memberChip, selectedIds.has(u.id) && styles.memberChipActive]}
                  onPress={() => toggleMember(u.id)}>
                  <View style={[styles.memberAvatar, selectedIds.has(u.id) && styles.memberAvatarActive]}>
                    <Text style={styles.memberAvatarText}>{u.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <Text style={[styles.memberName, selectedIds.has(u.id) && styles.memberNameActive]}>{u.name}</Text>
                  {selectedIds.has(u.id) && <Icon name="check-circle" size={22} color="#FF4D4D" />}
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.createBtn, (!groupName.trim() || selectedIds.size < 2) && styles.createBtnDisabled]}
              onPress={editingGroup ? handleSaveEdit : handleCreate}
              disabled={!groupName.trim() || selectedIds.size < 2}>
              <Text style={styles.createBtnText}>{editingGroup ? 'Save Changes' : 'Create Group'}</Text>
            </TouchableOpacity>
            {editingGroup && (
              <TouchableOpacity style={styles.deleteGroupBtn} onPress={() => handleDelete(editingGroup)}>
                <Text style={styles.deleteGroupBtnText}>Delete Group</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {myGroups.length === 0 && !showCreate && (
          <View style={styles.emptyState}>
            <Icon name="group" size={48} color="#888" style={{marginBottom: 12}} />
            <Text style={styles.emptyText}>No groups yet</Text>
            <Text style={styles.emptySubtext}>{canCreateGroup ? 'Create a group to buzz multiple people at once' : 'You are not part of any group yet'}</Text>
          </View>
        )}

        {!showCreate && myGroups.map(group => {
          const memberNames = group.member_ids
            .map(id => id === currentUser.id ? 'You' : (allUsers.find(u => u.id === id)?.name || 'Unknown'))
            .join(', ');
          return (
            <View key={group.id} style={styles.groupCard}>
              <TouchableOpacity style={styles.groupCardMain} onPress={() => canCreateGroup && onBuzzGroup(group)} activeOpacity={canCreateGroup ? 0.7 : 1}>
                <View style={styles.groupAvatar}>
                  <Icon name="group" size={24} color="#FF4D4D" />
                </View>
                <View style={styles.groupInfo}>
                  <Text style={styles.groupName}>{group.name}</Text>
                  <Text style={styles.groupMembers} numberOfLines={1}>{memberNames}</Text>
                  <Text style={styles.groupCount}>{group.member_ids.length} members</Text>
                </View>
              </TouchableOpacity>
              {canCreateGroup && group.created_by === currentUser.id && (
                <View style={styles.groupActions}>
                  <TouchableOpacity onPress={() => handleEdit(group)}>
                    <Text style={styles.editBtn}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDelete(group)}>
                    <Icon name="delete" size={20} color="#F44336" />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      <Modal visible={modal.visible} transparent animationType="fade" onRequestClose={dismissModal}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>{modal.title}</Text>
            <Text style={styles.modalMessage}>{modal.message}</Text>
            {modal.onConfirm ? (
              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.modalCancelBtn} onPress={dismissModal}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalConfirmBtn} onPress={() => { dismissModal(); modal.onConfirm?.(); }}>
                  <Text style={styles.modalConfirmText}>Delete</Text>
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
  backBtn: {color: '#FF4D4D', fontSize: 20, fontWeight: '700'},
  headerTitle: {color: '#fff', fontSize: 22, fontWeight: '700'},
  addBtn: {color: '#FF4D4D', fontSize: 14, fontWeight: '600'},
  scroll: {flex: 1},
  createForm: {margin: 16, backgroundColor: '#1A1A1A', borderRadius: 16, padding: 16},
  input: {backgroundColor: '#252525', color: '#fff', fontSize: 18, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, marginBottom: 12},
  label: {color: '#888', fontSize: 14, fontWeight: '600', marginBottom: 8},
  memberList: {gap: 6, marginBottom: 16},
  memberChip: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#252525', borderRadius: 10, padding: 10, borderWidth: 1.5, borderColor: '#333'},
  memberChipActive: {backgroundColor: '#2a1515', borderColor: '#FF4D4D'},
  memberAvatar: {width: 34, height: 34, borderRadius: 17, backgroundColor: '#333', alignItems: 'center', justifyContent: 'center', marginRight: 10},
  memberAvatarActive: {backgroundColor: '#FF4D4D'},
  memberAvatarText: {color: '#fff', fontSize: 18, fontWeight: '700'},
  memberName: {color: '#ccc', fontSize: 18, flex: 1},
  memberNameActive: {color: '#FF4D4D', fontWeight: '600'},
  checkmark: {color: '#FF4D4D', fontSize: 20, fontWeight: '700'},
  createBtn: {backgroundColor: '#FF4D4D', paddingVertical: 14, borderRadius: 10, alignItems: 'center'},
  createBtnDisabled: {opacity: 0.4},
  createBtnText: {color: '#fff', fontSize: 18, fontWeight: '700'},
  deleteGroupBtn: {backgroundColor: '#F44336', paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginTop: 10},
  deleteGroupBtnText: {color: '#fff', fontSize: 18, fontWeight: '700'},
  emptyState: {alignItems: 'center', paddingTop: 80},
  emptyIcon: {fontSize: 52, marginBottom: 12},
  emptyText: {color: '#888', fontSize: 19, fontWeight: '600'},
  emptySubtext: {color: '#999', fontSize: 14, marginTop: 4},
  groupCard: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A1A', marginHorizontal: 16, marginBottom: 8, borderRadius: 14, padding: 14},
  groupCardCompact: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1A1A1A', marginHorizontal: 16, marginBottom: 6, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12},
  groupCardMain: {flex: 1, flexDirection: 'row', alignItems: 'center'},
  groupAvatar: {width: 48, height: 48, borderRadius: 24, backgroundColor: '#2a1515', alignItems: 'center', justifyContent: 'center', marginRight: 12},
  groupAvatarText: {fontSize: 24},
  groupInfo: {flex: 1},
  groupName: {color: '#fff', fontSize: 16, fontWeight: '700'},
  groupMembers: {color: '#999', fontSize: 13, marginTop: 2},
  groupCount: {color: '#999', fontSize: 13, marginTop: 2},
  groupActions: {flexDirection: 'row', gap: 12, alignItems: 'center'},
  editBtn: {color: '#FF9800', fontSize: 14, fontWeight: '600'},
  deleteBtn: {color: '#F44336', fontSize: 20, fontWeight: '700'},
  modalOverlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32},
  modalBox: {backgroundColor: '#1A1A1A', borderRadius: 20, padding: 28, width: '100%', alignItems: 'center', borderWidth: 1, borderColor: '#333'},
  modalTitle: {color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 8},
  modalMessage: {color: '#888', fontSize: 18, textAlign: 'center', marginBottom: 24},
  modalButtons: {flexDirection: 'row', gap: 12, width: '100%'},
  modalCancelBtn: {flex: 1, backgroundColor: '#252525', paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#333'},
  modalCancelText: {color: '#ccc', fontSize: 18, fontWeight: '700'},
  modalConfirmBtn: {flex: 1, backgroundColor: '#F44336', paddingVertical: 14, borderRadius: 12, alignItems: 'center'},
  modalConfirmText: {color: '#fff', fontSize: 18, fontWeight: '700'},
  modalFullBtn: {width: '100%', backgroundColor: '#FF4D4D', paddingVertical: 14, borderRadius: 12, alignItems: 'center'},
});

export default GroupsScreen;
