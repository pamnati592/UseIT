import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ChatsScreen from '../screens/ChatsScreen';
import ChatRoomScreen from '../screens/ChatRoomScreen';
import QRDisplayScreen from '../screens/QRDisplayScreen';
import QRScanScreen from '../screens/QRScanScreen';
import MeetingPointScreen from '../screens/MeetingPointScreen';
import RatingScreen from '../screens/RatingScreen';
import SupportThreadScreen from '../screens/SupportThreadScreen';
import RentalGuideScreen from '../screens/RentalGuideScreen';
import type { QrPhase } from '../screens/qrShared';

export type ChatsStackParamList = {
  ConversationsList: undefined;
  // declineTransactionId: set when the renter bails out of the pickup scan because the
  // item is wrong. reportIssueTransactionId: set when QRDisplayScreen or QRScanScreen's
  // return flow raises a dispute. Both route here rather than implementing their own
  // version — ChatRoomScreen is the canonical screen for every rental action (SAS).
  ChatRoom: { conversationId: string; itemTitle: string; otherUserName: string; initialText?: string; targetTransactionId?: string; initialTab?: 'chat' | 'deal'; highlightAfterTimestamp?: string; declineTransactionId?: string; reportIssueTransactionId?: string; approveTransactionId?: string; rejectTransactionId?: string };
  QRDisplay: { transactionId: string; phase: QrPhase; itemTitle: string; otherName?: string; conversationId: string };
  // conversationId so the pickup "item isn't as described" route can navigate back to
  // the chat that owns the decline action.
  QRScan: { transactionId: string; phase: QrPhase; itemTitle: string; otherName?: string; conversationId: string };
  MeetingPoint: { pickupLocation: string | null; itemTitle: string };
  Rating: { transactionId: string; itemTitle: string; otherName: string; isRenter: boolean };
  SupportThread: { threadId: string; title: string };
  RentalGuide: undefined;
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
      <Stack.Screen name="SupportThread" component={SupportThreadScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="RentalGuide" component={RentalGuideScreen} options={{ animation: 'slide_from_right' }} />
    </Stack.Navigator>
  );
}
