-- Fase 3 Infinity: fila de jobs de escrita (create/cancel) — dry-run por padrão.
-- Separado de bridge_jobs (TotalPass HR).

create table if not exists public.infinity_jobs (
  id uuid primary key default gen_random_uuid(),
  tipo text not null
    check (tipo in ('create_charge', 'cancel_subscription')),
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'running', 'succeeded', 'failed', 'cancelled')),
  beneficiario_id uuid not null references public.beneficiarios (id) on delete cascade,
  infinity_customer_id text,
  infinity_subscription_slug text,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  idempotency_key text not null unique,
  dry_run boolean not null default true,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  last_error text,
  claimed_at timestamptz,
  claimed_by text,
  run_after timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists infinity_jobs_status_run_after_idx
  on public.infinity_jobs (status, run_after);

create index if not exists infinity_jobs_beneficiario_idx
  on public.infinity_jobs (beneficiario_id);

create index if not exists infinity_jobs_claimed_by_idx
  on public.infinity_jobs (claimed_by)
  where claimed_by is not null;

alter table public.infinity_jobs enable row level security;

create policy infinity_jobs_select on public.infinity_jobs
  for select using (can_read());

create policy infinity_jobs_write on public.infinity_jobs
  for all using (get_user_role() = 'admin')
  with check (get_user_role() = 'admin');

create or replace function public.claim_infinity_jobs(
  p_installation_id text,
  p_limit integer default 3
)
returns setof public.infinity_jobs
language plpgsql
security definer
as $$
begin
  return query
  with picked as (
    select j.id
    from public.infinity_jobs j
    where j.status = 'pending'
      and j.run_after <= now()
      and j.attempts < j.max_attempts
    order by j.run_after asc, j.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 3), 10))
  )
  update public.infinity_jobs j
  set
    status = 'claimed',
    claimed_at = now(),
    claimed_by = p_installation_id,
    attempts = j.attempts + 1,
    updated_at = now()
  from picked
  where j.id = picked.id
  returning j.*;
end;
$$;

grant execute on function public.claim_infinity_jobs(text, integer) to service_role;
