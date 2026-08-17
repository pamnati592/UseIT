import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { supabase } from '../services/supabase';
import { chatBus } from '../services/chatBus';

export type ConversationRow = {
  id: string;
  renter_id: string;
  lender_id: string;
  last_message: string | null;
  last_message_at: string | null;
  renter_last_read_at: string | null;
  lender_last_read_at: string | null;
  item_title: string;
  renter_name: string;
  lender_name: string;
};

function computeIsUnread(conv: ConversationRow, userId: string | null): boolean {
  if (!userId || !conv.last_message_at) return false;
  const myLastRead = conv.renter_id === userId ? conv.renter_last_read_at : conv.lender_last_read_at;
  if (!myLastRead) return true;
  return new Date(conv.last_message_at) > new Date(myLastRead);
}

// Support threads (UseIT <-> one party, scoped to one rental) previously had
// no notification signal at all — folding them into this same unread system
// (requested 2026-08-17) means a message from UseIT now lights up the same
// red/yellow badges as a real conversation, instead of requiring the user to
// stumble into "Message UseIT About This" on the rental card to find out.
export type SupportThreadRow = {
  id: string;
  transactionId: string;
  itemTitle: string;
  role: 'renter' | 'lender';
  lastMessage: string | null;
  lastMessageAt: string | null;
  userLastReadAt: string | null;
};

function computeSupportUnread(thread: SupportThreadRow): boolean {
  if (!thread.lastMessageAt) return false;
  if (!thread.userLastReadAt) return true;
  return new Date(thread.lastMessageAt) > new Date(thread.userLastReadAt);
}

type ConversationsContextValue = {
  conversations: ConversationRow[];
  supportThreads: SupportThreadRow[];
  currentUserId: string | null;
  loading: boolean;
  rentingConversations: ConversationRow[];
  lendingConversations: ConversationRow[];
  rentingSupportThreads: SupportThreadRow[];
  lendingSupportThreads: SupportThreadRow[];
  rentingUnreadCount: number;
  lendingUnreadCount: number;
  totalUnreadCount: number;
  isUnread: (conv: ConversationRow) => boolean;
  isSupportThreadUnread: (thread: SupportThreadRow) => boolean;
  reload: () => void;
};

const ConversationsContext = createContext<ConversationsContextValue | null>(null);

// Single source of truth for every unread signal in the app — the bottom tab
// badge (red), the Renting/Lending sub-tab badges (yellow), and each
// conversation's green dot all read from this one live-updating list, so
// they can never drift out of sync with each other. Previously the badge had
// its own realtime subscription while the Chats list only refetched on
// screen focus, with no live update at all — this replaces both with one
// listener mounted once at the app root (backlog P).
export function ConversationsProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [supportThreads, setSupportThreads] = useState<SupportThreadRow[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const userIdRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    let userId = userIdRef.current;
    if (!userId) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      userId = user.id;
      userIdRef.current = userId;
      setCurrentUserId(userId);
    }

    const [{ data, error }, { data: threadsData, error: threadsError }] = await Promise.all([
      supabase
        .from('conversations')
        .select(`
          id, renter_id, lender_id, last_message, last_message_at,
          renter_last_read_at, lender_last_read_at,
          items(title),
          renter:profiles!conversations_renter_id_fkey(full_name),
          lender:profiles!conversations_lender_id_fkey(full_name)
        `)
        .order('last_message_at', { ascending: false }),
      supabase
        .from('support_threads')
        .select(`
          id, transaction_id, last_message, last_message_at, user_last_read_at,
          transactions!inner(renter_id, lender_id, items(title))
        `)
        .eq('user_id', userId),
    ]);

    if (!error && data) {
      setConversations(
        (data as any[]).map((c) => ({
          id: c.id,
          renter_id: c.renter_id,
          lender_id: c.lender_id,
          last_message: c.last_message,
          last_message_at: c.last_message_at,
          renter_last_read_at: c.renter_last_read_at,
          lender_last_read_at: c.lender_last_read_at,
          item_title: c.items?.title ?? 'Item',
          renter_name: c.renter?.full_name ?? 'Renter',
          lender_name: c.lender?.full_name ?? 'Lender',
        }))
      );
    }
    if (!threadsError && threadsData) {
      setSupportThreads(
        (threadsData as any[]).map((t) => ({
          id: t.id,
          transactionId: t.transaction_id,
          itemTitle: t.transactions?.items?.title ?? 'Item',
          role: t.transactions?.renter_id === userId ? 'renter' as const : 'lender' as const,
          lastMessage: t.last_message,
          lastMessageAt: t.last_message_at,
          userLastReadAt: t.user_last_read_at,
        }))
      );
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    load();

    const unsubBus = chatBus.subscribe(load);

    // conversations.last_message_at / *_last_read_at is the actual field every
    // unread computation reads — watching it directly is both more precise and
    // cheaper than the old approach of watching every messages INSERT app-wide.
    // support_threads gets the same treatment now that it carries its own
    // last_message_at/user_last_read_at (2026-08-17).
    const channel = supabase
      .channel(`conversations-watch-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
        if (mounted) load();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'support_threads' }, () => {
        if (mounted) load();
      })
      .subscribe();

    return () => {
      mounted = false;
      unsubBus();
      supabase.removeChannel(channel);
    };
  }, [load]);

  const rentingConversations = useMemo(
    () => conversations.filter(c => c.renter_id === currentUserId),
    [conversations, currentUserId]
  );
  const lendingConversations = useMemo(
    () => conversations.filter(c => c.lender_id === currentUserId),
    [conversations, currentUserId]
  );
  const rentingSupportThreads = useMemo(
    () => supportThreads.filter(t => t.role === 'renter'),
    [supportThreads]
  );
  const lendingSupportThreads = useMemo(
    () => supportThreads.filter(t => t.role === 'lender'),
    [supportThreads]
  );
  const rentingUnreadCount = useMemo(
    () => rentingConversations.filter(c => computeIsUnread(c, currentUserId)).length
      + rentingSupportThreads.filter(computeSupportUnread).length,
    [rentingConversations, rentingSupportThreads, currentUserId]
  );
  const lendingUnreadCount = useMemo(
    () => lendingConversations.filter(c => computeIsUnread(c, currentUserId)).length
      + lendingSupportThreads.filter(computeSupportUnread).length,
    [lendingConversations, lendingSupportThreads, currentUserId]
  );

  const value: ConversationsContextValue = {
    conversations,
    supportThreads,
    currentUserId,
    loading,
    rentingConversations,
    lendingConversations,
    rentingSupportThreads,
    lendingSupportThreads,
    rentingUnreadCount,
    lendingUnreadCount,
    totalUnreadCount: rentingUnreadCount + lendingUnreadCount,
    isUnread: (conv: ConversationRow) => computeIsUnread(conv, currentUserId),
    isSupportThreadUnread: computeSupportUnread,
    reload: load,
  };

  return <ConversationsContext.Provider value={value}>{children}</ConversationsContext.Provider>;
}

export function useConversations(): ConversationsContextValue {
  const ctx = useContext(ConversationsContext);
  if (!ctx) throw new Error('useConversations must be used within a ConversationsProvider');
  return ctx;
}
