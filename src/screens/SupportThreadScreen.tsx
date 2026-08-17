import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, TouchableOpacity,
  KeyboardAvoidingView, Platform, ActivityIndicator, type ListRenderItemInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { ChevronLeft, ArrowUp, ShieldCheck } from 'lucide-react-native';
import { supabase } from '../services/supabase';
import { chatBus } from '../services/chatBus';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';

// Reachable from both ChatsStackNavigator (a party opening their own thread
// from the rental card, or from its own row in the Chats list) and
// ProfileStackNavigator (admin opening a party's thread from the dispute/
// overdue console) — same screen either way (SAS). Only the thread's own
// user_id gets a read receipt tracked (support_threads.user_last_read_at) —
// the admin isn't a conversation participant with a read field, same
// precedent as admin_resolve_dispute's system messages. That single field is
// what feeds ConversationsContext's unread badge for this thread, so a real
// notification actually reaches the user instead of requiring them to
// stumble into "Message UseIT About This" on the rental card.
type Props = {
  navigation: any;
  route: { params: { threadId: string; title: string } };
};

type SupportMessage = {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
};

export default function SupportThreadScreen({ navigation, route }: Props) {
  const { threadId, title } = route.params;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [text, setText] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [threadUserId, setThreadUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isFocused = useIsFocused();
  const isFocusedRef = useRef(isFocused);
  isFocusedRef.current = isFocused;
  const isOwnerRef = useRef(false);

  async function markRead() {
    if (!isOwnerRef.current) return;
    await supabase.from('support_threads').update({ user_last_read_at: new Date().toISOString() }).eq('id', threadId);
    chatBus.notify();
  }

  useEffect(() => {
    let mounted = true;

    async function init() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !mounted) return;
      const myId = user.id;
      setCurrentUserId(myId);

      const [{ data: thread }, { data }] = await Promise.all([
        supabase.from('support_threads').select('user_id').eq('id', threadId).single(),
        supabase.from('support_messages').select('id, sender_id, content, created_at').eq('thread_id', threadId).order('created_at', { ascending: false }),
      ]);
      if (!mounted) return;

      if (thread) {
        setThreadUserId(thread.user_id);
        isOwnerRef.current = thread.user_id === user.id;
      }
      setMessages((data as SupportMessage[]) ?? []);
      setLoading(false);
      markRead();

      channelRef.current = supabase
        .channel(`support-thread:${threadId}:${Date.now()}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'support_messages', filter: `thread_id=eq.${threadId}` },
          (payload) => {
            if (!mounted) return;
            const newMsg = payload.new as SupportMessage;
            setMessages((prev) => prev.some(m => m.id === newMsg.id) ? prev : [newMsg, ...prev]);
            // A message arriving while this screen is already open and focused
            // must not sit "unread" until the user leaves and comes back —
            // same self-badge fix already applied to ChatRoomScreen.
            if (isFocusedRef.current && newMsg.sender_id !== myId) markRead();
          }
        )
        .subscribe();
    }

    init();
    return () => {
      mounted = false;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [threadId]);

  // Re-sync on refocus — this screen can stay mounted in the background when
  // switching bottom tabs, so a message that arrived while unfocused must be
  // marked read the moment the user actually comes back to look at it.
  useFocusEffect(useCallback(() => { if (!loading) markRead(); }, [loading]));

  async function send() {
    const content = text.trim();
    if (!content || !currentUserId || sending) return;
    setText('');
    setSending(true);
    const { data, error } = await supabase
      .from('support_messages')
      .insert({ thread_id: threadId, sender_id: currentUserId, content })
      .select('id, sender_id, content, created_at')
      .single();
    if (!error && data) {
      setMessages(prev => prev.some(m => m.id === (data as SupportMessage).id) ? prev : [data as SupportMessage, ...prev]);

      const now = new Date().toISOString();
      const isOwner = threadUserId === currentUserId;
      await supabase.from('support_threads').update({
        last_message: content,
        last_message_at: now,
        ...(isOwner ? { user_last_read_at: now } : {}),
      }).eq('id', threadId);
      chatBus.notify();
    }
    setSending(false);
  }

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function renderItem({ item: msg }: ListRenderItemInfo<SupportMessage>) {
    const isMe = msg.sender_id === currentUserId;
    return (
      <View style={[styles.bubbleWrapper, isMe ? styles.bubbleWrapperMe : styles.bubbleWrapperThem]}>
        <View style={[styles.bubble, isMe ? styles.bubbleMe : styles.bubbleThem]}>
          <Text style={[styles.bubbleText, isMe ? styles.bubbleTextMe : styles.bubbleTextThem]}>{msg.content}</Text>
        </View>
        <Text style={styles.bubbleTime}>{formatTime(msg.created_at)}</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <ChevronLeft size={26} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTitleRow}>
          <ShieldCheck size={16} color={colors.primary} />
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {loading ? (
          <ActivityIndicator color={colors.text} style={{ flex: 1 }} />
        ) : messages.length === 0 ? (
          <View style={styles.empty}>
            <ShieldCheck size={40} color={colors.textFaint} strokeWidth={1.5} />
            <Text style={styles.emptyText}>Message UseIT support about this rental</Text>
          </View>
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            inverted
            contentContainerStyle={styles.list}
          />
        )}

        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, { color: colors.text, backgroundColor: colors.card, borderColor: colors.border }]}
            placeholder="Message support…"
            placeholderTextColor={colors.textMuted}
            value={text}
            onChangeText={setText}
            multiline
          />
          <TouchableOpacity
            style={[styles.sendBtn, { backgroundColor: colors.btn }, (!text.trim() || sending) && styles.sendBtnDisabled]}
            onPress={send}
            disabled={!text.trim() || sending}
          >
            <ArrowUp size={18} color={colors.btnText} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  backBtn: { width: 36 },
  headerTitleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 40 },
  emptyText: { fontSize: 14, color: colors.textFaint, textAlign: 'center' },
  list: { padding: 16, gap: 4 },
  bubbleWrapper: { maxWidth: '80%', marginBottom: 8 },
  bubbleWrapperMe: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubbleWrapperThem: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  bubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10 },
  bubbleMe: { backgroundColor: colors.btn, borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: colors.card, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  bubbleTextMe: { color: colors.btnText },
  bubbleTextThem: { color: colors.text },
  bubbleTime: { fontSize: 10, color: colors.textFaint, marginTop: 2 },
  inputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: colors.border,
  },
  input: {
    flex: 1, borderWidth: 1, borderRadius: 18,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, maxHeight: 100,
  },
  sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
});
