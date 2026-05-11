import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ProfileScreen from '../screens/ProfileScreen';
import MyItemsScreen from '../screens/MyItemsScreen';
import MyRentalsScreen from '../screens/MyRentalsScreen';
import ManageItemScreen from '../screens/ManageItemScreen';
import WishlistScreen from '../screens/WishlistScreen';
import EditItemScreen from '../screens/EditItemScreen';
import ItemDetailScreen from '../screens/ItemDetailScreen';
import PublicProfileScreen from '../screens/PublicProfileScreen';
import HistoryScreen from '../screens/HistoryScreen';
import type { Item } from '../types/item';

export type ProfileStackParamList = {
  ProfileMain: undefined;
  MyItems: undefined;
  MyRentals: undefined;
  ManageItem: { itemId: string; itemTitle: string };
  Wishlist: undefined;
  EditItem: { itemId: string };
  ItemDetail: { item: Item; openRent?: boolean; prefilledStart?: string; prefilledEnd?: string };
  PublicProfile: { userId: string; userName: string };
  History: undefined;
};

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export default function ProfileStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProfileMain" component={ProfileScreen} />
      <Stack.Screen name="MyItems" component={MyItemsScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="MyRentals" component={MyRentalsScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="ManageItem" component={ManageItemScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="Wishlist" component={WishlistScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="EditItem" component={EditItemScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="ItemDetail" component={ItemDetailScreen as any} options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="PublicProfile" component={PublicProfileScreen as any} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="History" component={HistoryScreen} options={{ animation: 'slide_from_right' }} />
    </Stack.Navigator>
  );
}
