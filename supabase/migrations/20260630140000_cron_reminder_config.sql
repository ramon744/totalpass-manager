-- Campos configuráveis de horário para lembretes WhatsApp
UPDATE public.configuracoes
SET
  valor = COALESCE(valor, '{}'::jsonb) || jsonb_build_object(
    'hora_agendamento', COALESCE((valor->>'hora_agendamento')::int, 8),
    'janela_inicio', COALESCE((valor->>'janela_inicio')::int, 8),
    'janela_fim', COALESCE((valor->>'janela_fim')::int, 12)
  ),
  updated_at = NOW()
WHERE chave = 'cron';

INSERT INTO public.configuracoes (chave, valor, updated_at)
SELECT
  'cron',
  jsonb_build_object(
    'secret', 'um_segredo_forte',
    'edge_function_url', 'https://yxwugamcufbhiicgwufd.supabase.co/functions/v1/cron-reminders',
    'hora_agendamento', 8,
    'janela_inicio', 8,
    'janela_fim', 12
  ),
  NOW()
WHERE NOT EXISTS (SELECT 1 FROM public.configuracoes WHERE chave = 'cron');

-- Reagenda o job diário conforme hora em Brasília (BRT = UTC-3)
CREATE OR REPLACE FUNCTION public.reschedule_reminder_cron(hora_brt integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  hora_utc integer;
  cron_expr text;
BEGIN
  IF hora_brt < 0 OR hora_brt > 23 THEN
    RAISE EXCEPTION 'hora_agendamento deve estar entre 0 e 23';
  END IF;

  hora_utc := hora_brt + 3;
  IF hora_utc >= 24 THEN
    hora_utc := hora_utc - 24;
  END IF;

  cron_expr := '0 ' || hora_utc::text || ' * * *';

  PERFORM cron.unschedule(jobid)
  FROM cron.job
  WHERE jobname = 'totalpass_reminders_schedule_daily';

  PERFORM cron.schedule(
    'totalpass_reminders_schedule_daily',
    cron_expr,
    $cron$
    SELECT net.http_post(
      url := COALESCE(
        (SELECT valor->>'edge_function_url' FROM public.configuracoes WHERE chave = 'cron'),
        'https://yxwugamcufbhiicgwufd.supabase.co/functions/v1/cron-reminders'
      ),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || COALESCE(
          (SELECT valor->>'secret' FROM public.configuracoes WHERE chave = 'cron'),
          ''
        )
      ),
      body := '{"action":"schedule"}'::jsonb
    ) AS request_id;
    $cron$
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reschedule_reminder_cron(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reschedule_reminder_cron(integer) TO service_role;
