import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';

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

const CATEGORY_EMOJI: Record<string, string> = {
  photography: '📷', gaming: '🎮', camping: '⛺',
  diy: '🔧', music: '🎸', sports: '⚽',
};

const STATUS_COLOR: Record<string, string> = {
  pending:   '#f0a500',
  approved:  '#4da6ff',
  active:    '#4cd964',
  completed: '#666',
  rejected:  '#888',
  cancelled: '#888',
};

const STATUS_LABEL: Record<string, string> = {
  pending:   'Awaiting approval',
  approved:  'Approved – pay now',
  active:    'Active rental',
  completed: 'Completed',
  rejected:  'Declined',
  cancelled: 'Cancelled',
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
    if (r.status === 'approved' && isPaymentExpired(r.approved_at)) return '#f0a500';
    return STATUS_COLOR[r.status] ?? '#666';
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color="#fff" style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>My Rentals</Text>
      </View>

      {rentals.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📋</Text>
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
                      initialTab: 'rental' as const,
                    },
                  });
                }}
              >
                <Text style={styles.emoji}>{CATEGORY_EMOJI[r.item_category] ?? '📦'}</Text>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a1a' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#2a2a2a',
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText: { color: '#fff', fontSize: 22, fontWeight: '300' },
  title: { fontSize: 20, fontWeight: '700', color: '#fff' },

  list: { padding: 16, gap: 12 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#242424', borderRadius: 16,
    borderWidth: 1, borderColor: '#2a2a2a',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  emoji: { fontSize: 32 },
  info: { flex: 1, gap: 2 },
  itemTitle: { fontSize: 15, fontWeight: '600', color: '#fff' },
  dates: { fontSize: 13, color: '#aaa' },
  lender: { fontSize: 12, color: '#666' },
  right: { alignItems: 'flex-end', gap: 6 },
  price: { fontSize: 14, fontWeight: '700', color: '#fff' },
  badge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 20, borderWidth: 1,
  },
  badgeText: { fontSize: 11, fontWeight: '600' },
  chevron: { fontSize: 18, color: '#555', fontWeight: '300' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 60 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#fff' },
  emptySubtext: { fontSize: 14, color: '#666', textAlign: 'center', paddingHorizontal: 40 },
});
