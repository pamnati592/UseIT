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
};
