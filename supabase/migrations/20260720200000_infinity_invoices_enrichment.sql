-- Snapshot enriquec de faturas Infinity (somente leitura do sync).
-- Não altera cobrancas Asaas nem envia notificação.

alter table public.infinity_customer_status
  add column if not exists paid_at timestamptz,
  add column if not exists invoice_slug text,
  add column if not exists invoice_description text,
  add column if not exists notified_email boolean,
  add column if not exists notified_whatsapp boolean,
  add column if not exists last_notified_at timestamptz,
  add column if not exists invoice_details jsonb not null default '{}'::jsonb;

create table if not exists public.infinity_invoices (
  id uuid primary key default gen_random_uuid(),
  infinity_invoice_slug text not null,
  infinity_customer_id text not null,
  infinity_subscription_slug text,
  beneficiario_id uuid references public.beneficiarios (id) on delete set null,
  status text not null default 'unknown'
    check (status in ('overdue', 'pending', 'paid', 'unknown', 'inactive', 'cancelled')),
  amount numeric(12, 2),
  due_date date,
  paid_at timestamptz,
  description text,
  notified_email boolean,
  notified_whatsapp boolean,
  notifications jsonb not null default '[]'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (infinity_invoice_slug)
);

create index if not exists infinity_invoices_customer_idx
  on public.infinity_invoices (infinity_customer_id);

create index if not exists infinity_invoices_status_idx
  on public.infinity_invoices (status);

create index if not exists infinity_invoices_beneficiario_idx
  on public.infinity_invoices (beneficiario_id)
  where beneficiario_id is not null;

alter table public.infinity_invoices enable row level security;

drop policy if exists infinity_invoices_select on public.infinity_invoices;
create policy infinity_invoices_select on public.infinity_invoices
  for select using (can_read());

drop policy if exists infinity_invoices_write on public.infinity_invoices;
create policy infinity_invoices_write on public.infinity_invoices
  for all using (get_user_role() = 'admin')
  with check (get_user_role() = 'admin');

grant select, insert, update, delete on public.infinity_invoices to authenticated;
grant select, insert, update, delete on public.infinity_invoices to service_role;
