import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

function sanitizeSecret(raw: string | undefined | null): string {
  return String(raw ?? "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\r|\n/g, "");
}

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component — ignorar
          }
        },
      },
    }
  );
}

export async function createServiceClient() {
  const { createClient } = await import("@supabase/supabase-js");
  const url = sanitizeSecret(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key = sanitizeSecret(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY ou NEXT_PUBLIC_SUPABASE_URL ausente no servidor"
    );
  }

  // service_role JWT tem 3 segmentos; se colaram a anon key ou texto errado, falha cedo.
  if (key.split(".").length !== 3) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY inválida no servidor (formato). Copie a service_role em Supabase → Settings → API."
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
