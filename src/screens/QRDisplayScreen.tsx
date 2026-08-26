import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, ScrollView, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { ChevronLeft, CircleCheck, TriangleAlert, Leaf } from 'lucide-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatsStackParamList } from '../navigation/ChatsStackNavigator';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import { hasRatedTransaction } from '../services/ratings';
import * as Location from 'expo-location';
import { getCurrentLocationOnce } from '../hooks/useUserLocation';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { type QrPayload } from './qrShared';
import { getImpactScore } from '../utils/format';

type Props = NativeStackScreenProps<ChatsStackParamList, 'QRDisplay'>;

// Statuses that mean this QR will never be scanned: the rental ended by some other
// route while the code was on screen (renter declined at pickup, lender cancelled,
// either side raised a dispute).
const ABORTED_STATUSES = ['cancelled', 'rejected', 'disputed'];
type Step = 'loading' | 'qr' | 'done';


export default function QRDisplayScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { transactionId, phase, itemTitle, otherName, conversationId } = route.params;

  const [step,    setStep]    = useState<Step>('loading');
  const [payload, setPayload] = useState<QrPayload | null>(null);
  const [alreadyRated, setAlreadyRated] = useState(false);
  // Backlog R: real Impact Score (category + this item's real completed-
  // rental count) instead of the old hardcoded SCORE_AFTER.
  const [itemImpact, setItemImpact] = useState<{ category: string; completedRentalCount: number } | null>(null);
  // Guards the abort alert — the poll would otherwise fire it again on every tick.
  const abortedRef = useRef(false);
  const scoreAnim = useRef(new Animated.Value(0)).current;
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  const successStatus = phase === 'pickup' ? 'active' : 'completed';

  // You currently hold the item at this point (haven't handed it off yet at
  // pickup, or still have it after using it at return) — just show the QR,
  // no condition check needed on your side. The receiving party verifies it.
  async function startDisplay() {
    setStep('loading');
    try {
      // High, not the Balanced default: these coordinates are baked into the QR and
      // become the reference point for the scanner's 50m proximity check. A ~100m
      // Balanced fix here would make that check meaningless however precise the
      // scanner's own fix is.
      const coords = await getCurrentLocationOnce(Location.Accuracy.High);
      if (!coords) {
        Alert.alert('Location needed', 'Enable location so the other party can verify you are together.');
        return;
      }
      const { data: token, error } = await supabase.rpc('ensure_qr_token', { p_tx: transactionId, p_phase: phase });
      if (error) throw error;
      setPayload({ t: transactionId, k: token as string, p: phase, lat: coords.latitude, lng: coords.longitude });
      setStep('qr');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not start the handoff.');
    }
  }

  useEffect(() => {
    startDisplay();
  }, []);

  useEffect(() => {
    // Fetched only once 'done' — by the time the poll above detects the
    // counterpart's scan (successStatus), their scan_qr_handoff call (which
    // increments completed_rental_count) has already committed, so this
    // always reads the post-increment count rather than racing it.
    if (step !== 'done' || phase !== 'return') return;
    supabase
      .from('transactions')
      .select('items(category, completed_rental_count)')
      .eq('id', transactionId)
      .single()
      .then(({ data }) => {
        const item = (data as any)?.items;
        if (item) setItemImpact({ category: item.category, completedRentalCount: item.completed_rental_count });
      });
  }, [step, phase, transactionId]);

  // Checked on focus rather than only on mount: the user lands back on this screen
  // right after rating, and the offer has to be gone by then rather than leading to
  // a form that submit_rating would refuse.
  useFocusEffect(
    useCallback(() => {
      if (step !== 'done' || phase !== 'return') return;
      let active = true;
      hasRatedTransaction(transactionId).then((rated) => { if (active) setAlreadyRated(rated); });
      return () => { active = false; };
    }, [step, phase, transactionId])
  );

  useEffect(() => {
    if (step !== 'qr') return;
    pollRef.current = setInterval(async () => {
      const { data } = await supabase
        .from('transactions')
        .select('status')
        .eq('id', transactionId)
        .single();
      if (!data) return;

      if (data.status === successStatus) { setStep('done'); return; }

      // The rental ended while this QR was still on screen — most often the renter
      // declining the item at the handoff. The code can no longer be scanned, so get
      // the holder off this screen instead of leaving them presenting a dead QR.
      if (ABORTED_STATUSES.includes(data.status) && !abortedRef.current) {
        abortedRef.current = true;
        if (pollRef.current) clearInterval(pollRef.current);
        Alert.alert(
          phase === 'pickup' ? 'Handoff cancelled' : 'Rental ended',
          phase === 'pickup'
            ? `${otherName ?? 'The renter'} declined the item, so this rental was cancelled. Their reason is in the chat.`
            : 'This rental is no longer active — see the chat for details.',
          [{ text: 'OK', onPress: () => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('ConversationsList') }],
        );
      }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [step, transactionId, successStatus, phase, otherName]);

  // Animate the score bar when the return celebration appears
  useEffect(() => {
    if (step !== 'done' || phase !== 'return') return;
    Animated.timing(scoreAnim, {
      toValue: 1,
      duration: 1500,
      useNativeDriver: false,
    }).start();
  }, [step, phase]);

  // ChatRoomScreen owns dispute evidence collection (photo + description) — this
  // screen must not duplicate it (SAS). Route back there instead, same pattern as
  // the pickup decline in QRScanScreen.
  function reportIssue() {
    navigation.navigate('ChatRoom', {
      conversationId,
      itemTitle,
      otherUserName: otherName ?? 'them',
      initialTab: 'deal',
      reportIssueTransactionId: transactionId,
    });
  }

  const title = phase === 'pickup' ? 'Pickup Handoff' : 'Return Handoff';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('ConversationsList')}>
          <ChevronLeft size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.itemName} numberOfLines={1}>{itemTitle}</Text>

        {/* ── Step 1: Generating the QR ── */}
        {step === 'loading' && (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.text} size="large" />
            <Text style={styles.loadingText}>Preparing your QR code…</Text>
          </View>
        )}

        {/* ── Step 2: QR display ── */}
        {step === 'qr' && payload && (
          <View style={styles.qrWrap}>
            <Text style={styles.sectionLabel}>Show this to {otherName ?? 'the other party'}</Text>
            <View style={styles.qrCard}>
              <QRCode
                value={JSON.stringify(payload)}
                size={232}
                backgroundColor="#ffffff"
                color="#000000"
              />
            </View>
            <View style={styles.waitRow}>
              <ActivityIndicator color={colors.textMuted} size="small" />
              <Text style={styles.waitText}>Waiting for {otherName ?? 'the other party'} to scan…</Text>
            </View>
          </View>
        )}

        {/* ── Step 3a: Return celebration ── */}
        {step === 'done' && phase === 'return' && (
          <View style={styles.celebWrap}>
            <View style={styles.celebIconRing}>
              <CircleCheck size={52} color="#22c55e" strokeWidth={1.8} />
            </View>
            <Text style={styles.celebTitle}>Rental Complete!</Text>
            <Text style={styles.celebSub}>Thanks for being part of the UseIT community.</Text>

            <View style={styles.impactCard}>
              <View style={styles.impactHeaderRow}>
                <Leaf size={15} color="#22c55e" strokeWidth={2.5} />
                <Text style={styles.impactLabel}>Your Impact Score</Text>
                {/* Exactly what this one return scan just added — matches the
                    +0.1-per-completed-rental reuse bonus in getImpactScore. */}
                <View style={styles.impactDeltaBadge}>
                  <Text style={styles.impactDeltaText}>↑ +0.1</Text>
                </View>
              </View>

              <Text style={styles.impactScoreNum}>
                {itemImpact ? getImpactScore(itemImpact.category, itemImpact.completedRentalCount).toFixed(1) : '—'}
              </Text>

              <View style={styles.impactBarTrack}>
                <Animated.View style={[
                  styles.impactBarFill,
                  {
                    width: scoreAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', `${itemImpact ? (getImpactScore(itemImpact.category, itemImpact.completedRentalCount) / 5) * 100 : 0}%`],
                    }),
                  },
                ]} />
              </View>

              <Text style={styles.impactCo2}>
                🌿 ~{itemImpact ? ((getImpactScore(itemImpact.category, itemImpact.completedRentalCount) - 3.0) * 5 + 2).toFixed(1) : '—'} kg CO₂ saved this rental
              </Text>
            </View>

            {alreadyRated ? (
              <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('ConversationsList')}>
                <Text style={styles.primaryBtnText}>Done</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => navigation.navigate('Rating', { transactionId, itemTitle, otherName: otherName ?? 'them', isRenter: true })}
              >
                <Text style={styles.primaryBtnText}>Rate the Experience</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Step 3b: Simple pickup done ── */}
        {step === 'done' && phase === 'pickup' && (
          <View style={styles.doneWrap}>
            <View style={styles.celebIconRing}>
              <CircleCheck size={52} color="#22c55e" strokeWidth={1.8} />
            </View>
            <Text style={styles.doneTitle}>Handoff Complete!</Text>
            <Text style={styles.doneSub}>The rental is now active.</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('ConversationsList')}>
              <Text style={styles.primaryBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}

        {step !== 'done' && (
          <TouchableOpacity style={styles.reportBtn} onPress={reportIssue}>
            <TriangleAlert size={16} color={colors.danger} />
            <Text style={styles.reportText}>Report a Problem</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: colors.text },
  scroll: { padding: 20, gap: 14, paddingBottom: 40 },
  itemName: { fontSize: 15, color: colors.textMuted, textAlign: 'center' },
  sectionLabel: { fontSize: 13, color: colors.textFaint, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },

  // Loading
  loadingWrap: { alignItems: 'center', gap: 14, marginTop: 48 },
  loadingText: { fontSize: 15, color: colors.textMuted },

  // QR
  qrWrap: { alignItems: 'center', gap: 16, marginTop: 8 },
  qrCard: { backgroundColor: '#ffffff', padding: 20, borderRadius: 20 },
  waitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  waitText: { color: colors.textMuted, fontSize: 14 },

  // Celebration (return done)
  celebWrap: { alignItems: 'center', gap: 14, marginTop: 8 },
  celebIconRing: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(34,197,94,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  celebTitle: { fontSize: 24, fontWeight: '800', color: colors.text, textAlign: 'center' },
  celebSub: { fontSize: 15, color: colors.textMuted, textAlign: 'center', lineHeight: 21 },

  impactCard: {
    width: '100%',
    backgroundColor: colors.card,
    borderRadius: 16, borderWidth: 1, borderColor: 'rgba(34,197,94,0.25)',
    padding: 18, gap: 10,
  },
  impactHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  impactLabel: { flex: 1, fontSize: 13, fontWeight: '600', color: colors.textMuted },
  impactDeltaBadge: {
    backgroundColor: 'rgba(34,197,94,0.15)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
  },
  impactDeltaText: { color: '#22c55e', fontSize: 12, fontWeight: '700' },
  impactScoreNum: { fontSize: 40, fontWeight: '800', color: '#22c55e' },
  impactBarTrack: { height: 6, borderRadius: 3, backgroundColor: colors.cardAlt, overflow: 'hidden' },
  impactBarFill: { height: 6, borderRadius: 3, backgroundColor: '#22c55e' },
  impactCo2: { fontSize: 13, color: colors.textMuted },

  // Simple pickup done
  doneWrap: { alignItems: 'center', gap: 14, marginTop: 24 },
  doneTitle: { fontSize: 24, fontWeight: '800', color: colors.text, textAlign: 'center' },
  doneSub: { fontSize: 15, color: colors.textMuted, textAlign: 'center', lineHeight: 21, marginBottom: 8 },

  // Shared
  primaryBtn: {
    height: 54, backgroundColor: colors.btn, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginTop: 8, width: '100%',
  },
  primaryBtnText: { color: colors.btnText, fontSize: 16, fontWeight: '700' },
  btnDisabled: { opacity: 0.4 },
  reportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 14, marginTop: 8,
  },
  reportText: { color: colors.danger, fontSize: 14, fontWeight: '600' },
});
