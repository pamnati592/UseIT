import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ProfileScreen from '../screens/ProfileScreen';
import MyItemsScreen from '../screens/MyItemsScreen';
import MyRentalsScreen from '../screens/MyRentalsScreen';
import ManageItemScreen from '../screens/ManageItemScreen';

export type ProfileStackParamList = {
  ProfileMain: undefined;
  MyItems: undefined;
  MyRentals: undefined;
  ManageItem: { itemId: string; itemTitle: string };
};

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export default function ProfileStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ProfileMain" component={ProfileScreen} />
      <Stack.Screen name="MyItems" component={MyItemsScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="MyRentals" component={MyRentalsScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="ManageItem" component={ManageItemScreen} options={{ animation: 'slide_from_right' }} />
    </Stack.Navigator>
  );
}
