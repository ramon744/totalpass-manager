-- Cobrança opcional de dependentes por provedor e snapshots por assinatura
ALTER TABLE public.provedores
  ADD COLUMN IF NOT EXISTS cobrar_dependentes BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS valor_dependente NUMERIC(10,2);

ALTER TABLE public.beneficiarios
  ADD COLUMN IF NOT EXISTS cobrar_na_assinatura BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS cobranca_manual_desativada_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cobranca_manual_desativada_por UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cobranca_manual_motivo TEXT;

ALTER TABLE public.assinaturas
  ADD COLUMN IF NOT EXISTS cobrar_dependentes BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS valor_titular NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS valor_dependentes NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS dependentes_cobrados JSONB NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.assinaturas
SET valor_titular = valor
WHERE valor_titular IS NULL;

INSERT INTO public.mensagem_templates (evento, titulo, corpo, ativo, tipo_envio, max_tentativas, intervalo_retry_minutos)
VALUES
  (
    'dependente_cobranca_iniciada',
    'Dependente incluído na cobrança',
    'Olá {{nome}}, informamos que {{dependentes}} passou/passaram a compor sua mensalidade {{beneficio_fornecido}}. A alteração vale {{vigencia}}. Valor dos dependentes: R$ {{valor_dependentes}}. Novo total: R$ {{valor_total}}.',
    true,
    'texto',
    3,
    ARRAY[10,30,60]
  ),
  (
    'dependente_cobranca_parada',
    'Dependente removido da cobrança',
    'Olá {{nome}}, a cobrança de {{dependentes}} foi removida da sua mensalidade {{beneficio_fornecido}}. A alteração vale {{vigencia}}. Novo total: R$ {{valor_total}}.',
    true,
    'texto',
    3,
    ARRAY[10,30,60]
  ),
  (
    'dependente_cobranca_retomada',
    'Dependente retomado na cobrança',
    'Olá {{nome}}, a cobrança de {{dependentes}} foi retomada na sua mensalidade {{beneficio_fornecido}}. A alteração vale {{vigencia}}. Valor dos dependentes: R$ {{valor_dependentes}}. Novo total: R$ {{valor_total}}.',
    true,
    'texto',
    3,
    ARRAY[10,30,60]
  )
ON CONFLICT (evento) DO NOTHING;
