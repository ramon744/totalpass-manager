-- Fila: validar status InfinitePay antes de avisar/desvincular (sem webhook).
create table if not exists public.infinity_aviso_validacoes (
  id uuid primary key default gen_random_uuid(),
  infinity_customer_id text not null,
  beneficiario_id uuid not null references public.beneficiarios (id) on delete cascade,
  fase text not null check (fase in ('aviso', 'desvinculo')),
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'confirmed_overdue', 'cleared_paid', 'error', 'cancelled')),
  claimed_at timestamptz,
  claimed_by text,
  validated_at timestamptz,
  validated_payment_status text,
  last_error text,
  admin_alerted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists infinity_aviso_validacoes_open_uq
  on public.infinity_aviso_validacoes (infinity_customer_id, fase)
  where status in ('pending', 'claimed', 'error');

create index if not exists infinity_aviso_validacoes_status_idx
  on public.infinity_aviso_validacoes (status, created_at);

alter table public.infinity_aviso_validacoes enable row level security;
