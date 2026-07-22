import type { TipoEnvioMensagem } from "@/types/database";

export type TesteEnvioTipo = TipoEnvioMensagem;

export function describeTesteEnvio(tipo: TipoEnvioMensagem, texto: string) {
  if (tipo === "botao_pix") return `${texto}\n\n[Botão: Copiar PIX]`;
  if (tipo === "botao_link") return `${texto}\n\n[Botão: Pagar agora]`;
  if (tipo === "botoes_pix_boleto") {
    return `${texto}\n\n[Botões: Copiar PIX, Copiar boleto]`;
  }
  if (tipo === "botoes_pagamento") {
    return `${texto}\n\n[Botões: Copiar PIX, Copiar boleto, Abrir fatura]`;
  }
  return texto;
}
