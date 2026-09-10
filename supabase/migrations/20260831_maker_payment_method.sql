-- Maker profiles show the preferred payment METHOD, not just the @handle.
-- Applied live 2026-08-31. Nullable on purpose: guessing venmo-vs-cashapp
-- from a handle would mislabel where money goes — makers pick it in their
-- settings, the app shows it once set.
alter table makers add column if not exists payment_method text
  check (payment_method is null or payment_method in ('venmo','cashapp','zelle','paypal','other'));
