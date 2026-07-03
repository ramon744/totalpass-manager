import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  getCronConfig,
  normalizeCronConfig,
  rescheduleReminderCronJob,
  formatCronTimeValue,
} from "@/lib/cron-config";
import { getCronConfigRaw, updateConfig } from "@/lib/config";
import { createLog } from "@/lib/logger";
import {
  drainMessageQueue,
  schedulePaymentReminders,
} from "@/lib/services/messages";
import { DEFAULT_CRON_CONFIG, type ConfigCron } from "@/types/database";

async function serviceClientOrThrow() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return createServiceClient();
  }
  return createClient();
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const body = (await request.json()) as Partial<ConfigCron>;
  const existing = normalizeCronConfig(await getCronConfigRaw(supabase));

  const merged = normalizeCronConfig({
    ...existing,
    hora_agendamento: body.hora_agendamento ?? existing.hora_agendamento,
    minuto_agendamento: body.minuto_agendamento ?? existing.minuto_agendamento,
    janela_inicio: body.janela_inicio ?? existing.janela_inicio,
    janela_inicio_minuto:
      body.janela_inicio_minuto ?? existing.janela_inicio_minuto,
    janela_fim: body.janela_fim ?? existing.janela_fim,
    janela_fim_minuto: body.janela_fim_minuto ?? existing.janela_fim_minuto,
    secret: existing.secret,
    edge_function_url: existing.edge_function_url,
  });

  try {
    const client = await serviceClientOrThrow();
    await updateConfig(client, "cron", merged as Record<string, unknown>);

    let cronReagendado = true;
    try {
      await rescheduleReminderCronJob(
        client,
        merged.hora_agendamento!,
        merged.minuto_agendamento!
      );
    } catch (rpcError) {
      cronReagendado = false;
      await createLog(supabase, {
        usuario_id: user.id,
        acao: "configuracao_cron_parcial",
        entidade: "configuracoes",
        payload: {
          erro:
            rpcError instanceof Error
              ? rpcError.message
              : "Falha ao reagendar pg_cron",
        },
      });
    }

    await createLog(supabase, {
      usuario_id: user.id,
      acao: "configuracao_cron_atualizada",
      entidade: "configuracoes",
      payload: {
        hora_agendamento: merged.hora_agendamento,
        minuto_agendamento: merged.minuto_agendamento,
        janela_inicio: merged.janela_inicio,
        janela_inicio_minuto: merged.janela_inicio_minuto,
        janela_fim: merged.janela_fim,
        janela_fim_minuto: merged.janela_fim_minuto,
        cron_reagendado: cronReagendado,
      },
    });

    return NextResponse.json({
      success: true,
      cron: merged,
      cronReagendado,
      aviso: cronReagendado
        ? undefined
        : "Horários salvos, mas o pg_cron não foi reagendado. Aplique a migration cron_reminder_config no Supabase (função reschedule_reminder_cron).",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao salvar cron" },
      { status: 500 }
    );
  }
}

/** Agenda lembretes agora (teste) e processa a fila de envio. */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const client = await serviceClientOrThrow();
    const cron = await getCronConfig(client);

    const schedule = await schedulePaymentReminders(client, { immediate: true });
    const send = await drainMessageQueue(client);

    await createLog(supabase, {
      usuario_id: user.id,
      acao: "lembretes_executados_manualmente",
      entidade: "configuracoes",
      payload: {
        scheduled: schedule.scheduled,
        sent: send.processed,
        pending: send.pending,
        janela: {
          inicio: formatCronTimeValue(
            cron.janela_inicio ?? DEFAULT_CRON_CONFIG.janela_inicio,
            cron.janela_inicio_minuto ?? DEFAULT_CRON_CONFIG.janela_inicio_minuto
          ),
          fim: formatCronTimeValue(
            cron.janela_fim ?? DEFAULT_CRON_CONFIG.janela_fim,
            cron.janela_fim_minuto ?? DEFAULT_CRON_CONFIG.janela_fim_minuto
          ),
        },
      },
    });

    return NextResponse.json({
      success: true,
      scheduled: schedule.scheduled,
      sent: send.processed,
      pending: send.pending,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro ao executar lembretes" },
      { status: 500 }
    );
  }
}
