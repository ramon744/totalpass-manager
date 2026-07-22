-- Tipo de envio: botão único com URL (aviso desvínculo Infinity / sem PIX).

alter table public.mensagem_templates
  drop constraint if exists mensagem_templates_tipo_envio_check;

alter table public.mensagem_templates
  add constraint mensagem_templates_tipo_envio_check
  check (tipo_envio in (
    'texto',
    'botao_pix',
    'botao_link',
    'botoes_pix_boleto',
    'botoes_pagamento'
  ));

alter table public.mensagens
  drop constraint if exists mensagens_tipo_envio_check;

alter table public.mensagens
  add constraint mensagens_tipo_envio_check
  check (tipo_envio in (
    'texto',
    'botao_pix',
    'botao_link',
    'botoes_pix_boleto',
    'botoes_pagamento'
  ));

update public.mensagem_templates
set
  tipo_envio = 'botao_link',
  updated_at = now()
where evento = 'aviso_desvinculo_totalpass';
