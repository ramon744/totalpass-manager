import type { ConfigFinanceiro } from "@/types/database";

export type FormaPagamentoPadrao = NonNullable<
  ConfigFinanceiro["forma_pagamento_padrao"]
>;

export const FORMA_PAGAMENTO_OPCOES: Array<{
  value: FormaPagamentoPadrao;
  label: string;
  descricao: string;
}> = [
  {
    value: "BOLETO",
    label: "Boleto e PIX",
    descricao:
      "Gera boleto com linha digitável e opção de pagamento via PIX na fatura (recomendado).",
  },
  {
    value: "PIX",
    label: "Somente PIX",
    descricao: "Cobrança exclusivamente via PIX copia e cola.",
  },
  {
    value: "UNDEFINED",
    label: "Cliente escolhe na fatura",
    descricao: "O cliente seleciona a forma de pagamento ao abrir o link.",
  },
];

export function getFormaPagamentoPadrao(
  financeiro?: Pick<ConfigFinanceiro, "forma_pagamento_padrao"> | null
): FormaPagamentoPadrao {
  return financeiro?.forma_pagamento_padrao ?? "BOLETO";
}
