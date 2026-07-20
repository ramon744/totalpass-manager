-- Remove lembrete de 7 dias (não usado; conflita com desvínculo).
-- Ajusta texto do aviso para mencionar horário na data limite.

delete from public.mensagem_templates
where evento = 'vencimento_7dias';

update public.mensagem_templates
set
  corpo = E'Olá {{nome}}!\n\nIdentificamos atraso no pagamento de R$ {{valor}}.\n\nCaso não haja o pagamento até {{data_limite}}, infelizmente você será desvinculado da empresa no TotalPass.\n\n{{mensagem_plano}}\n\nRegularize pelo link: {{link_pagamento}}',
  updated_at = now()
where evento = 'aviso_desvinculo_totalpass'
  and corpo not like '%{{data_limite}}%';
