import { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Image, Alert, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';
import { supabase } from '../services/supabase';
import { useMessageParty } from '../hooks/useMessageParty';
import { signedUrlFor, HANDOFF_EVIDENCE_BUCKET } from '../services/storage';
import { formatDateRange } from '../utils/format';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { ChevronLeft, Package, ShieldCheck } from 'lucide-react-native';

type Props = NativeStackScreenProps<ProfileStackParamList, 'AdminRentalDetail'>;

type OverviewRow = {
  transaction_id: string;
  item_title: string;
  item_photo: string | null;
  status: string;
  start_date: string;
  end_date: string;
  pre_dispute_status: string | null;
  renter_id: string; renter_name: string; renter_is_admin: boolean;
  lender_id: string; lender_name: string; lender_is_admin: boolean;
  renter_unread: boolean; lender_unread: boolean;
  has_dispute: boolean;
};

type DisputeRow = {
  transaction_id: string;
  total_price: number;
  description: string | null;
  photo_url: string | null;
};

function statusLabel(status: string): string {
  switch (status) {
    case 'pending': return 'Awaiting approval';
    case 'approved': return 'Awaiting payment';
    case 'paid': return 'Awaiting pickup';
    case 'active': return 'Active — item with renter';
    case 'completed': return 'Completed';
    case 'disputed': return 'Disputed';
    case 'cancelled': return 'Cancelled';
    case 'rejected': return 'Declined';
    default: return status;
  }
}

export default function AdminRentalDetailScreen({ navigation, route }: Props) {
  const { transactionId } = route.params;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const [rental, setRental] = useState<OverviewRow | null>(null);
  const [dispute, setDispute] = useState<DisputeRow | null>(null);
  const [signedPhotoUrl, setSignedPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState('');
  const [damageAmount, setDamageAmount] = useState('');
  const [selectedFavor, setSelectedFavor] = useState<'renter' | 'lender' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [{ data: overview, error: e1 }, { data: disputes, error: e2 }] = await Promise.all([
      supabase.rpc('admin_list_support_overview'),
      supabase.rpc('admin_list_disputes'),
    ]);
    if (e1 || e2) {
      Alert.alert('Error', (e1 ?? e2)?.message ?? 'Could not load this rental.');
      setLoading(false);
      return;
    }
    const row = ((overview as OverviewRow[] | null) ?? []).find(r => r.transaction_id === transactionId) ?? null;
    setRental(row);
    const d = ((disputes as DisputeRow[] | null) ?? []).find(r => r.transaction_id === transactionId) ?? null;
    setDispute(d);
    setSignedPhotoUrl(d?.photo_url ? await signedUrlFor(HANDOFF_EVIDENCE_BUCKET, d.photo_url) : null);
    setLoading(false);
  }, [transactionId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const messageParty = useMessageParty(navigation, 'Support');

  // Ported from the old AdminDisputesScreen's resolve() — same RPC/edge-function
  // sequence, just scoped to this one rental instead of a list.
  async function resolve(favor: 'renter' | 'lender') {
    const damageRaw = favor === 'lender' ? damageAmount.trim() : '';
    const amount = damageRaw ? Number(damageRaw) : 0;
    if (damageRaw && (!Number.isFinite(amount) || amount <= 0)) {
      Alert.alert('Invalid damage amount', 'Enter a positive number, or leave it blank if no damage charge applies.');
      return;
    }
    setResolving(true);
    const { error } = await supabase.rpc('admin_resolve_dispute', {
      p_transaction_id: transactionId,
      p_favor: favor,
      p_note: note.trim() || undefined,
    });
    if (error) {
      Alert.alert('Error', error.message ?? 'Could not resolve the dispute.');
      setResolving(false);
      return;
    }

    if (favor === 'renter') {
      const { error: refundError } = await supabase.functions.invoke('refund-payment', {
        body: { transaction_id: transactionId, reason: 'admin_dispute_resolved' },
      });
      if (refundError) {
        // supabase-js's own error.message is just "Edge Function returned a
        // non-2xx status code" — the function's actual {error: "..."} body
        // (why it really failed) is only reachable via error.context.
        const body = await (refundError as any).context?.json?.().catch(() => null);
        await supabase.rpc('admin_reopen_dispute', { p_transaction_id: transactionId });
        Alert.alert(
          'Refund failed — dispute reopened',
          `The ruling could not be completed (${body?.error ?? refundError.message ?? 'refund failed'}). This case has been reopened so you can retry once the issue is fixed.`
        );
        setResolving(false);
        return;
      }
    } else if (amount > 0) {
      const { data: chargeResult, error: chargeError } = await supabase.functions.invoke('admin-charge', {
        body: { transaction_id: transactionId, amount, reason: 'damage' },
      });
      if (chargeError) {
        const body = await (chargeError as any).context?.json?.().catch(() => null);
        Alert.alert('Damage charge failed', body?.error ?? chargeError.message ?? 'Could not process the charge.');
      } else if (chargeResult && !chargeResult.ok) {
        Alert.alert('Damage charge failed', 'The card on file was declined or missing — the renter has been notified in chat to arrange payment directly.');
      }
    }

    setResolving(false);
    load();
  }

  if (loading || !rental) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('AdminRentals')} style={styles.backBtn}>
            <ChevronLeft size={26} color={colors.text} />
          </TouchableOpacity>
          <Text style={styles.title}>Rental</Text>
          <View style={styles.backBtn} />
        </View>
        {loading ? <ActivityIndicator color={colors.text} style={{ flex: 1 }} /> : (
          <View style={styles.empty}><Text style={styles.emptyText}>Rental not found.</Text></View>
        )}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('AdminRentals')} style={styles.backBtn}>
          <ChevronLeft size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{rental.item_title}</Text>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              {rental.item_photo
                ? <Image source={{ uri: rental.item_photo }} style={styles.itemThumb} />
                : <View style={styles.itemThumbFallback}><Package size={18} color={colors.textMuted} /></View>}
              <View>
                <Text style={styles.itemTitle}>{rental.item_title}</Text>
                <Text style={styles.dateRange}>{formatDateRange(rental.start_date, rental.end_date)}</Text>
              </View>
            </View>
            <View style={styles.statusRow}>
              <Text style={styles.statusText}>
                {statusLabel(rental.has_dispute && rental.pre_dispute_status ? rental.pre_dispute_status : rental.status)}
              </Text>
              {rental.has_dispute && (
                <View style={styles.disputedBadge}><Text style={styles.disputedBadgeText}>Disputed</Text></View>
              )}
            </View>
          </View>

          <View style={styles.messageRow}>
            {!rental.renter_is_admin && (
              <TouchableOpacity
                style={styles.messageBtn}
                onPress={() => messageParty(rental.transaction_id, rental.renter_id, rental.renter_name)}
              >
                <ShieldCheck size={13} color={colors.primary} />
                <Text style={styles.messageBtnText}>Chat with Renter{rental.renter_unread ? ' •' : ''}</Text>
              </TouchableOpacity>
            )}
            {!rental.lender_is_admin && (
              <TouchableOpacity
                style={styles.messageBtn}
                onPress={() => messageParty(rental.transaction_id, rental.lender_id, rental.lender_name)}
              >
                <ShieldCheck size={13} color={colors.primary} />
                <Text style={styles.messageBtnText}>Chat with Lender{rental.lender_unread ? ' •' : ''}</Text>
              </TouchableOpacity>
            )}
          </View>

          {rental.has_dispute && (
            <View style={styles.disputeSection}>
              <Text style={styles.sectionLabel}>Dispute</Text>
              {dispute?.description ? (
                <Text style={styles.description}>&quot;{dispute.description}&quot;</Text>
              ) : (
                <Text style={styles.noEvidence}>No description was provided.</Text>
              )}
              {signedPhotoUrl && (
                <Image source={{ uri: signedPhotoUrl }} style={styles.evidencePhoto} resizeMode="cover" />
              )}

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.favorRenterBtn, selectedFavor && selectedFavor !== 'renter' && styles.actionBtnDimmed]}
                  onPress={() => setSelectedFavor('renter')}
                >
                  <Text style={styles.actionBtnText}>Favor Renter</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.favorLenderBtn, selectedFavor && selectedFavor !== 'lender' && styles.actionBtnDimmed]}
                  onPress={() => setSelectedFavor('lender')}
                >
                  <Text style={styles.actionBtnText}>Favor Lender</Text>
                </TouchableOpacity>
              </View>

              {selectedFavor && (
                <View style={styles.publishSection}>
                  <TextInput
                    style={[styles.noteInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
                    placeholder={`Message to ${rental.renter_name} and ${rental.lender_name} (optional)`}
                    placeholderTextColor={colors.textMuted}
                    value={note}
                    onChangeText={setNote}
                    multiline
                  />
                  {selectedFavor === 'lender' && (
                    <TextInput
                      style={[styles.noteInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg, minHeight: undefined, height: 42 }]}
                      placeholder="Damage amount to charge the renter (₪, optional)"
                      placeholderTextColor={colors.textMuted}
                      keyboardType="numeric"
                      value={damageAmount}
                      onChangeText={setDamageAmount}
                    />
                  )}
                  <TouchableOpacity
                    style={[styles.publishBtn, resolving && styles.btnDisabled]}
                    onPress={() => resolve(selectedFavor)}
                    disabled={resolving}
                  >
                    {resolving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.publishBtnText}>Publish Ruling</Text>}
                  </TouchableOpacity>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
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
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 15, color: colors.textFaint },
  scroll: { padding: 16, gap: 14 },
  card: {
    backgroundColor: colors.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: colors.border, gap: 8,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemThumb: { width: 44, height: 44, borderRadius: 8 },
  itemThumbFallback: {
    width: 44, height: 44, borderRadius: 8, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  itemTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  dateRange: { fontSize: 12, color: colors.textFaint },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusText: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },
  disputedBadge: { backgroundColor: colors.dangerBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  disputedBadgeText: { fontSize: 12, fontWeight: '700', color: colors.danger },
  messageRow: { flexDirection: 'row', gap: 10 },
  messageBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.primary,
  },
  messageBtnText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  disputeSection: {
    backgroundColor: colors.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: colors.border, gap: 10,
  },
  sectionLabel: {
    fontSize: 12, fontWeight: '700', color: colors.textFaint,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  description: { fontSize: 13, color: colors.text, fontStyle: 'italic' },
  noEvidence: { fontSize: 13, color: colors.textFaint, fontStyle: 'italic' },
  evidencePhoto: { width: '100%', height: 180, borderRadius: 10 },
  actionsRow: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  favorRenterBtn: { backgroundColor: '#2563eb' },
  favorLenderBtn: { backgroundColor: '#15803d' },
  actionBtnDimmed: { opacity: 0.35 },
  actionBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  publishSection: { gap: 10 },
  noteInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 13, minHeight: 44, textAlignVertical: 'top',
  },
  publishBtn: { height: 44, borderRadius: 10, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  btnDisabled: { opacity: 0.6 },
  publishBtnText: { color: colors.bg, fontSize: 14, fontWeight: '700' },
});
