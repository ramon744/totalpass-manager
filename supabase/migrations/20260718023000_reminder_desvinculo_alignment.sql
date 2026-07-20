-- Alinha lembretes com o fluxo de desvínculo (carência 5 + aviso 2):
-- - desliga vencimento_7dias (bate com o dia da inativação)
-- - liga assinatura_cancelada (notifica após cancelar Asaas na inadimplência)

update public.mensagem_templates
set ativo = false, updated_at = now()
where evento = 'vencimento_7dias';

update public.mensagem_templates
set ativo = true, updated_at = now()
where evento = 'assinatura_cancelada';
