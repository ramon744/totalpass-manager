-- Leitura do snapshot Infinity na UI (can_read); escrita sync via service_role.
-- Não altera dados de cobrança / não notifica.

alter table public.infinity_customer_status enable row level security;

drop policy if exists infinity_customer_status_select on public.infinity_customer_status;
create policy infinity_customer_status_select on public.infinity_customer_status
  for select using (can_read());

drop policy if exists infinity_customer_status_write on public.infinity_customer_status;
create policy infinity_customer_status_write on public.infinity_customer_status
  for all using (get_user_role() = 'admin')
  with check (get_user_role() = 'admin');

alter table public.infinity_instances enable row level security;

drop policy if exists infinity_instances_select on public.infinity_instances;
create policy infinity_instances_select on public.infinity_instances
  for select using (can_read());

drop policy if exists infinity_instances_write on public.infinity_instances;
create policy infinity_instances_write on public.infinity_instances
  for all using (get_user_role() = 'admin')
  with check (get_user_role() = 'admin');
