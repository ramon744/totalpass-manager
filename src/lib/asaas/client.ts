import type { ConfigAsaas } from "@/types/database";

const ASAAS_URLS = {
  sandbox: "https://api-sandbox.asaas.com/v3",
  production: "https://api.asaas.com/v3",
};

export class AsaasClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(config: ConfigAsaas) {
    this.baseUrl = ASAAS_URLS[config.ambiente] ?? ASAAS_URLS.sandbox;
    this.apiKey = config.api_key;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "TotalPassManager",
        access_token: this.apiKey,
        ...options.headers,
      },
    });

    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Resposta não-JSON (ex.: HTML de erro ou corpo vazio por chave inválida).
    }

    if (!response.ok) {
      const parsed = data as
        | { errors?: Array<{ description?: string }>; message?: string }
        | null;
      const msg =
        parsed?.errors?.[0]?.description ??
        parsed?.message ??
        (response.status === 401
          ? "Chave da API Asaas inválida ou não configurada"
          : `Erro na API Asaas (HTTP ${response.status})`);
      throw new Error(msg);
    }

    if (!text.trim()) return {} as T;
    if (data === null) {
      throw new Error(`Erro na API Asaas (HTTP ${response.status})`);
    }
    return data as T;
  }

  async createCustomer(payload: {
    name: string;
    cpfCnpj: string;
    email?: string;
    mobilePhone?: string;
    externalReference?: string;
  }) {
    return this.request<{ id: string }>("/customers", {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        notificationDisabled: true,
      }),
    });
  }

  async updateCustomer(
    customerId: string,
    payload: {
      name?: string;
      cpfCnpj?: string;
      email?: string;
      mobilePhone?: string;
      externalReference?: string;
      notificationDisabled?: boolean;
    }
  ) {
    return this.request<{ id: string }>(`/customers/${customerId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  }

  /** Desativa e-mail/SMS/WhatsApp de cobrança do Asaas (notificações ficam no app). */
  async disableCustomerNotifications(customerId: string) {
    return this.updateCustomer(customerId, { notificationDisabled: true });
  }

  async getCustomer(customerId: string) {
    return this.request<{ id: string; name: string; cpfCnpj?: string }>(
      `/customers/${customerId}`
    );
  }

  async findCustomerByCpf(cpf: string) {
    const digits = cpf.replace(/\D/g, "");
    return this.request<{
      data: Array<{ id: string; cpfCnpj?: string }>;
    }>(`/customers?cpfCnpj=${digits}&limit=1`);
  }

  async deleteCustomer(customerId: string) {
    return this.request<void>(`/customers/${customerId}`, {
      method: "DELETE",
    });
  }

  async createSubscription(payload: {
    customer: string;
    billingType: "BOLETO" | "PIX" | "CREDIT_CARD" | "UNDEFINED";
    value: number;
    nextDueDate: string;
    cycle: "MONTHLY";
    description?: string;
    externalReference?: string;
  }) {
    return this.request<{ id: string; status: string }>("/subscriptions", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  async getSubscription(subscriptionId: string) {
    return this.request<{
      id: string;
      status: string;
      value: number;
      customer: string;
      description?: string;
      nextDueDate?: string;
      externalReference?: string;
    }>(`/subscriptions/${subscriptionId}`);
  }

  async listSubscriptionsByCustomer(customerId: string, status = "ACTIVE") {
    return this.request<{
      data: Array<{
        id: string;
        status: string;
        value: number;
        customer: string;
        description?: string;
        nextDueDate?: string;
        externalReference?: string;
      }>;
    }>(`/subscriptions?customer=${customerId}&status=${status}`);
  }

  async listPaymentsByCustomer(customerId: string, status = "PENDING") {
    return this.request<{
      data: Array<{
        id: string;
        value: number;
        dueDate: string;
        status: string;
      }>;
    }>(`/payments?customer=${customerId}&status=${status}&limit=1&order=desc`);
  }

  async listPayments(params?: { offset?: number; limit?: number }) {
    const offset = params?.offset ?? 0;
    const limit = params?.limit ?? 100;
    return this.request<{
      data: Array<{
        id: string;
        customer: string;
        subscription?: string;
        value: number;
        dueDate: string;
        paymentDate?: string;
        clientPaymentDate?: string;
        status: string;
      }>;
      hasMore: boolean;
      totalCount: number;
    }>(`/payments?offset=${offset}&limit=${limit}&order=desc`);
  }

  async cancelSubscription(subscriptionId: string) {
    return this.request<{ id: string; status: string }>(
      `/subscriptions/${subscriptionId}`,
      { method: "DELETE" }
    );
  }

  async updateSubscription(
    subscriptionId: string,
    payload: {
      value?: number;
      nextDueDate?: string;
      description?: string;
      status?: string;
    }
  ) {
    return this.request<{ id: string; status: string }>(
      `/subscriptions/${subscriptionId}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      }
    );
  }

  async getPayment(paymentId: string) {
    return this.getPaymentDetails(paymentId);
  }

  /** Atualiza valor/vencimento de uma cobrança já gerada. */
  async updatePayment(
    paymentId: string,
    payload: { value?: number; dueDate?: string; description?: string }
  ) {
    return this.request<{ id: string; status: string; dueDate: string }>(
      `/payments/${paymentId}`,
      {
        method: "PUT",
        body: JSON.stringify(payload),
      }
    );
  }

  /** Remove cobrança pendente no Asaas (ex.: ao cancelar assinatura). */
  async deletePayment(paymentId: string) {
    return this.request<{ deleted: boolean; id: string }>(
      `/payments/${paymentId}`,
      { method: "DELETE" }
    );
  }

  /** Lista cobranças de uma assinatura (por padrão as ainda em aberto). */
  async listPaymentsBySubscription(
    subscriptionId: string,
    status: "PENDING" | "OVERDUE" | "ALL" = "PENDING"
  ) {
    const statusFilter = status === "ALL" ? "" : `&status=${status}`;
    return this.request<{
      data: Array<{
        id: string;
        value: number;
        dueDate: string;
        status: string;
      }>;
    }>(`/payments?subscription=${subscriptionId}${statusFilter}&order=desc&limit=20`);
  }

  async getPaymentDetails(paymentId: string) {
    return this.request<{
      id: string;
      status: string;
      value: number;
      dueDate: string;
      paymentDate?: string;
      customer: string;
      subscription?: string;
      billingType?: string;
      invoiceUrl?: string;
      bankSlipUrl?: string;
      identificationField?: string;
    }>(`/payments/${paymentId}`);
  }

  async getPaymentPixQrCode(paymentId: string) {
    return this.request<{
      encodedImage: string;
      payload: string;
      expirationDate: string;
    }>(`/payments/${paymentId}/pixQrCode`);
  }

  async getPaymentIdentificationField(paymentId: string) {
    return this.request<{
      identificationField: string;
      nossoNumero?: string;
      barCode?: string;
    }>(`/payments/${paymentId}/identificationField`);
  }
}

export function nextDueDateFromDay(day: number): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  let due = new Date(year, month, day);
  if (due <= now) {
    due = new Date(year, month + 1, day);
  }
  return due.toISOString().split("T")[0];
}

export function mapAsaasPaymentStatus(status: string): string {
  const map: Record<string, string> = {
    PENDING: "PENDING",
    RECEIVED: "RECEIVED",
    CONFIRMED: "CONFIRMED",
    OVERDUE: "OVERDUE",
    REFUNDED: "REFUNDED",
    DELETED: "DELETED",
  };
  return map[status] ?? status;
}

export function normalizeSubscriptionStatus(status: string): string {
  const s = (status ?? "").toUpperCase();
  return s === "ACTIVE" ? "ACTIVE" : "CANCELLED";
}

export function mapAsaasSubscriptionStatus(status: string): string {
  return normalizeSubscriptionStatus(status);
}
