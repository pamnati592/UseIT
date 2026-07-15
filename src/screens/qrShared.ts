// Shared contract for the QR handoff flow (spec 4.9). Whoever currently holds
// the item displays the QR (QRDisplayScreen); whoever is receiving it scans
// and verifies its condition (QRScanScreen). That's the lender at pickup
// (hasn't handed the item over yet) and the renter at return (has been using it).

export type QrPhase = 'pickup' | 'return';

// Both devices must be this close before a scan is accepted.
export const PROXIMITY_LIMIT_M = 50;

// Condition checklist the receiving/scanning party ticks before the scan is allowed.
export const CHECKLIST_ITEMS = [
  'Item is in good condition',
  'All parts and accessories are included',
  'Condition matches the listing photos',
];

// Payload encoded in the QR. Kept short (single-letter keys) so the QR stays
// low-density and easy to scan. lat/lng are the displayer's location at the
// moment the QR is shown, used for the 50m proximity check on the scanner side.
export type QrPayload = {
  t: string;   // transaction id
  k: string;   // one-time token
  p: QrPhase;  // phase
  lat: number;
  lng: number;
};
