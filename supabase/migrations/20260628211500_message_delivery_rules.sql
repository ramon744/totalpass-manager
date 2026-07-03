alter table public.mensagem_templates
  add column if not exists tipo_envio text not null default 'texto',
  add column if not exists max_tentativas integer not null default 3,
  add column if not exists intervalo_retry_minutos integer[] not null default array[10,30,60]::integer[];

alter table public.mensagens
  add column if not exists tipo_envio text not null default 'texto',
  add column if not exists payload_envio jsonb,
  add column if not exists proxima_tentativa_em timestamptz,
  add column if not exists max_tentativas integer not null default 3;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'mensagem_templates_tipo_envio_check'
  ) then
    alter table public.mensagem_templates
      add constraint mensagem_templates_tipo_envio_check
      check (tipo_envio in ('texto','botao_pix','botoes_pix_boleto','botoes_pagamento'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'mensagens_tipo_envio_check'
  ) then
    alter table public.mensagens
      add constraint mensagens_tipo_envio_check
      check (tipo_envio in ('texto','botao_pix','botoes_pix_boleto','botoes_pagamento'));
  end if;
end $$;

update public.mensagem_templates
set tipo_envio = case
  when evento in (
    'assinatura_criada',
    'cobranca_gerada',
    'vencimento_3dias',
    'vencimento_dia',
    'vencimento_1dia',
    'vencimento_7dias'
  ) then 'botoes_pagamento'
  else 'texto'
end,
max_tentativas = 3,
intervalo_retry_minutos = array[10,30,60]::integer[],
updated_at = now();
