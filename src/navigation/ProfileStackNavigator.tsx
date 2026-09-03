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
import AdminHomeScreen from '../screens/AdminHomeScreen';
import AdminRentalsScreen from '../screens/AdminRentalsScreen';
import AdminRentalDetailScreen from '../screens/AdminRentalDetailScreen';
import AdminItemsScreen from '../screens/AdminItemsScreen';
import AdminUsersScreen from '../screens/AdminUsersScreen';
import AdminOverdueScreen from '../screens/AdminOverdueScreen';
import AdminReportsScreen from '../screens/AdminReportsScreen';
import AdminConversationViewScreen from '../screens/AdminConversationViewScreen';
import SupportThreadScreen from '../screens/SupportThreadScreen';
import ReviewsListScreen from '../screens/ReviewsListScreen';
import type { Item } from '../types/item';

export type ProfileStackParamList = {
  ProfileMain: undefined;
  MyItems: undefined;
  MyRentals: undefined;
  ManageItem: {
    itemId: string; itemTitle: string;
    // Set when reached cross-tab from ChatRoomScreen's calendar icon — back
    // should return to that same conversation, not to anywhere in this stack.
    returnToChat?: { conversationId: string; itemTitle: string; otherUserName: string };
  };
  Wishlist: undefined;
  EditItem: { itemId: string };
  ItemDetail: { item: Item; openRent?: boolean; prefilledStart?: string; prefilledEnd?: string };
  PublicProfile: { userId: string; userName: string; approveTransactionId?: string; requestSummary?: string; conversationId?: string; itemTitle?: string; autoOpenReport?: boolean; reportContextItemId?: string };
  History: undefined;
  AdminHome: undefined;
  AdminRentals: undefined;
  AdminRentalDetail: { transactionId: string };
  AdminItems: undefined;
  AdminUsers: { initialSearch?: string } | undefined;
  AdminOverdue: undefined;
  AdminReports: undefined;
  AdminConversationView: { conversationId: string };
  SupportThread: { threadId: string; title: string };
  ReviewsList:
    | { mode: 'item'; itemId: string; itemTitle: string }
    | { mode: 'profile'; userId: string; userName: string; role: 'lender' | 'renter' };
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
      <Stack.Screen name="AdminHome" component={AdminHomeScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="AdminRentals" component={AdminRentalsScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="AdminRentalDetail" component={AdminRentalDetailScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="AdminItems" component={AdminItemsScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="AdminUsers" component={AdminUsersScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="AdminOverdue" component={AdminOverdueScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="AdminReports" component={AdminReportsScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="AdminConversationView" component={AdminConversationViewScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="SupportThread" component={SupportThreadScreen as any} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="ReviewsList" component={ReviewsListScreen as any} options={{ animation: 'slide_from_right' }} />
    </Stack.Navigator>
  );
}
