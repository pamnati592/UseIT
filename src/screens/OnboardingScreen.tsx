import { useState, useMemo} from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../services/supabase';
import CityPicker, { type CityValue } from '../components/CityPicker';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import {
  ShoppingCart, Package, Repeat, ChevronLeft,
  Utensils, Palette, Sailboat, Snowflake, Film, Mountain,
  type LucideIcon,
} from 'lucide-react-native';
import { CATEGORY_INTEREST_OPTIONS } from '../constants/categories';

const ROLES: { value: Role; label: string; description: string; icon: LucideIcon }[] = [
  { value: 'renter', label: 'Renter', description: 'I want to rent items from others', icon: ShoppingCart },
  { value: 'lender', label: 'Lender', description: 'I want to lend my items out', icon: Package },
  { value: 'both', label: 'Both', description: 'I want to rent and lend', icon: Repeat },
];

// Real item categories (single source of truth: constants/categories.ts) up
// front, then a few broader interest-only tags that aren't real categories
// — kept local since nothing else needs them.
const INTERESTS: { value: string; label: string; icon: LucideIcon }[] = [
  ...CATEGORY_INTEREST_OPTIONS,
  { value: 'cooking', label: 'Cooking', icon: Utensils },
  { value: 'art', label: 'Art & Craft', icon: Palette },
  { value: 'water_sports', label: 'Water Sports', icon: Sailboat },
  { value: 'winter_sports', label: 'Winter Sports', icon: Snowflake },
  { value: 'film', label: 'Film & Video', icon: Film },
  { value: 'outdoor', label: 'Outdoor', icon: Mountain },
];

type Role = 'renter' | 'lender' | 'both';

export default function OnboardingScreen({ onFinished }: { onFinished: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [step, setStep] = useState(1);
  const [role, setRole] = useState<Role | null>(null);
  const [fullName, setFullName] = useState('');
  const [cityValue, setCityValue] = useState<CityValue | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  function toggleInterest(value: string) {
    setInterests((prev) =>
      prev.includes(value) ? prev.filter((i) => i !== value) : [...prev, value]
    );
  }

  async function finish() {
    if (interests.length < 3) {
      Alert.alert('Almost there', 'Please select at least 3 interests');
      return;
    }
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('profiles')
        .update({
          role,
          full_name: fullName.trim(),
          city: cityValue!.city,
          location: `POINT(${cityValue!.lng} ${cityValue!.lat})`,
          interests,
          onboarding_complete: true,
        })
        .eq('id', user.id);

      if (error) throw error;
      onFinished();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Progress bar */}
      <View style={styles.progressBar}>
        {[1, 2, 3].map((s) => (
          <View key={s} style={[styles.progressSegment, step >= s && styles.progressSegmentActive]} />
        ))}
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* STEP 1 – Role */}
        {step === 1 && (
          <>
            <Text style={styles.title}>How will you use SwipeAndRent?</Text>
            <Text style={styles.subtitle}>You can change this later in your profile</Text>

            {ROLES.map((r) => {
              const RoleIcon = r.icon;
              return (
              <TouchableOpacity
                key={r.value}
                style={[styles.roleCard, role === r.value && styles.roleCardSelected]}
                onPress={() => setRole(r.value)}
              >
                <View style={styles.roleEmoji}>
                  <RoleIcon size={26} color={role === r.value ? colors.primary : colors.textSecondary} />
                </View>
                <View style={styles.roleText}>
                  <Text style={[styles.roleLabel, role === r.value && styles.roleLabelSelected]}>
                    {r.label}
                  </Text>
                  <Text style={styles.roleDescription}>{r.description}</Text>
                </View>
                <View style={[styles.radioOuter, role === r.value && styles.radioOuterSelected]}>
                  {role === r.value && <View style={styles.radioInner} />}
                </View>
              </TouchableOpacity>
            );
            })}

            <TouchableOpacity
              style={[styles.nextButton, !role && styles.nextButtonDisabled]}
              onPress={() => role && setStep(2)}
              disabled={!role}
            >
              <Text style={styles.nextButtonText}>Continue</Text>
            </TouchableOpacity>
          </>
        )}

        {/* STEP 2 – Details */}
        {step === 2 && (
          <>
            <Text style={styles.title}>Tell us about yourself</Text>
            <Text style={styles.subtitle}>This helps others know who they're renting to</Text>

            <Text style={styles.label}>Full name</Text>
            <TextInput
              style={styles.input}
              placeholder="Your full name"
              placeholderTextColor={colors.textFaint}
              value={fullName}
              onChangeText={setFullName}
              autoFocus
            />

            <Text style={styles.label}>City</Text>
            <CityPicker
              value={cityValue}
              onChange={setCityValue}
              placeholder="e.g. Tel Aviv-Yafo"
            />

            <TouchableOpacity
              style={[styles.nextButton, (!fullName.trim() || !cityValue) && styles.nextButtonDisabled]}
              onPress={() => (fullName.trim() && cityValue) && setStep(3)}
              disabled={!fullName.trim() || !cityValue}
            >
              <Text style={styles.nextButtonText}>Continue</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.backButton} onPress={() => setStep(1)}>
              <ChevronLeft size={16} color={colors.textFaint} />
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>
          </>
        )}

        {/* STEP 3 – Interests */}
        {step === 3 && (
          <>
            <Text style={styles.title}>What are you into?</Text>
            <Text style={styles.subtitle}>
              Select at least 3 — we'll use these to show you relevant items
            </Text>

            <View style={styles.interestsGrid}>
              {INTERESTS.map((item) => {
                const selected = interests.includes(item.value);
                const InterestIcon = item.icon;
                return (
                  <TouchableOpacity
                    key={item.value}
                    style={[styles.interestChip, selected && styles.interestChipSelected]}
                    onPress={() => toggleInterest(item.value)}
                  >
                    <InterestIcon size={15} color={selected ? colors.primary : colors.textSecondary} />
                    <Text style={[styles.interestLabel, selected && styles.interestLabelSelected]}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.selectionCount}>
              {interests.length} selected{interests.length < 3 ? ` (need ${3 - interests.length} more)` : ' ✓'}
            </Text>

            <TouchableOpacity
              style={[styles.nextButton, (interests.length < 3 || loading) && styles.nextButtonDisabled]}
              onPress={finish}
              disabled={interests.length < 3 || loading}
            >
              {loading
                ? <ActivityIndicator color={colors.btnText} />
                : <Text style={styles.nextButtonText}>Let's go!</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity style={styles.backButton} onPress={() => setStep(2)}>
              <ChevronLeft size={16} color={colors.textFaint} />
              <Text style={styles.backButtonText}>Back</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  progressBar: { flexDirection: 'row', gap: 6, paddingHorizontal: 24, paddingTop: 16 },
  progressSegment: { flex: 1, height: 4, backgroundColor: colors.card, borderRadius: 2 },
  progressSegmentActive: { backgroundColor: colors.btn },
  content: { padding: 24, paddingBottom: 48, gap: 12 },
  title: { fontSize: 22, fontWeight: 'bold', color: colors.text, marginTop: 16, marginBottom: 4 },
  subtitle: { fontSize: 14, color: colors.textMuted, marginBottom: 16 },
  label: { fontSize: 13, color: colors.textMuted, marginBottom: 6, marginTop: 4 },
  input: {
    height: 48, backgroundColor: colors.card, borderWidth: 2,
    borderColor: colors.border, borderRadius: 8, paddingHorizontal: 16, color: colors.text, fontSize: 15,
  },
  roleCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.card, borderWidth: 2, borderColor: colors.border,
    borderRadius: 12, padding: 16,
  },
  roleCardSelected: { borderColor: colors.btn, backgroundColor: colors.cardAlt },
  roleEmoji: { width: 40, alignItems: 'center', justifyContent: 'center' },
  roleText: { flex: 1 },
  roleLabel: { fontSize: 16, fontWeight: '600', color: colors.textSecondary },
  roleLabelSelected: { color: colors.text },
  roleDescription: { fontSize: 13, color: colors.textFaint, marginTop: 2 },
  radioOuter: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: colors.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOuterSelected: { borderColor: colors.btn },
  radioInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.btn },
  interestsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 8 },
  interestChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.card, borderWidth: 2, borderColor: colors.border,
    borderRadius: 24, paddingHorizontal: 14, paddingVertical: 10,
  },
  interestChipSelected: { borderColor: colors.btn, backgroundColor: colors.cardAlt },
  interestEmoji: { fontSize: 16 },
  interestLabel: { fontSize: 13, color: colors.textMuted },
  interestLabelSelected: { color: colors.text },
  selectionCount: { fontSize: 13, color: colors.textFaint, textAlign: 'center' },
  nextButton: {
    height: 52, backgroundColor: colors.btn, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', marginTop: 8,
  },
  nextButtonDisabled: { backgroundColor: colors.card },
  nextButtonText: { fontSize: 16, fontWeight: '600', color: colors.btnText },
  backButton: { flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  backButtonText: { color: colors.textFaint, fontSize: 14 },
});
