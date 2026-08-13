import { useState, useEffect, useMemo} from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  Image, ActivityIndicator, Modal, ScrollView,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Calendar } from 'react-native-calendars';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import type { MainTabParamList } from '../navigation/MainTabNavigator';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { CategoryIcon } from '../components/CategoryIcon';
import {
  Sparkles, Calendar as CalendarIcon, ArrowRight, X, Search, Check, Heart,
  type LucideIcon,
} from 'lucide-react-native';

type ChecklistStatus = 'dismissed' | 'requested' | 'saved';

type ResultItem = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  city: string | null;
  daily_price: number;
  sale_price: number | null;
  photos: string[] | null;
  owner_id: string;
  reason: string;
  score: number;
};

type MarkedDates = Record<string, {
  startingDay?: boolean;
  endingDay?: boolean;
  color?: string;
  textColor?: string;
}>;

function buildPeriodMarks(start: string, end: string, colors: ThemeColors): MarkedDates {
  const marks: MarkedDates = {};
  const cur = new Date(start);
  const last = new Date(end);
  while (cur <= last) {
    const key = cur.toISOString().split('T')[0];
    marks[key] = {
      color: colors.accent,
      textColor: colors.text,
      startingDay: key === start,
      endingDay: key === end,
    };
    cur.setDate(cur.getDate() + 1);
  }
  return marks;
}

const TODAY = new Date().toISOString().split('T')[0];
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function formatDate(d: string | null) {
  if (!d) return 'Select';
  const [, m, day] = d.split('-');
  return `${parseInt(day)} ${MONTHS[parseInt(m) - 1]}`;
}

const STATUS_ICON: Record<ChecklistStatus, LucideIcon> = {
  requested: Check,
  saved: Heart,
  dismissed: X,
};

export default function AIPlannerScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<MainTabParamList, 'AIPlanner'>>();

  const [query, setQuery] = useState('');
  const [startDate, setStartDate] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string | null>(null);
  const [calendarVisible, setCalendarVisible] = useState(false);
  const [pickingStart, setPickingStart] = useState(true);
  // See the calendar below — the back arrow is disabled at minDate so RTL cannot
  // strand the user on the current month.
  const [visibleMonth, setVisibleMonth] = useState(TODAY.slice(0, 7));
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ResultItem[] | null>(null);
  const [checklist, setChecklist] = useState<Record<string, ChecklistStatus>>({});

  // Listen for signals from ItemDetailScreen (rental request sent or wishlisted)
  useEffect(() => {
    const update = route.params?.plannerUpdate;
    if (update) {
      setChecklist(prev => ({ ...prev, [update.itemId]: update.type }));
    }
  }, [route.params?.plannerUpdate]);

  function markItem(itemId: string, status: ChecklistStatus) {
    setChecklist(prev => ({ ...prev, [itemId]: status }));
  }

  function onDayPress(day: { dateString: string }) {
    if (pickingStart) {
      setStartDate(day.dateString);
      setEndDate(null);
      setPickingStart(false);
    } else {
      if (day.dateString < (startDate ?? '')) {
        setStartDate(day.dateString);
        setEndDate(null);
      } else {
        setEndDate(day.dateString);
        setCalendarVisible(false);
        setPickingStart(true);
      }
    }
  }

  const markedDates: MarkedDates = startDate && endDate
    ? buildPeriodMarks(startDate, endDate, colors)
    : startDate
    ? { [startDate]: { startingDay: true, endingDay: true, color: colors.accent, textColor: colors.text } }
    : {};

  async function handleSearch() {
    if (!query.trim()) {
      Alert.alert('Type a query', 'Describe what you\'re looking for.');
      return;
    }
    setLoading(true);
    setResults(null);
    setChecklist({});
    try {
      const res = await supabase.functions.invoke('ai-search', {
        body: { query: query.trim(), start_date: startDate, end_date: endDate },
      });
      if (res.error) throw res.error;
      setResults(res.data?.results ?? []);
    } catch (err: any) {
      Alert.alert('Search failed', err?.message ?? 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  function openItem(item: ResultItem) {
    navigation.navigate('HomeStack', {
      screen: 'ItemDetail',
      params: {
        item: {
          id: item.id,
          owner_id: item.owner_id,
          title: item.title,
          description: item.description,
          daily_price: item.daily_price,
          sale_price: item.sale_price ?? null,
          category: item.category,
          city: item.city,
          photos: item.photos,
        },
        prefilledStart: startDate ?? undefined,
        prefilledEnd: endDate ?? undefined,
      },
    });
  }

  // Sort: unchecked first, checked items at the bottom
  const sortedResults = results
    ? [...results].sort((a, b) => {
        const aChecked = !!checklist[a.id];
        const bChecked = !!checklist[b.id];
        if (aChecked === bChecked) return 0;
        return aChecked ? 1 : -1;
      })
    : null;

  const checkedCount = results ? results.filter(r => !!checklist[r.id]).length : 0;

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.titleRow}>
            <Sparkles size={22} color={colors.accent} />
            <Text style={styles.title}>AI Planner</Text>
          </View>
          <Text style={styles.subtitle}>Describe what you need and let AI find it</Text>

          <TextInput
            style={styles.input}
            placeholder="e.g. tent for a camping weekend in the mountains"
            placeholderTextColor={colors.textFaint}
            value={query}
            onChangeText={setQuery}
            multiline
            returnKeyType="search"
            onSubmitEditing={handleSearch}
          />

          <Text style={styles.label}>Dates (optional)</Text>
          <View style={styles.dateRow}>
            <TouchableOpacity
              style={styles.dateBtn}
              onPress={() => { setPickingStart(true); setCalendarVisible(true); }}
            >
              <CalendarIcon size={16} color={colors.textMuted} />
              <Text style={styles.dateBtnText}>{formatDate(startDate)}</Text>
            </TouchableOpacity>
            <ArrowRight size={18} color={colors.textFaint} />
            <TouchableOpacity
              style={styles.dateBtn}
              onPress={() => { setPickingStart(false); setCalendarVisible(true); }}
            >
              <CalendarIcon size={16} color={colors.textMuted} />
              <Text style={styles.dateBtnText}>{formatDate(endDate)}</Text>
            </TouchableOpacity>
            {(startDate || endDate) ? (
              <TouchableOpacity
                style={styles.clearDates}
                onPress={() => { setStartDate(null); setEndDate(null); }}
              >
                <X size={16} color={colors.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>

          <TouchableOpacity
            style={[styles.searchBtn, loading && { opacity: 0.6 }]}
            onPress={handleSearch}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color={colors.text} />
              : <Text style={styles.searchBtnText}>Search with AI</Text>
            }
          </TouchableOpacity>

          {sortedResults !== null && (
            sortedResults.length === 0 ? (
              <View style={styles.emptyState}>
                <Search size={48} color={colors.textFaint} strokeWidth={1.5} />
                <Text style={styles.emptyText}>No matching items found.</Text>
                <Text style={styles.emptyHint}>Try a different search or broader dates.</Text>
              </View>
            ) : (
              <View>
                <View style={styles.resultsHeaderRow}>
                  <Text style={styles.resultsHeader}>
                    {sortedResults.length} result{sortedResults.length !== 1 ? 's' : ''}
                  </Text>
                  {checkedCount > 0 && (
                    <Text style={styles.checkedCount}>{checkedCount} done</Text>
                  )}
                </View>
                {sortedResults.map(item => {
                  const status = checklist[item.id];
                  const isDone = !!status;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.card, isDone && styles.cardDone]}
                      onPress={() => !isDone && openItem(item)}
                      activeOpacity={isDone ? 1 : 0.7}
                    >
                      <View style={styles.cardMedia}>
                        {item.photos?.[0]
                          ? <Image source={{ uri: item.photos[0] }} style={styles.cardImage} />
                          : <CategoryIcon category={item.category} size={26} color={colors.textSecondary} />
                        }
                      </View>
                      <View style={styles.cardBody}>
                        <Text style={[styles.cardTitle, isDone && styles.cardTitleDone]} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={styles.cardMeta}>{item.city ?? ''} · ₪{item.daily_price}/day</Text>
                        {!isDone && (
                          <Text style={styles.cardReason} numberOfLines={2}>{item.reason}</Text>
                        )}
                      </View>
                      {/* Checkbox area */}
                      <TouchableOpacity
                        style={styles.checkboxArea}
                        onPress={() => isDone
                          ? setChecklist(prev => { const n = { ...prev }; delete n[item.id]; return n; })
                          : markItem(item.id, 'dismissed')
                        }
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        {isDone ? (
                          <View style={[styles.checkboxDone, status === 'requested' && styles.checkboxRequested, status === 'saved' && styles.checkboxSaved]}>
                            {(() => { const StatusIcon = STATUS_ICON[status]; return <StatusIcon size={14} color={colors.white} strokeWidth={2.6} />; })()}
                          </View>
                        ) : (
                          <View style={styles.checkboxEmpty}>
                            <Text style={styles.checkboxEmptyIcon}>○</Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal visible={calendarVisible} transparent animationType="slide">
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => { setCalendarVisible(false); setPickingStart(true); }}
        >
          <View style={styles.calendarSheet} onStartShouldSetResponder={() => true}>
            <Text style={styles.calendarHint}>
              {pickingStart ? 'Tap to set start date' : 'Tap to set end date'}
            </Text>
            <Calendar
              minDate={TODAY}
              onDayPress={onDayPress}
              markingType="period"
              markedDates={markedDates}
              // Under RTL the header row flips and the arrow that reads as "next" moves
              // the calendar backwards, into a month minDate has greyed out entirely.
              // Disabling the back arrow at minDate kills the dead direction. Swipe is
              // RTL-aware in the library itself, so it is the reliable way through.
              onMonthChange={m => setVisibleMonth(`${m.year}-${String(m.month).padStart(2, '0')}`)}
              disableArrowLeft={visibleMonth <= TODAY.slice(0, 7)}
              enableSwipeMonths
              theme={{
                backgroundColor: colors.surface,
                calendarBackground: colors.surface,
                textSectionTitleColor: colors.textMuted,
                dayTextColor: colors.text,
                todayTextColor: colors.accent,
                selectedDayBackgroundColor: colors.accent,
                selectedDayTextColor: colors.text,
                monthTextColor: colors.text,
                arrowColor: colors.accent,
                textDisabledColor: colors.textFaint,
              }}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 20, paddingBottom: 40 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  title: { color: colors.text, fontSize: 26, fontWeight: '700' },
  subtitle: { color: colors.textMuted, fontSize: 14, marginBottom: 20 },
  input: {
    backgroundColor: colors.card,
    color: colors.text,
    borderRadius: 12,
    padding: 14,
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: 'top',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 20,
  },
  label: { color: colors.textMuted, fontSize: 13, marginBottom: 8 },
  dateRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20, gap: 8 },
  dateBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.card, borderRadius: 10, padding: 12, gap: 6,
    borderWidth: 1, borderColor: colors.border,
  },
  dateBtnIcon: { fontSize: 16 },
  dateBtnText: { color: colors.text, fontSize: 14 },
  dateArrow: { color: colors.textFaint, fontSize: 18 },
  clearDates: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: colors.chip, alignItems: 'center', justifyContent: 'center',
  },
  clearDatesText: { color: colors.textSecondary, fontSize: 14 },
  searchBtn: {
    backgroundColor: colors.accent, borderRadius: 12, padding: 16,
    alignItems: 'center', marginBottom: 28,
  },
  searchBtnText: { color: colors.text, fontSize: 16, fontWeight: '700' },
  resultsHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  resultsHeader: { color: colors.textMuted, fontSize: 13 },
  checkedCount: { color: colors.textFaint, fontSize: 12 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 12, marginBottom: 12,
    overflow: 'hidden', borderWidth: 1, borderColor: colors.border,
  },
  cardDone: { opacity: 0.4 },
  cardMedia: {
    width: 80, height: 80, backgroundColor: colors.cardAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  cardImage: { width: 80, height: 80 },
  cardEmoji: { fontSize: 34 },
  cardBody: { flex: 1, padding: 12 },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: '600', marginBottom: 2 },
  cardTitleDone: { textDecorationLine: 'line-through', color: colors.textMuted },
  cardMeta: { color: colors.textMuted, fontSize: 12, marginBottom: 4 },
  cardReason: { color: colors.accent, fontSize: 12, fontStyle: 'italic' },
  checkboxArea: {
    width: 48, alignItems: 'center', justifyContent: 'center', paddingRight: 4,
  },
  checkboxEmpty: {
    width: 28, height: 28, borderRadius: 14,
    borderWidth: 1.5, borderColor: colors.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxEmptyIcon: { color: colors.textFaint, fontSize: 16, lineHeight: 20 },
  checkboxDone: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: colors.cardAlt, alignItems: 'center', justifyContent: 'center',
  },
  checkboxRequested: { backgroundColor: colors.successBg },
  checkboxSaved: { backgroundColor: colors.dangerBg },
  checkboxIcon: { fontSize: 14 },
  emptyState: { alignItems: 'center', paddingTop: 40 },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyText: { color: colors.text, fontSize: 17, fontWeight: '600', marginBottom: 6 },
  emptyHint: { color: colors.textFaint, fontSize: 14 },
  modalOverlay: {
    flex: 1, backgroundColor: colors.overlayStrong, justifyContent: 'flex-end',
  },
  calendarSheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 16, paddingBottom: 36,
  },
  calendarHint: { color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginBottom: 8 },
});
