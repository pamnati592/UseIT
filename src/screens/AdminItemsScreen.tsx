import { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Image, Alert, TextInput, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';
import { supabase } from '../services/supabase';
import { signedUrlFor, VERIFICATION_PHOTOS_BUCKET } from '../services/storage';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { CategoryIcon } from '../components/CategoryIcon';
import { ChevronLeft, PackageCheck, Check, X } from 'lucide-react-native';

type Props = NativeStackScreenProps<ProfileStackParamList, 'AdminItems'>;

type PendingItem = {
  item_id: string;
  title: string;
  category: string;
  description: string | null;
  daily_price: number;
  sale_price: number | null;
  city: string | null;
  photos: string[] | null;
  verification_image_url: string | null;
  owner_id: string;
  owner_name: string;
  created_at: string;
  signedVerificationUrl?: string | null;
};

const REJECT_REASON_MIN = 5;

export default function AdminItemsScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<PendingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_list_pending_items');
    if (error) { Alert.alert('Error', error.message); setLoading(false); return; }
    const rows = (data as PendingItem[]) ?? [];
    // verification-photos is a private bucket (backlog AB) — the stored value
    // is a path, not a displayable URL; mint a short-lived signed one here.
    const withUrls = await Promise.all(rows.map(async (r) => ({
      ...r,
      signedVerificationUrl: r.verification_image_url
        ? await signedUrlFor(VERIFICATION_PHOTOS_BUCKET, r.verification_image_url)
        : null,
    })));
    setItems(withUrls);
    setLoading(false);
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function approve(itemId: string) {
    setBusyId(itemId);
    try {
      const { error } = await supabase.rpc('admin_approve_item', { p_item_id: itemId });
      if (error) throw error;
      setItems(prev => prev.filter(i => i.item_id !== itemId));
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function reject(itemId: string) {
    const reason = reasons[itemId]?.trim() ?? '';
    if (reason.length < REJECT_REASON_MIN) {
      Alert.alert('Reason needed', `Give the seller at least ${REJECT_REASON_MIN} characters explaining why.`);
      return;
    }
    setBusyId(itemId);
    try {
      const { error } = await supabase.rpc('admin_reject_item', { p_item_id: itemId, p_reason: reason });
      if (error) throw error;
      setItems(prev => prev.filter(i => i.item_id !== itemId));
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setBusyId(null);
      setRejectingId(null);
    }
  }

  function renderItem({ item }: { item: PendingItem }) {
    const busy = busyId === item.item_id;
    const cover = item.photos?.[0];
    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          {cover
            ? <Image source={{ uri: cover }} style={styles.itemThumb} />
            : <View style={styles.itemThumbFallback}><CategoryIcon category={item.category} size={20} color={colors.textMuted} /></View>}
          <View style={{ flex: 1 }}>
            <Text style={styles.itemTitle}>{item.title}</Text>
            <Text style={styles.itemMeta}>₪{item.daily_price}/day{item.sale_price ? ` · Buy ₪${item.sale_price}` : ''}</Text>
            <Text style={styles.itemMeta}>{item.city ?? 'No city set'} · by {item.owner_name}</Text>
          </View>
        </View>

        {item.description && <Text style={styles.description}>{item.description}</Text>}

        {item.photos && item.photos.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photoRow}>
            {item.photos.map((url, i) => (
              <Image key={i} source={{ uri: url }} style={styles.galleryPhoto} />
            ))}
          </ScrollView>
        )}

        {item.signedVerificationUrl ? (
          <View>
            <Text style={styles.sectionLabel}>Verification photo (admin only)</Text>
            <Image source={{ uri: item.signedVerificationUrl }} style={styles.verificationPhoto} resizeMode="cover" />
          </View>
        ) : (
          <Text style={styles.noEvidence}>No verification photo was submitted.</Text>
        )}

        {rejectingId === item.item_id ? (
          <>
            <TextInput
              style={[styles.reasonInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.bg }]}
              placeholder="Why is this being rejected? (shown to the seller)"
              placeholderTextColor={colors.textMuted}
              value={reasons[item.item_id] ?? ''}
              onChangeText={(t) => setReasons(prev => ({ ...prev, [item.item_id]: t }))}
              multiline
              autoFocus
            />
            <View style={styles.actionsRow}>
              <TouchableOpacity style={[styles.actionBtn, styles.rejectBtn, busy && styles.btnDisabled]} onPress={() => reject(item.item_id)} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.actionBtnText}>Confirm Reject</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setRejectingId(null)} disabled={busy}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </>
        ) : (
          <View style={styles.actionsRow}>
            <TouchableOpacity style={[styles.actionBtn, styles.approveBtn, busy && styles.btnDisabled]} onPress={() => approve(item.item_id)} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" size="small" /> : <><Check size={15} color="#fff" /><Text style={styles.actionBtnText}>Approve</Text></>}
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.rejectBtn, busy && styles.btnDisabled]} onPress={() => setRejectingId(item.item_id)} disabled={busy}>
              <X size={15} color="#fff" /><Text style={styles.actionBtnText}>Reject</Text>
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
        <Text style={styles.title}>Item Moderation</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <ActivityIndicator color={colors.text} style={{ flex: 1 }} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <PackageCheck size={48} color={colors.textFaint} strokeWidth={1.5} />
          <Text style={styles.emptyText}>Nothing pending</Text>
          <Text style={styles.emptySub}>New listings awaiting verification will show up here</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.item_id}
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
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  itemThumb: { width: 48, height: 48, borderRadius: 8 },
  itemThumbFallback: {
    width: 48, height: 48, borderRadius: 8, backgroundColor: colors.bg,
    alignItems: 'center', justifyContent: 'center',
  },
  itemTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  itemMeta: { fontSize: 12, color: colors.textFaint },
  description: { fontSize: 13, color: colors.textSecondary },
  photoRow: { flexDirection: 'row' },
  galleryPhoto: { width: 72, height: 72, borderRadius: 8, marginRight: 8 },
  sectionLabel: { fontSize: 11, color: colors.textFaint, fontWeight: '700', textTransform: 'uppercase', marginBottom: 6 },
  verificationPhoto: { width: '100%', height: 180, borderRadius: 10 },
  noEvidence: { fontSize: 13, color: colors.textFaint, fontStyle: 'italic' },
  reasonInput: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    fontSize: 13, minHeight: 60, textAlignVertical: 'top',
  },
  actionsRow: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1, height: 42, borderRadius: 10, flexDirection: 'row', gap: 6,
    alignItems: 'center', justifyContent: 'center',
  },
  approveBtn: { backgroundColor: '#15803d' },
  rejectBtn: { backgroundColor: colors.danger },
  actionBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  cancelBtn: { paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { color: colors.textFaint, fontSize: 13, fontWeight: '600' },
  btnDisabled: { opacity: 0.6 },
});
