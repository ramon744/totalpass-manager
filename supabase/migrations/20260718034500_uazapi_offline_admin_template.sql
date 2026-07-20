-- Template documental do alerta admin quando a Uazapi está offline.
-- O envio real vai por e-mail (Resend); o template documenta o evento na UI.

insert into public.mensagem_templates (
  evento, titulo, corpo, ativo, tipo_envio, max_tentativas, intervalo_retry_minutos, updated_at
)
values (
  'uazapi_offline_admin',
  'WhatsApp/Uazapi desconectado (admin)',
  E'⚠️ WhatsApp (Uazapi) desconectado.\n\nStatus: {{status}}\nMensagens na fila: {{pending_count}}\n\nReconecte a instância no painel Uazapi para as notificações dos clientes voltarem.',
  false,
  'texto',
  1,
  array[60],
  now()
)
on conflict (evento) do nothing;
