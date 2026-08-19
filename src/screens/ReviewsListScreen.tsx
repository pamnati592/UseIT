import { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Star, MessageSquareText, Package } from 'lucide-react-native';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';

const STAR_COLOR = '#f59e0b';

// One reusable list for both review sources in the app (SAS) — an item's
// reviews (item_reviews) and a person's reviews in one specific role
// (ratings, filtered to transactions where they actually held that role —
// see the 2026-08-19 fix, a rating given while renting must never count
// toward the lender score/reviews and vice versa). Reachable from both
// HomeStack (ItemDetail) and ProfileStack (PublicProfile/own Profile).
type Props = {
  navigation: any;
  route: {
    params:
      | { mode: 'item'; itemId: string; itemTitle: string }
      | { mode: 'profile'; userId: string; userName: string; role: 'lender' | 'renter' };
  };
};

type ReviewRow = {
  id: string;
  score: number;
  comment: string | null;
  created_at: string;
  reviewerName: string;
  itemTitle?: string;
};

export default function ReviewsListScreen({ navigation, route }: Props) {
  const params = route.params;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      if (params.mode === 'item') {
        const { data } = await supabase
          .from('item_reviews')
          .select('id, score, comment, created_at, reviewer:profiles!item_reviews_reviewer_id_fkey(full_name)')
          .eq('item_id', params.itemId)
          .order('created_at', { ascending: false });
        if (!mounted) return;
        setReviews(((data as any[]) ?? []).map(r => ({
          id: r.id, score: r.score, comment: r.comment, created_at: r.created_at,
          reviewerName: r.reviewer?.full_name ?? 'A renter',
        })));
      } else {
        // A raw client-side join through `transactions` would silently come
        // back empty for any viewer who isn't a party to that transaction —
        // "transactions: read own" RLS restricts it to renter_id/lender_id =
        // auth.uid(). A public trust score has to be visible to everyone, so
        // this goes through a narrow RPC that returns only the review fields
        // (never the raw transaction row) instead.
        const { data } = await supabase.rpc('list_role_reviews', { p_user_id: params.userId, p_role: params.role });
        if (!mounted) return;
        setReviews(((data as any[]) ?? []).map(r => ({
          id: r.id, score: r.score, comment: r.comment, created_at: r.created_at,
          reviewerName: r.reviewer_name ?? 'A user',
          itemTitle: r.item_title,
        })));
      }
      setLoading(false);
    }
    load();
    return () => { mounted = false; };
  }, [params.mode, params.mode === 'item' ? params.itemId : params.userId, params.mode === 'profile' ? params.role : null]);

  const title = params.mode === 'item'
    ? params.itemTitle
    : `${params.userName} · as ${params.role === 'lender' ? 'Lender' : 'Renter'}`;

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function renderItem({ item: r }: { item: ReviewRow }) {
    return (
      <View style={styles.card}>
        <View style={styles.cardTop}>
          <Text style={styles.reviewerName} numberOfLines={1}>{r.reviewerName}</Text>
          <View style={styles.starsRow}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} size={14} color={STAR_COLOR} fill={i < r.score ? STAR_COLOR : 'transparent'} strokeWidth={1.8} />
            ))}
          </View>
        </View>
        {r.itemTitle && (
          <View style={styles.itemRow}>
            <Package size={12} color={colors.textMuted} />
            <Text style={styles.itemRowText} numberOfLines={1}>{r.itemTitle}</Text>
          </View>
        )}
        {r.comment ? (
          <Text style={styles.comment}>{r.comment}</Text>
        ) : (
          <Text style={styles.noComment}>No comment left</Text>
        )}
        <Text style={styles.date}>{formatDate(r.created_at)}</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ChevronLeft size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.text} style={{ flex: 1 }} />
      ) : reviews.length === 0 ? (
        <View style={styles.empty}>
          <MessageSquareText size={44} color={colors.textFaint} strokeWidth={1.5} />
          <Text style={styles.emptyText}>No reviews yet</Text>
        </View>
      ) : (
        <FlatList
          data={reviews}
          keyExtractor={(r) => r.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
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
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: colors.text },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { fontSize: 15, color: colors.textFaint },
  list: { padding: 16 },
  card: {
    backgroundColor: colors.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: colors.border, gap: 6,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  reviewerName: { fontSize: 14.5, fontWeight: '700', color: colors.text, flex: 1 },
  starsRow: { flexDirection: 'row', gap: 1 },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  itemRowText: { fontSize: 12, color: colors.textFaint },
  comment: { fontSize: 13.5, color: colors.textSecondary, lineHeight: 19 },
  noComment: { fontSize: 13.5, color: colors.textFaint, fontStyle: 'italic' },
  date: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
});
