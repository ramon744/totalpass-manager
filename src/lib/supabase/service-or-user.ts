import { createClient, createServiceClient } from "@/lib/supabase/server";

/** Cliente autenticado (sessão do usuário) — preferir para leituras e operações com RLS. */
export async function getAuthenticatedClient() {
  return createClient();
}

/** Service role apenas quando necessário bypass de RLS (ex.: jobs internos). */
export async function getServiceClientIfConfigured() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  return createServiceClient();
}

/** @deprecated Use getAuthenticatedClient() para APIs autenticadas do app. */
export async function getServiceOrUserClient() {
  return getAuthenticatedClient();
}
