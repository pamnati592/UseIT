import { useState, useEffect, useRef, useMemo} from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Modal, Image, type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStripe } from '@stripe/stripe-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatsStackParamList } from '../navigation/ChatsStackNavigator';
import { supabase } from '../services/supabase';
import { chatBus } from '../services/chatBus';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { CategoryIcon } from '../components/CategoryIcon';
import {
  Check, X, CreditCard, Clock, ChevronLeft, Package, Calendar, MessageCircle, ClipboardList, ArrowUp,
  ScanLine, QrCode, CircleCheck, TriangleAlert, MapPin, MessageSquare, Scale, UserRound,
} from 'lucide-react-native';

// Status label/color shown on the rental-request card's status pill — the card
// itself is the single live status board for that date range (see requestCard).
const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: 'Pending',   color: '#b45309', bg: 'rgba(245,158,11,0.15)' },
  approved:  { label: 'Approved',  color: '#15803d', bg: 'rgba(34,197,94,0.15)' },
  paid:      { label: 'Paid',      color: '#1d4ed8', bg: 'rgba(59,130,246,0.15)' },
  active:    { label: 'Active',    color: '#15803d', bg: 'rgba(34,197,94,0.15)' },
  completed: { label: 'Completed', color: '#6b7280', bg: 'rgba(107,114,128,0.15)' },
  rejected:  { label: 'Declined',  color: '#b91c1c', bg: 'rgba(239,68,68,0.15)' },
  disputed:  { label: 'Disputed',  color: '#b91c1c', bg: 'rgba(239,68,68,0.15)' },
  cancelled: { label: 'Cancelled', color: '#6b7280', bg: 'rgba(107,114,128,0.15)' },
};

type Message = {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  transaction_id?: string | null;
};

type Transaction = {
  id: string;
  status: string;
  start_date: string;
  end_date: string;
  total_price: number;
  approved_at?: string | null;
};

type ConversationInfo = {
  lender_id: string;
  renter_id: string;
  item_id: string;
};

const RENTAL_REQUEST_PREFIX = '📅 Rental request:';

type Props = NativeStackScreenProps<ChatsStackParamList, 'ChatRoom'>;

export default function ChatRoomScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { conversationId, itemTitle, otherUserName, initialText, targetTransactionId, initialTab, highlightAfterTimestamp } = route.params;
  const [activeTab, setActiveTab] = useState<'chat' | 'rental'>(initialTab ?? 'chat');
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState(initialText ?? '');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState<string>('Me');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [convInfo, setConvInfo] = useState<ConversationInfo | null>(null);
  const [itemPhotoUrl, setItemPhotoUrl] = useState<string | null>(null);
  const [itemCategory, setItemCategory] = useState<string>('other');
  const [pickupLocation, setPickupLocation] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<Record<string, Transaction>>({});
  const [actionLoading, setActionLoading] = useState(false);
  const [payLoading, setPayLoading] = useState(false);
  const [disputeModal, setDisputeModal] = useState<{ visible: boolean; transactionId: string | null; step: 1 | 2 }>({ visible: false, transactionId: null, step: 1 });
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const flatListRef = useRef<FlatList<Message>>(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !mounted) return;
      setCurrentUserId(user.id);

      supabase.from('profiles').select('full_name').eq('id', user.id).single().then(({ data }) => {
        if (data?.full_name && mounted) setCurrentUserName(data.full_name);
      });

      const [messagesRes, convRes, txRes] = await Promise.all([
        supabase
          .from('messages')
          .select('id, sender_id, content, created_at, transaction_id')
          .eq('conversation_id', conversationId)
          .order('created_at', { ascending: false }),
        supabase
          .from('conversations')
          .select('lender_id, renter_id, item_id')
          .eq('id', conversationId)
          .single(),
        supabase
          .from('transactions')
          .select('id, status, start_date, end_date, total_price, approved_at')
          .eq('conversation_id', conversationId),
      ]);

      if (!mounted) return;
      const msgs = (messagesRes.data ?? []) as Message[];
      if (msgs.length) setMessages(msgs);
      if (convRes.data) {
        setConvInfo(convRes.data as ConversationInfo);
        const itemId = (convRes.data as ConversationInfo).item_id;
        supabase.from('items').select('photos, category, pickup_location').eq('id', itemId).single().then(({ data }) => {
          if (!mounted || !data) return;
          setItemPhotoUrl((data as any).photos?.[0] ?? null);
          setItemCategory((data as any).category ?? 'other');
          setPickupLocation((data as any).pickup_location ?? null);
        });
      }

      const map: Record<string, Transaction> = {};
      (txRes.data as Transaction[] ?? []).forEach(tx => { map[tx.id] = tx; });

      // Also fetch any transactions linked via message.transaction_id that the
      // conversation_id query may have missed (e.g. older rows without conversation_id)
      const missingIds = msgs
        .map(m => m.transaction_id)
        .filter((id): id is string => !!id && !map[id]);
      if (missingIds.length > 0) {
        const { data: extra } = await supabase
          .from('transactions')
          .select('id, status, start_date, end_date, total_price, approved_at')
          .in('id', missingIds);
        (extra as Transaction[] ?? []).forEach(tx => { map[tx.id] = tx; });
      }

      setTransactions(map);
      setLoading(false);

      await markAsRead(user.id);
      chatBus.notify();

      channelRef.current = supabase
        // unique suffix per mount so we never reuse an already-subscribed cached channel
        .channel(`messages:${conversationId}:${Date.now()}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` },
          async (payload) => {
            if (!mounted) return;
            const newMsg = payload.new as Message;
            setMessages((prev) => prev.some(m => m.id === newMsg.id) ? prev : [newMsg, ...prev]);
            if (newMsg.transaction_id) {
              const { data: tx } = await supabase
                .from('transactions')
                .select('id, status, start_date, end_date, total_price, approved_at')
                .eq('id', newMsg.transaction_id)
                .single();
              if (tx && mounted) setTransactions((prev) => ({ ...prev, [(tx as Transaction).id]: tx as Transaction }));
            }
          }
        )
        .subscribe();
    }

    init();
    return () => {
      mounted = false;
      // removeChannel (not unsubscribe) also unregisters the channel from the
      // client, so a remount with the same topic doesn't reuse an already-
      // subscribed channel and throw "cannot add postgres_changes ... after subscribe()".
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [conversationId]);

  // After messages + transactions load, scroll to the target rental request card
  useEffect(() => {
    if (loading || !targetTransactionId || messages.length === 0) return;
    const rentalMsgs = messages.filter(m => !!m.transaction_id);
    const tx = transactions[targetTransactionId];
    let idx = rentalMsgs.findIndex(m => m.transaction_id === targetTransactionId);
    if (idx < 0 && tx) {
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const d = new Date(tx.start_date);
      const token = `${d.getUTCDate()} ${monthNames[d.getUTCMonth()]}`;
      idx = rentalMsgs.findIndex(m => m.content.startsWith(RENTAL_REQUEST_PREFIX) && m.content.includes(token));
    }
    if (idx >= 0) {
      const msgId = rentalMsgs[idx].id;
      setTimeout(() => {
        flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.4 });
        setHighlightedMessageId(msgId);
        setTimeout(() => setHighlightedMessageId(null), 1200);
      }, 350);
    }
  }, [loading]);

  // When arriving from a badged conversation, highlight the newest unread message and switch tab if needed
  useEffect(() => {
    if (loading || !highlightAfterTimestamp || messages.length === 0) return;
    const ts = new Date(highlightAfterTimestamp).getTime();
    const newestUnread = messages.find(m => new Date(m.created_at).getTime() > ts);
    if (!newestUnread) return;

    if (newestUnread.transaction_id) {
      // Status-change system messages (approve/pay/cancel/etc.) aren't rendered
      // as separate bubbles anymore — the rental-request card for this
      // transaction is the live status board, so highlight/scroll to that instead.
      setActiveTab('rental');
      const rentalMsgs = messages.filter(m => !!m.transaction_id && m.content.startsWith(RENTAL_REQUEST_PREFIX));
      const idx = rentalMsgs.findIndex(m => m.transaction_id === newestUnread.transaction_id);
      if (idx >= 0) {
        const cardId = rentalMsgs[idx].id;
        setTimeout(() => {
          flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.4 });
          setHighlightedMessageId(cardId);
          setTimeout(() => setHighlightedMessageId(null), 1200);
        }, 350);
      }
    } else {
      setTimeout(() => {
        setHighlightedMessageId(newestUnread.id);
        setTimeout(() => setHighlightedMessageId(null), 1200);
      }, 150);
    }
  }, [loading]);

  async function markAsRead(userId: string) {
    const { data: conv } = await supabase
      .from('conversations')
      .select('renter_id')
      .eq('id', conversationId)
      .single();
    if (!conv) return;
    const field = conv.renter_id === userId ? 'renter_last_read_at' : 'lender_last_read_at';
    await supabase.from('conversations').update({ [field]: new Date().toISOString() }).eq('id', conversationId);
  }

  async function send() {
    const content = text.trim();
    if (!content || !currentUserId || sending) return;
    setText('');
    setSending(true);

    const { data, error } = await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: currentUserId,
      content,
    }).select('id, sender_id, content, created_at, transaction_id').single();

    if (!error && data) {
      setMessages(prev => [data as Message, ...prev]);
      const now = new Date().toISOString();
      await supabase.from('conversations').update({ last_message: content, last_message_at: now }).eq('id', conversationId);
      await markAsRead(currentUserId);
    }
    setSending(false);
  }

  function formatDateRange(tx: Transaction): string {
    const fmt = (iso: string) =>
      new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    return `${fmt(tx.start_date)} → ${fmt(tx.end_date)}`;
  }

  function daysBetweenTx(tx: Transaction): number {
    const a = new Date(tx.start_date);
    const b = new Date(tx.end_date);
    return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
  }

  function canCancelTx(tx: Transaction): boolean {
    const now = Date.now();
    if (new Date(tx.end_date).getTime() < now) return false;
    return new Date(tx.start_date).getTime() - now > 48 * 60 * 60 * 1000;
  }

  // Update conversation timestamp BEFORE inserting the message so that when the
  // realtime INSERT event fires, useUnreadCount already sees the updated last_message_at.
  async function insertSystemMessage(content: string, transactionId: string) {
    const now = new Date().toISOString();
    await supabase.from('conversations').update({
      last_message: content,
      last_message_at: now,
    }).eq('id', conversationId);
    await supabase.from('messages').insert({
      conversation_id: conversationId,
      sender_id: currentUserId,
      content,
      transaction_id: transactionId,
    });
  }

  async function handleCancel(transactionId: string) {
    const tx = transactions[transactionId];
    if (!tx) return;
    const isPaid = tx.status === 'active';
    const dateRef = formatDateRange(tx);

    Alert.alert(
      'Cancel this rental?',
      isPaid
        ? `${dateRef} will be cancelled and the renter will receive a full refund.`
        : `${dateRef} will be cancelled. No payment has been taken yet.`,
      [
        { text: 'Keep booking', style: 'cancel' },
        {
          text: 'Cancel rental',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              const { error } = await supabase
                .from('transactions')
                .update({ status: 'cancelled' })
                .eq('id', transactionId);
              if (error) throw error;

              setTransactions(prev => ({
                ...prev,
                [transactionId]: { ...prev[transactionId], status: 'cancelled' },
              }));

              const msg = isPaid
                ? `⚠️ Your rental (${dateRef}) has been cancelled by the lender. You will receive a full refund.`
                : `⚠️ Your booking request (${dateRef}) has been cancelled by the lender. No payment was taken.`;
              await insertSystemMessage(msg, transactionId);
            } catch (e: any) {
              Alert.alert('Error', e.message);
            } finally {
              setActionLoading(false);
            }
          },
        },
      ]
    );
  }

  async function handleApprove(transactionId: string) {
    setActionLoading(true);
    try {
      const approvedAt = new Date().toISOString();
      const { error } = await supabase
        .from('transactions')
        .update({ status: 'approved', approved_at: approvedAt })
        .eq('id', transactionId);
      if (error) throw error;

      setTransactions(prev => ({ ...prev, [transactionId]: { ...prev[transactionId], status: 'approved', approved_at: approvedAt } }));

      const tx = transactions[transactionId];
      const dateRef = tx ? ` (${formatDateRange(tx)})` : '';
      await insertSystemMessage(`✅ Request approved${dateRef}! Payment is due within 24 hours.`, transactionId);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReject(transactionId: string) {
    setActionLoading(true);
    try {
      const { error } = await supabase
        .from('transactions')
        .update({ status: 'rejected' })
        .eq('id', transactionId);
      if (error) throw error;

      setTransactions(prev => ({ ...prev, [transactionId]: { ...prev[transactionId], status: 'rejected' } }));

      const tx = transactions[transactionId];
      const dateRef = tx ? ` (${formatDateRange(tx)})` : '';
      await insertSystemMessage(`❌ Request declined${dateRef}.`, transactionId);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setActionLoading(false);
    }
  }

  function handleReportIssue(transactionId: string) {
    setDisputeModal({ visible: true, transactionId, step: 1 });
  }

  async function confirmDispute() {
    const transactionId = disputeModal.transactionId;
    if (!transactionId) return;
    setDisputeModal(prev => ({ ...prev, visible: false }));
    const { error } = await supabase.rpc('report_issue', { p_tx: transactionId });
    if (error) { Alert.alert('Error', error.message); return; }
    setTransactions(prev => ({ ...prev, [transactionId]: { ...prev[transactionId], status: 'disputed' } }));
    const tx = transactions[transactionId];
    const dateRef = tx ? ` (${formatDateRange(tx)})` : '';
    await insertSystemMessage(
      `⚠️ An issue was escalated to UseIT Arbitration${dateRef}. Both parties have agreed to accept the platform's binding decision. Funds are held in escrow pending review.`,
      transactionId,
    );
  }

  async function handlePay(transactionId: string) {
    setPayLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      // Call Edge Function to create a PaymentIntent server-side
      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/create-payment-intent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ transaction_id: transactionId }),
        }
      );
      const { client_secret, error: fnError } = await res.json();
      if (fnError) throw new Error(fnError);

      // Initialise the payment sheet with the client secret
      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'SwipeAndRent',
        paymentIntentClientSecret: client_secret,
        defaultBillingDetails: { name: '' },
      });
      if (initError) throw new Error(initError.message);

      // Present the payment sheet to the user
      const { error: presentError } = await presentPaymentSheet();
      if (presentError) {
        if (presentError.code !== 'Canceled') Alert.alert('Payment failed', presentError.message);
        return;
      }

      // Payment succeeded — funds held in escrow; item is not handed over until
      // the pickup QR is scanned, so the status moves to 'paid' (not 'active').
      await supabase
        .from('transactions')
        .update({ status: 'paid' })
        .eq('id', transactionId);

      setTransactions(prev => ({
        ...prev,
        [transactionId]: { ...prev[transactionId], status: 'paid' },
      }));

      const paidTx = transactions[transactionId];
      const paidDateRef = paidTx ? ` (${formatDateRange(paidTx)})` : '';
      await insertSystemMessage(`💳 Payment completed${paidDateRef}! Show the pickup QR at handover.`, transactionId);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setPayLoading(false);
    }
  }

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const isLender = convInfo?.lender_id === currentUserId;
  const actionBadgeCount = isLender
    ? Object.values(transactions).filter(tx => tx.status === 'pending').length
    : Object.values(transactions).filter(tx =>
        tx.status === 'approved' &&
        !(tx.approved_at && Date.now() - new Date(tx.approved_at).getTime() > 86_400_000)
      ).length;
  // Rental tab shows only the rental-request card per transaction — it's the single
  // live status board for that date range. Status-change system messages (approve/
  // pay/cancel/etc.) still get inserted for badges/realtime, they just aren't rendered.
  const filteredMessages = messages.filter(m =>
    activeTab === 'rental'
      ? !!m.transaction_id && m.content.startsWith(RENTAL_REQUEST_PREFIX)
      : !m.transaction_id
  );

  // When messages lack transaction_id (RPC deployed before column existed),
  // fall back to matching the transaction by the start date embedded in the message text.
  function findTxForMessage(msg: Message): Transaction | null {
    if (msg.transaction_id) return transactions[msg.transaction_id] ?? null;
    const match = msg.content.match(/(\d+)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/);
    if (!match) return null;
    const day = parseInt(match[1]);
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const month = monthNames.indexOf(match[2]);
    return Object.values(transactions).find(tx => {
      const d = new Date(tx.start_date);
      return d.getUTCDate() === day && d.getUTCMonth() === month;
    }) ?? null;
  }

  function renderMessage({ item: msg }: { item: Message }) {
    const isMe = msg.sender_id === currentUserId;
    const isRentalRequest = msg.content.startsWith(RENTAL_REQUEST_PREFIX);

    if (isRentalRequest) {
      const tx = findTxForMessage(msg);
      const statusMeta = tx ? STATUS_META[tx.status] : null;
      return (
        <View style={[styles.requestCard, msg.id === highlightedMessageId && styles.highlighted]}>
          <View style={styles.requestHeader}>
            <View style={styles.requestHeaderLeft}>
              <Calendar size={16} color={colors.primary} strokeWidth={2.2} />
              <Text style={styles.requestDateText} numberOfLines={1}>
                {tx ? formatDateRange(tx) : msg.content}
              </Text>
            </View>
            {statusMeta && (
              <View style={[styles.requestStatusPill, { backgroundColor: statusMeta.bg }]}>
                <Text style={[styles.requestStatusPillText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
              </View>
            )}
          </View>
          {tx && (
            <Text style={styles.requestSubText}>
              {daysBetweenTx(tx)} day{daysBetweenTx(tx) > 1 ? 's' : ''} · ₪{tx.total_price}
            </Text>
          )}

          {tx && (
            <View style={styles.requestStatus}>
              {tx.status === 'pending' && (
                isLender ? (
                  <>
                    <View style={styles.requestActions}>
                      <TouchableOpacity
                        style={[styles.approveBtn, actionLoading && styles.btnDisabled]}
                        onPress={() => handleApprove(tx.id)}
                        disabled={actionLoading}
                      >
                        {actionLoading
                          ? <ActivityIndicator color={colors.btnText} size="small" />
                          : <><Check size={16} color={colors.btnText} strokeWidth={2.5} /><Text style={styles.approveBtnText}>Approve</Text></>
                        }
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.rejectBtn, actionLoading && styles.btnDisabled]}
                        onPress={() => handleReject(tx.id)}
                        disabled={actionLoading}
                      >
                        <X size={16} color={colors.textSecondary} strokeWidth={2.5} />
                        <Text style={styles.rejectBtnText}>Decline</Text>
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity
                      style={styles.viewProfileBtn}
                      onPress={() => {
                        if (!convInfo) return;
                        (navigation as any).getParent()?.navigate('HomeStack', {
                          screen: 'PublicProfile',
                          params: {
                            userId: convInfo.renter_id,
                            userName: otherUserName,
                            approveTransactionId: tx.id,
                            requestSummary: msg.content,
                          },
                        });
                      }}
                    >
                      <UserRound size={15} color={colors.primary} strokeWidth={2} />
                      <Text style={styles.viewProfileText}>View {otherUserName}'s profile</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <Text style={styles.helperText}>⏳ Waiting for {otherUserName} to respond to your request.</Text>
                )
              )}
              {tx.status === 'approved' && (
                !isLender ? (
                  tx.approved_at && Date.now() - new Date(tx.approved_at).getTime() > 86_400_000 ? (
                    <View style={styles.statusChip}><Clock size={15} color={colors.warning} /><Text style={styles.statusExpired}>Time exceeded — request expired</Text></View>
                  ) : (
                    <>
                      <Text style={styles.helperText}>Approved — pay within 24 hours to confirm your rental.</Text>
                      <TouchableOpacity
                        style={[styles.payBtn, payLoading && styles.btnDisabled]}
                        onPress={() => handlePay(tx.id)}
                        disabled={payLoading}
                      >
                        {payLoading
                          ? <ActivityIndicator color={colors.btnText} size="small" />
                          : <><CreditCard size={16} color={colors.btnText} /><Text style={styles.payBtnText}>Pay Now</Text></>
                        }
                      </TouchableOpacity>
                    </>
                  )
                ) : (
                  <View style={styles.approvedRow}>
                    <Text style={[styles.helperText, styles.helperTextFlex]}>Approved — waiting for {otherUserName} to pay.</Text>
                    {canCancelTx(tx) && (
                      <TouchableOpacity
                        style={[styles.cancelRentalBtn, actionLoading && styles.btnDisabled]}
                        onPress={() => handleCancel(tx.id)}
                        disabled={actionLoading}
                      >
                        <Text style={styles.cancelRentalBtnText}>Cancel</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                )
              )}
              {tx.status === 'paid' && (
                <View style={styles.handoffBlock}>
                  <Text style={styles.helperText}>
                    {isLender
                      ? `Payment received — you still have the item, so show this QR to ${otherUserName} when you hand it over.`
                      : `Payment received — scan ${otherUserName}'s QR when you pick up the item, then confirm its condition.`}
                  </Text>
                  <TouchableOpacity
                    style={styles.meetingBtn}
                    onPress={() => navigation.navigate('MeetingPoint', { pickupLocation, itemTitle })}
                  >
                    <MapPin size={16} color={colors.primary} />
                    <Text style={styles.meetingBtnText}>Meeting Point</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.qrActionBtn}
                    onPress={() => navigation.navigate(isLender ? 'QRDisplay' : 'QRScan', { transactionId: tx.id, phase: 'pickup', itemTitle })}
                  >
                    {isLender
                      ? <><QrCode size={16} color={colors.btnText} /><Text style={styles.qrActionText}>Show Pickup QR</Text></>
                      : <><ScanLine size={16} color={colors.btnText} /><Text style={styles.qrActionText}>Scan to Receive</Text></>}
                  </TouchableOpacity>
                  <View style={styles.handoffSecondary}>
                    {isLender && canCancelTx(tx) && (
                      <TouchableOpacity style={[styles.cancelRentalBtn, actionLoading && styles.btnDisabled]} onPress={() => handleCancel(tx.id)} disabled={actionLoading}>
                        <Text style={styles.cancelRentalBtnText}>Cancel</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={styles.reportLink} onPress={() => handleReportIssue(tx.id)}>
                      <TriangleAlert size={14} color={colors.danger} /><Text style={styles.reportLinkText}>Report issue</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              {tx.status === 'active' && (
                <View style={styles.handoffBlock}>
                  <Text style={styles.helperText}>
                    {isLender
                      ? `Rental is active — scan ${otherUserName}'s QR when they return the item.`
                      : `Rental is active — show this QR when you return the item.`}
                  </Text>
                  <TouchableOpacity
                    style={styles.qrActionBtn}
                    onPress={() => navigation.navigate(isLender ? 'QRScan' : 'QRDisplay', { transactionId: tx.id, phase: 'return', itemTitle })}
                  >
                    {isLender
                      ? <><ScanLine size={16} color={colors.btnText} /><Text style={styles.qrActionText}>Scan to Complete</Text></>
                      : <><QrCode size={16} color={colors.btnText} /><Text style={styles.qrActionText}>Show Return QR</Text></>}
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.reportLink} onPress={() => handleReportIssue(tx.id)}>
                    <TriangleAlert size={14} color={colors.danger} /><Text style={styles.reportLinkText}>Report issue</Text>
                  </TouchableOpacity>
                </View>
              )}
              {tx.status === 'completed' && (
                <Text style={styles.helperText}>✅ This rental has been completed.</Text>
              )}
              {tx.status === 'rejected' && (
                <Text style={styles.helperText}>❌ This request was declined.</Text>
              )}
              {tx.status === 'disputed' && (
                <Text style={styles.helperText}>⚠️ This rental is under review by UseIT support.</Text>
              )}
              {tx.status === 'cancelled' && (
                <Text style={styles.helperText}>⚠️ This rental was cancelled — refund processed per policy.</Text>
              )}
            </View>
          )}

          <Text style={styles.requestTime}>Requested {formatTime(msg.created_at)}</Text>
        </View>
      );
    }

    return (
      <View style={[styles.bubbleWrapper, isMe ? styles.bubbleWrapperMe : styles.bubbleWrapperThem, msg.id === highlightedMessageId && styles.highlighted]}>
        <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
          <Text style={[styles.bubbleText, isMe ? styles.bubbleTextMe : styles.bubbleTextThem]}>
            {msg.content}
          </Text>
        </View>
        <Text style={[styles.bubbleTime, isMe ? styles.bubbleTimeMe : styles.bubbleTimeThem]}>
          {formatTime(msg.created_at)}
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.navigate('ConversationsList')}>
          <ChevronLeft size={26} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.itemAvatar}>
          {itemPhotoUrl ? (
            <Image source={{ uri: itemPhotoUrl }} style={styles.itemAvatarImg} />
          ) : (
            <CategoryIcon category={itemCategory} size={18} color={colors.textMuted} strokeWidth={2} />
          )}
        </View>
        <TouchableOpacity
          style={styles.headerInfo}
          onPress={() => {
            if (convInfo) {
              const otherId = isLender ? convInfo.renter_id : convInfo.lender_id;
              (navigation as any).getParent()?.navigate('HomeStack', {
                screen: 'PublicProfile',
                params: { userId: otherId, userName: otherUserName },
              });
            }
          }}
        >
          <Text style={styles.headerName} numberOfLines={1}>{otherUserName}</Text>
          <View style={styles.headerItemRow}>
            <Package size={12} color={colors.textMuted} />
            <Text style={styles.headerItem} numberOfLines={1}>{itemTitle}</Text>
          </View>
        </TouchableOpacity>
        {isLender && convInfo?.item_id && (
          <TouchableOpacity
            style={styles.calendarBtn}
            onPress={() => {
              (navigation as any).getParent()?.navigate('Profile', {
                screen: 'ManageItem',
                params: { itemId: convInfo.item_id, itemTitle },
              });
            }}
          >
            <Calendar size={20} color={colors.text} />
          </TouchableOpacity>
        )}
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'chat' && styles.tabActive]}
          onPress={() => setActiveTab('chat')}
        >
          <View style={styles.tabInner}>
            <MessageCircle size={15} color={activeTab === 'chat' ? colors.text : colors.textMuted} />
            <Text style={[styles.tabText, activeTab === 'chat' && styles.tabTextActive]}>Chat</Text>
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'rental' && styles.tabActive]}
          onPress={() => setActiveTab('rental')}
        >
          <View style={styles.tabInner}>
            <ClipboardList size={15} color={activeTab === 'rental' ? colors.text : colors.textMuted} />
            <Text style={[styles.tabText, activeTab === 'rental' && styles.tabTextActive]}>Rental</Text>
            {actionBadgeCount > 0 && activeTab !== 'rental' && (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{actionBadgeCount}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {loading ? (
          <ActivityIndicator color={colors.text} style={{ flex: 1 }} />
        ) : filteredMessages.length === 0 ? (
          <View style={styles.emptyTab}>
            <Text style={styles.emptyTabText}>
              {activeTab === 'chat' ? 'No messages yet. Say hi!' : 'No rental activity yet.'}
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={filteredMessages}
            keyExtractor={(m) => m.id}
            inverted
            contentContainerStyle={styles.messageList}
            renderItem={renderMessage}
            onScrollToIndexFailed={({ index, averageItemLength }) => {
              flatListRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: true });
            }}
          />
        )}

        {activeTab === 'chat' && (
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Message..."
              placeholderTextColor={colors.textFaint}
              value={text}
              onChangeText={setText}
              multiline
              maxLength={500}
              onSubmitEditing={send}
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
              onPress={send}
              disabled={!text.trim() || sending}
            >
              {sending
                ? <ActivityIndicator color={colors.btnText} size="small" />
                : <ArrowUp size={20} color={text.trim() ? colors.btnText : colors.textFaint} strokeWidth={2.5} />
              }
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>

      {/* Dispute Modal */}
      <Modal
        visible={disputeModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setDisputeModal(prev => ({ ...prev, visible: false }))}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            {disputeModal.step === 1 ? (
              <>
                <View style={styles.modalHandle} />
                <View style={styles.modalIconRow}>
                  <View style={[styles.modalIconCircle, { backgroundColor: colors.warningBg }]}>
                    <MessageSquare size={24} color={colors.warning} />
                  </View>
                </View>
                <Text style={styles.modalTitle}>Report Damage</Text>
                <Text style={styles.modalBody}>
                  We always recommend resolving issues directly first. Reach out to the other party — most disputes are settled quickly through a simple conversation.
                </Text>
                <TouchableOpacity
                  style={styles.modalPrimaryBtn}
                  onPress={() => {
                    setDisputeModal(prev => ({ ...prev, visible: false }));
                    setActiveTab('chat');
                  }}
                >
                  <MessageSquare size={16} color={colors.btnText} />
                  <Text style={styles.modalPrimaryBtnText}>Message them directly</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalSecondaryBtn}
                  onPress={() => setDisputeModal(prev => ({ ...prev, step: 2 }))}
                >
                  <Text style={styles.modalSecondaryBtnText}>Escalate to UseIT Arbitration →</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setDisputeModal(prev => ({ ...prev, visible: false }))} style={styles.modalCancelLink}>
                  <Text style={styles.modalCancelLinkText}>Cancel</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.modalHandle} />
                <View style={styles.modalIconRow}>
                  <View style={[styles.modalIconCircle, { backgroundColor: colors.dangerBg }]}>
                    <Scale size={24} color={colors.danger} />
                  </View>
                </View>
                <Text style={styles.modalTitle}>UseIT Arbitration</Text>
                <View style={styles.arbitrationBox}>
                  <Text style={styles.arbitrationText}>
                    "By proceeding, both parties agree to accept UseIT's binding decision regarding this dispute. The platform will review evidence from both sides and issue a final ruling within 48 hours. Payment remains in escrow until resolved."
                  </Text>
                </View>
                <Text style={styles.modalBody}>
                  This action cannot be undone. The dispute will be assigned to a UseIT mediator immediately.
                </Text>
                <TouchableOpacity
                  style={[styles.modalPrimaryBtn, { backgroundColor: colors.danger }]}
                  onPress={confirmDispute}
                >
                  <Scale size={16} color={colors.white} />
                  <Text style={[styles.modalPrimaryBtnText, { color: colors.white }]}>I Agree — Submit Dispute</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalSecondaryBtn}
                  onPress={() => setDisputeModal(prev => ({ ...prev, step: 1 }))}
                >
                  <Text style={styles.modalSecondaryBtnText}>← Go back</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText: { color: colors.text, fontSize: 22, fontWeight: '300' },
  itemAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center',
    overflow: 'hidden',
  },
  itemAvatarImg: { width: 36, height: 36, borderRadius: 18 },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 16, fontWeight: '600', color: colors.text },
  headerItemRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
  headerItem: { fontSize: 12, color: colors.textFaint, flexShrink: 1 },
  calendarBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  calendarBtnText: { fontSize: 20 },

  messageList: { padding: 16, gap: 8 },
  bubbleWrapper: { marginVertical: 2, maxWidth: '80%' },
  bubbleWrapperMe: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleWrapperThem: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMe: { backgroundColor: colors.btn, borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: colors.card, borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  bubbleTextMe: { color: colors.btnText },
  bubbleTextThem: { color: colors.text },
  bubbleTime: { fontSize: 11, marginTop: 3, color: colors.textFaint },
  bubbleTimeMe: { textAlign: 'right' },
  bubbleTimeThem: { textAlign: 'left' },

  // Rental request card — the live status board for one rental date range
  requestCard: {
    alignSelf: 'center', width: '92%', marginVertical: 8,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 16, padding: 16, gap: 10,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  requestHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  requestHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 7, flexShrink: 1 },
  requestDateText: { color: colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  requestSubText: { color: colors.textMuted, fontSize: 13, marginTop: -6 },
  requestStatusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  requestStatusPillText: { fontSize: 12, fontWeight: '700' },
  requestStatus: { gap: 8, marginTop: 2, paddingTop: 10, borderTopWidth: 1, borderTopColor: colors.border },
  requestActions: { flexDirection: 'row', gap: 10 },
  viewProfileBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 10, marginTop: 2,
  },
  viewProfileText: { color: colors.primary, fontSize: 13, fontWeight: '600' },
  approveBtn: {
    flex: 1, height: 44, backgroundColor: colors.btn,
    borderRadius: 10, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
  },
  approveBtnText: { color: colors.btnText, fontWeight: '700', fontSize: 15 },
  rejectBtn: {
    flex: 1, height: 44,
    borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 10,
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
  },
  rejectBtnText: { color: colors.textSecondary, fontWeight: '600', fontSize: 15 },
  btnDisabled: { opacity: 0.4 },
  approvedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  handoffBlock: { gap: 10 },
  qrActionBtn: {
    height: 44, backgroundColor: colors.btn, borderRadius: 10,
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
  },
  qrActionText: { color: colors.btnText, fontWeight: '700', fontSize: 15 },
  handoffSecondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reportLink: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 4 },
  reportLinkText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
  statusExpired: { color: colors.warning, fontWeight: '600', fontSize: 13 },
  // Plain-language caption shown for every rental status — what stage this is
  // and what (if anything) needs to happen next, role-aware.
  helperText: { fontSize: 13.5, color: colors.textSecondary, lineHeight: 19 },
  helperTextFlex: { flex: 1 },
  payBtn: {
    height: 44, backgroundColor: colors.btn, borderRadius: 10,
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
    width: '100%',
  },
  payBtnText: { color: colors.btnText, fontWeight: '700', fontSize: 15 },
  requestTime: { color: colors.textFaint, fontSize: 11, textAlign: 'right' },
  cancelRentalBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: colors.dangerBg, borderRadius: 8, borderWidth: 1, borderColor: colors.danger,
  },
  cancelRentalBtnText: { color: colors.danger, fontSize: 12, fontWeight: '700' },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg,
  },
  input: {
    flex: 1, minHeight: 44, maxHeight: 120,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10,
    color: colors.text, fontSize: 15,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: colors.btn, alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: colors.card },
  sendBtnText: { fontSize: 20, color: colors.btnText, fontWeight: '600', marginTop: -2 },

  tabBar: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: colors.btn },
  tabText: { fontSize: 14, color: colors.textFaint, fontWeight: '500' },
  tabTextActive: { color: colors.text, fontWeight: '600' },
  tabInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabBadge: {
    backgroundColor: colors.warning, borderRadius: 10,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: { color: colors.btnText, fontSize: 10, fontWeight: '800' },

  emptyTab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 },
  emptyTabText: { color: colors.textFaint, fontSize: 15 },

  // Meeting Point button
  meetingBtn: {
    height: 40, borderRadius: 10,
    borderWidth: 1, borderColor: colors.primary,
    flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center',
  },
  meetingBtnText: { color: colors.primary, fontWeight: '600', fontSize: 14 },

  // Dispute Modal
  modalOverlay: {
    flex: 1, backgroundColor: colors.overlay,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingBottom: 40, paddingTop: 12,
    gap: 14,
  },
  modalHandle: {
    alignSelf: 'center', width: 40, height: 4,
    borderRadius: 2, backgroundColor: colors.border, marginBottom: 6,
  },
  modalIconRow: { alignItems: 'center' },
  modalIconCircle: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center',
  },
  modalTitle: { fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center' },
  modalBody: { fontSize: 14, color: colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  arbitrationBox: {
    backgroundColor: colors.dangerBg, borderRadius: 12,
    borderLeftWidth: 3, borderLeftColor: colors.danger,
    padding: 14,
  },
  arbitrationText: { fontSize: 13, color: colors.text, lineHeight: 20, fontStyle: 'italic' },
  modalPrimaryBtn: {
    height: 52, backgroundColor: colors.btn, borderRadius: 14,
    flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center',
  },
  modalPrimaryBtnText: { color: colors.btnText, fontSize: 15, fontWeight: '700' },
  modalSecondaryBtn: { alignItems: 'center', paddingVertical: 8 },
  modalSecondaryBtnText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  modalCancelLink: { alignItems: 'center', paddingVertical: 4 },
  modalCancelLinkText: { color: colors.textFaint, fontSize: 14 },

  highlighted: {
    borderColor: colors.primary,
    borderWidth: 2,
    shadowColor: colors.primary,
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
});
