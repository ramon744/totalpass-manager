-- Bridge TotalPass: instâncias da extensão, fila de jobs e avisos de desvinculo

create table if not exists public.bridge_instances (
  id uuid primary key default gen_random_uuid(),
  installation_id text not null unique,
  extension_version text,
  last_seen_at timestamptz not null default now(),
  session_ok boolean not null default false,
  session_email text,
  pending_jobs_count integer not null default 0,
  last_offline_alert_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists bridge_instances_last_seen_idx
  on public.bridge_instances (last_seen_at desc);

create table if not exists public.bridge_jobs (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('inactivate_totalpass')),
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'running', 'succeeded', 'failed', 'cancelled')),
  beneficiario_id uuid not null references public.beneficiarios (id) on delete cascade,
  cpf text not null,
  motivo text not null default 'inadimplencia',
  payload jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  last_error text,
  claimed_at timestamptz,
  claimed_by text,
  run_after timestamptz not null default now(),
  completed_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bridge_jobs_status_run_after_idx
  on public.bridge_jobs (status, run_after);

create index if not exists bridge_jobs_beneficiario_idx
  on public.bridge_jobs (beneficiario_id);

create index if not exists bridge_jobs_claimed_by_idx
  on public.bridge_jobs (claimed_by)
  where claimed_by is not null;

create table if not exists public.desvinculo_avisos (
  id uuid primary key default gen_random_uuid(),
  beneficiario_id uuid not null references public.beneficiarios (id) on delete cascade,
  cobranca_id uuid not null references public.cobrancas (id) on delete cascade,
  avisado_em timestamptz not null default now(),
  data_limite date not null,
  created_at timestamptz not null default now(),
  unique (beneficiario_id, cobranca_id)
);

create index if not exists desvinculo_avisos_data_limite_idx
  on public.desvinculo_avisos (data_limite);

-- Config bridge (defaults)
insert into public.configuracoes (chave, valor, updated_at)
values (
  'bridge',
  jsonb_build_object(
    'dias_carencia', 5,
    'dias_aviso_final', 2,
    'heartbeat_ttl_minutos', 15,
    'admin_telefone', '',
    'alerta_offline_intervalo_horas', 2,
    'teto_diario_inativacoes', 20,
    'notificar_cancelamento_asaas', true
  ),
  now()
)
on conflict (chave) do update
set valor = public.configuracoes.valor || excluded.valor,
    updated_at = now();

-- Templates WhatsApp
insert into public.mensagem_templates (
  evento, titulo, corpo, ativo, tipo_envio, max_tentativas, intervalo_retry_minutos, updated_at
)
values
(
  'aviso_desvinculo_totalpass',
  'Aviso de desvinculo TotalPass',
  E'Olá {{nome}}!\n\nIdentificamos atraso no pagamento de R$ {{valor}}.\n\nCaso não haja o pagamento até {{data_limite}}, infelizmente você será desvinculado da empresa no TotalPass.\n\n{{mensagem_plano}}\n\nRegularize pelo link: {{link_pagamento}}',
  true,
  'texto',
  3,
  array[10, 30, 60],
  now()
),
(
  'bridge_offline_admin',
  'Bridge TotalPass offline',
  E'⚠️ Bridge TotalPass offline/sessão expirada.\n\nHá {{pending_count}} exclusão(ões) pendente(s).\nÚltimo heartbeat: {{ultimo_heartbeat}}\n\nAbra o HR TotalPass e faça login para a extensão processar a fila.',
  true,
  'texto',
  1,
  array[60],
  now()
)
on conflict (evento) do nothing;

-- Claim atômico de jobs (FOR UPDATE SKIP LOCKED)
create or replace function public.claim_bridge_jobs(
  p_installation_id text,
  p_limit integer default 3
)
returns setof public.bridge_jobs
language plpgsql
security definer
as $$
begin
  return query
  with picked as (
    select j.id
    from public.bridge_jobs j
    where j.status = 'pending'
      and j.run_after <= now()
      and j.attempts < j.max_attempts
    order by j.run_after asc, j.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 3), 10))
  )
  update public.bridge_jobs j
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

grant execute on function public.claim_bridge_jobs(text, integer) to service_role;
