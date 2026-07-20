-- Erro/saúde reportados pela extensão no heartbeat
alter table public.bridge_instances
  add column if not exists last_error text,
  add column if not exists last_health_ok boolean not null default true;
