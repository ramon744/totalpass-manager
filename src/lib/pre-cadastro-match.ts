import { formatIsoToBrDate, normalizeCpf } from "@/lib/utils";
import type { PreCadastroWhatsapp } from "@/types/database";

const BRAZIL_TZ = "America/Sao_Paulo";

export type SugestaoWhatsappStatus = "pendente" | "aplicada" | "ignorada";

export interface SugestaoWhatsapp {
  preCadastroId: string;
  telefone: string;
  /** Data da adesão (etiqueta) em dd/mm/aaaa. */
  dataEtiqueta: string;
  /** 1º vencimento sugerido (1 mês após a etiqueta) em dd/mm/aaaa. */
  vencimento: string;
  etiquetas: string[];
  status: SugestaoWhatsappStatus;
}

function ymdFromIsoBrazil(iso: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAZIL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date(iso));
}

function addOneMonthYmd(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  let nextMonth = month + 1;
  let nextYear = year;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  const lastDay = new Date(nextYear, nextMonth, 0).getDate();
  const clampedDay = Math.min(day, lastDay);
  return `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(clampedDay).padStart(2, "0")}`;
}

/** Data da etiqueta (adesão) em dd/mm/aaaa, fuso Brasília. */
export function formatDataEtiquetaBr(iso: string) {
  return formatIsoToBrDate(ymdFromIsoBrazil(iso));
}

/** 1º vencimento = mesmo dia, mês seguinte (ex.: 03/07 → 03/08). */
export function vencimentoSugeridoFromDataEtiqueta(iso: string) {
  return formatIsoToBrDate(addOneMonthYmd(ymdFromIsoBrazil(iso)));
}

export function buildPreCadastrosByCpf(items: PreCadastroWhatsapp[]) {
  const map = new Map<string, PreCadastroWhatsapp>();
  for (const item of items) {
    if (!item.cpf) continue;
    const cpf = normalizeCpf(item.cpf);
    const existing = map.get(cpf);
    if (
      !existing ||
      new Date(item.data_etiqueta).getTime() >
        new Date(existing.data_etiqueta).getTime()
    ) {
      map.set(cpf, item);
    }
  }
  return map;
}

export function telefonePreCadastroParaMascara(telefone: string) {
  const digits = telefone.replace(/\D/g, "");
  const local =
    digits.startsWith("55") && digits.length >= 12
      ? digits.slice(2, 13)
      : digits.slice(0, 11);
  return local;
}

export function criarSugestaoWhatsapp(
  pre: PreCadastroWhatsapp,
  telefoneMascara: (digits: string) => string
): SugestaoWhatsapp {
  return {
    preCadastroId: pre.id,
    telefone: telefoneMascara(telefonePreCadastroParaMascara(pre.telefone)),
    dataEtiqueta: formatDataEtiquetaBr(pre.data_etiqueta),
    vencimento: vencimentoSugeridoFromDataEtiqueta(pre.data_etiqueta),
    etiquetas: pre.etiquetas ?? [],
    status: "pendente",
  };
}
