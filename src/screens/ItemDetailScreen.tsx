import { useState, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, Image, FlatList, TouchableOpacity,
  ScrollView, Dimensions, StatusBar, Alert, ActivityIndicator, Modal, Animated,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Calendar } from 'react-native-calendars';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { HomeStackParamList } from '../navigation/HomeStackNavigator';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { CategoryIcon } from '../components/CategoryIcon';
import { OverflowMenu } from '../components/OverflowMenu';
import {
  ChevronLeft, ChevronRight, MapPin, Tag, ShoppingCart, Heart, MessageCircle, X, Leaf, Star, Flag,
  Calendar as CalendarIcon, Pencil, Eye, EyeOff,
} from 'lucide-react-native';
import { getImpactScore, formatDateRange, formatPrice } from '../utils/format';

const SCREEN_WIDTH = Dimensions.get('window').width;
const TODAY = new Date().toISOString().split('T')[0];
const STAR_COLOR = '#f59e0b';

// Both RPCs `returns json` in Postgres (json_build_object), so Supabase's
// generated types can't infer their shape — these mirror the literal
// json_build_object(...) calls in their migrations.
type CreateRentalRequestResult = { conversation_id: string; lender_name: string };
type CreatePurchaseResult = { conversation_id: string; purchase_id: string };

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
  colors: ThemeColors,
): Record<string, any> {
  const marks: Record<string, any> = {};

  blocked.forEach(d => {
    marks[d] = { disabled: true, disableTouchEvent: true, color: colors.border, textColor: colors.textFaint };
  });

  if (!start) return marks;

  if (!end) {
    marks[start] = { startingDay: true, endingDay: true, color: colors.text, textColor: colors.btnText };
    return marks;
  }

  const range = datesBetween(start, end);
  range.forEach((d, i) => {
    marks[d] = {
      color: colors.text,
      textColor: colors.btnText,
      startingDay: i === 0,
      endingDay: i === range.length - 1,
    };
  });

  return marks;
}

export default function ItemDetailScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { item, openRent, prefilledStart, prefilledEnd } = route.params;
  const insets = useSafeAreaInsets();
  const photos = item.photos?.filter(Boolean) ?? [];
  const [activeIndex, setActiveIndex] = useState(0);
  const [chatLoading, setChatLoading] = useState(false);
  const [buyLoading, setBuyLoading] = useState(false);
  const [ownerName, setOwnerName] = useState<string | null>(null);
  const [ownerCity, setOwnerCity] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [wishlisted, setWishlisted] = useState(false);
  const [wishlistLoading, setWishlistLoading] = useState(false);
  const [itemRating, setItemRating] = useState<{ avg: number; count: number } | null>(null);
  const [pickupLocation, setPickupLocation] = useState<string | null>(null);
  const [isHidden, setIsHidden] = useState(false);
  // Sold is terminal — distinct from is_hidden so the owner can't tap "Show"
  // on an item that's already gone and accidentally re-list it (same guard
  // as MyItemsScreen).
  const [isSold, setIsSold] = useState(false);

  const [rentModalVisible, setRentModalVisible] = useState(!!(prefilledStart || openRent));

  // Tracks the month the calendar is showing, so the "previous" arrow can be
  // disabled once we are at minDate. onMonthChange fires on mount too, so this
  // initial value is only ever used for the first render.
  const [visibleMonth, setVisibleMonth] = useState(TODAY.slice(0, 7));

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
      if (user.id === item.owner_id) {
        supabase
          .from('purchases')
          .select('item_id')
          .eq('item_id', item.id)
          .eq('status', 'paid')
          .maybeSingle()
          .then(({ data }) => setIsSold(!!data));
      }
    });
    supabase
      .from('items')
      .select('avg_rating, review_count, pickup_location, is_hidden')
      .eq('id', item.id)
      .single()
      .then(({ data }) => {
        if (data && (data as any).review_count > 0) {
          setItemRating({ avg: (data as any).avg_rating, count: (data as any).review_count });
        }
        if (data) setPickupLocation((data as any).pickup_location ?? null);
        if (data) setIsHidden((data as any).is_hidden ?? false);
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

      const message = `📅 Rental request: ${formatDateRange(selectedStart, selectedEnd)} (${days} day${days > 1 ? 's' : ''}) · ${formatPrice(totalPrice)}. Awaiting your approval.`;

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
      const result = data as CreateRentalRequestResult;

      setRentModalVisible(false);
      // Signal AI Planner to tick this item as Requested
      (navigation as any).getParent()?.navigate('AIPlanner', {
        plannerUpdate: { itemId: item.id, type: 'requested' },
      });
      (navigation as any).getParent()?.navigate('Chats', {
        screen: 'ChatRoom',
        params: {
          conversationId: result.conversation_id,
          itemTitle:      item.title,
          otherUserName:  result.lender_name,
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

  // Buy doesn't pay on tap — it opens the Deal Board card in chat, where the
  // buyer pays in person once they've actually received the item.
  async function handleBuy() {
    setBuyLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { Alert.alert('Error', 'You must be logged in to buy'); return; }
      if (user.id === item.owner_id) { Alert.alert('Your item', 'You cannot buy your own item'); return; }

      const { data, error } = await supabase.rpc('create_purchase', { p_item_id: item.id });
      if (error) throw error;
      const result = data as CreatePurchaseResult;

      const { data: sellerProfile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', item.owner_id)
        .single();

      (navigation as any).getParent()?.navigate('Chats', {
        screen: 'ChatRoom',
        params: {
          conversationId: result.conversation_id,
          itemTitle: item.title,
          otherUserName: (sellerProfile as any)?.full_name ?? 'Seller',
          initialTab: 'deal',
        },
      });
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setBuyLoading(false);
    }
  }

  // Same one-line mutation MyItemsScreen's toggleHidden performs — not worth a
  // shared helper for a single Postgres update, but the semantics must match
  // exactly (including leaving sold items alone).
  async function toggleHidden() {
    const next = !isHidden;
    const { error } = await supabase.from('items').update({ is_hidden: next }).eq('id', item.id);
    if (error) { Alert.alert('Error', error.message); return; }
    setIsHidden(next);
  }

  const markedDates = buildMarkedDates(selectedStart, selectedEnd, blockedDates, colors);
  const totalDays = selectedStart && selectedEnd ? daysBetween(selectedStart, selectedEnd) : null;
  const totalPrice = totalDays ? totalDays * item.daily_price : null;

  return (
    <>
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" />

        <View style={styles.headerRow}>
          <TouchableOpacity
            style={styles.backButton}
            // Also reachable via ProfileStack (which has no 'HomeMain' route), so
            // the fallback jumps to the Home tab instead of a specific stack root.
            onPress={() => navigation.canGoBack() ? navigation.goBack() : (navigation as any).getParent()?.navigate('HomeStack')}
          >
            <ChevronLeft size={20} color={colors.text} />
            <Text style={styles.backText}>Back</Text>
          </TouchableOpacity>
          {/* Covers listings the AI moderation pass missed — carries the item id
              so the admin sees exactly what was flagged (SAS: same
              PublicProfileScreen report modal, not a separate implementation).
              Hidden for your own listing.
              Viewing your own item instead surfaces the same Manage/Edit/Hide
              shortcuts as MyItemsScreen — navigation shortcuts into the
              existing ManageItem/EditItem screens (SAS), not reimplemented
              here. Cross-tab via getParent() since ItemDetail is reachable
              from both the Home and Profile stacks, but ManageItem/EditItem
              only exist in the Profile stack. */}
          <OverflowMenu
            items={
              item.owner_id === currentUserId ? [
                {
                  key: 'manage', label: 'Manage Availability', icon: CalendarIcon,
                  onPress: () => (navigation as any).getParent()?.navigate('Profile', {
                    screen: 'ManageItem', params: { itemId: item.id, itemTitle: item.title },
                  }),
                },
                {
                  key: 'edit', label: 'Edit', icon: Pencil,
                  onPress: () => (navigation as any).getParent()?.navigate('Profile', {
                    screen: 'EditItem', params: { itemId: item.id },
                  }),
                },
                ...(isSold ? [] : [{
                  key: 'hide', label: isHidden ? 'Show' : 'Hide', icon: isHidden ? Eye : EyeOff,
                  onPress: toggleHidden,
                }]),
              ] : ownerName ? [
                {
                  key: 'report', label: 'Report this listing', icon: Flag, destructive: true,
                  onPress: () => (navigation as any).navigate('PublicProfile', {
                    userId: item.owner_id, userName: ownerName,
                    autoOpenReport: true, reportContextItemId: item.id,
                  }),
                },
              ] : []
            }
          />
        </View>

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
                <CategoryIcon category={item.category} size={84} color={colors.textMuted} strokeWidth={1.5} />
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
                <ChevronRight size={18} color={colors.textFaint} />
              </TouchableOpacity>
            )}


            <View style={styles.metaRow}>
              <Text style={styles.price}>{formatPrice(item.daily_price)}/day</Text>
              {item.sale_price != null && (
                <Text style={styles.salePrice}>Buy: {formatPrice(item.sale_price)}</Text>
              )}
            </View>

            {itemRating && (
              <TouchableOpacity
                style={styles.ratingCard}
                onPress={() => navigation.navigate('ReviewsList', { mode: 'item', itemId: item.id, itemTitle: item.title })}
              >
                <View style={styles.ratingStars}>
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Star
                      key={i}
                      size={20}
                      color={STAR_COLOR}
                      fill={i <= Math.round(itemRating.avg) ? STAR_COLOR : 'transparent'}
                      strokeWidth={1.8}
                    />
                  ))}
                </View>
                <View style={styles.ratingScoreRow}>
                  <Text style={styles.ratingScoreNumber}>{itemRating.avg.toFixed(1)}</Text>
                  <Text style={styles.ratingScoreMax}> / 5</Text>
                </View>
                <Text style={styles.ratingCount}>
                  {itemRating.count} review{itemRating.count > 1 ? 's' : ''}
                </Text>
              </TouchableOpacity>
            )}

            <View style={styles.tagRow}>
              <View style={styles.tag}>
                <Text style={styles.tagText}>{item.category}</Text>
              </View>
              {item.city && (
                <View style={[styles.tag, styles.tagWithIcon]}>
                  <MapPin size={13} color={colors.textSecondary} />
                  <Text style={styles.tagText}>{item.city}</Text>
                </View>
              )}
            </View>

            {pickupLocation && (
              <View style={styles.pickupRow}>
                <MapPin size={15} color={colors.textSecondary} strokeWidth={2} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.pickupLabel}>Meeting point</Text>
                  <Text style={styles.pickupText}>{pickupLocation}</Text>
                </View>
              </View>
            )}

            {/* Impact Score — kept low-key on purpose, ratings are the primary trust signal */}
            {(() => {
              const score = getImpactScore(item.category, item.completed_rental_count);
              const co2 = ((score - 3.0) * 5 + 2).toFixed(1);
              return (
                <View style={styles.impactRow}>
                  <Leaf size={13} color={colors.textFaint} strokeWidth={2} />
                  <Text style={styles.impactRowText}>
                    Impact Score {score.toFixed(1)}/5 · saves ~{co2} kg CO₂ vs. buying new
                  </Text>
                </View>
              );
            })()}

            {item.description ? (
              <>
                <Text style={styles.sectionLabel}>About this item</Text>
                <Text style={styles.description}>{item.description}</Text>
              </>
            ) : null}

            {/* Action buttons */}
            <View style={styles.actions}>
              <TouchableOpacity style={styles.actionBtn} onPress={openRentModal}>
                <Tag size={18} color={colors.btnText} />
                <Text style={styles.actionBtnText}>Rent</Text>
              </TouchableOpacity>

              {item.sale_price != null && (
                <TouchableOpacity
                  style={[styles.actionBtn, buyLoading && styles.actionBtnDisabled]}
                  onPress={handleBuy}
                  disabled={buyLoading}
                >
                  {buyLoading
                    ? <ActivityIndicator color={colors.btnText} size="small" />
                    : <><ShoppingCart size={18} color={colors.btnText} /><Text style={styles.actionBtnText}>Buy</Text></>
                  }
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnSecondary, wishlisted && styles.actionBtnWishlisted]}
                onPress={toggleWishlist}
                disabled={wishlistLoading}
              >
                <Heart size={18} color={wishlisted ? colors.danger : colors.text} fill={wishlisted ? colors.danger : 'transparent'} />
                <Text style={styles.actionBtnTextSecondary}>
                  {wishlisted ? 'Wishlisted' : 'Wishlist'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionBtn, styles.actionBtnSecondary, chatLoading && styles.actionBtnDisabled]}
                onPress={openChat}
                disabled={chatLoading}
              >
                {chatLoading
                  ? <ActivityIndicator color={colors.text} size="small" />
                  : <>
                      <MessageCircle size={18} color={colors.text} />
                      <Text style={styles.actionBtnTextSecondary}>Chat</Text>
                    </>
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
              <X size={22} color={colors.text} />
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
            // react-native-calendars flips its header row under I18nManager.isRTL,
            // which is true on Android with a Hebrew device locale but false on iOS
            // (no Hebrew localization bundle). The arrow that reads as "next" is then
            // wired to the previous month, which minDate greys out entirely — so the
            // calendar looks stuck on the current month. Disabling the back arrow at
            // minDate removes the dead direction, and swipe gives a second way through
            // that does not depend on hitting the right arrow at all.
            onMonthChange={m => setVisibleMonth(`${m.year}-${String(m.month).padStart(2, '0')}`)}
            disableArrowLeft={visibleMonth <= TODAY.slice(0, 7)}
            enableSwipeMonths
            theme={{
              backgroundColor: colors.bg,
              calendarBackground: colors.bg,
              textSectionTitleColor: colors.textFaint,
              dayTextColor: colors.text,
              todayTextColor: colors.primary,
              todayBackgroundColor: 'transparent',
              arrowColor: colors.text,
              monthTextColor: colors.text,
              textDisabledColor: colors.textFaint,
            }}
          />

          {totalDays != null && totalPrice != null && (
            <View style={styles.summaryBox}>
              <Text style={styles.summaryText}>
                {totalDays} day{totalDays > 1 ? 's' : ''} × {formatPrice(item.daily_price)}/day
              </Text>
              <Text style={styles.summaryTotal}>Total: {formatPrice(totalPrice)}</Text>
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
              ? <ActivityIndicator color={colors.btnText} />
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

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: 16 },
  backButton: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 16, paddingVertical: 12 },
  backText: { color: colors.text, fontSize: 15, fontWeight: '500' },

  galleryContainer: { width: SCREEN_WIDTH, backgroundColor: colors.surface },
  photo: { width: SCREEN_WIDTH, height: 320 },
  emojiPlaceholder: {
    width: SCREEN_WIDTH, height: 320,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chip,
  },
  emojiText: { fontSize: 80 },
  dotRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 6,
    paddingVertical: 10, backgroundColor: colors.bg,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.cardAlt },
  dotActive: { backgroundColor: colors.btn },

  details: { padding: 24, gap: 12 },
  title: { fontSize: 24, fontWeight: 'bold', color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'baseline', gap: 16 },
  price: { fontSize: 22, fontWeight: 'bold', color: colors.text },
  salePrice: { fontSize: 14, color: colors.textMuted },

  ratingCard: {
    backgroundColor: colors.card,
    borderRadius: 16, borderWidth: 1, borderColor: 'rgba(245,158,11,0.25)',
    padding: 16, gap: 8, alignItems: 'flex-start',
  },
  ratingStars: { flexDirection: 'row', gap: 3 },
  ratingScoreRow: { flexDirection: 'row', alignItems: 'baseline' },
  ratingScoreNumber: { fontSize: 32, fontWeight: '800', color: STAR_COLOR },
  ratingScoreMax: { fontSize: 15, color: colors.textMuted, fontWeight: '500' },
  ratingCount: { fontSize: 13, color: colors.textSecondary, fontWeight: '600' },

  pickupRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: colors.surface, borderRadius: 10, padding: 12,
  },
  pickupLabel: { fontSize: 11, color: colors.textFaint, marginBottom: 1 },
  pickupText: { fontSize: 13.5, color: colors.textSecondary, lineHeight: 18 },

  tagRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  tag: {
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: colors.card, borderRadius: 20,
    borderWidth: 1, borderColor: colors.border,
  },
  tagWithIcon: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tagText: { color: colors.textSecondary, fontSize: 13 },

  ownerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: colors.surface, borderRadius: 12,
  },
  ownerAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center',
  },
  ownerInitial: { color: colors.text, fontSize: 16, fontWeight: '700' },
  ownerInfo: { flex: 1 },
  ownerLabel: { color: colors.textFaint, fontSize: 11 },
  ownerName: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 1 },
  ownerChevron: { color: colors.textFaint, fontSize: 22, lineHeight: 24 },

  sectionLabel: { fontSize: 13, color: colors.textFaint, marginTop: 8 },
  description: { fontSize: 15, color: colors.textSecondary, lineHeight: 22 },

  actions: { gap: 10, marginTop: 16 },
  actionBtn: {
    height: 54, backgroundColor: colors.btn,
    borderRadius: 12, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
  },
  actionBtnText: { color: colors.btnText, fontSize: 16, fontWeight: '700' },
  actionBtnSecondary: {
    backgroundColor: 'transparent',
    borderWidth: 1, borderColor: colors.border,
  },
  actionBtnTextSecondary: { color: colors.text, fontSize: 16, fontWeight: '500' },
  actionBtnDisabled: { opacity: 0.5 },
  actionBtnWishlisted: { borderColor: colors.dangerSoft, backgroundColor: colors.dangerBg },

  // Impact Score — deliberately minimal, ratings are the dominant trust signal now
  impactRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  impactRowText: { fontSize: 12, color: colors.textFaint },

  // Modal
  modalContainer: { flex: 1, backgroundColor: colors.bg },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  modalCloseBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  modalClose: { color: colors.textSecondary, fontSize: 20 },
  modalHint: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginVertical: 12 },

  summaryBox: {
    marginHorizontal: 20, marginTop: 20,
    padding: 16, backgroundColor: colors.card, borderRadius: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  summaryText: { color: colors.textSecondary, fontSize: 14 },
  summaryTotal: { color: colors.text, fontSize: 16, fontWeight: '700' },

  sendBtn: {
    margin: 20, height: 54, backgroundColor: colors.btn,
    borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { color: colors.btnText, fontSize: 16, fontWeight: '700' },
  cancelBtn: { marginHorizontal: 20, marginBottom: 8, height: 48, alignItems: 'center', justifyContent: 'center' },
  cancelBtnText: { color: colors.text, fontSize: 15, fontWeight: '500' },
});
