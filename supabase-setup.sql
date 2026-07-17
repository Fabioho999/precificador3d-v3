-- Execute este arquivo uma única vez no Supabase Dashboard > SQL Editor > New query.
-- Cada conta só pode ler e alterar os próprios dados.

create table if not exists public.precificador_dados (
  user_id uuid not null references auth.users(id) on delete cascade,
  chave text not null,
  valor jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, chave)
);

alter table public.precificador_dados enable row level security;

drop policy if exists "Usuário lê seus dados" on public.precificador_dados;
create policy "Usuário lê seus dados"
on public.precificador_dados for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "Usuário grava seus dados" on public.precificador_dados;
create policy "Usuário grava seus dados"
on public.precificador_dados for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "Usuário atualiza seus dados" on public.precificador_dados;
create policy "Usuário atualiza seus dados"
on public.precificador_dados for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "Usuário remove seus dados" on public.precificador_dados;
create policy "Usuário remove seus dados"
on public.precificador_dados for delete to authenticated
using (auth.uid() = user_id);
