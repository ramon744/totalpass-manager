import { readFileSync } from "node:fs";
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

async function main() {
  const subId = process.argv[2];
  const novaData = process.argv[3];
  if (!subId || !novaData) {
    throw new Error("Uso: node fix-pending-payment.mjs <subscriptionId> <YYYY-MM-DD>");
  }

  const env = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  const configRes = await fetch(
    `${supabaseUrl}/rest/v1/configuracoes?chave=eq.asaas&select=valor`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const valor = (await configRes.json())?.[0]?.valor;
  const baseUrl =
    (valor.ambiente ?? "production") === "production"
      ? "https://api.asaas.com/v3"
      : "https://api-sandbox.asaas.com/v3";
  const headers = {
    "Content-Type": "application/json",
    access_token: valor.api_key,
    "User-Agent": "TotalPassManager",
  };

  const pays = await (
    await fetch(`${baseUrl}/payments?subscription=${subId}&order=desc&limit=20`, {
      headers,
    })
  ).json();

  const pendentes = (pays.data ?? []).filter((p) =>
    ["PENDING", "OVERDUE"].includes(p.status)
  );

  for (const p of pendentes) {
    const res = await fetch(`${baseUrl}/payments/${p.id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ dueDate: novaData }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.log(`FALHA ${p.id}: ${data?.errors?.[0]?.description ?? res.status}`);
    } else {
      console.log(`OK ${p.id}: dueDate -> ${data.dueDate}`);
    }

    await fetch(
      `${supabaseUrl}/rest/v1/cobrancas?asaas_payment_id=eq.${p.id}`,
      {
        method: "PATCH",
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          vencimento: novaData,
          updated_at: new Date().toISOString(),
        }),
      }
    );
  }

  if (pendentes.length === 0) console.log("Nenhuma cobrança pendente encontrada.");
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
