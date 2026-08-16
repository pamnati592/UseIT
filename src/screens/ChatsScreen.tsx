import { useState, useCallback, useMemo} from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ChatsStackParamList } from '../navigation/ChatsStackNavigator';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { MessageCircle, Package, Key } from 'lucide-react-native';

type RoleTab = 'renting' | 'lending';

type ConversationRow = {
  id: string;
  renter_id: string;
  lender_id: string;
  last_message: string | null;
  last_message_at: string | null;
  renter_last_read_at: string | null;
  lender_last_read_at: string | null;
  item_title: string;
  renter_name: string;
  lender_name: string;
};

type Props = {
  navigation: NativeStackNavigationProp<ChatsStackParamList, 'ConversationsList'>;
};

export default function ChatsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [roleTab, setRoleTab] = useState<RoleTab>('renting');

  useFocusEffect(
    useCallback(() => {
      loadConversations();
    }, [])
  );

  async function loadConversations() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }
    setCurrentUserId(user.id);

    const { data, error } = await supabase
      .from('conversations')
      .select(`
        id, renter_id, lender_id, last_message, last_message_at,
        renter_last_read_at, lender_last_read_at,
        items(title),
        renter:profiles!conversations_renter_id_fkey(full_name),
        lender:profiles!conversations_lender_id_fkey(full_name)
      `)
      .order('last_message_at', { ascending: false });

    if (!error && data) {
      setConversations(
        (data as any[]).map((c) => ({
          id: c.id,
          renter_id: c.renter_id,
          lender_id: c.lender_id,
          last_message: c.last_message,
          last_message_at: c.last_message_at,
          renter_last_read_at: c.renter_last_read_at,
          lender_last_read_at: c.lender_last_read_at,
          item_title: c.items?.title ?? 'Item',
          renter_name: c.renter?.full_name ?? 'Renter',
          lender_name: c.lender?.full_name ?? 'Lender',
        }))
      );
    }
    setLoading(false);
  }

  function otherName(conv: ConversationRow): string {
    if (!currentUserId) return '';
    return conv.renter_id === currentUserId ? conv.lender_name : conv.renter_name;
  }

  function isUnread(conv: ConversationRow): boolean {
    if (!currentUserId || !conv.last_message_at) return false;
    const myLastRead = conv.renter_id === currentUserId
      ? conv.renter_last_read_at
      : conv.lender_last_read_at;
    if (!myLastRead) return true;
    return new Date(conv.last_message_at) > new Date(myLastRead);
  }

  // A conversation belongs to Renting if the current user is the renter, and to
  // Lending if they're the item owner — conversations.lender_id already tracks
  // that (set to items.owner_id when the conversation is created), so no join
  // needed. ChatRoomScreen itself is unchanged; only this list is split (SAS).
  const rentingConvs = useMemo(
    () => conversations.filter(c => c.renter_id === currentUserId),
    [conversations, currentUserId]
  );
  const lendingConvs = useMemo(
    () => conversations.filter(c => c.lender_id === currentUserId),
    [conversations, currentUserId]
  );
  const rentingUnreadCount = useMemo(() => rentingConvs.filter(isUnread).length, [rentingConvs, currentUserId]);
  const lendingUnreadCount = useMemo(() => lendingConvs.filter(isUnread).length, [lendingConvs, currentUserId]);
  const visibleConvs = roleTab === 'renting' ? rentingConvs : lendingConvs;

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

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>Chats</Text>

      <View style={styles.roleTabBar}>
        <TouchableOpacity
          style={[styles.roleTab, roleTab === 'renting' && styles.roleTabActive]}
          onPress={() => setRoleTab('renting')}
        >
          <View style={styles.roleTabInner}>
            <Key size={15} color={roleTab === 'renting' ? colors.text : colors.textMuted} />
            <Text style={[styles.roleTabText, roleTab === 'renting' && styles.roleTabTextActive]}>Renting</Text>
            {rentingUnreadCount > 0 && (
              <View style={styles.roleTabBadge}>
                <Text style={styles.roleTabBadgeText}>{rentingUnreadCount}</Text>
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
            <Text style={[styles.roleTabText, roleTab === 'lending' && styles.roleTabTextActive]}>Lending</Text>
            {lendingUnreadCount > 0 && (
              <View style={styles.roleTabBadge}>
                <Text style={styles.roleTabBadgeText}>{lendingUnreadCount}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>

      {visibleConvs.length === 0 ? (
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
          data={visibleConvs}
          keyExtractor={(c) => c.id}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item: conv }) => {
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
  header: {
    fontSize: 24, fontWeight: 'bold', color: colors.text,
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12,
  },
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
