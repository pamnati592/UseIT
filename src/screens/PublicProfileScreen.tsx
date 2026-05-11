import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { HomeStackParamList } from '../navigation/HomeStackNavigator';
import type { Item } from '../types/item';
import { supabase } from '../services/supabase';

const CATEGORY_EMOJI: Record<string, string> = {
  photography: '📷', gaming: '🎮', camping: '⛺',
  diy: '🔧', music: '🎸', sports: '⚽',
};

type Props = NativeStackScreenProps<HomeStackParamList, 'PublicProfile'>;

export default function PublicProfileScreen({ navigation, route }: Props) {
  const { userId, userName } = route.params;
  const [items, setItems]           = useState<Item[]>([]);
  const [city, setCity]             = useState<string | null>(null);
  const [lenderScore, setLenderScore] = useState<number | null>(null);
  const [renterScore, setRenterScore] = useState<number | null>(null);
  const [avatarUrl, setAvatarUrl]   = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);

  useEffect(() => {
    async function load() {
      const [profileRes, itemsRes] = await Promise.all([
        supabase.from('profiles').select('city, lender_score, renter_score, avatar_url').eq('id', userId).single(),
        supabase
          .from('items')
          .select('id, owner_id, title, description, daily_price, sale_price, category, city, photos')
          .eq('owner_id', userId)
          .eq('verification_status', 'live')
          .eq('is_hidden', false)
          .order('created_at', { ascending: false }),
      ]);
      if (profileRes.data) {
        setCity((profileRes.data as any).city ?? null);
        setLenderScore((profileRes.data as any).lender_score ?? null);
        setRenterScore((profileRes.data as any).renter_score ?? null);
        setAvatarUrl((profileRes.data as any).avatar_url ?? null);
      }
      if (itemsRes.data) setItems(itemsRes.data as Item[]);
      setLoading(false);
    }
    load();
  }, [userId]);

  function scoreLabel(score: number | null): string {
    if (score === null || score === 0) return '—';
    return score.toFixed(1);
  }

  function renderItem({ item }: { item: Item }) {
    const cover = item.photos?.find(Boolean);
    const emoji = CATEGORY_EMOJI[item.category] ?? '📦';
    return (
      <TouchableOpacity
        style={styles.itemCard}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('ItemDetail', { item })}
      >
        {cover
          ? <Image source={{ uri: cover }} style={styles.itemThumb} resizeMode="cover" />
          : <View style={styles.itemThumbEmoji}><Text style={styles.itemEmoji}>{emoji}</Text></View>
        }
        <View style={styles.itemInfo}>
          <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.itemPrice}>₪{item.daily_price}/day</Text>
          {item.city && <Text style={styles.itemCity}>📍 {item.city}</Text>}
        </View>
        <Text style={styles.itemChevron}>›</Text>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={loading ? [] : items}
        keyExtractor={i => i.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.header}>
            <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
              <Text style={styles.backText}>‹</Text>
            </TouchableOpacity>

            <View style={styles.avatarSection}>
              <View style={styles.avatar}>
                {avatarUrl
                  ? <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
                  : <Text style={styles.avatarInitial}>{userName.charAt(0).toUpperCase()}</Text>
                }
              </View>
              <Text style={styles.userName}>{userName}</Text>
              {city ? <Text style={styles.userCity}>📍 {city}</Text> : null}
            </View>

            <View style={styles.scoreRow}>
              <View style={styles.scoreBadge}>
                <Text style={styles.scoreValue}>{scoreLabel(lenderScore)}</Text>
                <Text style={styles.scoreLabel}>Lender</Text>
              </View>
              <View style={styles.scoreDivider} />
              <View style={styles.scoreBadge}>
                <Text style={styles.scoreValue}>{scoreLabel(renterScore)}</Text>
                <Text style={styles.scoreLabel}>Renter</Text>
              </View>
            </View>

            {!loading && items.length > 0 && (
              <Text style={styles.sectionTitle}>LISTINGS</Text>
            )}
          </View>
        }
        ListEmptyComponent={
          loading
            ? <ActivityIndicator color="#fff" style={{ marginTop: 40 }} />
            : <View style={styles.empty}><Text style={styles.emptyText}>No active listings</Text></View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a1a' },
  listContent: { paddingBottom: 40 },
  header: { paddingBottom: 8 },

  backButton: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  backText: { fontSize: 32, color: '#fff', fontWeight: '300', lineHeight: 36 },

  avatarSection: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#3a3a3a', borderWidth: 1, borderColor: '#4a4a4a',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: 32, fontWeight: '700', color: '#fff' },
  avatarImage: { width: 80, height: 80, borderRadius: 40 },
  userName: { fontSize: 22, fontWeight: '700', color: '#fff' },
  userCity: { fontSize: 14, color: '#888' },

  scoreRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginHorizontal: 40, marginBottom: 28,
    backgroundColor: '#242424', borderRadius: 16,
    borderWidth: 1, borderColor: '#2a2a2a',
    paddingVertical: 16,
  },
  scoreBadge: { flex: 1, alignItems: 'center', gap: 4 },
  scoreValue: { fontSize: 22, fontWeight: '700', color: '#fff' },
  scoreLabel: { fontSize: 12, color: '#666', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },
  scoreDivider: { width: 1, height: 36, backgroundColor: '#2a2a2a' },

  sectionTitle: {
    fontSize: 11, fontWeight: '600', color: '#555',
    letterSpacing: 1, paddingHorizontal: 20, marginBottom: 12,
  },

  itemCard: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: '#242424', borderRadius: 14,
    borderWidth: 1, borderColor: '#2a2a2a', overflow: 'hidden',
  },
  itemThumb: { width: 72, height: 72 },
  itemThumbEmoji: {
    width: 72, height: 72, backgroundColor: '#2a2a2a',
    alignItems: 'center', justifyContent: 'center',
  },
  itemEmoji: { fontSize: 28 },
  itemInfo: { flex: 1, paddingHorizontal: 14, gap: 3 },
  itemTitle: { fontSize: 15, fontWeight: '600', color: '#fff' },
  itemPrice: { fontSize: 13, color: '#888' },
  itemCity: { fontSize: 12, color: '#555' },
  itemChevron: { fontSize: 22, color: '#444', paddingRight: 14, fontWeight: '300' },

  empty: { alignItems: 'center', paddingTop: 40 },
  emptyText: { fontSize: 15, color: '#555' },
});
