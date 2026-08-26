import { useState, useEffect, useMemo} from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  Image, ActivityIndicator, Modal, Alert, TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { HomeStackParamList } from '../navigation/HomeStackNavigator';
import type { Item } from '../types/item';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { CategoryIcon } from '../components/CategoryIcon';
import { ChevronLeft, ChevronRight, MapPin, Check, X, TriangleAlert, Flag } from 'lucide-react-native';

const REPORT_REASONS = ['Harassment', 'Scam or fraud', 'Inappropriate content', 'Item not as described', 'Other'];

type Props = NativeStackScreenProps<HomeStackParamList, 'PublicProfile'>;

export default function PublicProfileScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { userId, userName, approveTransactionId, requestSummary, conversationId, itemTitle } = route.params;
  const [decideLoading, setDecideLoading] = useState(false);
  const [decided, setDecided] = useState<'approved' | 'declined' | null>(null);

  // Approving/declining doesn't happen here — it's handed back to ChatRoomScreen,
  // the one canonical place every rental action executes (SAS), so the chat
  // system-message and unread-badge side effects always fire the same way
  // regardless of whether the decision was made in chat or from this shortcut.
  function decideRequest(status: 'approved' | 'declined') {
    if (!approveTransactionId || !conversationId) return;
    setDecideLoading(true);
    setDecided(status);
    setDecideLoading(false);
    setTimeout(() => {
      (navigation as any).getParent()?.navigate('Chats', {
        screen: 'ChatRoom',
        params: {
          conversationId,
          itemTitle: itemTitle ?? '',
          otherUserName: userName,
          initialTab: 'deal',
          approveTransactionId: status === 'approved' ? approveTransactionId : undefined,
          rejectTransactionId: status === 'declined' ? approveTransactionId : undefined,
        },
      });
    }, 900);
  }
  const [items, setItems]           = useState<Item[]>([]);
  const [city, setCity]             = useState<string | null>(null);
  const [lenderScore, setLenderScore] = useState<number | null>(null);
  const [renterScore, setRenterScore] = useState<number | null>(null);
  const [lenderReviewCount, setLenderReviewCount] = useState(0);
  const [renterReviewCount, setRenterReviewCount] = useState(0);
  const [lenderCancellations, setLenderCancellations] = useState(0);
  const [avatarUrl, setAvatarUrl]   = useState<string | null>(null);
  const [loading, setLoading]       = useState(true);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [reportModalVisible, setReportModalVisible] = useState(false);
  const [reportReason, setReportReason] = useState<string | null>(null);
  const [reportDescription, setReportDescription] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null));
  }, []);

  async function submitReport() {
    if (!reportReason || reportSubmitting) return;
    setReportSubmitting(true);
    const { error } = await supabase.rpc('report_user', {
      p_reported_user_id: userId,
      p_reason: reportReason,
      p_description: reportDescription.trim() || undefined,
    });
    setReportSubmitting(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setReportModalVisible(false);
    setReportReason(null);
    setReportDescription('');
    Alert.alert('Report submitted', 'Thanks — UseIT will review this.');
  }

  useEffect(() => {
    async function load() {
      const [profileRes, itemsRes, lenderReviewsRes, renterReviewsRes] = await Promise.all([
        supabase.from('profiles').select('city, lender_score, renter_score, lender_cancellations, avatar_url').eq('id', userId).single(),
        supabase
          .from('items')
          .select('id, owner_id, title, description, daily_price, sale_price, category, city, photos')
          .eq('owner_id', userId)
          .eq('verification_status', 'live')
          .eq('is_hidden', false)
          .order('created_at', { ascending: false }),
        // A rating's role (lender vs renter review) isn't stored directly —
        // it's implicit in which side of the linked transaction the reviewee
        // was on, same as the score-recompute functions key off. Goes through
        // list_role_reviews rather than a raw join on transactions: that
        // table's RLS is scoped to its own two parties, which silently
        // undercounted for any viewer who wasn't personally involved.
        supabase.rpc('list_role_reviews', { p_user_id: userId, p_role: 'lender' }),
        supabase.rpc('list_role_reviews', { p_user_id: userId, p_role: 'renter' }),
      ]);
      if (profileRes.data) {
        setCity((profileRes.data as any).city ?? null);
        setLenderScore((profileRes.data as any).lender_score ?? null);
        setRenterScore((profileRes.data as any).renter_score ?? null);
        setLenderCancellations((profileRes.data as any).lender_cancellations ?? 0);
        setAvatarUrl((profileRes.data as any).avatar_url ?? null);
      }
      if (itemsRes.data) setItems(itemsRes.data as Item[]);
      setLenderReviewCount((lenderReviewsRes.data as any[])?.length ?? 0);
      setRenterReviewCount((renterReviewsRes.data as any[])?.length ?? 0);
      setLoading(false);
    }
    load();
  }, [userId]);

  function scoreLabel(score: number | null): string {
    if (score === null || score === 0) return '—';
    return score.toFixed(1);
  }

  // Threshold is a first pass, not a tuned figure — worth revisiting once
  // there's real usage data on what a normal cancellation count looks like.
  const LENDER_CANCELLATION_WARNING_THRESHOLD = 3;

  function renderItem({ item }: { item: Item }) {
    const cover = item.photos?.find(Boolean);
    return (
      <TouchableOpacity
        style={styles.itemCard}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('ItemDetail', { item })}
      >
        {cover
          ? <Image source={{ uri: cover }} style={styles.itemThumb} resizeMode="cover" />
          : <View style={styles.itemThumbEmoji}><CategoryIcon category={item.category} size={26} color={colors.textSecondary} /></View>
        }
        <View style={styles.itemInfo}>
          <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.itemPrice}>₪{item.daily_price}/day</Text>
          {item.city && (
            <View style={styles.itemCityRow}>
              <MapPin size={12} color={colors.textMuted} />
              <Text style={styles.itemCity}>{item.city}</Text>
            </View>
          )}
        </View>
        <ChevronRight size={20} color={colors.textFaint} />
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
            <View style={styles.topRow}>
              <TouchableOpacity style={styles.topRowBtn} onPress={() => navigation.canGoBack() ? navigation.goBack() : (navigation as any).getParent()?.navigate('HomeStack')}>
                <ChevronLeft size={26} color={colors.text} />
              </TouchableOpacity>
              {currentUserId && userId !== currentUserId && (
                <TouchableOpacity style={styles.topRowBtn} onPress={() => setReportModalVisible(true)}>
                  <Flag size={20} color={colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.avatarSection}>
              <View style={styles.avatar}>
                {avatarUrl
                  ? <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
                  : <Text style={styles.avatarInitial}>{userName.charAt(0).toUpperCase()}</Text>
                }
              </View>
              <Text style={styles.userName}>{userName}</Text>
              {city ? (
                <View style={styles.userCityRow}>
                  <MapPin size={13} color={colors.textMuted} />
                  <Text style={styles.userCity}>{city}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.scoreRow}>
              <TouchableOpacity
                style={styles.scoreBadge}
                onPress={() => navigation.navigate('ReviewsList', { mode: 'profile', userId, userName, role: 'lender' })}
              >
                <Text style={styles.scoreValue}>{scoreLabel(lenderScore)}</Text>
                <Text style={styles.scoreLabel}>Lender</Text>
                <Text style={styles.reviewCount}>
                  {lenderReviewCount} {lenderReviewCount === 1 ? 'review' : 'reviews'}
                </Text>
              </TouchableOpacity>
              <View style={styles.scoreDivider} />
              <TouchableOpacity
                style={styles.scoreBadge}
                onPress={() => navigation.navigate('ReviewsList', { mode: 'profile', userId, userName, role: 'renter' })}
              >
                <Text style={styles.scoreValue}>{scoreLabel(renterScore)}</Text>
                <Text style={styles.scoreLabel}>Renter</Text>
                <Text style={styles.reviewCount}>
                  {renterReviewCount} {renterReviewCount === 1 ? 'review' : 'reviews'}
                </Text>
              </TouchableOpacity>
            </View>

            {lenderCancellations >= LENDER_CANCELLATION_WARNING_THRESHOLD && (
              <View style={styles.cancellationWarning}>
                <TriangleAlert size={14} color={colors.danger} />
                <Text style={styles.cancellationWarningText}>
                  This lender has cancelled {lenderCancellations} confirmed rentals
                </Text>
              </View>
            )}

            {/* Pending rental request — decide directly from the profile */}
            {approveTransactionId && (
              <View style={styles.approveCard}>
                <Text style={styles.approveTitle}>Rental request from {userName}</Text>
                {requestSummary ? <Text style={styles.approveSummary}>{requestSummary}</Text> : null}
                {decided ? (
                  <View style={styles.decidedRow}>
                    {decided === 'approved'
                      ? <><Check size={16} color={colors.success} strokeWidth={2.5} /><Text style={styles.decidedApproved}>Approved</Text></>
                      : <><X size={16} color={colors.danger} strokeWidth={2.5} /><Text style={styles.decidedDeclined}>Declined</Text></>
                    }
                  </View>
                ) : (
                  <View style={styles.approveActions}>
                    <TouchableOpacity
                      style={[styles.approveBtn, decideLoading && styles.btnDisabled]}
                      onPress={() => decideRequest('approved')}
                      disabled={decideLoading}
                    >
                      {decideLoading
                        ? <ActivityIndicator color={colors.btnText} size="small" />
                        : <><Check size={16} color={colors.btnText} strokeWidth={2.5} /><Text style={styles.approveBtnText}>Approve</Text></>
                      }
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.declineBtn, decideLoading && styles.btnDisabled]}
                      onPress={() => decideRequest('declined')}
                      disabled={decideLoading}
                    >
                      <X size={16} color={colors.textSecondary} strokeWidth={2.5} />
                      <Text style={styles.declineBtnText}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {!loading && items.length > 0 && (
              <Text style={styles.sectionTitle}>LISTINGS</Text>
            )}
          </View>
        }
        ListEmptyComponent={
          loading
            ? <ActivityIndicator color={colors.text} style={{ marginTop: 40 }} />
            : <View style={styles.empty}><Text style={styles.emptyText}>No active listings</Text></View>
        }
      />

      <Modal visible={reportModalVisible} transparent animationType="slide" onRequestClose={() => setReportModalVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Report {userName}</Text>
            <View style={styles.reasonList}>
              {REPORT_REASONS.map((reason) => (
                <TouchableOpacity
                  key={reason}
                  style={[styles.reasonRow, reportReason === reason && styles.reasonRowSelected]}
                  onPress={() => setReportReason(reason)}
                >
                  <Text style={[styles.reasonText, reportReason === reason && styles.reasonTextSelected]}>{reason}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={[styles.reportInput, { color: colors.text, borderColor: colors.border }]}
              placeholder="Add details (optional)"
              placeholderTextColor={colors.textMuted}
              value={reportDescription}
              onChangeText={setReportDescription}
              multiline
            />
            <TouchableOpacity
              style={[styles.modalPrimaryBtn, (!reportReason || reportSubmitting) && styles.btnDisabled]}
              onPress={submitReport}
              disabled={!reportReason || reportSubmitting}
            >
              {reportSubmitting
                ? <ActivityIndicator color={colors.btnText} />
                : <Text style={styles.modalPrimaryBtnText}>Submit Report</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setReportModalVisible(false)} style={styles.modalCancelLink}>
              <Text style={styles.modalCancelLinkText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  listContent: { paddingBottom: 40 },
  header: { paddingBottom: 8 },

  topRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 },
  topRowBtn: { padding: 2 },
  backText: { fontSize: 32, color: colors.text, fontWeight: '300', lineHeight: 36 },

  // Pending request approval card
  approveCard: {
    marginHorizontal: 20, marginTop: 16, padding: 16, gap: 10,
    backgroundColor: colors.card, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border,
  },
  approveTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  approveSummary: { fontSize: 13, color: colors.textMuted, lineHeight: 18 },
  approveActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  approveBtn: {
    flex: 1, height: 44, borderRadius: 12, backgroundColor: colors.btn,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  approveBtnText: { color: colors.btnText, fontSize: 14, fontWeight: '700' },
  declineBtn: {
    flex: 1, height: 44, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.cardAlt,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
  },
  declineBtnText: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
  decidedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6 },
  decidedApproved: { color: colors.success, fontSize: 15, fontWeight: '700' },
  decidedDeclined: { color: colors.danger, fontSize: 15, fontWeight: '700' },

  avatarSection: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarInitial: { fontSize: 32, fontWeight: '700', color: colors.text },
  avatarImage: { width: 80, height: 80, borderRadius: 40 },
  userName: { fontSize: 22, fontWeight: '700', color: colors.text },
  userCityRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  userCity: { fontSize: 14, color: colors.textMuted },

  scoreRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginHorizontal: 40, marginBottom: 28,
    backgroundColor: colors.surface, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border,
    paddingVertical: 16,
  },
  scoreBadge: { flex: 1, alignItems: 'center', gap: 4 },
  scoreValue: { fontSize: 22, fontWeight: '700', color: colors.text },
  scoreLabel: { fontSize: 12, color: colors.textFaint, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },
  reviewCount: { fontSize: 11, color: colors.textFaint },
  scoreDivider: { width: 1, height: 36, backgroundColor: colors.card },
  cancellationWarning: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center',
    backgroundColor: 'rgba(239,68,68,0.12)', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6, marginTop: 10,
  },
  cancellationWarningText: { fontSize: 12, color: colors.danger, fontWeight: '600' },

  sectionTitle: {
    fontSize: 11, fontWeight: '600', color: colors.textFaint,
    letterSpacing: 1, paddingHorizontal: 20, marginBottom: 12,
  },

  itemCard: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: colors.surface, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
  },
  itemThumb: { width: 72, height: 72 },
  itemThumbEmoji: {
    width: 72, height: 72, backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center',
  },
  itemEmoji: { fontSize: 28 },
  itemInfo: { flex: 1, paddingHorizontal: 14, gap: 3 },
  itemTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  itemPrice: { fontSize: 13, color: colors.textMuted },
  itemCityRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  itemCity: { fontSize: 12, color: colors.textFaint },
  itemChevron: { fontSize: 22, color: colors.textFaint, paddingRight: 14, fontWeight: '300' },

  empty: { alignItems: 'center', paddingTop: 40 },
  emptyText: { fontSize: 15, color: colors.textFaint },

  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center' },
  reasonList: { gap: 8 },
  reasonRow: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  reasonRowSelected: { borderColor: colors.primary, backgroundColor: colors.infoBg },
  reasonText: { fontSize: 14, color: colors.text },
  reasonTextSelected: { fontWeight: '700', color: colors.primary },
  reportInput: { borderWidth: 1, borderRadius: 10, padding: 12, fontSize: 14, minHeight: 70, textAlignVertical: 'top' },
  modalPrimaryBtn: { backgroundColor: colors.danger, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  modalPrimaryBtnText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  modalCancelLink: { alignItems: 'center', paddingVertical: 6 },
  modalCancelLinkText: { fontSize: 14, color: colors.textMuted },
});
