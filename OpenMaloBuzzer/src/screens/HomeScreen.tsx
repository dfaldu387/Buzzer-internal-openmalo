import React, {useState, useEffect, useRef, useCallback} from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TextInput,
  Modal,
  Dimensions,
  AppState,
  NativeModules,
  Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialIcons';
import Sound from 'react-native-sound';
import {User, Group, Buzz, VoiceMail} from '../types';
import {useUsers} from '../hooks/useUsers';
import {useGroups} from '../hooks/useGroups';
import {useReasons} from '../hooks/useReasons';
import {subscribeToVoiceMails, subscribeToMissedBuzzes, markVoiceMailListened, deleteVoiceMail, subscribeToUsers, getFavorites, upsertFavorite, deleteFavorite} from '../services/firebase';
import {supabase} from '../services/supabase';
import {BUZZ_SOUNDS} from '../services/soundPreference';

const getLogViewedKey = (userId: string) => `@openmalo_log_viewed_${userId}`;

interface FavoriteEntry {
  userId: string;
  reasons: string[];
  reasonSounds: Record<string, string>;
}

interface Props {
  currentUser: User;
  onSelectUser: (user: User) => void;
  onBuzzAgain: (user: User, reason: string, soundId?: string) => void;
  onEditBuzz: (user: User, reason: string) => void;
  onCallUser: (user: User) => void;
  onVoiceMail: (user?: User) => void;
  onSettings: () => void;
  onProfile: () => void;
  onHistory: () => void;
  onGroups: () => void;
  onBuzzGroup: (group: Group) => void;
  onEditGroup: (group: Group) => void;
  initialTab?: 'recent' | 'people' | 'groups' | 'voice';
}

const HomeScreen: React.FC<Props> = ({currentUser, onSelectUser, onBuzzAgain, onEditBuzz, onCallUser, onVoiceMail, onSettings, onProfile, onHistory, onGroups, onBuzzGroup, onEditGroup, initialTab}) => {
  const {users, isOnline, loading} = useUsers(currentUser.id);
  const {groups} = useGroups();
  const reasons = useReasons();
  const [favorites, setFavorites] = useState<FavoriteEntry[]>([]);
  const [unreadVoiceCount, setUnreadVoiceCount] = useState(0);
  const [missedBuzzes, setMissedBuzzes] = useState<Buzz[]>([]);
  const [infoGroup, setInfoGroup] = useState<Group | null>(null);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'recent' | 'people' | 'groups' | 'voice'>(initialTab || 'recent');
  const [voiceMails, setVoiceMails] = useState<VoiceMail[]>([]);
  const [usersMap, setUsersMap] = useState<Record<string, string>>({});
  const [playingId, setPlayingId] = useState<string | null>(null);
  const soundRef = useRef<Sound | null>(null);
  const pagerRef = useRef<ScrollView>(null);
  const screenWidth = Dimensions.get('window').width;
  const TABS: ('recent' | 'people' | 'groups' | 'voice')[] = ['recent', 'people', 'groups', 'voice'];

  // Add modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [addStep, setAddStep] = useState<'person' | 'reasons'>('person');
  const [addSelectedUser, setAddSelectedUser] = useState<User | null>(null);
  const [addSelectedReasons, setAddSelectedReasons] = useState<Set<string>>(new Set());
  const [addCustomReason, setAddCustomReason] = useState('');
  const [addReasonSounds, setAddReasonSounds] = useState<Record<string, string>>({});
  const [addSoundPickerReason, setAddSoundPickerReason] = useState<string | null>(null);
  const previewRef = useRef<Sound | null>(null);
  const [addPersonSearch, setAddPersonSearch] = useState('');
  const [deleteModal, setDeleteModal] = useState<string | null>(null);
  const [voiceDeleteId, setVoiceDeleteId] = useState<string | null>(null);
  const [logCount, setLogCount] = useState(0);
  const [muted, setMuted] = useState(false);
  const reasonsScrollRef = useRef<ScrollView>(null);

  // Load mute state on mount
  useEffect(() => {
    AsyncStorage.getItem('@openmalo_muted').then(v => { if (v === 'true') setMuted(true); });
  }, []);

  const toggleMute = () => {
    const newVal = !muted;
    setMuted(newVal);
    AsyncStorage.setItem('@openmalo_muted', newVal ? 'true' : 'false');
    if (Platform.OS === 'android') {
      NativeModules.BuzzerService?.setMuted?.(newVal);
    }
  };

  // Load favorites from Supabase (persists across reinstall/logout)
  useEffect(() => {
    setFavorites([]);
    getFavorites(currentUser.id).then(rows => {
      setFavorites(rows.map(r => ({userId: r.target_user_id, reasons: r.reasons, reasonSounds: r.reason_sounds || {}})));
    }).catch(err => {
      console.warn('Failed to load favorites:', err?.message || JSON.stringify(err));
    });
  }, [currentUser.id]);

  const scrollToTab = useCallback((tab: 'recent' | 'people' | 'groups' | 'voice') => {
    const index = TABS.indexOf(tab);
    pagerRef.current?.scrollTo({x: index * screenWidth, animated: true});
    setActiveTab(tab);
  }, [screenWidth]);

  // Scroll pager to initialTab on mount
  useEffect(() => {
    if (initialTab && initialTab !== 'recent') {
      const index = TABS.indexOf(initialTab);
      setTimeout(() => {
        pagerRef.current?.scrollTo({x: index * screenWidth, animated: false});
      }, 50);
    }
  }, []);

  const handleSwipe = useCallback((e: any) => {
    const index = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
    if (index >= 0 && index < TABS.length) {
      setActiveTab(TABS[index]);
    }
  }, [screenWidth]);
  const insets = useSafeAreaInsets();

  const canBuzz = (target: User) => {
    if (currentUser.role === 'owner' || currentUser.role === 'manager') return true;
    return target.role === 'owner' || target.role === 'manager';
  };

  useEffect(() => {
    const unsub = subscribeToVoiceMails(currentUser.id, mails => {
      setVoiceMails(mails);
      setUnreadVoiceCount(mails.filter(m => !m.listened).length);
    });
    const unsub2 = subscribeToUsers(u => {
      const map: Record<string, string> = {};
      u.forEach(user => { map[user.id] = user.name; });
      setUsersMap(map);
    });
    return () => { unsub(); unsub2(); };
  }, [currentUser.id]);

  useEffect(() => {
    return () => {
      if (soundRef.current) { soundRef.current.stop(); soundRef.current.release(); }
      if (previewRef.current) { previewRef.current.stop(); previewRef.current.release(); }
    };
  }, []);

  const playVoiceMail = (mail: VoiceMail) => {
    if (playingId === mail.id) {
      if (soundRef.current) { soundRef.current.stop(); soundRef.current.release(); soundRef.current = null; }
      setPlayingId(null);
      return;
    }
    if (soundRef.current) { soundRef.current.stop(); soundRef.current.release(); soundRef.current = null; }
    setPlayingId(mail.id);
    if (!mail.listened) markVoiceMailListened(mail.id).catch(() => {});
    const s = new Sound(mail.audio_url, '', (err) => {
      if (err) { setPlayingId(null); return; }
      s.setVolume(1.0);
      s.play(() => { s.release(); soundRef.current = null; setPlayingId(null); });
    });
    soundRef.current = s;
  };

  const formatVoiceDate = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const time = d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    if (d.toDateString() === now.toDateString()) return `Today ${time}`;
    return `${d.toLocaleDateString([], {month: 'short', day: 'numeric'})} ${time}`;
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    const unsub = subscribeToMissedBuzzes(currentUser.id, setMissedBuzzes);
    return unsub;
  }, [currentUser.id]);

  // Log count — count buzzes since last viewed
  useEffect(() => {
    const fetchLogCount = async () => {
      const lastViewed = await AsyncStorage.getItem(getLogViewedKey(currentUser.id));
      const since = lastViewed ? parseInt(lastViewed, 10) : Date.now();
      const {count} = await supabase
        .from('buzzes')
        .select('*', {count: 'exact', head: true})
        .or(`from_user_id.eq.${currentUser.id},to_user_id.eq.${currentUser.id}`)
        .gt('created_at', since);
      setLogCount(count || 0);
    };
    fetchLogCount();
    let interval: ReturnType<typeof setInterval> | null = setInterval(fetchLogCount, 30000);
    const sub = AppState.addEventListener('change', (state: string) => {
      if (state === 'active') {
        fetchLogCount();
        if (!interval) interval = setInterval(fetchLogCount, 30000);
      } else {
        if (interval) { clearInterval(interval); interval = null; }
      }
    });
    return () => { if (interval) clearInterval(interval); sub.remove(); };
  }, [currentUser.id]);

  const handleOpenHistory = async () => {
    await AsyncStorage.setItem(getLogViewedKey(currentUser.id), String(Date.now()));
    setLogCount(0);
    onHistory();
  };

  const getGroupMissedCount = (group: Group) =>
    missedBuzzes.filter(b => group.member_ids.includes(b.from_user_id)).length;

  const buzzableUsers = users.filter(u => {
    if (!canBuzz(u)) return false;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      return u.name.toLowerCase().includes(q) || (u.phone && u.phone.includes(q));
    }
    return true;
  });

  const myGroups = groups.filter(g =>
    g.created_by === currentUser.id || g.member_ids.includes(currentUser.id),
  );

  // ─── Add Modal Handlers ───
  const stopPreview = () => {
    if (previewRef.current) { previewRef.current.stop(); previewRef.current.release(); previewRef.current = null; }
  };

  const openAddModal = () => {
    setAddStep('person');
    setAddSelectedUser(null);
    setAddSelectedReasons(new Set());
    setAddCustomReason('');
    setAddReasonSounds({});
    setAddSoundPickerReason(null);
    setAddPersonSearch('');
    setShowAddModal(true);
  };

  const handleSoundTap = (reason: string, soundId: string) => {
    setAddReasonSounds(prev => ({...prev, [reason]: soundId}));
    stopPreview();
    const file = BUZZ_SOUNDS.find(s => s.id === soundId)?.file || 'buzz_alarm.wav';
    Sound.setCategory('Playback');
    const s = new Sound(file, Sound.MAIN_BUNDLE, err => {
      if (err) return;
      s.setVolume(0.5);
      s.setNumberOfLoops(0);
      s.play(() => { s.release(); if (previewRef.current === s) previewRef.current = null; });
    });
    previewRef.current = s;
  };

  const selectPerson = (u: User) => {
    setAddSelectedUser(u);
    const existing = favorites.find(f => f.userId === u.id);
    setAddSelectedReasons(new Set(existing?.reasons || []));
    setAddReasonSounds(existing?.reasonSounds || {});
    setAddSoundPickerReason(null);
    setAddStep('reasons');
  };

  const toggleReason = (label: string) => {
    const isSelected = addSelectedReasons.has(label);
    const next = new Set(addSelectedReasons);
    if (isSelected) {
      next.delete(label);
      setAddSoundPickerReason(p => p === label ? null : p);
    } else {
      next.add(label);
      setAddSoundPickerReason(label);
    }
    setAddSelectedReasons(next);
  };

  const addCustom = () => {
    const trimmed = addCustomReason.trim();
    if (!trimmed) return;
    const next = new Set(addSelectedReasons);
    next.add(trimmed);
    setAddSelectedReasons(next);
    setAddCustomReason('');
    setAddSoundPickerReason(trimmed);
    setTimeout(() => reasonsScrollRef.current?.scrollTo({y: 0, animated: true}), 100);
  };

  const saveEntry = () => {
    if (!addSelectedUser || addSelectedReasons.size === 0) return;
    stopPreview();
    const reasonsArr = Array.from(addSelectedReasons);
    const updated = favorites.filter(f => f.userId !== addSelectedUser.id);
    updated.push({userId: addSelectedUser.id, reasons: reasonsArr, reasonSounds: addReasonSounds});
    setFavorites(updated);
    upsertFavorite(currentUser.id, addSelectedUser.id, reasonsArr, addReasonSounds).catch(err => {
      console.warn('upsertFavorite failed:', err?.message || JSON.stringify(err));
    });
    setShowAddModal(false);
  };

  const deleteEntry = (userId: string) => {
    const updated = favorites.filter(f => f.userId !== userId);
    setFavorites(updated);
    deleteFavorite(currentUser.id, userId).catch(() => {});
    setDeleteModal(null);
  };

  const availableForAdd = users.filter(u => canBuzz(u));

  const renderUser = ({item}: {item: User}) => {
    const online = isOnline(item);
    return (
      <View style={styles.userRow}>
        <TouchableOpacity style={styles.userLeft} onPress={() => onSelectUser(item)} activeOpacity={0.7}>
          <View style={[styles.avatar, online && styles.avatarOnline]}>
            <Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text>
            <View style={[styles.dot, online ? styles.dotOn : styles.dotOff]} />
          </View>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{item.name}</Text>
            <Text style={styles.userRole}>{item.role}</Text>
          </View>
        </TouchableOpacity>
        <View style={styles.userActions}>
          <TouchableOpacity style={styles.callBtn} onPress={() => onCallUser(item)}>
            <Icon name="call" size={20} color="#4CAF50" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.vmBtn} onPress={() => onVoiceMail(item)}>
            <Icon name="voicemail" size={20} color="#FF9800" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.buzzBtn} onPress={() => onSelectUser(item)}>
            <Text style={styles.buzzBtnText}>Buzz</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={[styles.header, {paddingTop: insets.top + 8}]}>
        <Text style={styles.title}>Buzzer</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerBtn} onPress={toggleMute}>
            <Icon name={muted ? 'volume-off' : 'volume-up'} size={22} color={muted ? '#F44336' : '#888'} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerBtn} onPress={handleOpenHistory}>
            <Text style={styles.headerBtnText}>Log</Text>
            {logCount > 0 && (
              <View style={styles.logBadge}><Text style={styles.logBadgeText}>{logCount}</Text></View>
            )}
          </TouchableOpacity>
          {currentUser.role === 'owner' && (
            <TouchableOpacity style={styles.headerBtn} onPress={onSettings}><Text style={styles.headerBtnText}>Settings</Text></TouchableOpacity>
          )}
          <TouchableOpacity style={styles.profileBtn} onPress={onProfile}>
            <Text style={styles.profileText}>{currentUser.name.charAt(0).toUpperCase()}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabBar}>
        <TouchableOpacity style={[styles.tab, activeTab === 'recent' && styles.tabActive]} onPress={() => scrollToTab('recent')}>
          <Text style={[styles.tabText, activeTab === 'recent' && styles.tabTextActive]}>Favourites</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'people' && styles.tabActive]} onPress={() => scrollToTab('people')}>
          <Text style={[styles.tabText, activeTab === 'people' && styles.tabTextActive]}>People</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'groups' && styles.tabActive]} onPress={() => scrollToTab('groups')}>
          <Text style={[styles.tabText, activeTab === 'groups' && styles.tabTextActive]}>Groups</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tab, activeTab === 'voice' && styles.tabActive]} onPress={() => scrollToTab('voice')}>
          <Text style={[styles.tabText, activeTab === 'voice' && styles.tabTextActive]}>Voice</Text>
          {unreadVoiceCount > 0 && (
            <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{unreadVoiceCount}</Text></View>
          )}
        </TouchableOpacity>
      </View>

      {activeTab === 'people' && (
        <View style={styles.searchBar}>
          <Icon name="search" size={18} color="#888" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search people..."
            placeholderTextColor="#666"
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Icon name="close" size={18} color="#888" />
            </TouchableOpacity>
          )}
        </View>
      )}

      <ScrollView
        ref={pagerRef}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={handleSwipe}
        scrollEventThrottle={16}
        style={{flex: 1}}>

        {/* Recent Tab — Custom Favorites */}
        <ScrollView style={{width: screenWidth}} contentContainerStyle={{paddingBottom: insets.bottom + 20, paddingHorizontal: 12}} showsVerticalScrollIndicator={false} nestedScrollEnabled>
          <TouchableOpacity style={styles.addFavBtn} onPress={openAddModal} activeOpacity={0.7}>
            <Icon name="add-circle" size={22} color="#64B5F6" />
            <Text style={styles.addFavBtnText}>Add Person</Text>
          </TouchableOpacity>

          {favorites.length > 0 ? favorites.map(fav => {
            const targetUser = users.find(u => u.id === fav.userId);
            const name = targetUser?.name || usersMap[fav.userId] || '?';
            const online = targetUser ? isOnline(targetUser) : false;
            return (
              <View key={fav.userId} style={styles.recentCard}>
                <View style={styles.recentCardHeader}>
                  <View style={styles.recentAvatar}>
                    <Text style={styles.recentAvatarText}>{name.charAt(0).toUpperCase()}</Text>
                    <View style={[styles.dot, online ? styles.dotOn : styles.dotOff]} />
                  </View>
                  <Text style={styles.recentCardName}>{name}</Text>
                  {targetUser && (
                    <TouchableOpacity style={styles.recentCallBtn} onPress={() => onCallUser(targetUser)}>
                      <Icon name="call" size={18} color="#4CAF50" />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={styles.recentIconBtn} onPress={() => {
                    if (!targetUser) return;
                    setAddSelectedUser(targetUser);
                    setAddSelectedReasons(new Set(fav.reasons));
                    setAddReasonSounds(fav.reasonSounds || {});
                    setAddSoundPickerReason(null);
                    setAddStep('reasons');
                    setAddCustomReason('');
                    setShowAddModal(true);
                  }}>
                    <Icon name="edit" size={18} color={targetUser ? '#64B5F6' : '#444'} />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.recentIconBtn} onPress={() => setDeleteModal(fav.userId)}>
                    <Icon name="close" size={18} color="#666" />
                  </TouchableOpacity>
                </View>
                {fav.reasons.map(reason => {
                  const rs = fav.reasonSounds?.[reason] || 'buzz_alarm';
                  const rsObj = BUZZ_SOUNDS.find(s => s.id === rs) || BUZZ_SOUNDS[0];
                  return (
                    <View key={reason} style={styles.recentReasonRow}>
                      <Icon name={rsObj.icon} size={14} color={rsObj.color} style={{marginRight: 6}} />
                      <Text style={styles.recentReasonText} numberOfLines={1}>{reason}</Text>
                      {targetUser ? (
                        <TouchableOpacity style={styles.recentBuzzBtn} onPress={() => onBuzzAgain(targetUser, reason, rs)} activeOpacity={0.7}>
                          <Text style={styles.recentBuzzBtnText}>Buzz</Text>
                        </TouchableOpacity>
                      ) : (
                        <Text style={styles.recentUnavailableText}>Unavailable</Text>
                      )}
                    </View>
                  );
                })}
              </View>
            );
          }) : (
            <View style={styles.center}><Text style={styles.emptyText}>Tap + to add people and reasons</Text></View>
          )}
        </ScrollView>

        {/* People Tab */}
        <View style={{width: screenWidth}}>
          <FlatList
            data={buzzableUsers}
            renderItem={renderUser}
            keyExtractor={item => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{paddingBottom: insets.bottom + 20}}
            nestedScrollEnabled
            ListEmptyComponent={
              loading ? (
                <View style={styles.center}><ActivityIndicator color="#FF4D4D" size="large" /></View>
              ) : (
                <View style={styles.center}><Text style={styles.emptyText}>No users available</Text></View>
              )
            }
          />
        </View>

        {/* Groups Tab */}
        <ScrollView style={{width: screenWidth}} contentContainerStyle={{paddingBottom: insets.bottom + 20}} showsVerticalScrollIndicator={false} nestedScrollEnabled>
          {(currentUser.role === 'owner' || currentUser.role === 'manager') && (
            <TouchableOpacity style={styles.createGroupBtn} onPress={onGroups} activeOpacity={0.7}>
              <Icon name="add-circle" size={24} color="#64B5F6" />
              <Text style={styles.createGroupBtnText}>Create Group</Text>
            </TouchableOpacity>
          )}
          {myGroups.length > 0 ? (
            myGroups.map(g => {
              const missed = getGroupMissedCount(g);
              const canBuzzGroup = currentUser.role === 'owner' || currentUser.role === 'manager';
              return (
                <View key={g.id} style={styles.groupRow}>
                  <TouchableOpacity style={styles.groupRowLeft} onPress={onGroups} activeOpacity={0.7}>
                    <View style={styles.groupAvatar}>
                      <Icon name="group" size={24} color="#ccc" />
                    </View>
                    <View style={styles.groupRowInfo}>
                      <Text style={styles.groupRowName}>{g.name}</Text>
                      <Text style={styles.groupRowCount}>{g.member_ids.length} members</Text>
                    </View>
                    {missed > 0 && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{missed}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                  <View style={styles.groupActions}>
                    <TouchableOpacity style={styles.groupInfoBtn} onPress={() => setInfoGroup(g)}>
                      <Icon name="info-outline" size={22} color="#888" />
                    </TouchableOpacity>
                    {canBuzzGroup && (
                      <TouchableOpacity style={styles.buzzBtn} onPress={() => onBuzzGroup(g)}>
                        <Text style={styles.buzzBtnText}>Buzz</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })
          ) : (
            <View style={styles.center}><Text style={styles.emptyText}>No groups</Text></View>
          )}
        </ScrollView>

        {/* Voice Tab */}
        <ScrollView style={{width: screenWidth}} contentContainerStyle={{paddingBottom: insets.bottom + 20}} showsVerticalScrollIndicator={false} nestedScrollEnabled>
          {voiceMails.length > 0 ? (
            voiceMails.map(mail => {
              const isPlaying = playingId === mail.id;
              const senderName = mail.from_user_name || usersMap[mail.from_user_id] || 'Unknown';
              return (
                <TouchableOpacity
                  key={mail.id}
                  style={[styles.voiceRow, !mail.listened && styles.voiceRowUnread]}
                  onPress={() => playVoiceMail(mail)}
                  activeOpacity={0.7}>
                  <View style={styles.voiceAvatar}>
                    <Text style={styles.voiceAvatarText}>{senderName.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={styles.voiceInfo}>
                    <Text style={styles.voiceName}>{senderName}</Text>
                    <Text style={styles.voiceMeta}>{formatDuration(mail.duration_seconds)} · {formatVoiceDate(mail.created_at)}</Text>
                  </View>
                  <View style={[styles.voicePlayBtn, isPlaying && styles.voicePlayBtnActive]}>
                    <Icon name={isPlaying ? 'pause' : 'play-arrow'} size={20} color={isPlaying ? '#fff' : '#ccc'} />
                  </View>
                  <TouchableOpacity style={styles.voiceDeleteBtn} onPress={() => setVoiceDeleteId(mail.id)}>
                    <Icon name="delete-outline" size={20} color="#666" />
                  </TouchableOpacity>
                  {!mail.listened && <View style={styles.voiceUnreadDot} />}
                </TouchableOpacity>
              );
            })
          ) : (
            <View style={styles.center}><Text style={styles.emptyText}>No voice messages</Text></View>
          )}
        </ScrollView>

      </ScrollView>

      {/* Group Info Modal */}
      <Modal visible={!!infoGroup} transparent animationType="fade" onRequestClose={() => setInfoGroup(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{infoGroup?.name}</Text>
              <TouchableOpacity onPress={() => setInfoGroup(null)}>
                <Icon name="close" size={24} color="#888" />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSubtitle}>{infoGroup?.member_ids.length} members · Created by {infoGroup?.created_by === currentUser.id ? 'You' : (users.find(u => u.id === infoGroup?.created_by)?.name || 'Unknown')}</Text>
            <ScrollView style={styles.memberList}>
              {infoGroup?.member_ids.map(id => {
                const member = id === currentUser.id ? currentUser : users.find(u => u.id === id);
                return (
                  <View key={id} style={styles.memberRow}>
                    <View style={styles.memberAvatar}>
                      <Text style={styles.memberAvatarText}>{id === currentUser.id ? 'Y' : (member?.name || '?').charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={styles.memberInfo}>
                      <Text style={styles.memberName}>{id === currentUser.id ? 'You' : (member?.name || 'Unknown')}</Text>
                      <Text style={styles.memberRole}>{member?.role || ''}</Text>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
            {infoGroup && infoGroup.created_by === currentUser.id && (currentUser.role === 'owner' || currentUser.role === 'manager') && (
              <TouchableOpacity style={styles.modalEditBtn} onPress={() => { setInfoGroup(null); onEditGroup(infoGroup); }}>
                <Icon name="edit" size={18} color="#fff" />
                <Text style={styles.modalEditBtnText}>Edit Group</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </Modal>

      {/* Add Person Modal */}
      <Modal visible={showAddModal} transparent animationType="slide" onRequestClose={() => setShowAddModal(false)}>
        <View style={styles.addModalOverlay}>
          <View style={[styles.addModalSheet, {paddingBottom: insets.bottom + 16}]}>
            <View style={styles.addModalHeader}>
              <TouchableOpacity onPress={() => {
                stopPreview();
                if (addStep === 'reasons') { setAddStep('person'); return; }
                setShowAddModal(false);
              }}>
                <Text style={styles.addModalBack}>{addStep === 'reasons' ? '← Back' : 'Cancel'}</Text>
              </TouchableOpacity>
              <Text style={styles.addModalTitle}>{addStep === 'person' ? 'Select Person' : 'Select Reasons'}</Text>
              <View style={{width: 60}} />
            </View>

            {addStep === 'person' ? (
              <>
              <View style={styles.addPersonSearchBar}>
                <Icon name="search" size={18} color="#888" />
                <TextInput
                  style={styles.addPersonSearchInput}
                  placeholder="Search people..."
                  placeholderTextColor="#666"
                  value={addPersonSearch}
                  onChangeText={setAddPersonSearch}
                  autoCorrect={false}
                />
                {addPersonSearch.length > 0 && (
                  <TouchableOpacity onPress={() => setAddPersonSearch('')}>
                    <Icon name="close" size={18} color="#888" />
                  </TouchableOpacity>
                )}
              </View>
              <ScrollView>
                {availableForAdd.filter(u => !addPersonSearch.trim() || u.name.toLowerCase().includes(addPersonSearch.trim().toLowerCase())).length > 0 ? availableForAdd.filter(u => !addPersonSearch.trim() || u.name.toLowerCase().includes(addPersonSearch.trim().toLowerCase())).map(u => (
                  <TouchableOpacity key={u.id} style={styles.addPersonRow} onPress={() => selectPerson(u)} activeOpacity={0.7}>
                    <View style={styles.addPersonAvatar}>
                      <Text style={styles.addPersonAvatarText}>{u.name.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={{flex: 1}}>
                      <Text style={styles.addPersonName}>{u.name}</Text>
                      <Text style={styles.addPersonRole}>{u.role}</Text>
                    </View>
                    {favorites.some(f => f.userId === u.id) && (
                      <Icon name="check-circle" size={20} color="#4CAF50" />
                    )}
                  </TouchableOpacity>
                )) : (
                  <View style={styles.center}><Text style={styles.emptyText}>No people found</Text></View>
                )}
              </ScrollView>
              </>
            ) : (
              <View style={{flex: 1}}>
                <Text style={styles.addReasonLabel}>Add reasons for {addSelectedUser?.name}</Text>

                {/* Custom reason input — prominent at top */}
                <View style={styles.addCustomRow}>
                  <TextInput
                    style={styles.addCustomInput}
                    placeholder="Type a reason and tap +"
                    placeholderTextColor="#666"
                    value={addCustomReason}
                    onChangeText={setAddCustomReason}
                    maxLength={50}
                    returnKeyType="done"
                    onSubmitEditing={addCustom}
                    autoFocus
                  />
                  <TouchableOpacity style={[styles.addCustomBtn, !addCustomReason.trim() && {opacity: 0.3}]} onPress={addCustom} disabled={!addCustomReason.trim()}>
                    <Icon name="add" size={22} color="#fff" />
                  </TouchableOpacity>
                </View>

                {/* Pre-configured reasons from Settings */}
                {reasons.length > 0 && (
                  <Text style={styles.addReasonSectionLabel}>Or select from list</Text>
                )}

                <ScrollView ref={reasonsScrollRef} style={{flex: 1}}>
                  {/* Custom reasons at top */}
                  {Array.from(addSelectedReasons).filter(r => !reasons.some(x => x.label === r)).map(r => {
                    const soundId = addReasonSounds[r] || 'buzz_alarm';
                    const soundObj = BUZZ_SOUNDS.find(s => s.id === soundId) || BUZZ_SOUNDS[0];
                    return (
                      <View key={r}>
                        <View style={[styles.addReasonRow, styles.addReasonRowActive]}>
                          <TouchableOpacity style={{flex: 1}} onPress={() => toggleReason(r)}>
                            <Text style={[styles.addReasonText, styles.addReasonTextActive]}>{r}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.reasonSoundBtn} onPress={() => setAddSoundPickerReason(prev => prev === r ? null : r)}>
                            <Icon name={soundObj.icon} size={14} color={soundObj.color} />
                            <Text style={[styles.reasonSoundBtnText, {color: soundObj.color}]}>{soundObj.label}</Text>
                          </TouchableOpacity>
                        </View>
                        {addSoundPickerReason === r && (
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.reasonSoundPicker} contentContainerStyle={{gap: 6}}>
                            {BUZZ_SOUNDS.map(s => (
                              <TouchableOpacity key={s.id} style={[styles.addSoundChip, soundId === s.id && {backgroundColor: s.color + '20', borderColor: s.color}]} onPress={() => handleSoundTap(r, s.id)}>
                                <Icon name={s.icon} size={14} color={soundId === s.id ? s.color : '#888'} />
                                <Text style={[styles.addSoundChipText, soundId === s.id && {color: s.color}]}>{s.label}</Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        )}
                      </View>
                    );
                  })}
                  {/* Pre-configured reasons */}
                  {reasons.map(r => {
                    const selected = addSelectedReasons.has(r.label);
                    const soundId = addReasonSounds[r.label] || 'buzz_alarm';
                    const soundObj = BUZZ_SOUNDS.find(s => s.id === soundId) || BUZZ_SOUNDS[0];
                    return (
                      <View key={r.id}>
                        <View style={[styles.addReasonRow, selected && styles.addReasonRowActive]}>
                          <TouchableOpacity style={{flex: 1}} onPress={() => toggleReason(r.label)}>
                            <Text style={[styles.addReasonText, selected && styles.addReasonTextActive]}>{r.label}</Text>
                          </TouchableOpacity>
                          {selected && (
                            <TouchableOpacity style={styles.reasonSoundBtn} onPress={() => setAddSoundPickerReason(prev => prev === r.label ? null : r.label)}>
                              <Icon name={soundObj.icon} size={14} color={soundObj.color} />
                              <Text style={[styles.reasonSoundBtnText, {color: soundObj.color}]}>{soundObj.label}</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                        {selected && addSoundPickerReason === r.label && (
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.reasonSoundPicker} contentContainerStyle={{gap: 6}}>
                            {BUZZ_SOUNDS.map(s => (
                              <TouchableOpacity key={s.id} style={[styles.addSoundChip, soundId === s.id && {backgroundColor: s.color + '20', borderColor: s.color}]} onPress={() => handleSoundTap(r.label, s.id)}>
                                <Icon name={s.icon} size={14} color={soundId === s.id ? s.color : '#888'} />
                                <Text style={[styles.addSoundChipText, soundId === s.id && {color: s.color}]}>{s.label}</Text>
                              </TouchableOpacity>
                            ))}
                          </ScrollView>
                        )}
                      </View>
                    );
                  })}
                </ScrollView>

                <TouchableOpacity
                  style={[styles.addSaveBtn, addSelectedReasons.size === 0 && {opacity: 0.4}]}
                  onPress={saveEntry}
                  disabled={addSelectedReasons.size === 0}>
                  <Text style={styles.addSaveBtnText}>Save ({addSelectedReasons.size} reason{addSelectedReasons.size !== 1 ? 's' : ''})</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Delete Confirm Modal */}
      <Modal visible={!!deleteModal} transparent animationType="fade" onRequestClose={() => setDeleteModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.deleteModalBox}>
            <Text style={styles.deleteModalTitle}>Remove</Text>
            <Text style={styles.deleteModalMsg}>Remove this person from your list?</Text>
            <View style={styles.deleteModalBtns}>
              <TouchableOpacity style={styles.deleteModalCancel} onPress={() => setDeleteModal(null)}>
                <Text style={styles.deleteModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteModalConfirm} onPress={() => deleteModal && deleteEntry(deleteModal)}>
                <Text style={styles.deleteModalConfirmText}>Remove</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Voice Delete Confirm Modal */}
      <Modal visible={!!voiceDeleteId} transparent animationType="fade" onRequestClose={() => setVoiceDeleteId(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.deleteModalBox}>
            <Text style={styles.deleteModalTitle}>Delete Voice Message</Text>
            <Text style={styles.deleteModalMsg}>Delete this voice message?</Text>
            <View style={styles.deleteModalBtns}>
              <TouchableOpacity style={styles.deleteModalCancel} onPress={() => setVoiceDeleteId(null)}>
                <Text style={styles.deleteModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.deleteModalConfirm} onPress={() => {
                if (voiceDeleteId) {
                  if (playingId === voiceDeleteId) { soundRef.current?.stop(); soundRef.current?.release(); soundRef.current = null; setPlayingId(null); }
                  deleteVoiceMail(voiceDeleteId).catch(() => {});
                }
                setVoiceDeleteId(null);
              }}>
                <Text style={styles.deleteModalConfirmText}>Delete</Text>
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
  title: {fontSize: 28, fontWeight: '800', color: '#FF4D4D'},
  headerRight: {flexDirection: 'row', gap: 8, alignItems: 'center'},
  headerBtn: {backgroundColor: '#1A1A1A', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 4},
  headerBtnText: {color: '#aaa', fontSize: 14, fontWeight: '600'},
  logBadge: {backgroundColor: '#FF4D4D', minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4},
  logBadgeText: {color: '#fff', fontSize: 10, fontWeight: '800'},
  profileBtn: {width: 36, height: 36, borderRadius: 18, backgroundColor: '#FF4D4D', alignItems: 'center', justifyContent: 'center'},
  profileText: {color: '#fff', fontSize: 18, fontWeight: '800'},

  tabBar: {flexDirection: 'row', paddingHorizontal: 12, marginBottom: 8, gap: 6},
  tab: {flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: '#1A1A1A', flexDirection: 'row', justifyContent: 'center', gap: 4},
  tabActive: {backgroundColor: '#1a2a3a', borderWidth: 1, borderColor: '#64B5F6'},
  tabText: {color: '#888', fontSize: 13, fontWeight: '600'},
  tabTextActive: {color: '#64B5F6', fontWeight: '700'},
  tabBadge: {backgroundColor: '#FF4D4D', minWidth: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4},
  tabBadgeText: {color: '#fff', fontSize: 10, fontWeight: '800'},

  searchBar: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#1A1A1A', marginHorizontal: 16, borderRadius: 10, paddingHorizontal: 12, height: 42, gap: 8, marginBottom: 12},
  searchInput: {flex: 1, color: '#fff', fontSize: 18, padding: 0},

  // Recent tab
  addFavBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4, marginBottom: 12, padding: 14, backgroundColor: '#1A1A1A', borderRadius: 12, borderWidth: 1, borderColor: '#333', borderStyle: 'dashed'},
  addFavBtnText: {color: '#64B5F6', fontSize: 15, fontWeight: '700'},

  recentCard: {backgroundColor: '#1A1A1A', borderRadius: 14, marginBottom: 10, padding: 14, borderWidth: 1, borderColor: '#252525'},
  recentCardHeader: {flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4},
  recentCardName: {color: '#fff', fontSize: 16, fontWeight: '700', flex: 1},
  recentCallBtn: {width: 34, height: 34, borderRadius: 17, backgroundColor: '#1a3a1a', alignItems: 'center', justifyContent: 'center'},
  recentIconBtn: {width: 34, height: 34, borderRadius: 17, backgroundColor: '#252525', alignItems: 'center', justifyContent: 'center'},
  recentReasonRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: '#252525'},
  recentReasonText: {color: '#ccc', fontSize: 14, fontWeight: '500', flex: 1},
  recentBuzzBtn: {paddingHorizontal: 12, paddingVertical: 5, borderRadius: 6, backgroundColor: '#1a3a1a'},
  recentBuzzBtnText: {color: '#4CAF50', fontSize: 14, fontWeight: '700'},
  recentUnavailableText: {color: '#555', fontSize: 14, fontWeight: '600'},
  recentAvatar: {width: 38, height: 38, borderRadius: 19, backgroundColor: '#252525', alignItems: 'center', justifyContent: 'center'},
  recentAvatarText: {color: '#fff', fontSize: 18, fontWeight: '700'},

  // Groups
  groupRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10},
  groupRowLeft: {flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1},
  groupAvatar: {width: 42, height: 42, borderRadius: 21, backgroundColor: '#252525', alignItems: 'center', justifyContent: 'center'},
  groupRowInfo: {flex: 1},
  groupRowName: {color: '#fff', fontSize: 16, fontWeight: '600'},
  groupRowCount: {color: '#999', fontSize: 13, marginTop: 1},

  // People
  userRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10},
  userLeft: {flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1},
  avatar: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#252525', alignItems: 'center', justifyContent: 'center', position: 'relative'},
  avatarOnline: {backgroundColor: '#1a3a1a'},
  avatarText: {color: '#fff', fontSize: 18, fontWeight: '700'},
  dot: {position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: '#0D0D0D'},
  dotOn: {backgroundColor: '#4CAF50'},
  dotOff: {backgroundColor: '#444'},
  userInfo: {flex: 1},
  userName: {color: '#fff', fontSize: 16, fontWeight: '600'},
  userRole: {color: '#999', fontSize: 13, marginTop: 1, textTransform: 'capitalize'},
  userActions: {flexDirection: 'row', gap: 6, alignItems: 'center'},
  callBtn: {width: 36, height: 36, borderRadius: 18, backgroundColor: '#1a3a1a', alignItems: 'center', justifyContent: 'center'},
  vmBtn: {width: 36, height: 36, borderRadius: 18, backgroundColor: '#2a1515', alignItems: 'center', justifyContent: 'center'},
  buzzBtn: {backgroundColor: '#4CAF50', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8},
  buzzBtnText: {color: '#fff', fontSize: 14, fontWeight: '700'},

  badge: {backgroundColor: '#FF4D4D', minWidth: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5},
  badgeText: {color: '#fff', fontSize: 12, fontWeight: '800'},
  groupActions: {flexDirection: 'row', gap: 8, alignItems: 'center'},
  groupInfoBtn: {width: 34, height: 34, borderRadius: 17, backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center'},
  createGroupBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 16, marginTop: 8, marginBottom: 12, padding: 14, backgroundColor: '#1A1A1A', borderRadius: 12, borderWidth: 1, borderColor: '#333', borderStyle: 'dashed'},
  createGroupBtnText: {color: '#64B5F6', fontSize: 15, fontWeight: '700'},

  // Modals
  modalOverlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32},
  modalBox: {backgroundColor: '#1A1A1A', borderRadius: 20, padding: 20, width: '100%', maxHeight: '60%', borderWidth: 1, borderColor: '#333'},
  modalHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4},
  modalTitle: {color: '#fff', fontSize: 22, fontWeight: '800'},
  modalSubtitle: {color: '#888', fontSize: 14, marginBottom: 16},
  memberList: {maxHeight: 300},
  memberRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#252525'},
  memberAvatar: {width: 38, height: 38, borderRadius: 19, backgroundColor: '#252525', alignItems: 'center', justifyContent: 'center', marginRight: 12},
  memberAvatarText: {color: '#fff', fontSize: 18, fontWeight: '700'},
  memberInfo: {flex: 1},
  memberName: {color: '#fff', fontSize: 16, fontWeight: '600'},
  memberRole: {color: '#999', fontSize: 13, textTransform: 'capitalize'},
  modalEditBtn: {flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FF9800', paddingVertical: 12, borderRadius: 12, marginTop: 12},
  modalEditBtnText: {color: '#fff', fontSize: 18, fontWeight: '700'},

  // Voice
  voiceRow: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1A1A1A'},
  voiceRowUnread: {borderLeftWidth: 3, borderLeftColor: '#FF4D4D'},
  voiceAvatar: {width: 44, height: 44, borderRadius: 22, backgroundColor: '#252525', alignItems: 'center', justifyContent: 'center', marginRight: 12},
  voiceAvatarText: {color: '#fff', fontSize: 18, fontWeight: '700'},
  voiceInfo: {flex: 1},
  voiceName: {color: '#fff', fontSize: 16, fontWeight: '600'},
  voiceMeta: {color: '#999', fontSize: 12, marginTop: 2},
  voicePlayBtn: {width: 36, height: 36, borderRadius: 18, backgroundColor: '#1A1A1A', alignItems: 'center', justifyContent: 'center'},
  voicePlayBtnActive: {backgroundColor: '#FF4D4D'},
  voiceDeleteBtn: {width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginLeft: 4},
  voiceUnreadDot: {width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF4D4D', position: 'absolute', top: 10, right: 10},

  // Add Modal
  addModalOverlay: {flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end'},
  addModalSheet: {backgroundColor: '#1A1A1A', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 16, paddingHorizontal: 20, minHeight: '60%', maxHeight: '85%'},
  addModalHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16},
  addModalBack: {color: '#FF4D4D', fontSize: 18, fontWeight: '600'},
  addModalTitle: {color: '#fff', fontSize: 18, fontWeight: '800'},
  addPersonSearchBar: {flexDirection: 'row', alignItems: 'center', backgroundColor: '#252525', borderRadius: 10, paddingHorizontal: 12, height: 40, gap: 8, marginBottom: 12},
  addPersonSearchInput: {flex: 1, color: '#fff', fontSize: 15, padding: 0},
  addPersonRow: {flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#252525'},
  addPersonAvatar: {width: 40, height: 40, borderRadius: 20, backgroundColor: '#252525', alignItems: 'center', justifyContent: 'center', marginRight: 12},
  addPersonAvatarText: {color: '#fff', fontSize: 18, fontWeight: '700'},
  addPersonName: {color: '#fff', fontSize: 16, fontWeight: '600'},
  addPersonRole: {color: '#999', fontSize: 13, textTransform: 'capitalize'},
  addReasonLabel: {color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 14},
  addReasonSectionLabel: {color: '#666', fontSize: 12, fontWeight: '700', letterSpacing: 1, marginTop: 16, marginBottom: 8},
  addReasonRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14, backgroundColor: '#252525', borderRadius: 10, marginBottom: 6},
  addReasonRowActive: {backgroundColor: '#2a1515', borderWidth: 1, borderColor: '#FF4D4D'},
  addReasonText: {color: '#ccc', fontSize: 15},
  addReasonTextActive: {color: '#FF4D4D', fontWeight: '600'},
  addCustomRow: {flexDirection: 'row', gap: 10, marginBottom: 12},
  addCustomInput: {flex: 1, backgroundColor: '#252525', color: '#fff', fontSize: 18, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: '#444'},
  addCustomBtn: {backgroundColor: '#FF4D4D', width: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center'},
  reasonSoundBtn: {flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#1A1A1A', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6},
  reasonSoundBtnText: {fontSize: 11, fontWeight: '600'},
  reasonSoundPicker: {maxHeight: 40, marginBottom: 6, marginTop: 2, paddingHorizontal: 4},
  addSoundChip: {flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#252525', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, borderColor: '#333'},
  addSoundChipText: {color: '#888', fontSize: 11, fontWeight: '600'},
  addSaveBtn: {backgroundColor: '#4CAF50', paddingVertical: 14, borderRadius: 12, alignItems: 'center'},
  addSaveBtnText: {color: '#fff', fontSize: 18, fontWeight: '700'},

  // Delete Modal
  deleteModalBox: {backgroundColor: '#1A1A1A', borderRadius: 20, padding: 28, width: '100%', alignItems: 'center', borderWidth: 1, borderColor: '#333'},
  deleteModalTitle: {color: '#fff', fontSize: 20, fontWeight: '800', marginBottom: 8},
  deleteModalMsg: {color: '#888', fontSize: 18, textAlign: 'center', marginBottom: 24},
  deleteModalBtns: {flexDirection: 'row', gap: 12, width: '100%'},
  deleteModalCancel: {flex: 1, backgroundColor: '#252525', paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: '#333'},
  deleteModalCancelText: {color: '#ccc', fontSize: 18, fontWeight: '700'},
  deleteModalConfirm: {flex: 1, backgroundColor: '#F44336', paddingVertical: 14, borderRadius: 12, alignItems: 'center'},
  deleteModalConfirmText: {color: '#fff', fontSize: 18, fontWeight: '700'},

  center: {flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60},
  emptyText: {color: '#999', fontSize: 16},
});

export default HomeScreen;
