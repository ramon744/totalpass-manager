-- Valor cobrado mensal por cliente e mensagem padrão da assinatura por provedor
ALTER TABLE public.provedores
  ADD COLUMN IF NOT EXISTS valor_cobrado_mensal NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS mensagem_padrao TEXT;
