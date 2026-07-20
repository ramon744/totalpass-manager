-- Fase 2 Infinity: instâncias da extensão + snapshot de clientes/atrasos
-- Separado da bridge TotalPass (não altera bridge_instances/jobs).

create table if not exists public.infinity_instances (
  id uuid primary key default gen_random_uuid(),
  installation_id text not null unique,
  extension_version text,
  last_seen_at timestamptz not null default now(),
  session_ok boolean not null default false,
  session_email text,
  overdue_count integer not null default 0,
  last_offline_alert_at timestamptz,
  last_error text,
  last_health_ok boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists infinity_instances_last_seen_idx
  on public.infinity_instances (last_seen_at desc);

-- Snapshot do último sync (overdue/pending/paid) — UI e fase 4
create table if not exists public.infinity_customer_status (
  id uuid primary key default gen_random_uuid(),
  infinity_customer_id text not null,
  infinity_subscription_slug text,
  nome text,
  document_number text,
  email text,
  phone text,
  payment_status text not null default 'unknown'
    check (payment_status in ('overdue', 'pending', 'paid', 'unknown', 'inactive')),
  amount numeric(12, 2),
  due_date date,
  beneficiario_id uuid references public.beneficiarios (id) on delete set null,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (infinity_customer_id)
);

create index if not exists infinity_customer_status_payment_idx
  on public.infinity_customer_status (payment_status);

create index if not exists infinity_customer_status_document_idx
  on public.infinity_customer_status (document_number)
  where document_number is not null;

create index if not exists infinity_customer_status_beneficiario_idx
  on public.infinity_customer_status (beneficiario_id)
  where beneficiario_id is not null;

-- Template alerta admin (opcional; fallback no código)
insert into public.mensagem_templates (
  evento, titulo, corpo, ativo, tipo_envio, max_tentativas, intervalo_retry_minutos, updated_at
)
values (
  'infinity_offline_admin',
  'Extensão InfinitePay offline',
  E'⚠️ Extensão InfinitePay offline/sessão expirada.\n\nClientes overdue no último sync: {{overdue_count}}.\nÚltimo heartbeat: {{ultimo_heartbeat}}\nMotivo: {{motivo}}\n\nAbra app.infinitepay.io logado para a extensão voltar a sincronizar.',
  true,
  'texto',
  3,
  array[10, 30, 60],
  now()
)
on conflict (evento) do nothing;
