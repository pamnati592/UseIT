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

type ConversationsContextValue = {
  conversations: ConversationRow[];
  currentUserId: string | null;
  loading: boolean;
  rentingConversations: ConversationRow[];
  lendingConversations: ConversationRow[];
  rentingUnreadCount: number;
  lendingUnreadCount: number;
  totalUnreadCount: number;
  isUnread: (conv: ConversationRow) => boolean;
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

    const { data, error } = await supabase
      .from('conversations')
      .select(`
        id, renter_id, lender_id, last_message, last_message_at,
        renter_last_read_at, lender_last_read_at,
        items(title),
        renter:profiles!conversations_renter_id_fkey(full_name),
        lender:profiles!conversations_lender_id_fkey(full_name)
      `)
      .order('last_message_at', { ascending: false });

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
    setLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    load();

    const unsubBus = chatBus.subscribe(load);

    // conversations.last_message_at / *_last_read_at is the actual field every
    // unread computation reads — watching it directly is both more precise and
    // cheaper than the old approach of watching every messages INSERT app-wide.
    const channel = supabase
      .channel(`conversations-watch-${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, () => {
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
  const rentingUnreadCount = useMemo(
    () => rentingConversations.filter(c => computeIsUnread(c, currentUserId)).length,
    [rentingConversations, currentUserId]
  );
  const lendingUnreadCount = useMemo(
    () => lendingConversations.filter(c => computeIsUnread(c, currentUserId)).length,
    [lendingConversations, currentUserId]
  );

  const value: ConversationsContextValue = {
    conversations,
    currentUserId,
    loading,
    rentingConversations,
    lendingConversations,
    rentingUnreadCount,
    lendingUnreadCount,
    totalUnreadCount: rentingUnreadCount + lendingUnreadCount,
    isUnread: (conv: ConversationRow) => computeIsUnread(conv, currentUserId),
    reload: load,
  };

  return <ConversationsContext.Provider value={value}>{children}</ConversationsContext.Provider>;
}

export function useConversations(): ConversationsContextValue {
  const ctx = useContext(ConversationsContext);
  if (!ctx) throw new Error('useConversations must be used within a ConversationsProvider');
  return ctx;
}
