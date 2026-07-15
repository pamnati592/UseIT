import { useState, useCallback, useMemo} from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { CategoryIcon } from '../components/CategoryIcon';
import { ChevronLeft, Package, Calendar, Pencil, Eye, EyeOff } from 'lucide-react-native';

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
  owner_id: string;
  title: string;
  category: string;
  description: string | null;
  daily_price: number;
  sale_price: number | null;
  city: string | null;
  photos: string[] | null;
  pickup_location: string | null;
  verification_status: string;
  is_hidden: boolean;
  bookings: Booking[];
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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
        .select('id, owner_id, title, category, description, daily_price, sale_price, city, photos, pickup_location, verification_status, is_hidden')
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
        description: item.description ?? null,
        sale_price: item.sale_price ?? null,
        city: item.city ?? null,
        photos: item.photos ?? null,
        is_hidden: item.is_hidden ?? false,
        bookings: txByItem[item.id] ?? [],
      }))
    );
    setLoading(false);
  }

  async function toggleHidden(item: ItemRow) {
    const next = !item.is_hidden;
    const { error } = await supabase.from('items').update({ is_hidden: next }).eq('id', item.id);
    if (error) { Alert.alert('Error', error.message); return; }
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, is_hidden: next } : i));
  }

  if (loading) {
    return <SafeAreaView style={styles.container}><ActivityIndicator color={colors.text} style={{ flex: 1 }} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <ChevronLeft size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>My Items</Text>
      </View>

      {items.length === 0 ? (
        <View style={styles.empty}>
          <Package size={48} color={colors.textFaint} strokeWidth={1.5} />
          <Text style={styles.emptyTitle}>No items yet</Text>
          <Text style={styles.emptySubtext}>Tap + to list your first item</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={i => i.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            return (
              <View style={[styles.card, item.is_hidden && styles.cardHidden]}>
                <TouchableOpacity
                  style={styles.cardHeader}
                  activeOpacity={0.7}
                  onPress={() => navigation.navigate('ItemDetail', { item: {
                    id: item.id,
                    owner_id: item.owner_id,
                    title: item.title,
                    category: item.category,
                    description: item.description,
                    daily_price: item.daily_price,
                    sale_price: item.sale_price,
                    city: item.city,
                    photos: item.photos,
                    pickup_location: item.pickup_location,
                  }})}
                >
                  <View style={styles.emoji}>
                    <CategoryIcon category={item.category} size={28} color={colors.textSecondary} />
                  </View>
                  <View style={styles.cardMeta}>
                    <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.itemPrice}>₪{item.daily_price}/day</Text>
                  </View>
                  <Text style={styles.cardChevron}>›</Text>
                </TouchableOpacity>

                {/* Action row */}
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => navigation.navigate('ManageItem', { itemId: item.id, itemTitle: item.title })}
                  >
                    <Calendar size={14} color={colors.textSecondary} />
                    <Text style={styles.actionBtnText}>Manage</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.actionBtn}
                    onPress={() => navigation.navigate('EditItem', { itemId: item.id })}
                  >
                    <Pencil size={14} color={colors.textSecondary} />
                    <Text style={styles.actionBtnText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, item.is_hidden && styles.actionBtnActive]}
                    onPress={() => toggleHidden(item)}
                  >
                    {item.is_hidden
                      ? <Eye size={14} color={colors.textSecondary} />
                      : <EyeOff size={14} color={colors.textSecondary} />}
                    <Text style={styles.actionBtnText}>{item.is_hidden ? 'Show' : 'Hide'}</Text>
                  </TouchableOpacity>
                </View>

              </View>
            );
          }}
        />
      )}

      {/* Blocked dates editor */}
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
    backgroundColor: colors.surface, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border, padding: 16, gap: 12,
  },
  cardHidden: { opacity: 0.5 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  emoji: { width: 40, alignItems: 'center', justifyContent: 'center' },
  cardMeta: { flex: 1 },
  itemTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  itemPrice: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  cardChevron: { fontSize: 22, color: colors.textFaint, fontWeight: '300' },
  availBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  availText: { fontSize: 12, fontWeight: '600' },

  actionRow: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flex: 1, height: 36,
    backgroundColor: colors.card, borderRadius: 8,
    borderWidth: 1, borderColor: colors.border,
    flexDirection: 'row', gap: 5,
    alignItems: 'center', justifyContent: 'center',
  },
  actionBtnActive: { borderColor: colors.primary, backgroundColor: colors.infoBg },
  actionBtnText: { color: colors.textSecondary, fontSize: 12, fontWeight: '500' },

  bookingsSection: { gap: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 12 },
  bookingsSectionTitle: { fontSize: 11, color: colors.textFaint, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  bookingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  bookingDates: { fontSize: 13, color: colors.textSecondary, flex: 1 },
  bookingRenter: { fontSize: 13, color: colors.textMuted, maxWidth: 80 },
  bookingRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  bookingStatus: { fontSize: 12, fontWeight: '600' },
  bookingChevron: { fontSize: 16, color: colors.textFaint, fontWeight: '300' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingBottom: 60 },
  emptyIcon: { fontSize: 48 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: colors.text },
  emptySubtext: { fontSize: 14, color: colors.textFaint },

});
