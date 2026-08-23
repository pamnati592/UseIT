import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ChatsStackParamList } from '../navigation/ChatsStackNavigator';
import { useConversations, type ConversationRow, type SupportThreadRow } from '../contexts/ConversationsContext';
import { useAdminMode } from '../contexts/AdminModeContext';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { MessageCircle, Package, Key, ShieldCheck } from 'lucide-react-native';

type RoleTab = 'renting' | 'lending';

type FeedRow =
  | { kind: 'conversation'; key: string; conv: ConversationRow }
  | { kind: 'support'; key: string; thread: SupportThreadRow };

type AdminThreadRow = {
  id: string;
  transaction_id: string;
  user_id: string;
  user_name: string;
  role: 'renter' | 'lender';
  item_title: string;
  last_message: string | null;
  last_message_at: string | null;
  admin_last_read_at: string | null;
};

type Props = {
  navigation: NativeStackNavigationProp<ChatsStackParamList, 'ConversationsList'>;
};

export default function ChatsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [roleTab, setRoleTab] = useState<RoleTab>('renting');
  const { isAdmin, adminModeActive, enterAdminMode, exitAdminMode } = useAdminMode();
  const [adminThreads, setAdminThreads] = useState<AdminThreadRow[]>([]);
  const [adminThreadsLoading, setAdminThreadsLoading] = useState(false);

  // All conversation data and unread state comes from the single shared
  // context (ConversationsProvider, mounted once at the app root) — the same
  // live-updating source the bottom tab badge reads from, so this screen's
  // role-tab badges and green dots can never drift out of sync with it.
  const {
    currentUserId, loading,
    rentingConversations, lendingConversations,
    rentingSupportThreads, lendingSupportThreads,
    rentingUnreadCount, lendingUnreadCount,
    isUnread, isSupportThreadUnread, reload,
  } = useConversations();

  // Safety net matching the one already used in ChatRoomScreen: catches
  // anything the realtime subscription might have missed (socket drop,
  // app backgrounded) by re-syncing whenever this screen regains focus.
  useFocusEffect(useCallback(() => { reload(); }, [reload]));

  const loadAdminThreads = useCallback(async () => {
    setAdminThreadsLoading(true);
    const { data, error } = await supabase.rpc('admin_list_support_threads');
    if (!error) setAdminThreads((data as AdminThreadRow[]) ?? []);
    setAdminThreadsLoading(false);
  }, []);

  // Admin Mode is a whole-app state (see AdminModeContext) — this screen is
  // the one thing it actually changes: while active, Chats shows every
  // support thread platform-wide (split Renters/Lenders) instead of your
  // own personal rentals. Requested 2026-08-19: not a nested admin screen,
  // the Chats tab itself transforms — "you're in the shoes of admin," not
  // doing anything as yourself. Reload both on focus (screen re-entered)
  // and the moment the mode flips on while already sitting here.
  useFocusEffect(useCallback(() => {
    if (isAdmin && adminModeActive) loadAdminThreads();
  }, [isAdmin, adminModeActive, loadAdminThreads]));

  useEffect(() => {
    if (isAdmin && adminModeActive) loadAdminThreads();
  }, [isAdmin, adminModeActive, loadAdminThreads]);

  function otherName(conv: ConversationRow): string {
    if (!currentUserId) return '';
    return conv.renter_id === currentUserId ? conv.lender_name : conv.renter_name;
  }

  function isAdminThreadUnread(t: AdminThreadRow): boolean {
    if (!t.last_message_at) return false;
    if (!t.admin_last_read_at) return true;
    return new Date(t.last_message_at) > new Date(t.admin_last_read_at);
  }

  const showAdminInbox = isAdmin && adminModeActive;
  const adminRole: 'renter' | 'lender' = roleTab === 'renting' ? 'renter' : 'lender';
  const visibleAdminThreads = adminThreads.filter(t => t.role === adminRole);
  const adminRenterUnread = adminThreads.filter(t => t.role === 'renter' && isAdminThreadUnread(t)).length;
  const adminLenderUnread = adminThreads.filter(t => t.role === 'lender' && isAdminThreadUnread(t)).length;

  const visibleConvs = roleTab === 'renting' ? rentingConversations : lendingConversations;
  const visibleThreads = roleTab === 'renting' ? rentingSupportThreads : lendingSupportThreads;

  // Support threads are folded into the same list as real conversations,
  // sorted by whichever actually had activity most recently — a UseIT reply
  // competes for attention the same way a message from the other party does,
  // rather than living in a separate, easy-to-forget place.
  const feedRows: FeedRow[] = useMemo(() => {
    const rows: FeedRow[] = [
      ...visibleConvs.map((conv): FeedRow => ({ kind: 'conversation', key: `c-${conv.id}`, conv })),
      ...visibleThreads.map((thread): FeedRow => ({ kind: 'support', key: `s-${thread.id}`, thread })),
    ];
    const activityOf = (row: FeedRow) => {
      const iso = row.kind === 'conversation' ? row.conv.last_message_at : row.thread.lastMessageAt;
      return iso ? new Date(iso).getTime() : 0;
    };
    return rows.sort((a, b) => activityOf(b) - activityOf(a));
  }, [visibleConvs, visibleThreads]);

  function formatTime(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color={colors.text} style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  function renderAdminItem({ item: t }: { item: AdminThreadRow }) {
    const unread = isAdminThreadUnread(t);
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => navigation.navigate('SupportThread', {
          threadId: t.id,
          title: `${t.user_name} · ${t.item_title}`,
        })}
      >
        <View style={[styles.avatar, styles.supportAvatar]}>
          <ShieldCheck size={22} color={colors.primary} />
          {unread && <View style={styles.avatarDot} />}
        </View>
        <View style={styles.rowContent}>
          <View style={styles.rowTop}>
            <Text style={[styles.userName, unread && styles.userNameUnread]} numberOfLines={1}>{t.user_name}</Text>
            <Text style={[styles.time, unread && styles.timeUnread]}>{formatTime(t.last_message_at)}</Text>
          </View>
          <View style={styles.itemTitleRow}>
            <Package size={12} color={colors.textMuted} />
            <Text style={styles.itemTitle} numberOfLines={1}>{t.item_title}</Text>
          </View>
          <Text style={[styles.lastMessage, unread && styles.lastMessageUnread]} numberOfLines={1}>
            {t.last_message ?? 'No messages yet'}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>{showAdminInbox ? 'Support Inbox' : 'Chats'}</Text>
        {isAdmin && (
          <TouchableOpacity
            style={[styles.supportInboxBtn, adminModeActive && styles.supportInboxBtnActive]}
            onPress={() => (adminModeActive ? exitAdminMode() : enterAdminMode())}
          >
            <ShieldCheck size={22} color={adminModeActive ? colors.btnText : colors.primary} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.roleTabBar}>
        <TouchableOpacity
          style={[styles.roleTab, roleTab === 'renting' && styles.roleTabActive]}
          onPress={() => setRoleTab('renting')}
        >
          <View style={styles.roleTabInner}>
            <Key size={15} color={roleTab === 'renting' ? colors.text : colors.textMuted} />
            <Text style={[styles.roleTabText, roleTab === 'renting' && styles.roleTabTextActive]}>
              {showAdminInbox ? 'Renters' : 'Renting'}
            </Text>
            {(showAdminInbox ? adminRenterUnread : rentingUnreadCount) > 0 && (
              <View style={styles.roleTabBadge}>
                <Text style={styles.roleTabBadgeText}>{showAdminInbox ? adminRenterUnread : rentingUnreadCount}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.roleTab, roleTab === 'lending' && styles.roleTabActive]}
          onPress={() => setRoleTab('lending')}
        >
          <View style={styles.roleTabInner}>
            <Package size={15} color={roleTab === 'lending' ? colors.text : colors.textMuted} />
            <Text style={[styles.roleTabText, roleTab === 'lending' && styles.roleTabTextActive]}>
              {showAdminInbox ? 'Lenders' : 'Lending'}
            </Text>
            {(showAdminInbox ? adminLenderUnread : lendingUnreadCount) > 0 && (
              <View style={styles.roleTabBadge}>
                <Text style={styles.roleTabBadgeText}>{showAdminInbox ? adminLenderUnread : lendingUnreadCount}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>

      {showAdminInbox ? (
        adminThreadsLoading ? (
          <ActivityIndicator color={colors.text} style={{ flex: 1 }} />
        ) : visibleAdminThreads.length === 0 ? (
          <View style={styles.empty}>
            <ShieldCheck size={48} color={colors.textFaint} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>No support threads</Text>
            <Text style={styles.emptySubtext}>
              Every "Message UseIT" conversation from a {adminRole} shows up here
            </Text>
          </View>
        ) : (
          <FlatList
            data={visibleAdminThreads}
            keyExtractor={(t) => t.id}
            renderItem={renderAdminItem}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )
      ) : feedRows.length === 0 ? (
        <View style={styles.empty}>
          <MessageCircle size={48} color={colors.textFaint} strokeWidth={1.5} />
          <Text style={styles.emptyTitle}>
            {roleTab === 'renting' ? 'No rentals yet' : 'No listings rented out yet'}
          </Text>
          <Text style={styles.emptySubtext}>
            {roleTab === 'renting'
              ? 'Items you request to rent or buy will show up here'
              : "Conversations about your own items will show up here"}
          </Text>
        </View>
      ) : (
        <FlatList
          data={feedRows}
          keyExtractor={(row) => row.key}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item: row }) => {
            if (row.kind === 'support') {
              const thread = row.thread;
              const unread = isSupportThreadUnread(thread);
              return (
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => navigation.navigate('SupportThread', {
                    threadId: thread.id,
                    title: `UseIT · ${thread.itemTitle}`,
                  })}
                >
                  <View style={[styles.avatar, styles.supportAvatar]}>
                    <ShieldCheck size={22} color={colors.primary} />
                    {unread && <View style={styles.avatarDot} />}
                  </View>
                  <View style={styles.rowContent}>
                    <View style={styles.rowTop}>
                      <Text style={[styles.userName, unread && styles.userNameUnread]} numberOfLines={1}>
                        UseIT Support
                      </Text>
                      <Text style={[styles.time, unread && styles.timeUnread]}>
                        {formatTime(thread.lastMessageAt)}
                      </Text>
                    </View>
                    <View style={styles.itemTitleRow}>
                      <Package size={12} color={colors.textMuted} />
                      <Text style={styles.itemTitle} numberOfLines={1}>{thread.itemTitle}</Text>
                    </View>
                    <Text style={[styles.lastMessage, unread && styles.lastMessageUnread]} numberOfLines={1}>
                      {thread.lastMessage ?? 'No messages yet'}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            }

            const conv = row.conv;
            const name = otherName(conv);
            const unread = isUnread(conv);
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  const myLastRead = conv.renter_id === currentUserId
                    ? conv.renter_last_read_at
                    : conv.lender_last_read_at;
                  navigation.navigate('ChatRoom', {
                    conversationId: conv.id,
                    itemTitle: conv.item_title,
                    otherUserName: name,
                    // Pass a fallback epoch timestamp when myLastRead is null (never opened this chat)
                    // so Badge Jump still fires and highlights the first unseen message.
                    ...(unread ? { highlightAfterTimestamp: myLastRead ?? new Date(0).toISOString() } : {}),
                  });
                }}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
                  {unread && <View style={styles.avatarDot} />}
                </View>
                <View style={styles.rowContent}>
                  <View style={styles.rowTop}>
                    <Text style={[styles.userName, unread && styles.userNameUnread]} numberOfLines={1}>
                      {name}
                    </Text>
                    <Text style={[styles.time, unread && styles.timeUnread]}>
                      {formatTime(conv.last_message_at)}
                    </Text>
                  </View>
                  <View style={styles.itemTitleRow}>
                    <Package size={12} color={colors.textMuted} />
                    <Text style={styles.itemTitle} numberOfLines={1}>{conv.item_title}</Text>
                  </View>
                  <Text style={[styles.lastMessage, unread && styles.lastMessageUnread]} numberOfLines={1}>
                    {conv.last_message ?? 'No messages yet'}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  headerRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
  header: { fontSize: 24, fontWeight: 'bold', color: colors.text },
  supportInboxBtn: { padding: 4, borderRadius: 8 },
  supportInboxBtnActive: { backgroundColor: colors.primary, padding: 4 },
  roleTabBar: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  roleTab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  roleTabActive: { borderBottomWidth: 2, borderBottomColor: colors.btn },
  roleTabInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  roleTabText: { fontSize: 14, color: colors.textFaint, fontWeight: '500' },
  roleTabTextActive: { color: colors.text, fontWeight: '600' },
  roleTabBadge: {
    backgroundColor: colors.warning, borderRadius: 10,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  roleTabBadgeText: { color: colors.btnText, fontSize: 10, fontWeight: '800' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 60 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  emptySubtext: { fontSize: 14, color: colors.textFaint },
  separator: { height: 1, backgroundColor: colors.card, marginLeft: 76 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { fontSize: 20, color: colors.text, fontWeight: '600' },
  supportAvatar: { backgroundColor: colors.infoBg, borderColor: colors.primary },
  avatarDot: {
    position: 'absolute', top: 0, right: 0,
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: colors.success, borderWidth: 2, borderColor: colors.bg,
  },
  rowContent: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  userName: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1, marginRight: 8 },
  userNameUnread: { color: colors.text, fontWeight: '700' },
  time: { fontSize: 12, color: colors.textFaint },
  timeUnread: { color: colors.success, fontWeight: '600' },
  itemTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  itemTitle: { fontSize: 12, color: colors.textFaint, flexShrink: 1 },
  lastMessage: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  lastMessageUnread: { color: colors.text, fontWeight: '500' },
});
