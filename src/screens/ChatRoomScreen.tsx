import { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useStripe } from '@stripe/stripe-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatsStackParamList } from '../navigation/ChatsStackNavigator';
import { supabase } from '../services/supabase';
import { chatBus } from '../services/chatBus';

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
  const { conversationId, itemTitle, otherUserName, initialText, targetTransactionId, initialTab, highlightAfterTimestamp } = route.params;
  const [activeTab, setActiveTab] = useState<'chat' | 'rental'>(initialTab ?? 'chat');
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState(initialText ?? '');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [convInfo, setConvInfo] = useState<ConversationInfo | null>(null);
  const [transactions, setTransactions] = useState<Record<string, Transaction>>({});
  const [actionLoading, setActionLoading] = useState(false);
  const [payLoading, setPayLoading] = useState(false);
  const { initPaymentSheet, presentPaymentSheet } = useStripe();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const flatListRef = useRef<FlatList<Message>>(null);

  useEffect(() => {
    let mounted = true;

    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !mounted) return;
      setCurrentUserId(user.id);

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
      if (convRes.data) setConvInfo(convRes.data as ConversationInfo);

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
        .channel(`messages:${conversationId}`)
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
      channelRef.current?.unsubscribe();
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
    if (newestUnread.transaction_id) setActiveTab('rental');
    setTimeout(() => {
      setHighlightedMessageId(newestUnread.id);
      setTimeout(() => setHighlightedMessageId(null), 1200);
    }, 150);
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

      // Payment succeeded — update transaction status to active
      await supabase
        .from('transactions')
        .update({ status: 'active' })
        .eq('id', transactionId);

      setTransactions(prev => ({
        ...prev,
        [transactionId]: { ...prev[transactionId], status: 'active' },
      }));

      const paidTx = transactions[transactionId];
      const paidDateRef = paidTx ? ` (${formatDateRange(paidTx)})` : '';
      await insertSystemMessage(`💳 Payment completed${paidDateRef}! The rental is now active.`, transactionId);
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
  const filteredMessages = messages.filter(m =>
    activeTab === 'rental' ? !!m.transaction_id : !m.transaction_id
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
      return (
        <View style={[styles.requestCard, msg.id === highlightedMessageId && styles.highlighted]}>
          <Text style={styles.requestText}>{msg.content}</Text>

          {tx && (
            <View style={styles.requestStatus}>
              {tx.status === 'pending' && isLender && (
                <View style={styles.requestActions}>
                  <TouchableOpacity
                    style={[styles.approveBtn, actionLoading && styles.btnDisabled]}
                    onPress={() => handleApprove(tx.id)}
                    disabled={actionLoading}
                  >
                    {actionLoading
                      ? <ActivityIndicator color="#000" size="small" />
                      : <Text style={styles.approveBtnText}>✓ Approve</Text>
                    }
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.rejectBtn, actionLoading && styles.btnDisabled]}
                    onPress={() => handleReject(tx.id)}
                    disabled={actionLoading}
                  >
                    <Text style={styles.rejectBtnText}>✕ Decline</Text>
                  </TouchableOpacity>
                </View>
              )}
              {tx.status === 'approved' && (
                <View style={styles.approvedRow}>
                  <Text style={styles.statusApproved}>✅ Approved</Text>
                  {!isLender && (
                    tx.approved_at && Date.now() - new Date(tx.approved_at).getTime() > 86_400_000
                      ? <Text style={styles.statusExpired}>⏱ Time exceeded</Text>
                      : (
                        <TouchableOpacity
                          style={[styles.payBtn, payLoading && styles.btnDisabled]}
                          onPress={() => handlePay(tx.id)}
                          disabled={payLoading}
                        >
                          {payLoading
                            ? <ActivityIndicator color="#000" size="small" />
                            : <Text style={styles.payBtnText}>💳 Pay Now</Text>
                          }
                        </TouchableOpacity>
                      )
                  )}
                  {isLender && canCancelTx(tx) && (
                    <TouchableOpacity
                      style={[styles.cancelRentalBtn, actionLoading && styles.btnDisabled]}
                      onPress={() => handleCancel(tx.id)}
                      disabled={actionLoading}
                    >
                      <Text style={styles.cancelRentalBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
              {tx.status === 'active' && (
                <View style={styles.approvedRow}>
                  <Text style={styles.statusActive}>💳 Paid</Text>
                  {isLender && canCancelTx(tx) && (
                    <TouchableOpacity
                      style={[styles.cancelRentalBtn, actionLoading && styles.btnDisabled]}
                      onPress={() => handleCancel(tx.id)}
                      disabled={actionLoading}
                    >
                      <Text style={styles.cancelRentalBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
              {tx.status === 'completed' && (
                <Text style={styles.statusCompleted}>✓ Completed</Text>
              )}
              {tx.status === 'rejected' && (
                <Text style={styles.statusRejected}>❌ Declined</Text>
              )}
            </View>
          )}

          <Text style={styles.requestTime}>{formatTime(msg.created_at)}</Text>
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
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName} numberOfLines={1}>{otherUserName}</Text>
          <Text style={styles.headerItem} numberOfLines={1}>📦 {itemTitle}</Text>
        </View>
        {isLender && convInfo?.item_id && (
          <TouchableOpacity
            style={styles.calendarBtn}
            onPress={() => {
              (navigation as any).getParent()?.getParent()?.navigate('Profile', {
                screen: 'ManageItem',
                params: { itemId: convInfo.item_id, itemTitle },
              });
            }}
          >
            <Text style={styles.calendarBtnText}>📅</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Tab bar */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'chat' && styles.tabActive]}
          onPress={() => setActiveTab('chat')}
        >
          <Text style={[styles.tabText, activeTab === 'chat' && styles.tabTextActive]}>💬 Chat</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'rental' && styles.tabActive]}
          onPress={() => setActiveTab('rental')}
        >
          <View style={styles.tabInner}>
            <Text style={[styles.tabText, activeTab === 'rental' && styles.tabTextActive]}>📋 Rental</Text>
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
          <ActivityIndicator color="#fff" style={{ flex: 1 }} />
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
              placeholderTextColor="#555"
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
                ? <ActivityIndicator color="#000" size="small" />
                : <Text style={styles.sendBtnText}>↑</Text>
              }
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a1a' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#2a2a2a',
    backgroundColor: '#1a1a1a',
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText: { color: '#fff', fontSize: 22, fontWeight: '300' },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 16, fontWeight: '600', color: '#fff' },
  headerItem: { fontSize: 12, color: '#666', marginTop: 1 },
  calendarBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  calendarBtnText: { fontSize: 20 },

  messageList: { padding: 16, gap: 8 },
  bubbleWrapper: { marginVertical: 2, maxWidth: '80%' },
  bubbleWrapperMe: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleWrapperThem: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMe: { backgroundColor: '#fff', borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: '#2a2a2a', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  bubbleTextMe: { color: '#000' },
  bubbleTextThem: { color: '#fff' },
  bubbleTime: { fontSize: 11, marginTop: 3, color: '#666' },
  bubbleTimeMe: { textAlign: 'right' },
  bubbleTimeThem: { textAlign: 'left' },

  // Rental request card
  requestCard: {
    alignSelf: 'center', width: '92%', marginVertical: 8,
    backgroundColor: '#1e2a3a', borderWidth: 1, borderColor: '#2a4a6a',
    borderRadius: 16, padding: 16, gap: 12,
  },
  requestText: { color: '#cce0ff', fontSize: 14, lineHeight: 20 },
  requestStatus: { gap: 8 },
  requestActions: { flexDirection: 'row', gap: 10 },
  approveBtn: {
    flex: 1, height: 44, backgroundColor: '#fff',
    borderRadius: 10, alignItems: 'center', justifyContent: 'center',
  },
  approveBtnText: { color: '#000', fontWeight: '700', fontSize: 15 },
  rejectBtn: {
    flex: 1, height: 44,
    borderWidth: 1, borderColor: '#555', borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  rejectBtnText: { color: '#aaa', fontWeight: '600', fontSize: 15 },
  btnDisabled: { opacity: 0.4 },
  approvedRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusApproved: { color: '#4caf50', fontWeight: '600', fontSize: 14 },
  statusActive: { color: '#4da6ff', fontWeight: '600', fontSize: 14 },
  statusCompleted: { color: '#666', fontWeight: '600', fontSize: 14 },
  statusExpired: { color: '#f0a500', fontWeight: '600', fontSize: 13 },
  statusRejected: { color: '#f44336', fontWeight: '600', fontSize: 14 },
  payBtn: {
    backgroundColor: '#fff', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  payBtnText: { color: '#000', fontWeight: '700', fontSize: 13 },
  requestTime: { color: '#555', fontSize: 11, textAlign: 'right' },
  cancelRentalBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: '#3a0a0a', borderRadius: 8, borderWidth: 1, borderColor: '#f44336',
  },
  cancelRentalBtnText: { color: '#f44336', fontSize: 12, fontWeight: '700' },

  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: '#2a2a2a', backgroundColor: '#1a1a1a',
  },
  input: {
    flex: 1, minHeight: 44, maxHeight: 120,
    backgroundColor: '#2a2a2a', borderWidth: 1, borderColor: '#3a3a3a',
    borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10,
    color: '#fff', fontSize: 15,
  },
  sendBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#2a2a2a' },
  sendBtnText: { fontSize: 20, color: '#000', fontWeight: '600', marginTop: -2 },

  tabBar: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#2a2a2a',
    backgroundColor: '#1a1a1a',
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#fff' },
  tabText: { fontSize: 14, color: '#555', fontWeight: '500' },
  tabTextActive: { color: '#fff', fontWeight: '600' },
  tabInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabBadge: {
    backgroundColor: '#f0a500', borderRadius: 10,
    minWidth: 18, height: 18, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 4,
  },
  tabBadgeText: { color: '#000', fontSize: 10, fontWeight: '800' },

  emptyTab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 },
  emptyTabText: { color: '#444', fontSize: 15 },

  highlighted: {
    borderColor: '#4da6ff',
    borderWidth: 2,
    shadowColor: '#4da6ff',
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 6,
  },
});
