-- Fase 1 Infinity: origem de cobrança por titular + config (off por padrão).
-- Não altera fluxo Asaas/bridge HR. Jobs Infinity virão em fases seguintes.

-- Gateway de cobrança do titular (dependente = nenhum)
alter table public.beneficiarios
  add column if not exists gateway_pagamento text not null default 'asaas'
    check (gateway_pagamento in ('asaas', 'infinity', 'nenhum'));

alter table public.beneficiarios
  add column if not exists infinity_customer_id text;

alter table public.beneficiarios
  add column if not exists infinity_subscription_slug text;

comment on column public.beneficiarios.gateway_pagamento is
  'Origem da cobrança recorrente do titular: asaas | infinity | nenhum';

comment on column public.beneficiarios.infinity_customer_id is
  'ID do cliente na InfinitePay (quando gateway = infinity)';

comment on column public.beneficiarios.infinity_subscription_slug is
  'Slug da assinatura/recorrência na InfinitePay';

-- Titulares com cliente Asaas já existente ficam em asaas (default).
-- Dependentes não cobram sozinhos.
update public.beneficiarios
set gateway_pagamento = 'nenhum'
where perfil = 'dependente'
  and gateway_pagamento is distinct from 'nenhum';

create index if not exists beneficiarios_gateway_pagamento_idx
  on public.beneficiarios (gateway_pagamento)
  where perfil = 'titular';

create index if not exists beneficiarios_infinity_customer_id_idx
  on public.beneficiarios (infinity_customer_id)
  where infinity_customer_id is not null;

-- Config Infinity (automação desligada até você ligar)
insert into public.configuracoes (chave, valor, updated_at)
values (
  'infinity',
  jsonb_build_object(
    'ativa', false,
    'automacao_desvinculo_ativa', false,
    'dry_run', true,
    'heartbeat_ttl_minutos', 15,
    'alerta_offline_intervalo_horas', 2,
    'teto_diario_operacoes', 20,
    'admin_telefone', '',
    'admin_email', '',
    'bridge_secret', ''
  ),
  now()
)
on conflict (chave) do update
set valor = public.configuracoes.valor || excluded.valor,
    updated_at = now();
