-- First step toward real payouts (spec 4.10 implies lenders actually get
-- paid; nothing in the codebase before this ever moved money past the
-- platform's own Stripe account — confirmed by grep, zero references to
-- Connect/transfer/payout anywhere). Adds the fields needed to track each
-- lender's Stripe Express connected account and whether Stripe has actually
-- cleared them to receive charges.
alter table public.profiles
  add column stripe_connect_account_id text,
  add column stripe_connect_charges_enabled boolean not null default false,
  add column stripe_connect_details_submitted boolean not null default false;
