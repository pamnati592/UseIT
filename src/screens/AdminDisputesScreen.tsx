import { useState, useCallback, useMemo, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Image, Alert, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';
import { supabase } from '../services/supabase';
import { signedUrlFor, HANDOFF_EVIDENCE_BUCKET } from '../services/storage';
import { formatDateRange } from '../utils/format';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { ChevronLeft, Scale, Package, ShieldCheck } from 'lucide-react-native';

type Props = NativeStackScreenProps<ProfileStackParamList, 'AdminDisputes'>;

type DisputeRow = {
  transaction_id: string;
  item_title: string;
  item_photo: string | null;
  start_date: string;
  end_date: string;
  total_price: number;
  renter_id: string;
  renter_name: string;
  lender_id: string;
  lender_name: string;
  dispute_id: string | null;
  description: string | null;
  photo_url: string | null;
  reporter_id: string | null;
  reported_at: string | null;
  signedPhotoUrl?: string | null;
};

export default function AdminDisputesScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [disputes, setDisputes] = useState<DisputeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [damageAmounts, setDamageAmounts] = useState<Record<string, string>>({});
  // Which way the admin is leaning, per dispute — purely local until Publish
  // Ruling is tapped. Freely switchable between renter/lender before then;
  // nothing is sent to either party until the explicit publish action.
  const [selectedFavor, setSelectedFavor] = useState<Record<string, 'renter' | 'lender'>>({});
  // The sole admin account is also a real test party on real transactions —
  // "Message Renter/Lender" must hide whichever side is the admin's own
  // account, since admin_ensure_support_thread now rejects that server-side
  // (an admin can't have a support thread with themselves).
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null)); }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_list_disputes');
    if (error) { Alert.alert('Error', error.message); setLoading(false); return; }

    const rows = (data as DisputeRow[]) ?? [];
    // handoff-evidence is a private bucket — mint a short-lived signed URL per
    // photo rather than storing/displaying a raw path.
    const withUrls = await Promise.all(rows.map(async (r) => ({
      ...r,
      signedPhotoUrl: r.photo_url ? await signedUrlFor(HANDOFF_EVIDENCE_BUCKET, r.photo_url) : null,
    })));
    setDisputes(withUrls);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Called only from "Publish Ruling" — the admin has already picked a side
  // and reviewed the fields, so this is the actual send, not a second
  // confirmation gate on top of that (per the redesigned flow: pick a side,
  // relevant fields open, freely switch sides, publish once ready).
  async function resolve(transactionId: string, favor: 'renter' | 'lender') {
    const damageRaw = favor === 'lender' ? damageAmounts[transactionId]?.trim() : '';
    const damageAmount = damageRaw ? Number(damageRaw) : 0;
    if (damageRaw && (!Number.isFinite(damageAmount) || damageAmount <= 0)) {
      Alert.alert('Invalid damage amount', 'Enter a positive number, or leave it blank if no damage charge applies.');
      return;
    }

    setResolvingId(transactionId);

    // admin_resolve_dispute and the Stripe step below are not one atomic
    // operation — if the ruling itself fails, nothing was committed, so a
    // plain error is enough.
    const { error } = await supabase.rpc('admin_resolve_dispute', {
      p_transaction_id: transactionId,
      p_favor: favor,
      p_note: notes[transactionId]?.trim() || undefined,
    });
    if (error) {
      Alert.alert('Error', error.message ?? 'Could not resolve the dispute.');
      setResolvingId(null);
      return;
    }

    if (favor === 'renter') {
      const { error: refundError } = await supabase.functions.invoke('refund-payment', {
        body: { transaction_id: transactionId, reason: 'admin_dispute_resolved' },
      });
      if (refundError) {
        // The ruling is already committed (transaction cancelled, dispute
        // resolved) — a failed refund here previously left it silently
        // "resolved" with no money moved, and invisible in this queue
        // forever, since admin_list_disputes only returns status =
        // 'disputed' transactions. Reopen it instead of leaving that gap.
        await supabase.rpc('admin_reopen_dispute', { p_transaction_id: transactionId });
        Alert.alert(
          'Refund failed — dispute reopened',
          `The ruling could not be completed (${refundError.message ?? 'refund failed'}). This case has been reopened so you can retry once the issue is fixed.`
        );
        setResolvingId(null);
        return;
      }
    } else if (damageAmount > 0) {
      // Favor-lender stands on its own regardless of the damage charge —
      // the lender keeps their payment either way — so a failed charge
      // doesn't need to reopen the dispute, just notify the admin. The
      // renter is separately notified in chat (see admin-charge).
      const { data: chargeResult, error: chargeError } = await supabase.functions.invoke('admin-charge', {
        body: { transaction_id: transactionId, amount: damageAmount, reason: 'damage' },
      });
      if (chargeError) {
        Alert.alert('Damage charge failed', chargeError.message ?? 'Could not process the charge.');
      } else if (chargeResult && !chargeResult.ok) {
        Alert.alert('Damage charge failed', 'The card on file was declined or missing — the renter has been notified in chat to arrange payment directly.');
      }
    }

    setDisputes(prev => prev.filter(d => d.transaction_id !== transactionId));
    setResolvingId(null);
  }

  async function messageParty(transactionId: string, userId: string, label: string) {
    try {
      const { data: threadId, error } = await supabase.rpc('admin_ensure_support_thread', {
        p_transaction_id: transactionId,
        p_user_id: userId,
      });
      if (error) throw error;
      navigation.navigate('SupportThread', { threadId: threadId as string, title: `${label} · Dispute Support` });
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not open support chat.');
    }
  }

  function renderItem({ item: d }: { item: DisputeRow }) {
    const resolving = resolvingId === d.transaction_id;
    const selected = selectedFavor[d.transaction_id];
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            {d.item_photo
              ? <Image source={{ uri: d.item_photo }} style={styles.itemThumb} />
              : <View style={styles.itemThumbFallback}><Package size={18} color={colors.textMuted} /></View>}
            <View>
              <Text style={styles.itemTitle}>{d.item_title}</Text>
              <Text style={styles.dateRange}>{formatDateRange(d.start_date, d.end_date)} · ₪{d.total_price}</Text>
            </View>
          </View>
        </View>

        <View style={styles.partiesRow}>
          <Text style={styles.partyText}>Renter: {d.renter_name}</Text>
          <Text style={styles.partyText}>Lender: {d.lender_name}</Text>
        </View>

        {d.description ? (
          <Text style={styles.description}>&quot;{d.description}&quot;</Text>
        ) : (
          <Text style={styles.noEvidence}>No description was provided.</Text>
        )}

        {d.signedPhotoUrl && (
          <Image source={{ uri: d.signedPhotoUrl }} style={styles.evidencePhoto} resizeMode="cover" />
        )}

        <View style={styles.messageRow}>
          {d.renter_id !== currentUserId && (
            <TouchableOpacity
              style={styles.messageBtn}
              onPress={() => messageParty(d.transaction_id, d.renter_id, d.renter_name)}
            >
              <ShieldCheck size={13} color={colors.primary} />
              <Text style={styles.messageBtnText}>Message Renter</Text>
            </TouchableOpacity>
          )}
          {d.lender_id !== currentUserId && (
            <TouchableOpacity
              style={styles.messageBtn}
              onPress={() => messageParty(d.transaction_id, d.lender_id, d.lender_name)}
            >
              <ShieldCheck size={13} color={colors.primary} />
              <Text style={styles.messageBtnText}>Message Lender</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Pick a side first — nothing is sent yet. The relevant fields for
            that side open below, and the side can still be switched freely
            right up until Publish Ruling is tapped. */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.favorRenterBtn, selected && selected !== 'renter' && styles.actionBtnDimmed]}
            onPress={() => setSelectedFavor(prev => ({ ...prev, [d.transaction_id]: 'renter' }))}
          >
            <Text style={styles.actionBtnText}>Favor Renter</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.favorLenderBtn, selected && selected !== 'lender' && styles.actionBtnDimmed]}
            onPress={() => setSelectedFavor(prev => ({ ...prev, [d.transaction_id]: 'lender' }))}
          >
            <Text style={styles.actionBtnText}>Favor Lender</Text>
          </TouchableOpacity>
        </View>

        {selected && (
          <View style={styles.publishSection}>
            <TextInput
              style={[styles.noteInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
              placeholder={`Message to ${d.renter_name} and ${d.lender_name} (optional)`}
              placeholderTextColor={colors.textMuted}
              value={notes[d.transaction_id] ?? ''}
              onChangeText={(t) => setNotes(prev => ({ ...prev, [d.transaction_id]: t }))}
              multiline
            />
            {selected === 'lender' && (
              <TextInput
                style={[styles.noteInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg, minHeight: undefined, height: 42 }]}
                placeholder="Damage amount to charge the renter (₪, optional)"
                placeholderTextColor={colors.textMuted}
                keyboardType="numeric"
                value={damageAmounts[d.transaction_id] ?? ''}
                onChangeText={(t) => setDamageAmounts(prev => ({ ...prev, [d.transaction_id]: t }))}
              />
            )}
            <TouchableOpacity
              style={[styles.publishBtn, resolving && styles.btnDisabled]}
              onPress={() => resolve(d.transaction_id, selected)}
              disabled={resolving}
            >
              {resolving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.publishBtnText}>Publish Ruling</Text>}
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('AdminHome')} style={styles.backBtn}>
          <ChevronLeft size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Dispute Queue</Text>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {loading ? (
          <ActivityIndicator color={colors.text} style={{ flex: 1 }} />
        ) : disputes.length === 0 ? (
          <View style={styles.empty}>
            <Scale size={48} color={colors.textFaint} strokeWidth={1.5} />
            <Text style={styles.emptyText}>No open disputes</Text>
            <Text style={styles.emptySub}>Disputed rentals with evidence will show up here</Text>
          </View>
        ) : (
          <FlatList
            data={disputes}
            keyExtractor={(d) => d.transaction_id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
            keyboardShouldPersistTaps="handled"
          />
        )}
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
  title: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', color: colors.text },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { fontSize: 18, fontWeight: '600', color: colors.text },
  emptySub: { fontSize: 14, color: colors.textFaint, textAlign: 'center', paddingHorizontal: 40 },
  list: { padding: 16 },
  card: {
    backgroundColor: colors.card, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: colors.border, gap: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center' },
  cardHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  itemThumb: { width: 44, height: 44, borderRadius: 8 },
  itemThumbFallback: {
    width: 44, height: 44, borderRadius: 8, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  itemTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  dateRange: { fontSize: 12, color: colors.textFaint },
  partiesRow: { flexDirection: 'row', gap: 16 },
  partyText: { fontSize: 12, color: colors.textSecondary },
  description: { fontSize: 13, color: colors.text, fontStyle: 'italic' },
  noEvidence: { fontSize: 13, color: colors.textFaint, fontStyle: 'italic' },
  evidencePhoto: { width: '100%', height: 180, borderRadius: 10 },
  noteInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 13, minHeight: 44, textAlignVertical: 'top',
  },
  messageRow: { flexDirection: 'row', gap: 10 },
  messageBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 36, borderRadius: 8, borderWidth: 1, borderColor: colors.primary,
  },
  messageBtnText: { color: colors.primary, fontSize: 12.5, fontWeight: '600' },
  actionsRow: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1, height: 42, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  favorRenterBtn: { backgroundColor: '#2563eb' },
  favorLenderBtn: { backgroundColor: '#15803d' },
  actionBtnDimmed: { opacity: 0.35 },
  actionBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
  publishSection: { gap: 10 },
  publishBtn: {
    height: 44, borderRadius: 10, backgroundColor: colors.text,
    alignItems: 'center', justifyContent: 'center',
  },
  publishBtnText: { color: colors.bg, fontSize: 14, fontWeight: '700' },
});
