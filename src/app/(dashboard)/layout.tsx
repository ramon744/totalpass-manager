import { DashboardShell } from "@/components/layout/dashboard-shell";
import { PwaRegister } from "@/components/pwa-register";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <PwaRegister />
      {children}
    </>
  );
}
