"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Upload,
  UserPlus,
  Building2,
  Wallet,
  CreditCard,
  Receipt,
  MessageCircle,
  BarChart3,
  Settings,
  Menu,
  X,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/beneficiarios", label: "Beneficiários", icon: Users },
  { href: "/pre-cadastros", label: "Pré-cadastros", icon: UserPlus },
  { href: "/importacao", label: "Importação", icon: Upload },
  { href: "/provedores", label: "Provedores", icon: Building2 },
  { href: "/financeiro", label: "Financeiro", icon: Wallet },
  { href: "/assinaturas", label: "Assinaturas", icon: CreditCard },
  { href: "/cobrancas", label: "Cobranças", icon: Receipt },
  { href: "/mensagens", label: "Mensagens WhatsApp", icon: MessageCircle },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="fixed left-3 top-[calc(0.75rem+var(--safe-top))] z-50 flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm lg:hidden dark:border-slate-700 dark:bg-slate-900"
        onClick={() => setOpen(!open)}
        aria-label="Menu"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-[min(100vw-3rem,16rem)] flex-col border-r border-slate-200 bg-white transition-transform dark:border-slate-800 dark:bg-slate-950 lg:w-64 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        )}
      >
        <div className="flex h-16 items-center border-b border-slate-200 px-6 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-bold text-white">
              TP
            </div>
            <div>
              <p className="text-sm font-semibold">TotalPass</p>
              <p className="text-xs text-slate-500">Manager</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {navItems.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex min-h-[44px] items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors sm:min-h-0 sm:py-2.5",
                  active
                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                    : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
