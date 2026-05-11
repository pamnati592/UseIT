import { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ActivityIndicator, View } from 'react-native';
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
  const [session, setSession] = useState<any>(undefined);
  const [phoneVerified, setPhoneVerified] = useState<boolean>(false);
  const [onboardingComplete, setOnboardingComplete] = useState<boolean>(false);

  useEffect(() => {
    const { data: listener } = onAuthStateChange(async (newSession) => {
      setSession(newSession);
      if (newSession?.user) {
        const { data } = await supabase
          .from('profiles')
          .select('phone_verified, onboarding_complete')
          .eq('id', newSession.user.id)
          .single();
        setPhoneVerified(data?.phone_verified ?? false);
        setOnboardingComplete(data?.onboarding_complete ?? false);
      } else {
        setPhoneVerified(false);
        setOnboardingComplete(false);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // still loading — don't flash Login before checking session
  if (session === undefined) {
    return (
      <View style={{ flex: 1, backgroundColor: '#1a1a1a', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer key={session?.user?.id ?? 'logged-out'}>
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
