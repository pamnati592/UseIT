import { useState, useEffect, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Calendar } from 'react-native-calendars';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';
import { supabase } from '../services/supabase';

// Single type for all rental states
type RentalRange = { id: string; start: string; end: string; renterName: string; status: string; conversationId: string | null };
type BlockedRange = { id: string; blocked_from: string; blocked_to: string };

type Props = NativeStackScreenProps<ProfileStackParamList, 'ManageItem'>;

const TODAY = new Date().toISOString().split('T')[0];

const STATUS_LABEL: Record<string, string> = {
  pending:  'Pending',
  approved: 'Approved',
  active:   'Paid',
};

const PENDING_COLOR  = { bg: '#3a2a00', text: '#f0a500' };
const APPROVED_COLOR = { bg: '#0a1a4a', text: '#4da6ff' };
const PAID_COLOR     = { bg: '#0a2a1a', text: '#4cd964' };
const BLOCKED_COLOR  = { bg: '#3a0a0a', text: '#f44336' };

function statusColor(status: string) {
  if (status === 'approved') return APPROVED_COLOR;
  if (status === 'active')   return PAID_COLOR;
  return PENDING_COLOR;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function expandRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const cur = new Date(from);
  const last = new Date(to);
  while (cur <= last) {
    dates.push(cur.toISOString().split('T')[0]);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function buildCalendarMarks(
  rentalRanges: RentalRange[],
  blockedRanges: BlockedRange[],
  selStart: string | null,
  selEnd: string | null,
): Record<string, any> {
  const marks: Record<string, any> = {};

  rentalRanges.forEach(r => {
    const c = statusColor(r.status);
    expandRange(r.start, r.end).forEach((d, i, arr) => {
      marks[d] = { color: c.bg, textColor: c.text, startingDay: i === 0, endingDay: i === arr.length - 1 };
    });
  });

  blockedRanges.forEach(r => {
    expandRange(r.blocked_from, r.blocked_to).forEach((d, i, arr) => {
      marks[d] = { color: BLOCKED_COLOR.bg, textColor: BLOCKED_COLOR.text, startingDay: i === 0, endingDay: i === arr.length - 1 };
    });
  });

  if (selStart) {
    const end = selEnd ?? selStart;
    expandRange(selStart, end).forEach((d, i, arr) => {
      marks[d] = { color: '#fff', textColor: '#000', startingDay: i === 0, endingDay: i === arr.length - 1 };
    });
  }

  return marks;
}

export default function ManageItemScreen({ navigation, route }: Props) {
  const { itemId, itemTitle } = route.params;

  const [rentalRanges,  setRentalRanges]  = useState<RentalRange[]>([]);
  const [blockedRanges, setBlockedRanges] = useState<BlockedRange[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [selStart, setSelStart] = useState<string | null>(null);
  const [selEnd,   setSelEnd]   = useState<string | null>(null);
  const [saving,   setSaving]   = useState(false);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    setLoading(true);
    const [txRes, blockedRes] = await Promise.all([
      supabase
        .from('transactions')
        .select('id, start_date, end_date, status, conversation_id, renter:profiles!transactions_renter_id_fkey(full_name)')
        .eq('item_id', itemId)
        .in('status', ['pending', 'approved', 'active'])
        .order('start_date'),
      supabase
        .from('item_blocked_dates')
        .select('id, blocked_from, blocked_to')
        .eq('item_id', itemId)
        .order('blocked_from'),
    ]);

    setRentalRanges(
      (txRes.data ?? []).map((t: any) => ({
        id: t.id,
        start: t.start_date.split('T')[0],
        end: t.end_date.split('T')[0],
        renterName: t.renter?.full_name ?? 'Renter',
        status: t.status,
        conversationId: t.conversation_id ?? null,
      }))
    );
    setBlockedRanges((blockedRes.data ?? []) as BlockedRange[]);
    setLoading(false);
  }

  const reservedDatesSet = useMemo(() => {
    const s = new Set<string>();
    rentalRanges.forEach(r => expandRange(r.start, r.end).forEach(d => s.add(d)));
    return s;
  }, [rentalRanges]);

  const blockedDateToRangeId = useMemo(() => {
    const map: Record<string, string> = {};
    blockedRanges.forEach(r => {
      expandRange(r.blocked_from, r.blocked_to).forEach(d => { map[d] = r.id; });
    });
    return map;
  }, [blockedRanges]);

  function navigateToChat(r: RentalRange) {
    if (!r.conversationId) return;
    (navigation as any).getParent()?.navigate('Chats', {
      screen: 'ChatRoom',
      params: {
        conversationId: r.conversationId,
        itemTitle,
        otherUserName: r.renterName,
        initialTab: 'rental',
        targetTransactionId: r.id,
      },
    });
  }

  function onDayPress(day: { dateString: string }) {
    const d = day.dateString;
    if (reservedDatesSet.has(d)) return;

    const blockedRangeId = blockedDateToRangeId[d];
    if (blockedRangeId) {
      const range = blockedRanges.find(r => r.id === blockedRangeId);
      if (!range) return;
      Alert.alert(
        'Remove blocked period?',
        `${fmt(range.blocked_from)} → ${fmt(range.blocked_to)}`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', style: 'destructive', onPress: () => deleteRange(blockedRangeId) },
        ]
      );
      return;
    }

    if (!selStart || (selStart && selEnd)) {
      setSelStart(d); setSelEnd(null);
    } else if (d < selStart) {
      setSelStart(d); setSelEnd(null);
    } else {
      const range = expandRange(selStart, d);
      if (range.some(rd => reservedDatesSet.has(rd) || blockedDateToRangeId[rd])) {
        Alert.alert('Invalid range', 'Selection overlaps with reserved or blocked dates.');
        return;
      }
      setSelEnd(d);
    }
  }

  async function addBlockedRange() {
    if (!selStart || !selEnd) return;
    setSaving(true);
    const { data, error } = await supabase
      .from('item_blocked_dates')
      .insert({ item_id: itemId, blocked_from: selStart, blocked_to: selEnd })
      .select('id, blocked_from, blocked_to')
      .single();
    if (error) { Alert.alert('Error', error.message); }
    else if (data) {
      setBlockedRanges(prev =>
        [...prev, data as BlockedRange].sort((a, b) => a.blocked_from.localeCompare(b.blocked_from))
      );
    }
    setSelStart(null); setSelEnd(null);
    setSaving(false);
  }

  async function deleteRange(id: string) {
    const { error } = await supabase.from('item_blocked_dates').delete().eq('id', id);
    if (!error) setBlockedRanges(prev => prev.filter(r => r.id !== id));
  }

  const markedDates = buildCalendarMarks(rentalRanges, blockedRanges, selStart, selEnd);
  const selectionHint = !selStart
    ? 'Tap a free date to start blocking'
    : !selEnd
    ? `From ${fmt(selStart)} — tap end date`
    : `${fmt(selStart)} → ${fmt(selEnd)}`;

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>←</Text>
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>Manage Item</Text>
          <Text style={styles.subtitle} numberOfLines={1}>{itemTitle}</Text>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator color="#fff" style={{ flex: 1 }} />
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* Legend */}
          <View style={styles.legend}>
            {[
              { color: PENDING_COLOR.text,  label: 'Pending' },
              { color: APPROVED_COLOR.text, label: 'Approved' },
              { color: PAID_COLOR.text,     label: 'Paid' },
              { color: BLOCKED_COLOR.text,  label: 'Blocked' },
            ].map(({ color, label }) => (
              <View key={label} style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: color }]} />
                <Text style={styles.legendLabel}>{label}</Text>
              </View>
            ))}
          </View>

          <Calendar
            markingType="period"
            markedDates={markedDates}
            onDayPress={onDayPress}
            minDate={TODAY}
            theme={{
              backgroundColor: '#1a1a1a',
              calendarBackground: '#1a1a1a',
              textSectionTitleColor: '#555',
              dayTextColor: '#fff',
              todayTextColor: '#8b5cf6',
              todayBackgroundColor: 'transparent',
              arrowColor: '#fff',
              monthTextColor: '#fff',
              textDisabledColor: '#333',
            }}
          />

          {/* Block dates */}
          <View style={styles.addSection}>
            <Text style={styles.addHint}>{selectionHint}</Text>
            <TouchableOpacity
              style={[styles.addBtn, (!selStart || !selEnd || saving) && styles.addBtnDisabled]}
              onPress={addBlockedRange}
              disabled={!selStart || !selEnd || saving}
            >
              {saving
                ? <ActivityIndicator color="#000" size="small" />
                : <Text style={styles.addBtnText}>Block these dates</Text>
              }
            </TouchableOpacity>
            {(selStart || selEnd) && (
              <TouchableOpacity onPress={() => { setSelStart(null); setSelEnd(null); }}>
                <Text style={styles.clearSelText}>Clear selection</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Blocked periods */}
          {blockedRanges.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Blocked Periods</Text>
              {blockedRanges.map(r => (
                <View key={r.id} style={styles.rangeRow}>
                  <View style={[styles.rangeColorBar, { backgroundColor: BLOCKED_COLOR.text }]} />
                  <Text style={[styles.rangeText, { flex: 1 }]}>{fmt(r.blocked_from)} → {fmt(r.blocked_to)}</Text>
                  <TouchableOpacity style={styles.deleteBtn} onPress={() => deleteRange(r.id)}>
                    <Text style={styles.deleteBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}

          {/* All rentals — read-only overview, tap to open chat */}
          {rentalRanges.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Rentals</Text>
              {rentalRanges.map(r => {
                const c = statusColor(r.status);
                return (
                  <TouchableOpacity
                    key={r.id}
                    style={styles.rangeRow}
                    disabled={!r.conversationId}
                    onPress={() => navigateToChat(r)}
                  >
                    <View style={[styles.rangeColorBar, { backgroundColor: c.text }]} />
                    <View style={styles.rangeInfo}>
                      <Text style={styles.rangeText}>{fmt(r.start)} → {fmt(r.end)}</Text>
                      <Text style={styles.rangeRenter}>{r.renterName}</Text>
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: c.bg, borderColor: c.text }]}>
                      <Text style={[styles.statusBadgeText, { color: c.text }]}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </Text>
                    </View>
                    {r.conversationId && <Text style={styles.chevron}>›</Text>}
                  </TouchableOpacity>
                );
              })}
              <Text style={styles.chatNote}>Tap a rental to manage it in the conversation.</Text>
            </View>
          )}

        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a1a' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#2a2a2a',
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  backText: { color: '#fff', fontSize: 22, fontWeight: '300' },
  headerText: { flex: 1 },
  title: { fontSize: 18, fontWeight: '700', color: '#fff' },
  subtitle: { fontSize: 13, color: '#666', marginTop: 1 },

  scroll: { padding: 16, paddingBottom: 40 },

  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 9, height: 9, borderRadius: 5 },
  legendLabel: { color: '#888', fontSize: 11 },

  addSection: { marginTop: 16, alignItems: 'center', gap: 10 },
  addHint: { color: '#888', fontSize: 13 },
  addBtn: {
    width: '100%', height: 48, backgroundColor: '#fff',
    borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  addBtnDisabled: { opacity: 0.3 },
  addBtnText: { color: '#000', fontSize: 15, fontWeight: '700' },
  clearSelText: { color: '#555', fontSize: 13 },

  section: { marginTop: 24 },
  sectionTitle: {
    fontSize: 11, color: '#555', fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10,
  },
  rangeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#242424', borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 12,
    marginBottom: 8, borderWidth: 1, borderColor: '#2e2e2e',
  },
  rangeColorBar: { width: 3, height: 36, borderRadius: 2 },
  rangeInfo: { flex: 1 },
  rangeText: { color: '#ccc', fontSize: 14 },
  rangeRenter: { color: '#666', fontSize: 12, marginTop: 2 },
  statusBadge: {
    paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 8, borderWidth: 1,
  },
  statusBadgeText: { fontSize: 11, fontWeight: '700' },
  chevron: { fontSize: 18, color: '#555', fontWeight: '300' },
  chatNote: { color: '#444', fontSize: 11, marginTop: 6, lineHeight: 16 },

  deleteBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  deleteBtnText: { color: '#f44336', fontSize: 14, fontWeight: '600' },
});
