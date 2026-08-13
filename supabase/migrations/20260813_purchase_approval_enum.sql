-- Purchases will require seller approval before the buyer can pay, mirroring
-- the rental request flow (pending -> approved/rejected -> paid). New enum
-- values must land in their own migration/transaction: Postgres forbids
-- using a freshly-added enum value in the same transaction that added it.
alter type purchase_status add value if not exists 'approved' after 'pending';
alter type purchase_status add value if not exists 'rejected' after 'approved';
