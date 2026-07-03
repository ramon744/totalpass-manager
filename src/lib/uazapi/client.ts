import type { ConfigUazapi } from "@/types/database";

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
      throw new Error(
        data?.message ?? data?.error ?? "Erro ao enviar mensagem WhatsApp"
      );
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
      throw new Error(
        data?.message ?? data?.error ?? "Erro ao enviar botão WhatsApp"
      );
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
}

export function renderTemplate(
  template: string,
  vars: Record<string, string | number>
) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    String(vars[key] ?? "")
  );
}
