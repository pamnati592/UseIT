import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, ScrollView,
  Image, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import * as ImagePicker from 'expo-image-picker';
import { ChevronLeft, Check, CircleCheck, TriangleAlert, Camera, Leaf } from 'lucide-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatsStackParamList } from '../navigation/ChatsStackNavigator';
import { supabase } from '../services/supabase';
import { getCurrentLocationOnce } from '../hooks/useUserLocation';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { CHECKLIST_ITEMS, type QrPayload } from './qrShared';

type Props = NativeStackScreenProps<ChatsStackParamList, 'QRDisplay'>;
type Step = 'checklist' | 'photo' | 'qr' | 'waiting' | 'done';

// TODO: replace with the real computed Impact Score once that feature lands
const SCORE_AFTER = 4.0;
const CO2_SAVED    = '3.5';

export default function QRDisplayScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { transactionId, phase, itemTitle, otherName } = route.params;

  const [checked,  setChecked]  = useState<boolean[]>(CHECKLIST_ITEMS.map(() => false));
  const [step,     setStep]     = useState<Step>('checklist');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [payload,  setPayload]  = useState<QrPayload | null>(null);
  const [working,  setWorking]  = useState(false);
  const scoreAnim = useRef(new Animated.Value(0)).current;
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  const allChecked    = checked.every(Boolean);
  const successStatus = phase === 'pickup' ? 'active' : 'completed';

  function toggle(i: number) {
    setChecked(prev => prev.map((v, idx) => (idx === i ? !v : v)));
  }

  async function takePhoto() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Camera needed', 'Allow camera access to photograph the item condition.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.75,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  }

  async function confirmPhotoAndShowQR() {
    setWorking(true);
    try {
      const coords = await getCurrentLocationOnce();
      if (!coords) {
        Alert.alert('Location needed', 'Enable location so the lender can verify you are together.');
        return;
      }
      const { error: cErr } = await supabase.rpc('confirm_condition', { p_tx: transactionId, p_phase: phase });
      if (cErr) throw cErr;
      const { data: token, error: tErr } = await supabase.rpc('ensure_qr_token', { p_tx: transactionId, p_phase: phase });
      if (tErr) throw tErr;
      setPayload({ t: transactionId, k: token as string, p: phase, lat: coords.latitude, lng: coords.longitude });
      setStep('qr');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not start the handoff.');
    } finally {
      setWorking(false);
    }
  }

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

        {/* ── Step 1: Condition checklist ── */}
        {step === 'checklist' && (
          <>
            <Text style={styles.sectionLabel}>Confirm item condition</Text>
            {CHECKLIST_ITEMS.map((label, i) => (
              <TouchableOpacity
                key={label}
                style={[styles.checkRow, checked[i] && styles.checkRowOn]}
                onPress={() => toggle(i)}
              >
                <Text style={styles.checkText}>{label}</Text>
                <View style={[styles.checkbox, checked[i] && styles.checkboxOn]}>
                  {checked[i] && <Check size={15} color={colors.white} strokeWidth={3} />}
                </View>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.primaryBtn, !allChecked && styles.btnDisabled]}
              onPress={() => setStep('photo')}
              disabled={!allChecked}
            >
              <Text style={styles.primaryBtnText}>Confirm & Document Condition</Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── Step 2: Condition photo ── */}
        {step === 'photo' && (
          <>
            <Text style={styles.sectionLabel}>Document Item Condition</Text>
            <Text style={styles.photoHint}>
              Take a photo to verify the item's condition before {phase === 'pickup' ? 'pickup' : 'return'}.
            </Text>

            {photoUri ? (
              <View style={styles.previewWrap}>
                <Image
                  source={{ uri: photoUri! }}
                  style={styles.preview}
                  resizeMode="cover"
                />
                <TouchableOpacity style={styles.retakeBtn} onPress={takePhoto}>
                  <Camera size={15} color={colors.text} />
                  <Text style={styles.retakeBtnText}>Retake</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.cameraTile} onPress={takePhoto} activeOpacity={0.8}>
                <Camera size={40} color={colors.textMuted} strokeWidth={1.5} />
                <Text style={styles.cameraTileText}>Tap to photograph the item</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={[styles.primaryBtn, (!photoUri || working) && styles.btnDisabled]}
              onPress={confirmPhotoAndShowQR}
              disabled={!photoUri || working}
            >
              {working
                ? <ActivityIndicator color={colors.btnText} />
                : <Text style={styles.primaryBtnText}>Confirm & Show QR</Text>
              }
            </TouchableOpacity>
          </>
        )}

        {/* ── Step 3: QR display ── */}
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

        {/* ── Step 3b: Waiting — the other party scanned and is checking the item ── */}
        {step === 'waiting' && (
          <View style={styles.waitingWrap}>
            <View style={styles.waitingIconRing}>
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
            <Text style={styles.waitingTitle}>QR Scanned!</Text>
            <Text style={styles.waitingSub}>
              {otherName ?? 'The other party'} is checking the item condition…
            </Text>
          </View>
        )}

        {/* ── Step 4a: Return celebration ── */}
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
              onPress={() => navigation.navigate('Rating', { itemTitle, otherName: otherName ?? 'them' })}
            >
              <Text style={styles.primaryBtnText}>Rate the Experience</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Step 4b: Simple pickup done ── */}
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

  // Checklist
  checkRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.card, borderRadius: 12, padding: 16,
    borderWidth: 1.5, borderColor: colors.border,
  },
  checkRowOn: { borderColor: colors.success },
  checkText: { flex: 1, color: colors.text, fontSize: 15 },
  checkbox: {
    width: 24, height: 24, borderRadius: 12,
    borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.success, borderColor: colors.success },

  // Photo step
  photoHint: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  cameraTile: {
    height: 180, borderRadius: 16,
    backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border,
    borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  cameraTileText: { color: colors.textMuted, fontSize: 14, fontWeight: '500' },
  previewWrap: { borderRadius: 16, overflow: 'hidden', gap: 8 },
  preview: { width: '100%', height: 200, borderRadius: 16 },
  retakeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10,
    backgroundColor: colors.card, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  retakeBtnText: { color: colors.text, fontSize: 14, fontWeight: '600' },

  // QR
  qrWrap: { alignItems: 'center', gap: 16, marginTop: 8 },
  qrCard: { backgroundColor: '#ffffff', padding: 20, borderRadius: 20 },
  waitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  waitText: { color: colors.textMuted, fontSize: 14 },

  // Waiting (other party is checking the item)
  waitingWrap: { alignItems: 'center', gap: 14, marginTop: 48 },
  waitingIconRing: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: colors.card,
    alignItems: 'center', justifyContent: 'center',
  },
  waitingTitle: { fontSize: 22, fontWeight: '800', color: colors.text, textAlign: 'center' },
  waitingSub: { fontSize: 15, color: colors.textMuted, textAlign: 'center', lineHeight: 21 },

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
