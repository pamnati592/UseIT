-- Lets create-payment-intent attach a persistent Stripe Customer to each user
-- instead of a bare PaymentIntent every time, so the payment sheet can offer
-- to save a card and reuse it on later payments (one tap instead of retyping
-- card number/expiry/CVC/ZIP every time).
alter table public.profiles add column if not exists stripe_customer_id text;
