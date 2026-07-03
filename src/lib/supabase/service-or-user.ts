import { createClient, createServiceClient } from "@/lib/supabase/server";

/** Cliente com service role quando disponível (bypass RLS para operações server-side). */
export async function getServiceOrUserClient() {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return createServiceClient();
  }
  return createClient();
}
