import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';

type Booking = {
  id: string;
  start_date: string;
  end_date: string;
  status: string;
  renter_name: string;
  conversation_id: string | null;
};

type ItemRow = {
  id: string;
  title: string;
  category: string;
  verification_status: string;
  daily_price: number;
  is_hidden: boolean;
  bookings: Booking[];
};

const CATEGORY_EMOJI: Record<string, string> = {
  photography: '📷', gaming: '🎮', camping: '⛺',
  diy: '🔧', music: '🎸', sports: '⚽',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#f0a500', approved: '#4da6ff',
  active: '#4cd964', completed: '#666', rejected: '#888',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', approved: 'Approved',
  active: 'Active', completed: 'Done', rejected: 'Declined',
};

type Props = NativeStackScreenProps<ProfileStackParamList, 'MyItems'>;

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function MyItemsScreen({ navigation }: Props) {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => { load(); }, []));

  async function load() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const [itemsRes, txRes] = await Promise.all([
      supabase
        .from('items')
        .select('id, title, category, verification_status, daily_price, is_hidden')
        .eq('owner_id', user.id)
        .order('created_at', { ascending: false }),
      supabase
        .from('transactions')
        .select('id, item_id, start_date, end_date, status, conversation_id, renter:profiles!transactions_renter_id_fkey(full_name)')
        .eq('lender_id', user.id)
        .in('status', ['pending', 'approved', 'active'])
        .order('start_date', { ascending: true }),
    ]);

    if (!itemsRes.data) { setLoading(false); return; }

    const txByItem: Record<string, Booking[]> = {};
    (txRes.data ?? []).forEach((tx: any) => {
      if (!txByItem[tx.item_id]) txByItem[tx.item_id] = [];
      txByItem[tx.item_id].push({
        id: tx.id,
        start_date: tx.start_date,
        end_date: tx.end_date,
        status: tx.status,
        renter_name: tx.renter?.full_name ?? 'Renter',
        conversation_id: tx.conversation_id ?? null,
      });
    });

    setItems(
      (itemsRes.data as any[]).map(item => ({
        ...item,
        is_hidden: item.is_hidden ?? false,
        bookings: txByItem[item.id] ?? [],
      }))
    );
    setLoading(false);
  }

  function itemAvailability(item: ItemRow): { label: string; color: string } {
    if (item.is_hidden) return { label: 'Hidden', color: '#666' };
    const active = item.bookings.find(b => b.status === 'active');
    if (active) return { label: 'Rented', color: '#4cd964' };
    const approved = item.bookings.find(b => b.status === 'approved');
    if (approved) return { label: 'Booked', color: '#4da6ff' };
    const pending = item.bookings.find(b => b.status === 'pending');
    if (pending) return { label: `${item.bookings.filter(b => b.status === 'pending').length} pending`, color: '#f0a500' };
    return { label: 'Available', color: '#4cd964' };
  }

  async function toggleHidden(item: ItemRow) {
    const next = !item.is_hidden;
    const { error } = await supabase.from('items').update({ is_hidden: next }).eq('id', item.id);
    if (error) { Alert.alert('Error', error.message); return; }
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_hidden: next } : i));
  }

  if (loading) {
    return <SafeAreaView style={styles.container}><ActivityIndicator color="#fff" style={{ flex: 1 }} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.title}>My Items</Text>
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>📦</Text>
          <Text style={styles.emptyTitle}>No items yet</Text>
          <Text style={styles.emptySubtext}>Tap + to list your first item</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const avail = itemAvailability(item);
            return (
              <View style={[styles.card, item.is_hidden && styles.cardHidden]}>
                <View style={styles.cardHeader}>
                  <Text style={styles.emoji}>{CATEGORY_EMOJI[item.category] ?? '📦'}</Text>
                  <View style={styles.cardMeta}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.itemPrice}>₪{item.daily_price}/day</Text>
                  </View>
                  <View style={[styles.availBadge, { backgroundColor: avail.color + '22', borderColor: avail.color }]}>
                    <Text style={[styles.availText, { color: avail.color }]}>{avail.label}</Text>
                  </View>
                </View>

                {/* Action row */}
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => navigation.navigate('ManageItem', { itemId: item.id, itemTitle: item.title })}
                  >
                    <Text style={styles.actionBtnText}>📅 Manage</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, item.is_hidden && styles.actionBtnActive]}
                    onPress={() => toggleHidden(item)}
                  >
                    <Text style={styles.actionBtnText}>{item.is_hidden ? '👁 Show item' : '🙈 Hide item'}</Text>
                  </TouchableOpacity>
                </View>

                {item.bookings.length > 0 && (
                  <View style={styles.bookingsSection}>
                    <Text style={styles.bookingsSectionTitle}>Upcoming bookings</Text>
                    {item.bookings.map(b => (
                      <TouchableOpacity
                        key={b.id}
                        style={styles.bookingRow}
                        disabled={!b.conversation_id}
                        onPress={() => {
                          if (!b.conversation_id) return;
                          (navigation as any).getParent()?.navigate('Chats', {
                            screen: 'ChatRoom',
                            params: {
                              conversationId: b.conversation_id,
                              itemTitle: item.title,
                              otherUserName: b.renter_name,
                              targetTransactionId: b.id,
                            },
                          });
                        }}
                      >
                        <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[b.status] ?? '#666' }]} />
                        <Text style={styles.bookingDates}>{fmt(b.start_date)} → {fmt(b.end_date)}</Text>
                        <Text style={styles.bookingRenter} numberOfLines={1}>{b.renter_name}</Text>
                        <View style={styles.bookingRight}>
                          <Text style={[styles.bookingStatus, { color: STATUS_COLORS[b.status] ?? '#666' }]}>
                            {STATUS_LABELS[b.status] ?? b.status}
                          </Text>
                          {b.conversation_id && <Text style={styles.bookingChevron}>›</Text>}
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>
            );
          }}
        />
      )}

      {/* Blocked dates editor */}
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
    backgroundColor: '#242424', borderRadius: 16,
    borderWidth: 1, borderColor: '#2a2a2a', padding: 16, gap: 12,
  },
  cardHidden: { opacity: 0.5 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  emoji: { fontSize: 32 },
  cardMeta: { flex: 1 },
  itemTitle: { fontSize: 16, fontWeight: '600', color: '#fff' },
  itemPrice: { fontSize: 13, color: '#888', marginTop: 2 },
  availBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  availText: { fontSize: 12, fontWeight: '600' },

  actionRow: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flex: 1, height: 36,
    backgroundColor: '#2a2a2a', borderRadius: 8,
    borderWidth: 1, borderColor: '#3a3a3a',
    alignItems: 'center', justifyContent: 'center',
  },
  actionBtnActive: { borderColor: '#4da6ff', backgroundColor: '#0a1a2a' },
  actionBtnText: { color: '#aaa', fontSize: 12, fontWeight: '500' },

  bookingsSection: { gap: 8, borderTopWidth: 1, borderTopColor: '#2a2a2a', paddingTop: 12 },
  bookingsSectionTitle: { fontSize: 11, color: '#555', fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  bookingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  bookingDates: { fontSize: 13, color: '#ccc', flex: 1 },
  bookingRenter: { fontSize: 13, color: '#888', maxWidth: 80 },
  bookingRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bookingStatus: { fontSize: 12, fontWeight: '600' },
  bookingChevron: { fontSize: 16, color: '#555', fontWeight: '300' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 60 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#fff' },
  emptySubtext: { fontSize: 14, color: '#666' },

});
