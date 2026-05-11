import { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, Image, FlatList, TouchableOpacity,
  ScrollView, Dimensions, StatusBar, Alert, ActivityIndicator, Modal,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Calendar } from 'react-native-calendars';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { HomeStackParamList } from '../navigation/HomeStackNavigator';
import { supabase } from '../services/supabase';

const SCREEN_WIDTH = Dimensions.get('window').width;
const TODAY = new Date().toISOString().split('T')[0];

const CATEGORY_EMOJI: Record<string, string> = {
  photography: '📷',
  gaming: '🎮',
  camping: '⛺',
  diy: '🔧',
  music: '🎸',
  sports: '⚽',
};

type Props = NativeStackScreenProps<HomeStackParamList, 'ItemDetail'>;

function datesBetween(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start);
  const last = new Date(end);
  while (cur <= last) {
    dates.push(cur.toISOString().split('T')[0]);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function daysBetween(start: string, end: string): number {
  const a = new Date(start);
  const b = new Date(end);
  return Math.round((b.getTime() - a.getTime()) / 86400000) + 1;
}

function buildMarkedDates(
  start: string | null,
  end: string | null,
  blocked: Set<string>,
): Record<string, any> {
  const marks: Record<string, any> = {};

  blocked.forEach(d => {
    marks[d] = { disabled: true, disableTouchEvent: true, color: '#2a2a2a', textColor: '#555' };
  });

  if (!start) return marks;

  if (!end) {
    marks[start] = { startingDay: true, endingDay: true, color: '#fff', textColor: '#000' };
    return marks;
  }

  const range = datesBetween(start, end);
  range.forEach((d, i) => {
    marks[d] = {
      color: '#fff',
      textColor: '#000',
      startingDay: i === 0,
      endingDay: i === range.length - 1,
    };
  });

  return marks;
}

export default function ItemDetailScreen({ navigation, route }: Props) {
  const { item, openRent, prefilledStart, prefilledEnd } = route.params;
  const insets = useSafeAreaInsets();
  const photos = item.photos?.filter(Boolean) ?? [];
  const [activeIndex, setActiveIndex] = useState(0);
  const [chatLoading, setChatLoading] = useState(false);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [ownerCity, setOwnerCity] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [wishlisted, setWishlisted] = useState(false);
  const [wishlistLoading, setWishlistLoading] = useState(false);

  const [rentModalVisible, setRentModalVisible] = useState(!!(prefilledStart || openRent));

  useEffect(() => {
    if (openRent || prefilledStart) openRentModal();
    supabase
      .from('profiles')
      .select('full_name, city')
      .eq('id', item.owner_id)
      .single()
      .then(({ data }) => {
        if (data) {
          setOwnerName((data as any).full_name ?? null);
          setOwnerCity((data as any).city ?? null);
        }
      });
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setCurrentUserId(user.id);
      supabase
        .from('wishlist')
        .select('item_id')
        .eq('user_id', user.id)
        .eq('item_id', item.id)
        .maybeSingle()
        .then(({ data }) => setWishlisted(!!data));
    });
  }, []);
  const [selectedStart, setSelectedStart] = useState<string | null>(prefilledStart ?? null);
  const [selectedEnd, setSelectedEnd] = useState<string | null>(prefilledEnd ?? null);
  const [blockedDates, setBlockedDates] = useState<Set<string>>(new Set());
  const [rentLoading, setRentLoading] = useState(false);

  async function toggleWishlist() {
    setWishlistLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setWishlistLoading(false); return; }
    if (wishlisted) {
      await supabase.from('wishlist').delete().eq('user_id', user.id).eq('item_id', item.id);
      setWishlisted(false);
    } else {
      await supabase.from('wishlist').upsert({ user_id: user.id, item_id: item.id });
      setWishlisted(true);
    }
    setWishlistLoading(false);
  }

  async function openRentModal() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setRentModalVisible(false); Alert.alert('Error', 'You must be logged in to rent'); return; }
    if (user.id === item.owner_id) { setRentModalVisible(false); Alert.alert('Your item', 'You cannot rent your own item'); return; }

    setRentModalVisible(true);

    const [txRes, manualRes] = await Promise.all([
      supabase
        .from('transactions')
        .select('start_date, end_date')
        .eq('item_id', item.id)
        .in('status', ['pending', 'approved', 'active']),
      supabase
        .from('item_blocked_dates')
        .select('blocked_from, blocked_to')
        .eq('item_id', item.id),
    ]);

    const blocked = new Set<string>();
    (txRes.data ?? []).forEach(({ start_date, end_date }) => {
      datesBetween(start_date.split('T')[0], end_date.split('T')[0]).forEach(d => blocked.add(d));
    });
    (manualRes.data ?? []).forEach(({ blocked_from, blocked_to }) => {
      datesBetween(blocked_from, blocked_to).forEach(d => blocked.add(d));
    });
    setBlockedDates(blocked);
  }

  function onDayPress(day: { dateString: string }) {
    const d = day.dateString;
    if (blockedDates.has(d)) return;

    if (!selectedStart || (selectedStart && selectedEnd)) {
      setSelectedStart(d);
      setSelectedEnd(null);
      return;
    }

    if (d < selectedStart) {
      setSelectedStart(d);
      setSelectedEnd(null);
      return;
    }

    const range = datesBetween(selectedStart, d);
    if (range.some(rd => blockedDates.has(rd))) {
      Alert.alert('Unavailable', 'Your range includes blocked dates. Please pick different dates.');
      return;
    }
    setSelectedEnd(d);
  }

  async function sendRentalRequest() {
    if (!selectedStart || !selectedEnd) return;
    setRentLoading(true);
    try {
      const days = daysBetween(selectedStart, selectedEnd);
      const totalPrice = days * item.daily_price;

      const fmt = (d: string) =>
        new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      const message = `📅 Rental request: ${fmt(selectedStart)} → ${fmt(selectedEnd)} (${days} day${days > 1 ? 's' : ''}) · ₪${totalPrice}. Awaiting your approval.`;

      // Single atomic RPC — conversation + transaction + message in one DB transaction
      const { data, error } = await supabase.rpc('create_rental_request', {
        p_item_id:    item.id,
        p_lender_id:  item.owner_id,
        p_start_date: selectedStart,
        p_end_date:   selectedEnd,
        p_total_price: totalPrice,
        p_message:    message,
      });
      if (error) throw error;

      setRentModalVisible(false);
      // Signal AI Planner to tick this item as Requested
      (navigation as any).getParent()?.navigate('AIPlanner', {
        plannerUpdate: { itemId: item.id, type: 'requested' },
      });
      (navigation as any).getParent()?.navigate('Chats', {
        screen: 'ChatRoom',
        params: {
          conversationId: data.conversation_id,
          itemTitle:      item.title,
          otherUserName:  data.lender_name,
        },
      });
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setRentLoading(false);
    }
  }

  async function openChat() {
    setChatLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { Alert.alert('Error', 'You must be logged in to chat'); return; }
      if (user.id === item.owner_id) { Alert.alert('This is your item', 'You cannot chat with yourself'); return; }

      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .eq('item_id', item.id)
        .eq('renter_id', user.id)
        .eq('lender_id', item.owner_id)
        .maybeSingle();

      let conversationId = existing?.id as string | undefined;
      if (!conversationId) {
        const { data: newConv, error } = await supabase
          .from('conversations')
          .insert({ item_id: item.id, renter_id: user.id, lender_id: item.owner_id })
          .select('id')
          .single();
        if (error) throw error;
        conversationId = newConv.id;
      }

      const { data: lenderProfile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', item.owner_id)
        .single();

      (navigation as any).getParent()?.navigate('Chats', {
        screen: 'ChatRoom',
        params: {
          conversationId,
          itemTitle: item.title,
          otherUserName: (lenderProfile as any)?.full_name ?? 'Lender',
          initialText: `Hi! I'm interested in renting "${item.title}". Is it available?`,
        },
      });
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setChatLoading(false);
    }
  }

  const markedDates = buildMarkedDates(selectedStart, selectedEnd, blockedDates);
  const totalDays = selectedStart && selectedEnd ? daysBetween(selectedStart, selectedEnd) : null;
  const totalPrice = totalDays ? totalDays * item.daily_price : null;

  return (
    <>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />

        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('HomeMain')}
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Photo gallery */}
          <View style={styles.galleryContainer}>
            {photos.length > 0 ? (
              <>
                <FlatList
                  data={photos}
                  keyExtractor={(_, i) => String(i)}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={(e) => {
                    const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
                    setActiveIndex(index);
                  }}
                  renderItem={({ item: photoUrl }) => (
                    <Image
                      source={{ uri: photoUrl }}
                      style={styles.photo}
                      resizeMode="cover"
                    />
                  )}
                />
                {photos.length > 1 && (
                  <View style={styles.dotRow}>
                    {photos.map((_, i) => (
                      <View key={i} style={[styles.dot, i === activeIndex && styles.dotActive]} />
                    ))}
                  </View>
                )}
              </>
            ) : (
              <View style={styles.emojiPlaceholder}>
                <Text style={styles.emojiText}>{CATEGORY_EMOJI[item.category] ?? '📦'}</Text>
              </View>
            )}
          </View>

          {/* Item details */}
          <View style={styles.details}>
            <Text style={styles.title}>{item.title}</Text>

            {ownerName && (
              <TouchableOpacity
                style={styles.ownerRow}
                onPress={() => {
                  if (item.owner_id === currentUserId) {
                    // Owner viewing their own item — go to their profile hub (SAS)
                    (navigation as any).getParent()?.navigate('Profile', { screen: 'ProfileMain' });
                  } else {
                    (navigation as any).navigate('PublicProfile', { userId: item.owner_id, userName: ownerName });
                  }
                }}
              >
                <View style={styles.ownerAvatar}>
                  <Text style={styles.ownerInitial}>{ownerName.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.ownerInfo}>
                  <Text style={styles.ownerLabel}>Listed by</Text>
                  <Text style={styles.ownerName}>{ownerName}{ownerCity ? ` · ${ownerCity}` : ''}</Text>
                </View>
                <Text style={styles.ownerChevron}>›</Text>
              </TouchableOpacity>
            )}

            <View style={styles.metaRow}>
              <Text style={styles.price}>₪{item.daily_price}/day</Text>
              {item.sale_price != null && (
                <Text style={styles.salePrice}>Buy: ₪{item.sale_price}</Text>
              )}
            </View>

            <View style={styles.tagRow}>
              <View style={styles.tag}>
                <Text style={styles.tagText}>{item.category}</Text>
              </View>
              {item.city && (
                <View style={styles.tag}>
                  <Text style={styles.tagText}>📍 {item.city}</Text>
                </View>
              )}
            </View>

            {item.description ? (
              <>
                <Text style={styles.sectionLabel}>About this item</Text>
                <Text style={styles.description}>{item.description}</Text>
              </>
            ) : null}

            {/* Action buttons */}
            <View style={styles.actions}>
              <TouchableOpacity style={styles.actionBtn} onPress={openRentModal}>
                <Text style={styles.actionBtnText}>🏷️ Rent</Text>
              </TouchableOpacity>

              {item.sale_price != null && (
                <TouchableOpacity style={styles.actionBtn}>
                  <Text style={styles.actionBtnText}>🛒 Buy</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnSecondary, wishlisted && styles.actionBtnWishlisted]}
                onPress={toggleWishlist}
                disabled={wishlistLoading}
              >
                <Text style={styles.actionBtnTextSecondary}>
                  {wishlisted ? '❤️ Saved' : '🤍 Wishlist'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnSecondary, chatLoading && styles.actionBtnDisabled]}
                onPress={openChat}
                disabled={chatLoading}
              >
                {chatLoading
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={styles.actionBtnTextSecondary}>💬 Chat</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Rent Modal — date range picker */}
      <Modal
        visible={rentModalVisible}
        animationType="slide"
        onRequestClose={() => setRentModalVisible(false)}
      >
        <View style={[styles.modalContainer, { paddingTop: insets.top }]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Choose rental dates</Text>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setRentModalVisible(false)}>
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.modalHint}>
            {!selectedStart
              ? 'Tap a start date'
              : !selectedEnd
              ? 'Tap an end date'
              : `${selectedStart} → ${selectedEnd}`}
          </Text>

          <Calendar
            current={selectedStart ?? TODAY}
            markingType="period"
            markedDates={markedDates}
            onDayPress={onDayPress}
            minDate={TODAY}
            theme={{
              backgroundColor: '#1a1a1a',
              calendarBackground: '#1a1a1a',
              textSectionTitleColor: '#666',
              dayTextColor: '#fff',
              todayTextColor: '#4da6ff',
              todayBackgroundColor: 'transparent',
              arrowColor: '#fff',
              monthTextColor: '#fff',
              textDisabledColor: '#444',
            }}
          />

          {totalDays != null && totalPrice != null && (
            <View style={styles.summaryBox}>
              <Text style={styles.summaryText}>
                {totalDays} day{totalDays > 1 ? 's' : ''} × ₪{item.daily_price}/day
              </Text>
              <Text style={styles.summaryTotal}>Total: ₪{totalPrice}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.sendBtn,
              (!selectedStart || !selectedEnd || rentLoading) && styles.sendBtnDisabled,
            ]}
            onPress={sendRentalRequest}
            disabled={!selectedStart || !selectedEnd || rentLoading}
          >
            {rentLoading
              ? <ActivityIndicator color="#000" />
              : <Text style={styles.sendBtnText}>Send Request</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelBtn} onPress={() => setRentModalVisible(false)}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a1a' },
  backButton: { paddingHorizontal: 20, paddingVertical: 12 },
  backText: { color: '#fff', fontSize: 15, fontWeight: '500' },

  galleryContainer: { width: SCREEN_WIDTH, backgroundColor: '#242424' },
  photo: { width: SCREEN_WIDTH, height: 320 },
  emojiPlaceholder: {
    width: SCREEN_WIDTH, height: 320,
    alignItems: 'center', justifyContent: 'center', backgroundColor: '#333',
  },
  emojiText: { fontSize: 80 },
  dotRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 6,
    paddingVertical: 10, backgroundColor: '#1a1a1a',
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#444' },
  dotActive: { backgroundColor: '#fff' },

  details: { padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  metaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 16 },
  price: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  salePrice: { fontSize: 14, color: '#888' },

  tagRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  tag: {
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: '#2a2a2a', borderRadius: 20,
    borderWidth: 1, borderColor: '#3a3a3a',
  },
  tagText: { color: '#aaa', fontSize: 13 },

  ownerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: '#242424', borderRadius: 12,
  },
  ownerAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: '#3a3a3a', alignItems: 'center', justifyContent: 'center',
  },
  ownerInitial: { color: '#fff', fontSize: 16, fontWeight: '700' },
  ownerInfo: { flex: 1 },
  ownerLabel: { color: '#666', fontSize: 11 },
  ownerName: { color: '#fff', fontSize: 14, fontWeight: '600', marginTop: 1 },
  ownerChevron: { color: '#666', fontSize: 22, lineHeight: 24 },

  sectionLabel: { fontSize: 13, color: '#666', marginTop: 8 },
  description: { fontSize: 15, color: '#ccc', lineHeight: 22 },

  actions: { gap: 10, marginTop: 16 },
  actionBtn: {
    height: 54, backgroundColor: '#fff',
    borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  actionBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
  actionBtnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1, borderColor: '#3a3a3a',
  },
  actionBtnTextSecondary: { color: '#fff', fontSize: 16, fontWeight: '500' },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnWishlisted: { borderColor: '#e57373', backgroundColor: '#2a1a1a' },

  // Modal
  modalContainer: { flex: 1, backgroundColor: '#1a1a1a' },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: '#2a2a2a',
  },
  modalTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  modalCloseBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  modalClose: { color: '#aaa', fontSize: 20 },
  modalHint: { color: '#888', fontSize: 13, textAlign: 'center', marginVertical: 12 },

  summaryBox: {
    marginHorizontal: 20, marginTop: 20,
    padding: 16, backgroundColor: '#2a2a2a', borderRadius: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  summaryText: { color: '#aaa', fontSize: 14 },
  summaryTotal: { color: '#fff', fontSize: 16, fontWeight: '700' },

  sendBtn: {
    margin: 20, height: 54, backgroundColor: '#fff',
    borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: '#000', fontSize: 16, fontWeight: '700' },
  cancelBtn: { marginHorizontal: 20, marginBottom: 8, height: 48, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { color: '#fff', fontSize: 15, fontWeight: '500' },
});
