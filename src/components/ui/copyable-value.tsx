"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export type CopySanitizeMode = "nome" | "cpf" | "email" | "phone";

/** Remove espaços/pontuação conforme o tipo (para colar em buscas). */
export function sanitizeForCopy(
  value: string,
  mode: CopySanitizeMode
): string {
  const v = String(value ?? "").trim();
  if (!v) return "";
  if (mode === "cpf" || mode === "phone") {
    const digits = v.replace(/\D/g, "");
    if (mode === "phone") {
      // DDI Brasil (55) não entra na cópia — só DDD + número
      if (digits.startsWith("55") && digits.length >= 12) {
        return digits.slice(2);
      }
    }
    return digits;
  }
  if (mode === "email") {
    return v.replace(/\s+/g, "").toLowerCase();
  }
  // nome: sem espaços e sem pontuação (mantém letras/acentos)
  return v.replace(/[\s.,;:!?'"`~\-_/\\|@#$%^&*+=()[\]{}<>]/g, "");
}

export function CopyableValue({
  value,
  display,
  mode,
  className,
}: {
  value: string | null | undefined;
  display?: React.ReactNode;
  mode: CopySanitizeMode;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const raw = String(value ?? "").trim();
  if (!raw) {
    return <span className={cn("text-slate-400", className)}>—</span>;
  }

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const text = sanitizeForCopy(raw, mode);
    if (!text) {
      toast.error("Nada para copiar");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success("Copiado");
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      toast.error("Não foi possível copiar");
    }
  }

  return (
    <span className={cn("inline-flex max-w-full items-center gap-1", className)}>
      <span className="min-w-0 truncate">{display ?? raw}</span>
      <button
        type="button"
        onClick={(e) => void handleCopy(e)}
        title={`Copiar ${mode === "phone" ? "celular" : mode}`}
        aria-label={`Copiar ${mode === "phone" ? "celular" : mode}`}
        className="inline-flex shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-emerald-600" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
    </span>
  );
}
