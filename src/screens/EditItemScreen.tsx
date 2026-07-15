import { useState, useEffect, useMemo} from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  ScrollView, ActivityIndicator, Alert, Switch, KeyboardAvoidingView,
  Platform, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../services/supabase';
import CityPicker, { type CityValue } from '../components/CityPicker';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { X } from 'lucide-react-native';

const CATEGORIES = ['photography', 'gaming', 'camping', 'diy', 'music', 'sports', 'other'];
const MAX_ITEM_PHOTOS = 6;

type ExistingPhoto = { kind: 'existing'; url: string };
type NewPhoto = { kind: 'new'; uri: string; base64: string; mimeType: string };
type PhotoEntry = ExistingPhoto | NewPhoto;

type Props = NativeStackScreenProps<ProfileStackParamList, 'EditItem'>;

export default function EditItemScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { itemId } = route.params;

  const [loadingItem, setLoadingItem] = useState(true);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [dailyPrice, setDailyPrice] = useState('');
  const [cityValue, setCityValue] = useState<CityValue | null>(null);
  // Legacy city text from the row before the user picks a new one — shown in
  // the CityPicker field so an edit without changing city is still meaningful.
  const [legacyCityText, setLegacyCityText] = useState<string>('');
  const [pickupLocation, setPickupLocation] = useState('');
  const [forSale, setForSale] = useState(false);
  const [salePrice, setSalePrice] = useState('');
  const [photos, setPhotos] = useState<PhotoEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    async function loadItem() {
      const { data, error } = await supabase
        .from('items')
        .select('title, category, description, daily_price, sale_price, city, photos, location, pickup_location')
        .eq('id', itemId)
        .single();

      if (error || !data) {
        Alert.alert('Error', 'Could not load item');
        navigation.goBack();
        return;
      }

      setTitle(data.title ?? '');
      setCategory(data.category ?? '');
      setDescription(data.description ?? '');
      setDailyPrice(String(data.daily_price ?? ''));
      setLegacyCityText(data.city ?? '');
      setPickupLocation((data as any).pickup_location ?? '');
      setForSale(data.sale_price != null);
      setSalePrice(data.sale_price != null ? String(data.sale_price) : '');
      setPhotos((data.photos ?? []).filter(Boolean).map((url: string) => ({ kind: 'existing', url })));
      setLoadingItem(false);
    }
    loadItem();
  }, [itemId]);

  async function pickFromGallery() {
    const remaining = MAX_ITEM_PHOTOS - photos.length;
    if (remaining <= 0) { Alert.alert('Limit reached', `Max ${MAX_ITEM_PHOTOS} photos.`); return; }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission required', 'Photo library access is needed.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7, base64: true, exif: false,
      allowsMultipleSelection: true, selectionLimit: remaining,
    });
    if (result.canceled) return;
    const newEntries: NewPhoto[] = result.assets.map(a => ({
      kind: 'new', uri: a.uri, base64: a.base64!, mimeType: a.mimeType ?? 'image/jpeg',
    }));
    setPhotos(prev => [...prev, ...newEntries].slice(0, MAX_ITEM_PHOTOS));
  }

  async function pickFromCamera() {
    if (photos.length >= MAX_ITEM_PHOTOS) { Alert.alert('Limit reached', `Max ${MAX_ITEM_PHOTOS} photos.`); return; }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission required', 'Camera access is needed.'); return; }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7, base64: true, exif: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const a = result.assets[0];
    setPhotos(prev => [...prev, { kind: 'new', uri: a.uri, base64: a.base64!, mimeType: a.mimeType ?? 'image/jpeg' }]);
  }

  async function uploadNewPhoto(photo: NewPhoto, path: string): Promise<string> {
    const ext = photo.mimeType === 'image/jpeg' ? 'jpg' : (photo.mimeType.split('/')[1] ?? 'jpg');
    const fileName = `${path}.${ext}`;
    const binary = atob(photo.base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const { error } = await supabase.storage.from('item-images').upload(fileName, bytes, { contentType: photo.mimeType });
    if (error) throw error;
    return supabase.storage.from('item-images').getPublicUrl(fileName).data.publicUrl;
  }

  async function handleSave() {
    const missing = [
      !title.trim() && 'Title',
      !category && 'Category',
      !description.trim() && 'Description',
      !dailyPrice && 'Daily Price',
      !cityValue && !legacyCityText && 'City',
    ].filter(Boolean);
    if (missing.length > 0) { Alert.alert('Missing fields', `Please fill in: ${missing.join(', ')}`); return; }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const ts = Date.now();
      const finalPhotos: string[] = [];
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        if (p.kind === 'existing') {
          finalPhotos.push(p.url);
        } else {
          const url = await uploadNewPhoto(p, `${user.id}/item-${ts}-${i}`);
          finalPhotos.push(url);
        }
      }

      // Only overwrite city + location when the user actively picks a new one.
      // Editing just the description from a different physical place must not
      // silently change the item's stored location.
      const updatePayload: Record<string, unknown> = {
        title: title.trim(),
        category,
        description: description.trim(),
        daily_price: parseFloat(dailyPrice),
        sale_price: forSale && salePrice ? parseFloat(salePrice) : null,
        photos: finalPhotos,
        pickup_location: pickupLocation.trim() || null,
      };
      if (cityValue) {
        updatePayload.city = cityValue.city;
        updatePayload.location = `POINT(${cityValue.lng} ${cityValue.lat})`;
      }

      const { error } = await supabase.from('items').update(updatePayload).eq('id', itemId);

      if (error) throw error;
      Alert.alert('Saved', 'Your item has been updated.', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save item');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    Alert.alert(
      'Delete item',
      'Are you sure you want to delete this item? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              const { data: activeTx } = await supabase
                .from('transactions')
                .select('id')
                .eq('item_id', itemId)
                .in('status', ['pending', 'approved', 'active'])
                .limit(1);

              if (activeTx && activeTx.length > 0) {
                Alert.alert(
                  "Can't delete",
                  'This item has active or pending rentals. Wait for them to complete before deleting.',
                );
                return;
              }

              const { error } = await supabase.from('items').delete().eq('id', itemId);
              if (error) throw error;
              navigation.goBack();
            } catch (e: any) {
              Alert.alert('Error', e?.message ?? 'Could not delete item');
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  }

  if (loadingItem) {
    return <SafeAreaView style={styles.container}><ActivityIndicator color={colors.text} style={{ flex: 1 }} /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          <View style={styles.header}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
              <Text style={styles.backArrow}>‹</Text>
            </TouchableOpacity>
            <Text style={styles.heading}>Edit Item</Text>
          </View>

          <Text style={styles.label}>Title *</Text>
          <TextInput style={styles.input} placeholderTextColor={colors.textFaint} value={title} onChangeText={setTitle} />

          <Text style={styles.label}>Category *</Text>
          <View style={styles.categoryRow}>
            {CATEGORIES.map(cat => (
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
            placeholderTextColor={colors.textFaint}
            value={description}
            onChangeText={setDescription}
            multiline numberOfLines={4}
          />

          <Text style={styles.label}>Daily Price (NIS) *</Text>
          <TextInput style={styles.input} placeholderTextColor={colors.textFaint} value={dailyPrice} onChangeText={setDailyPrice} keyboardType="decimal-pad" />

          <Text style={styles.label}>City *</Text>
          <CityPicker
            value={cityValue}
            onChange={setCityValue}
            initialDisplayText={legacyCityText}
            placeholder="Choose city"
          />

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
              <TextInput style={styles.input} placeholderTextColor={colors.textFaint} value={salePrice} onChangeText={setSalePrice} keyboardType="decimal-pad" />
            </>
          )}

          <Text style={styles.sectionHeading}>Item Photos</Text>
          <Text style={styles.sectionHint}>First photo is the card cover. Up to {MAX_ITEM_PHOTOS} photos.</Text>

          <View style={styles.photoButtonRow}>
            <TouchableOpacity style={styles.photoBtn} onPress={pickFromCamera} disabled={saving}>
              <Text style={styles.photoBtnText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.photoBtn} onPress={pickFromGallery} disabled={saving}>
              <Text style={styles.photoBtnText}>Gallery</Text>
            </TouchableOpacity>
          </View>

          {photos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbScroll} contentContainerStyle={{ gap: 8 }}>
              {photos.map((p, index) => {
                const uri = p.kind === 'existing' ? p.url : p.uri;
                return (
                  <View key={uri + index} style={styles.thumbContainer}>
                    <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
                    <TouchableOpacity style={styles.thumbRemove} onPress={() => setPhotos(prev => prev.filter((_, i) => i !== index))}>
                      <X size={14} color={colors.white} strokeWidth={2.5} />
                    </TouchableOpacity>
                    {index === 0 && (
                      <View style={styles.thumbMainBadge}>
                        <Text style={styles.thumbMainBadgeText}>Cover</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}

          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.btnDisabled]}
            onPress={handleSave}
            disabled={saving || deleting}
          >
            {saving
              ? <ActivityIndicator color={colors.btnText} />
              : <Text style={styles.saveBtnText}>Save Changes</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.deleteBtn, deleting && styles.btnDisabled]}
            onPress={handleDelete}
            disabled={saving || deleting}
          >
            {deleting
              ? <ActivityIndicator color={colors.dangerSoft} />
              : <Text style={styles.deleteBtnText}>Delete Item</Text>
            }
          </TouchableOpacity>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 24, gap: 8, paddingBottom: 48 },

  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  backBtn: { width: 32 },
  backArrow: { fontSize: 28, color: colors.text, fontWeight: '300', lineHeight: 32 },
  heading: { fontSize: 22, fontWeight: 'bold', color: colors.text },

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

  saveBtn: { marginTop: 32, height: 52, backgroundColor: colors.btn, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: colors.btnText, fontSize: 16, fontWeight: '700' },
  deleteBtn: { marginTop: 12, height: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.danger, alignItems: 'center', justifyContent: 'center' },
  deleteBtnText: { color: colors.dangerSoft, fontSize: 15, fontWeight: '600' },
  btnDisabled: { opacity: 0.5 },
});
