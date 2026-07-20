import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export function formatDate(date: string | null | undefined) {
  if (!date) return "-";

  // Datas puras (YYYY-MM-DD) devem ser exibidas como estão, sem aplicar
  // fuso horário — caso contrário "2026-08-01" vira 31/07 no horário local.
  const soData = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (soData) {
    const [, ano, mes, dia] = soData;
    return `${dia}/${mes}/${ano}`;
  }

  return new Intl.DateTimeFormat("pt-BR").format(new Date(date));
}

export function formatDateTime(date: string | null | undefined) {
  if (!date) return "-";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(date));
}

export function formatCpf(cpf: string) {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return cpf;
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
}

export function formatPhone(phone: string | null) {
  if (!phone) return "-";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11) {
    return digits.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3");
  }
  if (digits.length === 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3");
  }
  return phone;
}

export function normalizeCpf(cpf: string) {
  return cpf.replace(/\D/g, "");
}

export function normalizePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export function maskCpfInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  }
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

export function maskPhoneInput(value: string) {
  let digits = value.replace(/\D/g, "");
  // Aceita 55 no começo, mas a máscara visual fica (DD) 9XXXX-XXXX
  if (digits.startsWith("55") && digits.length >= 12) {
    digits = digits.slice(2);
  }
  digits = digits.slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

/** Normaliza e-mail digitado (minúsculas, sem espaços, só caracteres válidos). */
export function maskEmailInput(value: string) {
  return value
    .replace(/\s/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9.@_+-]/g, "")
    .slice(0, 160);
}

export function maskCurrencyInput(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const cents = parseInt(digits, 10);
  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function parseCurrencyInput(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!digits) return 0;
  return parseInt(digits, 10) / 100;
}

export function maskDateInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function isValidDateParts(day: number, month: number, year: number) {
  if (year < 2000 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

/** Converte dd/mm/aaaa para yyyy-mm-dd. Retorna null se inválido. */
export function parseDateInput(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const day = parseInt(digits.slice(0, 2), 10);
  const month = parseInt(digits.slice(2, 4), 10);
  const year = parseInt(digits.slice(4, 8), 10);
  if (!isValidDateParts(day, month, year)) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isValidDateInput(value: string) {
  return parseDateInput(value) !== null;
}

export function formatIsoToBrDate(iso: string) {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

export function statusLabel(status: string) {
  const map: Record<string, string> = {
    ativo: "Ativo",
    elegivel: "Elegível",
    inativo: "Inativo",
    titular: "Titular",
    dependente: "Dependente",
    ACTIVE: "Ativa",
    INACTIVE: "Inativa",
    EXPIRED: "Expirada",
    CANCELLED: "Cancelada",
    PENDING: "Pendente",
    RECEIVED: "Recebida",
    CONFIRMED: "Confirmada",
    OVERDUE: "Vencida",
    DELETED: "Cancelada",
    REFUNDED: "Estornada",
    pendente: "Pendente",
    enviando: "Enviando",
    enviado: "Enviado",
    erro: "Erro",
    processando: "Processando",
    concluido: "Concluído",
  };
  return map[status] ?? status;
}
