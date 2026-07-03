import type { SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "@/lib/config";
import {
  DEFAULT_CRON_CONFIG,
  type ConfigCron,
} from "@/types/database";

function clampHour(value: number | undefined, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(23, Math.max(0, Math.round(n)));
}

function clampMinute(value: number | undefined, fallback: number) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(59, Math.max(0, Math.round(n)));
}

function toDayMinutes(hour: number, minute: number) {
  return hour * 60 + minute;
}

function fromDayMinutes(total: number) {
  const normalized = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  return {
    hour: Math.floor(normalized / 60),
    minute: normalized % 60,
  };
}

export function formatCronTimeValue(hour: number, minute: number) {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseCronTimeValue(value: string) {
  const [h, m] = value.split(":");
  return {
    hour: clampHour(Number(h), 0),
    minute: clampMinute(Number(m), 0),
  };
}

export function normalizeCronConfig(raw: ConfigCron | null | undefined): ConfigCron {
  const hora = clampHour(raw?.hora_agendamento, DEFAULT_CRON_CONFIG.hora_agendamento);
  const minuto = clampMinute(
    raw?.minuto_agendamento,
    DEFAULT_CRON_CONFIG.minuto_agendamento
  );

  let janelaInicio = clampHour(raw?.janela_inicio, DEFAULT_CRON_CONFIG.janela_inicio);
  let janelaInicioMinuto = clampMinute(
    raw?.janela_inicio_minuto,
    DEFAULT_CRON_CONFIG.janela_inicio_minuto
  );
  let janelaFim = clampHour(raw?.janela_fim, DEFAULT_CRON_CONFIG.janela_fim);
  let janelaFimMinuto = clampMinute(
    raw?.janela_fim_minuto,
    DEFAULT_CRON_CONFIG.janela_fim_minuto
  );

  let startTotal = toDayMinutes(janelaInicio, janelaInicioMinuto);
  let endTotal = toDayMinutes(janelaFim, janelaFimMinuto);
  if (endTotal <= startTotal) {
    endTotal = startTotal + 60;
    const end = fromDayMinutes(endTotal);
    janelaFim = end.hour;
    janelaFimMinuto = end.minute;
  }

  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const defaultEdgeUrl = baseUrl
    ? `${baseUrl}/functions/v1/cron-reminders`
    : undefined;

  return {
    secret: raw?.secret,
    edge_function_url: raw?.edge_function_url ?? defaultEdgeUrl,
    hora_agendamento: hora,
    minuto_agendamento: minuto,
    janela_inicio: janelaInicio,
    janela_inicio_minuto: janelaInicioMinuto,
    janela_fim: janelaFim,
    janela_fim_minuto: janelaFimMinuto,
  };
}

export async function getCronConfig(supabase: SupabaseClient) {
  const config = await getConfig<ConfigCron>(supabase, "cron");
  return normalizeCronConfig(config);
}

export function getReminderWindow(cron: ConfigCron) {
  const normalized = normalizeCronConfig(cron);
  return {
    startHour: normalized.janela_inicio!,
    startMinute: normalized.janela_inicio_minuto!,
    endHour: normalized.janela_fim!,
    endMinute: normalized.janela_fim_minuto!,
  };
}

/** Converte horário BRT para UTC (Brasil sem horário de verão, UTC-3). */
export function brtTimeToUtc(horaBrt: number, minutoBrt: number) {
  const today = new Date();
  const y = today.toLocaleString("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric" });
  const m = today.toLocaleString("en-CA", { timeZone: "America/Sao_Paulo", month: "2-digit" });
  const d = today.toLocaleString("en-CA", { timeZone: "America/Sao_Paulo", day: "2-digit" });
  const hh = String(horaBrt).padStart(2, "0");
  const mi = String(minutoBrt).padStart(2, "0");
  const utc = new Date(`${y}-${m}-${d}T${hh}:${mi}:00-03:00`);
  return {
    hour: utc.getUTCHours(),
    minute: utc.getUTCMinutes(),
  };
}

export async function rescheduleReminderCronJob(
  supabase: SupabaseClient,
  horaBrt: number,
  minutoBrt: number
) {
  const { error } = await supabase.rpc("reschedule_reminder_cron", {
    hora_brt: horaBrt,
    minuto_brt: minutoBrt,
  });
  if (error) throw new Error(error.message);
}
