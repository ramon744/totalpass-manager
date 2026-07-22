-- Permite payment_status = cancelled após cancel_subscription Infinity.
alter table public.infinity_customer_status
  drop constraint if exists infinity_customer_status_payment_status_check;

alter table public.infinity_customer_status
  add constraint infinity_customer_status_payment_status_check
  check (
    payment_status = any (
      array[
        'overdue'::text,
        'pending'::text,
        'paid'::text,
        'unknown'::text,
        'inactive'::text,
        'cancelled'::text
      ]
    )
  );
