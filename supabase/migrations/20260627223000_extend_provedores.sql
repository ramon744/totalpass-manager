-- Campos adicionais do provedor (cadastro manual e importação)
ALTER TABLE public.provedores
  ADD COLUMN IF NOT EXISTS beneficio TEXT,
  ADD COLUMN IF NOT EXISTS custo_colaborador NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS dia_pagamento INTEGER,
  ADD COLUMN IF NOT EXISTS cadastro_completo BOOLEAN NOT NULL DEFAULT false;

UPDATE public.provedores
SET cadastro_completo = false
WHERE beneficio IS NULL
  AND custo_colaborador IS NULL
  AND dia_pagamento IS NULL;

DROP INDEX IF EXISTS public.provedores_nome_unique;
CREATE UNIQUE INDEX IF NOT EXISTS provedores_nome_exact_unique ON public.provedores (nome);
