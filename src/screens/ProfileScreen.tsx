import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  ActivityIndicator, Modal, FlatList, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../services/supabase';
import { TEST_ACCOUNTS } from '../config/testAccounts';
import type { Item } from '../types/item';

type Nav = NativeStackNavigationProp<ProfileStackParamList, 'ProfileMain'>;

const SESSIONS_KEY = 'sar_test_sessions';
const CURRENT_KEY  = 'sar_current_label';

const CATEGORY_EMOJI: Record<string, string> = {
  photography: '📷', gaming: '🎮', camping: '⛺',
  diy: '🔧', music: '🎸', sports: '⚽',
};

async function saveCurrent(label: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const sessions = JSON.parse(await AsyncStorage.getItem(SESSIONS_KEY) ?? '{}');
  sessions[label] = { access_token: session.access_token, refresh_token: session.refresh_token };
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  await AsyncStorage.setItem(CURRENT_KEY, label);
}

export default function ProfileScreen() {
  const navigation = useNavigation<Nav>();

  const [loading, setLoading]           = useState(true);
  const [menuOpen, setMenuOpen]         = useState(false);
  const [switchModal, setSwitchModal]   = useState(false);
  const [switchingTo, setSwitchingTo]   = useState<string | null>(null);
  const [logoutLoading, setLogoutLoading] = useState(false);

  const [userId, setUserId]           = useState<string | null>(null);
  const [userName, setUserName]       = useState<string | null>(null);
  const [userEmail, setUserEmail]     = useState<string | null>(null);
  const [city, setCity]               = useState<string | null>(null);
  const [lenderScore, setLenderScore] = useState<number | null>(null);
  const [renterScore, setRenterScore] = useState<number | null>(null);
  const [avatarUrl, setAvatarUrl]     = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [items, setItems]             = useState<Item[]>([]);

  const activeLabel = TEST_ACCOUNTS.find(a => a.email === userEmail)?.label ?? null;

  useFocusEffect(useCallback(() => {
    async function load() {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);
      setUserEmail(user.email ?? null);

      const [profileRes, itemsRes] = await Promise.all([
        supabase.from('profiles').select('full_name, city, lender_score, renter_score, avatar_url').eq('id', user.id).single(),
        supabase.from('items')
          .select('id, owner_id, title, description, daily_price, sale_price, category, city, photos')
          .eq('owner_id', user.id)
          .eq('verification_status', 'live')
          .eq('is_hidden', false)
          .order('created_at', { ascending: false }),
      ]);

      if (profileRes.data) {
        setUserName((profileRes.data as any).full_name ?? null);
        setCity((profileRes.data as any).city ?? null);
        setLenderScore((profileRes.data as any).lender_score ?? null);
        setRenterScore((profileRes.data as any).renter_score ?? null);
        setAvatarUrl((profileRes.data as any).avatar_url ?? null);
      }
      if (itemsRes.data) setItems(itemsRes.data as Item[]);
      setLoading(false);
    }
    load();
  }, []));

  async function handleLogout() {
    Alert.alert('Log out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log out', style: 'destructive',
        onPress: async () => {
          setMenuOpen(false);
          setLogoutLoading(true);
          await AsyncStorage.removeItem(CURRENT_KEY);
          await supabase.auth.signOut();
          setLogoutLoading(false);
        },
      },
    ]);
  }

  async function switchTo(label: string, email: string, password: string) {
    setSwitchingTo(label);
    try {
      const currentLabel = await AsyncStorage.getItem(CURRENT_KEY);
      if (currentLabel) await saveCurrent(currentLabel);

      const sessions = JSON.parse(await AsyncStorage.getItem(SESSIONS_KEY) ?? '{}');
      const cached = sessions[label];
      if (cached) {
        const { error } = await supabase.auth.setSession(cached);
        if (!error) { await AsyncStorage.setItem(CURRENT_KEY, label); setSwitchModal(false); return; }
      }

      if (!email || !password) {
        Alert.alert('Not configured', `Add credentials for "${label}" in src/config/testAccounts.ts`);
        return;
      }
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) { Alert.alert('Sign-in failed', error.message); return; }

      const updated = JSON.parse(await AsyncStorage.getItem(SESSIONS_KEY) ?? '{}');
      updated[label] = { access_token: data.session!.access_token, refresh_token: data.session!.refresh_token };
      await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(updated));
      await AsyncStorage.setItem(CURRENT_KEY, label);
      setSwitchModal(false);
    } finally {
      setSwitchingTo(null);
    }
  }

  async function handleAvatarPress() {
    Alert.alert('Profile Photo', 'Choose an option', [
      {
        text: 'Take Photo',
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') { Alert.alert('Permission required', 'Camera access is needed.'); return; }
          const result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, base64: true, exif: false, allowsEditing: true, aspect: [1, 1] });
          if (!result.canceled && result.assets[0]) await uploadAvatar(result.assets[0]);
        },
      },
      {
        text: 'Choose from Gallery',
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') { Alert.alert('Permission required', 'Photo library access is needed.'); return; }
          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8, base64: true, exif: false, allowsEditing: true, aspect: [1, 1] });
          if (!result.canceled && result.assets[0]) await uploadAvatar(result.assets[0]);
        },
      },
      ...(avatarUrl ? [{ text: 'Remove Photo', style: 'destructive' as const, onPress: async () => {
        if (!userId) return;
        await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId);
        setAvatarUrl(null);
      }}] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }

  async function uploadAvatar(asset: ImagePicker.ImagePickerAsset) {
    if (!userId || !asset.base64) return;
    setAvatarUploading(true);
    try {
      const mimeType = asset.mimeType ?? 'image/jpeg';
      const ext = mimeType === 'image/jpeg' ? 'jpg' : (mimeType.split('/')[1] ?? 'jpg');
      const fileName = `avatars/${userId}.${ext}`;
      const binary = atob(asset.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const { error: uploadError } = await supabase.storage
        .from('item-images')
        .upload(fileName, bytes, { contentType: mimeType, upsert: true });
      if (uploadError) throw uploadError;
      const url = supabase.storage.from('item-images').getPublicUrl(fileName).data.publicUrl;
      // Bust cache with a timestamp so the image reloads after update
      const bustedUrl = `${url}?t=${Date.now()}`;
      await supabase.from('profiles').update({ avatar_url: bustedUrl }).eq('id', userId);
      setAvatarUrl(bustedUrl);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not upload photo');
    } finally {
      setAvatarUploading(false);
    }
  }

  function scoreLabel(score: number | null): string {
    if (score === null || score === 0) return '—';
    return score.toFixed(1);
  }

  function renderItem({ item }: { item: Item }) {
    const cover = item.photos?.find(Boolean);
    const emoji = CATEGORY_EMOJI[item.category] ?? '📦';
    return (
      <TouchableOpacity
        style={styles.itemCard}
        activeOpacity={0.8}
        onPress={() => navigation.navigate('ItemDetail', { item })}
      >
        {cover
          ? <Image source={{ uri: cover }} style={styles.itemThumb} resizeMode="cover" />
          : <View style={styles.itemThumbEmoji}><Text style={styles.itemEmoji}>{emoji}</Text></View>
        }
        <View style={styles.itemInfo}>
          <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
          <Text style={styles.itemPrice}>₪{item.daily_price}/day</Text>
          {item.city && <Text style={styles.itemCity}>📍 {item.city}</Text>}
        </View>
        <Text style={styles.itemChevron}>›</Text>
      </TouchableOpacity>
    );
  }

  const initials = (userName ?? activeLabel ?? '?').charAt(0).toUpperCase();

  if (loading) {
    return <SafeAreaView style={styles.container}><ActivityIndicator color="#fff" style={{ flex: 1 }} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <FlatList
        data={items}
        keyExtractor={i => i.id}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={styles.header}>
            {/* Top bar */}
            <View style={styles.topBar}>
              <Text style={styles.screenTitle}>Profile</Text>
              <TouchableOpacity style={styles.menuBtn} onPress={() => setMenuOpen(true)}>
                <Text style={styles.menuBtnText}>≡</Text>
              </TouchableOpacity>
            </View>

            {/* Avatar + name + city */}
            <View style={styles.avatarSection}>
              <TouchableOpacity onPress={handleAvatarPress} activeOpacity={0.8} style={styles.avatarWrapper}>
                {avatarUrl
                  ? <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
                  : <View style={styles.avatar}><Text style={styles.avatarInitial}>{initials}</Text></View>
                }
                <View style={styles.avatarEditBadge}>
                  {avatarUploading
                    ? <ActivityIndicator size="small" color="#000" />
                    : <Text style={styles.avatarEditIcon}>✎</Text>
                  }
                </View>
              </TouchableOpacity>
              <Text style={styles.userName}>{userName ?? activeLabel ?? 'Unknown'}</Text>
              {city ? <Text style={styles.userCity}>📍 {city}</Text> : null}
            </View>

            {/* Score badges */}
            <View style={styles.scoreRow}>
              <View style={styles.scoreBadge}>
                <Text style={styles.scoreValue}>{scoreLabel(lenderScore)}</Text>
                <Text style={styles.scoreLabel}>Lender</Text>
              </View>
              <View style={styles.scoreDivider} />
              <View style={styles.scoreBadge}>
                <Text style={styles.scoreValue}>{scoreLabel(renterScore)}</Text>
                <Text style={styles.scoreLabel}>Renter</Text>
              </View>
            </View>

            {/* Listings heading */}
            {items.length > 0 && (
              <Text style={styles.sectionTitle}>LISTINGS</Text>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📦</Text>
            <Text style={styles.emptyText}>No active listings</Text>
          </View>
        }
      />

      {/* Private menu bottom sheet */}
      <Modal visible={menuOpen} transparent animationType="slide" onRequestClose={() => setMenuOpen(false)}>
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setMenuOpen(false)}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />

            {[
              { icon: '📦', label: 'My Items',   onPress: () => { setMenuOpen(false); navigation.navigate('MyItems'); } },
              { icon: '📋', label: 'My Rentals', onPress: () => { setMenuOpen(false); navigation.navigate('MyRentals'); } },
              { icon: '❤️', label: 'Wishlist',   onPress: () => { setMenuOpen(false); navigation.navigate('Wishlist'); } },
              { icon: '🕓', label: 'History',    onPress: () => { setMenuOpen(false); navigation.navigate('History'); } },
              { icon: '🔀', label: 'Switch User', onPress: () => { setMenuOpen(false); setSwitchModal(true); } },
            ].map(row => (
              <TouchableOpacity key={row.label} style={styles.sheetRow} onPress={row.onPress}>
                <Text style={styles.sheetRowIcon}>{row.icon}</Text>
                <Text style={styles.sheetRowLabel}>{row.label}</Text>
                <Text style={styles.sheetRowArrow}>›</Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={[styles.sheetRow, styles.sheetRowDanger, logoutLoading && { opacity: 0.5 }]}
              onPress={handleLogout}
              disabled={logoutLoading}
            >
              {logoutLoading
                ? <ActivityIndicator color="#e57373" size="small" style={{ marginRight: 12 }} />
                : <Text style={styles.sheetRowIcon}>🚪</Text>
              }
              <Text style={[styles.sheetRowLabel, styles.sheetRowLabelDanger]}>Log out</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Switch User modal */}
      <Modal visible={switchModal} transparent animationType="slide" onRequestClose={() => setSwitchModal(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.switchTitle}>Switch User</Text>
            <Text style={styles.switchSubtitle}>First switch signs in once — after that it's instant</Text>

            {TEST_ACCOUNTS.map(account => {
              const isActive = account.label === activeLabel;
              return (
                <TouchableOpacity
                  key={account.label}
                  style={[styles.accountBtn, isActive && styles.accountBtnActive, switchingTo === account.label && { opacity: 0.6 }]}
                  onPress={() => switchTo(account.label, account.email, account.password)}
                  disabled={!!switchingTo}
                >
                  {switchingTo === account.label
                    ? <ActivityIndicator color="#000" size="small" />
                    : (
                      <>
                        <View style={[styles.accountAvatar, isActive && styles.accountAvatarActive]}>
                          <Text style={styles.accountAvatarText}>{account.label.charAt(0).toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.accountLabel}>{account.label}</Text>
                          <Text style={styles.accountEmail} numberOfLines={1}>{account.email || 'Not configured'}</Text>
                        </View>
                        {isActive && <Text style={styles.activeDot}>● Active</Text>}
                      </>
                    )
                  }
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity style={styles.cancelBtn} onPress={() => setSwitchModal(false)}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a1a' },

  listContent: { paddingBottom: 40 },

  header: { paddingBottom: 8 },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8,
  },
  screenTitle: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  menuBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  menuBtnText: { fontSize: 26, color: '#fff', fontWeight: '300' },

  avatarSection: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  avatarWrapper: { position: 'relative' },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: '#3a3a3a', borderWidth: 1, borderColor: '#4a4a4a',
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImage: { width: 80, height: 80, borderRadius: 40, borderWidth: 1, borderColor: '#4a4a4a' },
  avatarInitial: { fontSize: 32, fontWeight: '700', color: '#fff' },
  avatarEditBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: '#1a1a1a',
  },
  avatarEditIcon: { fontSize: 13, color: '#000', fontWeight: '600' },
  userName: { fontSize: 22, fontWeight: '700', color: '#fff' },
  userCity: { fontSize: 14, color: '#888' },

  scoreRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginHorizontal: 40, marginBottom: 28,
    backgroundColor: '#242424', borderRadius: 16,
    borderWidth: 1, borderColor: '#2a2a2a',
    paddingVertical: 16,
  },
  scoreBadge: { flex: 1, alignItems: 'center', gap: 4 },
  scoreValue: { fontSize: 22, fontWeight: '700', color: '#fff' },
  scoreLabel: { fontSize: 12, color: '#666', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },
  scoreDivider: { width: 1, height: 36, backgroundColor: '#2a2a2a' },

  sectionTitle: {
    fontSize: 11, fontWeight: '600', color: '#555',
    letterSpacing: 1, paddingHorizontal: 20, marginBottom: 12,
  },

  itemCard: {
    flexDirection: 'row', alignItems: 'center',
    marginHorizontal: 16, marginBottom: 10,
    backgroundColor: '#242424', borderRadius: 14,
    borderWidth: 1, borderColor: '#2a2a2a', overflow: 'hidden',
  },
  itemThumb: { width: 72, height: 72 },
  itemThumbEmoji: {
    width: 72, height: 72, backgroundColor: '#2a2a2a',
    alignItems: 'center', justifyContent: 'center',
  },
  itemEmoji: { fontSize: 28 },
  itemInfo: { flex: 1, paddingHorizontal: 14, gap: 3 },
  itemTitle: { fontSize: 15, fontWeight: '600', color: '#fff' },
  itemPrice: { fontSize: 13, color: '#888' },
  itemCity: { fontSize: 12, color: '#555' },
  itemChevron: { fontSize: 22, color: '#444', paddingRight: 14, fontWeight: '300' },

  empty: { alignItems: 'center', paddingTop: 40, gap: 8 },
  emptyIcon: { fontSize: 40 },
  emptyText: { fontSize: 15, color: '#555' },

  // Bottom sheet
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#242424', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12, gap: 4,
  },
  sheetHandle: { width: 40, height: 4, backgroundColor: '#444', borderRadius: 2, alignSelf: 'center', marginBottom: 12 },

  sheetRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#2e2e2e',
  },
  sheetRowDanger: { borderBottomWidth: 0, marginTop: 8 },
  sheetRowIcon: { fontSize: 20, width: 28, textAlign: 'center' },
  sheetRowLabel: { flex: 1, fontSize: 16, color: '#fff', fontWeight: '500' },
  sheetRowLabelDanger: { color: '#e57373' },
  sheetRowArrow: { fontSize: 20, color: '#444' },

  // Switch user
  switchTitle: { fontSize: 18, fontWeight: '700', color: '#fff', marginBottom: 2 },
  switchSubtitle: { fontSize: 13, color: '#666', marginBottom: 12 },
  accountBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#2a2a2a', borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderWidth: 1, borderColor: '#3a3a3a', minHeight: 56, justifyContent: 'center',
    marginBottom: 8,
  },
  accountBtnActive: { borderColor: '#4caf50', backgroundColor: '#1a2a1a' },
  accountAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: '#3a3a3a', alignItems: 'center', justifyContent: 'center',
  },
  accountAvatarActive: { backgroundColor: '#4caf50' },
  accountAvatarText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  accountLabel: { fontSize: 16, fontWeight: '600', color: '#fff' },
  accountEmail: { fontSize: 12, color: '#666', marginTop: 2 },
  activeDot: { fontSize: 12, color: '#4caf50', fontWeight: '600' },
  cancelBtn: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  cancelText: { color: '#fff', fontSize: 15 },
});
