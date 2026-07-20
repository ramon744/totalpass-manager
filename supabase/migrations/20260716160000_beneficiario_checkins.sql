-- Check-ins (frequência de uso TotalPass) por beneficiário.
-- Alimentado pela extensão a partir do relatório de frequência do HR.
-- Colunas nullable e sem default de negócio: não afeta fluxos existentes.
ALTER TABLE public.beneficiarios
  ADD COLUMN IF NOT EXISTS checkins_30d integer,
  ADD COLUMN IF NOT EXISTS checkins_periodo_inicio date,
  ADD COLUMN IF NOT EXISTS checkins_periodo_fim date,
  ADD COLUMN IF NOT EXISTS checkins_atualizado_em timestamptz;

COMMENT ON COLUMN public.beneficiarios.checkins_30d IS
  'Quantidade de check-ins TotalPass no período (últimos ~30 dias). Fonte: relatório de frequência do HR via extensão.';
COMMENT ON COLUMN public.beneficiarios.checkins_periodo_inicio IS
  'Data inicial do período considerado para checkins_30d.';
COMMENT ON COLUMN public.beneficiarios.checkins_periodo_fim IS
  'Data final do período considerado para checkins_30d.';
COMMENT ON COLUMN public.beneficiarios.checkins_atualizado_em IS
  'Momento da última atualização de check-ins pela extensão.';
