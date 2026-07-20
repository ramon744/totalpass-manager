-- Agenda crons da bridge apontando para o app Vercel.
-- Ajuste app_base_url em configuracoes.chave=cron se o domínio mudar.

update public.configuracoes
set valor = valor || jsonb_build_object(
  'app_base_url',
  coalesce(
    nullif(valor->>'app_base_url', ''),
    'https://totalpass-manager.vercel.app'
  )
),
updated_at = now()
where chave = 'cron';

select cron.unschedule(jobid)
from cron.job
where jobname in (
  'totalpass_overdue_inactivation_check',
  'totalpass_bridge_offline_alert'
);

-- 1x ao dia às 08:30 BRT (11:30 UTC)
select cron.schedule(
  'totalpass_overdue_inactivation_check',
  '30 11 * * *',
  $$
  select net.http_post(
    url := coalesce(
      (select rtrim(valor->>'app_base_url', '/') from public.configuracoes where chave = 'cron'),
      'https://totalpass-manager.vercel.app'
    ) || '/api/cron/overdue-inactivation',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(
        (select valor->>'secret' from public.configuracoes where chave = 'cron'),
        ''
      )
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);

-- A cada 15 minutos: alerta admin se bridge offline com jobs pendentes
select cron.schedule(
  'totalpass_bridge_offline_alert',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := coalesce(
      (select rtrim(valor->>'app_base_url', '/') from public.configuracoes where chave = 'cron'),
      'https://totalpass-manager.vercel.app'
    ) || '/api/cron/bridge-offline-alert',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(
        (select valor->>'secret' from public.configuracoes where chave = 'cron'),
        ''
      )
    ),
    body := '{}'::jsonb
  ) as request_id;
  $$
);
