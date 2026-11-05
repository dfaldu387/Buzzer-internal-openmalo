import React, {useState, useEffect, useCallback, useRef, useMemo} from 'react';
import {View, Text, TouchableOpacity, StyleSheet, FlatList, ActivityIndicator, Alert} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {GestureHandlerRootView, Swipeable} from 'react-native-gesture-handler';
import Icon from 'react-native-vector-icons/MaterialIcons';
import {Buzz, User} from '../types';
import {getBuzzLogPage, getUsers, deleteBuzzes} from '../services/firebase';
import {useGroups} from '../hooks/useGroups';

type DisplayItem =
  | {type: 'single'; buzz: Buzz; id: string}
  | {type: 'group'; buzzes: Buzz[]; groupName: string; id: string};

interface Props {
  currentUser: User;
  onBack: () => void;
}

const RESPONSE_MAP: Record<string, {label: string; color: string; icon: string}> = {
  ack: {label: 'Acknowledged', color: '#4CAF50', icon: 'check-circle'},
  five_min: {label: '5 minutes', color: '#FF9800', icon: 'timer'},
  busy: {label: 'Busy', color: '#F44336', icon: 'cancel'},
  cancelled: {label: 'Cancelled', color: '#888', icon: 'block'},
  dismissed: {label: 'Dismissed', color: '#9C27B0', icon: 'visibility'},
  none: {label: 'No response', color: '#555', icon: '—'},
};

const groupBuzzes = (buzzes: Buzz[], groupsMap: Record<string, string>): DisplayItem[] => {
  const items: DisplayItem[] = [];
  const used = new Set<string>();

  for (const buzz of buzzes) {
    if (used.has(buzz.id)) continue;

    // Check if this is a group buzz (has group_id, or shares from_user_id + created_at with others)
    let groupKey: string | null = null;
    if (buzz.group_id) {
      groupKey = `${buzz.group_id}_${buzz.created_at}`;
    } else {
      // Heuristic for old data: same sender + exact same timestamp = group buzz
      const siblings = buzzes.filter(
        b => !used.has(b.id) && b.from_user_id === buzz.from_user_id && b.created_at === buzz.created_at && b.id !== buzz.id,
      );
      if (siblings.length > 0) {
        groupKey = `${buzz.from_user_id}_${buzz.created_at}`;
      }
    }

    if (groupKey) {
      const related = buzzes.filter(
        b => !used.has(b.id) && (
          (buzz.group_id && b.group_id === buzz.group_id && b.created_at === buzz.created_at) ||
          (!buzz.group_id && b.from_user_id === buzz.from_user_id && b.created_at === buzz.created_at)
        ),
      );
      related.forEach(b => used.add(b.id));
      const groupName = buzz.group_name || (buzz.group_id && groupsMap[buzz.group_id]) || `Group (${related.length} members)`;
      items.push({type: 'group', buzzes: related, groupName, id: groupKey});
    } else {
      used.add(buzz.id);
      items.push({type: 'single', buzz, id: buzz.id});
    }
  }
  return items;
};

const HistoryScreen: React.FC<Props> = ({currentUser, onBack}) => {
  const insets = useSafeAreaInsets();
  const [buzzes, setBuzzes] = useState<Buzz[]>([]);
  const [usersMap, setUsersMap] = useState<Record<string, string>>({});
  const {groups} = useGroups();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<string>('all');
  const [hasMore, setHasMore] = useState(true);
  const lastDocRef = useRef<any>(null);

  const groupsMap: Record<string, string> = {};
  groups.forEach(g => { groupsMap[g.id] = g.name; });

  const filterCounts = useMemo(() => ({
    all: buzzes.length,
    ack: buzzes.filter(b => b.response === 'ack').length,
    five_min: buzzes.filter(b => b.response === 'five_min').length,
    busy: buzzes.filter(b => b.response === 'busy').length,
    escalated: buzzes.filter(b => b.escalated).length,
  }), [buzzes]);

  useEffect(() => {
    const load = async () => {
      try {
        const [page, userList] = await Promise.all([
          getBuzzLogPage(0, currentUser.id),
          getUsers(),
        ]);
        setBuzzes(page.buzzes);
        lastDocRef.current = page.lastDoc;
        setHasMore(page.hasMore);
        const map: Record<string, string> = {};
        userList.forEach(u => { map[u.id] = u.name; });
        setUsersMap(map);
      } catch (err) {
        console.warn('Failed to load buzz log:', err);
      }
      setLoading(false);
    };
    load();
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const page = await getBuzzLogPage(lastDocRef.current, currentUser.id);
      setBuzzes(prev => [...prev, ...page.buzzes]);
      lastDocRef.current = page.lastDoc;
      setHasMore(page.hasMore);
    } catch (err) {
      console.warn('Failed to load more buzzes:', err);
    }
    setLoadingMore(false);
  }, [loadingMore, hasMore]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    const time = d.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    if (isToday) return `Today, ${time}`;
    if (isYesterday) return `Yesterday, ${time}`;
    return `${d.toLocaleDateString([], {month: 'short', day: 'numeric'})} ${time}`;
  };

  const responseTime = (buzz: Buzz) => {
    if (!buzz.responded_at) return '';
    const diff = Math.round((buzz.responded_at - buzz.created_at) / 1000);
    return diff < 60 ? `${diff}s` : `${Math.floor(diff / 60)}m ${diff % 60}s`;
  };

  const swipeableRefs = useRef<Record<string, Swipeable | null>>({});
  const [pendingDelete, setPendingDelete] = useState<{buzzIds: string[]; timer: ReturnType<typeof setTimeout>} | null>(null);

  const handleDeleteItem = (item: DisplayItem) => {
    const buzzIds = item.type === 'group' ? item.buzzes.map(b => b.id) : [item.buzz.id];
    swipeableRefs.current[item.id]?.close();

    // Remove from UI immediately (soft delete)
    setBuzzes(prev => prev.filter(b => !buzzIds.includes(b.id)));

    // Cancel any existing pending delete
    if (pendingDelete) {
      clearTimeout(pendingDelete.timer);
      deleteBuzzes(pendingDelete.buzzIds).catch(() => {});
    }

    // Schedule permanent delete after 5 seconds
    const timer = setTimeout(() => {
      deleteBuzzes(buzzIds).catch(err => console.warn('Delete failed:', err));
      setPendingDelete(null);
    }, 5000);
    setPendingDelete({buzzIds, timer});
  };

  const handleUndoDelete = () => {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timer);
    // Re-fetch to restore — simpler and guarantees consistency
    const reload = async () => {
      try {
        const page = await getBuzzLogPage(0, currentUser.id);
        setBuzzes(page.buzzes);
        lastDocRef.current = page.lastDoc;
        setHasMore(page.hasMore);
      } catch {}
    };
    reload();
    setPendingDelete(null);
  };

  // Commit pending delete on unmount (user navigated away)
  const pendingDeleteRef = useRef(pendingDelete);
  pendingDeleteRef.current = pendingDelete;
  useEffect(() => {
    return () => {
      if (pendingDeleteRef.current) {
        clearTimeout(pendingDeleteRef.current.timer);
        deleteBuzzes(pendingDeleteRef.current.buzzIds).catch(() => {});
      }
    };
  }, []);

  const renderDeleteAction = () => (
    <TouchableOpacity style={styles.deleteAction} activeOpacity={0.8}>
      <Icon name="delete" size={24} color="#fff" />
    </TouchableOpacity>
  );

  const renderSingleBuzz = (buzz: Buzz) => {
    const resp = RESPONSE_MAP[buzz.response] || RESPONSE_MAP.none;
    const fromName = buzz.from_user_id === currentUser.id ? 'You' : (usersMap[buzz.from_user_id] || '?');
    const toName = buzz.to_user_id === currentUser.id ? 'You' : (usersMap[buzz.to_user_id] || '?');
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.avatarRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{fromName.charAt(0)}</Text>
            </View>
            <Text style={styles.arrow}>→</Text>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{toName.charAt(0)}</Text>
            </View>
            <View style={styles.namesCol}>
              <Text style={styles.names} numberOfLines={1}>{fromName} → {toName}</Text>
              <Text style={styles.time}>{formatTime(buzz.created_at)}</Text>
            </View>
          </View>
          {buzz.escalated && (
            <View style={styles.escalatedBadge}>
              <Text style={styles.escalatedText}>ESCALATED</Text>
            </View>
          )}
        </View>
        <View style={styles.reasonRow}>
          <Text style={styles.reason}>{buzz.reason}</Text>
          {buzz.note && buzz.note !== 'null' ? <Text style={styles.note}>{buzz.note}</Text> : null}
        </View>
        <View style={styles.responseRow}>
          <View style={[styles.responseBadge, {backgroundColor: resp.color + '20', borderColor: resp.color + '40'}]}>
            <Icon name={resp.icon} size={14} color={resp.color} />
            <Text style={[styles.responseLabel, {color: resp.color}]}>{resp.label}</Text>
          </View>
          {responseTime(buzz) ? (
            <Text style={styles.responseTime}>Responded in {responseTime(buzz)}</Text>
          ) : null}
        </View>
      </View>
    );
  };

  const renderGroupBuzz = (buzzes: Buzz[], groupName: string) => {
    const first = buzzes[0];
    const fromName = first.from_user_id === currentUser.id ? 'You' : (usersMap[first.from_user_id] || '?');
    const respondedCount = buzzes.filter(b => b.response !== 'none').length;
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.avatarRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{fromName.charAt(0)}</Text>
            </View>
            <Text style={styles.arrow}>→</Text>
            <View style={[styles.avatar, {backgroundColor: '#252525'}]}>
              <Icon name="group" size={16} color="#ccc" />
            </View>
            <View style={styles.namesCol}>
              <Text style={styles.names} numberOfLines={1}>{fromName} → {groupName}</Text>
              <Text style={styles.time}>{formatTime(first.created_at)}</Text>
            </View>
          </View>
        </View>
        <View style={styles.reasonRow}>
          <Text style={styles.reason}>{first.reason}</Text>
          {first.note && first.note !== 'null' ? <Text style={styles.note}>{first.note}</Text> : null}
        </View>
        <View style={styles.groupResponseSummary}>
          {buzzes.map(b => {
            const resp = RESPONSE_MAP[b.response] || RESPONSE_MAP.none;
            const memberName = b.to_user_id === currentUser.id ? 'You' : (usersMap[b.to_user_id] || '?');
            return (
              <View key={b.id} style={styles.groupMemberResponse}>
                <Text style={styles.groupMemberName} numberOfLines={1}>{memberName}</Text>
                <View style={[styles.responseBadge, {backgroundColor: resp.color + '20', borderColor: resp.color + '40'}]}>
                  <Icon name={resp.icon} size={12} color={resp.color} />
                  <Text style={[styles.responseLabel, {color: resp.color, fontSize: 11}]}>{resp.label}</Text>
                </View>
              </View>
            );
          })}
          <Text style={styles.groupRespondedCount}>{respondedCount}/{buzzes.length} responded</Text>
        </View>
      </View>
    );
  };

  const renderItem = ({item}: {item: DisplayItem}) => {
    const content = item.type === 'group'
      ? renderGroupBuzz(item.buzzes, item.groupName)
      : renderSingleBuzz(item.buzz);
    return (
      <Swipeable
        ref={ref => { swipeableRefs.current[item.id] = ref; }}
        renderRightActions={renderDeleteAction}
        onSwipeableOpen={() => handleDeleteItem(item)}
        overshootRight={false}
      >
        {content}
      </Swipeable>
    );
  };

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator color="#FF4D4D" size="small" />
      </View>
    );
  };

  return (
    <GestureHandlerRootView style={styles.container}>
      <View style={[styles.header, {paddingTop: insets.top + 12}]}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>My Buzzes</Text>
        <View style={styles.periodBadge}>
          <Text style={styles.periodText}>7 days</Text>
        </View>
      </View>
      <View style={styles.filterBar}>
        <TouchableOpacity style={[styles.filterChip, filter === 'all' && styles.filterChipActive]} onPress={() => setFilter('all')}>
          <Text style={[styles.filterChipText, filter === 'all' && styles.filterChipTextActive]}>All ({filterCounts.all})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.filterChip, filter === 'ack' && {backgroundColor: '#4CAF5030', borderColor: '#4CAF50'}]} onPress={() => setFilter('ack')}>
          <Text style={[styles.filterChipText, filter === 'ack' && {color: '#4CAF50'}]}>Ack ({filterCounts.ack})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.filterChip, filter === 'five_min' && {backgroundColor: '#FF980030', borderColor: '#FF9800'}]} onPress={() => setFilter('five_min')}>
          <Text style={[styles.filterChipText, filter === 'five_min' && {color: '#FF9800'}]}>5 min ({filterCounts.five_min})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.filterChip, filter === 'busy' && {backgroundColor: '#F4433630', borderColor: '#F44336'}]} onPress={() => setFilter('busy')}>
          <Text style={[styles.filterChipText, filter === 'busy' && {color: '#F44336'}]}>Busy ({filterCounts.busy})</Text>
        </TouchableOpacity>
        {filterCounts.escalated > 0 && (
          <TouchableOpacity style={[styles.filterChip, filter === 'escalated' && {backgroundColor: '#FF980030', borderColor: '#FF9800'}]} onPress={() => setFilter('escalated')}>
            <Text style={[styles.filterChipText, filter === 'escalated' && {color: '#FF9800'}]}>Escalated ({filterCounts.escalated})</Text>
          </TouchableOpacity>
        )}
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color="#FF4D4D" size="large" /></View>
      ) : buzzes.length === 0 ? (
        <View style={styles.center}>
          <Icon name="inbox" size={48} color="#888" style={{marginBottom: 12}} />
          <Text style={styles.emptyText}>No buzzes in the last 7 days</Text>
        </View>
      ) : (
        <FlatList
          data={groupBuzzes(filter === 'all' ? buzzes : filter === 'escalated' ? buzzes.filter(b => b.escalated) : buzzes.filter(b => b.response === filter), groupsMap)}
          renderItem={renderItem}
          keyExtractor={item => item.id}
          contentContainerStyle={[styles.list, {paddingBottom: insets.bottom + 24}]}
          showsVerticalScrollIndicator={false}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          ListFooterComponent={renderFooter}
        />
      )}
      {pendingDelete && (
        <View style={styles.undoBar}>
          <Text style={styles.undoText}>Log deleted</Text>
          <TouchableOpacity onPress={handleUndoDelete}>
            <Text style={styles.undoButton}>UNDO</Text>
          </TouchableOpacity>
        </View>
      )}
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  container: {flex: 1, backgroundColor: '#0D0D0D'},
  header: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#1A1A1A'},
  backButton: {paddingVertical: 4},
  backBtn: {color: '#FF4D4D', fontSize: 22, fontWeight: '700'},
  headerTitle: {color: '#fff', fontSize: 22, fontWeight: '800'},
  periodBadge: {backgroundColor: '#1A1A1A', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12},
  periodText: {color: '#888', fontSize: 13, fontWeight: '600'},
  filterBar: {flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#1A1A1A'},
  filterChip: {paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#333', backgroundColor: '#1A1A1A'},
  filterChipActive: {backgroundColor: '#3a1515', borderColor: '#FF4D4D'},
  filterChipText: {color: '#888', fontSize: 13, fontWeight: '700'},
  filterChipTextActive: {color: '#FF4D4D'},
  center: {flex: 1, alignItems: 'center', justifyContent: 'center'},
  emptyText: {color: '#999', fontSize: 17},
  list: {paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24},
  card: {backgroundColor: '#1A1A1A', borderRadius: 14, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: '#252525'},
  cardHeader: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10},
  avatarRow: {flexDirection: 'row', alignItems: 'center', flex: 1},
  avatar: {width: 34, height: 34, borderRadius: 17, backgroundColor: '#333', alignItems: 'center', justifyContent: 'center'},
  avatarText: {color: '#fff', fontSize: 18, fontWeight: '700'},
  arrow: {color: '#888', fontSize: 18, marginHorizontal: 6},
  namesCol: {marginLeft: 10, flex: 1},
  names: {color: '#fff', fontSize: 15, fontWeight: '700'},
  time: {color: '#999', fontSize: 12, marginTop: 1},
  escalatedBadge: {backgroundColor: '#FF980020', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6},
  escalatedText: {color: '#FF9800', fontSize: 11, fontWeight: '800', letterSpacing: 0.5},
  reasonRow: {marginBottom: 10},
  reason: {color: '#ccc', fontSize: 15},
  note: {color: '#888', fontSize: 13, fontStyle: 'italic', marginTop: 2},
  responseRow: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  responseBadge: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1},
  responseIcon: {fontSize: 18, fontWeight: '700', marginRight: 6},
  responseLabel: {fontSize: 13, fontWeight: '700'},
  responseTime: {color: '#999', fontSize: 13},
  groupResponseSummary: {gap: 6},
  groupMemberResponse: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4},
  groupMemberName: {color: '#ccc', fontSize: 14, fontWeight: '600', flex: 1},
  groupRespondedCount: {color: '#999', fontSize: 12, textAlign: 'right', marginTop: 4},
  footerLoader: {paddingVertical: 20, alignItems: 'center'},
  deleteAction: {backgroundColor: '#F44336', justifyContent: 'center', alignItems: 'center', width: 70, borderRadius: 14, marginBottom: 10},
  undoBar: {position: 'absolute', bottom: 30, left: 16, right: 16, backgroundColor: '#333', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'},
  undoText: {color: '#fff', fontSize: 15, fontWeight: '600'},
  undoButton: {color: '#FF4D4D', fontSize: 15, fontWeight: '800'},
});

export default HistoryScreen;
