import type { ConfigUazapi } from "@/types/database";

function throwUazapiError(data: Record<string, unknown>, fallback: string): never {
  const raw = data?.message ?? data?.error ?? fallback;
  const message = String(raw);
  if (/invalid api key/i.test(message)) {
    throw new Error(
      "Token da Uazapi inválido. Verifique em Configurações → Uazapi ou na variável UAZAPI_TOKEN."
    );
  }
  throw new Error(message);
}

export class UazapiClient {
  private baseUrl: string;
  private token: string;

  constructor(config: ConfigUazapi) {
    this.baseUrl = config.url.replace(/\/$/, "");
    this.token = config.token;
  }

  async sendText(phone: string, message: string) {
    const response = await fetch(`${this.baseUrl}/send/text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: this.token,
      },
      body: JSON.stringify({
        number: phone,
        text: message,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throwUazapiError(data as Record<string, unknown>, "Erro ao enviar mensagem WhatsApp");
    }
    return data;
  }

  async sendMenuButtons(
    phone: string,
    text: string,
    choices: string[],
    footerText = "Toque no botão desejado"
  ) {
    const response = await fetch(`${this.baseUrl}/send/menu`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: this.token,
      },
      body: JSON.stringify({
        number: phone,
        type: "button",
        text,
        choices,
        footerText,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throwUazapiError(data as Record<string, unknown>, "Erro ao enviar botão WhatsApp");
    }
    return data;
  }

  async sendCopyButton(phone: string, text: string, code: string) {
    return this.sendMenuButtons(
      phone,
      text,
      [`Copiar PIX|copy:${code}`],
      "Toque no botão para copiar o PIX"
    );
  }

  async sendPaymentCopyButtons(
    phone: string,
    text: string,
    params: { codigoPix: string; linhaDigitavel?: string }
  ) {
    const choices = [`Copiar PIX|copy:${params.codigoPix}`];
    if (params.linhaDigitavel) {
      choices.push(`Copiar boleto|copy:${params.linhaDigitavel}`);
    }
    return this.sendMenuButtons(phone, text, choices);
  }

  async sendPaymentActionButtons(
    phone: string,
    text: string,
    params: { codigoPix: string; linhaDigitavel: string; linkFatura: string }
  ) {
    return this.sendMenuButtons(phone, text, [
      `Copiar PIX|copy:${params.codigoPix}`,
      `Copiar boleto|copy:${params.linhaDigitavel}`,
      `Abrir fatura|${params.linkFatura}`,
    ]);
  }

  /** Lista etiquetas (labels) da instância WhatsApp. */
  async listLabels(): Promise<Record<string, unknown>[]> {
    const response = await fetch(`${this.baseUrl}/labels`, {
      headers: { token: this.token, Accept: "application/json" },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throwUazapiError(data as Record<string, unknown>, "Erro ao listar etiquetas Uazapi");
    }
    if (Array.isArray(data)) return data as Record<string, unknown>[];
    if (Array.isArray((data as { labels?: unknown }).labels)) {
      return (data as { labels: Record<string, unknown>[] }).labels;
    }
    if (Array.isArray((data as { data?: unknown }).data)) {
      return (data as { data: Record<string, unknown>[] }).data;
    }
    return [];
  }

  /**
   * Lista chats da instância (paginado).
   * Usado na auditoria de etiquetas Cliente TotalPass / Gympass.
   */
  async findChats(params?: {
    limit?: number;
    offset?: number;
  }): Promise<{
    chats: Record<string, unknown>[];
    totalRecords: number;
  }> {
    const limit = params?.limit ?? 500;
    const offset = params?.offset ?? 0;
    const response = await fetch(`${this.baseUrl}/chat/find`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        token: this.token,
        Accept: "application/json",
      },
      body: JSON.stringify({ limit, offset }),
    });
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!response.ok) {
      throwUazapiError(data, "Erro ao listar chats Uazapi");
    }

    const chats = Array.isArray(data.chats)
      ? (data.chats as Record<string, unknown>[])
      : Array.isArray(data)
        ? (data as Record<string, unknown>[])
        : [];
    const pagination = (data.pagination ?? {}) as { totalRecords?: number };
    return {
      chats,
      totalRecords: Number(pagination.totalRecords ?? chats.length),
    };
  }

  /** Percorre todas as páginas de /chat/find. */
  async findAllChats(pageSize = 500): Promise<Record<string, unknown>[]> {
    const all: Record<string, unknown>[] = [];
    let offset = 0;
    let total = Infinity;

    while (offset < total) {
      const page = await this.findChats({ limit: pageSize, offset });
      total = page.totalRecords;
      all.push(...page.chats);
      if (page.chats.length === 0) break;
      offset += page.chats.length;
      if (offset > 5000) break; // proteção
    }

    return all;
  }

  /**
   * Status da instância WhatsApp (GET /instance/status).
   * Usado antes da fila para não gastar tentativas se estiver desconectada.
   */
  async getInstanceStatus(): Promise<{
    ok: boolean;
    connected: boolean;
    status: string;
    raw?: Record<string, unknown>;
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/instance/status`, {
        method: "GET",
        headers: {
          token: this.token,
          Accept: "application/json",
        },
      });
      const data = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!response.ok) {
        const msg = String(
          data?.message ?? data?.error ?? `HTTP ${response.status}`
        );
        return {
          ok: false,
          connected: false,
          status: "error",
          raw: data,
          error: msg,
        };
      }

      const connected = interpretUazapiConnected(data);
      const status = extractUazapiStatusLabel(data, connected);
      return { ok: true, connected, status, raw: data };
    } catch (e) {
      return {
        ok: false,
        connected: false,
        status: "unreachable",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  /** Atalho: instância pronta para enviar mensagens. */
  async isReadyToSend(): Promise<{
    ready: boolean;
    status: string;
    error?: string;
  }> {
    const result = await this.getInstanceStatus();
    return {
      ready: result.ok && result.connected,
      status: result.status,
      error: result.error,
    };
  }
}

function extractUazapiStatusLabel(
  data: Record<string, unknown>,
  connected: boolean
): string {
  const candidates = [
    data.status,
    data.state,
    (data.instance as Record<string, unknown> | undefined)?.status,
    (data.instance as Record<string, unknown> | undefined)?.state,
    (data.data as Record<string, unknown> | undefined)?.status,
    (data.data as Record<string, unknown> | undefined)?.state,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim().toLowerCase();
  }
  return connected ? "connected" : "disconnected";
}

function interpretUazapiConnected(data: Record<string, unknown>): boolean {
  const nested =
    (data.instance as Record<string, unknown> | undefined) ??
    (data.data as Record<string, unknown> | undefined) ??
    data;

  if (typeof nested.connected === "boolean") return nested.connected;
  if (typeof nested.Connected === "boolean") return nested.Connected;
  if (typeof nested.LoggedIn === "boolean") return nested.LoggedIn;
  if (typeof nested.loggedIn === "boolean") return nested.loggedIn;
  if (typeof data.connected === "boolean") return data.connected;

  const status = String(
    nested.status ?? nested.state ?? data.status ?? data.state ?? ""
  ).toLowerCase();

  if (
    /connected|open|authenticated|online|logged.?in|ready|ativo/.test(status)
  ) {
    return true;
  }
  if (
    /disconnected|close|offline|logout|qr|pairing|connecting|inativ/.test(
      status
    )
  ) {
    // "connecting" ainda não está pronto para envio
    return false;
  }

  // Sem sinal claro: não assume conectado (fail-safe)
  return false;
}

export function renderTemplate(
  template: string,
  vars: Record<string, string | number>
) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    String(vars[key] ?? "")
  );
}
