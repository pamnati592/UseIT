import { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { ChevronLeft, ShieldCheck, Package, Key } from 'lucide-react-native';

type Props = NativeStackScreenProps<ProfileStackParamList, 'AdminSupportInbox'>;

type ThreadRow = {
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

type RoleTab = 'renter' | 'lender';

// Every support thread across the whole platform — "the room of
// conversations with UseIT." Requested 2026-08-23: reachable only from the
// Admin Console (AdminHomeScreen), never from the regular Chats tab — an
// admin's own Chats stays their own personal view, with no mode switch
// bolted onto it. Split Renter/Lender the same way the user's own Chats tab
// is, just meaning "renters with an open case" vs "lenders with an open
// case" instead of "my own rentals."
export default function AdminSupportInboxScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [roleTab, setRoleTab] = useState<RoleTab>('renter');

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_list_support_threads');
    if (error) { Alert.alert('Error', error.message); setLoading(false); return; }
    setThreads((data as ThreadRow[]) ?? []);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function isUnread(t: ThreadRow): boolean {
    if (!t.last_message_at) return false;
    if (!t.admin_last_read_at) return true;
    return new Date(t.last_message_at) > new Date(t.admin_last_read_at);
  }

  const visibleThreads = threads.filter(t => t.role === roleTab);
  const renterUnreadCount = threads.filter(t => t.role === 'renter' && isUnread(t)).length;
  const lenderUnreadCount = threads.filter(t => t.role === 'lender' && isUnread(t)).length;

  function formatTime(iso: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (diffDays === 0) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function renderItem({ item: t }: { item: ThreadRow }) {
    const unread = isUnread(t);
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => navigation.navigate('SupportThread', {
          threadId: t.id,
          title: `${t.user_name} · ${t.item_title}`,
        })}
      >
        <View style={[styles.avatar, unread && styles.avatarUnread]}>
          <ShieldCheck size={20} color={colors.primary} />
          {unread && <View style={styles.avatarDot} />}
        </View>
        <View style={styles.rowContent}>
          <View style={styles.rowTop}>
            <Text style={[styles.userName, unread && styles.userNameUnread]} numberOfLines={1}>{t.user_name}</Text>
            <Text style={[styles.time, unread && styles.timeUnread]}>{formatTime(t.last_message_at)}</Text>
          </View>
          <View style={styles.itemRow}>
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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('AdminHome')} style={styles.backBtn}>
          <ChevronLeft size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Support Inbox</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.roleTabBar}>
        <TouchableOpacity style={[styles.roleTab, roleTab === 'renter' && styles.roleTabActive]} onPress={() => setRoleTab('renter')}>
          <View style={styles.roleTabInner}>
            <Key size={15} color={roleTab === 'renter' ? colors.text : colors.textMuted} />
            <Text style={[styles.roleTabText, roleTab === 'renter' && styles.roleTabTextActive]}>Renters</Text>
            {renterUnreadCount > 0 && (
              <View style={styles.roleTabBadge}><Text style={styles.roleTabBadgeText}>{renterUnreadCount}</Text></View>
            )}
          </View>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.roleTab, roleTab === 'lender' && styles.roleTabActive]} onPress={() => setRoleTab('lender')}>
          <View style={styles.roleTabInner}>
            <Package size={15} color={roleTab === 'lender' ? colors.text : colors.textMuted} />
            <Text style={[styles.roleTabText, roleTab === 'lender' && styles.roleTabTextActive]}>Lenders</Text>
            {lenderUnreadCount > 0 && (
              <View style={styles.roleTabBadge}><Text style={styles.roleTabBadgeText}>{lenderUnreadCount}</Text></View>
            )}
          </View>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.text} style={{ flex: 1 }} />
      ) : visibleThreads.length === 0 ? (
        <View style={styles.empty}>
          <ShieldCheck size={48} color={colors.textFaint} strokeWidth={1.5} />
          <Text style={styles.emptyText}>No support threads</Text>
          <Text style={styles.emptySub}>Every &quot;Message UseIT&quot; conversation shows up here, from any rental</Text>
        </View>
      ) : (
        <FlatList
          data={visibleThreads}
          keyExtractor={(t) => t.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  backBtn: { width: 36 },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.text },
  roleTabBar: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  roleTab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  roleTabActive: { borderBottomWidth: 2, borderBottomColor: colors.btn },
  roleTabInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  roleTabText: { fontSize: 14, color: colors.textFaint, fontWeight: '500' },
  roleTabTextActive: { color: colors.text, fontWeight: '600' },
  roleTabBadge: {
    backgroundColor: colors.warning, borderRadius: 10,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  roleTabBadgeText: { color: colors.btnText, fontSize: 10, fontWeight: '800' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 40 },
  emptyText: { fontSize: 18, fontWeight: '600', color: colors.text },
  emptySub: { fontSize: 14, color: colors.textFaint, textAlign: 'center' },
  list: { paddingVertical: 8 },
  separator: { height: 1, backgroundColor: colors.card, marginLeft: 76 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  avatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: colors.infoBg,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center',
  },
  avatarUnread: { borderColor: colors.primary },
  avatarDot: {
    position: 'absolute', top: 0, right: 0, width: 14, height: 14, borderRadius: 7,
    backgroundColor: colors.success, borderWidth: 2, borderColor: colors.bg,
  },
  rowContent: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  userName: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1, marginRight: 8 },
  userNameUnread: { fontWeight: '700' },
  time: { fontSize: 12, color: colors.textFaint },
  timeUnread: { color: colors.success, fontWeight: '600' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  itemTitle: { fontSize: 12, color: colors.textFaint, flexShrink: 1 },
  lastMessage: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  lastMessageUnread: { color: colors.text, fontWeight: '500' },
});
