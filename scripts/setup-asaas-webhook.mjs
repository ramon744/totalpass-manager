import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const raw = readFileSync(join(__dirname, "..", ".env.local"), "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

const PAYMENT_EVENTS = [
  "PAYMENT_CREATED",
  "PAYMENT_UPDATED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_RECEIVED",
  "PAYMENT_OVERDUE",
  "PAYMENT_DELETED",
  "PAYMENT_REFUNDED",
];

function mask(value) {
  if (!value) return "(vazio)";
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

async function main() {
  const env = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Faltam NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY no .env.local");
  }

  const configRes = await fetch(
    `${supabaseUrl}/rest/v1/configuracoes?chave=eq.asaas&select=valor`,
    {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
    }
  );
  const configRows = await configRes.json();
  const valor = configRows?.[0]?.valor;
  if (!valor?.api_key) throw new Error("Config Asaas não encontrada no banco");

  const apiKey = valor.api_key;
  const ambiente = valor.ambiente ?? "production";
  const webhookUrl =
    valor.webhook_url ?? `${supabaseUrl}/functions/v1/asaas-webhook`;
  const baseUrl =
    ambiente === "production"
      ? "https://api.asaas.com/v3"
      : "https://api-sandbox.asaas.com/v3";

  console.log(`Ambiente: ${ambiente}`);
  console.log(`API key: ${mask(apiKey)}`);
  console.log(`URL do webhook: ${webhookUrl}`);

  const headers = {
    "Content-Type": "application/json",
    access_token: apiKey,
    "User-Agent": "TotalPassManager",
  };

  let email = "integracao@totalpass.local";
  try {
    const acc = await fetch(`${baseUrl}/myAccount`, { headers });
    if (acc.ok) {
      const data = await acc.json();
      if (data?.email) email = data.email;
    }
  } catch {
    // segue com e-mail padrão
  }

  const listRes = await fetch(`${baseUrl}/webhooks`, { headers });
  const listText = await listRes.text();
  if (!listRes.ok) {
    throw new Error(`Falha ao listar webhooks (HTTP ${listRes.status}): ${listText}`);
  }
  const list = JSON.parse(listText);
  const existentes = list?.data ?? [];
  console.log(`Webhooks existentes: ${existentes.length}`);

  const atual = existentes.find((w) => w.url === webhookUrl);

  let authToken = valor.webhook_token;
  if (!authToken || authToken.length < 32) {
    authToken = `tp_wh_${randomUUID().replace(/-/g, "")}`;
    console.log("AuthToken curto/ausente: gerado um novo token forte.");
  }

  const body = {
    name: "TotalPass Manager",
    url: webhookUrl,
    email,
    enabled: true,
    interrupted: false,
    apiVersion: 3,
    authToken,
    sendType: "SEQUENTIALLY",
    events: PAYMENT_EVENTS,
  };

  let resultado;
  if (atual) {
    console.log(`Atualizando webhook existente (id ${atual.id})...`);
    const res = await fetch(`${baseUrl}/webhooks/${atual.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Falha ao atualizar (HTTP ${res.status}): ${text}`);
    resultado = JSON.parse(text);
  } else {
    console.log("Criando novo webhook...");
    const res = await fetch(`${baseUrl}/webhooks`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Falha ao criar (HTTP ${res.status}): ${text}`);
    resultado = JSON.parse(text);
  }

  if (authToken !== valor.webhook_token) {
    const novoValor = { ...valor, webhook_token: authToken };
    const patch = await fetch(
      `${supabaseUrl}/rest/v1/configuracoes?chave=eq.asaas`,
      {
        method: "PATCH",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ valor: novoValor }),
      }
    );
    if (!patch.ok) {
      const t = await patch.text();
      throw new Error(`Webhook configurado, mas falhou ao salvar token no banco: ${t}`);
    }
    console.log("Token de autenticação sincronizado no banco.");
  }

  console.log("\nWebhook configurado com sucesso:");
  console.log(`  id: ${resultado.id}`);
  console.log(`  enabled: ${resultado.enabled}`);
  console.log(`  interrupted: ${resultado.interrupted}`);
  console.log(`  events: ${(resultado.events ?? []).join(", ")}`);
}

main().catch((e) => {
  console.error("\nERRO:", e.message);
  process.exit(1);
});
