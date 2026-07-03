const BRAZIL_TZ = "America/Sao_Paulo";

/** Início padrão da janela de envio de lembretes (horário de Brasília). */
export const REMINDER_WINDOW_START_HOUR = 8;
/** Fim padrão da janela de envio de lembretes (horário de Brasília). */
export const REMINDER_WINDOW_END_HOUR = 12;
/** Intervalo mínimo entre lembretes agendados. */
export const REMINDER_MIN_INTERVAL_MS = 5_000;
/** Intervalo máximo entre lembretes agendados. */
export const REMINDER_MAX_INTERVAL_MS = 120_000;

export type ReminderWindowOptions = {
  startHour?: number;
  startMinute?: number;
  endHour?: number;
  endMinute?: number;
  /** Envia a partir de agora (teste manual), ignorando início da janela. */
  immediate?: boolean;
};

type BrazilParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function getBrazilParts(date: Date): BrazilParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: BRAZIL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);

  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
    second: pick("second"),
  };
}

function buildBrazilDate(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0
) {
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  const mi = String(minute).padStart(2, "0");
  const ss = String(second).padStart(2, "0");
  return new Date(`${year}-${mm}-${dd}T${hh}:${mi}:${ss}-03:00`);
}

function addBrazilDays(parts: BrazilParts, days: number): BrazilParts {
  const base = buildBrazilDate(parts.year, parts.month, parts.day, 12);
  base.setUTCDate(base.getUTCDate() + days);
  return getBrazilParts(base);
}

/** Data YYYY-MM-DD no fuso de Brasília, com offset opcional em dias. */
export function getBrazilDateString(now = new Date(), offsetDays = 0): string {
  const parts =
    offsetDays === 0 ? getBrazilParts(now) : addBrazilDays(getBrazilParts(now), offsetDays);
  const mm = String(parts.month).padStart(2, "0");
  const dd = String(parts.day).padStart(2, "0");
  return `${parts.year}-${mm}-${dd}`;
}

/**
 * Distribui horários de envio ao longo da janela diária (Brasília),
 * evitando disparo em massa no mesmo minuto.
 */
export function computeReminderScheduleSlots(
  count: number,
  now = new Date(),
  window: ReminderWindowOptions = {}
): Date[] {
  if (count <= 0) return [];

  const startHour = window.startHour ?? REMINDER_WINDOW_START_HOUR;
  const startMinute = window.startMinute ?? 0;
  const endHour = window.endHour ?? REMINDER_WINDOW_END_HOUR;
  const endMinute = window.endMinute ?? 0;

  if (window.immediate) {
    return Array.from(
      { length: count },
      (_, index) => new Date(now.getTime() + index * REMINDER_MIN_INTERVAL_MS)
    );
  }

  const today = getBrazilParts(now);
  let windowStart = buildBrazilDate(
    today.year,
    today.month,
    today.day,
    startHour,
    startMinute
  );
  let windowEnd = buildBrazilDate(
    today.year,
    today.month,
    today.day,
    endHour,
    endMinute
  );

  let effectiveStart = now > windowStart ? now : windowStart;

  // Janela de hoje ainda não começou: agenda dentro dela (não pula para amanhã).
  if (now < windowStart) {
    effectiveStart = windowStart;
  } else if (effectiveStart >= windowEnd) {
    const tomorrow = addBrazilDays(today, 1);
    windowStart = buildBrazilDate(
      tomorrow.year,
      tomorrow.month,
      tomorrow.day,
      startHour,
      startMinute
    );
    windowEnd = buildBrazilDate(
      tomorrow.year,
      tomorrow.month,
      tomorrow.day,
      endHour,
      endMinute
    );
    effectiveStart = windowStart;
  }

  const windowMs = Math.max(windowEnd.getTime() - effectiveStart.getTime(), 60_000);
  const intervalMs = Math.max(
    REMINDER_MIN_INTERVAL_MS,
    Math.min(REMINDER_MAX_INTERVAL_MS, Math.floor(windowMs / count))
  );

  return Array.from(
    { length: count },
    (_, index) => new Date(effectiveStart.getTime() + index * intervalMs)
  );
}

/** Ajusta o intervalo de envio conforme o volume pendente na fila. */
export function resolveSendIntervalMs(dueCount: number, baseIntervalMs: number) {
  if (dueCount > 50) return 15_000;
  if (dueCount > 20) return 8_000;
  return baseIntervalMs;
}
