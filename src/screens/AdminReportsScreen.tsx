import { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Alert, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';
import { supabase } from '../services/supabase';
import { useAdminList } from '../hooks/useAdminList';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { ChevronLeft, Flag, User, Package, MessageCircle } from 'lucide-react-native';

type Props = NativeStackScreenProps<ProfileStackParamList, 'AdminReports'>;

type ReportRow = {
  id: string;
  reporter_id: string;
  reporter_name: string;
  reported_user_id: string;
  reported_user_name: string;
  reason: string;
  description: string | null;
  created_at: string;
  context_conversation_id: string | null;
  context_item_id: string | null;
  item_title: string | null;
  item_photo: string | null;
};

// Backlog AA: intake for a user reporting another user (PublicProfileScreen's
// Flag icon -> report_user RPC). Dismissing here is a separate action from
// actually banning someone -- that stays in AdminUsersScreen (SAS, the ban
// action already exists there), this screen just navigates there with the
// reported user's name pre-filled so the admin doesn't have to search.
export default function AdminReportsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data: reports, setData: setReports, loading, load } = useAdminList<ReportRow>('admin_list_reports');
  const [busyId, setBusyId] = useState<string | null>(null);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function dismiss(reportId: string) {
    setBusyId(reportId);
    const { error } = await supabase.rpc('admin_dismiss_report', { p_report_id: reportId });
    setBusyId(null);
    if (error) { Alert.alert('Error', error.message); return; }
    setReports(prev => prev.filter(r => r.id !== reportId));
  }

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  function renderItem({ item: r }: { item: ReportRow }) {
    const busy = busyId === r.id;
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.iconCircle}><Flag size={16} color={colors.danger} /></View>
          <View style={styles.cardHeaderText}>
            <Text style={styles.reason}>{r.reason}</Text>
            <Text style={styles.subtext}>
              Reported: {r.reported_user_name} · by {r.reporter_name} · {formatTime(r.created_at)}
            </Text>
          </View>
        </View>

        {r.description ? (
          <Text style={styles.description}>&quot;{r.description}&quot;</Text>
        ) : null}

        {/* Context the reporter attached, if any — lets the admin actually
            see what was flagged instead of ruling on an isolated claim. */}
        {r.item_title && (
          <View style={styles.contextRow}>
            {r.item_photo
              ? <Image source={{ uri: r.item_photo }} style={styles.contextThumb} />
              : <View style={[styles.contextThumb, styles.contextThumbFallback]}><Package size={16} color={colors.textFaint} /></View>}
            <Text style={styles.contextText} numberOfLines={1}>Reported listing: {r.item_title}</Text>
          </View>
        )}
        {r.context_conversation_id && (
          <TouchableOpacity
            style={styles.contextRow}
            onPress={() => navigation.navigate('AdminConversationView', { conversationId: r.context_conversation_id as string })}
          >
            <MessageCircle size={16} color={colors.primary} />
            <Text style={[styles.contextText, styles.contextLinkText]}>View the conversation this was reported from</Text>
          </TouchableOpacity>
        )}

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.manageBtn}
            onPress={() => navigation.navigate('AdminUsers', { initialSearch: r.reported_user_name })}
          >
            <User size={13} color={colors.primary} />
            <Text style={styles.manageBtnText}>Manage User</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.dismissBtn, busy && styles.btnDisabled]}
            onPress={() => dismiss(r.id)}
            disabled={busy}
          >
            {busy ? <ActivityIndicator size="small" color={colors.textMuted} /> : <Text style={styles.dismissBtnText}>Dismiss</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('AdminHome')} style={styles.backBtn}>
          <ChevronLeft size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Reports</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.text} style={{ flex: 1 }} />
      ) : reports.length === 0 ? (
        <View style={styles.empty}>
          <Flag size={48} color={colors.textFaint} strokeWidth={1.5} />
          <Text style={styles.emptyText}>No open reports</Text>
        </View>
      ) : (
        <FlatList
          data={reports}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
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
  list: { padding: 16, gap: 10 },
  card: {
    backgroundColor: colors.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: colors.border, gap: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconCircle: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: colors.dangerBg,
    alignItems: 'center', justifyContent: 'center',
  },
  cardHeaderText: { flex: 1, gap: 2 },
  reason: { fontSize: 15, fontWeight: '700', color: colors.text },
  subtext: { fontSize: 12, color: colors.textFaint },
  description: { fontSize: 13, color: colors.textMuted, fontStyle: 'italic' },
  contextRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  contextThumb: { width: 28, height: 28, borderRadius: 6 },
  contextThumbFallback: { backgroundColor: colors.chip, alignItems: 'center', justifyContent: 'center' },
  contextText: { flex: 1, fontSize: 13, color: colors.textMuted },
  contextLinkText: { color: colors.primary, fontWeight: '600' },
  actionsRow: { flexDirection: 'row', gap: 8 },
  manageBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
  },
  manageBtnText: { fontSize: 13, fontWeight: '600', color: colors.primary },
  dismissBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: colors.chip },
  dismissBtnText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  btnDisabled: { opacity: 0.5 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { fontSize: 16, fontWeight: '600', color: colors.textFaint },
});
