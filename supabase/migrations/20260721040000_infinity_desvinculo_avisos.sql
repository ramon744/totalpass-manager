-- Avisos de desvínculo por atraso InfinitePay (sem FK em cobrancas Asaas)
create table if not exists public.infinity_desvinculo_avisos (
  id uuid primary key default gen_random_uuid(),
  beneficiario_id uuid not null references public.beneficiarios (id) on delete cascade,
  infinity_customer_id text not null,
  infinity_invoice_slug text,
  avisado_em timestamptz not null default now(),
  data_limite date not null,
  created_at timestamptz not null default now(),
  unique (beneficiario_id, infinity_customer_id)
);

create index if not exists infinity_desvinculo_avisos_data_limite_idx
  on public.infinity_desvinculo_avisos (data_limite);

create index if not exists infinity_desvinculo_avisos_customer_idx
  on public.infinity_desvinculo_avisos (infinity_customer_id);
