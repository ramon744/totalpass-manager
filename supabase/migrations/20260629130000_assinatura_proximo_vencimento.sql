alter table public.assinaturas
  add column if not exists proximo_vencimento date;
