import { useState, useCallback, useMemo} from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { CategoryIcon } from '../components/CategoryIcon';
import { ChevronLeft, ClipboardList } from 'lucide-react-native';

type RentalRow = {
  id: string;
  start_date: string;
  end_date: string;
  total_price: number;
  status: string;
  approved_at: string | null;
  conversation_id: string | null;
  item_title: string;
  item_category: string;
  lender_name: string;
};


const statusColorMap = (c: ThemeColors): Record<string, string> => ({
  pending:   c.warning,
  approved:  c.primary,
  paid:      c.primary,
  active:    c.success,
  completed: c.textFaint,
  rejected:  c.textMuted,
  cancelled: c.textMuted,
  disputed:  c.danger,
});

const STATUS_LABEL: Record<string, string> = {
  pending:   'Awaiting approval',
  approved:  'Approved – pay now',
  paid:      'Paid – awaiting pickup',
  active:    'Active rental',
  completed: 'Completed',
  rejected:  'Declined',
  cancelled: 'Cancelled',
  disputed:  'Disputed',
};

type Props = NativeStackScreenProps<ProfileStackParamList, 'MyRentals'>;

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function isPaymentExpired(approvedAt: string | null): boolean {
  if (!approvedAt) return false;
  return Date.now() - new Date(approvedAt).getTime() > 86_400_000;
}

export default function MyRentalsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [rentals, setRentals] = useState<RentalRow[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => { load(); }, [])
  );

  async function load() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from('transactions')
      .select(`
        id, start_date, end_date, total_price, status, approved_at, conversation_id,
        item:items(title, category),
        lender:profiles!transactions_lender_id_fkey(full_name)
      `)
      .eq('renter_id', user.id)
      .order('created_at', { ascending: false });

    setRentals(
      (data ?? []).map((tx: any) => ({
        id: tx.id,
        start_date: tx.start_date,
        end_date: tx.end_date,
        total_price: tx.total_price,
        status: tx.status,
        approved_at: tx.approved_at ?? null,
        conversation_id: tx.conversation_id ?? null,
        item_title: tx.item?.title ?? 'Item',
        item_category: tx.item?.category ?? '',
        lender_name: tx.lender?.full_name ?? 'Lender',
      }))
    );
    setLoading(false);
  }

  function statusLabel(r: RentalRow): string {
    if (r.status === 'approved' && isPaymentExpired(r.approved_at)) return 'Time exceeded';
    return STATUS_LABEL[r.status] ?? r.status;
  }

  function statusColor(r: RentalRow): string {
    if (r.status === 'approved' && isPaymentExpired(r.approved_at)) return colors.warning;
    return statusColorMap(colors)[r.status] ?? colors.textMuted;
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
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <ChevronLeft size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>My Rentals</Text>
      </View>

      {rentals.length === 0 ? (
        <View style={styles.empty}>
          <ClipboardList size={48} color={colors.textFaint} strokeWidth={1.5} />
          <Text style={styles.emptyTitle}>No rentals yet</Text>
          <Text style={styles.emptySubtext}>Swipe right on an item and send a rental request</Text>
        </View>
      ) : (
        <FlatList
          data={rentals}
          keyExtractor={r => r.id}
          contentContainerStyle={styles.list}
          renderItem={({ item: r }) => {
            const color = statusColor(r);
            return (
              <TouchableOpacity
                style={styles.card}
                disabled={!r.conversation_id}
                onPress={() => {
                  if (!r.conversation_id) return;
                  (navigation as any).getParent()?.navigate('Chats', {
                    screen: 'ChatRoom',
                    params: {
                      conversationId: r.conversation_id,
                      itemTitle: r.item_title,
                      otherUserName: r.lender_name,
                      targetTransactionId: r.id,
                      initialTab: 'deal' as const,
                    },
                  });
                }}
              >
                <View style={styles.emoji}>
                  <CategoryIcon category={r.item_category} size={28} color={colors.textSecondary} />
                </View>
                <View style={styles.info}>
                  <Text style={styles.itemTitle} numberOfLines={1}>{r.item_title}</Text>
                  <Text style={styles.dates}>{fmt(r.start_date)} → {fmt(r.end_date)}</Text>
                  <Text style={styles.lender} numberOfLines={1}>from {r.lender_name}</Text>
                </View>
                <View style={styles.right}>
                  <Text style={styles.price}>₪{r.total_price}</Text>
                  <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color }]}>
                    <Text style={[styles.badgeText, { color }]}>{statusLabel(r)}</Text>
                  </View>
                  {r.conversation_id && <Text style={styles.chevron}>›</Text>}
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
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText: { color: colors.text, fontSize: 22, fontWeight: '300' },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },

  list: { padding: 16, gap: 12 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.surface, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  emoji: { width: 40, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, gap: 2 },
  itemTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  dates: { fontSize: 13, color: colors.textSecondary },
  lender: { fontSize: 12, color: colors.textFaint },
  right: { alignItems: 'flex-end', gap: 6 },
  price: { fontSize: 14, fontWeight: '700', color: colors.text },
  badge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 20, borderWidth: 1,
  },
  badgeText: { fontSize: 11, fontWeight: '600' },
  chevron: { fontSize: 18, color: colors.textFaint, fontWeight: '300' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 60 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  emptySubtext: { fontSize: 14, color: colors.textFaint, textAlign: 'center', paddingHorizontal: 40 },
});
