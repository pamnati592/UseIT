import { useState, useMemo} from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, Switch, KeyboardAvoidingView,
  Platform, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../services/supabase';
import CityPicker, { type CityValue } from '../components/CityPicker';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { X } from 'lucide-react-native';

const CATEGORIES = ['photography', 'gaming', 'camping', 'diy', 'music', 'sports', 'other'];
const MAX_ITEM_PHOTOS = 6;

type PhotoAsset = {
  uri: string;      // local URI — used only for preview
  base64: string;   // raw data — used for upload (avoids Expo Go file URI restrictions)
  mimeType: string;
};

export default function AddItemScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [dailyPrice, setDailyPrice] = useState('');
  const [cityValue, setCityValue] = useState<CityValue | null>(null);
  const [pickupLocation, setPickupLocation] = useState('');
  const [forSale, setForSale] = useState(false);
  const [salePrice, setSalePrice] = useState('');
  const [verificationPhoto, setVerificationPhoto] = useState<PhotoAsset | null>(null);
  const [itemPhotos, setItemPhotos] = useState<PhotoAsset[]>([]);
  const [loading, setLoading] = useState<'pending' | 'live' | null>(null);

  async function pickFromCamera(multi = false): Promise<PhotoAsset | null> {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Camera access is needed.');
      return null;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
      exif: false,
    });
    if (result.canceled || !result.assets[0]) return null;
    const a = result.assets[0];
    return { uri: a.uri, base64: a.base64!, mimeType: a.mimeType ?? 'image/jpeg' };
  }

  async function pickFromGallery(limit: number): Promise<PhotoAsset[]> {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission required', 'Photo library access is needed.');
      return [];
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
      exif: false,
      allowsMultipleSelection: true,
      selectionLimit: limit,
    });
    if (result.canceled) return [];
    return result.assets.map((a) => ({
      uri: a.uri,
      base64: a.base64!,
      mimeType: a.mimeType ?? 'image/jpeg',
    }));
  }

  async function handleTakeVerificationPhoto() {
    const asset = await pickFromCamera();
    if (asset) setVerificationPhoto(asset);
  }

  async function handleAddFromCamera() {
    if (itemPhotos.length >= MAX_ITEM_PHOTOS) {
      Alert.alert('Limit reached', `You can add up to ${MAX_ITEM_PHOTOS} photos.`);
      return;
    }
    const asset = await pickFromCamera();
    if (asset) setItemPhotos((prev) => [...prev, asset]);
  }

  async function handleAddFromGallery() {
    const remaining = MAX_ITEM_PHOTOS - itemPhotos.length;
    if (remaining <= 0) {
      Alert.alert('Limit reached', `You can add up to ${MAX_ITEM_PHOTOS} photos.`);
      return;
    }
    const assets = await pickFromGallery(remaining);
    if (assets.length > 0) {
      setItemPhotos((prev) => [...prev, ...assets].slice(0, MAX_ITEM_PHOTOS));
    }
  }

  // Converts base64 → Uint8Array and uploads via Supabase SDK.
  // Avoids fetch/XHR which both return 0-byte blobs for Expo Go file URIs on iOS.
  async function uploadPhotoAsset(asset: PhotoAsset, storagePath: string): Promise<string> {
    const mimeType = asset.mimeType;
    const ext = mimeType === 'image/jpeg' ? 'jpg' : (mimeType.split('/')[1] ?? 'jpg');
    const fileName = `${storagePath}.${ext}`;

    const binary = atob(asset.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const { error } = await supabase.storage
      .from('item-images')
      .upload(fileName, bytes, { contentType: mimeType });

    if (error) throw error;

    return supabase.storage.from('item-images').getPublicUrl(fileName).data.publicUrl;
  }

  async function handleSubmit(status: 'pending' | 'live') {
    const missing = [
      !title.trim() && 'Title',
      !category && 'Category',
      !description.trim() && 'Description',
      !dailyPrice && 'Daily Price',
      !cityValue && 'City',
    ].filter(Boolean);

    if (missing.length > 0) {
      Alert.alert('Missing fields', `Please fill in: ${missing.join(', ')}`);
      return;
    }

    try {
      setLoading(status);
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error('Not authenticated');

      const ts = Date.now();

      const verificationUrl = verificationPhoto
        ? await uploadPhotoAsset(verificationPhoto, `${user.id}/verification-${ts}`)
        : null;

      const photoUrls: string[] = [];
      for (let i = 0; i < itemPhotos.length; i++) {
        const url = await uploadPhotoAsset(itemPhotos[i], `${user.id}/item-${ts}-${i}`);
        photoUrls.push(url);
      }

      // Item location comes from the user's CityPicker selection — explicit and
      // verifiable, unlike device GPS which could be anywhere when listing.
      const { error } = await supabase.from('items').insert({
        owner_id: user.id,
        title: title.trim(),
        category,
        description: description.trim(),
        daily_price: parseFloat(dailyPrice),
        sale_price: forSale && salePrice ? parseFloat(salePrice) : null,
        city: cityValue!.city,
        verification_status: status,
        verification_image_url: verificationUrl,
        photos: photoUrls,
        location: `POINT(${cityValue!.lng} ${cityValue!.lat})`,
        pickup_location: pickupLocation.trim() || null,
      });

      if (error) throw error;

      Alert.alert(
        status === 'live' ? 'Item listed!' : 'Item submitted',
        status === 'live'
          ? 'Your item is now live in the feed.'
          : 'Your item is pending review.',
      );
      setTitle(''); setCategory(''); setDescription('');
      setDailyPrice(''); setCityValue(null); setPickupLocation('');
      setForSale(false); setSalePrice('');
      setVerificationPhoto(null); setItemPhotos([]);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? JSON.stringify(e));
    } finally {
      setLoading(null);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={styles.heading}>List an Item</Text>

          <Text style={styles.label}>Title *</Text>
          <TextInput style={styles.input} placeholder="e.g. Canon EOS R5" placeholderTextColor={colors.textFaint} value={title} onChangeText={setTitle} />

          <Text style={styles.label}>Category *</Text>
          <View style={styles.categoryRow}>
            {CATEGORIES.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[styles.categoryChip, category === cat && styles.categoryChipActive]}
                onPress={() => setCategory(cat)}
              >
                <Text style={[styles.categoryChipText, category === cat && styles.categoryChipTextActive]}>{cat}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Description *</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            placeholder="Describe your item, condition, what's included..."
            placeholderTextColor={colors.textFaint}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
          />

          <Text style={styles.label}>Daily Price (NIS) *</Text>
          <TextInput style={styles.input} placeholder="0.00" placeholderTextColor={colors.textFaint} value={dailyPrice} onChangeText={setDailyPrice} keyboardType="decimal-pad" />

          <Text style={styles.label}>City *</Text>
          <CityPicker value={cityValue} onChange={setCityValue} placeholder="Choose city" />

          <Text style={styles.label}>Pickup location (optional)</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. Dizengoff Square, near the fountain"
            placeholderTextColor={colors.textFaint}
            value={pickupLocation}
            onChangeText={setPickupLocation}
          />

          <View style={styles.toggleRow}>
            <Text style={styles.label}>Also available for sale</Text>
            <Switch value={forSale} onValueChange={setForSale} trackColor={{ false: colors.border, true: colors.primary }} thumbColor={colors.white} />
          </View>

          {forSale && (
            <>
              <Text style={styles.label}>Sale Price (NIS)</Text>
              <TextInput style={styles.input} placeholder="0.00" placeholderTextColor={colors.textFaint} value={salePrice} onChangeText={setSalePrice} keyboardType="decimal-pad" />
            </>
          )}

          {/* ── Item Photos ─────────────────────────────────────── */}
          <Text style={styles.sectionHeading}>Item Photos</Text>
          <Text style={styles.sectionHint}>Shown on the card and detail page. Up to {MAX_ITEM_PHOTOS} photos.</Text>

          <View style={styles.photoButtonRow}>
            <TouchableOpacity style={styles.photoBtn} onPress={handleAddFromCamera} disabled={loading !== null}>
              <Text style={styles.photoBtnText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoBtn} onPress={handleAddFromGallery} disabled={loading !== null}>
              <Text style={styles.photoBtnText}>Gallery</Text>
            </TouchableOpacity>
          </View>

          {itemPhotos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbScroll} contentContainerStyle={{ gap: 8 }}>
              {itemPhotos.map((asset, index) => (
                <View key={asset.uri + index} style={styles.thumbContainer}>
                  <Image source={{ uri: asset.uri }} style={styles.thumb} resizeMode="cover" />
                  <TouchableOpacity style={styles.thumbRemove} onPress={() => setItemPhotos((prev) => prev.filter((_, i) => i !== index))}>
                    <X size={14} color={colors.white} strokeWidth={2.5} />
                  </TouchableOpacity>
                  {index === 0 && (
                    <View style={styles.thumbMainBadge}>
                      <Text style={styles.thumbMainBadgeText}>Main</Text>
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>
          )}

          {/* ── Verification Photo ──────────────────────────────── */}
          <Text style={styles.sectionHeading}>Verification Photo</Text>
          <Text style={styles.sectionHint}>Camera only. Used for admin verification — not shown to other users.</Text>

          <TouchableOpacity style={styles.cameraButton} onPress={handleTakeVerificationPhoto} disabled={loading !== null}>
            <Text style={styles.cameraButtonText}>{verificationPhoto ? 'Retake Verification Photo' : 'Take Verification Photo'}</Text>
          </TouchableOpacity>

          {verificationPhoto && (
            <Image source={{ uri: verificationPhoto.uri }} style={styles.verificationPreview} resizeMode="cover" />
          )}

          <TouchableOpacity style={[styles.button, styles.buttonDisabled]} disabled>
            {loading === 'pending' ? <ActivityIndicator color={colors.btnText} /> : <Text style={styles.buttonText}>Submit for Review</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={[styles.buttonDev, loading !== null && styles.buttonDisabled]} onPress={() => handleSubmit('live')} disabled={loading !== null}>
            {loading === 'live' ? <ActivityIndicator color={colors.warning} /> : <Text style={styles.buttonDevText}>Go Live (Testing Only)</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 24, gap: 8, paddingBottom: 48 },
  heading: { fontSize: 22, fontWeight: 'bold', color: colors.text, marginBottom: 16 },
  label: { fontSize: 13, color: colors.textMuted, marginTop: 12, marginBottom: 4 },
  sectionHeading: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 24, marginBottom: 2 },
  sectionHint: { fontSize: 12, color: colors.textFaint, marginBottom: 8 },
  input: {
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12,
    color: colors.text, fontSize: 15,
  },
  textArea: { height: 100, textAlignVertical: 'top' },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  categoryChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  categoryChipActive: { backgroundColor: colors.btn, borderColor: colors.btn },
  categoryChipText: { color: colors.textMuted, fontSize: 13 },
  categoryChipTextActive: { color: colors.btnText, fontWeight: '600' },
  toggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  photoButtonRow: { flexDirection: 'row', gap: 10 },
  photoBtn: { flex: 1, height: 44, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  photoBtnText: { color: colors.text, fontSize: 14, fontWeight: '500' },
  thumbScroll: { marginTop: 12 },
  thumbContainer: { width: 80, height: 80, borderRadius: 8, overflow: 'hidden' },
  thumb: { width: 80, height: 80 },
  thumbRemove: { position: 'absolute', top: 4, right: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.overlayStrong, alignItems: 'center', justifyContent: 'center' },
  thumbRemoveText: { color: colors.text, fontSize: 10, fontWeight: '700' },
  thumbMainBadge: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(255,255,255,0.85)', alignItems: 'center' },
  thumbMainBadgeText: { fontSize: 10, fontWeight: '700', color: colors.btnText },
  cameraButton: { height: 48, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  cameraButtonText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  verificationPreview: { width: '100%', height: 160, borderRadius: 8, marginTop: 8, borderWidth: 1, borderColor: colors.border },
  button: { marginTop: 28, height: 52, backgroundColor: colors.btn, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: colors.btnText, fontSize: 16, fontWeight: '700' },
  buttonDev: { height: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.warning, alignItems: 'center', justifyContent: 'center' },
  buttonDevText: { color: colors.warning, fontSize: 14, fontWeight: '600' },
});
