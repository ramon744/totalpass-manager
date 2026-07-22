-- Detalhes da validação Infinity (link de pagamento, allow after due, etc.)
alter table public.infinity_aviso_validacoes
  add column if not exists details jsonb not null default '{}'::jsonb;

comment on column public.infinity_aviso_validacoes.details is
  'payload da validação: payment_link, allow_payment_after_due_date, invoice_slug, amount, due_date, description';';
