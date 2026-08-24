export type Item = {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  daily_price: number;
  sale_price: number | null;
  category: string;
  city: string | null;
  photos: string[] | null;
  pickup_location: string | null;
  // Populated by the get_feed RPC; undefined for queries that don't include it,
  // null when the caller or the item lacks coordinates.
  distance_meters?: number | null;
  // Real rental count backing the Impact Score (backlog R) — populated by
  // get_feed; undefined for queries that don't select it, in which case
  // getImpactScore treats it as 0 (still a real category baseline, just no
  // reuse bonus yet).
  completed_rental_count?: number;
};
