-- Cobrança de dependentes: opt-in (false por padrão).
-- Preserva cobrança ativa em assinaturas ACTIVE.
ALTER TABLE public.beneficiarios
  ALTER COLUMN cobrar_na_assinatura SET DEFAULT false;

UPDATE public.beneficiarios b
SET cobrar_na_assinatura = false
WHERE b.perfil = 'dependente'
  AND NOT EXISTS (
    SELECT 1
    FROM public.assinaturas a
    WHERE a.status = 'ACTIVE'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(a.dependentes_cobrados) elem
        WHERE elem->>'id' = b.id::text
      )
  );
