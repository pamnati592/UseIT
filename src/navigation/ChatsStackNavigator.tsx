import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ChatsScreen from '../screens/ChatsScreen';
import ChatRoomScreen from '../screens/ChatRoomScreen';
import QRDisplayScreen from '../screens/QRDisplayScreen';
import QRScanScreen from '../screens/QRScanScreen';
import MeetingPointScreen from '../screens/MeetingPointScreen';
import RatingScreen from '../screens/RatingScreen';
import type { QrPhase } from '../screens/qrShared';

export type ChatsStackParamList = {
  ConversationsList: undefined;
  ChatRoom: { conversationId: string; itemTitle: string; otherUserName: string; initialText?: string; targetTransactionId?: string; initialTab?: 'chat' | 'rental'; highlightAfterTimestamp?: string };
  QRDisplay: { transactionId: string; phase: QrPhase; itemTitle: string; otherName?: string };
  QRScan: { transactionId: string; phase: QrPhase; itemTitle: string; otherName?: string };
  MeetingPoint: { renterName: string; lenderName: string; confirmMode?: boolean };
  Rating: { itemTitle: string; otherName: string };
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
      <Stack.Screen name="QRDisplay" component={QRDisplayScreen} options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="QRScan" component={QRScanScreen} options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="MeetingPoint" component={MeetingPointScreen} options={{ animation: 'slide_from_bottom' }} />
      <Stack.Screen name="Rating" component={RatingScreen} options={{ animation: 'slide_from_bottom' }} />
    </Stack.Navigator>
  );
}
