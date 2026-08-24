import { useState, useMemo} from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  ActivityIndicator, Alert, TextInput, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signInWithGoogle, signInWithApple, signInWithEmail, signUpWithEmail } from '../services/auth.service';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';
import { ChevronLeft } from 'lucide-react-native';

export default function LoginScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [loading, setLoading] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleGoogle() {
    try {
      setLoading(true);
      await signInWithGoogle();
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  }

  // Not functional until Apple's provider is configured in Supabase (needs
  // a paid Apple Developer Program account — see auth.service.ts). Left
  // wired up rather than disabled so the native Apple sheet + full flow is
  // ready to go the moment that account exists — the only failure mode
  // until then is Supabase itself rejecting the identity token.
  async function handleApple() {
    try {
      setLoading(true);
      await signInWithApple();
    } catch (error: any) {
      if (error.code !== 'ERR_REQUEST_CANCELED') Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleEmailAuth() {
    if (!email || !password) {
      Alert.alert('Error', 'Please enter email and password');
      return;
    }
    try {
      setLoading(true);
      if (isSignUp) {
        await signUpWithEmail(email, password);
      } else {
        await signInWithEmail(email, password);
      }
    } catch (error: any) {
      Alert.alert('Error', error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* 'height' rather than no behavior at all on Android: without it the keyboard
          simply overlaps the inputs. The ScrollView is the real safety net — on short
          screens the form can still be scrolled up into view instead of being trapped
          under the keyboard, and flexGrow keeps the space-between layout when it fits. */}
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView
          contentContainerStyle={styles.inner}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
        {/* Logo */}
        <View style={styles.logoContainer}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>S&R</Text>
          </View>
          <Text style={styles.title}>Welcome</Text>
          <Text style={styles.subtitle}>Sign in to continue</Text>
        </View>

        {!showEmailForm ? (
          /* Social Buttons */
          <View style={styles.buttonsContainer}>
            <TouchableOpacity style={styles.socialButton} onPress={handleGoogle} disabled={loading}>
              <Text style={styles.socialButtonText}>Continue with Google</Text>
            </TouchableOpacity>

            {Platform.OS === 'ios' && (
              <TouchableOpacity style={styles.socialButton} onPress={handleApple} disabled={loading}>
                <Text style={styles.socialButtonText}>Continue with Apple</Text>
              </TouchableOpacity>
            )}

            <View style={styles.dividerContainer}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>OR</Text>
              <View style={styles.dividerLine} />
            </View>

            <TouchableOpacity style={styles.socialButton} onPress={() => setShowEmailForm(true)}>
              <Text style={styles.socialButtonText}>Continue with Email</Text>
            </TouchableOpacity>
          </View>
        ) : (
          /* Email / Password Form */
          <View style={styles.buttonsContainer}>
            <Text style={styles.formTitle}>{isSignUp ? 'Create Account' : 'Sign In'}</Text>

            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={colors.textFaint}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
            />

            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={colors.textFaint}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />

            <TouchableOpacity style={styles.primaryButton} onPress={handleEmailAuth} disabled={loading}>
              {loading
                ? <ActivityIndicator color={colors.btnText} />
                : <Text style={styles.primaryButtonText}>{isSignUp ? 'Sign Up' : 'Sign In'}</Text>
              }
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setIsSignUp(!isSignUp)}>
              <Text style={styles.toggleText}>
                {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setShowEmailForm(false)} style={styles.backRow}>
              <ChevronLeft size={18} color={colors.textSecondary} />
              <Text style={styles.backText}>Back</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.terms}>By continuing, you agree to our Terms & Privacy</Text>
        </ScrollView>
      </KeyboardAvoidingView>

      {loading && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={colors.text} />
        </View>
      )}
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flexGrow: 1, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 40, paddingHorizontal: 24 },
  logoContainer: { alignItems: 'center' },
  logo: {
    width: 80, height: 80, backgroundColor: colors.cardAlt,
    borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 24,
  },
  logoText: { fontSize: 22, fontWeight: 'bold', color: colors.textSecondary },
  title: { fontSize: 24, fontWeight: 'bold', color: colors.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.textMuted },
  buttonsContainer: { width: '100%', gap: 12 },
  formTitle: { fontSize: 20, fontWeight: 'bold', color: colors.text, marginBottom: 8 },
  socialButton: {
    width: '100%', height: 48, backgroundColor: colors.card,
    borderWidth: 2, borderColor: colors.border, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  socialButtonText: { color: colors.text, fontSize: 14 },
  dividerContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.cardAlt },
  dividerText: { color: colors.textFaint, fontSize: 12 },
  input: {
    width: '100%', height: 48, backgroundColor: colors.card,
    borderWidth: 2, borderColor: colors.border, borderRadius: 8,
    paddingHorizontal: 16, color: colors.text, fontSize: 14,
  },
  primaryButton: {
    width: '100%', height: 48, backgroundColor: colors.btn,
    borderRadius: 8, alignItems: 'center', justifyContent: 'center',
  },
  primaryButtonText: { color: colors.btnText, fontSize: 15, fontWeight: '600' },
  toggleText: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  backRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  backText: { color: colors.textFaint, fontSize: 13, textAlign: 'center' },
  terms: { fontSize: 12, color: colors.textFaint, textAlign: 'center' },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.overlay,
    alignItems: 'center', justifyContent: 'center',
  },
});
