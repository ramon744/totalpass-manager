-- Minutos configuráveis para lembretes WhatsApp
UPDATE public.configuracoes
SET
  valor = COALESCE(valor, '{}'::jsonb) || jsonb_build_object(
    'minuto_agendamento', COALESCE((valor->>'minuto_agendamento')::int, 0),
    'janela_inicio_minuto', COALESCE((valor->>'janela_inicio_minuto')::int, 0),
    'janela_fim_minuto', COALESCE((valor->>'janela_fim_minuto')::int, 0)
  ),
  updated_at = NOW()
WHERE chave = 'cron';

DROP FUNCTION IF EXISTS public.reschedule_reminder_cron(integer);

CREATE OR REPLACE FUNCTION public.reschedule_reminder_cron(
  hora_brt integer,
  minuto_brt integer DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_catalog
AS $$
DECLARE
  hora_utc integer;
  minuto_utc integer;
  cron_expr text;
BEGIN
  IF hora_brt < 0 OR hora_brt > 23 THEN
    RAISE EXCEPTION 'hora_agendamento deve estar entre 0 e 23';
  END IF;

  IF minuto_brt < 0 OR minuto_brt > 59 THEN
    RAISE EXCEPTION 'minuto_agendamento deve estar entre 0 e 59';
  END IF;

  minuto_utc := minuto_brt;
  hora_utc := hora_brt + 3;
  IF hora_utc >= 24 THEN
    hora_utc := hora_utc - 24;
  END IF;

  cron_expr := minuto_utc || ' ' || hora_utc || ' * * *';

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

REVOKE ALL ON FUNCTION public.reschedule_reminder_cron(integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reschedule_reminder_cron(integer, integer) TO service_role;
