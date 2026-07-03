-- Pré-cadastros originados do WhatsApp (Uazapi: etiquetas + anotações)
CREATE TABLE IF NOT EXISTS public.pre_cadastros_whatsapp (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  uazapi_chat_id TEXT NOT NULL,
  telefone TEXT NOT NULL,
  nome TEXT,
  cpf TEXT,
  email TEXT,
  etiquetas TEXT[] NOT NULL DEFAULT '{}',
  etiqueta_ids TEXT[] NOT NULL DEFAULT '{}',
  wa_notes TEXT,
  data_etiqueta TIMESTAMPTZ NOT NULL DEFAULT now(),
  beneficiario_id UUID REFERENCES public.beneficiarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pre_cadastros_whatsapp_chat_id_idx
  ON public.pre_cadastros_whatsapp (uazapi_chat_id);

CREATE INDEX IF NOT EXISTS pre_cadastros_whatsapp_cpf_idx
  ON public.pre_cadastros_whatsapp (cpf)
  WHERE cpf IS NOT NULL;

CREATE INDEX IF NOT EXISTS pre_cadastros_whatsapp_telefone_idx
  ON public.pre_cadastros_whatsapp (telefone);

CREATE INDEX IF NOT EXISTS pre_cadastros_whatsapp_data_etiqueta_idx
  ON public.pre_cadastros_whatsapp (data_etiqueta DESC);

ALTER TABLE public.pre_cadastros_whatsapp ENABLE ROW LEVEL SECURITY;

CREATE POLICY pre_cadastros_whatsapp_select ON public.pre_cadastros_whatsapp
  FOR SELECT USING (can_read());

CREATE POLICY pre_cadastros_whatsapp_insert ON public.pre_cadastros_whatsapp
  FOR INSERT WITH CHECK (can_write());

CREATE POLICY pre_cadastros_whatsapp_update ON public.pre_cadastros_whatsapp
  FOR UPDATE USING (can_write());

CREATE POLICY pre_cadastros_whatsapp_delete ON public.pre_cadastros_whatsapp
  FOR DELETE USING (get_user_role() = 'admin');

-- Etiquetas monitoradas (default) na config Uazapi
UPDATE public.configuracoes
SET valor = valor || jsonb_build_object(
  'etiquetas_monitoradas', jsonb_build_array('cliente totalpass', 'cliente gympass')
),
updated_at = now()
WHERE chave = 'uazapi'
  AND NOT (valor ? 'etiquetas_monitoradas');
