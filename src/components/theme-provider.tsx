"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // React 19 / Next 16: o next-themes injeta um <script> para evitar o flash de
  // tema. No servidor o script é emitido normalmente (e executa antes da pintura);
  // no cliente usamos type="application/json" para que o React não tente executá-lo
  // e não dispare o aviso "Encountered a script tag".
  const scriptProps =
    typeof window === "undefined"
      ? undefined
      : ({ type: "application/json" } as const);

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      scriptProps={scriptProps}
    >
      {children}
    </NextThemesProvider>
  );
}
