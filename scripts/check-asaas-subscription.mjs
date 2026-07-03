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
  const env = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

  const configRes = await fetch(
    `${supabaseUrl}/rest/v1/configuracoes?chave=eq.asaas&select=valor`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
  );
  const configRows = await configRes.json();
  const valor = configRows?.[0]?.valor;
  const apiKey = valor.api_key;
  const ambiente = valor.ambiente ?? "production";
  const baseUrl =
    ambiente === "production"
      ? "https://api.asaas.com/v3"
      : "https://api-sandbox.asaas.com/v3";

  const headers = {
    "Content-Type": "application/json",
    access_token: apiKey,
    "User-Agent": "TotalPassManager",
  };

  const subId = process.argv[2] || "sub_a1u8mwnqyjsqeg0k";

  const sub = await (await fetch(`${baseUrl}/subscriptions/${subId}`, { headers })).json();
  console.log("=== ASSINATURA NO ASAAS ===");
  console.log(`id: ${sub.id}`);
  console.log(`value: ${sub.value}`);
  console.log(`nextDueDate: ${sub.nextDueDate}`);
  console.log(`status: ${sub.status}`);
  console.log(`cycle: ${sub.cycle}`);

  const pays = await (
    await fetch(`${baseUrl}/payments?subscription=${subId}&order=desc&limit=10`, {
      headers,
    })
  ).json();

  console.log("\n=== COBRANÇAS DESSA ASSINATURA ===");
  for (const p of pays.data ?? []) {
    console.log(
      `${p.id} | status=${p.status} | dueDate=${p.dueDate} | value=${p.value}`
    );
  }
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
