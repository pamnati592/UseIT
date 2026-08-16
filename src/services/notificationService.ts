import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from './supabase';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function requestPermissions() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('rental-requests', {
      name: 'Rental Requests',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

async function fireRentalNotification(itemTitle: string, renterName: string) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `New rental request for "${itemTitle}"`,
      body: `${renterName} wants to rent your item. Tap to review.`,
      sound: true,
      data: {},
    },
    trigger: null, // fire immediately
  });
}

let realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

export async function initNotificationService() {
  const granted = await requestPermissions();
  if (!granted) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;

  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }

  // Listen for new messages across all conversations where this user is the lender.
  // When a rental-request message arrives, fire a local banner notification.
  realtimeChannel = supabase
    .channel(`notifications:lender:${user.id}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages' },
      async (payload) => {
        const msg = payload.new as { content: string; sender_id: string; conversation_id: string };

        // Only care about rental-request messages sent by someone else
        if (msg.sender_id === user.id) return;
        if (!msg.content.startsWith('📅 Rental request:')) return;

        // Verify this user is the lender for this conversation
        const { data: conv } = await supabase
          .from('conversations')
          .select('lender_id, item_id')
          .eq('id', msg.conversation_id)
          .eq('lender_id', user.id)
          .maybeSingle();

        if (!conv) return;

        // Fetch item title and renter name for the notification body
        const { data: item } = await supabase
          .from('items')
          .select('title')
          .eq('id', conv.item_id)
          .single();

        const { data: renterProfile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', msg.sender_id)
          .single();

        const itemTitle = item?.title ?? 'your item';
        const renterName = renterProfile?.full_name ?? 'Someone';

        await fireRentalNotification(itemTitle, renterName);
      }
    )
    .subscribe();
}

export async function teardownNotificationService() {
  if (realtimeChannel) {
    supabase.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
}
