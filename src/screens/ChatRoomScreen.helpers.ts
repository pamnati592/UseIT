import { formatDateRange as formatDateRangeUtil, formatPrice } from '../utils/format';
import type { Transaction, AdminCharge } from './ChatRoomScreen.constants';

// disputes.resolution is stored as 'favor_renter'/'favor_lender', optionally
// followed by ": {admin note}" — see admin_resolve_dispute. Parsed here
// rather than duplicating the phrasing in two places (SQL for the chat
// message, TS for the card).
export function formatDisputeResolution(raw: string): string {
  const isRenter = raw.startsWith('favor_renter');
  const noteIdx = raw.indexOf(': ');
  const note = noteIdx >= 0 ? raw.slice(noteIdx + 2) : null;
  return `⚖️ UseIT ruled in favor of the ${isRenter ? 'renter' : 'lender'}.${note ? ' ' + note : ''}`;
}

export function formatDateRange(tx: Transaction): string {
  return formatDateRangeUtil(tx.start_date, tx.end_date);
}

export function daysBetweenTx(tx: Transaction): number {
  const a = new Date(tx.start_date);
  const b = new Date(tx.end_date);
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
}

// Rental dates are stored as midnight-of-day, representing a whole calendar
// day rather than an instant — so comparisons must be day-granularity, not
// millisecond. Cancellation is always allowed pre-pickup (approved/paid)
// through the rental's last day; the day-based refund tier below controls
// the amount, not whether cancel is offered.
export function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export function canCancelTx(tx: Transaction): boolean {
  return dayKey(new Date().toISOString()) <= dayKey(tx.end_date);
}

// Same day-key math as charge-late-fee's server-side calculation — the card
// must agree with what actually gets charged, not compute its own notion of
// "late" from a different clock.
export function lateDaysFor(tx: Transaction): number {
  const days = (new Date(dayKey(new Date().toISOString())).getTime() - new Date(dayKey(tx.end_date)).getTime()) / 86400000;
  return Math.max(0, Math.round(days));
}

export function chargeLabel(c: AdminCharge): string {
  const what = c.reason === 'damage' ? 'Damage' : c.reason === 'late_fee_cliff' ? 'Overdue penalty' : 'Late fee';
  return c.status === 'succeeded'
    ? `💰 ${what} charged: ${formatPrice(c.amount)}`
    : `⚠️ ${what} assessed (${formatPrice(c.amount)}) — automatic charge failed, contact UseIT support`;
}

// Mirrors refund-payment's server-side tier so the confirmation dialog shows
// the real number before the user commits — the server remains authoritative.
// Rentals run by the day, not the hour: cancel before the start day for a
// full refund; cancelling on (or after) the start day charges 75%.
export function refundTierLabel(startDate: string): string {
  return dayKey(startDate) <= dayKey(new Date().toISOString())
    ? 'a 25% refund (cancelling on the rental start day)'
    : 'a full refund';
}
