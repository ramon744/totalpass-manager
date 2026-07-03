-- Habilita extensões para agendamento e chamadas HTTP
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Configuração do cron (secret deve coincidir com CRON_SECRET do app)
insert into public.configuracoes (chave, valor, updated_at)
values (
  'cron',
  jsonb_build_object(
    'secret', 'um_segredo_forte',
    'edge_function_url', 'https://yxwugamcufbhiicgwufd.supabase.co/functions/v1/cron-reminders'
  ),
  now()
)
on conflict (chave) do update
set valor = public.configuracoes.valor || excluded.valor,
    updated_at = now();

-- Remove jobs antigos com os mesmos nomes (idempotente)
select cron.unschedule(jobid)
from cron.job
where jobname in (
  'totalpass_reminders_schedule_daily',
  'totalpass_messages_process_queue'
);

-- 1x ao dia às 08:00 BRT (11:00 UTC): agenda lembretes distribuídos na janela 9h-18h
select cron.schedule(
  'totalpass_reminders_schedule_daily',
  '0 11 * * *',
  $$
  select net.http_post(
    url := coalesce(
      (select valor->>'edge_function_url' from public.configuracoes where chave = 'cron'),
      'https://yxwugamcufbhiicgwufd.supabase.co/functions/v1/cron-reminders'
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(
        (select valor->>'secret' from public.configuracoes where chave = 'cron'),
        ''
      )
    ),
    body := '{"action":"schedule"}'::jsonb
  ) as request_id;
  $$
);

-- A cada 5 minutos: envia somente mensagens com agendado_para vencido (anti-disparo em massa)
select cron.schedule(
  'totalpass_messages_process_queue',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := coalesce(
      (select valor->>'edge_function_url' from public.configuracoes where chave = 'cron'),
      'https://yxwugamcufbhiicgwufd.supabase.co/functions/v1/cron-reminders'
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(
        (select valor->>'secret' from public.configuracoes where chave = 'cron'),
        ''
      )
    ),
    body := '{"action":"process"}'::jsonb
  ) as request_id;
  $$
);
