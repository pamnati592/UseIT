import { useState, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, ScrollView, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { ChevronLeft, CircleCheck, TriangleAlert, Leaf } from 'lucide-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatsStackParamList } from '../navigation/ChatsStackNavigator';
import { supabase } from '../services/supabase';
import { getCurrentLocationOnce } from '../hooks/useUserLocation';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { type QrPayload } from './qrShared';

type Props = NativeStackScreenProps<ChatsStackParamList, 'QRDisplay'>;
type Step = 'loading' | 'qr' | 'done';

// TODO: replace with the real computed Impact Score once that feature lands
const SCORE_AFTER = 4.0;
const CO2_SAVED    = '3.5';

export default function QRDisplayScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { transactionId, phase, itemTitle, otherName } = route.params;

  const [step,    setStep]    = useState<Step>('loading');
  const [payload, setPayload] = useState<QrPayload | null>(null);
  const scoreAnim = useRef(new Animated.Value(0)).current;
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  const successStatus = phase === 'pickup' ? 'active' : 'completed';

  // You currently hold the item at this point (haven't handed it off yet at
  // pickup, or still have it after using it at return) — just show the QR,
  // no condition check needed on your side. The receiving party verifies it.
  async function startDisplay() {
    setStep('loading');
    try {
      const coords = await getCurrentLocationOnce();
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
    if (step !== 'qr') return;
    pollRef.current = setInterval(async () => {
      const { data } = await supabase
        .from('transactions')
        .select('status')
        .eq('id', transactionId)
        .single();
      if (data?.status === successStatus) setStep('done');
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [step, transactionId, successStatus]);

  // Animate the score bar when the return celebration appears
  useEffect(() => {
    if (step !== 'done' || phase !== 'return') return;
    Animated.timing(scoreAnim, {
      toValue: 1,
      duration: 1500,
      useNativeDriver: false,
    }).start();
  }, [step, phase]);

  async function reportIssue() {
    Alert.alert(
      'Report an issue?',
      'This puts the rental into dispute and holds the payment until an admin reviews it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report', style: 'destructive', onPress: async () => {
            const { error } = await supabase.rpc('report_issue', { p_tx: transactionId });
            if (error) { Alert.alert('Error', error.message); return; }
            navigation.goBack();
          },
        },
      ],
    );
  }

  const title = phase === 'pickup' ? 'Pickup' : 'Return';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
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
                <View style={styles.impactDeltaBadge}>
                  <Text style={styles.impactDeltaText}>↑ +0.3</Text>
                </View>
              </View>

              <Text style={styles.impactScoreNum}>{SCORE_AFTER.toFixed(1)}</Text>

              <View style={styles.impactBarTrack}>
                <Animated.View style={[
                  styles.impactBarFill,
                  {
                    width: scoreAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['74%', '80%'],
                    }),
                  },
                ]} />
              </View>

              <Text style={styles.impactCo2}>🌿 ~{CO2_SAVED} kg CO₂ saved this rental</Text>
            </View>

            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => navigation.navigate('Rating', { transactionId, itemTitle, otherName: otherName ?? 'them', isRenter: true })}
            >
              <Text style={styles.primaryBtnText}>Rate the Experience</Text>
            </TouchableOpacity>
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
            <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()}>
              <Text style={styles.primaryBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        )}

        {step !== 'done' && (
          <TouchableOpacity style={styles.reportBtn} onPress={reportIssue}>
            <TriangleAlert size={16} color={colors.danger} />
            <Text style={styles.reportText}>Report an issue</Text>
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
