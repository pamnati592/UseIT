import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NavigatorScreenParams } from '@react-navigation/native';
import { House, Sparkles, MessageCircle, User, Plus, type LucideIcon } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { ConversationsProvider, useConversations } from '../contexts/ConversationsContext';
import HomeStackNavigator from './HomeStackNavigator';
import ChatsStackNavigator from './ChatsStackNavigator';
import type { ChatsStackParamList } from './ChatsStackNavigator';
import AIPlannerScreen from '../screens/AIPlannerScreen';
import AddItemScreen from '../screens/AddItemScreen';
import ProfileStackNavigator from './ProfileStackNavigator';

export type MainTabParamList = {
  HomeStack: undefined;
  AIPlanner: { plannerUpdate?: { itemId: string; type: 'requested' | 'saved' } } | undefined;
  AddItem: undefined;
  Chats: NavigatorScreenParams<ChatsStackParamList>;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<MainTabParamList>();

const TAB_ICONS: Partial<Record<keyof MainTabParamList, LucideIcon>> = {
  HomeStack: House,
  AIPlanner: Sparkles,
  Chats: MessageCircle,
  Profile: User,
};

const TAB_LABELS: Partial<Record<keyof MainTabParamList, string>> = {
  HomeStack: 'Home',
  AIPlanner: 'AI Planner',
  Chats: 'Chats',
  Profile: 'Profile',
};

export default function MainTabNavigator() {
  // Mounted once here, at the root of the whole authenticated app — every
  // unread signal (this tab badge, the Chats screen's role-tab badges, its
  // green dots) reads from this one instance, never a separate copy.
  return (
    <ConversationsProvider>
      <MainTabNavigatorInner />
    </ConversationsProvider>
  );
}

function MainTabNavigatorInner() {
  const { colors } = useTheme();
  const { totalUnreadCount } = useConversations();
  // app.json sets edgeToEdgeEnabled, so the tab bar draws underneath Android's
  // navigation bar / gesture pill. A hardcoded height put the tab labels behind it;
  // the bottom inset has to be added to both the height and the padding.
  const insets = useSafeAreaInsets();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarIcon: ({ focused }) => {
          if (route.name === 'AddItem') {
            return (
              <View style={{
                width: 48, height: 48, borderRadius: 24,
                backgroundColor: colors.btn, alignItems: 'center', justifyContent: 'center',
                marginBottom: 12,
              }}>
                <Plus size={26} color={colors.btnText} strokeWidth={2.5} />
              </View>
            );
          }
          const Icon = TAB_ICONS[route.name];
          if (!Icon) return null;
          return (
            <Icon
              size={22}
              color={focused ? colors.text : colors.textFaint}
              strokeWidth={focused ? 2.4 : 2}
            />
          );
        },
        tabBarLabel: ({ focused }) => {
          if (route.name === 'AddItem') return null;
          return (
            <Text style={{ fontSize: 10, color: focused ? colors.text : colors.textFaint }}>
              {TAB_LABELS[route.name]}
            </Text>
          );
        },
        tabBarStyle: {
          height: 72 + insets.bottom,
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          paddingBottom: 8 + insets.bottom,
        },
      })}
    >
      <Tab.Screen name="HomeStack" component={HomeStackNavigator} />
      <Tab.Screen name="AIPlanner" component={AIPlannerScreen} />
      <Tab.Screen name="AddItem" component={AddItemScreen} />
      <Tab.Screen
        name="Chats"
        component={ChatsStackNavigator}
        options={{ tabBarBadge: totalUnreadCount > 0 ? totalUnreadCount : undefined }}
      />
      <Tab.Screen name="Profile" component={ProfileStackNavigator} />
    </Tab.Navigator>
  );
}
