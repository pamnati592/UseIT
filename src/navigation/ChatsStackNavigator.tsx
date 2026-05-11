import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ChatsScreen from '../screens/ChatsScreen';
import ChatRoomScreen from '../screens/ChatRoomScreen';

export type ChatsStackParamList = {
  ConversationsList: undefined;
  ChatRoom: { conversationId: string; itemTitle: string; otherUserName: string; initialText?: string; targetTransactionId?: string; initialTab?: 'chat' | 'rental'; highlightAfterTimestamp?: string };
};

const Stack = createNativeStackNavigator<ChatsStackParamList>();

export default function ChatsStackNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ConversationsList" component={ChatsScreen} />
      <Stack.Screen
        name="ChatRoom"
        component={ChatRoomScreen}
        options={{ animation: 'slide_from_right' }}
      />
    </Stack.Navigator>
  );
}
