import { useEffect, useState } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { navigationRef } from './navigationRef';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ShieldAlert } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import LoginScreen from '../screens/LoginScreen';
import PhoneVerificationScreen from '../screens/PhoneVerificationScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import MainTabNavigator from './MainTabNavigator';
import { onAuthStateChange } from '../services/auth.service';
import { supabase } from '../services/supabase';

export type RootStackParamList = {
  MainApp: undefined;
  Login: undefined;
  PhoneVerification: { onVerified: () => void };
  Onboarding: { onFinished: () => void };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  const { colors, isDark } = useTheme();
  const [session, setSession] = useState<any>(undefined);
  const [phoneVerified, setPhoneVerified] = useState<boolean>(false);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean>(false);
  const [isBanned, setIsBanned] = useState<boolean>(false);

  useEffect(() => {
    const { data: listener } = onAuthStateChange(async (newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        const { data } = await supabase
          .from('profiles')
          .select('phone_verified, onboarding_complete, is_banned')
          .eq('id', newSession.user.id)
          .single();
        setPhoneVerified(data?.phone_verified ?? false);
        setOnboardingComplete(data?.onboarding_complete ?? false);
        setIsBanned(data?.is_banned ?? false);
      } else {
        setPhoneVerified(false);
        setOnboardingComplete(false);
        setIsBanned(false);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const navTheme = {
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme : DefaultTheme).colors,
      background: colors.bg,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
    },
  };

  // still loading — don't flash Login before checking session
  if (session === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ActivityIndicator color={colors.text} />
      </View>
    );
  }

  // Checked before phone-verification/onboarding too — a banned user
  // shouldn't be able to proceed through either of those.
  if (session && isBanned) {
    return (
      <View style={[styles.bannedContainer, { backgroundColor: colors.bg }]}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <ShieldAlert size={48} color={colors.danger} strokeWidth={1.5} />
        <Text style={[styles.bannedTitle, { color: colors.text }]}>Account Suspended</Text>
        <Text style={[styles.bannedBody, { color: colors.textFaint }]}>
          Your account has been suspended by a UseIT administrator. Contact support if you believe this is a mistake.
        </Text>
        <TouchableOpacity
          style={[styles.bannedSignOutBtn, { backgroundColor: colors.btn }]}
          onPress={() => supabase.auth.signOut()}
        >
          <Text style={{ color: colors.btnText, fontWeight: '700', fontSize: 15 }}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <NavigationContainer ref={navigationRef} theme={navTheme} key={session?.user?.id ?? 'logged-out'}>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!session ? (
            <Stack.Screen name="Login" component={LoginScreen} />
          ) : !phoneVerified ? (
            <Stack.Screen name="PhoneVerification">
              {() => <PhoneVerificationScreen onVerified={() => setPhoneVerified(true)} />}
            </Stack.Screen>
          ) : !onboardingComplete ? (
            <Stack.Screen name="Onboarding">
              {() => <OnboardingScreen onFinished={() => setOnboardingComplete(true)} />}
            </Stack.Screen>
          ) : (
            <Stack.Screen name="MainApp">
              {() => <MainTabNavigator key={session.user.id} />}
            </Stack.Screen>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  bannedContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  bannedTitle: { fontSize: 20, fontWeight: '700' },
  bannedBody: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  bannedSignOutBtn: { marginTop: 12, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
});
