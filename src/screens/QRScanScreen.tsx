import { useState, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, ScrollView, Image, Modal, TextInput, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { ChevronLeft, Check, CircleCheck, TriangleAlert, Camera, MessageSquare, Scale, Leaf } from 'lucide-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatsStackParamList } from '../navigation/ChatsStackNavigator';
import { supabase } from '../services/supabase';
import { getCurrentLocationOnce } from '../hooks/useUserLocation';
import { metersBetween } from '../utils/format';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { CHECKLIST_ITEMS, PROXIMITY_LIMIT_M, type QrPayload } from './qrShared';

type Props = NativeStackScreenProps<ChatsStackParamList, 'QRScan'>;
type Step = 'checklist' | 'photo' | 'scan' | 'done';

export default function QRScanScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { transactionId, phase, itemTitle, otherName } = route.params;

  const [permission, requestPermission] = useCameraPermissions();
  const [checked,    setChecked]    = useState<boolean[]>(CHECKLIST_ITEMS.map(() => false));
  const [step,       setStep]       = useState<Step>('checklist');
  const [scannedFlash, setScannedFlash] = useState(false);
  const [photoUri,   setPhotoUri]   = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [disputeModal, setDisputeModal] = useState<{ visible: boolean; step: 1 | 2 }>({ visible: false, step: 1 });
  const [disputeDone, setDisputeDone] = useState(false);
  const [disputePhotoUri, setDisputePhotoUri] = useState<string | null>(null);
  const [disputeText, setDisputeText] = useState('');
  const scoreAnim = useRef(new Animated.Value(0)).current;
  const handledRef = useRef(false);

  const allChecked = checked.every(Boolean);

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

  async function confirmPhotoAndScan() {
    setProcessing(true);
    try {
      const { error } = await supabase.rpc('confirm_condition', { p_tx: transactionId, p_phase: phase });
      if (error) throw error;
      if (!permission?.granted) {
        const res = await requestPermission();
        if (!res.granted) {
          Alert.alert('Camera needed', 'Allow camera access to scan the rental QR code.');
          return;
        }
      }
      handledRef.current = false;
      setStep('scan');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not start scanning.');
    } finally {
      setProcessing(false);
    }
  }

  // Animate the impact score bar when the return completes
  useEffect(() => {
    if (step !== 'done' || phase !== 'return') return;
    Animated.timing(scoreAnim, { toValue: 1, duration: 1500, useNativeDriver: false }).start();
  }, [step, phase]);

  async function confirmDispute() {
    try {
      await supabase.rpc('report_issue', { p_tx: transactionId });
      setDisputeDone(true);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not submit dispute.');
    }
  }

  async function onScanned(result: BarcodeScanningResult) {
    if (handledRef.current || processing) return;
    let payload: QrPayload;
    try {
      payload = JSON.parse(result.data);
    } catch {
      return;
    }
    if (payload.t !== transactionId || payload.p !== phase || !payload.k) return;
    handledRef.current = true;
    setProcessing(true);
    try {
      const coords = await getCurrentLocationOnce();
      if (!coords) {
        Alert.alert('Location needed', 'Enable location to verify you are with the renter.');
        handledRef.current = false;
        return;
      }
      const distance = metersBetween(coords, { latitude: payload.lat, longitude: payload.lng });
      if (distance > PROXIMITY_LIMIT_M) {
        Alert.alert('Too far apart', `You must be within ${PROXIMITY_LIMIT_M}m of the renter (currently ~${Math.round(distance)}m).`);
        handledRef.current = false;
        return;
      }
      const { data: newStatus, error } = await supabase.rpc('scan_qr_handoff', {
        p_tx: transactionId, p_token: payload.k, p_phase: phase,
      });
      if (error) throw error;
      void newStatus;
      setStep('done');
    } catch (e: any) {
      Alert.alert('Scan failed', e.message ?? 'Could not complete the handoff.');
      handledRef.current = false;
    } finally {
      setProcessing(false);
    }
  }

  const title = phase === 'pickup' ? 'Hand Off' : 'Complete Return';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <ChevronLeft size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={styles.backBtn} />
      </View>

      {/* ── Checklist + photo steps use ScrollView ── */}
      {(step === 'checklist' || step === 'photo' || step === 'done') && (
        <ScrollView contentContainerStyle={styles.scroll}>
          <Text style={styles.itemName} numberOfLines={1}>{itemTitle}</Text>

          {/* Step 1: Checklist */}
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
              {phase === 'return' && (
                <TouchableOpacity
                  style={styles.reportDamageBtn}
                  onPress={() => setDisputeModal({ visible: true, step: 1 })}
                >
                  <TriangleAlert size={15} color={colors.danger} />
                  <Text style={styles.reportDamageText}>Report Damage Instead</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* Step 2: Condition photo */}
          {step === 'photo' && (
            <>
              <Text style={styles.sectionLabel}>Document Item Condition</Text>
              <Text style={styles.photoHint}>
                Take a photo to verify the item's condition before {phase === 'pickup' ? 'handing it over' : 'accepting the return'}.
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
                style={[styles.primaryBtn, (!photoUri || processing) && styles.btnDisabled]}
                onPress={confirmPhotoAndScan}
                disabled={!photoUri || processing}
              >
                {processing
                  ? <ActivityIndicator color={colors.btnText} />
                  : <Text style={styles.primaryBtnText}>Confirm & Scan QR</Text>
                }
              </TouchableOpacity>
            </>
          )}

          {/* Step 4: Done */}
          {step === 'done' && (
            <View style={styles.doneWrap}>
              <View style={styles.doneIconRing}>
                <CircleCheck size={52} color="#22c55e" strokeWidth={1.8} />
              </View>
              <Text style={styles.doneTitle}>
                {phase === 'pickup' ? 'Item Handed Over!' : 'Return Complete!'}
              </Text>
              <Text style={styles.doneSub}>
                {phase === 'pickup'
                  ? 'The rental is now active. Enjoy!'
                  : 'The rental has been completed successfully.'}
              </Text>

              {/* Impact Score — return only */}
              {phase === 'return' && (
                <View style={styles.impactCard}>
                  <View style={styles.impactHeaderRow}>
                    <Leaf size={15} color="#22c55e" strokeWidth={2.5} />
                    <Text style={styles.impactLabel}>Your Impact Score</Text>
                    <View style={styles.impactDeltaBadge}>
                      <Text style={styles.impactDeltaText}>↑ +0.3</Text>
                    </View>
                  </View>
                  <Text style={styles.impactScoreNum}>4.4</Text>
                  <View style={styles.impactBarTrack}>
                    <Animated.View style={[
                      styles.impactBarFill,
                      {
                        width: scoreAnim.interpolate({
                          inputRange: [0, 1],
                          outputRange: ['82%', '88%'],
                        }),
                      },
                    ]} />
                  </View>
                  <Text style={styles.impactCo2}>🌿 ~3.5 kg CO₂ saved this rental</Text>
                </View>
              )}

              {phase === 'return' ? (
                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={() => navigation.navigate('Rating', { itemTitle, otherName: otherName ?? 'them' })}
                >
                  <Text style={styles.primaryBtnText}>Rate the Experience</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()}>
                  <Text style={styles.primaryBtnText}>Done</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </ScrollView>
      )}

      {/* ── QR scanner (full screen) ── */}
      {step === 'scan' && (
        <View style={styles.scanWrap}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onScanned}
          />
          <View style={styles.scanOverlay} pointerEvents="none">
            <View style={styles.scanFrame} />
            <Text style={styles.scanHint}>Point at {otherName ? `${otherName}'s` : "the other party's"} QR code</Text>
          </View>
          {scannedFlash && (
            <View style={styles.scannedFlash} pointerEvents="none">
              <View style={styles.scannedFlashRing}>
                <CircleCheck size={64} color="#fff" strokeWidth={2} />
              </View>
              <Text style={styles.scannedFlashText}>QR Scanned!</Text>
            </View>
          )}
          {processing && (
            <View style={styles.processing}>
              <ActivityIndicator color={colors.white} />
              <Text style={styles.processingText}>Verifying…</Text>
            </View>
          )}
        </View>
      )}

      {/* ── Dispute Modal ── */}
      <Modal
        visible={disputeModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setDisputeModal(prev => ({ ...prev, visible: false }))}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            {disputeDone ? (
              <>
                <View style={styles.modalHandle} />
                <View style={[styles.modalIconCircle, { backgroundColor: 'rgba(244,67,54,0.1)', alignSelf: 'center' }]}>
                  <Scale size={24} color={colors.danger} />
                </View>
                <Text style={styles.modalTitle}>Case Under Review</Text>
                <Text style={styles.modalBody}>
                  Photos & description sent for AI review and expert evaluation. Funds are held in escrow until resolved.
                </Text>
                <TouchableOpacity style={styles.modalPrimaryBtn} onPress={() => { setDisputeModal({ visible: false, step: 1 }); navigation.goBack(); }}>
                  <Text style={styles.modalPrimaryBtnText}>Done</Text>
                </TouchableOpacity>
              </>
            ) : disputeModal.step === 1 ? (
              <>
                <View style={styles.modalHandle} />
                <View style={[styles.modalIconCircle, { backgroundColor: colors.warningBg, alignSelf: 'center' }]}>
                  <MessageSquare size={24} color={colors.warning} />
                </View>
                <Text style={styles.modalTitle}>Report Damage</Text>
                <Text style={styles.modalBody}>
                  We recommend resolving this community-wise first. Reach out directly — most issues are resolved quickly through a simple conversation.
                </Text>
                <TouchableOpacity style={styles.modalPrimaryBtn} onPress={() => { setDisputeModal(prev => ({ ...prev, visible: false })); navigation.goBack(); }}>
                  <MessageSquare size={16} color={colors.btnText} />
                  <Text style={styles.modalPrimaryBtnText}>Message them directly</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSecondaryBtn} onPress={() => setDisputeModal(prev => ({ ...prev, step: 2 }))}>
                  <Text style={styles.modalSecondaryBtnText}>Escalate to UseIT →</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalCancelLink} onPress={() => setDisputeModal(prev => ({ ...prev, visible: false }))}>
                  <Text style={styles.modalCancelLinkText}>Cancel</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.modalHandle} />
                <View style={[styles.modalIconCircle, { backgroundColor: colors.dangerBg, alignSelf: 'center' }]}>
                  <Scale size={24} color={colors.danger} />
                </View>
                <Text style={styles.modalTitle}>Document the Damage</Text>
                <Text style={styles.modalBody}>Upload a photo and describe what's wrong.</Text>

                {/* Damage photo */}
                {disputePhotoUri ? (
                  <Image
                    source={{ uri: disputePhotoUri }}
                    style={styles.disputePreview}
                    resizeMode="cover"
                  />
                ) : (
                  <TouchableOpacity
                    style={styles.disputeCameraTile}
                    onPress={async () => {
                      const { status } = await ImagePicker.requestCameraPermissionsAsync();
                      if (status !== 'granted') return;
                      const r = await ImagePicker.launchCameraAsync({ quality: 0.75 });
                      if (!r.canceled && r.assets[0]) setDisputePhotoUri(r.assets[0].uri);
                    }}
                  >
                    <Camera size={32} color={colors.textMuted} strokeWidth={1.5} />
                    <Text style={styles.cameraTileText}>Photograph the damage</Text>
                  </TouchableOpacity>
                )}

                {/* Damage description */}
                <TextInput
                  style={[styles.disputeInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                  placeholder="Describe the damage…"
                  placeholderTextColor={colors.textMuted}
                  value={disputeText}
                  onChangeText={setDisputeText}
                  multiline
                  numberOfLines={3}
                />

                <TouchableOpacity
                  style={[styles.modalPrimaryBtn, { backgroundColor: colors.danger, opacity: (!disputePhotoUri || !disputeText.trim()) ? 0.45 : 1 }]}
                  onPress={confirmDispute}
                  disabled={!disputePhotoUri || !disputeText.trim()}
                >
                  <Scale size={16} color={colors.white} />
                  <Text style={[styles.modalPrimaryBtnText, { color: colors.white }]}>Submit Dispute</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalSecondaryBtn} onPress={() => setDisputeModal(prev => ({ ...prev, step: 1 }))}>
                  <Text style={styles.modalSecondaryBtnText}>← Go back</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
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
  previewWrap: { gap: 8 },
  preview: { width: '100%', height: 200, borderRadius: 16 },
  retakeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10,
    backgroundColor: colors.card, borderRadius: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  retakeBtnText: { color: colors.text, fontSize: 14, fontWeight: '600' },

  // Done
  doneWrap: { alignItems: 'center', gap: 14, marginTop: 24 },
  doneIconRing: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(34,197,94,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  doneTitle: { fontSize: 24, fontWeight: '800', color: colors.text, textAlign: 'center' },
  doneSub: { fontSize: 15, color: colors.textMuted, textAlign: 'center', lineHeight: 21, marginBottom: 8 },

  // Shared
  primaryBtn: {
    height: 54, backgroundColor: colors.btn, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginTop: 8, width: '100%',
  },
  primaryBtnText: { color: colors.btnText, fontSize: 16, fontWeight: '700' },
  btnDisabled: { opacity: 0.4 },

  // Scanner
  scanWrap: { flex: 1, backgroundColor: '#000' },
  scanOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 20 },
  scanFrame: {
    width: 250, height: 250, borderRadius: 24,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.9)',
  },
  scanHint: { color: '#fff', fontSize: 15, fontWeight: '600' },
  scannedFlash: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(34,197,94,0.88)',
    alignItems: 'center', justifyContent: 'center', gap: 16,
  },
  scannedFlashRing: {
    width: 110, height: 110, borderRadius: 55,
    borderWidth: 3, borderColor: 'rgba(255,255,255,0.6)',
    alignItems: 'center', justifyContent: 'center',
  },
  scannedFlashText: { color: '#fff', fontSize: 24, fontWeight: '800' },
  processing: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center', gap: 10,
  },
  processingText: { color: '#fff', fontSize: 15 },

  // Impact score card (return done)
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

  // Report damage link
  reportDamageBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 14, marginTop: 4,
  },
  reportDamageText: { color: colors.danger, fontSize: 14, fontWeight: '600' },

  // Dispute photo & description
  disputePreview: { width: '100%', height: 160, borderRadius: 12 },
  disputeCameraTile: {
    height: 120, borderRadius: 12,
    backgroundColor: colors.card, borderWidth: 1.5, borderColor: colors.border,
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  disputeInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, minHeight: 72, textAlignVertical: 'top',
  },

  // Dispute modal
  modalOverlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12, gap: 14,
  },
  modalHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: 6 },
  modalIconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  modalTitle: { fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center' },
  modalBody: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  arbitrationBox: { backgroundColor: colors.dangerBg, borderRadius: 12, borderLeftWidth: 3, borderLeftColor: colors.danger, padding: 14 },
  arbitrationText: { fontSize: 13, color: colors.text, lineHeight: 20, fontStyle: 'italic' },
  modalPrimaryBtn: {
    height: 52, backgroundColor: colors.btn, borderRadius: 14,
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
  },
  modalPrimaryBtnText: { color: colors.btnText, fontSize: 15, fontWeight: '700' },
  modalSecondaryBtn: { alignItems: 'center', paddingVertical: 8 },
  modalSecondaryBtnText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  modalCancelLink: { alignItems: 'center', paddingVertical: 4 },
  modalCancelLinkText: { color: colors.textFaint, fontSize: 14 },
});
