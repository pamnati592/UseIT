import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Modal, Image,
  Keyboard, TouchableWithoutFeedback, type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStripe } from '@stripe/stripe-react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '../services/supabase';
import type { Database } from '../types/database';
import { formatPrice } from '../utils/format';
import { chatBus } from '../services/chatBus';
import { insertSystemMessage as sharedInsertSystemMessage } from '../services/chatMessages';
import { uploadImage, HANDOFF_EVIDENCE_BUCKET, disputePhotoPath } from '../services/storage';
import { useTheme } from '../theme/ThemeContext';
import { useAdminMode } from '../contexts/AdminModeContext';
import { CategoryIcon } from '../components/CategoryIcon';
import {
  Check, X, CreditCard, Clock, ChevronLeft, Package, Calendar, MessageCircle, ClipboardList, ArrowUp,
  ScanLine, QrCode, CircleCheck, TriangleAlert, MapPin, MessageSquare, Scale, UserRound, ShoppingCart, Camera,
  ShieldCheck, Info,
} from 'lucide-react-native';
import { makeStyles } from './ChatRoomScreen.styles';
import {
  LATE_RETURN_POLICY_TEXT, STATUS_META, LATE_RETURN_META, RESOLVED_META, PURCHASE_STATUS_META,
  RENTAL_REQUEST_PREFIX, DECLINE_REASON_MIN,
  type Message, type Transaction, type AdminCharge, type Purchase, type ConversationInfo, type FeedRow, type Props,
} from './ChatRoomScreen.constants';
import {
  formatDisputeResolution, formatDateRange, daysBetweenTx, canCancelTx, lateDaysFor, chargeLabel, refundTierLabel,
} from './ChatRoomScreen.helpers';

export default function ChatRoomScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // An admin is UseIT — contacting "UseIT support" from their own rental as
  // a party makes no sense, so the button is hidden for them entirely.
  const { isAdmin } = useAdminMode();
  const { conversationId, itemTitle, otherUserName, initialText, targetTransactionId, initialTab, highlightAfterTimestamp, declineTransactionId, reportIssueTransactionId, approveTransactionId, rejectTransactionId } = route.params;
  const [activeTab, setActiveTab] = useState<'chat' | 'deal'>(initialTab ?? 'chat');
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
  const [disputeResolutions, setDisputeResolutions] = useState<Record<string, string>>({});
  const [adminCharges, setAdminCharges] = useState<Record<string, AdminCharge[]>>({});
  const [purchases, setPurchases] = useState<Record<string, Purchase>>({});
  const [actionLoading, setActionLoading] = useState(false);
  const [payLoading, setPayLoading] = useState(false);
  const [disputeModal, setDisputeModal] = useState<{ visible: boolean; transactionId: string | null; step: 1 | 2 | 3 }>({ visible: false, transactionId: null, step: 1 });
  const [disputeSubmitting, setDisputeSubmitting] = useState(false);
  const [disputePhotoAsset, setDisputePhotoAsset] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const disputePhotoUri = disputePhotoAsset?.uri ?? null;
  const [disputeText, setDisputeText] = useState('');
  const [declineModal, setDeclineModal] = useState<{ visible: boolean; transactionId: string | null }>({ visible: false, transactionId: null });
  const [declineReason, setDeclineReason] = useState('');
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const flatListRef = useRef<FlatList<FeedRow>>(null);
  // Read inside the realtime message handler below, which is set up once per
  // conversationId and would otherwise close over a stale focus value.
  const isFocused = useIsFocused();
  const isFocusedRef = useRef(isFocused);
  useEffect(() => { isFocusedRef.current = isFocused; }, [isFocused]);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !mounted) return;
      setCurrentUserId(user.id);

      supabase.from('profiles').select('full_name').eq('id', user.id).single().then(({ data }) => {
        if (data?.full_name && mounted) setCurrentUserName(data.full_name);
      });

      const [messagesRes, convRes, txRes, purchasesRes, disputesRes, chargesRes] = await Promise.all([
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
        supabase
          .from('purchases')
          .select('id, item_id, buyer_id, seller_id, price, status, created_at')
          .eq('conversation_id', conversationId),
        // Resolved disputes carry the "why" behind a cancelled/completed status
        // once an admin has ruled — surfaced on the request card instead of the
        // generic cancelled/completed text.
        supabase
          .from('disputes')
          .select('transaction_id, status, resolution, transactions!inner(conversation_id)')
          .eq('transactions.conversation_id', conversationId),
        // Damage/late-fee charges — the active-status card otherwise looks like
        // an ordinary in-progress rental even after a real charge has already
        // been placed against it.
        supabase
          .from('admin_charges')
          .select('transaction_id, reason, amount, status, created_at, transactions!inner(conversation_id)')
          .eq('transactions.conversation_id', conversationId),
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

      const disputeMap: Record<string, string> = {};
      (disputesRes.data as any[] ?? []).forEach(d => {
        if (d.status === 'resolved' && d.resolution) disputeMap[d.transaction_id] = d.resolution;
      });
      setDisputeResolutions(disputeMap);

      const chargeMap: Record<string, AdminCharge[]> = {};
      (chargesRes.data as any[] ?? []).forEach(c => {
        (chargeMap[c.transaction_id] ??= []).push({ reason: c.reason, amount: c.amount, status: c.status, created_at: c.created_at });
      });
      setAdminCharges(chargeMap);

      const purchaseMap: Record<string, Purchase> = {};
      (purchasesRes.data as Purchase[] ?? []).forEach(p => { purchaseMap[p.id] = p; });
      setPurchases(purchaseMap);

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
            // Without this, the global Chats badge ticks up for a conversation
            // the user is already looking at — a message arriving here updates
            // the visible screen, but nothing else marked it read.
            if (isFocusedRef.current) {
              await markAsRead(user.id);
              chatBus.notify();
            }
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'transactions', filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            if (!mounted) return;
            const row = payload.new as Transaction | null;
            if (!row?.id) return;
            // Push status straight from the transaction row. Previously this only
            // arrived as a side effect of the accompanying system message, so an
            // approve/pay by the other party left this screen stale until remount.
            setTransactions((prev) => ({
              ...prev,
              [row.id]: {
                id: row.id,
                status: row.status,
                start_date: row.start_date,
                end_date: row.end_date,
                total_price: row.total_price,
                approved_at: row.approved_at,
              },
            }));
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'purchases', filter: `conversation_id=eq.${conversationId}` },
          (payload) => {
            if (!mounted) return;
            const p = payload.new as Purchase;
            setPurchases((prev) => ({ ...prev, [p.id]: p }));
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

  // Safety net for the realtime subscription: an event can still be missed if the
  // app was backgrounded, the socket dropped, or a row changed in the window before
  // .subscribe() completed. Re-syncing on focus does automatically what leaving the
  // chat and re-entering it used to do by hand — and covers the return trip from the
  // QR screens, where the status changes while this screen is unmounted from view.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        const [txRes, purchasesRes, disputesRes, chargesRes] = await Promise.all([
          supabase
            .from('transactions')
            .select('id, status, start_date, end_date, total_price, approved_at')
            .eq('conversation_id', conversationId),
          supabase
            .from('purchases')
            .select('id, item_id, buyer_id, seller_id, price, status, created_at')
            .eq('conversation_id', conversationId),
          supabase
            .from('disputes')
            .select('transaction_id, status, resolution, transactions!inner(conversation_id)')
            .eq('transactions.conversation_id', conversationId),
          supabase
            .from('admin_charges')
            .select('transaction_id, reason, amount, status, created_at, transactions!inner(conversation_id)')
            .eq('transactions.conversation_id', conversationId),
        ]);
        if (!active) return;
        if (txRes.data) {
          setTransactions((prev) => {
            const next = { ...prev };
            (txRes.data as Transaction[]).forEach((tx) => { next[tx.id] = tx; });
            return next;
          });
        }
        if (purchasesRes.data) {
          setPurchases((prev) => {
            const next = { ...prev };
            (purchasesRes.data as Purchase[]).forEach((p) => { next[p.id] = p; });
            return next;
          });
        }
        if (disputesRes.data) {
          const disputeMap: Record<string, string> = {};
          (disputesRes.data as any[]).forEach(d => {
            if (d.status === 'resolved' && d.resolution) disputeMap[d.transaction_id] = d.resolution;
          });
          setDisputeResolutions((prev) => ({ ...prev, ...disputeMap }));
        }
        if (chargesRes.data) {
          const chargeMap: Record<string, AdminCharge[]> = {};
          (chargesRes.data as any[]).forEach(c => {
            (chargeMap[c.transaction_id] ??= []).push({ reason: c.reason, amount: c.amount, status: c.status, created_at: c.created_at });
          });
          setAdminCharges((prev) => ({ ...prev, ...chargeMap }));
        }

        // Read status deserves the same safety net: the one-time mount effect's
        // markAsRead doesn't fire again when an already-mounted screen (e.g. this
        // tab kept alive in the background by the bottom tab navigator) regains
        // focus — which left a conversation stuck "unread" even while visible.
        const { data: { user } } = await supabase.auth.getUser();
        if (active && user) {
          await markAsRead(user.id);
          chatBus.notify();
        }
      })();
      return () => { active = false; };
    }, [conversationId])
  );

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
      setActiveTab('deal');
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
    const update: Pick<Database['public']['Tables']['conversations']['Update'], 'renter_last_read_at' | 'lender_last_read_at'> = { [field]: new Date().toISOString() };
    await supabase.from('conversations').update(update).eq('id', conversationId);
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
      // last_message_at and the sender's own last_read_at land in one update, not
      // two sequential ones — a gap between them is a real window where any
      // listener (including the sender's own device) sees "unread" for a message
      // that was just sent, self-correcting a moment later as a visible flash.
      const readField = convInfo?.lender_id === currentUserId ? 'lender_last_read_at' : 'renter_last_read_at';
      const update: Pick<Database['public']['Tables']['conversations']['Update'], 'last_message' | 'last_message_at' | 'renter_last_read_at' | 'lender_last_read_at'> = { last_message: content, last_message_at: now, [readField]: now };
      await supabase.from('conversations').update(update).eq('id', conversationId);
      chatBus.notify();
    }
    setSending(false);
  }

  // Update conversation timestamp BEFORE inserting the message so that when the
  // realtime UPDATE event fires, ConversationsContext already sees the updated
  // last_message_at. `preview` is what the Chats list shows. The full `content` is the record kept on
  // the message row, but it reads as a paragraph in a one-line list, so status changes
  // pass a short summary instead: what changed, and what happens next. It has to stay
  // role-neutral — both parties read the same conversations.last_message string.
  async function insertSystemMessage(content: string, transactionId: string, preview?: string) {
    if (!currentUserId) return;
    await sharedInsertSystemMessage({
      conversationId,
      transactionId,
      userId: currentUserId,
      isLender: convInfo?.lender_id === currentUserId,
      content,
      preview,
    });
  }

  async function handleCancel(transactionId: string) {
    const tx = transactions[transactionId];
    if (!tx) return;
    const isPaid = tx.status === 'paid';
    const dateRef = formatDateRange(tx);

    Alert.alert(
      'Cancel this rental?',
      isPaid
        ? `${dateRef} will be cancelled. The renter will receive ${refundTierLabel(tx.start_date)}.`
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

              let refundMsg = 'No payment was taken.';
              if (isPaid) {
                const { data, error: refundError } = await supabase.functions.invoke('refund-payment', {
                  body: { transaction_id: transactionId, reason: 'lender_cancelled' },
                });
                if (refundError) throw refundError;
                const pct = data?.percentage ?? 0;
                refundMsg = pct === 100
                  ? 'You will receive a full refund.'
                  : pct > 0
                    ? `You will receive a ${pct}% refund.`
                    : 'No refund applies — this was cancelled less than 4 hours before the rental start.';
              }

              const msg = `⚠️ Your rental (${dateRef}) has been cancelled by the lender. ${refundMsg}`;
              await insertSystemMessage(msg, transactionId, '⚠️ Rental cancelled');
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
      await insertSystemMessage(`✅ Request approved${dateRef}! Payment is due within 24 hours.`, transactionId, '✅ Approved · Payment due');
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
      await insertSystemMessage(`❌ Request declined${dateRef}.`, transactionId, '❌ Request declined');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setActionLoading(false);
    }
  }

  function handleReportIssue(transactionId: string) {
    setDisputePhotoAsset(null);
    setDisputeText('');
    setDisputeModal({ visible: true, transactionId, step: 1 });
  }

  // QRDisplayScreen and QRScanScreen's return flow both route here rather than
  // collecting evidence themselves — this is the one canonical dispute screen (SAS).
  // Skipped for an admin (see isAdmin above) — it opens the same modal as the
  // Get Help button, "Message UseIT" included.
  useEffect(() => {
    if (!reportIssueTransactionId || isAdmin) return;
    handleReportIssue(reportIssueTransactionId);
    navigation.setParams({ reportIssueTransactionId: undefined });
  }, [reportIssueTransactionId, isAdmin]);

  function handleDeclineAtPickup(transactionId: string) {
    setDeclineReason('');
    setDeclineModal({ visible: true, transactionId });
  }

  // The renter bailed out of the pickup scan because the item was wrong. QRScanScreen
  // routes back here with the transaction id rather than running its own decline, so
  // the action still executes in exactly one place. Params are cleared afterwards so a
  // later re-render doesn't reopen the modal.
  useEffect(() => {
    if (!declineTransactionId) return;
    handleDeclineAtPickup(declineTransactionId);
    navigation.setParams({ declineTransactionId: undefined });
  }, [declineTransactionId]);

  // PublicProfileScreen's "View profile" shortcut routes the approve/reject
  // decision back here rather than updating the transaction itself, so the
  // system-message + unread-badge side effects only ever fire from this one
  // canonical place (SAS).
  useEffect(() => {
    if (!approveTransactionId) return;
    handleApprove(approveTransactionId);
    navigation.setParams({ approveTransactionId: undefined });
  }, [approveTransactionId]);

  useEffect(() => {
    if (!rejectTransactionId) return;
    handleReject(rejectTransactionId);
    navigation.setParams({ rejectTransactionId: undefined });
  }, [rejectTransactionId]);

  async function confirmDeclineAtPickup() {
    const transactionId = declineModal.transactionId;
    if (!transactionId || declineReason.trim().length < DECLINE_REASON_MIN) return;
    const reason = declineReason.trim();
    setDeclineModal({ visible: false, transactionId: null });
    setActionLoading(true);
    try {
      const { error } = await supabase.rpc('decline_at_pickup', { p_tx: transactionId, p_reason: reason });
      if (error) throw error;
      setTransactions(prev => ({ ...prev, [transactionId]: { ...prev[transactionId], status: 'cancelled' } }));
      const tx = transactions[transactionId];
      const dateRef = tx ? ` (${formatDateRange(tx)})` : '';

      // The renter never took the item, so this is a full refund regardless of
      // timing — not a cancellation-tier case.
      const { error: refundError } = await supabase.functions.invoke('refund-payment', {
        body: { transaction_id: transactionId, reason: 'declined_at_pickup' },
      });
      const refundMsg = refundError ? '' : ' You will receive a full refund.';

      // The reason goes into the chat, not just the disputes table: a decline that the
      // lender can see and answer is a much stronger deterrent to casual cancellation
      // than one that silently disappears into an admin queue.
      await insertSystemMessage(
        `⚠️ ${currentUserName} declined the item at pickup${dateRef}. Reason: "${reason}". The rental was cancelled and the dates are free again.${refundMsg}`,
        transactionId,
        '⚠️ Item declined at pickup',
      );
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not decline the item.');
    } finally {
      setActionLoading(false);
    }
  }

  async function confirmDispute() {
    // Uploading the photo takes long enough to tap Submit twice — guard against a
    // duplicate dispute row from a double-tap, the same bug fixed for QR handoffs.
    if (disputeSubmitting) return;
    const transactionId = disputeModal.transactionId;
    if (!transactionId) return;
    setDisputeSubmitting(true);
    try {
      let photoPath: string | null = null;
      if (disputePhotoAsset?.base64) {
        photoPath = await uploadImage(
          HANDOFF_EVIDENCE_BUCKET,
          disputePhotoPath(transactionId),
          { base64: disputePhotoAsset.base64, mimeType: disputePhotoAsset.mimeType ?? 'image/jpeg' },
        );
      }
      const { error } = await supabase.rpc('report_issue', {
        p_tx: transactionId,
        p_description: disputeText.trim() || undefined,
        p_photo_url: photoPath ?? undefined,
      });
      if (error) throw error;

      setDisputeModal({ visible: false, transactionId: null, step: 1 });
      setTransactions(prev => ({ ...prev, [transactionId]: { ...prev[transactionId], status: 'disputed' } }));
      const tx = transactions[transactionId];
      const dateRef = tx ? ` (${formatDateRange(tx)})` : '';
      await insertSystemMessage(
        `⚠️ An issue was escalated to UseIT Arbitration${dateRef}. Both parties have agreed to accept the platform's binding decision. Funds are held in escrow pending review.`,
        transactionId,
        '⚠️ Issue escalated · Under review',
      );
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not submit dispute.');
    } finally {
      setDisputeSubmitting(false);
    }
  }

  async function handleMessageSupport(transactionId: string) {
    try {
      const { data: threadId, error } = await supabase.rpc('ensure_support_thread', { p_transaction_id: transactionId });
      if (error) throw error;
      navigation.navigate('SupportThread', { threadId: threadId as string, title: `UseIT · ${itemTitle}` });
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not open support chat.');
    }
  }

  async function handlePay(transactionId: string) {
    // Rentals save the payment method for off-session use automatically (not an
    // opt-in checkbox in the sheet below, since setup_future_usage is now always
    // set server-side) — disclosed here, before the sheet opens, since the sheet
    // itself won't show a "save card" toggle to make that visible.
    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'Card kept on file',
        'Your card will be securely saved so UseIT can charge it later for a late-return fee or assessed damage, if any. You\'ll always be notified in chat before or when this happens.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Continue to Payment', onPress: () => resolve(true) },
        ]
      );
    });
    if (!confirmed) return;

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
      const { client_secret, customer_id, ephemeral_key, error: fnError } = await res.json();
      if (fnError) throw new Error(fnError);

      // Initialise the payment sheet with the client secret. Passing customer +
      // ephemeral key lets the sheet offer "save this card" and show it saved on
      // future payments instead of retyping card number/expiry/CVC every time.
      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'UseIT',
        paymentIntentClientSecret: client_secret,
        customerId: customer_id,
        customerEphemeralKeySecret: ephemeral_key,
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
      await insertSystemMessage(`💳 Payment completed${paidDateRef}! Show the pickup QR at handover.`, transactionId, '💳 Paid · Ready for pickup');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setPayLoading(false);
    }
  }

  // Buyer confirms they have the item in hand and pays — this button IS the
  // "we met, here's the money" moment, not a remote pay-anytime action.
  async function handlePayPurchase(purchaseId: string) {
    setPayLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await fetch(
        `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/create-payment-intent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ purchase_id: purchaseId }),
        }
      );
      const { client_secret, customer_id, ephemeral_key, error: fnError } = await res.json();
      if (fnError) throw new Error(fnError);

      const { error: initError } = await initPaymentSheet({
        merchantDisplayName: 'UseIT',
        paymentIntentClientSecret: client_secret,
        customerId: customer_id,
        customerEphemeralKeySecret: ephemeral_key,
        defaultBillingDetails: { name: '' },
      });
      if (initError) throw new Error(initError.message);

      const { error: presentError } = await presentPaymentSheet();
      if (presentError) {
        if (presentError.code !== 'Canceled') Alert.alert('Payment failed', presentError.message);
        return;
      }

      const { error } = await supabase.rpc('mark_purchase_paid', { p_purchase: purchaseId });
      if (error) throw error;

      setPurchases(prev => ({ ...prev, [purchaseId]: { ...prev[purchaseId], status: 'paid' } }));
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setPayLoading(false);
    }
  }

  async function handleApprovePurchase(purchaseId: string) {
    setActionLoading(true);
    try {
      // approve_purchase sets the caller's own last_read_at atomically alongside
      // last_message_at server-side — no client round-trip needed, and no race
      // window where the approver's own badge flashes unread for their own action.
      const { error } = await supabase.rpc('approve_purchase', { p_purchase: purchaseId });
      if (error) throw error;
      setPurchases(prev => ({ ...prev, [purchaseId]: { ...prev[purchaseId], status: 'approved' } }));
      chatBus.notify();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleRejectPurchase(purchaseId: string) {
    setActionLoading(true);
    try {
      const { error } = await supabase.rpc('reject_purchase', { p_purchase: purchaseId });
      if (error) throw error;
      setPurchases(prev => ({ ...prev, [purchaseId]: { ...prev[purchaseId], status: 'rejected' } }));
      chatBus.notify();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setActionLoading(false);
    }
  }

  function handleCancelPurchase(purchaseId: string) {
    Alert.alert(
      'Cancel this purchase?',
      'This will cancel the purchase request.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Cancel purchase',
          style: 'destructive',
          onPress: async () => {
            setActionLoading(true);
            try {
              const { error } = await supabase.rpc('cancel_purchase', { p_purchase: purchaseId });
              if (error) throw error;
              setPurchases(prev => ({ ...prev, [purchaseId]: { ...prev[purchaseId], status: 'cancelled' } }));
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
  // Deal Board tab shows one card per rental transaction + one per purchase —
  // together they're the single live status board for this conversation.
  // Status-change system messages (approve/pay/cancel/etc.) still get inserted
  // for badges/realtime, they just aren't rendered as their own bubbles.
  const feedRows: FeedRow[] = activeTab === 'chat'
    ? messages.filter(m => !m.transaction_id).map(m => ({ kind: 'chat', key: m.id, msg: m }))
    : [
        ...messages
          .filter(m => !!m.transaction_id && m.content.startsWith(RENTAL_REQUEST_PREFIX))
          .map(m => ({ kind: 'rental' as const, key: m.id, msg: m, tx: findTxForMessage(m) })),
        ...Object.values(purchases).map(p => ({ kind: 'purchase' as const, key: p.id, purchase: p })),
      ].sort((a, b) => {
        const at = a.kind === 'purchase' ? a.purchase.created_at : a.msg.created_at;
        const bt = b.kind === 'purchase' ? b.purchase.created_at : b.msg.created_at;
        return new Date(bt).getTime() - new Date(at).getTime();
      });

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

  function renderFeedRow({ item: row }: { item: FeedRow }) {
    if (row.kind === 'chat') {
      const msg = row.msg;
      const isMe = msg.sender_id === currentUserId;
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

    if (row.kind === 'purchase') {
      const purchase = row.purchase;
      const statusMeta = PURCHASE_STATUS_META[purchase.status];
      return (
        <View style={[styles.requestCard, purchase.id === highlightedMessageId && styles.highlighted]}>
          <View style={styles.requestHeader}>
            <View style={styles.requestHeaderLeft}>
              <ShoppingCart size={16} color={colors.primary} strokeWidth={2.2} />
              <Text style={styles.requestDateText} numberOfLines={1}>{itemTitle}</Text>
            </View>
            <View style={[styles.requestStatusPill, { backgroundColor: statusMeta.bg }]}>
              <Text style={[styles.requestStatusPillText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
            </View>
          </View>
          <Text style={styles.requestSubText}>{formatPrice(purchase.price)}</Text>

          <View style={styles.requestStatus}>
            {purchase.status === 'pending' && (
              isLender ? (
                <View style={styles.requestActions}>
                  <TouchableOpacity
                    style={[styles.approveBtn, actionLoading && styles.btnDisabled]}
                    onPress={() => handleApprovePurchase(purchase.id)}
                    disabled={actionLoading}
                  >
                    {actionLoading
                      ? <ActivityIndicator color={colors.btnText} size="small" />
                      : <><Check size={16} color={colors.btnText} strokeWidth={2.5} /><Text style={styles.approveBtnText}>Approve</Text></>
                    }
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.rejectBtn, actionLoading && styles.btnDisabled]}
                    onPress={() => handleRejectPurchase(purchase.id)}
                    disabled={actionLoading}
                  >
                    <X size={16} color={colors.textSecondary} strokeWidth={2.5} />
                    <Text style={styles.rejectBtnText}>Decline</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <Text style={styles.helperText}>⏳ Waiting for {otherUserName} to approve your request.</Text>
              )
            )}
            {purchase.status === 'approved' && (
              isLender ? (
                <View style={styles.approvedRow}>
                  <Text style={[styles.helperText, styles.helperTextFlex]}>Waiting for {otherUserName} to pick up and pay.</Text>
                  <TouchableOpacity
                    style={[styles.cancelRentalBtn, actionLoading && styles.btnDisabled]}
                    onPress={() => handleCancelPurchase(purchase.id)}
                    disabled={actionLoading}
                  >
                    <Text style={styles.cancelRentalBtnText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={styles.helperText}>Pay {otherUserName} in person when you receive the item — not before.</Text>
                  <TouchableOpacity
                    style={[styles.qrActionBtn, payLoading && styles.btnDisabled]}
                    onPress={() => handlePayPurchase(purchase.id)}
                    disabled={payLoading}
                  >
                    {payLoading
                      ? <ActivityIndicator color={colors.btnText} size="small" />
                      : <><ShoppingCart size={16} color={colors.btnText} /><Text style={styles.qrActionText}>I Have the Item — Pay Now</Text></>
                    }
                  </TouchableOpacity>
                </>
              )
            )}
            {purchase.status === 'rejected' && (
              <Text style={styles.helperText}>❌ This request was declined.</Text>
            )}
            {purchase.status === 'paid' && (
              <Text style={styles.helperText}>✅ Purchased — thanks for using UseIT.</Text>
            )}
            {purchase.status === 'cancelled' && (
              <Text style={styles.helperText}>❌ This purchase was cancelled.</Text>
            )}
          </View>

          <Text style={styles.requestTime}>Requested {formatTime(purchase.created_at)}</Text>
        </View>
      );
    }

    // row.kind === 'rental'
    {
      const msg = row.msg;
      const tx = row.tx;
      const isLateReturn = !!tx && tx.status === 'active' && lateDaysFor(tx) > 0;
      const isResolved = !!tx && !!disputeResolutions[tx.id];
      const statusMeta = tx ? (isResolved ? RESOLVED_META : isLateReturn ? LATE_RETURN_META : STATUS_META[tx.status]) : null;
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
              <View style={styles.requestStatusRight}>
                {isResolved && (
                  <TouchableOpacity onPress={() => Alert.alert('Dispute Resolution', formatDisputeResolution(disputeResolutions[tx.id]))}>
                    <Info size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
                {!isResolved && isLateReturn && (
                  <TouchableOpacity onPress={() => Alert.alert('Late Return Policy', LATE_RETURN_POLICY_TEXT)}>
                    <Info size={16} color={colors.textMuted} />
                  </TouchableOpacity>
                )}
                <View style={[styles.requestStatusPill, { backgroundColor: statusMeta.bg }]}>
                  <Text style={[styles.requestStatusPillText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
                </View>
              </View>
            )}
          </View>
          {tx && (
            <Text style={styles.requestSubText}>
              {daysBetweenTx(tx)} day{daysBetweenTx(tx) > 1 ? 's' : ''} · {formatPrice(tx.total_price)}
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
                            conversationId,
                            itemTitle,
                          },
                        });
                      }}
                    >
                      <UserRound size={15} color={colors.primary} strokeWidth={2} />
                      <Text style={styles.viewProfileText}>View {otherUserName}&apos;s profile</Text>
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
                    onPress={() => navigation.navigate(isLender ? 'QRDisplay' : 'QRScan', { transactionId: tx.id, phase: 'pickup', itemTitle, otherName: otherUserName, conversationId })}
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
                    {/* The renter's only exit at the handoff. canCancelTx blocks
                        cancelling inside 48h of the start date, which is exactly when a
                        pickup happens — without this, a renter who finds the item broken
                        can only accept it or walk away with no in-app action. */}
                    {!isLender && (
                      <TouchableOpacity
                        style={[styles.cancelRentalBtn, actionLoading && styles.btnDisabled]}
                        onPress={() => handleDeclineAtPickup(tx.id)}
                        disabled={actionLoading}
                      >
                        <Text style={styles.cancelRentalBtnText}>Decline Item</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}
              {tx.status === 'active' && (() => {
                const lateDays = lateDaysFor(tx);
                const charges = adminCharges[tx.id] ?? [];
                return (
                  <View style={styles.handoffBlock}>
                    {charges.map((c, i) => (
                      <Text key={i} style={c.status === 'succeeded' ? styles.helperText : styles.overdueText}>{chargeLabel(c)}</Text>
                    ))}
                    <Text style={styles.helperText}>
                      {isLender
                        ? `Rental is active${lateDays > 0 ? ` — ${lateDays} day${lateDays > 1 ? 's' : ''} overdue` : ''} — scan ${otherUserName}'s QR when they return the item.`
                        : `Rental is active${lateDays > 0 ? ` — ${lateDays} day${lateDays > 1 ? 's' : ''} overdue` : ''} — show this QR when you return the item.`}
                    </Text>
                    <TouchableOpacity
                      style={styles.qrActionBtn}
                      onPress={() => navigation.navigate(isLender ? 'QRScan' : 'QRDisplay', { transactionId: tx.id, phase: 'return', itemTitle, otherName: otherUserName, conversationId })}
                    >
                      {isLender
                        ? <><ScanLine size={16} color={colors.btnText} /><Text style={styles.qrActionText}>Scan to Complete</Text></>
                        : <><QrCode size={16} color={colors.btnText} /><Text style={styles.qrActionText}>Show Return QR</Text></>}
                    </TouchableOpacity>
                  </View>
                );
              })()}
              {tx.status === 'completed' && (
                <>
                  {!disputeResolutions[tx.id] && <Text style={styles.helperText}>✅ This rental has been completed.</Text>}
                  {(adminCharges[tx.id] ?? []).map((c, i) => (
                    <Text key={i} style={c.status === 'succeeded' ? styles.helperText : styles.overdueText}>{chargeLabel(c)}</Text>
                  ))}
                </>
              )}
              {tx.status === 'rejected' && (
                <Text style={styles.helperText}>❌ This request was declined.</Text>
              )}
              {tx.status === 'disputed' && (
                <Text style={styles.helperText}>⚠️ This rental is under review by UseIT support.</Text>
              )}
              {tx.status === 'cancelled' && !disputeResolutions[tx.id] && (
                <Text style={styles.helperText}>⚠️ This rental was cancelled — refund processed per policy.</Text>
              )}
              {!isAdmin && (
                tx.status === 'paid'
                || tx.status === 'active'
                || tx.status === 'disputed'
                || !!disputeResolutions[tx.id]
                || (adminCharges[tx.id]?.length ?? 0) > 0
              ) && (
                <TouchableOpacity style={styles.messageSupportBtn} onPress={() => handleReportIssue(tx.id)}>
                  <ShieldCheck size={14} color={colors.primary} />
                  <Text style={styles.messageSupportBtnText}>Get Help</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <Text style={styles.requestTime}>Requested {formatTime(msg.created_at)}</Text>
        </View>
      );
    }
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
          style={[styles.tab, activeTab === 'deal' && styles.tabActive]}
          onPress={() => setActiveTab('deal')}
        >
          <View style={styles.tabInner}>
            <ClipboardList size={15} color={activeTab === 'deal' ? colors.text : colors.textMuted} />
            <Text style={[styles.tabText, activeTab === 'deal' && styles.tabTextActive]}>Deal Board</Text>
            {actionBadgeCount > 0 && activeTab !== 'deal' && (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{actionBadgeCount}</Text>
              </View>
            )}
          </View>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {loading ? (
          <ActivityIndicator color={colors.text} style={{ flex: 1 }} />
        ) : feedRows.length === 0 ? (
          <View style={styles.emptyTab}>
            <Text style={styles.emptyTabText}>
              {activeTab === 'chat' ? 'No messages yet. Say hi!' : 'No deals yet.'}
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={feedRows}
            keyExtractor={(row) => row.key}
            inverted
            contentContainerStyle={styles.messageList}
            renderItem={renderFeedRow}
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

      {/* Dispute Modal — the one canonical "report an issue" screen (SAS). QRDisplayScreen
          and QRScanScreen's return flow both route here via reportIssueTransactionId
          rather than collecting evidence themselves. */}
      <Modal
        visible={disputeModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setDisputeModal(prev => ({ ...prev, visible: false }))}
      >
        {/* Step 3 has a multiline description field — without keyboard handling the
            sheet sits under the keyboard with no way to dismiss it. */}
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalSheet}>
            {disputeModal.step === 1 ? (
              <>
                <View style={styles.modalHandle} />
                <View style={styles.modalIconRow}>
                  <View style={[styles.modalIconCircle, { backgroundColor: colors.infoBg }]}>
                    <ShieldCheck size={24} color={colors.primary} />
                  </View>
                </View>
                <Text style={styles.modalTitle}>Get Help</Text>
                <Text style={styles.modalBody}>
                  We recommend resolving this directly with {otherUserName} first — most issues get sorted out faster in chat.
                </Text>
                <TouchableOpacity
                  style={styles.modalPrimaryBtn}
                  onPress={() => {
                    setDisputeModal(prev => ({ ...prev, visible: false }));
                    setActiveTab('chat');
                  }}
                >
                  <MessageSquare size={16} color={colors.btnText} />
                  <Text style={styles.modalPrimaryBtnText}>Back to Chat</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalOutlineBtn}
                  onPress={() => {
                    const id = disputeModal.transactionId;
                    setDisputeModal(prev => ({ ...prev, visible: false }));
                    if (id) handleMessageSupport(id);
                  }}
                >
                  <ShieldCheck size={16} color={colors.primary} />
                  <Text style={styles.modalOutlineBtnText}>Message UseIT</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalSecondaryBtn}
                  onPress={() => setDisputeModal(prev => ({ ...prev, step: 2 }))}
                >
                  <Text style={styles.modalSecondaryBtnText}>Report a Problem →</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setDisputeModal(prev => ({ ...prev, visible: false }))} style={styles.modalCancelLink}>
                  <Text style={styles.modalCancelLinkText}>Cancel</Text>
                </TouchableOpacity>
              </>
            ) : disputeModal.step === 2 ? (
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
                    &quot;By proceeding, both parties agree to accept UseIT&apos;s binding decision regarding this dispute. The platform will review evidence from both sides and issue a final ruling within 48 hours. Payment remains in escrow until resolved.&quot;
                  </Text>
                </View>
                <Text style={styles.modalBody}>
                  This action cannot be undone. The dispute will be assigned to a UseIT mediator immediately.
                </Text>
                <TouchableOpacity
                  style={[styles.modalPrimaryBtn, { backgroundColor: colors.danger }]}
                  onPress={() => setDisputeModal(prev => ({ ...prev, step: 3 }))}
                >
                  <Scale size={16} color={colors.white} />
                  <Text style={[styles.modalPrimaryBtnText, { color: colors.white }]}>I Agree — Continue</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalSecondaryBtn}
                  onPress={() => setDisputeModal(prev => ({ ...prev, step: 1 }))}
                >
                  <Text style={styles.modalSecondaryBtnText}>← Go back</Text>
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
                <Text style={styles.modalTitle}>Document the Issue</Text>
                <Text style={styles.modalBody}>Describe what&apos;s wrong — this is what the UseIT mediator will review. If something is damaged, a photo makes the case much stronger, but it isn&apos;t required for every kind of issue.</Text>

                {disputePhotoUri ? (
                  <Image source={{ uri: disputePhotoUri }} style={styles.disputePreview} resizeMode="cover" />
                ) : (
                  <TouchableOpacity
                    style={styles.disputeCameraTile}
                    onPress={async () => {
                      const { status } = await ImagePicker.requestCameraPermissionsAsync();
                      if (status !== 'granted') return;
                      const r = await ImagePicker.launchCameraAsync({ quality: 0.75, base64: true });
                      if (!r.canceled && r.assets[0]) setDisputePhotoAsset(r.assets[0]);
                    }}
                  >
                    <Camera size={32} color={colors.textMuted} strokeWidth={1.5} />
                    <Text style={styles.cameraTileText}>Add a photo (optional) — recommended if something&apos;s damaged</Text>
                  </TouchableOpacity>
                )}

                <TextInput
                  style={[styles.disputeInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
                  placeholder="Describe what's wrong…"
                  placeholderTextColor={colors.textMuted}
                  value={disputeText}
                  onChangeText={setDisputeText}
                  multiline
                  numberOfLines={3}
                />

                <TouchableOpacity
                  style={[styles.modalPrimaryBtn, { backgroundColor: colors.danger, opacity: (!disputeText.trim() || disputeSubmitting) ? 0.45 : 1 }]}
                  onPress={confirmDispute}
                  disabled={!disputeText.trim() || disputeSubmitting}
                >
                  {disputeSubmitting ? (
                    <ActivityIndicator color={colors.white} />
                  ) : (
                    <>
                      <Scale size={16} color={colors.white} />
                      <Text style={[styles.modalPrimaryBtnText, { color: colors.white }]}>Submit Dispute</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalSecondaryBtn}
                  onPress={() => setDisputeModal(prev => ({ ...prev, step: 2 }))}
                >
                  <Text style={styles.modalSecondaryBtnText}>← Go back</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
          </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </Modal>

      {/* ── Decline at pickup ── */}
      <Modal
        visible={declineModal.visible}
        transparent
        animationType="slide"
        onRequestClose={() => setDeclineModal({ visible: false, transactionId: null })}
      >
        {/* Tapping the dimmed area dismisses the keyboard. Without this there is no way
            to put it away at all: the sheet is bottom-anchored, the field is multiline
            so Return inserts a newline rather than submitting, and on Android there is
            no "Done" key to fall back on. */}
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <KeyboardAvoidingView
            style={styles.modalOverlay}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <View style={styles.modalSheet}>
            <View style={styles.modalHandle} />
            <View style={[styles.modalIconCircle, { backgroundColor: colors.warningBg, alignSelf: 'center' }]}>
              <TriangleAlert size={24} color={colors.warning} />
            </View>
            <Text style={styles.modalTitle}>Decline this item?</Text>
            <Text style={styles.modalBody}>
              Only do this before you take the item. The rental is cancelled, the dates are freed,
              and {otherUserName} will see your reason.
            </Text>

            <TextInput
              style={[styles.declineInput, { color: colors.text, borderColor: colors.border, backgroundColor: colors.card }]}
              placeholder="Why are you declining? e.g. lens is cracked, parts missing…"
              placeholderTextColor={colors.textMuted}
              value={declineReason}
              onChangeText={setDeclineReason}
              multiline
              numberOfLines={3}
            />
            <Text style={styles.declineHint}>
              {declineReason.trim().length < DECLINE_REASON_MIN
                ? `${DECLINE_REASON_MIN - declineReason.trim().length} more characters needed`
                : 'Reason will be shown to the lender'}
            </Text>

            <TouchableOpacity
              style={[
                styles.modalPrimaryBtn,
                { backgroundColor: colors.danger },
                declineReason.trim().length < DECLINE_REASON_MIN && styles.btnDisabled,
              ]}
              onPress={confirmDeclineAtPickup}
              disabled={declineReason.trim().length < DECLINE_REASON_MIN || actionLoading}
            >
              <Text style={[styles.modalPrimaryBtnText, { color: colors.white }]}>Decline Item</Text>
            </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalCancelLink}
                onPress={() => setDeclineModal({ visible: false, transactionId: null })}
              >
                <Text style={styles.modalCancelLinkText}>Keep rental</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </TouchableWithoutFeedback>
      </Modal>
    </SafeAreaView>
  );
}
