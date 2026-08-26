import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { ChatsStackParamList } from '../navigation/ChatsStackNavigator';

export const LATE_RETURN_POLICY_TEXT =
  'A late fee equal to the item’s daily rate is charged automatically for every day it isn’t returned after the agreed end date. If it’s more than 14 days overdue, UseIT may also charge a separate one-time penalty based on the item’s value, decided case by case.';

// Status label/color shown on the rental-request card's status pill — the card
// itself is the single live status board for that date range (see requestCard).
export const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: 'Pending',   color: '#b45309', bg: 'rgba(245,158,11,0.15)' },
  approved:  { label: 'Approved',  color: '#15803d', bg: 'rgba(34,197,94,0.15)' },
  paid:      { label: 'Paid',      color: '#1d4ed8', bg: 'rgba(59,130,246,0.15)' },
  active:    { label: 'Active',    color: '#15803d', bg: 'rgba(34,197,94,0.15)' },
  completed: { label: 'Completed', color: '#6b7280', bg: 'rgba(107,114,128,0.15)' },
  rejected:  { label: 'Declined',  color: '#b91c1c', bg: 'rgba(239,68,68,0.15)' },
  disputed:  { label: 'Disputed',  color: '#b91c1c', bg: 'rgba(239,68,68,0.15)' },
  cancelled: { label: 'Cancelled', color: '#6b7280', bg: 'rgba(107,114,128,0.15)' },
};

// Overrides the plain "Active" pill once a rental's end_date has passed —
// the status itself should say what's actually going on, not require reading
// a paragraph of colored text further down the card.
export const LATE_RETURN_META = { label: 'Late Return', color: '#b91c1c', bg: 'rgba(239,68,68,0.15)' };

// Overrides Completed/Cancelled once UseIT has ruled on a dispute — same
// "status pill + info icon" pattern as Late Return: the ruling and any note
// live behind the ⓘ instead of as a permanent paragraph on the card, but the
// pill itself still makes clear at a glance that this wasn't an ordinary
// completion/cancellation.
export const RESOLVED_META = { label: 'Resolved', color: '#6d28d9', bg: 'rgba(109,40,217,0.15)' };

// Same idea for purchase cards — mirrors the rental pending -> approved/rejected -> paid flow.
export const PURCHASE_STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: 'Pending',    color: '#b45309', bg: 'rgba(245,158,11,0.15)' },
  approved:  { label: 'Approved',   color: '#15803d', bg: 'rgba(34,197,94,0.15)' },
  rejected:  { label: 'Declined',   color: '#b91c1c', bg: 'rgba(239,68,68,0.15)' },
  paid:      { label: 'Purchased',  color: '#15803d', bg: 'rgba(34,197,94,0.15)' },
  cancelled: { label: 'Cancelled',  color: '#6b7280', bg: 'rgba(107,114,128,0.15)' },
};

export type Message = {
  id: string;
  sender_id: string;
  content: string;
  created_at: string;
  transaction_id?: string | null;
};

export type Transaction = {
  id: string;
  status: string;
  start_date: string;
  end_date: string;
  total_price: number;
  approved_at?: string | null;
};

export type AdminCharge = {
  reason: 'damage' | 'late_fee_daily' | 'late_fee_cliff';
  amount: number;
  status: 'succeeded' | 'failed';
  created_at: string;
};

export type Purchase = {
  id: string;
  item_id: string;
  buyer_id: string;
  seller_id: string;
  price: number;
  status: 'pending' | 'approved' | 'rejected' | 'paid' | 'cancelled';
  created_at: string;
};

export type ConversationInfo = {
  lender_id: string;
  renter_id: string;
  item_id: string;
};

export const RENTAL_REQUEST_PREFIX = '📅 Rental request:';

// Declining at pickup cancels the rental and frees the dates with no cancellation
// penalty, so it needs friction — a renter should not be able to back out of a
// booking on the day with one tap. Requiring a written reason (which the lender
// then sees in the chat) is that friction. Tune here if it proves too strict.
export const DECLINE_REASON_MIN = 10;

// One feed row for the Deal Board / Chat tabs — chat bubbles, rental status
// cards, and purchase status cards are all rendered from the same FlatList.
export type FeedRow =
  | { kind: 'chat'; key: string; msg: Message }
  | { kind: 'rental'; key: string; msg: Message; tx: Transaction | null }
  | { kind: 'purchase'; key: string; purchase: Purchase };

export type Props = NativeStackScreenProps<ChatsStackParamList, 'ChatRoom'>;
