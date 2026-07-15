-- Lender sets a default pickup location when listing the item (shown on the
-- item card / detail screen) instead of negotiating a meeting point live via
-- a fake map screen. Free-text, optional — parties can still agree on a
-- different spot over chat if they want.
alter table public.items add column pickup_location text;
