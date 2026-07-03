-- Tabela de provedores (empresas vinculadas aos beneficiários)
CREATE TABLE IF NOT EXISTS public.provedores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS provedores_nome_unique ON public.provedores (lower(trim(nome)));

ALTER TABLE public.beneficiarios
  ADD COLUMN IF NOT EXISTS provedor_id UUID REFERENCES public.provedores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS beneficiarios_provedor_id_idx ON public.beneficiarios(provedor_id);

ALTER TABLE public.provedores ENABLE ROW LEVEL SECURITY;

CREATE POLICY provedores_select ON public.provedores
  FOR SELECT USING (can_read());

CREATE POLICY provedores_insert ON public.provedores
  FOR INSERT WITH CHECK (can_write());

CREATE POLICY provedores_update ON public.provedores
  FOR UPDATE USING (can_write());

CREATE POLICY provedores_delete ON public.provedores
  FOR DELETE USING (get_user_role() = 'admin');
