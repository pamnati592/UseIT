import { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Alert, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { ChevronLeft, Clock, Package, ShieldCheck } from 'lucide-react-native';

type Props = NativeStackScreenProps<ProfileStackParamList, 'AdminOverdue'>;

type OverdueRow = {
  transaction_id: string;
  item_title: string;
  start_date: string;
  end_date: string;
  daily_price: number;
  renter_id: string;
  renter_name: string;
  lender_id: string;
  lender_name: string;
  late_days: number;
  accrued_fee: number;
  cliff_charged: boolean;
};

// The daily late fee (spec 4.8) is charged automatically the moment a return
// scan finally happens — see charge-late-fee. This screen exists for the
// other half: rentals still active and overdue, where the accrued fee is
// only a live projection (not yet charged, no return yet to trigger it),
// and — once 2+ weeks overdue — a one-time cliff fine an admin sets after
// optionally consulting the lender, not a formula (requested 2026-08-16).
const CLIFF_DAYS = 14;

export default function AdminOverdueScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [rows, setRows] = useState<OverdueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [charging, setCharging] = useState<string | null>(null);
  const [fineAmounts, setFineAmounts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_list_overdue_rentals');
    if (error) { Alert.alert('Error', error.message); setLoading(false); return; }
    setRows((data as OverdueRow[]) ?? []);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function messageParty(transactionId: string, userId: string, label: string) {
    try {
      const { data: threadId, error } = await supabase.rpc('admin_ensure_support_thread', {
        p_transaction_id: transactionId,
        p_user_id: userId,
      });
      if (error) throw error;
      navigation.navigate('SupportThread', { threadId: threadId as string, title: `${label} · Overdue Rental` });
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not open support chat.');
    }
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  async function chargeCliffFine(row: OverdueRow) {
    const raw = fineAmounts[row.transaction_id]?.trim();
    const amount = Number(raw);
    if (!raw || !Number.isFinite(amount) || amount <= 0) {
      Alert.alert('Enter an amount', 'Set the fine amount before charging — this is not calculated automatically.');
      return;
    }
    Alert.alert(
      'Charge overdue penalty?',
      `₪${amount} will be charged to ${row.renter_name}'s saved card for keeping "${row.item_title}" ${row.late_days} days past due. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Charge', style: 'destructive', onPress: async () => {
            setCharging(row.transaction_id);
            try {
              const { data: { session } } = await supabase.auth.getSession();
              if (!session) throw new Error('Not authenticated');
              const res = await fetch(
                `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/admin-charge`,
                {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
                  body: JSON.stringify({ transaction_id: row.transaction_id, amount, reason: 'late_fee_cliff' }),
                }
              );
              const result = await res.json();
              if (result.error) throw new Error(result.error);
              if (!result.ok) {
                Alert.alert('Charge failed', 'The card on file was declined or missing — the renter has been notified in chat to arrange payment directly.');
              }
              load();
            } catch (e: any) {
              Alert.alert('Error', e.message ?? 'Could not process the charge.');
            } finally {
              setCharging(null);
            }
          },
        },
      ]
    );
  }

  function renderItem({ item: row }: { item: OverdueRow }) {
    const isCliffEligible = row.late_days >= CLIFF_DAYS;
    const isCharging = charging === row.transaction_id;
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.itemThumbFallback}><Package size={18} color={colors.textMuted} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.itemTitle}>{row.item_title}</Text>
            <Text style={styles.dateRange}>Due back {formatDate(row.end_date)}</Text>
          </View>
          <View style={[styles.lateBadge, isCliffEligible && styles.lateBadgeCliff]}>
            <Clock size={12} color={isCliffEligible ? '#fff' : colors.warning} />
            <Text style={[styles.lateBadgeText, isCliffEligible && styles.lateBadgeTextCliff]}>{row.late_days}d late</Text>
          </View>
        </View>

        <View style={styles.partiesRow}>
          <Text style={styles.partyText}>Renter: {row.renter_name}</Text>
          <Text style={styles.partyText}>Lender: {row.lender_name}</Text>
        </View>

        <Text style={styles.accrued}>
          Accrued daily late fee so far: <Text style={styles.accruedAmount}>₪{row.accrued_fee}</Text>
          <Text style={styles.accruedNote}> (charged automatically once returned)</Text>
        </Text>

        <View style={styles.messageRow}>
          <TouchableOpacity
            style={styles.messageBtn}
            onPress={() => messageParty(row.transaction_id, row.renter_id, row.renter_name)}
          >
            <ShieldCheck size={13} color={colors.primary} />
            <Text style={styles.messageBtnText}>Message Renter</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.messageBtn}
            onPress={() => messageParty(row.transaction_id, row.lender_id, row.lender_name)}
          >
            <ShieldCheck size={13} color={colors.primary} />
            <Text style={styles.messageBtnText}>Message Lender</Text>
          </TouchableOpacity>
        </View>

        {isCliffEligible && (
          row.cliff_charged ? (
            <Text style={styles.cliffDone}>⏰ Overdue penalty already charged for this rental.</Text>
          ) : (
            <View style={styles.cliffRow}>
              <TextInput
                style={[styles.fineInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
                placeholder="Fine amount (₪)"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                value={fineAmounts[row.transaction_id] ?? ''}
                onChangeText={(t) => setFineAmounts(prev => ({ ...prev, [row.transaction_id]: t }))}
              />
              <TouchableOpacity
                style={[styles.chargeBtn, isCharging && styles.btnDisabled]}
                onPress={() => chargeCliffFine(row)}
                disabled={isCharging}
              >
                {isCharging ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.chargeBtnText}>Charge Penalty</Text>}
              </TouchableOpacity>
            </View>
          )
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
        <Text style={styles.title}>Overdue Rentals</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.text} style={{ flex: 1 }} />
      ) : rows.length === 0 ? (
        <View style={styles.empty}>
          <Clock size={48} color={colors.textFaint} strokeWidth={1.5} />
          <Text style={styles.emptyText}>No overdue rentals</Text>
          <Text style={styles.emptySub}>Active rentals past their return date will show up here</Text>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.transaction_id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { fontSize: 18, fontWeight: '600', color: colors.text },
  emptySub: { fontSize: 14, color: colors.textFaint, textAlign: 'center', paddingHorizontal: 40 },
  list: { padding: 16 },
  card: {
    backgroundColor: colors.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: colors.border, gap: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemThumbFallback: {
    width: 44, height: 44, borderRadius: 8, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  itemTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  dateRange: { fontSize: 12, color: colors.textFaint },
  lateBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(245,158,11,0.15)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4,
  },
  lateBadgeCliff: { backgroundColor: '#dc2626' },
  lateBadgeText: { fontSize: 12, fontWeight: '700', color: colors.warning },
  lateBadgeTextCliff: { color: '#fff' },
  partiesRow: { flexDirection: 'row', gap: 16 },
  partyText: { fontSize: 12, color: colors.textSecondary },
  messageRow: { flexDirection: 'row', gap: 10 },
  messageBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 36, borderRadius: 8, borderWidth: 1, borderColor: colors.primary,
  },
  messageBtnText: { color: colors.primary, fontSize: 12.5, fontWeight: '600' },
  accrued: { fontSize: 13, color: colors.text },
  accruedAmount: { fontWeight: '700' },
  accruedNote: { fontSize: 11, color: colors.textFaint },
  cliffDone: { fontSize: 13, color: colors.textSecondary, fontStyle: 'italic' },
  cliffRow: { flexDirection: 'row', gap: 10 },
  fineInput: {
    flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12,
    fontSize: 14, height: 42,
  },
  chargeBtn: {
    backgroundColor: '#dc2626', borderRadius: 10, height: 42,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16,
  },
  chargeBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
});
