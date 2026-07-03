import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";

export function DashboardShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen min-h-[100dvh] bg-slate-50 dark:bg-slate-950">
      <Sidebar />
      <div className="lg:pl-64">
        <Header title={title} />
        <main className="overflow-x-hidden p-3 pb-[calc(1rem+var(--safe-bottom))] sm:p-4 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
