import { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, SectionList, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';
import { useAdminList } from '../hooks/useAdminList';
import { formatDateRange } from '../utils/format';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { ChevronLeft, Scale, Package, ChevronRight } from 'lucide-react-native';

type Props = NativeStackScreenProps<ProfileStackParamList, 'AdminRentals'>;

type OverviewRow = {
  transaction_id: string;
  item_title: string;
  item_photo: string | null;
  status: string;
  pre_dispute_status: string | null;
  start_date: string;
  end_date: string;
  renter_name: string;
  lender_name: string;
  renter_unread: boolean;
  lender_unread: boolean;
  has_dispute: boolean;
};

function statusLabel(status: string): string {
  switch (status) {
    case 'pending': return 'Awaiting approval';
    case 'approved': return 'Awaiting payment';
    case 'paid': return 'Awaiting pickup';
    case 'active': return 'Active — item with renter';
    case 'completed': return 'Completed';
    case 'disputed': return 'Disputed';
    case 'cancelled': return 'Cancelled';
    case 'rejected': return 'Declined';
    default: return status;
  }
}

export default function AdminRentalsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { data: rentals, loading, load } = useAdminList<OverviewRow>('admin_list_support_overview');

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const sections = useMemo(() => (
    [
      { title: 'Disputed', data: rentals.filter(r => r.has_dispute) },
      { title: 'Needs Attention', data: rentals.filter(r => !r.has_dispute) },
    ].filter(s => s.data.length > 0)
  ), [rentals]);

  function renderItem({ item: r }: { item: OverviewRow }) {
    const anyUnread = r.renter_unread || r.lender_unread;
    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => navigation.navigate('AdminRentalDetail', { transactionId: r.transaction_id })}
      >
        {r.item_photo
          ? <Image source={{ uri: r.item_photo }} style={styles.itemThumb} />
          : <View style={styles.itemThumbFallback}><Package size={18} color={colors.textMuted} /></View>}
        <View style={styles.rowContent}>
          <View style={styles.rowTop}>
            <Text style={styles.itemTitle} numberOfLines={1}>{r.item_title}</Text>
            {anyUnread && <View style={styles.unreadDot} />}
          </View>
          <Text style={styles.partyText} numberOfLines={1}>{r.renter_name} · {r.lender_name}</Text>
          <View style={styles.statusRow}>
            <Text style={styles.statusText}>
              {statusLabel(r.has_dispute && r.pre_dispute_status ? r.pre_dispute_status : r.status)} · {formatDateRange(r.start_date, r.end_date)}
            </Text>
            {r.has_dispute && (
              <View style={styles.disputedBadge}><Text style={styles.disputedBadgeText}>Disputed</Text></View>
            )}
          </View>
        </View>
        <ChevronRight size={18} color={colors.textFaint} />
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('AdminHome')} style={styles.backBtn}>
          <ChevronLeft size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Rentals</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.text} style={{ flex: 1 }} />
      ) : sections.length === 0 ? (
        <View style={styles.empty}>
          <Scale size={48} color={colors.textFaint} strokeWidth={1.5} />
          <Text style={styles.emptyText}>Nothing needs attention</Text>
          <Text style={styles.emptySub}>Rentals with an open dispute or a UseIT support chat will show up here</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.transaction_id}
          renderItem={renderItem}
          renderSectionHeader={({ section: { title } }) => (
            <Text style={styles.sectionHeader}>{title}</Text>
          )}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          SectionSeparatorComponent={() => <View style={{ height: 16 }} />}
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 40 },
  emptyText: { fontSize: 18, fontWeight: '600', color: colors.text },
  emptySub: { fontSize: 14, color: colors.textFaint, textAlign: 'center' },
  list: { padding: 16 },
  sectionHeader: {
    fontSize: 12, fontWeight: '700', color: colors.textFaint,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderRadius: 14, padding: 12,
    borderWidth: 1, borderColor: colors.border,
  },
  itemThumb: { width: 44, height: 44, borderRadius: 8 },
  itemThumbFallback: {
    width: 44, height: 44, borderRadius: 8, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  rowContent: { flex: 1, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  partyText: { fontSize: 12.5, color: colors.textSecondary },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  statusText: { fontSize: 12, color: colors.textFaint },
  disputedBadge: { backgroundColor: colors.dangerBg, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  disputedBadgeText: { fontSize: 11, fontWeight: '700', color: colors.danger },
});
