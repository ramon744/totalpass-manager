-- Habilita Supabase Realtime nas tabelas principais.
-- Sem isso, a publicação supabase_realtime fica vazia e nenhuma
-- mudança é entregue em tempo real para o app.
alter publication supabase_realtime add table public.beneficiarios;
alter publication supabase_realtime add table public.assinaturas;
alter publication supabase_realtime add table public.cobrancas;
