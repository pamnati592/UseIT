import { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, TextInput, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { ChevronLeft, Users, Search, ShieldAlert } from 'lucide-react-native';

type Props = NativeStackScreenProps<ProfileStackParamList, 'AdminUsers'>;

type AdminUserRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
  role: string | null;
  lender_score: number | null;
  renter_score: number | null;
  lender_cancellations: number;
  is_admin: boolean;
  is_banned: boolean;
  created_at: string;
};

export default function AdminUsersScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [search, setSearch] = useState(route.params?.initialSearch ?? '');
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (q?: string) => {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_list_users', { p_search: q ?? undefined });
    if (error) { Alert.alert('Error', error.message); setLoading(false); return; }
    setUsers((data as AdminUserRow[]) ?? []);
    setLoading(false);
  }, []);

  // AdminReportsScreen deep-links here with the reported user's name so the
  // admin doesn't have to search manually — ban/unban stays the one
  // canonical action here (SAS), reports just navigates to it.
  useFocusEffect(useCallback(() => { load(route.params?.initialSearch); }, [load, route.params?.initialSearch]));

  function scoreLabel(score: number | null): string {
    if (score === null || score === 0) return '—';
    return score.toFixed(1);
  }

  function toggleBan(user: AdminUserRow) {
    const next = !user.is_banned;
    Alert.alert(
      next ? `Ban ${user.full_name ?? 'this user'}?` : `Unban ${user.full_name ?? 'this user'}?`,
      next ? 'They will be signed out and blocked from using the app.' : 'They will be able to sign in again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: next ? 'Ban' : 'Unban', style: next ? 'destructive' : 'default', onPress: async () => {
            setBusyId(user.id);
            try {
              const { error } = await supabase.rpc('admin_set_user_banned', { p_user_id: user.id, p_banned: next });
              if (error) throw error;
              setUsers(prev => prev.map(u => u.id === user.id ? { ...u, is_banned: next } : u));
            } catch (e: any) {
              Alert.alert('Error', e.message);
            } finally {
              setBusyId(null);
            }
          },
        },
      ]
    );
  }

  function renderItem({ item: user }: { item: AdminUserRow }) {
    const busy = busyId === user.id;
    return (
      <View style={[styles.card, user.is_banned && styles.cardBanned]}>
        <View style={styles.cardTop}>
          <View style={{ flex: 1 }}>
            <View style={styles.nameRow}>
              <Text style={styles.name}>{user.full_name ?? 'Unnamed'}</Text>
              {user.is_admin && <View style={styles.adminPill}><Text style={styles.adminPillText}>Admin</Text></View>}
              {user.is_banned && <View style={styles.bannedPill}><Text style={styles.bannedPillText}>Banned</Text></View>}
            </View>
            <Text style={styles.meta}>{user.city ?? 'No city'} · {user.role ?? '—'}</Text>
          </View>
        </View>

        <View style={styles.scoresRow}>
          <Text style={styles.scoreText}>Lender {scoreLabel(user.lender_score)}</Text>
          <Text style={styles.scoreText}>Renter {scoreLabel(user.renter_score)}</Text>
          {user.lender_cancellations > 0 && (
            <View style={styles.warningRow}>
              <ShieldAlert size={12} color={colors.danger} />
              <Text style={styles.warningText}>{user.lender_cancellations} cancellations</Text>
            </View>
          )}
        </View>

        {!user.is_admin && (
          <TouchableOpacity
            style={[styles.banBtn, user.is_banned ? styles.unbanBtn : styles.banBtnDanger, busy && styles.btnDisabled]}
            onPress={() => toggleBan(user)}
            disabled={busy}
          >
            {busy ? <ActivityIndicator color="#fff" size="small" /> : (
              <Text style={styles.banBtnText}>{user.is_banned ? 'Unban' : 'Ban'}</Text>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('AdminHome')} style={styles.backBtn}>
          <ChevronLeft size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>User Management</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.searchRow}>
        <Search size={16} color={colors.textMuted} />
        <TextInput
          style={[styles.searchInput, { color: colors.text }]}
          placeholder="Search by name…"
          placeholderTextColor={colors.textMuted}
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => load(search)}
          returnKeyType="search"
        />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.text} style={{ flex: 1 }} />
      ) : users.length === 0 ? (
        <View style={styles.empty}>
          <Users size={48} color={colors.textFaint} strokeWidth={1.5} />
          <Text style={styles.emptyText}>No users found</Text>
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
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
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginBottom: 12, paddingHorizontal: 12, height: 40,
    backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: 14 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { fontSize: 18, fontWeight: '600', color: colors.text },
  list: { paddingHorizontal: 16, paddingBottom: 16 },
  card: {
    backgroundColor: colors.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: colors.border, gap: 10,
  },
  cardBanned: { borderColor: colors.danger, opacity: 0.85 },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 15, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
  adminPill: { backgroundColor: 'rgba(37,99,235,0.15)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  adminPillText: { color: '#2563eb', fontSize: 10, fontWeight: '800' },
  bannedPill: { backgroundColor: 'rgba(239,68,68,0.15)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  bannedPillText: { color: colors.danger, fontSize: 10, fontWeight: '800' },
  scoresRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  scoreText: { fontSize: 12, color: colors.textSecondary, fontWeight: '600' },
  warningRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  warningText: { fontSize: 11, color: colors.danger, fontWeight: '600' },
  banBtn: { height: 38, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  banBtnDanger: { backgroundColor: colors.danger },
  unbanBtn: { backgroundColor: '#15803d' },
  banBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
});
