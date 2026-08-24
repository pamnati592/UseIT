// Renders a distance in meters as a short human-readable label for UI badges.
// Returns null when there's nothing to show so callers can simply guard on it
// instead of branching on numeric edge cases.
//
//   formatDistance(null)   → null
//   formatDistance(0)      → '0m'      (still rendered — "at the exact spot")
//   formatDistance(850)    → '850m'
//   formatDistance(3200)   → '3.2 km'
//   formatDistance(47000)  → '47 km'
export function formatDistance(meters: number | null | undefined): string | null {
  if (meters == null) return null;
  if (meters < 1000) return `${Math.round(meters)}m`;
  const km = meters / 1000;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

// Backlog R: rough, defensible-not-measured per-category baseline —
// relative estimate of embodied-manufacturing footprint avoided by
// sharing that kind of item instead of everyone buying their own. There's
// no authoritative CO2 data source wired into this app; these are
// reasonable relative orderings (bulky/durable goods like tents and bikes
// benefit more from sharing than something like a game console that sees
// heavy use even when owned individually), not measured figures.
const CATEGORY_IMPACT_BASE: Record<string, number> = {
  camping: 3.8,
  sports: 3.7,
  photography: 3.6,
  diy: 3.5,
  clothing: 3.4,
  music: 3.3,
  gaming: 3.2,
  other: 3.0,
};

// Real inputs now: the item's actual category and how many times it's
// actually been rented to completion (completed_rental_count, rolled up
// in scan_qr_handoff on every return scan) — no longer a hash of the
// item's own id. +0.1 per completed rental, capped at 5.0.
export function getImpactScore(category: string, completedRentalCount: number = 0): number {
  const base = CATEGORY_IMPACT_BASE[category] ?? CATEGORY_IMPACT_BASE.other;
  return Math.min(5.0, base + 0.1 * completedRentalCount);
}

// Great-circle distance in meters between two lat/lng points (Haversine).
// Used for the QR handoff 50m proximity check (spec 4.9).
export function metersBetween(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6_371_000; // earth radius in meters
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
