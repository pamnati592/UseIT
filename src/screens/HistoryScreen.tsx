import { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { CategoryIcon } from '../components/CategoryIcon';
import { ChevronLeft, Clock, Key, Package, ShoppingCart } from 'lucide-react-native';

type RoleTab = 'renting' | 'lending';

// Only these three — a rejected/cancelled-before-payment request never became a
// real rental and doesn't belong in history (spec: "completed/cancelled/disputed").
const HISTORY_STATUSES = ['completed', 'cancelled', 'disputed'];

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  completed: { label: 'Completed', color: '#6b7280', bg: 'rgba(107,114,128,0.15)' },
  cancelled: { label: 'Cancelled', color: '#6b7280', bg: 'rgba(107,114,128,0.15)' },
  disputed:  { label: 'Disputed',  color: '#b91c1c', bg: 'rgba(239,68,68,0.15)' },
  sold:      { label: 'Sold',      color: '#15803d', bg: 'rgba(34,197,94,0.15)' },
};

type RentalRow = {
  kind: 'rental';
  id: string;
  status: string;
  itemTitle: string;
  itemPhoto: string | null;
  itemCategory: string;
  otherName: string;
  startDate: string;
  endDate: string;
  totalPrice: number;
  sortDate: string;
};

type SaleRow = {
  kind: 'sale';
  id: string;
  itemTitle: string;
  itemPhoto: string | null;
  itemCategory: string;
  buyerName: string;
  price: number;
  sortDate: string;
};

type HistoryRow = RentalRow | SaleRow;

export default function HistoryScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const [roleTab, setRoleTab] = useState<RoleTab>('renting');
  const [rentingRows, setRentingRows] = useState<RentalRow[]>([]);
  const [lendingRows, setLendingRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !active) { setLoading(false); return; }

        const [rentingTx, lendingTx, sales] = await Promise.all([
          supabase
            .from('transactions')
            .select('id, status, start_date, end_date, total_price, created_at, items(title, photos, category), lender:profiles!transactions_lender_id_fkey(full_name)')
            .eq('renter_id', user.id)
            .in('status', HISTORY_STATUSES)
            .order('created_at', { ascending: false }),
          supabase
            .from('transactions')
            .select('id, status, start_date, end_date, total_price, created_at, items(title, photos, category), renter:profiles!transactions_renter_id_fkey(full_name)')
            .eq('lender_id', user.id)
            .in('status', HISTORY_STATUSES)
            .order('created_at', { ascending: false }),
          supabase
            .from('purchases')
            .select('id, price, created_at, items(title, photos, category), buyer:profiles!purchases_buyer_id_fkey(full_name)')
            .eq('seller_id', user.id)
            .eq('status', 'paid')
            .order('created_at', { ascending: false }),
        ]);

        if (!active) return;

        const toRentalRow = (t: any, otherField: 'lender' | 'renter'): RentalRow => ({
          kind: 'rental',
          id: t.id,
          status: t.status,
          itemTitle: t.items?.title ?? 'Item',
          itemPhoto: t.items?.photos?.[0] ?? null,
          itemCategory: t.items?.category ?? 'other',
          otherName: t[otherField]?.full_name ?? (otherField === 'lender' ? 'Lender' : 'Renter'),
          startDate: t.start_date,
          endDate: t.end_date,
          totalPrice: t.total_price,
          sortDate: t.created_at,
        });

        const toSaleRow = (p: any): SaleRow => ({
          kind: 'sale',
          id: p.id,
          itemTitle: p.items?.title ?? 'Item',
          itemPhoto: p.items?.photos?.[0] ?? null,
          itemCategory: p.items?.category ?? 'other',
          buyerName: p.buyer?.full_name ?? 'Buyer',
          price: p.price,
          sortDate: p.created_at,
        });

        setRentingRows(((rentingTx.data as any[]) ?? []).map(t => toRentalRow(t, 'lender')));

        const lendingRentals = ((lendingTx.data as any[]) ?? []).map(t => toRentalRow(t, 'renter'));
        const soldItems = ((sales.data as any[]) ?? []).map(toSaleRow);
        setLendingRows(
          [...lendingRentals, ...soldItems].sort(
            (a, b) => new Date(b.sortDate).getTime() - new Date(a.sortDate).getTime()
          )
        );

        setLoading(false);
      })();
      return () => { active = false; };
    }, [])
  );

  function formatDateRange(start: string, end: string): string {
    const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `${fmt(start)} → ${fmt(end)}`;
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  const visibleRows = roleTab === 'renting' ? rentingRows : lendingRows;

  function renderRow(row: HistoryRow) {
    const statusMeta = row.kind === 'sale' ? STATUS_META.sold : STATUS_META[row.status];
    return (
      <View key={`${row.kind}-${row.id}`} style={styles.row}>
        <View style={styles.thumb}>
          {row.itemPhoto ? (
            <Image source={{ uri: row.itemPhoto }} style={styles.thumbImg} />
          ) : (
            <CategoryIcon category={row.itemCategory} size={22} color={colors.textMuted} strokeWidth={1.8} />
          )}
        </View>
        <View style={styles.rowContent}>
          <View style={styles.rowTop}>
            <Text style={styles.itemTitle} numberOfLines={1}>{row.itemTitle}</Text>
            <View style={[styles.statusPill, { backgroundColor: statusMeta.bg }]}>
              <Text style={[styles.statusPillText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
            </View>
          </View>
          {row.kind === 'rental' ? (
            <>
              <Text style={styles.rowSub}>{formatDateRange(row.startDate, row.endDate)} · ₪{row.totalPrice}</Text>
              <Text style={styles.rowOther}>
                {roleTab === 'renting' ? `Lender: ${row.otherName}` : `Renter: ${row.otherName}`}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.rowSub}>Sold for ₪{row.price}</Text>
              <Text style={styles.rowOther}>Buyer: {row.buyerName}</Text>
            </>
          )}
          <Text style={styles.rowDate}>{formatDate(row.sortDate)}</Text>
        </View>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('ProfileMain')} style={styles.backBtn}>
          <ChevronLeft size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>History</Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.roleTabBar}>
        <TouchableOpacity
          style={[styles.roleTab, roleTab === 'renting' && styles.roleTabActive]}
          onPress={() => setRoleTab('renting')}
        >
          <Key size={15} color={roleTab === 'renting' ? colors.text : colors.textMuted} />
          <Text style={[styles.roleTabText, roleTab === 'renting' && styles.roleTabTextActive]}>Renting</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.roleTab, roleTab === 'lending' && styles.roleTabActive]}
          onPress={() => setRoleTab('lending')}
        >
          <Package size={15} color={roleTab === 'lending' ? colors.text : colors.textMuted} />
          <Text style={[styles.roleTabText, roleTab === 'lending' && styles.roleTabTextActive]}>Lending</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={colors.text} style={{ flex: 1 }} />
      ) : visibleRows.length === 0 ? (
        <View style={styles.empty}>
          {roleTab === 'renting' ? <Clock size={48} color={colors.textFaint} strokeWidth={1.5} /> : <ShoppingCart size={48} color={colors.textFaint} strokeWidth={1.5} />}
          <Text style={styles.emptyText}>Nothing here yet</Text>
          <Text style={styles.emptySub}>
            {roleTab === 'renting'
              ? 'Rentals you completed, cancelled, or disputed will show up here'
              : 'Rentals you lent out and items you sold will show up here'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={visibleRows}
          keyExtractor={(row) => `${row.kind}-${row.id}`}
          renderItem={({ item }) => renderRow(item)}
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
  roleTab: {
    flex: 1, paddingVertical: 12, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 6,
  },
  roleTabActive: { borderBottomWidth: 2, borderBottomColor: colors.btn },
  roleTabText: { fontSize: 14, color: colors.textFaint, fontWeight: '500' },
  roleTabTextActive: { color: colors.text, fontWeight: '600' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { fontSize: 18, fontWeight: '600', color: colors.text },
  emptySub: { fontSize: 14, color: colors.textFaint, textAlign: 'center', paddingHorizontal: 40 },
  list: { padding: 16 },
  separator: { height: 10 },
  row: {
    flexDirection: 'row', gap: 12, backgroundColor: colors.card,
    borderRadius: 14, padding: 12, borderWidth: 1, borderColor: colors.border,
  },
  thumb: {
    width: 56, height: 56, borderRadius: 10, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%' },
  rowContent: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  itemTitle: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1 },
  statusPill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  statusPillText: { fontSize: 11, fontWeight: '700' },
  rowSub: { fontSize: 13, color: colors.textSecondary },
  rowOther: { fontSize: 12, color: colors.textMuted },
  rowDate: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
});
