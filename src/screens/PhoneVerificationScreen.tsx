import { useState, useRef, useMemo} from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../services/supabase';
import { useTheme } from '../theme/ThemeContext';
import type { ThemeColors } from '../theme/colors';

export default function PhoneVerificationScreen({ onVerified }: { onVerified: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [loading, setLoading] = useState(false);
  const inputs = useRef<(TextInput | null)[]>([]);

  async function sendCode() {
    if (!phone.trim()) return;
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOtp({ phone: phone.trim() });
      if (error) throw error;
      setStep('otp');
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Could not send verification code.');
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    const code = otp.join('');
    if (code.length < 6) return;
    try {
      setLoading(true);

      // Dev-only bypass so this screen is testable without a real SMS provider
      // configured — never present in a release build (Metro strips the __DEV__
      // branch), same pattern as ProfileScreen's Switch User gate.
      if (__DEV__ && code === '123456') {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const { error: updateError } = await supabase
            .from('profiles')
            .update({ phone_verified: true })
            .eq('id', user.id);
          if (updateError) throw updateError;
        }
        onVerified();
        return;
      }

      const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: 'sms' });
      if (error) throw error;

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ phone_verified: true })
          .eq('id', user.id);
        if (updateError) throw updateError;
      }
      onVerified();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setLoading(false);
    }
  }

  function handleOtpChange(text: string, index: number) {
    const newOtp = [...otp];
    newOtp[index] = text;
    setOtp(newOtp);
    if (text && index < 5) inputs.current[index + 1]?.focus();
    if (!text && index > 0) inputs.current[index - 1]?.focus();
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.inner}>
        <View style={styles.progressBar}>
          {[...Array(5)].map((_, i) => (
            <View key={i} style={[styles.progressDot, i <= (step === 'otp' ? 4 : 3) && styles.progressDotActive]} />
          ))}
        </View>

        {step === 'phone' ? (
          <>
            <Text style={styles.title}>Verify your phone</Text>
            <Text style={styles.subtitle}>We&apos;ll send you a verification code via SMS</Text>

            <View style={styles.field}>
              <Text style={styles.label}>Phone number</Text>
              <TextInput
                style={styles.input}
                placeholder="+972 50 000 0000"
                placeholderTextColor={colors.textFaint}
                keyboardType="phone-pad"
                value={phone}
                onChangeText={setPhone}
                autoFocus
              />
            </View>

            <Text style={styles.note}>Standard SMS rates may apply</Text>

            <TouchableOpacity style={styles.button} onPress={sendCode} disabled={loading || !phone.trim()}>
              {loading ? <ActivityIndicator color={colors.text} /> : <Text style={styles.buttonText}>Send code</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.title}>Enter verification code</Text>
            <Text style={styles.subtitle}>We sent a code to {phone}</Text>

            <View style={styles.otpRow}>
              {otp.map((digit, i) => (
                <TextInput
                  key={i}
                  ref={(r) => { inputs.current[i] = r; }}
                  style={styles.otpInput}
                  maxLength={1}
                  keyboardType="number-pad"
                  value={digit}
                  onChangeText={(t) => handleOtpChange(t, i)}
                  autoFocus={i === 0}
                />
              ))}
            </View>

            {__DEV__ && <Text style={styles.note}>Dev mode: use 123456 to bypass SMS verification</Text>}

            <TouchableOpacity style={styles.button} onPress={verifyCode} disabled={loading || otp.join('').length < 6}>
              {loading ? <ActivityIndicator color={colors.text} /> : <Text style={styles.buttonText}>Verify code</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setStep('phone')} style={styles.backLink}>
              <Text style={styles.backLinkText}>Change phone number</Text>
            </TouchableOpacity>
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, paddingHorizontal: 24, paddingTop: 32 },
  progressBar: { flexDirection: 'row', gap: 4, marginBottom: 32 },
  progressDot: { flex: 1, height: 4, backgroundColor: colors.cardAlt, borderRadius: 2 },
  progressDotActive: { backgroundColor: colors.textMuted },
  title: { fontSize: 22, fontWeight: 'bold', color: colors.text, marginBottom: 8 },
  subtitle: { fontSize: 14, color: colors.textMuted, marginBottom: 32 },
  field: { marginBottom: 8 },
  label: { fontSize: 14, color: colors.textMuted, marginBottom: 8 },
  input: {
    height: 48, backgroundColor: colors.card, borderWidth: 2,
    borderColor: colors.border, borderRadius: 8, paddingHorizontal: 16, color: colors.text, fontSize: 16,
  },
  note: { fontSize: 12, color: colors.textFaint, marginBottom: 32 },
  button: {
    height: 48, backgroundColor: colors.cardAlt, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center', marginTop: 'auto', marginBottom: 16,
  },
  buttonText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  otpRow: { flexDirection: 'row', gap: 10, justifyContent: 'center', marginBottom: 40 },
  otpInput: {
    width: 44, height: 56, backgroundColor: colors.card, borderWidth: 2,
    borderColor: colors.border, borderRadius: 8, textAlign: 'center', color: colors.text, fontSize: 22,
  },
  backLink: { alignItems: 'center', marginBottom: 16 },
  backLinkText: { color: colors.textMuted, fontSize: 14 },
});
