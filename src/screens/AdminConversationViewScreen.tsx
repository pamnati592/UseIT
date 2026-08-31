import { useState, useEffect, useMemo } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, type ListRenderItemInfo } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { ChevronLeft, MessageCircle } from 'lucide-react-native';

type Props = NativeStackScreenProps<ProfileStackParamList, 'AdminConversationView'>;

type Message = {
  id: string;
  sender_id: string;
  sender_name: string;
  content: string;
  created_at: string;
};

// Reached only from AdminReportsScreen, when a report carries a conversation
// id — gives the admin the actual context behind a complaint instead of an
// isolated claim. Deliberately read-only: an admin weighing in here would be
// a third voice in a two-party conversation, not this screen's job (that's
// what Support Inbox / dispute resolution are for).
export default function AdminConversationViewScreen({ navigation, route }: Props) {
  const { conversationId } = route.params;
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [header, setHeader] = useState<{ itemTitle: string; renterName: string; lenderName: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const { data, error } = await supabase.rpc('admin_get_conversation_messages', { p_conversation_id: conversationId });
      if (!error && data && data.length > 0) {
        const rows = data as any[];
        setMessages(rows.map(r => ({ id: r.message_id, sender_id: r.sender_id, sender_name: r.sender_name, content: r.content, created_at: r.created_at })));
        const first = rows[0];
        setHeader({ itemTitle: first.item_title, renterName: first.renter_name, lenderName: first.lender_name });
      }
      setLoading(false);
    }
    load();
  }, [conversationId]);

  function formatTime(iso: string): string {
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function renderItem({ item: msg }: ListRenderItemInfo<Message>) {
    return (
      <View style={styles.bubbleWrapper}>
        <Text style={styles.senderName}>{msg.sender_name}</Text>
        <View style={styles.bubble}>
          <Text style={styles.bubbleText}>{msg.content}</Text>
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
          <MessageCircle size={16} color={colors.primary} />
          <Text style={styles.title} numberOfLines={1}>{header?.itemTitle ?? 'Conversation'}</Text>
        </View>
        <View style={styles.backBtn} />
      </View>

      {header && (
        <Text style={styles.subtitle}>{header.renterName} (renter) · {header.lenderName} (lender)</Text>
      )}

      {loading ? (
        <ActivityIndicator color={colors.text} style={{ flex: 1 }} />
      ) : messages.length === 0 ? (
        <View style={styles.empty}>
          <MessageCircle size={40} color={colors.textFaint} strokeWidth={1.5} />
          <Text style={styles.emptyText}>No messages in this conversation</Text>
        </View>
      ) : (
        <FlatList
          data={messages}
          keyExtractor={(m) => m.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
        />
      )}
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
  subtitle: { fontSize: 12, color: colors.textFaint, textAlign: 'center', paddingVertical: 8 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 40 },
  emptyText: { fontSize: 14, color: colors.textFaint, textAlign: 'center' },
  list: { padding: 16, gap: 4 },
  bubbleWrapper: { marginBottom: 10 },
  senderName: { fontSize: 11, fontWeight: '600', color: colors.textFaint, marginBottom: 2, marginLeft: 4 },
  bubble: {
    alignSelf: 'flex-start', maxWidth: '85%', borderRadius: 16, borderBottomLeftRadius: 4,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  bubbleText: { fontSize: 14, lineHeight: 20, color: colors.text },
  bubbleTime: { fontSize: 10, color: colors.textFaint, marginTop: 2, marginLeft: 4 },
});
