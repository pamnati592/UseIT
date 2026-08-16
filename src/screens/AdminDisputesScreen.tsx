import { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Image, Alert, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';
import { supabase } from '../services/supabase';
import { signedUrlFor, HANDOFF_EVIDENCE_BUCKET } from '../services/storage';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { ChevronLeft, Scale, Package } from 'lucide-react-native';

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

  function formatDateRange(start: string, end: string): string {
    const fmt = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `${fmt(start)} → ${fmt(end)}`;
  }

  async function resolve(transactionId: string, favor: 'renter' | 'lender') {
    Alert.alert(
      `Rule in favor of the ${favor}?`,
      favor === 'renter'
        ? 'The renter will receive a full refund. This cannot be undone.'
        : 'The lender keeps the payment already taken. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm', style: 'destructive', onPress: async () => {
            setResolvingId(transactionId);
            try {
              const { error } = await supabase.rpc('admin_resolve_dispute', {
                p_transaction_id: transactionId,
                p_favor: favor,
                p_note: notes[transactionId]?.trim() || null,
              });
              if (error) throw error;

              if (favor === 'renter') {
                const { error: refundError } = await supabase.functions.invoke('refund-payment', {
                  body: { transaction_id: transactionId, reason: 'admin_dispute_resolved' },
                });
                if (refundError) throw refundError;
              }

              setDisputes(prev => prev.filter(d => d.transaction_id !== transactionId));
            } catch (e: any) {
              Alert.alert('Error', e.message ?? 'Could not resolve the dispute.');
            } finally {
              setResolvingId(null);
            }
          },
        },
      ]
    );
  }

  function renderItem({ item: d }: { item: DisputeRow }) {
    const resolving = resolvingId === d.transaction_id;
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
          <Text style={styles.description}>"{d.description}"</Text>
        ) : (
          <Text style={styles.noEvidence}>No description was provided.</Text>
        )}

        {d.signedPhotoUrl && (
          <Image source={{ uri: d.signedPhotoUrl }} style={styles.evidencePhoto} resizeMode="cover" />
        )}

        <TextInput
          style={[styles.noteInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
          placeholder="Resolution note (optional, kept with the dispute record)"
          placeholderTextColor={colors.textMuted}
          value={notes[d.transaction_id] ?? ''}
          onChangeText={(t) => setNotes(prev => ({ ...prev, [d.transaction_id]: t }))}
          multiline
        />

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.favorRenterBtn, resolving && styles.btnDisabled]}
            onPress={() => resolve(d.transaction_id, 'renter')}
            disabled={resolving}
          >
            {resolving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.actionBtnText}>Favor Renter</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.favorLenderBtn, resolving && styles.btnDisabled]}
            onPress={() => resolve(d.transaction_id, 'lender')}
            disabled={resolving}
          >
            {resolving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.actionBtnText}>Favor Lender</Text>}
          </TouchableOpacity>
        </View>
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
  actionsRow: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1, height: 42, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  favorRenterBtn: { backgroundColor: '#2563eb' },
  favorLenderBtn: { backgroundColor: '#15803d' },
  actionBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
});
