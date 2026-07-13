import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  TextInput, Dimensions, PanResponder, Animated, ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { HomeStackParamList } from '../navigation/HomeStackNavigator';
import type { Item } from '../types/item';
import { supabase } from '../services/supabase';
import { useUserLocation } from '../hooks/useUserLocation';
import { formatDistance } from '../utils/format';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { CategoryIcon } from '../components/CategoryIcon';
import { MapPin, X, Heart, Leaf } from 'lucide-react-native';
import { getImpactScore } from '../utils/format';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.3;
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 32, 320);

// Radius slider
const THUMB_D = 26;
const SLIDER_TRACK_W = SCREEN_WIDTH - 32; // 16px padding each side
const SLIDER_RANGE = SLIDER_TRACK_W - THUMB_D;
const RADIUS_MIN_KM = 1;
const RADIUS_MAX_KM = 100;
const DEFAULT_RADIUS_KM = 25;

// Log scale: 10 km sits at exactly 50% of the track, giving more room to small distances.
function posToKm(pos: number): number {
  const t = pos / SLIDER_RANGE;
  return Math.round(RADIUS_MIN_KM * Math.pow(RADIUS_MAX_KM / RADIUS_MIN_KM, t));
}
function kmToPos(km: number): number {
  const t = Math.log(Math.max(1, km) / RADIUS_MIN_KM) / Math.log(RADIUS_MAX_KM / RADIUS_MIN_KM);
  return Math.max(0, Math.min(SLIDER_RANGE, t * SLIDER_RANGE));
}

type Props = {
  navigation: NativeStackNavigationProp<HomeStackParamList, 'HomeMain'>;
};

export default function HomeScreen({ navigation }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [radiusKm, setRadiusKm] = useState<number>(DEFAULT_RADIUS_KM);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const position = useRef(new Animated.ValueXY()).current;

  const { coords, status: locStatus } = useUserLocation();

  const itemsRef = useRef<Item[]>([]);
  const currentIndexRef = useRef(0);
  const navigationRef = useRef(navigation);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (selectedCategory && it.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        it.title.toLowerCase().includes(q)
        || (it.description?.toLowerCase().includes(q) ?? false)
        || it.category.toLowerCase().includes(q)
      );
    });
  }, [items, query, selectedCategory]);

  useEffect(() => { itemsRef.current = filteredItems; }, [filteredItems]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { navigationRef.current = navigation; }, [navigation]);
  useEffect(() => { setCurrentIndex(0); }, [query, selectedCategory]);

  // Snap the deck back to center in the same frame the promoted card renders,
  // so neither the old card (at center) nor the new card (off-screen) is ever
  // painted in a stale position.
  useLayoutEffect(() => {
    position.setValue({ x: 0, y: 0 });
  }, [currentIndex]);

  useEffect(() => {
    if (locStatus === 'idle' || locStatus === 'requesting') return;

    let cancelled = false;
    setLoading(true);
    async function fetchItems() {
      const { data, error } = await supabase.rpc('get_feed', {
        p_lat: coords?.latitude ?? null,
        p_lng: coords?.longitude ?? null,
        p_radius_km: radiusKm >= RADIUS_MAX_KM ? null : radiusKm,
      });
      if (cancelled) return;
      if (!error && data) {
        setItems(data as Item[]);
        setCurrentIndex(0);
      }
      setLoading(false);
    }
    fetchItems();
    return () => { cancelled = true; };
  }, [coords?.latitude, coords?.longitude, locStatus, radiusKm]);

  function resetPosition() {
    Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
  }

  function swipeOut(direction: 'left' | 'right') {
    const x = direction === 'right' ? SCREEN_WIDTH : -SCREEN_WIDTH;
    Animated.timing(position, { toValue: { x, y: 0 }, duration: 250, useNativeDriver: false }).start(() => {
      if (direction === 'right') {
        const len = itemsRef.current.length;
        const item = len > 0 ? itemsRef.current[currentIndexRef.current % len] : null;
        if (item) navigationRef.current.navigate('ItemDetail', { item });
      }
      setCurrentIndex((prev) => prev + 1);
    });
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderMove: (_, gesture) => {
        position.setValue({ x: gesture.dx, y: gesture.dy / 4 });
      },
      onPanResponderRelease: (_, gesture) => {
        if (Math.abs(gesture.dx) < 6 && Math.abs(gesture.dy) < 6) {
          const len = itemsRef.current.length;
          const item = len > 0 ? itemsRef.current[currentIndexRef.current % len] : null;
          if (item) navigationRef.current.navigate('ItemDetail', { item });
          return;
        }
        if (gesture.dx > SWIPE_THRESHOLD) swipeOut('right');
        else if (gesture.dx < -SWIPE_THRESHOLD) swipeOut('left');
        else resetPosition();
      },
    })
  ).current;

  const rotate = position.x.interpolate({
    inputRange: [-SCREEN_WIDTH, 0, SCREEN_WIDTH],
    outputRange: ['-15deg', '0deg', '15deg'],
  });

  // Warm the image cache for the upcoming cards so a freshly mounted back card
  // never shows a blank frame while its photo loads.
  useEffect(() => {
    filteredItems.slice(0, 6).forEach(it => {
      const photo = it.photos?.filter(Boolean)[0];
      if (photo) Image.prefetch(photo);
    });
  }, [filteredItems]);

  const len = filteredItems.length;
  const currentItem = len > 0 ? filteredItems[currentIndex % len] : null;
  const nextItem = len > 1 ? filteredItems[(currentIndex + 1) % len] : undefined;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.topBar}>
          <TextInput
            style={styles.searchInput}
            placeholder="Search by name, description, category..."
            placeholderTextColor={colors.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
        </View>

        <CategoryBar selected={selectedCategory} onSelect={setSelectedCategory} />
        <RadiusSlider value={radiusKm} onChange={setRadiusKm} />
      </View>

      {loading ? (
        <View style={styles.feed}>
          <ActivityIndicator color={colors.text} />
        </View>
      ) : currentItem === null ? (
        <View style={styles.feed}>
          <Text style={styles.emptyText}>
            {query ? 'No matches' : 'No items in this radius'}
          </Text>
          <Text style={styles.emptySubtext}>
            {query ? 'Try different search terms' : 'Try a larger radius or drag to All'}
          </Text>
        </View>
      ) : (
        <View style={styles.feed}>
          {/* Both cards are keyed siblings of the same element type, so when the
              deck advances the back card's instance BECOMES the top card — the
              image never remounts, which kills the flicker between swipes. */}
          {[
            ...(nextItem ? [{ item: nextItem, isTop: false }] : []),
            { item: currentItem, isTop: true },
          ].map(({ item, isTop }) => (
            <Animated.View
              key={item.id}
              style={[
                styles.card,
                isTop
                  ? { transform: [...position.getTranslateTransform(), { rotate }] }
                  : styles.backCard,
              ]}
              {...(isTop ? panResponder.panHandlers : undefined)}
            >
              <CardImage item={item} />

              {isTop && (
                <>
                  {/* Impact badge — top left */}
                  <View style={styles.impactBadge} pointerEvents="none">
                    <Leaf size={11} color="#fff" strokeWidth={2.5} />
                    <Text style={styles.impactBadgeText}>{getImpactScore(item.id).toFixed(1)}</Text>
                  </View>

                  {/* Distance badge — top right */}
                  {(() => {
                    const distance = formatDistance(item.distance_meters);
                    return distance ? (
                      <View style={styles.distanceBadge} pointerEvents="none">
                        <MapPin size={11} color={colors.scrimText} />
                        <Text style={styles.distanceBadgeText}>{distance}</Text>
                      </View>
                    ) : null;
                  })()}
                  <View style={styles.cardContent}>
                    <Text style={styles.itemTitle}>{item.title}</Text>
                    <Text style={styles.itemSubtitle} numberOfLines={2}>{item.description}</Text>
                    <Text style={styles.itemPrice}>₪{item.daily_price}/day</Text>
                    {item.city && (
                      <View style={styles.cityRow}>
                        <MapPin size={13} color={colors.textMuted} />
                        <Text style={styles.itemDistance}>{item.city}</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.swipeButtons}>
                    <TouchableOpacity style={styles.swipeBtn} onPress={() => swipeOut('left')}>
                      <X size={24} color={colors.textSecondary} strokeWidth={2.4} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.swipeBtn} onPress={() => swipeOut('right')}>
                      <Heart size={24} color={colors.danger} fill={colors.danger} />
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </Animated.View>
          ))}
        </View>
      )}

    </SafeAreaView>
  );
}

// ── Category Filter Bar ───────────────────────────────────────────────────────

const CATEGORIES: { key: string; label: string }[] = [
  { key: 'photography', label: 'Cameras' },
  { key: 'camping',     label: 'Camping'  },
  { key: 'diy',         label: 'DIY'      },
  { key: 'gaming',      label: 'Gaming'   },
  { key: 'sports',      label: 'Sports'   },
  { key: 'music',       label: 'Music'    },
  { key: 'biking',      label: 'Biking'   },
  { key: 'cooking',     label: 'Cooking'  },
  { key: 'art',         label: 'Art'      },
  { key: 'film',        label: 'Film'     },
];

function CategoryBar({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (cat: string | null) => void;
}) {
  const { colors } = useTheme();
  const s = useMemo(() => makeCategoryStyles(colors), [colors]);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.row}
      style={s.bar}
    >
      {/* "All" chip */}
      <TouchableOpacity
        style={[s.chip, selected === null && s.chipActive]}
        onPress={() => onSelect(null)}
        activeOpacity={0.75}
      >
        <Text style={[s.chipLabel, selected === null && s.chipLabelActive]}>All</Text>
      </TouchableOpacity>

      {CATEGORIES.map(({ key, label }) => {
        const active = selected === key;
        return (
          <TouchableOpacity
            key={key}
            style={[s.chip, active && s.chipActive]}
            onPress={() => onSelect(active ? null : key)}
            activeOpacity={0.75}
          >
            <CategoryIcon category={key} size={14} color={active ? colors.btnText : colors.textMuted} strokeWidth={2.2} />
            <Text style={[s.chipLabel, active && s.chipLabelActive]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const makeCategoryStyles = (c: ThemeColors) => StyleSheet.create({
  bar: {
    backgroundColor: c.surface,
    borderBottomWidth: 1, borderBottomColor: c.border,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 10, gap: 8,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: c.card,
    borderWidth: 1, borderColor: c.border,
  },
  chipActive: {
    backgroundColor: c.btn,
    borderColor: c.btn,
  },
  chipLabel: { fontSize: 13, fontWeight: '500', color: c.textMuted },
  chipLabelActive: { color: c.btnText, fontWeight: '700' },
});

// ── Radius Slider ─────────────────────────────────────────────────────────────

function RadiusSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const { colors } = useTheme();
  const sliderStyles = useMemo(() => makeSliderStyles(colors), [colors]);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  useEffect(() => { valueRef.current = value; }, [value]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const thumbAnim = useRef(new Animated.Value(kmToPos(value))).current;
  const [liveKm, setLiveKm] = useState(value);
  const startPos = useRef(0);

  useEffect(() => {
    thumbAnim.setValue(kmToPos(value));
    setLiveKm(value);
  }, [value]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startPos.current = kmToPos(valueRef.current);
      },
      onPanResponderMove: (_, g) => {
        const pos = Math.max(0, Math.min(SLIDER_RANGE, startPos.current + g.dx));
        thumbAnim.setValue(pos);
        setLiveKm(posToKm(pos));
      },
      onPanResponderRelease: (_, g) => {
        const pos = Math.max(0, Math.min(SLIDER_RANGE, startPos.current + g.dx));
        const km = posToKm(pos);
        thumbAnim.setValue(pos);
        setLiveKm(km);
        onChangeRef.current(km);
      },
    })
  ).current;

  const label = liveKm >= RADIUS_MAX_KM ? 'All' : `${liveKm} km`;

  return (
    <View style={sliderStyles.wrapper}>
      <View style={sliderStyles.header}>
        <Text style={sliderStyles.headerKey}>Radius</Text>
        <Text style={sliderStyles.headerVal}>{label}</Text>
      </View>
      <View style={sliderStyles.trackWrap}>
        <View style={sliderStyles.trackBg} />
        <Animated.View style={[sliderStyles.trackFill, { width: thumbAnim }]} />
        <Animated.View
          {...pan.panHandlers}
          style={[sliderStyles.thumb, { left: thumbAnim }]}
        />
      </View>
      <View style={sliderStyles.endLabels}>
        <Text style={sliderStyles.endLabel}>1 km</Text>
        <Text style={sliderStyles.endLabel}>∞ All</Text>
      </View>
    </View>
  );
}

// ── Card image with category-icon fallback ────────────────────────────────────

function CardImage({ item }: { item: Item }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [failed, setFailed] = useState(false);
  const mainPhoto = item.photos?.filter(Boolean)[0];

  if (mainPhoto && !failed) {
    return (
      <Image
        source={{ uri: mainPhoto }}
        style={styles.cardPhoto}
        resizeMode="cover"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <View style={styles.cardPhotoFallback}>
      <CategoryIcon category={item.category} size={72} color={colors.textMuted} strokeWidth={1.5} />
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bg },
  header: { flexShrink: 0 },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: c.surface, borderBottomWidth: 1, borderBottomColor: c.border,
  },
  searchInput: {
    flex: 1, height: 40, backgroundColor: c.card,
    borderWidth: 1, borderColor: c.border, borderRadius: 8,
    paddingHorizontal: 12, color: c.text, fontSize: 14,
  },
  feed: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 20, paddingHorizontal: 16 },
  card: {
    width: CARD_WIDTH, height: 400,
    backgroundColor: c.card, borderRadius: 16,
    borderWidth: 2, borderColor: c.border, overflow: 'hidden',
  },
  // The next card stays mounted (image pre-rendered, no flicker on promotion)
  // but fully invisible — only the current card is ever shown.
  backCard: { position: 'absolute', opacity: 0 },
  cardPhoto: { width: CARD_WIDTH, height: 190, borderBottomWidth: 1, borderBottomColor: c.border },
  cardPhotoFallback: {
    width: CARD_WIDTH, height: 190,
    backgroundColor: c.chip, alignItems: 'center', justifyContent: 'center',
    borderBottomWidth: 1, borderBottomColor: c.border,
  },
  itemEmoji: { fontSize: 64 },
  impactBadge: {
    position: 'absolute', top: 12, left: 12,
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(22, 163, 74, 0.88)',
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999,
  },
  impactBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  distanceBadge: {
    position: 'absolute', top: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: c.overlayStrong,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  distanceBadgeText: { color: c.scrimText, fontSize: 12, fontWeight: '600' },
  cardContent: { padding: 16, gap: 4 },
  itemTitle: { fontSize: 18, fontWeight: 'bold', color: c.text },
  itemSubtitle: { fontSize: 14, color: c.textMuted },
  itemPrice: { fontSize: 20, fontWeight: 'bold', color: c.text, marginTop: 8 },
  cityRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  itemDistance: { fontSize: 13, color: c.textMuted },
  swipeButtons: {
    position: 'absolute', bottom: 16, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 24,
  },
  swipeBtn: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: c.surface, borderWidth: 2, borderColor: c.border,
    alignItems: 'center', justifyContent: 'center',
  },
  swipeBtnText: { fontSize: 22, color: c.text },
  emptyText: { fontSize: 18, fontWeight: 'bold', color: c.text },
  emptySubtext: { fontSize: 14, color: c.textFaint },
});

const makeSliderStyles = (c: ThemeColors) => StyleSheet.create({
  wrapper: {
    paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12,
    backgroundColor: c.surface,
    borderBottomWidth: 1, borderBottomColor: c.border,
  },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 10,
  },
  headerKey: { color: c.textMuted, fontSize: 12, fontWeight: '500' },
  headerVal: { color: c.text, fontSize: 13, fontWeight: '700' },
  trackWrap: {
    height: THUMB_D,
    justifyContent: 'center',
  },
  trackBg: {
    position: 'absolute',
    left: THUMB_D / 2,
    right: THUMB_D / 2,
    height: 4, borderRadius: 2,
    backgroundColor: c.textFaint,
  },
  trackFill: {
    position: 'absolute',
    left: THUMB_D / 2,
    height: 3, borderRadius: 1.5,
    backgroundColor: c.text,
  },
  thumb: {
    position: 'absolute',
    width: THUMB_D, height: THUMB_D, borderRadius: THUMB_D / 2,
    backgroundColor: c.text,
    shadowColor: c.black, shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35, shadowRadius: 4, elevation: 5,
  },
  endLabels: {
    flexDirection: 'row', justifyContent: 'space-between', marginTop: 6,
  },
  endLabel: { color: c.textFaint, fontSize: 11 },
});
