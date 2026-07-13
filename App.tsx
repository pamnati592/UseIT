import { useEffect } from 'react';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { StripeProvider } from '@stripe/stripe-react-native';
import RootNavigator from './src/navigation/RootNavigator';
import { ThemeProvider } from './src/theme/ThemeContext';
import { supabase } from './src/services/supabase';
import { initNotificationService, teardownNotificationService } from './src/services/notificationService';

export default function App() {
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') initNotificationService();
      else if (event === 'SIGNED_OUT') teardownNotificationService();
    });
    initNotificationService();
    return () => { subscription.unsubscribe(); teardownNotificationService(); };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <StripeProvider
          publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''}
          merchantIdentifier="merchant.com.swipeandrentapp"
        >
          <View style={{ flex: 1 }}>
            <RootNavigator />
          </View>
        </StripeProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
