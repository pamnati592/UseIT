import { useState, useCallback, useMemo} from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Alert,
  ActivityIndicator, Modal, FlatList, Image, Switch, Share,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../services/supabase';
import { TEST_ACCOUNTS } from '../config/testAccounts';
import type { Item } from '../types/item';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { CategoryIcon } from '../components/CategoryIcon';
import {
  ChevronRight, MapPin, Pencil, Package, ClipboardList, Heart, Clock, Repeat, Moon, Sun, LogOut, ShieldCheck, Wallet, CircleCheck,
  Download, Trash2,
} from 'lucide-react-native';

type Nav = NativeStackNavigationProp<ProfileStackParamList, 'ProfileMain'>;

const SESSIONS_KEY = 'sar_test_sessions';
const CURRENT_KEY  = 'sar_current_label';

async function saveCurrent(label: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;
  const sessions = JSON.parse(await AsyncStorage.getItem(SESSIONS_KEY) ?? '{}');
  sessions[label] = { access_token: session.access_token, refresh_token: session.refresh_token };
  await AsyncStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  await AsyncStorage.setItem(CURRENT_KEY, label);
}

export default function ProfileScreen() {
  const { colors, isDark, toggleMode } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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
  const [isAdmin, setIsAdmin]         = useState(false);
  const [chargesEnabled, setChargesEnabled] = useState(false);
  const [detailsSubmitted, setDetailsSubmitted] = useState(false);
  const [payoutsLoading, setPayoutsLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const activeLabel = TEST_ACCOUNTS.find(a => a.email === userEmail)?.label ?? null;

  useFocusEffect(useCallback(() => {
    async function load() {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);
      setUserEmail(user.email ?? null);

      const [profileRes, itemsRes] = await Promise.all([
        supabase.from('profiles').select('full_name, city, lender_score, renter_score, avatar_url, is_admin, stripe_connect_charges_enabled, stripe_connect_details_submitted').eq('id', user.id).single(),
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
        setIsAdmin((profileRes.data as any).is_admin ?? false);
        setChargesEnabled((profileRes.data as any).stripe_connect_charges_enabled ?? false);
        setDetailsSubmitted((profileRes.data as any).stripe_connect_details_submitted ?? false);
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

  // GDPR right to export (spec 5.2). Pure client-side reads through each
  // table's existing RLS ("own rows" policies already used everywhere else
  // in the app) rather than a service-role edge function — nothing here
  // needs privileges the user doesn't already have over their own data.
  async function handleExportData() {
    if (!userId) return;
    setMenuOpen(false);
    setExporting(true);
    try {
      const [profile, myItems, transactions, purchases, ratingsGiven, ratingsReceived, reviewsGiven, supportThreads] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).single(),
        supabase.from('items').select('*').eq('owner_id', userId),
        supabase.from('transactions').select('*').or(`renter_id.eq.${userId},lender_id.eq.${userId}`),
        supabase.from('purchases').select('*').or(`buyer_id.eq.${userId},seller_id.eq.${userId}`),
        supabase.from('ratings').select('*').eq('reviewer_id', userId),
        supabase.from('ratings').select('*').eq('reviewee_id', userId),
        supabase.from('item_reviews').select('*').eq('reviewer_id', userId),
        supabase.from('support_threads').select('*').eq('user_id', userId),
      ]);

      const payload = {
        exported_at: new Date().toISOString(),
        profile: profile.data,
        items: myItems.data ?? [],
        transactions: transactions.data ?? [],
        purchases: purchases.data ?? [],
        ratings_given: ratingsGiven.data ?? [],
        ratings_received: ratingsReceived.data ?? [],
        item_reviews_given: reviewsGiven.data ?? [],
        support_threads: supportThreads.data ?? [],
      };

      await Share.share({ message: JSON.stringify(payload, null, 2), title: 'SwipeAndRent data export' });
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not export your data.');
    } finally {
      setExporting(false);
    }
  }

  // Apple guideline 5.1.1v / spec 5.2 GDPR right to deletion. The real work
  // (anonymize + hide listings + permanent auth ban) is server-side, see
  // supabase/functions/delete-account — this just confirms twice (given how
  // irreversible it is) and signs the device out once it succeeds.
  function handleDeleteAccount() {
    Alert.alert(
      'Delete account?',
      'This removes your personal info and permanently blocks you from logging back in. Your rental history stays visible to the people you transacted with, but anonymized. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue', style: 'destructive', onPress: () => {
            Alert.alert(
              'Are you absolutely sure?',
              'Last chance to back out.',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Delete My Account', style: 'destructive', onPress: async () => {
                    setMenuOpen(false);
                    setDeletingAccount(true);
                    const { data, error } = await supabase.functions.invoke('delete-account');
                    if (error) {
                      const body = await error.context?.json?.().catch(() => null);
                      setDeletingAccount(false);
                      Alert.alert('Error', body?.error ?? error.message);
                      return;
                    }
                    if (data?.error) { setDeletingAccount(false); Alert.alert('Error', data.error); return; }
                    await AsyncStorage.removeItem(CURRENT_KEY);
                    await supabase.auth.signOut();
                    setDeletingAccount(false);
                  },
                },
              ]
            );
          },
        },
      ]
    );
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

  // Real payouts (spec 4.10) — a rental can't be paid at all until its
  // lender completes this (create-payment-intent checks
  // stripe_connect_charges_enabled server-side). Uses openAuthSessionAsync
  // rather than a manual deep-link listener: it resolves this promise
  // itself once Stripe redirects to connect-return, no app-wide Linking
  // config needed for a single one-off flow like this.
  async function handleSetupPayouts() {
    setPayoutsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('connect-onboarding');
      if (error) {
        // Same pitfall as analyze-item-photo: error.message is always the
        // generic "Edge Function returned a non-2xx status code" — the
        // function's real {error: "..."} body only lives in error.context.
        const body = await error.context?.json?.().catch(() => null);
        throw new Error(body?.error ?? error.message);
      }
      if (data?.error) throw new Error(data.error);

      await WebBrowser.openAuthSessionAsync(data.url, 'swipeandrent://connect-return');

      const { data: status, error: statusError } = await supabase.functions.invoke('refresh-connect-status');
      if (!statusError && status) {
        setChargesEnabled(!!status.charges_enabled);
        setDetailsSubmitted(!!status.details_submitted);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not open payout setup.');
    } finally {
      setPayoutsLoading(false);
    }
  }

  function scoreLabel(score: number | null): string {
    if (score === null || score === 0) return '—';
    return score.toFixed(1);
  }

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

  const initials = (userName ?? activeLabel ?? '?').charAt(0).toUpperCase();

  if (loading) {
    return <SafeAreaView style={styles.container}><ActivityIndicator color={colors.text} style={{ flex: 1 }} /></SafeAreaView>;
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
                    ? <ActivityIndicator size="small" color={colors.btnText} />
                    : <Pencil size={13} color={colors.btnText} />
                  }
                </View>
              </TouchableOpacity>
              <Text style={styles.userName}>{userName ?? activeLabel ?? 'Unknown'}</Text>
              {city ? (
                <View style={styles.userCityRow}>
                  <MapPin size={13} color={colors.textMuted} />
                  <Text style={styles.userCity}>{city}</Text>
                </View>
              ) : null}
            </View>

            {/* Score badges */}
            <View style={styles.scoreRow}>
              <TouchableOpacity
                style={styles.scoreBadge}
                onPress={() => userId && navigation.navigate('ReviewsList', { mode: 'profile', userId, userName: userName ?? 'You', role: 'lender' })}
              >
                <Text style={styles.scoreValue}>{scoreLabel(lenderScore)}</Text>
                <Text style={styles.scoreLabel}>Lender</Text>
              </TouchableOpacity>
              <View style={styles.scoreDivider} />
              <TouchableOpacity
                style={styles.scoreBadge}
                onPress={() => userId && navigation.navigate('ReviewsList', { mode: 'profile', userId, userName: userName ?? 'You', role: 'renter' })}
              >
                <Text style={styles.scoreValue}>{scoreLabel(renterScore)}</Text>
                <Text style={styles.scoreLabel}>Renter</Text>
              </TouchableOpacity>
            </View>

            {/* Payout setup — a rental literally can't be paid until this is
                done, since create-payment-intent now requires the lender's
                Connect account to be charges_enabled. */}
            <View style={styles.payoutCard}>
              {chargesEnabled ? (
                <View style={styles.payoutRow}>
                  <CircleCheck size={20} color={colors.success} />
                  <Text style={styles.payoutText}>Payouts are set up — you can get paid when you rent out items</Text>
                </View>
              ) : (
                <>
                  <View style={styles.payoutRow}>
                    <Wallet size={20} color={colors.primary} />
                    <Text style={styles.payoutText}>
                      {detailsSubmitted
                        ? "Stripe is still reviewing your payout details"
                        : "Set up payouts to get paid when someone rents your items"}
                    </Text>
                  </View>
                  <TouchableOpacity
                    style={[styles.payoutBtn, payoutsLoading && styles.payoutBtnDisabled]}
                    onPress={handleSetupPayouts}
                    disabled={payoutsLoading}
                  >
                    {payoutsLoading
                      ? <ActivityIndicator color={colors.btnText} size="small" />
                      : <Text style={styles.payoutBtnText}>{detailsSubmitted ? 'Check Again' : 'Set Up Payouts'}</Text>}
                  </TouchableOpacity>
                </>
              )}
            </View>

            {/* Listings heading */}
            {items.length > 0 && (
              <Text style={styles.sectionTitle}>LISTINGS</Text>
            )}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Package size={48} color={colors.textFaint} strokeWidth={1.5} />
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
              { Icon: Package,       label: 'My Items',   onPress: () => { setMenuOpen(false); navigation.navigate('MyItems'); } },
              { Icon: ClipboardList, label: 'My Rentals', onPress: () => { setMenuOpen(false); navigation.navigate('MyRentals'); } },
              { Icon: Heart,         label: 'Wishlist',   onPress: () => { setMenuOpen(false); navigation.navigate('Wishlist'); } },
              { Icon: Clock,         label: 'History',    onPress: () => { setMenuOpen(false); navigation.navigate('History'); } },
              ...(isAdmin ? [{ Icon: ShieldCheck, label: 'Admin Console', onPress: () => { setMenuOpen(false); navigation.navigate('AdminHome'); } }] : []),
              ...(__DEV__ ? [{ Icon: Repeat, label: 'Switch User', onPress: () => { setMenuOpen(false); setSwitchModal(true); } }] : []),
              { Icon: Download,      label: 'Export My Data', onPress: handleExportData },
            ].map(({ Icon, label, onPress }) => (
              <TouchableOpacity key={label} style={styles.sheetRow} onPress={onPress}>
                <View style={styles.sheetRowIcon}><Icon size={20} color={colors.text} /></View>
                <Text style={styles.sheetRowLabel}>{label}</Text>
                <ChevronRight size={18} color={colors.textFaint} />
              </TouchableOpacity>
            ))}

            {/* Theme toggle — light is the default, flip to dark here */}
            <View style={styles.sheetRow}>
              <View style={styles.sheetRowIcon}>{isDark ? <Moon size={20} color={colors.text} /> : <Sun size={20} color={colors.text} />}</View>
              <Text style={styles.sheetRowLabel}>Dark Mode</Text>
              <Switch
                value={isDark}
                onValueChange={toggleMode}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.white}
              />
            </View>

            <TouchableOpacity
              style={[styles.sheetRow, styles.sheetRowDanger, logoutLoading && { opacity: 0.5 }]}
              onPress={handleLogout}
              disabled={logoutLoading}
            >
              {logoutLoading
                ? <ActivityIndicator color={colors.dangerSoft} size="small" style={{ marginRight: 12 }} />
                : <View style={styles.sheetRowIcon}><LogOut size={20} color={colors.dangerSoft} /></View>
              }
              <Text style={[styles.sheetRowLabel, styles.sheetRowLabelDanger]}>Log out</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sheetRow, styles.sheetRowDanger, deletingAccount && { opacity: 0.5 }]}
              onPress={handleDeleteAccount}
              disabled={deletingAccount}
            >
              {deletingAccount
                ? <ActivityIndicator color={colors.dangerSoft} size="small" style={{ marginRight: 12 }} />
                : <View style={styles.sheetRowIcon}><Trash2 size={20} color={colors.dangerSoft} /></View>
              }
              <Text style={[styles.sheetRowLabel, styles.sheetRowLabelDanger]}>Delete Account</Text>
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
            <Text style={styles.switchSubtitle}>First switch signs in once — after that it&apos;s instant</Text>

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
                    ? <ActivityIndicator color={colors.btnText} size="small" />
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

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  listContent: { paddingBottom: 40 },

  header: { paddingBottom: 8 },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8,
  },
  screenTitle: { fontSize: 24, fontWeight: 'bold', color: colors.text },
  menuBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  menuBtnText: { fontSize: 26, color: colors.text, fontWeight: '300' },

  avatarSection: { alignItems: 'center', paddingVertical: 24, gap: 8 },
  avatarWrapper: { position: 'relative' },
  avatar: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: colors.cardAlt, borderWidth: 1, borderColor: colors.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarImage: { width: 80, height: 80, borderRadius: 40, borderWidth: 1, borderColor: colors.borderStrong },
  avatarInitial: { fontSize: 32, fontWeight: '700', color: colors.text },
  avatarEditBadge: {
    position: 'absolute', bottom: 0, right: 0,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: colors.btn, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: colors.bg,
  },
  avatarEditIcon: { fontSize: 13, color: colors.btnText, fontWeight: '600' },
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
  scoreDivider: { width: 1, height: 36, backgroundColor: colors.card },

  payoutCard: {
    marginHorizontal: 20, marginBottom: 20, padding: 14, gap: 10,
    backgroundColor: colors.surface, borderRadius: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  payoutRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  payoutText: { flex: 1, fontSize: 13.5, color: colors.text, lineHeight: 19 },
  payoutBtn: {
    height: 42, borderRadius: 10, backgroundColor: colors.btn,
    alignItems: 'center', justifyContent: 'center',
  },
  payoutBtnDisabled: { opacity: 0.6 },
  payoutBtnText: { color: colors.btnText, fontSize: 14, fontWeight: '700' },
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

  empty: { alignItems: 'center', paddingTop: 40, gap: 8 },
  emptyIcon: { fontSize: 40 },
  emptyText: { fontSize: 15, color: colors.textFaint },

  // Bottom sheet
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12, gap: 4,
  },
  sheetHandle: { width: 40, height: 4, backgroundColor: colors.cardAlt, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },

  sheetRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  sheetRowDanger: { borderBottomWidth: 0, marginTop: 8 },
  sheetRowIcon: { width: 28, alignItems: 'center', justifyContent: 'center' },
  sheetRowLabel: { flex: 1, fontSize: 16, color: colors.text, fontWeight: '500' },
  sheetRowLabelDanger: { color: colors.dangerSoft },
  sheetRowArrow: { fontSize: 20, color: colors.textFaint },

  // Switch user
  switchTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 2 },
  switchSubtitle: { fontSize: 13, color: colors.textFaint, marginBottom: 12 },
  accountBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14,
    borderWidth: 1, borderColor: colors.border, minHeight: 56, justifyContent: 'center',
    marginBottom: 8,
  },
  accountBtnActive: { borderColor: colors.success, backgroundColor: colors.successBg },
  accountAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center',
  },
  accountAvatarActive: { backgroundColor: colors.success },
  accountAvatarText: { fontSize: 16, fontWeight: '700', color: colors.text },
  accountLabel: { fontSize: 16, fontWeight: '600', color: colors.text },
  accountEmail: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
  activeDot: { fontSize: 12, color: colors.success, fontWeight: '600' },
  cancelBtn: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  cancelText: { color: colors.text, fontSize: 15 },
});
