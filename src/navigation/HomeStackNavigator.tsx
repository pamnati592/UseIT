import { createNativeStackNavigator } from '@react-navigation/native-stack';
import HomeScreen from '../screens/HomeScreen';
import ItemDetailScreen from '../screens/ItemDetailScreen';
import PublicProfileScreen from '../screens/PublicProfileScreen';
import ReviewsListScreen from '../screens/ReviewsListScreen';
import type { Item } from '../types/item';

export type HomeStackParamList = {
  HomeMain: undefined;
  ItemDetail: { item: Item; openRent?: boolean; prefilledStart?: string; prefilledEnd?: string };
  PublicProfile: { userId: string; userName: string; approveTransactionId?: string; requestSummary?: string };
  ReviewsList:
    | { mode: 'item'; itemId: string; itemTitle: string }
    | { mode: 'profile'; userId: string; userName: string; role: 'lender' | 'renter' };
};

const Stack = createNativeStackNavigator<HomeStackParamList>();

export default function HomeStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="HomeMain" component={HomeScreen} />
      <Stack.Screen
        name="ItemDetail"
        component={ItemDetailScreen}
        options={{ animation: 'slide_from_bottom' }}
      />
      <Stack.Screen
        name="PublicProfile"
        component={PublicProfileScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="ReviewsList"
        component={ReviewsListScreen as any}
        options={{ animation: 'slide_from_right' }}
      />
    </Stack.Navigator>
  );
}
