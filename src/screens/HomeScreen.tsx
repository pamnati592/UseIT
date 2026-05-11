import { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  TextInput, Dimensions, PanResponder, Animated, Modal, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { HomeStackParamList } from '../navigation/HomeStackNavigator';
import type { Item } from '../types/item';
import { supabase } from '../services/supabase';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.3;
// Explicit card width so child Image doesn't inherit a bad percentage inside Animated.View + maxWidth
const CARD_WIDTH = Math.min(SCREEN_WIDTH - 32, 320); // 32 = 16px feed padding each side

const CATEGORY_EMOJI: Record<string, string> = {
  photography: '📷',
  gaming: '🎮',
  camping: '⛺',
  diy: '🔧',
  music: '🎸',
  sports: '⚽',
};

type Props = {
  navigation: NativeStackNavigationProp<HomeStackParamList, 'HomeMain'>;
};

export default function HomeScreen({ navigation }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [actionPanel, setActionPanel] = useState(false);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const position = useRef(new Animated.ValueXY()).current;

  const itemsRef = useRef<Item[]>([]);
  const currentIndexRef = useRef(0);
  const navigationRef = useRef(navigation);

  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { currentIndexRef.current = currentIndex; }, [currentIndex]);
  useEffect(() => { navigationRef.current = navigation; }, [navigation]);

  useEffect(() => {
    async function fetchItems() {
      const { data: { user } } = await supabase.auth.getUser();
      const query = supabase
        .from('items')
        .select('id, owner_id, title, description, daily_price, sale_price, category, city, photos')
        .eq('verification_status', 'live')
        .eq('is_hidden', false);

      if (user) query.neq('owner_id', user.id);

      const { data, error } = await query;
      if (!error && data) setItems(data as Item[]);
      setLoading(false);
    }
    fetchItems();
  }, []);

  function resetPosition() {
    Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
  }

  function swipeOut(direction: 'left' | 'right') {
    const x = direction === 'right' ? SCREEN_WIDTH : -SCREEN_WIDTH;
    Animated.timing(position, { toValue: { x, y: 0 }, duration: 250, useNativeDriver: false }).start(() => {
      position.setValue({ x: 0, y: 0 });
      if (direction === 'right') {
        const len = itemsRef.current.length;
        const item = len > 0 ? itemsRef.current[currentIndexRef.current % len] : null;
        setSelectedItem(item);
        setActionPanel(true);
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

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ActivityIndicator color="#fff" style={{ flex: 1 }} />
      </SafeAreaView>
    );
  }

  if (items.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No items available</Text>
          <Text style={styles.emptySubtext}>Check back later</Text>
        </View>
      </SafeAreaView>
    );
  }

  const len = items.length;
  const currentItem = items[currentIndex % len];
  const nextItem = len > 1 ? items[(currentIndex + 1) % len] : undefined;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        <TextInput style={styles.searchInput} placeholder="Search..." placeholderTextColor="#888" />
        <TouchableOpacity style={styles.filterButton}>
          <Text style={styles.filterIcon}>⚙️</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.feed}>
        {nextItem && (
          <View style={[styles.card, styles.backCard]}>
            <CardImage key={nextItem.id} item={nextItem} />
          </View>
        )}

        <Animated.View
          style={[styles.card, { transform: [...position.getTranslateTransform(), { rotate }] }]}
          {...panResponder.panHandlers}
        >
          <CardImage key={currentItem.id} item={currentItem} />
          <View style={styles.cardContent}>
            <Text style={styles.itemTitle}>{currentItem.title}</Text>
            <Text style={styles.itemSubtitle} numberOfLines={2}>{currentItem.description}</Text>
            <Text style={styles.itemPrice}>₪{currentItem.daily_price}/day</Text>
            {currentItem.city && <Text style={styles.itemDistance}>📍 {currentItem.city}</Text>}
          </View>
          <View style={styles.swipeButtons}>
            <TouchableOpacity style={styles.swipeBtn} onPress={() => swipeOut('left')}>
              <Text style={styles.swipeBtnText}>✕</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.swipeBtn} onPress={() => swipeOut('right')}>
              <Text style={styles.swipeBtnText}>♥</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>

      <Modal visible={actionPanel} transparent animationType="slide">
        <View style={styles.overlay}>
          <View style={styles.bottomSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{selectedItem?.title}</Text>

            <TouchableOpacity
              style={styles.sheetButton}
              onPress={() => {
                setActionPanel(false);
                if (selectedItem) navigationRef.current.navigate('ItemDetail', { item: selectedItem });
              }}
            >
              <Text style={styles.sheetButtonText}>📋 View Details</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sheetButton}
              onPress={() => {
                setActionPanel(false);
                if (selectedItem) navigationRef.current.navigate('ItemDetail', { item: selectedItem, openRent: true });
              }}
            >
              <Text style={styles.sheetButtonText}>🏷️ Rent</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetButton} onPress={() => setActionPanel(false)}>
              <Text style={styles.sheetButtonText}>🛒 Purchase</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.sheetButton}
              onPress={async () => {
                setActionPanel(false);
                if (!selectedItem) return;
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) return;
                await supabase.from('wishlist').upsert({ user_id: user.id, item_id: selectedItem.id });
              }}
            >
              <Text style={styles.sheetButtonText}>❤️ Add to Wishlist</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.sheetCancelButton} onPress={() => setActionPanel(false)}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function CardImage({ item }: { item: Item }) {
  const [failed, setFailed] = useState(false);
  const mainPhoto = item.photos?.filter(Boolean)[0];

  if (mainPhoto && !failed) {
    return (
      <Image
        source={{ uri: mainPhoto }}
        style={styles.cardPhoto}
        resizeMode="cover"
        onLoad={() => console.log('[Card] image loaded')}
        onError={() => { console.warn('[Card] image error'); setFailed(true); }}
      />
    );
  }
  return (
    <View style={styles.cardPhotoFallback}>
      <Text style={styles.itemEmoji}>{CATEGORY_EMOJI[item.category] ?? '📦'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a1a' },
  topBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#242424', borderBottomWidth: 1, borderBottomColor: '#333', gap: 8,
  },
  searchInput: {
    flex: 1, height: 40, backgroundColor: '#2a2a2a',
    borderWidth: 1, borderColor: '#3a3a3a', borderRadius: 8,
    paddingHorizontal: 12, color: '#fff', fontSize: 14,
  },
  filterButton: {
    width: 40, height: 40, backgroundColor: '#2a2a2a',
    borderWidth: 1, borderColor: '#3a3a3a', borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  filterIcon: { fontSize: 18 },
  feed: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
  card: {
    width: CARD_WIDTH, height: 460,
    backgroundColor: '#2a2a2a', borderRadius: 16,
    borderWidth: 2, borderColor: '#3a3a3a', overflow: 'hidden',
  },
  backCard: { position: 'absolute', transform: [{ scale: 0.95 }], opacity: 0.5 },
  cardPhoto: {
    width: CARD_WIDTH,
    height: 220,
    borderBottomWidth: 1, borderBottomColor: '#3a3a3a',
  },
  cardPhotoFallback: {
    width: CARD_WIDTH,
    height: 220,
    backgroundColor: '#333',
    alignItems: 'center', justifyContent: 'center',
    borderBottomWidth: 1, borderBottomColor: '#3a3a3a',
  },
  itemEmoji: { fontSize: 64 },
  cardContent: { padding: 16, gap: 4 },
  itemTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  itemSubtitle: { fontSize: 14, color: '#888' },
  itemPrice: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginTop: 8 },
  itemDistance: { fontSize: 13, color: '#888' },
  swipeButtons: {
    position: 'absolute', bottom: 16, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 24,
  },
  swipeBtn: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#242424', borderWidth: 2, borderColor: '#3a3a3a',
    alignItems: 'center', justifyContent: 'center',
  },
  swipeBtnText: { fontSize: 22, color: '#fff' },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyText: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  emptySubtext: { fontSize: 14, color: '#666' },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  bottomSheet: {
    backgroundColor: '#242424', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, gap: 12,
  },
  sheetHandle: { width: 40, height: 4, backgroundColor: '#444', borderRadius: 2, alignSelf: 'center', marginBottom: 8 },
  sheetTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff', marginBottom: 8 },
  sheetButton: {
    height: 56, backgroundColor: '#2a2a2a',
    borderWidth: 2, borderColor: '#3a3a3a', borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  sheetButtonText: { color: '#fff', fontSize: 16, fontWeight: '500' },
  sheetCancelButton: { height: 48, alignItems: 'center', justifyContent: 'center' },
  sheetCancelText: { color: '#666', fontSize: 14 },
});
