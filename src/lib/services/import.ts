import type { SupabaseClient } from "@supabase/supabase-js";
import * as XLSX from "xlsx";
import { AsaasClient } from "@/lib/asaas/client";
import { getAsaasConfig } from "@/lib/config";
import { createLog } from "@/lib/logger";
import { findOrCreateProvedor, findProvedorByNomeExato, normalizeNomeProvedor } from "@/lib/services/provedores";
import {
  cancelActiveSubscriptionsForBeneficiario,
  reconcileDependentBillingForTitular,
} from "@/lib/services/subscriptions";
import {
  isDependenteCobravelPorStatus,
  provedorCobraDependentes,
  provedorTemValorDependente,
  shouldAutoCobrarNovoDependente,
  titularJaCobraDependentesNoBanco,
} from "@/lib/dependent-billing";
import { normalizeCpf } from "@/lib/utils";
import { isValidCpf } from "@/lib/validators/cpf";
import { sanitizePhone } from "@/lib/validators/phone";
import type {
  Beneficiario,
  ImportacaoErro,
  PerfilBeneficiario,
  StatusTotalpass,
} from "@/types/database";

interface PlanilhaRow {
  nome?: string;
  cpf?: string;
  telefone?: string;
  email?: string;
  perfil?: string;
  status?: string;
  plano?: string;
  aderido_em?: string;
  titular_cpf?: string;
  empresa?: string;
}

const COLUMN_MAP: Record<string, keyof PlanilhaRow> = {
  nome: "nome",
  name: "nome",
  beneficiario: "nome",
  cpf: "cpf",
  "cpf/cnpj": "cpf",
  documento: "cpf",
  telefone: "telefone",
  phone: "telefone",
  celular: "telefone",
  email: "email",
  "e-mail": "email",
  perfil: "perfil",
  tipo: "perfil",
  status: "status",
  "status totalpass": "status",
  plano: "plano",
  empresa: "empresa",
  "razao social": "empresa",
  provedor: "empresa",
  "aderido em": "aderido_em",
  "data aderido": "aderido_em",
  "data de cadastro na totalpass": "aderido_em",
  "cpf do titular": "titular_cpf",
  "cpf titular": "titular_cpf",
};

function normalizeHeader(h: string) {
  return String(h ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const headers = (rows[i] ?? []).map((c) => normalizeHeader(String(c)));
    const hasNome = headers.includes("nome");
    const hasDoc = headers.some((h) => COLUMN_MAP[h] === "cpf");
    if (hasNome && hasDoc) return i;
  }
  return 0;
}

function parseStatus(value?: string): StatusTotalpass {
  const v = (value ?? "").toLowerCase().trim();
  if (v === "inactive" || v.includes("inativ") || v.includes("cancel")) {
    return "inativo";
  }
  if (v === "active" || v.includes("ativ")) return "ativo";
  if (v.includes("eleg")) return "elegivel";
  return "ativo";
}

function cleanCellValue(value: string): string | undefined {
  const v = value.trim().replace(/^"+|"+$/g, "").trim();
  if (!v || v === "-" || v === '""') return undefined;
  return v;
}

function parseCsvFields(line: string): string[] {
  let s = line.trim();
  if (!s) return [];

  const semiErr = s.match(/^"(.+)";\s*/);
  if (semiErr) {
    s = semiErr[1];
  } else if (s.startsWith('"') && s.endsWith('"') && s.length > 2) {
    s = s.slice(1, -1);
  }

  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      if (inQuotes && s[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export interface SpreadsheetParseResult {
  rows: PlanilhaRow[];
  hasEmpresaColumn: boolean;
}

function parseColaboradoresCsv(buffer: ArrayBuffer): SpreadsheetParseResult {
  const text = new TextDecoder("utf-8").decode(buffer);
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length === 0) return { rows: [], hasEmpresaColumn: false };

  // Formato TotalPass: metadados no topo — descobre a linha de cabeçalho.
  let headerLineIdx = 0;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const headers = parseCsvFields(lines[i]).map((c) => normalizeHeader(String(c)));
    const hasNome = headers.includes("nome");
    const hasDoc = headers.some((h) => COLUMN_MAP[h] === "cpf");
    if (hasNome && hasDoc) {
      headerLineIdx = i;
      break;
    }
  }

  const headerFields = parseCsvFields(lines[headerLineIdx]).map((c) =>
    normalizeHeader(String(c))
  );
  const hasEmpresaColumn = headerFields.some((h) => COLUMN_MAP[h] === "empresa");

  const rows: PlanilhaRow[] = [];
  for (let i = headerLineIdx + 1; i < lines.length; i++) {
    const fields = parseCsvFields(lines[i]);
    if (!fields.length) continue;

    const mapped: PlanilhaRow = {};
    let hasData = false;

    headerFields.forEach((header, col) => {
      const field = COLUMN_MAP[header];
      if (!field) return;
      const value = cleanCellValue(String(fields[col] ?? ""));
      if (value) {
        mapped[field] = value;
        hasData = true;
      }
    });

    if (!hasData) continue;

    if (mapped.aderido_em) {
      mapped.aderido_em = parseExcelDate(mapped.aderido_em) ?? undefined;
    }
    rows.push(mapped);
  }

  return { rows, hasEmpresaColumn };
}

function parsePerfil(value?: string): PerfilBeneficiario {
  const v = (value ?? "").toLowerCase().trim();
  if (v.includes("dep")) return "dependente";
  return "titular";
}

function parseExcelDate(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().split("T")[0];
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    if (date) {
      const d = new Date(date.y, date.m - 1, date.d);
      return d.toISOString().split("T")[0];
    }
  }
  const str = String(value).trim();
  if (!str) return null;
  const br = str.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return str;
}

export function parseSpreadsheetWithMeta(
  buffer: ArrayBuffer,
  fileName: string
): SpreadsheetParseResult {
  if (fileName.toLowerCase().endsWith(".csv")) {
    return parseColaboradoresCsv(buffer);
  }

  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: true,
  });

  const headerRow = findHeaderRow(matrix);
  const headers = (matrix[headerRow] ?? []).map((c) => normalizeHeader(String(c)));
  const hasEmpresaColumn = headers.some((h) => COLUMN_MAP[h] === "empresa");

  const rows: PlanilhaRow[] = [];
  for (let i = headerRow + 1; i < matrix.length; i++) {
    const cells = matrix[i] ?? [];
    const mapped: PlanilhaRow = {};
    let hasData = false;

    headers.forEach((header, col) => {
      const field = COLUMN_MAP[header];
      if (!field) return;
      const rawValue = cells[col];
      const value = String(rawValue ?? "").trim();
      if (value && value !== "-") {
        mapped[field] = value;
        hasData = true;
      }
    });

    if (!hasData) continue;

    if (mapped.aderido_em) {
      mapped.aderido_em = parseExcelDate(mapped.aderido_em) ?? undefined;
    }
    rows.push(mapped);
  }

  return { rows, hasEmpresaColumn };
}

export function parseSpreadsheet(buffer: ArrayBuffer, fileName = ""): PlanilhaRow[] {
  return parseSpreadsheetWithMeta(buffer, fileName).rows;
}

export interface ImportPreviewRow {
  nome: string;
  cpf: string;
  email: string;
  telefone: string;
  status: string;
}

export interface DependenteCobrancaPreview {
  cpf: string;
  nome: string;
  titular_cpf: string;
  titular_nome: string;
  provedor_id: string;
  provedor_nome: string;
  valor_dependente: number;
  /** Cobrança obrigatória: titular já possui dependente na fatura. */
  cobranca_automatica: boolean;
}

type ProvedorCobrancaRow = {
  id: string;
  nome: string;
  cobrar_dependentes: boolean;
  valor_dependente: number | null;
};

async function loadProvedorCobranca(
  supabase: SupabaseClient,
  provedorId: string,
  cache: Map<string, ProvedorCobrancaRow>
): Promise<ProvedorCobrancaRow | null> {
  if (cache.has(provedorId)) return cache.get(provedorId) ?? null;
  const { data } = await supabase
    .from("provedores")
    .select("id, nome, cobrar_dependentes, valor_dependente")
    .eq("id", provedorId)
    .maybeSingle();
  if (!data) return null;
  const row = data as ProvedorCobrancaRow;
  cache.set(provedorId, row);
  return row;
}

/** Dependentes novos na planilha elegíveis para cobrança (provedor ou titular já cobra). */
export async function getNovosDependentesCobraveis(
  supabase: SupabaseClient,
  params: {
    buffer: ArrayBuffer;
    fileName: string;
    provedorIdFixo?: string;
    rowsOverride?: ImportPreviewRow[];
  }
): Promise<DependenteCobrancaPreview[]> {
  const parsedFromFile = parseSpreadsheetWithMeta(params.buffer, params.fileName);
  const hasEmpresaColumn = parsedFromFile.hasEmpresaColumn;
  const parsedRows: PlanilhaRow[] =
    params.rowsOverride?.length
      ? params.rowsOverride.map((r) => ({
          nome: r.nome,
          cpf: r.cpf,
          email: r.email,
          telefone: r.telefone,
          status: r.status,
        }))
      : parsedFromFile.rows;
  const requiresProvedor = parsedRows.length > 0 && !hasEmpresaColumn;

  if (requiresProvedor && !params.provedorIdFixo) {
    return [];
  }

  const rows = [...parsedRows].sort((a, b) => {
    const aDep = (a.perfil ?? "").toLowerCase().includes("dep") ? 1 : 0;
    const bDep = (b.perfil ?? "").toLowerCase().includes("dep") ? 1 : 0;
    return aDep - bDep;
  });

  const cpfsPlanilha = rows
    .map((r) => normalizeCpf(r.cpf ?? ""))
    .filter((cpf) => cpf && isValidCpf(cpf));

  const { data: existentes } = await supabase
    .from("beneficiarios")
    .select("cpf")
    .in("cpf", cpfsPlanilha.length ? cpfsPlanilha : ["__none__"]);

  const cpfsExistentes = new Set((existentes ?? []).map((b) => b.cpf));

  const titularesMap = new Map<string, string>();
  const titularesNomeMap = new Map<string, string>();
  const titularesProvedorMap = new Map<string, string | null>();
  const provedoresCobrancaCache = new Map<string, ProvedorCobrancaRow>();
  const resultado: DependenteCobrancaPreview[] = [];

  for (const row of rows) {
    const cpf = normalizeCpf(row.cpf ?? "");
    if (!cpf || !isValidCpf(cpf) || !row.nome?.trim()) continue;

    const perfil = parsePerfil(row.perfil);
    const status = parseStatus(row.status);

    if (perfil === "titular") {
      const { data: titularDb } = await supabase
        .from("beneficiarios")
        .select("id")
        .eq("cpf", cpf)
        .eq("perfil", "titular")
        .maybeSingle();
      titularesMap.set(cpf, titularDb?.id ?? `planilha:${cpf}`);
      titularesNomeMap.set(cpf, row.nome.trim());

      let provedorId: string | null = null;
      if (row.empresa?.trim()) {
        const found = await findProvedorByNomeExato(
          supabase,
          normalizeNomeProvedor(row.empresa)
        );
        provedorId = found?.id ?? null;
      } else if (params.provedorIdFixo) {
        provedorId = params.provedorIdFixo;
      }
      titularesProvedorMap.set(cpf, provedorId);
      continue;
    }

    if (cpfsExistentes.has(cpf)) continue;
    if (!isDependenteCobravelPorStatus({ status_totalpass: status } as Beneficiario)) {
      continue;
    }

    const titularCpf = normalizeCpf(row.titular_cpf ?? "");
    if (!titularCpf) continue;

    const titularNome = titularesNomeMap.get(titularCpf) ?? "";
    if (!titularNome) {
      const { data: titularDb } = await supabase
        .from("beneficiarios")
        .select("nome")
        .eq("cpf", titularCpf)
        .eq("perfil", "titular")
        .maybeSingle();
      if (titularDb?.nome) titularesNomeMap.set(titularCpf, titularDb.nome);
    }

    let provedorId: string | null = titularesProvedorMap.get(titularCpf) ?? null;
    if (!provedorId && row.empresa?.trim()) {
      const found = await findProvedorByNomeExato(
        supabase,
        normalizeNomeProvedor(row.empresa)
      );
      provedorId = found?.id ?? null;
    }
    if (!provedorId) continue;

    const provedor = await loadProvedorCobranca(supabase, provedorId, provedoresCobrancaCache);
    if (!provedor || !provedorTemValorDependente(provedor)) continue;

    let titularId = titularesMap.get(titularCpf);
    if (!titularId || titularId.startsWith("planilha:")) {
      const { data: titularDb } = await supabase
        .from("beneficiarios")
        .select("id")
        .eq("cpf", titularCpf)
        .eq("perfil", "titular")
        .maybeSingle();
      titularId = titularDb?.id;
    }

    const titularJaCobra = titularId
      ? await titularJaCobraDependentesNoBanco(supabase, titularId)
      : false;

    if (!provedorCobraDependentes(provedor) && !titularJaCobra) continue;

    resultado.push({
      cpf,
      nome: row.nome.trim(),
      titular_cpf: titularCpf,
      titular_nome: titularesNomeMap.get(titularCpf) ?? titularNome,
      provedor_id: provedor.id,
      provedor_nome: provedor.nome,
      valor_dependente: Number(provedor.valor_dependente),
      cobranca_automatica: titularJaCobra,
    });
  }

  return resultado;
}

export function analyzeSpreadsheet(buffer: ArrayBuffer, fileName: string) {
  const { rows, hasEmpresaColumn } = parseSpreadsheetWithMeta(buffer, fileName);
  const requiresProvedor = rows.length > 0 && !hasEmpresaColumn;

  return {
    totalRows: rows.length,
    requiresProvedor,
    preview: rows.map((r) => ({
      nome: r.nome ?? "",
      cpf: r.cpf ?? "",
      email: r.email ?? "",
      telefone: r.telefone ?? "",
      status: r.status ?? "",
    })),
  };
}

export async function processImport(
  supabase: SupabaseClient,
  params: {
    buffer: ArrayBuffer;
    fileName: string;
    userId: string;
    provedorIdFixo?: string;
    rowsOverride?: ImportPreviewRow[];
    dependentesCobrancaCpfAprovados?: string[];
  }
) {
  const parsedFromFile = parseSpreadsheetWithMeta(params.buffer, params.fileName);
  const hasEmpresaColumn = parsedFromFile.hasEmpresaColumn;
  const parsedRows: PlanilhaRow[] =
    params.rowsOverride?.length ?
      params.rowsOverride.map((r) => ({
        nome: r.nome,
        cpf: r.cpf,
        email: r.email,
        telefone: r.telefone,
        status: r.status,
      }))
    : parsedFromFile.rows;
  const requiresProvedor = parsedRows.length > 0 && !hasEmpresaColumn;

  if (requiresProvedor && !params.provedorIdFixo) {
    throw new Error(
      "Esta planilha não possui coluna de empresa. Selecione um provedor para vincular os colaboradores."
    );
  }

  if (params.provedorIdFixo) {
    const { data: provedor } = await supabase
      .from("provedores")
      .select("id")
      .eq("id", params.provedorIdFixo)
      .maybeSingle();
    if (!provedor) {
      throw new Error("Provedor selecionado não encontrado");
    }
  }

  const rows = parsedRows.sort((a, b) => {
    const aDep = (a.perfil ?? "").toLowerCase().includes("dep") ? 1 : 0;
    const bDep = (b.perfil ?? "").toLowerCase().includes("dep") ? 1 : 0;
    return aDep - bDep;
  });
  const erros: ImportacaoErro[] = [];
  let criados = 0;
  let atualizados = 0;
  let inativados = 0;

  const { data: importacao, error: importError } = await supabase
    .from("importacoes")
    .insert({
      arquivo_nome: params.fileName,
      usuario_id: params.userId,
      total_processados: 0,
      total_criados: 0,
      total_atualizados: 0,
      total_inativados: 0,
      total_erros: 0,
      status: "processando",
      erros: [],
    })
    .select()
    .single();

  if (importError || !importacao) {
    throw new Error(importError?.message ?? "Erro ao criar importação");
  }

  const asaasConfig = await getAsaasConfig(supabase);
  const asaas =
    asaasConfig?.api_key ? new AsaasClient(asaasConfig) : null;

  const cpfsNaPlanilha = new Set<string>();
  const titularesMap = new Map<string, string>();
  const titularesProvedorMap = new Map<string, string | null>();
  const provedoresCache = new Map<string, { id: string; criado: boolean }>();
  const provedoresCriadosPlanilha = new Set<string>();
  const provedoresCobrancaCache = new Map<string, ProvedorCobrancaRow>();
  const titularesAfetados = new Set<string>();
  const titularesInativados = new Set<string>();
  const dependentesCobrancaAprovados = new Set(
    (params.dependentesCobrancaCpfAprovados ?? []).map((cpf) => normalizeCpf(cpf))
  );
  // Empresas/provedores efetivamente presentes nesta importação. A inativação
  // só pode ocorrer dentro desse escopo, nunca em beneficiários de outras
  // empresas ou sem provedor definido.
  const provedoresNaImportacao = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const linha = i + 2;
    const cpf = normalizeCpf(row.cpf ?? "");

    if (!cpf || !isValidCpf(cpf)) {
      erros.push({ linha, cpf, nome: row.nome, mensagem: "CPF inválido" });
      continue;
    }
    if (!row.nome?.trim()) {
      erros.push({ linha, cpf, mensagem: "Nome obrigatório" });
      continue;
    }

    cpfsNaPlanilha.add(cpf);
    const perfil = parsePerfil(row.perfil);
    const status = parseStatus(row.status);
    const telefone = row.telefone ? sanitizePhone(row.telefone) : null;

    const { data: existing } = await supabase
      .from("beneficiarios")
      .select("*")
      .eq("cpf", cpf)
      .maybeSingle();

    let titularId: string | null = null;
    if (perfil === "dependente") {
      const titularCpf = normalizeCpf(row.titular_cpf ?? "");
      titularId = titularesMap.get(titularCpf) ?? null;
      if (!titularId && titularCpf) {
        const { data: titular } = await supabase
          .from("beneficiarios")
          .select("id")
          .eq("cpf", titularCpf)
          .eq("perfil", "titular")
          .maybeSingle();
        titularId = titular?.id ?? null;
      }
    }

    let provedorId: string | null = null;
    if (row.empresa?.trim()) {
      try {
        const { id, criado } = await findOrCreateProvedor(
          supabase,
          row.empresa,
          provedoresCache
        );
        provedorId = id;
        if (criado && id) {
          provedoresCriadosPlanilha.add(normalizeNomeProvedor(row.empresa));
        }
      } catch (e) {
        erros.push({
          linha,
          cpf,
          nome: row.nome,
          mensagem: `Empresa: ${e instanceof Error ? e.message : "erro"}`,
        });
      }
    } else if (params.provedorIdFixo && perfil === "titular") {
      provedorId = params.provedorIdFixo;
    } else if (perfil === "titular" && requiresProvedor) {
      erros.push({
        linha,
        cpf,
        nome: row.nome,
        mensagem: "Provedor obrigatório para importação sem coluna de empresa",
      });
      continue;
    } else if (perfil === "dependente") {
      const titularCpf = normalizeCpf(row.titular_cpf ?? "");
      provedorId = titularesProvedorMap.get(titularCpf) ?? null;
    }

    // Dependente precisa de um titular válido (regra do banco).
    if (perfil === "dependente" && !titularId) {
      const titularCpf = normalizeCpf(row.titular_cpf ?? "");
      erros.push({
        linha,
        cpf,
        nome: row.nome,
        mensagem: titularCpf
          ? `Titular (CPF ${titularCpf}) não encontrado na planilha nem no sistema`
          : "Dependente sem CPF do titular na planilha",
      });
      continue;
    }
    if (perfil === "dependente" && titularId) {
      titularesAfetados.add(titularId);
    }

    const payload = {
      nome: row.nome.trim(),
      cpf,
      telefone,
      email: row.email?.trim() || null,
      perfil,
      titular_id: titularId,
      provedor_id: provedorId,
      status_totalpass: status,
      plano: row.plano?.trim() || null,
      data_aderido_totalpass: row.aderido_em ?? null,
      ultima_importacao_id: importacao.id,
      updated_at: new Date().toISOString(),
    };

    if (provedorId) {
      provedoresNaImportacao.add(provedorId);
    }

    if (existing) {
      // Preenche o cliente no Asaas se ainda não houver (ex.: cadastros criados
      // quando a integração estava com erro). Só para titulares.
      let asaasCustomerId: string | null = existing.asaas_customer_id ?? null;
      if (asaas && !asaasCustomerId && perfil === "titular") {
        try {
          const customer = await asaas.createCustomer({
            name: row.nome.trim(),
            cpfCnpj: cpf,
            email: row.email?.trim(),
            mobilePhone: telefone ?? undefined,
            externalReference: cpf,
          });
          asaasCustomerId = customer.id;
        } catch (e) {
          erros.push({
            linha,
            cpf,
            nome: row.nome,
            mensagem: `Asaas: ${e instanceof Error ? e.message : "erro"}`,
          });
        }
      }

      const { error } = await supabase
        .from("beneficiarios")
        .update({ ...payload, asaas_customer_id: asaasCustomerId })
        .eq("id", existing.id);
      if (error) {
        erros.push({ linha, cpf, nome: row.nome, mensagem: error.message });
      } else {
        atualizados++;
        if (perfil === "titular") {
          titularesMap.set(cpf, existing.id);
          titularesProvedorMap.set(cpf, provedorId);
          if (status === "inativo" && existing.status_totalpass !== "inativo") {
            titularesInativados.add(existing.id);
          } else if (status !== "inativo") {
            titularesAfetados.add(existing.id);
          }
        }
      }
    } else {
      let asaasCustomerId: string | null = null;
      if (asaas && perfil === "titular") {
        try {
          const customer = await asaas.createCustomer({
            name: row.nome.trim(),
            cpfCnpj: cpf,
            email: row.email?.trim(),
            mobilePhone: telefone ?? undefined,
            externalReference: cpf,
          });
          asaasCustomerId = customer.id;
        } catch (e) {
          erros.push({
            linha,
            cpf,
            nome: row.nome,
            mensagem: `Asaas: ${e instanceof Error ? e.message : "erro"}`,
          });
        }
      }

      let cobrarNaAssinaturaNovo = false;
      if (perfil === "dependente" && provedorId && titularId) {
        const prov = await loadProvedorCobranca(
          supabase,
          provedorId,
          provedoresCobrancaCache
        );
        const titularJaCobra = await titularJaCobraDependentesNoBanco(
          supabase,
          titularId
        );
        const dependenteCobravel = isDependenteCobravelPorStatus({
          status_totalpass: status,
        } as Beneficiario);

        cobrarNaAssinaturaNovo =
          shouldAutoCobrarNovoDependente({
            provedor: prov,
            titularJaCobra,
            dependenteCobravel,
          }) &&
          (titularJaCobra || dependentesCobrancaAprovados.has(cpf));
      }

      const { data: created, error } = await supabase
        .from("beneficiarios")
        .insert({
          ...payload,
          asaas_customer_id: asaasCustomerId,
          data_cadastro_sistema: new Date().toISOString(),
          ...(perfil === "dependente"
            ? { cobrar_na_assinatura: cobrarNaAssinaturaNovo }
            : {}),
        })
        .select()
        .single();

      if (error) {
        erros.push({ linha, cpf, nome: row.nome, mensagem: error.message });
      } else if (created) {
        criados++;
        if (perfil === "titular") {
          titularesMap.set(cpf, created.id);
          titularesProvedorMap.set(cpf, provedorId);
          titularesAfetados.add(created.id);
        }
        await createLog(supabase, {
          usuario_id: params.userId,
          acao: "beneficiario_criado",
          entidade: "beneficiarios",
          entidade_id: created.id,
          payload: { origem: "importacao", cpf },
        });
      }
    }
  }

  // Escopo de inativação: nunca inativa beneficiários de empresas que não
  // estejam nesta importação, nem os que estão sem provedor definido.
  // - CSV/planilha sem empresa: usa o provedor escolhido manualmente.
  // - Planilha com empresa: usa apenas as empresas presentes no arquivo.
  const provedoresEscopo = params.provedorIdFixo
    ? new Set<string>([params.provedorIdFixo])
    : provedoresNaImportacao;

  if (provedoresEscopo.size > 0) {
    const { data: ativosNoEscopo } = await supabase
      .from("beneficiarios")
      .select("id, cpf, status_totalpass, provedor_id, perfil, titular_id")
      .neq("status_totalpass", "inativo")
      .in("provedor_id", Array.from(provedoresEscopo));

    for (const b of ativosNoEscopo ?? []) {
      if (!cpfsNaPlanilha.has(b.cpf)) {
        await supabase
          .from("beneficiarios")
          .update({
            status_totalpass: "inativo",
            updated_at: new Date().toISOString(),
            ultima_importacao_id: importacao.id,
          })
          .eq("id", b.id);
        inativados++;
        if (b.perfil === "titular") {
          titularesInativados.add(b.id);
        } else if (b.titular_id) {
          titularesAfetados.add(b.titular_id);
        }
      }
    }
  }

  let dependentesForaCobranca: Array<{
    id: string;
    nome: string;
    status: string;
    titular_id: string | null;
    titular_nome?: string;
  }> = [];

  if (provedoresEscopo.size > 0) {
    const { data: fora } = await supabase
      .from("beneficiarios")
      .select("id, nome, status_totalpass, titular_id, titular:beneficiarios!titular_id(nome)")
      .eq("perfil", "dependente")
      .eq("cobrar_na_assinatura", false)
      .in("status_totalpass", ["ativo", "elegivel"])
      .in("provedor_id", Array.from(provedoresEscopo));

    dependentesForaCobranca = (fora ?? []).map((d) => {
      const titular = (d as {
        titular?: { nome?: string } | Array<{ nome?: string }>;
      }).titular;
      return {
        id: d.id,
        nome: d.nome,
        status: d.status_totalpass,
        titular_id: d.titular_id,
        titular_nome: Array.isArray(titular) ? titular[0]?.nome : titular?.nome,
      };
    });
  }

  for (const titularId of titularesInativados) {
    try {
      await cancelActiveSubscriptionsForBeneficiario(supabase, titularId, {
        userId: params.userId,
        notificar: false,
        motivo: "titular_inativado_importacao",
      });
    } catch {
      // Importação concluída; cancelamento pode ser feito manualmente depois.
    }
  }

  for (const titularId of titularesAfetados) {
    if (titularesInativados.has(titularId)) continue;
    try {
      await reconcileDependentBillingForTitular(supabase, titularId, {
        userId: params.userId,
        motivo: "importação de planilha",
      });
    } catch {
      // Não bloqueia a importação; a assinatura pode ser reconciliada manualmente depois.
    }
  }

  await supabase
    .from("importacoes")
    .update({
      total_processados: rows.length,
      total_criados: criados,
      total_atualizados: atualizados,
      total_inativados: inativados,
      total_erros: erros.length,
      status: erros.length === rows.length ? "erro" : "concluido",
      erros,
    })
    .eq("id", importacao.id);

  await createLog(supabase, {
    usuario_id: params.userId,
    acao: "importacao_concluida",
    entidade: "importacoes",
    entidade_id: importacao.id,
    payload: { criados, atualizados, inativados, erros: erros.length },
  });

  const provedoresIncompletos = Array.from(provedoresCriadosPlanilha);

  return {
    importacaoId: importacao.id,
    total_processados: rows.length,
    total_criados: criados,
    total_atualizados: atualizados,
    total_inativados: inativados,
    total_erros: erros.length,
    erros,
    provedores_incompletos: provedoresIncompletos,
    dependentes_fora_cobranca: dependentesForaCobranca,
  };
}
