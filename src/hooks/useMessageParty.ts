import { useCallback } from 'react';
import { Alert } from 'react-native';
import type { NavigationProp } from '@react-navigation/native';
import { supabase } from '../services/supabase';
import type { ProfileStackParamList } from '../navigation/ProfileStackNavigator';

// AdminOverdueScreen and AdminDisputesScreen both open an
// admin_ensure_support_thread conversation with one party of a transaction —
// identical logic, only the title suffix ("Overdue Rental" vs "Dispute
// Support") differed between the two copies.
export function useMessageParty(navigation: NavigationProp<ProfileStackParamList>, titleSuffix: string) {
  return useCallback(
    async (transactionId: string, userId: string, label: string) => {
      try {
        const { data: threadId, error } = await supabase.rpc('admin_ensure_support_thread', {
          p_transaction_id: transactionId,
          p_user_id: userId,
        });
        if (error) throw error;
        navigation.navigate('SupportThread', { threadId: threadId as string, title: `${label} · ${titleSuffix}` });
      } catch (e: any) {
        Alert.alert('Error', e.message ?? 'Could not open support chat.');
      }
    },
    [navigation, titleSuffix]
  );
}
