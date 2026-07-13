import { useState, useEffect, useMemo, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Star, CircleCheck } from 'lucide-react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatsStackParamList } from '../navigation/ChatsStackNavigator';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import TapFlash from '../components/TapFlash';

type Props = NativeStackScreenProps<ChatsStackParamList, 'Rating'>;

const STAR_COLOR = '#f59e0b';

export default function RatingScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { itemTitle, otherName, theaterMode, prefillText } = route.params;

  const [stars, setStars] = useState(0);
  const [review, setReview] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitTapTs, setSubmitTapTs] = useState<number | null>(null);

  // Theater auto-flow: stars fill one by one, review types itself, then submits.
  const demoRun = useRef(false);
  useEffect(() => {
    if (!theaterMode || demoRun.current) return;
    demoRun.current = true;
    const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

    (async () => {
      await sleep(850);
      for (let i = 1; i <= 5; i++) {
        setStars(i);
        await sleep(280);
      }
      await sleep(750);
      const text = prefillText ?? 'Great experience, would rent again!';
      const words = text.split(' ');
      for (let i = 1; i <= words.length; i++) {
        setReview(words.slice(0, i).join(' '));
        await sleep(160);
      }
      await sleep(1200);
      setSubmitTapTs(Date.now());
      await sleep(450);
      setSubmitted(true);
    })();
  }, [theaterMode]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <ChevronLeft size={28} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Rate the Experience</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {submitted ? (
          <View style={styles.doneWrap}>
            <View style={styles.doneIconRing}>
              <CircleCheck size={52} color="#22c55e" strokeWidth={1.8} />
            </View>
            <Text style={styles.doneTitle}>Thanks for the feedback!</Text>
            <Text style={styles.doneSub}>
              Your rating helps build trust in the UseIT community.
            </Text>
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map(i => (
                <Star
                  key={i}
                  size={28}
                  color={STAR_COLOR}
                  fill={i <= stars ? STAR_COLOR : 'transparent'}
                  strokeWidth={1.8}
                />
              ))}
            </View>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.goBack()}>
              <Text style={styles.primaryBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <Text style={styles.itemName} numberOfLines={1}>{itemTitle}</Text>
            <Text style={styles.question}>How was your experience with {otherName}?</Text>

            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map(i => (
                <TouchableOpacity key={i} onPress={() => setStars(i)} hitSlop={6}>
                  <Star
                    size={42}
                    color={STAR_COLOR}
                    fill={i <= stars ? STAR_COLOR : 'transparent'}
                    strokeWidth={1.8}
                  />
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.sectionLabel}>Leave a review</Text>
            <TextInput
              style={styles.input}
              placeholder={`Tell others about ${otherName}…`}
              placeholderTextColor={colors.textMuted}
              value={review}
              onChangeText={setReview}
              multiline
              numberOfLines={4}
            />

            <TouchableOpacity
              style={[styles.primaryBtn, stars === 0 && styles.btnDisabled]}
              onPress={() => setSubmitted(true)}
              disabled={stars === 0}
            >
              <Text style={styles.primaryBtnText}>Submit Rating</Text>
              <TapFlash trigger={submitTapTs} style={{ alignSelf: 'center', top: 8 }} />
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.surface,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', color: colors.text },
  scroll: { padding: 20, gap: 16, paddingBottom: 40 },
  itemName: { fontSize: 15, color: colors.textMuted, textAlign: 'center' },
  question: { fontSize: 20, fontWeight: '700', color: colors.text, textAlign: 'center', marginTop: 8 },
  starsRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 10, marginVertical: 12,
  },
  sectionLabel: { fontSize: 13, color: colors.textFaint, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 15, color: colors.text, minHeight: 110, textAlignVertical: 'top',
  },
  primaryBtn: {
    height: 54, backgroundColor: colors.btn, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', marginTop: 8, width: '100%',
  },
  primaryBtnText: { color: colors.btnText, fontSize: 16, fontWeight: '700' },
  btnDisabled: { opacity: 0.4 },
  doneWrap: { alignItems: 'center', gap: 14, marginTop: 32 },
  doneIconRing: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(34,197,94,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  doneTitle: { fontSize: 24, fontWeight: '800', color: colors.text, textAlign: 'center' },
  doneSub: { fontSize: 15, color: colors.textMuted, textAlign: 'center', lineHeight: 21 },
});
