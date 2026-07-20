/**
 * Envio de e-mail administrativo via Resend.
 * Requer RESEND_API_KEY (e opcionalmente RESEND_FROM_EMAIL) nas env vars.
 * Nunca grave a API key no código.
 */

export async function sendAdminEmail(params: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ ok: boolean; reason?: string; id?: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return { ok: false, reason: "RESEND_API_KEY não configurada" };
  }

  const to = params.to.trim();
  if (!to || !to.includes("@")) {
    return { ok: false, reason: "e-mail do admin inválido" };
  }

  const from =
    process.env.RESEND_FROM_EMAIL?.trim() ||
    "TotalPass Manager <onboarding@resend.dev>";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: params.subject,
        text: params.text,
        ...(params.html ? { html: params.html } : {}),
      }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      id?: string;
      message?: string;
      name?: string;
    };

    if (!res.ok) {
      return {
        ok: false,
        reason:
          data.message ||
          data.name ||
          `Resend HTTP ${res.status}`,
      };
    }

    return { ok: true, id: data.id };
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}
