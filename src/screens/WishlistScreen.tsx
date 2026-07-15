import { useState, useCallback, useMemo} from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';
import type { MainTabParamList } from '../navigation/MainTabNavigator';
import { supabase } from '../services/supabase';
import type { Item } from '../types/item';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { CategoryIcon } from '../components/CategoryIcon';
import { ChevronLeft, Heart, X } from 'lucide-react-native';

type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<ProfileStackParamList, 'Wishlist'>,
  BottomTabNavigationProp<MainTabParamList>
>;

export default function WishlistScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<Nav>();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchWishlist() {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from('wishlist')
      .select('item_id, items(id, owner_id, title, description, daily_price, sale_price, category, city, photos)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    const fetched: Item[] = (data ?? [])
      .map((row: any) => row.items)
      .filter(Boolean);

    setItems(fetched);
    setLoading(false);
  }

  useFocusEffect(useCallback(() => { fetchWishlist(); }, []));

  async function removeFromWishlist(itemId: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('wishlist').delete().eq('user_id', user.id).eq('item_id', itemId);
    setItems(prev => prev.filter(i => i.id !== itemId));
  }

  function renderItem({ item }: { item: Item }) {
    const photo = item.photos?.filter(Boolean)[0];

    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => (navigation as any).navigate('HomeStack', {
          screen: 'ItemDetail',
          params: { item },
        })}
        activeOpacity={0.85}
      >
        <View style={styles.cardImage}>
          {photo
            ? <Image source={{ uri: photo }} style={styles.img} resizeMode="cover" />
            : <CategoryIcon category={item.category} size={28} color={colors.textSecondary} />
          }
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.cardSub}>{item.city ?? ''} · ₪{item.daily_price}/day</Text>
        </View>
        <TouchableOpacity style={styles.removeBtn} onPress={() => removeFromWishlist(item.id)} hitSlop={8}>
          <X size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ChevronLeft size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Wishlist</Text>
        <View style={styles.backBtn} />
      </View>

      {loading
        ? <ActivityIndicator color={colors.text} style={{ marginTop: 40 }} />
        : items.length === 0
          ? (
            <View style={styles.empty}>
              <Heart size={48} color={colors.textFaint} strokeWidth={1.5} />
              <Text style={styles.emptyText}>Your wishlist is empty</Text>
              <Text style={styles.emptySub}>Save items by tapping the heart on any listing</Text>
            </View>
          )
          : (
            <FlatList
              data={items}
              keyExtractor={i => i.id}
              renderItem={renderItem}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
            />
          )
      }
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  backBtn: { width: 36, alignItems: 'flex-start' },
  backArrow: { fontSize: 28, color: colors.text, fontWeight: '300', lineHeight: 32 },
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.text },

  list: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },

  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: 14,
    padding: 12, borderWidth: 1, borderColor: colors.border,
  },
  cardImage: {
    width: 60, height: 60, borderRadius: 10,
    backgroundColor: colors.chip, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  img: { width: 60, height: 60 },
  emoji: { fontSize: 28 },
  cardInfo: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  cardSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  removeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.chip, alignItems: 'center', justifyContent: 'center',
  },
  removeBtnText: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyIcon: { fontSize: 48 },
  emptyText: { fontSize: 18, fontWeight: '600', color: colors.text },
  emptySub: { fontSize: 14, color: colors.textFaint, textAlign: 'center', paddingHorizontal: 32 },
});
