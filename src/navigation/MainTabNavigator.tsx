import { useRef } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommonActions, type NavigationState, type NavigatorScreenParams } from '@react-navigation/native';
import { navigationRef } from './navigationRef';
import { House, Sparkles, MessageCircle, User, Plus, type LucideIcon } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { ConversationsProvider, useConversations } from '../contexts/ConversationsContext';
import { AdminModeProvider } from '../contexts/AdminModeContext';
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

// Depth-first search through the whole navigation tree (from the root ref, the
// only place the full nested state is reliably available) for the route
// object with this key, wherever it sits in the tree.
function findRouteByKey(state: NavigationState | undefined, key: string): object | undefined {
  if (!state) return undefined;
  for (const r of state.routes) {
    if (r.key === key) return r;
    const found = findRouteByKey((r as any).state, key);
    if (found) return found;
  }
  return undefined;
}

export default function MainTabNavigator() {
  // Mounted once here, at the root of the whole authenticated app — every
  // unread signal (this tab badge, the Chats screen's role-tab badges, its
  // green dots) reads from this one instance, never a separate copy.
  return (
    <ConversationsProvider>
      <AdminModeProvider>
        <MainTabNavigatorInner />
      </AdminModeProvider>
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
  const lastTabPress = useRef<Record<string, number>>({});

  return (
    <Tab.Navigator
      // Double-tapping an already-focused tab pops its nested stack back to
      // that tab's home screen — the general escape hatch for "how do I get
      // back to this tab's main screen" that this app needs in more than one
      // place (e.g. a screen reached cross-tab, like ManageItemScreen from a
      // chat's overflow menu, can otherwise leave that tab's stack stranded
      // on it indefinitely). Applies to every tab uniformly, not a one-off fix.
      screenListeners={({ navigation, route }) => ({
        tabPress: () => {
          if (!navigation.isFocused()) return;
          const now = Date.now();
          const last = lastTabPress.current[route.key] ?? 0;
          lastTabPress.current[route.key] = now;
          if (now - last > 400) return;

          // The navigation object scoped to this screen doesn't reliably expose
          // nested-navigator state via getState() — the root ref is the actual
          // single source of truth for the full tree, so this walks that instead,
          // recursively since nesting depth isn't assumed (root stack -> tabs ->
          // this tab's own stack).
          const rootState = navigationRef.getRootState();
          const tabRoute = findRouteByKey(rootState, route.key);
          if (!tabRoute) return;

          const nestedState = (tabRoute as any).state;
          if (nestedState && nestedState.routes.length > 0) {
            // Normal case: a real nested stack exists (this tab has been visited
            // "properly" before) — pop it back to its own root screen.
            const rootRouteName = nestedState.routes[0]?.name;
            const currentRouteName = nestedState.routes[nestedState.routes.length - 1]?.name;
            if (!rootRouteName || currentRouteName === rootRouteName) return;
            navigationRef.dispatch({
              ...CommonActions.reset({ index: 0, routes: [{ name: rootRouteName }] }),
              target: nestedState.key,
            });
            return;
          }

          // Edge case: this tab's very first navigation this session came from a
          // cross-tab shortcut like navigate('Profile', {screen: 'ManageItem',
          // params}) — React Navigation forwards those as raw, unresolved params
          // on the tab route itself (no real stack ever gets built, so there's
          // nothing to "pop"), which is exactly how a tab ends up permanently
          // stuck on a sub-screen with no way back to its own root screen.
          // Clearing those params is what actually un-stuffs it.
          const params = (tabRoute as any).params as { screen?: string } | undefined;
          if (params?.screen) {
            navigationRef.dispatch({
              ...CommonActions.setParams({ screen: undefined, params: undefined } as any),
              source: route.key,
            });
          }
        },
      })}
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
