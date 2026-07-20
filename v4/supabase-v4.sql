-- Precificador 3D V4
-- Execute no SQL Editor do Supabase com uma conta administradora.
-- O script e idempotente: pode ser executado novamente com seguranca.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Modelo de dados
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  business_name text,
  phone text,
  document text,
  logo_path text,
  timezone text not null default 'America/Sao_Paulo',
  metadata jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  studio_name text default 'Studio FH3D',
  whatsapp text,
  email text,
  instagram text,
  pix_key text,
  pix_type text,
  pix_holder text,
  logo_path text,
  logo_url text,
  currency text not null default 'BRL' check (currency ~ '^[A-Z]{3}$'),
  quote_validity_days integer not null default 7 check (quote_validity_days between 1 and 365),
  default_margin_percent numeric(8,3) not null default 0 check (default_margin_percent >= 0),
  electricity_cost_kwh numeric(12,4) not null default 0 check (electricity_cost_kwh >= 0),
  filament_cost_kg numeric(14,2) not null default 95 check (filament_cost_kg >= 0),
  energy_kwh numeric(14,4) not null default 0.85 check (energy_kwh >= 0),
  k1c_kw numeric(10,4) not null default 0.25 check (k1c_kw >= 0),
  kobra_kw numeric(10,4) not null default 0.3 check (kobra_kw >= 0),
  depreciation_hour numeric(14,2) not null default 2.5 check (depreciation_hour >= 0),
  maintenance_hour numeric(14,2) not null default 0.5 check (maintenance_hour >= 0),
  profit_percent numeric(8,3) not null default 30 check (profit_percent >= 0),
  packaging_cost numeric(14,2) not null default 10 check (packaging_cost >= 0),
  modification_terms text default 'Até 2 rodadas de ajustes no modelo.',
  validity_terms text default 'Orçamento válido por 7 dias.',
  general_notes text default 'Prazo confirmado após a aprovação.',
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.filaments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  legacy_id text,
  manufacturer text not null,
  material text not null,
  color text,
  brand text,
  sku text,
  initial_weight_g numeric(14,3) not null default 0 check (initial_weight_g >= 0),
  current_weight_g numeric(14,3) not null default 0 check (current_weight_g >= 0),
  price_kg numeric(14,2) not null default 0 check (price_kg >= 0),
  active boolean not null default true,
  archived_at timestamptz,
  deleted_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  legacy_id text,
  order_number text,
  customer_name text not null,
  customer_email text,
  customer_phone text,
  project text not null,
  printer text,
  description text,
  notes text,
  due_date date,
  commercial_status text not null default 'orcamento'
    check (commercial_status in ('orcamento', 'aprovado', 'cancelado')),
  cancelled_from_status text
    check (cancelled_from_status is null or cancelled_from_status in ('orcamento', 'aprovado')),
  production_status text not null default 'pendente'
    check (production_status in ('pendente', 'em_producao', 'pronto', 'enviado', 'entregue')),
  payment_status text not null default 'pendente'
    check (payment_status in ('pendente', 'parcial', 'pago', 'reembolsado')),
  subtotal numeric(14,2) not null default 0 check (subtotal >= 0),
  discount numeric(14,2) not null default 0 check (discount >= 0),
  shipping numeric(14,2) not null default 0 check (shipping >= 0),
  total numeric(14,2) not null default 0 check (total >= 0),
  final_price numeric(14,2) not null default 0 check (final_price >= 0),
  total_cost numeric(14,2) not null default 0 check (total_cost >= 0),
  modeling_price numeric(14,2) not null default 0 check (modeling_price >= 0),
  finishing_price numeric(14,2) not null default 0 check (finishing_price >= 0),
  paid_at timestamptz,
  stock_cycle integer not null default 0 check (stock_cycle >= 0),
  stock_consumed_at timestamptz,
  stock_restored_at timestamptz,
  archived_at timestamptz,
  deleted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid not null,
  filament_id uuid,
  legacy_id text,
  name text not null,
  quantity integer not null default 1 check (quantity > 0),
  unit_weight_g numeric(14,3) not null default 0 check (unit_weight_g >= 0),
  print_hours numeric(12,3) not null default 0 check (print_hours >= 0),
  material text,
  filament_price_kg numeric(14,2) not null default 0 check (filament_price_kg >= 0),
  unit_price numeric(14,2) not null default 0 check (unit_price >= 0),
  line_total numeric(14,2) not null default 0 check (line_total >= 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  metadata jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint order_items_order_owner_fk
    foreign key (order_id, user_id) references public.orders(id, user_id) on delete cascade,
  constraint order_items_filament_owner_fk
    foreign key (filament_id, user_id) references public.filaments(id, user_id) on delete restrict
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filament_id uuid not null,
  order_id uuid,
  movement_type text not null check (movement_type in (
    'opening', 'consumption', 'return', 'adjustment'
  )),
  quantity_g numeric(14,3) not null check (quantity_g <> 0),
  balance_after_g numeric(14,3) not null check (balance_after_g >= 0),
  stock_cycle integer not null default 0 check (stock_cycle >= 0),
  idempotency_key text not null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, idempotency_key),
  constraint stock_movements_filament_owner_fk
    foreign key (filament_id, user_id) references public.filaments(id, user_id) on delete restrict,
  constraint stock_movements_order_owner_fk
    foreign key (order_id, user_id) references public.orders(id, user_id) on delete restrict
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid,
  legacy_id text,
  description text not null,
  category text,
  amount numeric(14,2) not null check (amount >= 0),
  expense_date date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  due_date date,
  paid_at timestamptz,
  notes text,
  deleted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint expenses_order_owner_fk
    foreign key (order_id, user_id) references public.orders(id, user_id) on delete restrict
);

create table if not exists public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  legacy_id text,
  description text not null,
  category text,
  amount numeric(14,2) not null check (amount >= 0),
  frequency text not null default 'monthly'
    check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  day_of_month integer check (day_of_month between 1 and 31),
  next_due_date date,
  active boolean not null default true,
  notes text,
  deleted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table if not exists public.catalog_products (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filament_id uuid,
  legacy_id text,
  name text not null,
  category text,
  unit_weight_g numeric(14,3) not null default 0 check (unit_weight_g >= 0),
  print_hours numeric(12,3) not null default 0 check (print_hours >= 0),
  material text,
  default_unit_price numeric(14,2) not null default 0 check (default_unit_price >= 0),
  suggested_price numeric(14,2) not null default 0 check (suggested_price >= 0),
  active boolean not null default true,
  deleted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint catalog_products_filament_owner_fk
    foreign key (filament_id, user_id) references public.filaments(id, user_id) on delete restrict
);

create table if not exists public.calibrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  filament_id uuid,
  legacy_id text,
  name text not null,
  printer text,
  material text,
  temperature_c numeric(8,2),
  layer_height_mm numeric(8,3) check (layer_height_mm is null or layer_height_mm > 0),
  speed_mm_s numeric(10,2) check (speed_mm_s is null or speed_mm_s > 0),
  nozzle_mm numeric(6,3) check (nozzle_mm is null or nozzle_mm > 0),
  z_offset_mm numeric(8,3),
  nozzle_diameter numeric(6,3) check (nozzle_diameter is null or nozzle_diameter > 0),
  settings jsonb not null default '{}'::jsonb,
  results jsonb not null default '{}'::jsonb,
  notes text,
  deleted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint calibrations_filament_owner_fk
    foreign key (filament_id, user_id) references public.filaments(id, user_id) on delete restrict
);

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid,
  legacy_id text,
  title text not null,
  notes text,
  status text not null default 'pending'
    check (status in ('pending', 'in_progress', 'done', 'cancelled')),
  priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  due_date date,
  completed_at timestamptz,
  deleted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  constraint tasks_order_owner_fk
    foreign key (order_id, user_id) references public.orders(id, user_id) on delete cascade
);

create table if not exists public.attachments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  order_id uuid,
  catalog_product_id uuid,
  legacy_id text,
  kind text not null default 'product_photo'
    check (kind in ('product_photo', 'logo', 'document', 'other')),
  storage_bucket text not null default 'order-assets' check (storage_bucket = 'order-assets'),
  storage_path text not null check (length(storage_path) > 0),
  file_name text,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes between 0 and 10485760),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  sort_order integer not null default 0 check (sort_order >= 0),
  deleted_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, storage_path),
  constraint attachments_order_owner_fk
    foreign key (order_id, user_id) references public.orders(id, user_id) on delete cascade,
  constraint attachments_product_owner_fk
    foreign key (catalog_product_id, user_id) references public.catalog_products(id, user_id) on delete cascade
);

create unique index if not exists filaments_user_legacy_uidx
  on public.filaments (user_id, legacy_id) where legacy_id is not null;
create unique index if not exists orders_user_legacy_uidx
  on public.orders (user_id, legacy_id) where legacy_id is not null;
create unique index if not exists orders_user_number_uidx
  on public.orders (user_id, lower(order_number)) where order_number is not null;
create index if not exists orders_user_status_idx
  on public.orders (user_id, archived_at, commercial_status, production_status, due_date);
create index if not exists order_items_order_idx on public.order_items (user_id, order_id, sort_order);
create index if not exists stock_movements_order_idx
  on public.stock_movements (user_id, order_id, stock_cycle, filament_id);
create index if not exists stock_movements_filament_idx
  on public.stock_movements (user_id, filament_id, created_at desc);
create index if not exists tasks_due_idx on public.tasks (user_id, status, due_date);
create index if not exists attachments_order_idx on public.attachments (user_id, order_id, sort_order);

-- ---------------------------------------------------------------------------
-- Controle uniforme de versao e protecao das transicoes criticas
-- ---------------------------------------------------------------------------

create or replace function public.precificador_touch_row()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.version := greatest(coalesce(new.version, 1), 1);
    new.created_at := coalesce(new.created_at, now());
    new.updated_at := coalesce(new.updated_at, new.created_at, now());
  else
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'settings', 'filaments', 'orders', 'order_items',
    'stock_movements', 'expenses', 'recurring_expenses', 'catalog_products',
    'calibrations', 'tasks', 'attachments'
  ] loop
    execute format('drop trigger if exists %I on public.%I',
      'set_' || table_name || '_version', table_name);
    execute format(
      'create trigger %I before insert or update on public.%I for each row execute function public.precificador_touch_row()',
      'set_' || table_name || '_version', table_name
    );
  end loop;
end;
$$;

create or replace function public.precificador_guard_order_transition()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Operacoes no SQL Editor/migracoes administrativas nao possuem auth.uid().
  if auth.uid() is not null
     and coalesce(current_setting('app.precificador_order_rpc', true), '') <> 'on'
     and coalesce(current_setting('app.precificador_migration', true), '') <> 'on' then
    if new.stock_cycle is distinct from old.stock_cycle
       or new.stock_consumed_at is distinct from old.stock_consumed_at
       or new.stock_restored_at is distinct from old.stock_restored_at then
      raise exception using errcode = '42501', message = 'stock_fields_require_rpc';
    end if;

    if new.production_status = 'em_producao'
       and old.production_status is distinct from new.production_status then
      raise exception using errcode = '42501', message = 'start_production_requires_rpc';
    end if;

    if old.production_status in ('em_producao', 'pronto', 'enviado', 'entregue')
       and new.production_status = 'pendente'
       and old.production_status is distinct from new.production_status then
      raise exception using errcode = '42501', message = 'reset_production_requires_rpc';
    end if;

    if old.production_status = 'entregue'
       and new.production_status <> 'entregue' then
      raise exception using errcode = '42501', message = 'delivered_order_is_final';
    end if;

    if old.production_status is distinct from new.production_status then
      if (old.production_status = 'pendente' and new.production_status <> 'pendente')
         or (old.production_status = 'em_producao' and new.production_status <> 'pronto')
         or (old.production_status = 'pronto' and new.production_status <> 'enviado')
         or (old.production_status = 'enviado' and new.production_status <> 'entregue') then
        raise exception using errcode = '55000', message = 'invalid_production_transition';
      end if;
    end if;

    if new.commercial_status = 'cancelado'
       and old.commercial_status is distinct from new.commercial_status then
      raise exception using errcode = '42501', message = 'cancel_order_requires_rpc';
    end if;

    if old.commercial_status = 'cancelado'
       and new.commercial_status <> 'cancelado' then
      raise exception using errcode = '42501', message = 'restore_order_requires_rpc';
    end if;

    if old.archived_at is null and new.archived_at is not null then
      raise exception using errcode = '42501', message = 'archive_order_requires_rpc';
    end if;

    if old.archived_at is not null and new.archived_at is null then
      raise exception using errcode = '42501', message = 'restore_order_requires_rpc';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_orders_critical_transitions on public.orders;
create trigger guard_orders_critical_transitions
before update on public.orders
for each row execute function public.precificador_guard_order_transition();

create or replace function public.precificador_guard_order_items()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  target_order_id uuid;
  target_user_id uuid;
  order_row public.orders%rowtype;
begin
  if auth.uid() is null
     or coalesce(current_setting('app.precificador_migration', true), '') = 'on' then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  target_order_id := coalesce(new.order_id, old.order_id);
  target_user_id := coalesce(new.user_id, old.user_id);

  select o.* into order_row
  from public.orders o
  where o.id = target_order_id and o.user_id = target_user_id;

  if not found then
    raise exception using errcode = '23503', message = 'order_not_found';
  end if;

  if order_row.archived_at is not null
     or order_row.commercial_status = 'cancelado'
     or order_row.production_status <> 'pendente'
     or (order_row.stock_consumed_at is not null and order_row.stock_restored_at is null) then
    raise exception using errcode = '55000', message = 'order_items_locked';
  end if;

  if tg_op = 'UPDATE' and new.order_id is distinct from old.order_id then
    select o.* into order_row
    from public.orders o
    where o.id = new.order_id and o.user_id = new.user_id;

    if not found
       or order_row.archived_at is not null
       or order_row.commercial_status = 'cancelado'
       or order_row.production_status <> 'pendente'
       or (order_row.stock_consumed_at is not null and order_row.stock_restored_at is null) then
      raise exception using errcode = '55000', message = 'target_order_items_locked';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

drop trigger if exists guard_order_items_when_production_started on public.order_items;
create trigger guard_order_items_when_production_started
before insert or update or delete on public.order_items
for each row execute function public.precificador_guard_order_items();

create or replace function public.precificador_guard_filament_balance()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null
     and coalesce(current_setting('app.precificador_stock_rpc', true), '') <> 'on'
     and coalesce(current_setting('app.precificador_migration', true), '') <> 'on' then
    if (tg_op = 'INSERT' and new.current_weight_g <> 0)
       or (tg_op = 'UPDATE' and new.current_weight_g is distinct from old.current_weight_g) then
      raise exception using errcode = '42501', message = 'filament_balance_requires_rpc';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_filament_balance_updates on public.filaments;
create trigger guard_filament_balance_updates
before insert or update on public.filaments
for each row execute function public.precificador_guard_filament_balance();

-- ---------------------------------------------------------------------------
-- RLS: cada usuario acessa somente os proprios registros
-- ---------------------------------------------------------------------------

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'settings', 'filaments', 'orders', 'order_items',
    'stock_movements', 'expenses', 'recurring_expenses', 'catalog_products',
    'calibrations', 'tasks', 'attachments'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists users_manage_own_rows on public.%I', table_name);
    execute format(
      'create policy users_manage_own_rows on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      table_name
    );
  end loop;
end;
$$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on table
  public.profiles, public.settings, public.filaments, public.orders,
  public.order_items, public.expenses, public.recurring_expenses,
  public.catalog_products, public.calibrations, public.tasks, public.attachments
to authenticated;
grant select on public.stock_movements to authenticated;
revoke insert, update, delete on public.stock_movements from authenticated;
revoke delete on public.orders from authenticated;

-- Cria perfil/configuracao para contas novas e preenche contas ja existentes.
create or replace function public.precificador_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (user_id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1))
  )
  on conflict (user_id) do nothing;

  insert into public.settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_precificador on auth.users;
create trigger on_auth_user_created_precificador
after insert on auth.users
for each row execute function public.precificador_handle_new_user();

insert into public.profiles (user_id, display_name)
select u.id, coalesce(u.raw_user_meta_data ->> 'name', split_part(coalesce(u.email, ''), '@', 1))
from auth.users u
on conflict (user_id) do nothing;

insert into public.settings (user_id)
select u.id from auth.users u
on conflict (user_id) do nothing;

create or replace function public.precificador_migration_increment(
  p_counts jsonb,
  p_collection text,
  p_kind text
)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_set(
    p_counts,
    array[p_collection, p_kind],
    to_jsonb(coalesce((p_counts #>> array[p_collection, p_kind])::integer, 0) + 1),
    true
  );
$$;

revoke all on function public.precificador_migration_increment(jsonb, text, text)
from public, anon, authenticated;

-- Importacao unica e atomica da V3. O cliente envia somente dados canonicos;
-- user_id e sempre obtido da sessao autenticada.
create or replace function public.migrate_legacy_v3(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  payload jsonb := coalesce(p_payload, '{}'::jsonb);
  entry jsonb;
  collection_name text;
  record_id uuid;
  legacy_value text;
  last_balance numeric(14,3);
  current_settings public.settings%rowtype;
  settings_is_auto boolean := false;
  counts jsonb := jsonb_build_object(
    'settings', jsonb_build_object('imported', 0, 'skipped', 0),
    'filaments', jsonb_build_object('imported', 0, 'skipped', 0),
    'orders', jsonb_build_object('imported', 0, 'skipped', 0),
    'order_items', jsonb_build_object('imported', 0, 'skipped', 0),
    'stock_movements', jsonb_build_object('imported', 0, 'skipped', 0),
    'expenses', jsonb_build_object('imported', 0, 'skipped', 0),
    'recurring_expenses', jsonb_build_object('imported', 0, 'skipped', 0),
    'catalog_products', jsonb_build_object('imported', 0, 'skipped', 0),
    'calibrations', jsonb_build_object('imported', 0, 'skipped', 0),
    'tasks', jsonb_build_object('imported', 0, 'skipped', 0)
  );
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if jsonb_typeof(payload) <> 'object' then
    raise exception using errcode = '22023', message = 'migration_payload_must_be_an_object';
  end if;
  if nullif(payload ->> 'migration_id', '') is null then
    raise exception using errcode = '22023', message = 'migration_id_required';
  end if;

  foreach collection_name in array array[
    'settings', 'filaments', 'orders', 'order_items', 'stock_movements',
    'expenses', 'recurring_expenses', 'catalog_products', 'calibrations', 'tasks'
  ] loop
    if payload ? collection_name and jsonb_typeof(payload -> collection_name) <> 'array' then
      raise exception 'migration_collection_must_be_array: %', collection_name using errcode = '22023';
    end if;
  end loop;

  -- Serializa migracoes da mesma conta e libera os tres guards somente nesta transacao.
  perform pg_advisory_xact_lock(hashtextextended(current_user_id::text, 384733));
  perform set_config('app.precificador_migration', 'on', true);

  -- Settings: a linha criada automaticamente (version=1) pode ser preenchida.
  -- Uma linha ja editada na V4 nunca e sobrescrita.
  for entry in
    select value from jsonb_array_elements(coalesce(payload -> 'settings', '[]'::jsonb)) limit 1
  loop
    select s.* into current_settings
    from public.settings s where s.user_id = current_user_id for update;

    settings_is_auto := found
      and current_settings.version = 1
      and coalesce(nullif(current_settings.studio_name, ''), 'Studio FH3D') = 'Studio FH3D'
      and nullif(current_settings.whatsapp, '') is null
      and nullif(current_settings.email, '') is null
      and nullif(current_settings.instagram, '') is null
      and nullif(current_settings.pix_key, '') is null
      and nullif(current_settings.pix_holder, '') is null
      and current_settings.logo_path is null
      and current_settings.data = '{}'::jsonb;

    if found and not settings_is_auto then
      counts := public.precificador_migration_increment(counts, 'settings', 'skipped');
    elsif found then
      update public.settings s set
        studio_name = coalesce(nullif(entry ->> 'studio_name', ''), s.studio_name),
        whatsapp = coalesce(nullif(entry ->> 'whatsapp', ''), s.whatsapp),
        email = coalesce(nullif(entry ->> 'email', ''), s.email),
        instagram = coalesce(nullif(entry ->> 'instagram', ''), s.instagram),
        pix_key = coalesce(nullif(entry ->> 'pix_key', ''), s.pix_key),
        pix_type = coalesce(nullif(entry ->> 'pix_type', ''), s.pix_type),
        pix_holder = coalesce(nullif(entry ->> 'pix_holder', ''), s.pix_holder),
        filament_cost_kg = coalesce(nullif(entry ->> 'filament_cost_kg', '')::numeric, s.filament_cost_kg),
        energy_kwh = coalesce(nullif(entry ->> 'energy_kwh', '')::numeric, s.energy_kwh),
        k1c_kw = coalesce(nullif(entry ->> 'k1c_kw', '')::numeric, s.k1c_kw),
        kobra_kw = coalesce(nullif(entry ->> 'kobra_kw', '')::numeric, s.kobra_kw),
        depreciation_hour = coalesce(nullif(entry ->> 'depreciation_hour', '')::numeric, s.depreciation_hour),
        maintenance_hour = coalesce(nullif(entry ->> 'maintenance_hour', '')::numeric, s.maintenance_hour),
        profit_percent = coalesce(nullif(entry ->> 'profit_percent', '')::numeric, s.profit_percent),
        packaging_cost = coalesce(nullif(entry ->> 'packaging_cost', '')::numeric, s.packaging_cost),
        modification_terms = coalesce(nullif(entry ->> 'modification_terms', ''), s.modification_terms),
        validity_terms = coalesce(nullif(entry ->> 'validity_terms', ''), s.validity_terms),
        general_notes = coalesce(nullif(entry ->> 'general_notes', ''), s.general_notes),
        created_at = coalesce(nullif(entry ->> 'created_at', '')::timestamptz, s.created_at)
      where s.user_id = current_user_id;
      counts := public.precificador_migration_increment(counts, 'settings', 'imported');
    else
      insert into public.settings (
        user_id, studio_name, whatsapp, email, instagram, pix_key, pix_type, pix_holder,
        filament_cost_kg, energy_kwh, k1c_kw, kobra_kw, depreciation_hour,
        maintenance_hour, profit_percent, packaging_cost, modification_terms,
        validity_terms, general_notes, created_at, updated_at
      ) values (
        current_user_id,
        nullif(entry ->> 'studio_name', ''),
        nullif(entry ->> 'whatsapp', ''),
        nullif(entry ->> 'email', ''),
        nullif(entry ->> 'instagram', ''),
        nullif(entry ->> 'pix_key', ''),
        nullif(entry ->> 'pix_type', ''),
        nullif(entry ->> 'pix_holder', ''),
        coalesce(nullif(entry ->> 'filament_cost_kg', '')::numeric, 95),
        coalesce(nullif(entry ->> 'energy_kwh', '')::numeric, 0.85),
        coalesce(nullif(entry ->> 'k1c_kw', '')::numeric, 0.25),
        coalesce(nullif(entry ->> 'kobra_kw', '')::numeric, 0.3),
        coalesce(nullif(entry ->> 'depreciation_hour', '')::numeric, 2.5),
        coalesce(nullif(entry ->> 'maintenance_hour', '')::numeric, 0.5),
        coalesce(nullif(entry ->> 'profit_percent', '')::numeric, 30),
        coalesce(nullif(entry ->> 'packaging_cost', '')::numeric, 10),
        nullif(entry ->> 'modification_terms', ''),
        nullif(entry ->> 'validity_terms', ''),
        nullif(entry ->> 'general_notes', ''),
        coalesce(nullif(entry ->> 'created_at', '')::timestamptz, now()),
        coalesce(nullif(entry ->> 'updated_at', '')::timestamptz, now())
      );
      counts := public.precificador_migration_increment(counts, 'settings', 'imported');
    end if;
  end loop;

  -- Filamentos sao gravados ja com o saldo final do ledger recebido.
  for entry in select value from jsonb_array_elements(coalesce(payload -> 'filaments', '[]'::jsonb))
  loop
    record_id := nullif(entry ->> 'id', '')::uuid;
    legacy_value := nullif(entry ->> 'legacy_id', '');
    if record_id is null then raise exception using errcode = '22023', message = 'migration_filament_id_required'; end if;

    if exists (
      select 1 from public.filaments f
      where f.user_id = current_user_id
        and (f.id = record_id or (legacy_value is not null and f.legacy_id = legacy_value))
    ) then
      counts := public.precificador_migration_increment(counts, 'filaments', 'skipped');
      continue;
    end if;

    select nullif(m.value ->> 'balance_after_g', '')::numeric into last_balance
    from jsonb_array_elements(coalesce(payload -> 'stock_movements', '[]'::jsonb))
      with ordinality as m(value, position)
    where nullif(m.value ->> 'filament_id', '')::uuid = record_id
    order by m.position desc
    limit 1;

    last_balance := coalesce(last_balance, nullif(entry ->> 'current_weight_g', '')::numeric, 0);
    if last_balance < 0 then raise exception using errcode = '22003', message = 'migration_negative_filament_balance'; end if;

    insert into public.filaments (
      id, user_id, legacy_id, manufacturer, material, color, brand, sku,
      initial_weight_g, current_weight_g, price_kg, active, archived_at,
      deleted_at, notes, metadata, created_at, updated_at
    ) values (
      record_id,
      current_user_id,
      legacy_value,
      coalesce(nullif(entry ->> 'manufacturer', ''), 'Sem fabricante'),
      coalesce(nullif(entry ->> 'material', ''), 'PLA'),
      nullif(entry ->> 'color', ''),
      nullif(entry ->> 'brand', ''),
      nullif(entry ->> 'sku', ''),
      greatest(coalesce(nullif(entry ->> 'initial_weight_g', '')::numeric, last_balance), last_balance),
      last_balance,
      coalesce(nullif(entry ->> 'price_kg', '')::numeric, 0),
      coalesce(nullif(entry ->> 'active', '')::boolean, true),
      nullif(entry ->> 'archived_at', '')::timestamptz,
      nullif(entry ->> 'deleted_at', '')::timestamptz,
      nullif(entry ->> 'notes', ''),
      coalesce(entry -> 'metadata', '{}'::jsonb),
      coalesce(nullif(entry ->> 'created_at', '')::timestamptz, now()),
      coalesce(nullif(entry ->> 'updated_at', '')::timestamptz, nullif(entry ->> 'created_at', '')::timestamptz, now())
    );
    counts := public.precificador_migration_increment(counts, 'filaments', 'imported');
  end loop;

  for entry in select value from jsonb_array_elements(coalesce(payload -> 'orders', '[]'::jsonb))
  loop
    record_id := nullif(entry ->> 'id', '')::uuid;
    legacy_value := nullif(entry ->> 'legacy_id', '');
    if record_id is null then raise exception using errcode = '22023', message = 'migration_order_id_required'; end if;
    if exists (
      select 1 from public.orders o where o.user_id = current_user_id
        and (o.id = record_id or (legacy_value is not null and o.legacy_id = legacy_value))
    ) then
      counts := public.precificador_migration_increment(counts, 'orders', 'skipped');
      continue;
    end if;

    insert into public.orders (
      id, user_id, legacy_id, order_number, customer_name, customer_email,
      customer_phone, project, printer, description, notes, due_date,
      commercial_status, cancelled_from_status, production_status, payment_status,
      subtotal, discount, shipping, total, final_price, total_cost, modeling_price,
      finishing_price, paid_at, stock_cycle, stock_consumed_at, stock_restored_at,
      archived_at, deleted_at, metadata, created_at, updated_at
    ) values (
      record_id,
      current_user_id,
      legacy_value,
      nullif(entry ->> 'order_number', ''),
      coalesce(nullif(entry ->> 'customer_name', ''), 'Cliente nao informado'),
      nullif(entry ->> 'customer_email', ''),
      nullif(entry ->> 'customer_phone', ''),
      coalesce(nullif(entry ->> 'project', ''), 'Pedido migrado'),
      nullif(entry ->> 'printer', ''),
      nullif(entry ->> 'description', ''),
      nullif(entry ->> 'notes', ''),
      nullif(entry ->> 'due_date', '')::date,
      coalesce(nullif(entry ->> 'commercial_status', ''), 'orcamento'),
      nullif(entry ->> 'cancelled_from_status', ''),
      coalesce(nullif(entry ->> 'production_status', ''), 'pendente'),
      coalesce(nullif(entry ->> 'payment_status', ''), 'pendente'),
      coalesce(nullif(entry ->> 'subtotal', '')::numeric, nullif(entry ->> 'final_price', '')::numeric, 0),
      coalesce(nullif(entry ->> 'discount', '')::numeric, 0),
      coalesce(nullif(entry ->> 'shipping', '')::numeric, 0),
      coalesce(nullif(entry ->> 'total', '')::numeric, nullif(entry ->> 'final_price', '')::numeric, 0),
      coalesce(nullif(entry ->> 'final_price', '')::numeric, 0),
      coalesce(nullif(entry ->> 'total_cost', '')::numeric, 0),
      coalesce(nullif(entry ->> 'modeling_price', '')::numeric, 0),
      coalesce(nullif(entry ->> 'finishing_price', '')::numeric, 0),
      nullif(entry ->> 'paid_at', '')::timestamptz,
      coalesce(nullif(entry ->> 'stock_cycle', '')::integer, 0),
      nullif(entry ->> 'stock_consumed_at', '')::timestamptz,
      nullif(entry ->> 'stock_restored_at', '')::timestamptz,
      nullif(entry ->> 'archived_at', '')::timestamptz,
      nullif(entry ->> 'deleted_at', '')::timestamptz,
      coalesce(entry -> 'metadata', '{}'::jsonb),
      coalesce(nullif(entry ->> 'created_at', '')::timestamptz, now()),
      coalesce(nullif(entry ->> 'updated_at', '')::timestamptz, nullif(entry ->> 'created_at', '')::timestamptz, now())
    );
    counts := public.precificador_migration_increment(counts, 'orders', 'imported');
  end loop;

  for entry in select value from jsonb_array_elements(coalesce(payload -> 'order_items', '[]'::jsonb))
  loop
    record_id := nullif(entry ->> 'id', '')::uuid;
    legacy_value := nullif(entry ->> 'legacy_id', '');
    if record_id is null then raise exception using errcode = '22023', message = 'migration_order_item_id_required'; end if;
    if exists (
      select 1 from public.order_items oi where oi.user_id = current_user_id
        and (
          oi.id = record_id
          or (
            legacy_value is not null
            and oi.order_id = nullif(entry ->> 'order_id', '')::uuid
            and oi.legacy_id = legacy_value
          )
        )
    ) then
      counts := public.precificador_migration_increment(counts, 'order_items', 'skipped');
      continue;
    end if;

    insert into public.order_items (
      id, user_id, order_id, filament_id, legacy_id, name, quantity,
      unit_weight_g, print_hours, material, filament_price_kg, unit_price,
      line_total, sort_order, metadata, created_at, updated_at
    ) values (
      record_id,
      current_user_id,
      nullif(entry ->> 'order_id', '')::uuid,
      nullif(entry ->> 'filament_id', '')::uuid,
      legacy_value,
      coalesce(nullif(entry ->> 'name', ''), 'Item migrado'),
      coalesce(nullif(entry ->> 'quantity', '')::integer, 1),
      coalesce(nullif(entry ->> 'unit_weight_g', '')::numeric, 0),
      coalesce(nullif(entry ->> 'print_hours', '')::numeric, 0),
      nullif(entry ->> 'material', ''),
      coalesce(nullif(entry ->> 'filament_price_kg', '')::numeric, 0),
      coalesce(nullif(entry ->> 'unit_price', '')::numeric, 0),
      coalesce(nullif(entry ->> 'line_total', '')::numeric, 0),
      coalesce(nullif(entry ->> 'sort_order', '')::integer, 0),
      coalesce(entry -> 'metadata', '{}'::jsonb),
      coalesce(nullif(entry ->> 'created_at', '')::timestamptz, now()),
      coalesce(nullif(entry ->> 'updated_at', '')::timestamptz, nullif(entry ->> 'created_at', '')::timestamptz, now())
    );
    counts := public.precificador_migration_increment(counts, 'order_items', 'imported');
  end loop;

  for entry in select value from jsonb_array_elements(coalesce(payload -> 'stock_movements', '[]'::jsonb))
  loop
    record_id := nullif(entry ->> 'id', '')::uuid;
    if record_id is null or nullif(entry ->> 'idempotency_key', '') is null then
      raise exception using errcode = '22023', message = 'migration_stock_movement_identity_required';
    end if;
    if exists (
      select 1 from public.stock_movements sm where sm.user_id = current_user_id
        and (sm.id = record_id or sm.idempotency_key = entry ->> 'idempotency_key')
    ) then
      counts := public.precificador_migration_increment(counts, 'stock_movements', 'skipped');
      continue;
    end if;

    if coalesce(nullif(entry ->> 'balance_after_g', '')::numeric, -1) < 0 then
      raise exception using errcode = '22003', message = 'migration_negative_movement_balance';
    end if;
    insert into public.stock_movements (
      id, user_id, filament_id, order_id, movement_type, quantity_g,
      balance_after_g, stock_cycle, idempotency_key, reason, metadata,
      created_at, updated_at
    ) values (
      record_id,
      current_user_id,
      nullif(entry ->> 'filament_id', '')::uuid,
      nullif(entry ->> 'order_id', '')::uuid,
      nullif(entry ->> 'movement_type', ''),
      nullif(entry ->> 'quantity_g', '')::numeric,
      nullif(entry ->> 'balance_after_g', '')::numeric,
      coalesce(nullif(entry ->> 'stock_cycle', '')::integer, 0),
      entry ->> 'idempotency_key',
      nullif(entry ->> 'reason', ''),
      coalesce(entry -> 'metadata', '{}'::jsonb),
      coalesce(nullif(entry ->> 'created_at', '')::timestamptz, now()),
      coalesce(nullif(entry ->> 'updated_at', '')::timestamptz, nullif(entry ->> 'created_at', '')::timestamptz, now())
    );
    counts := public.precificador_migration_increment(counts, 'stock_movements', 'imported');
  end loop;

  for entry in select value from jsonb_array_elements(coalesce(payload -> 'expenses', '[]'::jsonb))
  loop
    record_id := nullif(entry ->> 'id', '')::uuid;
    legacy_value := nullif(entry ->> 'legacy_id', '');
    if record_id is null then raise exception using errcode = '22023', message = 'migration_expense_id_required'; end if;
    if exists (select 1 from public.expenses e where e.user_id = current_user_id and (e.id = record_id or (legacy_value is not null and e.legacy_id = legacy_value))) then
      counts := public.precificador_migration_increment(counts, 'expenses', 'skipped'); continue;
    end if;
    insert into public.expenses (
      id, user_id, order_id, legacy_id, description, category, amount,
      expense_date, due_date, paid_at, notes, deleted_at, metadata, created_at, updated_at
    ) values (
      record_id, current_user_id, nullif(entry ->> 'order_id', '')::uuid, legacy_value,
      coalesce(nullif(entry ->> 'description', ''), 'Despesa migrada'), nullif(entry ->> 'category', ''),
      coalesce(nullif(entry ->> 'amount', '')::numeric, 0),
      coalesce(nullif(entry ->> 'expense_date', '')::date, (now() at time zone 'America/Sao_Paulo')::date),
      nullif(entry ->> 'due_date', '')::date, nullif(entry ->> 'paid_at', '')::timestamptz,
      nullif(entry ->> 'notes', ''), nullif(entry ->> 'deleted_at', '')::timestamptz,
      coalesce(entry -> 'metadata', '{}'::jsonb),
      coalesce(nullif(entry ->> 'created_at', '')::timestamptz, now()),
      coalesce(nullif(entry ->> 'updated_at', '')::timestamptz, nullif(entry ->> 'created_at', '')::timestamptz, now())
    );
    counts := public.precificador_migration_increment(counts, 'expenses', 'imported');
  end loop;

  for entry in select value from jsonb_array_elements(coalesce(payload -> 'recurring_expenses', '[]'::jsonb))
  loop
    record_id := nullif(entry ->> 'id', '')::uuid; legacy_value := nullif(entry ->> 'legacy_id', '');
    if record_id is null then raise exception using errcode = '22023', message = 'migration_recurring_expense_id_required'; end if;
    if exists (select 1 from public.recurring_expenses e where e.user_id = current_user_id and (e.id = record_id or (legacy_value is not null and e.legacy_id = legacy_value))) then
      counts := public.precificador_migration_increment(counts, 'recurring_expenses', 'skipped'); continue;
    end if;
    insert into public.recurring_expenses (
      id, user_id, legacy_id, description, category, amount, frequency,
      day_of_month, next_due_date, active, notes, deleted_at, metadata, created_at, updated_at
    ) values (
      record_id, current_user_id, legacy_value,
      coalesce(nullif(entry ->> 'description', ''), 'Despesa fixa migrada'), nullif(entry ->> 'category', ''),
      coalesce(nullif(entry ->> 'amount', '')::numeric, 0), coalesce(nullif(entry ->> 'frequency', ''), 'monthly'),
      nullif(entry ->> 'day_of_month', '')::integer, nullif(entry ->> 'next_due_date', '')::date,
      coalesce(nullif(entry ->> 'active', '')::boolean, true), nullif(entry ->> 'notes', ''),
      nullif(entry ->> 'deleted_at', '')::timestamptz, coalesce(entry -> 'metadata', '{}'::jsonb),
      coalesce(nullif(entry ->> 'created_at', '')::timestamptz, now()),
      coalesce(nullif(entry ->> 'updated_at', '')::timestamptz, nullif(entry ->> 'created_at', '')::timestamptz, now())
    );
    counts := public.precificador_migration_increment(counts, 'recurring_expenses', 'imported');
  end loop;

  for entry in select value from jsonb_array_elements(coalesce(payload -> 'catalog_products', '[]'::jsonb))
  loop
    record_id := nullif(entry ->> 'id', '')::uuid; legacy_value := nullif(entry ->> 'legacy_id', '');
    if record_id is null then raise exception using errcode = '22023', message = 'migration_catalog_id_required'; end if;
    if exists (select 1 from public.catalog_products c where c.user_id = current_user_id and (c.id = record_id or (legacy_value is not null and c.legacy_id = legacy_value))) then
      counts := public.precificador_migration_increment(counts, 'catalog_products', 'skipped'); continue;
    end if;
    insert into public.catalog_products (
      id, user_id, filament_id, legacy_id, name, category, unit_weight_g,
      print_hours, material, default_unit_price, suggested_price, active,
      deleted_at, metadata, created_at, updated_at
    ) values (
      record_id, current_user_id, nullif(entry ->> 'filament_id', '')::uuid, legacy_value,
      coalesce(nullif(entry ->> 'name', ''), 'Produto migrado'), nullif(entry ->> 'category', ''),
      coalesce(nullif(entry ->> 'unit_weight_g', '')::numeric, 0),
      coalesce(nullif(entry ->> 'print_hours', '')::numeric, 0), nullif(entry ->> 'material', ''),
      coalesce(nullif(entry ->> 'default_unit_price', '')::numeric, 0),
      coalesce(nullif(entry ->> 'suggested_price', '')::numeric, 0),
      coalesce(nullif(entry ->> 'active', '')::boolean, true), nullif(entry ->> 'deleted_at', '')::timestamptz,
      coalesce(entry -> 'metadata', '{}'::jsonb),
      coalesce(nullif(entry ->> 'created_at', '')::timestamptz, now()),
      coalesce(nullif(entry ->> 'updated_at', '')::timestamptz, nullif(entry ->> 'created_at', '')::timestamptz, now())
    );
    counts := public.precificador_migration_increment(counts, 'catalog_products', 'imported');
  end loop;

  for entry in select value from jsonb_array_elements(coalesce(payload -> 'calibrations', '[]'::jsonb))
  loop
    record_id := nullif(entry ->> 'id', '')::uuid; legacy_value := nullif(entry ->> 'legacy_id', '');
    if record_id is null then raise exception using errcode = '22023', message = 'migration_calibration_id_required'; end if;
    if exists (select 1 from public.calibrations c where c.user_id = current_user_id and (c.id = record_id or (legacy_value is not null and c.legacy_id = legacy_value))) then
      counts := public.precificador_migration_increment(counts, 'calibrations', 'skipped'); continue;
    end if;
    insert into public.calibrations (
      id, user_id, filament_id, legacy_id, name, printer, material,
      temperature_c, layer_height_mm, speed_mm_s, nozzle_mm, z_offset_mm,
      nozzle_diameter, settings, results, notes, deleted_at, metadata, created_at, updated_at
    ) values (
      record_id, current_user_id, nullif(entry ->> 'filament_id', '')::uuid, legacy_value,
      coalesce(nullif(entry ->> 'name', ''), 'Calibracao migrada'), nullif(entry ->> 'printer', ''),
      nullif(entry ->> 'material', ''), nullif(entry ->> 'temperature_c', '')::numeric,
      nullif(nullif(entry ->> 'layer_height_mm', '')::numeric, 0),
      nullif(nullif(entry ->> 'speed_mm_s', '')::numeric, 0),
      nullif(nullif(entry ->> 'nozzle_mm', '')::numeric, 0),
      nullif(entry ->> 'z_offset_mm', '')::numeric,
      nullif(nullif(entry ->> 'nozzle_diameter', '')::numeric, 0),
      coalesce(entry -> 'settings', '{}'::jsonb),
      coalesce(entry -> 'results', '{}'::jsonb), nullif(entry ->> 'notes', ''),
      nullif(entry ->> 'deleted_at', '')::timestamptz, coalesce(entry -> 'metadata', '{}'::jsonb),
      coalesce(nullif(entry ->> 'created_at', '')::timestamptz, now()),
      coalesce(nullif(entry ->> 'updated_at', '')::timestamptz, nullif(entry ->> 'created_at', '')::timestamptz, now())
    );
    counts := public.precificador_migration_increment(counts, 'calibrations', 'imported');
  end loop;

  for entry in select value from jsonb_array_elements(coalesce(payload -> 'tasks', '[]'::jsonb))
  loop
    record_id := nullif(entry ->> 'id', '')::uuid; legacy_value := nullif(entry ->> 'legacy_id', '');
    if record_id is null then raise exception using errcode = '22023', message = 'migration_task_id_required'; end if;
    if exists (select 1 from public.tasks t where t.user_id = current_user_id and (t.id = record_id or (legacy_value is not null and t.legacy_id = legacy_value))) then
      counts := public.precificador_migration_increment(counts, 'tasks', 'skipped'); continue;
    end if;
    insert into public.tasks (
      id, user_id, order_id, legacy_id, title, notes, status, priority,
      due_date, completed_at, deleted_at, metadata, created_at, updated_at
    ) values (
      record_id, current_user_id, nullif(entry ->> 'order_id', '')::uuid, legacy_value,
      coalesce(nullif(entry ->> 'title', ''), 'Tarefa migrada'), nullif(entry ->> 'notes', ''),
      coalesce(nullif(entry ->> 'status', ''), 'pending'), coalesce(nullif(entry ->> 'priority', ''), 'normal'),
      nullif(entry ->> 'due_date', '')::date, nullif(entry ->> 'completed_at', '')::timestamptz,
      nullif(entry ->> 'deleted_at', '')::timestamptz, coalesce(entry -> 'metadata', '{}'::jsonb),
      coalesce(nullif(entry ->> 'created_at', '')::timestamptz, now()),
      coalesce(nullif(entry ->> 'updated_at', '')::timestamptz, nullif(entry ->> 'created_at', '')::timestamptz, now())
    );
    counts := public.precificador_migration_increment(counts, 'tasks', 'imported');
  end loop;

  return jsonb_build_object(
    'migration_id', payload ->> 'migration_id',
    'captured_at', payload ->> 'captured_at',
    'byCollection', counts
  );
end;
$$;

revoke all on function public.migrate_legacy_v3(jsonb) from public, anon;
grant execute on function public.migrate_legacy_v3(jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: cadastra/edita filamento e audita toda alteracao manual de saldo
-- ---------------------------------------------------------------------------

create or replace function public.save_filament(
  p_filament jsonb,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  payload jsonb := coalesce(p_filament, '{}'::jsonb);
  filament_id_value uuid;
  existing_filament public.filaments%rowtype;
  saved_filament public.filaments%rowtype;
  manufacturer_value text;
  material_value text;
  color_value text;
  brand_value text;
  sku_value text;
  current_weight_value numeric(14,3);
  initial_weight_value numeric(14,3);
  price_kg_value numeric(14,2);
  active_value boolean;
  archived_at_value timestamptz;
  notes_value text;
  metadata_value jsonb;
  weight_delta numeric(14,3);
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;
  if jsonb_typeof(payload) <> 'object' then
    raise exception using errcode = '22023', message = 'filament_must_be_an_object';
  end if;

  begin
    filament_id_value := coalesce(nullif(payload ->> 'id', '')::uuid, gen_random_uuid());
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'invalid_filament_id';
  end;

  select f.* into existing_filament
  from public.filaments f
  where f.id = filament_id_value and f.user_id = current_user_id
  for update;

  if not found and exists (select 1 from public.filaments f where f.id = filament_id_value) then
    raise exception using errcode = '42501', message = 'filament_belongs_to_another_user';
  end if;

  manufacturer_value := coalesce(
    nullif(btrim(payload ->> 'manufacturer'), ''),
    existing_filament.manufacturer
  );
  material_value := coalesce(nullif(btrim(payload ->> 'material'), ''), existing_filament.material);
  color_value := case when payload ? 'color' then nullif(btrim(payload ->> 'color'), '') else existing_filament.color end;
  brand_value := case when payload ? 'brand' then nullif(btrim(payload ->> 'brand'), '') else existing_filament.brand end;
  sku_value := case when payload ? 'sku' then nullif(btrim(payload ->> 'sku'), '') else existing_filament.sku end;
  current_weight_value := coalesce(
    nullif(payload ->> 'current_weight_g', '')::numeric,
    existing_filament.current_weight_g,
    0
  );
  initial_weight_value := coalesce(
    nullif(payload ->> 'initial_weight_g', '')::numeric,
    existing_filament.initial_weight_g,
    current_weight_value
  );
  price_kg_value := coalesce(nullif(payload ->> 'price_kg', '')::numeric, existing_filament.price_kg, 0);
  active_value := coalesce(nullif(payload ->> 'active', '')::boolean, existing_filament.active, true);
  archived_at_value := case
    when payload ? 'archived_at' then nullif(payload ->> 'archived_at', '')::timestamptz
    else existing_filament.archived_at
  end;
  notes_value := case when payload ? 'notes' then nullif(payload ->> 'notes', '') else existing_filament.notes end;
  metadata_value := case
    when payload ? 'metadata' then coalesce(payload -> 'metadata', '{}'::jsonb)
    else coalesce(existing_filament.metadata, '{}'::jsonb)
  end;

  if manufacturer_value is null or material_value is null then
    raise exception using errcode = '22023', message = 'manufacturer_and_material_required';
  end if;
  if current_weight_value < 0 or initial_weight_value < 0 or price_kg_value < 0 then
    raise exception using errcode = '22023', message = 'negative_filament_value';
  end if;

  if existing_filament.id is not null then
    if p_expected_version is null then
      -- Retry de uma criacao cuja resposta se perdeu na rede.
      if existing_filament.manufacturer = manufacturer_value
         and existing_filament.material = material_value
         and existing_filament.color is not distinct from color_value
         and existing_filament.current_weight_g = current_weight_value
         and existing_filament.price_kg = price_kg_value then
        return to_jsonb(existing_filament);
      end if;
      raise exception using errcode = '22023', message = 'version_required';
    end if;

    if existing_filament.version <> p_expected_version then
      -- Retry idempotente da mesma edicao ja confirmada pelo servidor.
      if existing_filament.version = p_expected_version + 1
         and existing_filament.manufacturer = manufacturer_value
         and existing_filament.material = material_value
         and existing_filament.color is not distinct from color_value
         and existing_filament.brand is not distinct from brand_value
         and existing_filament.sku is not distinct from sku_value
         and existing_filament.initial_weight_g = initial_weight_value
         and existing_filament.current_weight_g = current_weight_value
         and existing_filament.price_kg = price_kg_value
         and existing_filament.active = active_value
         and existing_filament.archived_at is not distinct from archived_at_value
         and existing_filament.notes is not distinct from notes_value
         and existing_filament.metadata = metadata_value then
        return to_jsonb(existing_filament);
      end if;
      raise exception 'version_conflict: expected %, actual %', p_expected_version, existing_filament.version
        using errcode = '40001';
    end if;

    weight_delta := current_weight_value - existing_filament.current_weight_g;
    perform set_config('app.precificador_stock_rpc', 'on', true);
    update public.filaments f set
      manufacturer = manufacturer_value,
      material = material_value,
      color = color_value,
      brand = brand_value,
      sku = sku_value,
      initial_weight_g = initial_weight_value,
      current_weight_g = current_weight_value,
      price_kg = price_kg_value,
      active = active_value,
      archived_at = archived_at_value,
      notes = notes_value,
      metadata = metadata_value
    where f.id = filament_id_value and f.user_id = current_user_id
    returning * into saved_filament;

    if weight_delta <> 0 then
      insert into public.stock_movements (
        user_id, filament_id, movement_type, quantity_g, balance_after_g,
        stock_cycle, idempotency_key, reason
      ) values (
        current_user_id,
        filament_id_value,
        'adjustment',
        weight_delta,
        current_weight_value,
        0,
        'adjustment:' || filament_id_value::text || ':' || p_expected_version::text,
        'Ajuste manual de estoque'
      )
      on conflict (user_id, idempotency_key) do nothing;
    end if;
  else
    perform set_config('app.precificador_stock_rpc', 'on', true);
    insert into public.filaments (
      id, user_id, legacy_id, manufacturer, material, color, brand, sku,
      initial_weight_g, current_weight_g, price_kg, active, archived_at,
      notes, metadata, created_at
    ) values (
      filament_id_value,
      current_user_id,
      nullif(payload ->> 'legacy_id', ''),
      manufacturer_value,
      material_value,
      color_value,
      brand_value,
      sku_value,
      initial_weight_value,
      current_weight_value,
      price_kg_value,
      active_value,
      archived_at_value,
      notes_value,
      metadata_value,
      coalesce(nullif(payload ->> 'created_at', '')::timestamptz, now())
    ) returning * into saved_filament;

    if current_weight_value > 0 then
      insert into public.stock_movements (
        user_id, filament_id, movement_type, quantity_g, balance_after_g,
        stock_cycle, idempotency_key, reason
      ) values (
        current_user_id,
        filament_id_value,
        'opening',
        current_weight_value,
        current_weight_value,
        0,
        'opening:' || filament_id_value::text,
        'Saldo inicial do filamento'
      )
      on conflict (user_id, idempotency_key) do nothing;
    end if;
  end if;

  return to_jsonb(saved_filament);
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: salva pedido e itens em uma unica transacao, sem tocar no estoque
-- ---------------------------------------------------------------------------

create or replace function public.save_order(
  p_order jsonb,
  p_items jsonb,
  p_expected_version bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  payload jsonb := coalesce(p_order, '{}'::jsonb);
  order_id_value uuid;
  existing_order public.orders%rowtype;
  saved_order public.orders%rowtype;
  item jsonb;
  item_id_value uuid;
  filament_id_value uuid;
  quantity_value integer;
  grams_value numeric(14,3);
  print_hours_value numeric(12,3);
  unit_price_value numeric(14,2);
  line_total_value numeric(14,2);
  sort_value integer := 0;
  commercial_value text;
  payment_value text;
  subtotal_value numeric(14,2);
  discount_value numeric(14,2);
  shipping_value numeric(14,2);
  total_value numeric(14,2);
  final_price_value numeric(14,2);
  total_cost_value numeric(14,2);
  modeling_price_value numeric(14,2);
  finishing_price_value numeric(14,2);
  paid_at_value timestamptz;
  expected_items_fingerprint jsonb;
  stored_items_fingerprint jsonb;
  retry_order_matches boolean := false;
  result jsonb;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  if jsonb_typeof(payload) <> 'object' then
    raise exception using errcode = '22023', message = 'order_must_be_an_object';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception using errcode = '22023', message = 'items_must_be_an_array';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception using errcode = '22023', message = 'order_requires_at_least_one_item';
  end if;

  if nullif(payload ->> 'id', '') is not null then
    begin
      order_id_value := (payload ->> 'id')::uuid;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'invalid_order_id';
    end;
  else
    raise exception using errcode = '22023', message = 'order_id_required_for_idempotency';
  end if;

  select o.* into existing_order
  from public.orders o
  where o.id = order_id_value and o.user_id = current_user_id
  for update;

  if existing_order.id is null then
    if exists (select 1 from public.orders o where o.id = order_id_value) then
      raise exception using errcode = '42501', message = 'order_belongs_to_another_user';
    end if;
  end if;

  commercial_value := coalesce(
    nullif(payload ->> 'commercial_status', ''),
    case when p_expected_version is null then 'orcamento' else existing_order.commercial_status end
  );
  if commercial_value not in ('orcamento', 'aprovado') then
    raise exception using errcode = '22023', message = 'invalid_commercial_status_for_save';
  end if;

  payment_value := coalesce(
    nullif(payload ->> 'payment_status', ''),
    case when p_expected_version is null then 'pendente' else existing_order.payment_status end
  );
  if payment_value not in ('pendente', 'parcial', 'pago', 'reembolsado') then
    raise exception using errcode = '22023', message = 'invalid_payment_status';
  end if;

  subtotal_value := coalesce(
    nullif(payload ->> 'subtotal', '')::numeric,
    nullif(payload ->> 'final_price', '')::numeric,
    case when p_expected_version is null then 0 else existing_order.subtotal end
  );
  discount_value := coalesce(
    nullif(payload ->> 'discount', '')::numeric,
    case when p_expected_version is null then 0 else existing_order.discount end
  );
  shipping_value := coalesce(
    nullif(payload ->> 'shipping', '')::numeric,
    case when p_expected_version is null then 0 else existing_order.shipping end
  );
  total_value := coalesce(
    nullif(payload ->> 'total', '')::numeric,
    nullif(payload ->> 'final_price', '')::numeric,
    case when p_expected_version is null then null else existing_order.total end,
    greatest(subtotal_value - discount_value + shipping_value, 0)
  );

  final_price_value := coalesce(
    nullif(payload ->> 'final_price', '')::numeric,
    nullif(payload ->> 'total', '')::numeric,
    case when p_expected_version is null then total_value else existing_order.final_price end
  );
  total_cost_value := coalesce(
    nullif(payload ->> 'total_cost', '')::numeric,
    case when p_expected_version is null then 0 else existing_order.total_cost end
  );
  modeling_price_value := coalesce(
    nullif(payload ->> 'modeling_price', '')::numeric,
    case when p_expected_version is null then 0 else existing_order.modeling_price end
  );
  finishing_price_value := coalesce(
    nullif(payload ->> 'finishing_price', '')::numeric,
    case when p_expected_version is null then 0 else existing_order.finishing_price end
  );

  if subtotal_value < 0 or discount_value < 0 or shipping_value < 0 or total_value < 0
     or final_price_value < 0 or total_cost_value < 0
     or modeling_price_value < 0 or finishing_price_value < 0 then
    raise exception using errcode = '22023', message = 'negative_order_value';
  end if;

  if payment_value = 'pago' then
    paid_at_value := coalesce(
      nullif(payload ->> 'paid_at', '')::timestamptz,
      existing_order.paid_at,
      now()
    );
  elsif payment_value = 'reembolsado' then
    paid_at_value := coalesce(nullif(payload ->> 'paid_at', '')::timestamptz, existing_order.paid_at);
  else
    paid_at_value := null;
  end if;

  -- Fingerprint canonico dos itens. IDs e timestamps nao participam, pois um
  -- item sem ID recebe UUID no servidor; conteudo, ordem e vinculos participam.
  select coalesce(
    jsonb_agg(normalized.item_value order by normalized.sort_key, normalized.item_value::text),
    '[]'::jsonb
  )
  into expected_items_fingerprint
  from (
    select
      coalesce(nullif(entry.value ->> 'sort_order', '')::integer, entry.ordinality::integer) as sort_key,
      jsonb_build_object(
        'legacy_id', nullif(entry.value ->> 'legacy_id', ''),
        'name', btrim(coalesce(entry.value ->> 'name', entry.value ->> 'description')),
        'quantity', coalesce(nullif(entry.value ->> 'quantity', '')::integer, 1),
        'unit_weight_g', coalesce(
          nullif(entry.value ->> 'unit_weight_g', '')::numeric,
          nullif(entry.value ->> 'grams_per_unit', '')::numeric,
          0
        ),
        'print_hours', coalesce(
          nullif(entry.value ->> 'print_hours', '')::numeric,
          nullif(entry.value ->> 'print_time_minutes', '')::numeric / 60,
          0
        ),
        'material', nullif(entry.value ->> 'material', ''),
        'filament_id', (nullif(entry.value ->> 'filament_id', '')::uuid)::text,
        'filament_price_kg', coalesce(nullif(entry.value ->> 'filament_price_kg', '')::numeric, 0),
        'unit_price', coalesce(nullif(entry.value ->> 'unit_price', '')::numeric, 0),
        'line_total', coalesce(
          nullif(entry.value ->> 'line_total', '')::numeric,
          round(
            coalesce(nullif(entry.value ->> 'unit_price', '')::numeric, 0)
            * coalesce(nullif(entry.value ->> 'quantity', '')::integer, 1),
            2
          )
        ),
        'sort_order', coalesce(nullif(entry.value ->> 'sort_order', '')::integer, entry.ordinality::integer),
        'metadata', coalesce(entry.value -> 'metadata', '{}'::jsonb)
      ) as item_value
    from jsonb_array_elements(p_items) with ordinality as entry(value, ordinality)
  ) normalized;

  if existing_order.id is not null then
    select coalesce(
      jsonb_agg(normalized.item_value order by normalized.sort_key, normalized.item_value::text),
      '[]'::jsonb
    )
    into stored_items_fingerprint
    from (
      select
        oi.sort_order as sort_key,
        jsonb_build_object(
          'legacy_id', oi.legacy_id,
          'name', oi.name,
          'quantity', oi.quantity,
          'unit_weight_g', oi.unit_weight_g,
          'print_hours', oi.print_hours,
          'material', oi.material,
          'filament_id', oi.filament_id::text,
          'filament_price_kg', oi.filament_price_kg,
          'unit_price', oi.unit_price,
          'line_total', oi.line_total,
          'sort_order', oi.sort_order,
          'metadata', oi.metadata
        ) as item_value
      from public.order_items oi
      where oi.order_id = order_id_value and oi.user_id = current_user_id
    ) normalized;

    retry_order_matches :=
      existing_order.legacy_id is not distinct from (
        case
          when payload ? 'legacy_id' then nullif(payload ->> 'legacy_id', '')
          when p_expected_version is null then null
          else existing_order.legacy_id
        end
      )
      and existing_order.order_number is not distinct from (
        case
          when payload ? 'order_number'
               and (p_expected_version is not null or nullif(payload ->> 'order_number', '') is not null)
            then nullif(payload ->> 'order_number', '')
          else existing_order.order_number
        end
      )
      and existing_order.customer_name = (
        case
          when payload ? 'customer_name' then coalesce(nullif(btrim(payload ->> 'customer_name'), ''), 'Cliente')
          when p_expected_version is null then 'Cliente'
          else existing_order.customer_name
        end
      )
      and existing_order.customer_email is not distinct from (
        case when payload ? 'customer_email' then nullif(payload ->> 'customer_email', '')
             when p_expected_version is null then null else existing_order.customer_email end
      )
      and existing_order.customer_phone is not distinct from (
        case when payload ? 'customer_phone' then nullif(payload ->> 'customer_phone', '')
             when p_expected_version is null then null else existing_order.customer_phone end
      )
      and existing_order.project = (
        case
          when payload ? 'project' then coalesce(nullif(btrim(payload ->> 'project'), ''), 'Projeto sem nome')
          when p_expected_version is null then 'Projeto sem nome'
          else existing_order.project
        end
      )
      and existing_order.printer is not distinct from (
        case when payload ? 'printer' then nullif(payload ->> 'printer', '')
             when p_expected_version is null then null else existing_order.printer end
      )
      and existing_order.description is not distinct from (
        case when payload ? 'description' then nullif(payload ->> 'description', '')
             when p_expected_version is null then null else existing_order.description end
      )
      and existing_order.notes is not distinct from (
        case when payload ? 'notes' then nullif(payload ->> 'notes', '')
             when p_expected_version is null then null else existing_order.notes end
      )
      and existing_order.due_date is not distinct from (
        case when payload ? 'due_date' then nullif(payload ->> 'due_date', '')::date
             when p_expected_version is null then null else existing_order.due_date end
      )
      and existing_order.commercial_status = commercial_value
      and existing_order.production_status = 'pendente'
      and existing_order.payment_status = payment_value
      and existing_order.subtotal = subtotal_value
      and existing_order.discount = discount_value
      and existing_order.shipping = shipping_value
      and existing_order.total = total_value
      and existing_order.final_price = final_price_value
      and existing_order.total_cost = total_cost_value
      and existing_order.modeling_price = modeling_price_value
      and existing_order.finishing_price = finishing_price_value
      and existing_order.paid_at is not distinct from paid_at_value
      and existing_order.metadata = (
        case when payload ? 'metadata' then coalesce(payload -> 'metadata', '{}'::jsonb)
             when p_expected_version is null then '{}'::jsonb else existing_order.metadata end
      )
      and existing_order.archived_at is null
      and existing_order.deleted_at is null
      and not (existing_order.stock_consumed_at is not null and existing_order.stock_restored_at is null)
      and (
        p_expected_version is not null
        or not (payload ? 'created_at')
        or nullif(payload ->> 'created_at', '') is null
        or existing_order.created_at = nullif(payload ->> 'created_at', '')::timestamptz
      );

    -- Uma criacao confirmada termina na versao 1; uma edicao confirmada
    -- termina exatamente uma versao acima da informada pelo cliente.
    if (p_expected_version is null and existing_order.version = 1)
       or (p_expected_version is not null and existing_order.version = p_expected_version + 1) then
      if retry_order_matches and stored_items_fingerprint = expected_items_fingerprint then
        select to_jsonb(o) || jsonb_build_object(
          'items', coalesce((select jsonb_agg(to_jsonb(oi) order by oi.sort_order, oi.created_at, oi.id)
            from public.order_items oi
            where oi.order_id = o.id and oi.user_id = current_user_id), '[]'::jsonb)
        ) into result
        from public.orders o
        where o.id = order_id_value and o.user_id = current_user_id;
        return result;
      end if;

      raise exception using errcode = '40001', message = 'retry_payload_conflict';
    end if;

    if p_expected_version is null then
      raise exception using errcode = '40001', message = 'order_id_already_exists';
    end if;
    if existing_order.version <> p_expected_version then
      raise exception 'version_conflict: expected %, actual %', p_expected_version, existing_order.version
        using errcode = '40001';
    end if;
    if existing_order.archived_at is not null then
      raise exception using errcode = '55000', message = 'order_archived';
    end if;
    if existing_order.deleted_at is not null then
      raise exception using errcode = '55000', message = 'order_deleted';
    end if;
    if existing_order.commercial_status = 'cancelado' then
      raise exception using errcode = '55000', message = 'restore_order_before_editing';
    end if;
    if existing_order.production_status <> 'pendente'
       or (existing_order.stock_consumed_at is not null and existing_order.stock_restored_at is null) then
      raise exception using errcode = '55000', message = 'order_locked_after_production_start';
    end if;
  elsif p_expected_version is not null then
    raise exception using errcode = '40001', message = 'order_not_found_for_expected_version';
  end if;

  if existing_order.id is null then
    insert into public.orders (
      id, user_id, legacy_id, order_number, customer_name, customer_email,
      customer_phone, project, printer, description, notes, due_date, commercial_status,
      production_status, payment_status, subtotal, discount, shipping, total,
      final_price, total_cost, modeling_price, finishing_price, paid_at, metadata, created_at
    ) values (
      order_id_value,
      current_user_id,
      nullif(payload ->> 'legacy_id', ''),
      coalesce(
        nullif(payload ->> 'order_number', ''),
        'PED-' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYYMMDD') || '-' ||
          upper(substr(replace(order_id_value::text, '-', ''), 1, 6))
      ),
      coalesce(nullif(btrim(payload ->> 'customer_name'), ''), 'Cliente'),
      nullif(payload ->> 'customer_email', ''),
      nullif(payload ->> 'customer_phone', ''),
      coalesce(nullif(btrim(payload ->> 'project'), ''), 'Projeto sem nome'),
      nullif(payload ->> 'printer', ''),
      nullif(payload ->> 'description', ''),
      nullif(payload ->> 'notes', ''),
      nullif(payload ->> 'due_date', '')::date,
      commercial_value,
      'pendente',
      payment_value,
      subtotal_value,
      discount_value,
      shipping_value,
      total_value,
      final_price_value,
      total_cost_value,
      modeling_price_value,
      finishing_price_value,
      paid_at_value,
      coalesce(payload -> 'metadata', '{}'::jsonb),
      coalesce(nullif(payload ->> 'created_at', '')::timestamptz, now())
    )
    returning * into saved_order;
  else
    update public.orders as o set
      legacy_id = case when payload ? 'legacy_id' then nullif(payload ->> 'legacy_id', '') else o.legacy_id end,
      order_number = case when payload ? 'order_number' then nullif(payload ->> 'order_number', '') else o.order_number end,
      customer_name = case
        when payload ? 'customer_name' then coalesce(nullif(btrim(payload ->> 'customer_name'), ''), 'Cliente')
        else o.customer_name
      end,
      customer_email = case when payload ? 'customer_email' then nullif(payload ->> 'customer_email', '') else o.customer_email end,
      customer_phone = case when payload ? 'customer_phone' then nullif(payload ->> 'customer_phone', '') else o.customer_phone end,
      project = case
        when payload ? 'project' then coalesce(nullif(btrim(payload ->> 'project'), ''), 'Projeto sem nome')
        else o.project
      end,
      printer = case when payload ? 'printer' then nullif(payload ->> 'printer', '') else o.printer end,
      description = case when payload ? 'description' then nullif(payload ->> 'description', '') else o.description end,
      notes = case when payload ? 'notes' then nullif(payload ->> 'notes', '') else o.notes end,
      due_date = case when payload ? 'due_date' then nullif(payload ->> 'due_date', '')::date else o.due_date end,
      commercial_status = commercial_value,
      payment_status = payment_value,
      subtotal = subtotal_value,
      discount = discount_value,
      shipping = shipping_value,
      total = total_value,
      final_price = final_price_value,
      total_cost = total_cost_value,
      modeling_price = modeling_price_value,
      finishing_price = finishing_price_value,
      paid_at = paid_at_value,
      metadata = case when payload ? 'metadata' then coalesce(payload -> 'metadata', '{}'::jsonb) else o.metadata end
    where o.id = order_id_value and o.user_id = current_user_id
    returning * into saved_order;
  end if;

  delete from public.order_items oi
  where oi.order_id = order_id_value and oi.user_id = current_user_id;

  for item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(item) <> 'object' then
      raise exception using errcode = '22023', message = 'each_item_must_be_an_object';
    end if;

    item_id_value := coalesce(nullif(item ->> 'id', '')::uuid, gen_random_uuid());
    filament_id_value := nullif(item ->> 'filament_id', '')::uuid;
    quantity_value := coalesce(nullif(item ->> 'quantity', '')::integer, 1);
    grams_value := coalesce(
      nullif(item ->> 'unit_weight_g', '')::numeric,
      nullif(item ->> 'grams_per_unit', '')::numeric,
      0
    );
    print_hours_value := coalesce(
      nullif(item ->> 'print_hours', '')::numeric,
      nullif(item ->> 'print_time_minutes', '')::numeric / 60,
      0
    );
    unit_price_value := coalesce(nullif(item ->> 'unit_price', '')::numeric, 0);
    line_total_value := coalesce(
      nullif(item ->> 'line_total', '')::numeric,
      round(unit_price_value * quantity_value, 2)
    );
    sort_value := sort_value + 1;

    if coalesce(nullif(btrim(coalesce(item ->> 'name', item ->> 'description')), ''), '') = '' then
      raise exception using errcode = '22023', message = 'item_description_required';
    end if;
    if quantity_value <= 0 or grams_value < 0 or print_hours_value < 0
       or unit_price_value < 0 or line_total_value < 0 then
      raise exception using errcode = '22023', message = 'invalid_item_values';
    end if;
    if grams_value > 0 and filament_id_value is null then
      raise exception using errcode = '22023', message = 'filament_required_for_weighted_item';
    end if;

    insert into public.order_items (
      id, user_id, order_id, filament_id, legacy_id, name, quantity,
      unit_weight_g, print_hours, material, filament_price_kg,
      unit_price, line_total, sort_order, metadata
    ) values (
      item_id_value,
      current_user_id,
      order_id_value,
      filament_id_value,
      nullif(item ->> 'legacy_id', ''),
      btrim(coalesce(item ->> 'name', item ->> 'description')),
      quantity_value,
      grams_value,
      print_hours_value,
      nullif(item ->> 'material', ''),
      coalesce(nullif(item ->> 'filament_price_kg', '')::numeric, 0),
      unit_price_value,
      line_total_value,
      coalesce(nullif(item ->> 'sort_order', '')::integer, sort_value),
      coalesce(item -> 'metadata', '{}'::jsonb)
    );
  end loop;

  select to_jsonb(o) || jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(to_jsonb(oi) order by oi.sort_order, oi.created_at, oi.id)
      from public.order_items oi
      where oi.order_id = o.id and oi.user_id = current_user_id
    ), '[]'::jsonb)
  ) into result
  from public.orders o
  where o.id = order_id_value and o.user_id = current_user_id;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: inicia producao e baixa o estoque uma unica vez por ciclo
-- ---------------------------------------------------------------------------

create or replace function public.start_order_production(
  p_order_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  target_order_id uuid := p_order_id;
  current_order public.orders%rowtype;
  consumption record;
  available_grams numeric(14,3);
  balance_grams numeric(14,3);
  next_cycle integer;
  result jsonb;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select o.* into current_order
  from public.orders o
  where o.id = target_order_id and o.user_id = current_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'order_not_found';
  end if;

  -- Segunda chamada (inclusive concorrente) apenas devolve o estado ja aplicado.
  if current_order.stock_consumed_at is not null
     and current_order.stock_restored_at is null
     and current_order.production_status in ('em_producao', 'pronto', 'enviado', 'entregue') then
    select to_jsonb(o) || jsonb_build_object(
      'items', coalesce((select jsonb_agg(to_jsonb(oi) order by oi.sort_order, oi.id)
        from public.order_items oi where oi.order_id = o.id and oi.user_id = current_user_id), '[]'::jsonb)
    ) into result from public.orders o where o.id = target_order_id;
    return result;
  end if;

  if p_expected_version is null then
    raise exception using errcode = '22023', message = 'version_required';
  end if;
  if current_order.version <> p_expected_version then
    raise exception 'version_conflict: expected %, actual %', p_expected_version, current_order.version
      using errcode = '40001';
  end if;
  if current_order.archived_at is not null then
    raise exception using errcode = '55000', message = 'order_archived';
  end if;
  if current_order.commercial_status <> 'aprovado' then
    raise exception using errcode = '55000', message = 'order_must_be_approved';
  end if;

  -- Repara com seguranca um registro migrado que ja possui consumo ativo, mas
  -- ainda esta marcado como pendente. Nunca efetua uma segunda baixa.
  if current_order.stock_consumed_at is not null
     and current_order.stock_restored_at is null
     and current_order.production_status = 'pendente' then
    perform set_config('app.precificador_order_rpc', 'on', true);
    update public.orders o set production_status = 'em_producao'
    where o.id = target_order_id and o.user_id = current_user_id;

    select to_jsonb(o) || jsonb_build_object(
      'items', coalesce((select jsonb_agg(to_jsonb(oi) order by oi.sort_order, oi.id)
        from public.order_items oi where oi.order_id = o.id and oi.user_id = current_user_id), '[]'::jsonb)
    ) into result from public.orders o where o.id = target_order_id;
    return result;
  end if;

  if current_order.production_status <> 'pendente' then
    raise exception using errcode = '55000', message = 'invalid_production_transition';
  end if;

  if exists (
    select 1 from public.order_items oi
    where oi.order_id = target_order_id and oi.user_id = current_user_id
      and oi.unit_weight_g > 0 and oi.filament_id is null
  ) then
    raise exception using errcode = '22023', message = 'filament_required_for_weighted_item';
  end if;

  next_cycle := current_order.stock_cycle + 1;

  -- A ordem pelo UUID evita deadlock quando dois pedidos usam os mesmos rolos.
  perform f.id
  from public.filaments f
  join (
    select oi.filament_id, sum(oi.unit_weight_g * oi.quantity)::numeric(14,3) as grams
    from public.order_items oi
    where oi.order_id = target_order_id and oi.user_id = current_user_id
      and oi.filament_id is not null and oi.unit_weight_g > 0
    group by oi.filament_id
  ) totals on totals.filament_id = f.id
  where f.user_id = current_user_id
  order by f.id
  for update of f;

  for consumption in
    select oi.filament_id,
           sum(oi.unit_weight_g * oi.quantity)::numeric(14,3) as grams
    from public.order_items oi
    where oi.order_id = target_order_id and oi.user_id = current_user_id
      and oi.filament_id is not null and oi.unit_weight_g > 0
    group by oi.filament_id
    order by oi.filament_id
  loop
    select f.current_weight_g into available_grams
    from public.filaments f
    where f.id = consumption.filament_id
      and f.user_id = current_user_id
      and f.active
      and f.archived_at is null
      and f.deleted_at is null;

    if not found then
      raise exception 'filament_unavailable: %', consumption.filament_id using errcode = '55000';
    end if;
    if available_grams < consumption.grams then
      raise exception 'insufficient_stock: filament %, available %, required %',
        consumption.filament_id, available_grams, consumption.grams
        using errcode = '22003';
    end if;
  end loop;

  perform set_config('app.precificador_stock_rpc', 'on', true);
  for consumption in
    select oi.filament_id,
           sum(oi.unit_weight_g * oi.quantity)::numeric(14,3) as grams
    from public.order_items oi
    where oi.order_id = target_order_id and oi.user_id = current_user_id
      and oi.filament_id is not null and oi.unit_weight_g > 0
    group by oi.filament_id
    order by oi.filament_id
  loop
    update public.filaments f
    set current_weight_g = f.current_weight_g - consumption.grams
    where f.id = consumption.filament_id and f.user_id = current_user_id
    returning f.current_weight_g into balance_grams;

    insert into public.stock_movements (
      user_id, filament_id, order_id, movement_type, quantity_g,
      balance_after_g, stock_cycle, idempotency_key, reason
    ) values (
      current_user_id,
      consumption.filament_id,
      target_order_id,
      'consumption',
      -consumption.grams,
      balance_grams,
      next_cycle,
      'consume:' || target_order_id::text || ':' || next_cycle::text || ':' || consumption.filament_id::text,
      'Inicio da producao'
    );
  end loop;

  perform set_config('app.precificador_order_rpc', 'on', true);
  update public.orders o set
    production_status = 'em_producao',
    stock_cycle = next_cycle,
    stock_consumed_at = now(),
    stock_restored_at = null
  where o.id = target_order_id and o.user_id = current_user_id;

  select to_jsonb(o) || jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(oi) order by oi.sort_order, oi.id)
      from public.order_items oi where oi.order_id = o.id and oi.user_id = current_user_id), '[]'::jsonb)
  ) into result from public.orders o where o.id = target_order_id;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: cancela antes da entrega e devolve exatamente o que foi consumido
-- ---------------------------------------------------------------------------

create or replace function public.cancel_order(
  p_order_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  target_order_id uuid := p_order_id;
  current_order public.orders%rowtype;
  restoration record;
  balance_grams numeric(14,3);
  should_restore boolean;
  result jsonb;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select o.* into current_order
  from public.orders o
  where o.id = target_order_id and o.user_id = current_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'order_not_found';
  end if;

  if current_order.commercial_status = 'cancelado' then
    select to_jsonb(o) || jsonb_build_object(
      'items', coalesce((select jsonb_agg(to_jsonb(oi) order by oi.sort_order, oi.id)
        from public.order_items oi where oi.order_id = o.id and oi.user_id = current_user_id), '[]'::jsonb)
    ) into result from public.orders o where o.id = target_order_id;
    return result;
  end if;

  if p_expected_version is null then
    raise exception using errcode = '22023', message = 'version_required';
  end if;
  if current_order.version <> p_expected_version then
    raise exception 'version_conflict: expected %, actual %', p_expected_version, current_order.version
      using errcode = '40001';
  end if;
  if current_order.archived_at is not null then
    raise exception using errcode = '55000', message = 'order_archived';
  end if;
  if current_order.production_status = 'entregue' then
    raise exception using errcode = '55000', message = 'delivered_order_cannot_be_cancelled';
  end if;

  should_restore := current_order.stock_consumed_at is not null
                    and current_order.stock_restored_at is null;

  if should_restore then
    perform set_config('app.precificador_stock_rpc', 'on', true);
    -- Usa o ledger do ciclo. Para registros migrados sem ledger, usa os itens como fallback.
    for restoration in
      with movement_totals as (
        select sm.filament_id, sum(-sm.quantity_g)::numeric(14,3) as grams
        from public.stock_movements sm
        where sm.order_id = target_order_id
          and sm.user_id = current_user_id
          and sm.stock_cycle = current_order.stock_cycle
          and sm.movement_type = 'consumption'
          and sm.quantity_g < 0
        group by sm.filament_id
      ),
      fallback_totals as (
        select oi.filament_id,
               sum(oi.unit_weight_g * oi.quantity)::numeric(14,3) as grams
        from public.order_items oi
        where oi.order_id = target_order_id and oi.user_id = current_user_id
          and oi.filament_id is not null and oi.unit_weight_g > 0
        group by oi.filament_id
      ),
      restore_totals as (
        select mt.filament_id, mt.grams from movement_totals mt
        union all
        select ft.filament_id, ft.grams from fallback_totals ft
        where not exists (select 1 from movement_totals)
      )
      select rt.filament_id, rt.grams
      from restore_totals rt
      where rt.grams > 0
      order by rt.filament_id
    loop
      select f.current_weight_g into balance_grams
      from public.filaments f
      where f.id = restoration.filament_id and f.user_id = current_user_id
      for update;

      if not found then
        raise exception 'filament_not_found_for_restore: %', restoration.filament_id
          using errcode = 'P0002';
      end if;

      update public.filaments f
      set current_weight_g = f.current_weight_g + restoration.grams
      where f.id = restoration.filament_id and f.user_id = current_user_id
      returning f.current_weight_g into balance_grams;

      insert into public.stock_movements (
        user_id, filament_id, order_id, movement_type, quantity_g,
        balance_after_g, stock_cycle, idempotency_key, reason
      ) values (
        current_user_id,
        restoration.filament_id,
        target_order_id,
        'return',
        restoration.grams,
        balance_grams,
        current_order.stock_cycle,
        'restore:' || target_order_id::text || ':' || current_order.stock_cycle::text || ':' || restoration.filament_id::text,
        'Cancelamento do pedido'
      )
      on conflict (user_id, idempotency_key) do nothing;
    end loop;
  end if;

  perform set_config('app.precificador_order_rpc', 'on', true);
  update public.orders o set
    cancelled_from_status = case
      when o.commercial_status in ('orcamento', 'aprovado') then o.commercial_status
      else coalesce(o.cancelled_from_status, 'aprovado')
    end,
    commercial_status = 'cancelado',
    production_status = 'pendente',
    stock_restored_at = case when should_restore then now() else o.stock_restored_at end
  where o.id = target_order_id and o.user_id = current_user_id;

  select to_jsonb(o) || jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(oi) order by oi.sort_order, oi.id)
      from public.order_items oi where oi.order_id = o.id and oi.user_id = current_user_id), '[]'::jsonb)
  ) into result from public.orders o where o.id = target_order_id;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: arquivamento seguro e restauracao/reabertura
-- ---------------------------------------------------------------------------

create or replace function public.archive_order(
  p_order_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  target_order_id uuid := p_order_id;
  current_order public.orders%rowtype;
  result jsonb;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select o.* into current_order
  from public.orders o
  where o.id = target_order_id and o.user_id = current_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'order_not_found';
  end if;
  if current_order.archived_at is not null then
    return to_jsonb(current_order);
  end if;
  if p_expected_version is null then
    raise exception using errcode = '22023', message = 'version_required';
  end if;
  if current_order.version <> p_expected_version then
    raise exception 'version_conflict: expected %, actual %', p_expected_version, current_order.version
      using errcode = '40001';
  end if;
  if current_order.stock_consumed_at is not null and current_order.stock_restored_at is null then
    raise exception using errcode = '55000', message = 'cancel_active_order_before_archiving';
  end if;
  if current_order.commercial_status not in ('orcamento', 'cancelado') then
    raise exception using errcode = '55000', message = 'cancel_active_order_before_archiving';
  end if;

  perform set_config('app.precificador_order_rpc', 'on', true);
  update public.orders o set archived_at = now()
  where o.id = target_order_id and o.user_id = current_user_id;

  select to_jsonb(o) || jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(oi) order by oi.sort_order, oi.id)
      from public.order_items oi where oi.order_id = o.id and oi.user_id = current_user_id), '[]'::jsonb)
  ) into result from public.orders o where o.id = target_order_id;
  return result;
end;
$$;

create or replace function public.restore_order(
  p_order_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  target_order_id uuid := p_order_id;
  current_order public.orders%rowtype;
  result jsonb;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select o.* into current_order
  from public.orders o
  where o.id = target_order_id and o.user_id = current_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'order_not_found';
  end if;
  if current_order.archived_at is null then
    return to_jsonb(current_order);
  end if;
  if p_expected_version is null then
    raise exception using errcode = '22023', message = 'version_required';
  end if;
  if current_order.version <> p_expected_version then
    raise exception 'version_conflict: expected %, actual %', p_expected_version, current_order.version
      using errcode = '40001';
  end if;
  perform set_config('app.precificador_order_rpc', 'on', true);
  update public.orders o set
    archived_at = null
  where o.id = target_order_id and o.user_id = current_user_id;

  select to_jsonb(o) || jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(oi) order by oi.sort_order, oi.id)
      from public.order_items oi where oi.order_id = o.id and oi.user_id = current_user_id), '[]'::jsonb)
  ) into result from public.orders o where o.id = target_order_id;
  return result;
end;
$$;

-- Reabre um pedido cancelado para um novo ciclo. O estoque continua intacto ate
-- start_order_production ser chamado novamente.
create or replace function public.reopen_order(
  p_order_id uuid,
  p_expected_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_user_id uuid := auth.uid();
  current_order public.orders%rowtype;
  result jsonb;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'authentication_required';
  end if;

  select o.* into current_order
  from public.orders o
  where o.id = p_order_id and o.user_id = current_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'order_not_found';
  end if;

  -- Torna a repeticao da mesma acao segura em dois dispositivos.
  if current_order.commercial_status in ('orcamento', 'aprovado')
     and current_order.cancelled_from_status is null
     and current_order.archived_at is null then
    select to_jsonb(o) || jsonb_build_object(
      'items', coalesce((select jsonb_agg(to_jsonb(oi) order by oi.sort_order, oi.id)
        from public.order_items oi where oi.order_id = o.id and oi.user_id = current_user_id), '[]'::jsonb)
    ) into result from public.orders o where o.id = p_order_id;
    return result;
  end if;

  if p_expected_version is null then
    raise exception using errcode = '22023', message = 'version_required';
  end if;
  if current_order.version <> p_expected_version then
    raise exception 'version_conflict: expected %, actual %', p_expected_version, current_order.version
      using errcode = '40001';
  end if;
  if current_order.commercial_status <> 'cancelado' then
    raise exception using errcode = '55000', message = 'only_cancelled_order_can_be_reopened';
  end if;
  if current_order.production_status = 'entregue' then
    raise exception using errcode = '55000', message = 'delivered_order_cannot_be_reopened';
  end if;
  if current_order.stock_consumed_at is not null and current_order.stock_restored_at is null then
    raise exception using errcode = '55000', message = 'stock_must_be_restored_before_reopening';
  end if;

  perform set_config('app.precificador_order_rpc', 'on', true);
  update public.orders o set
    archived_at = null,
    commercial_status = coalesce(o.cancelled_from_status, 'orcamento'),
    cancelled_from_status = null,
    production_status = 'pendente'
  where o.id = p_order_id and o.user_id = current_user_id;

  select to_jsonb(o) || jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(oi) order by oi.sort_order, oi.id)
      from public.order_items oi where oi.order_id = o.id and oi.user_id = current_user_id), '[]'::jsonb)
  ) into result from public.orders o where o.id = p_order_id;
  return result;
end;
$$;

revoke all on function public.save_filament(jsonb, bigint) from public, anon;
revoke all on function public.save_order(jsonb, jsonb, bigint) from public, anon;
revoke all on function public.start_order_production(uuid, bigint) from public, anon;
revoke all on function public.cancel_order(uuid, bigint) from public, anon;
revoke all on function public.archive_order(uuid, bigint) from public, anon;
revoke all on function public.restore_order(uuid, bigint) from public, anon;
revoke all on function public.reopen_order(uuid, bigint) from public, anon;
grant execute on function public.save_filament(jsonb, bigint) to authenticated;
grant execute on function public.save_order(jsonb, jsonb, bigint) to authenticated;
grant execute on function public.start_order_production(uuid, bigint) to authenticated;
grant execute on function public.cancel_order(uuid, bigint) to authenticated;
grant execute on function public.archive_order(uuid, bigint) to authenticated;
grant execute on function public.restore_order(uuid, bigint) to authenticated;
grant execute on function public.reopen_order(uuid, bigint) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage privado: caminho obrigatorio user_id/...
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-assets',
  'order-assets',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']::text[]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists order_assets_select_own on storage.objects;
create policy order_assets_select_own
on storage.objects for select to authenticated
using (
  bucket_id = 'order-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists order_assets_insert_own on storage.objects;
create policy order_assets_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'order-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists order_assets_update_own on storage.objects;
create policy order_assets_update_own
on storage.objects for update to authenticated
using (
  bucket_id = 'order-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'order-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

drop policy if exists order_assets_delete_own on storage.objects;
create policy order_assets_delete_own
on storage.objects for delete to authenticated
using (
  bucket_id = 'order-assets'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

-- ---------------------------------------------------------------------------
-- Realtime por registro
-- ---------------------------------------------------------------------------

do $$
declare
  table_name text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    execute 'create publication supabase_realtime';
  end if;

  foreach table_name in array array[
    'profiles', 'settings', 'filaments', 'orders', 'order_items',
    'stock_movements', 'expenses', 'recurring_expenses', 'catalog_products',
    'calibrations', 'tasks', 'attachments'
  ] loop
    execute format('alter table public.%I replica identity full', table_name);
    if not exists (
      select 1
      from pg_publication_tables p
      where p.pubname = 'supabase_realtime'
        and p.schemaname = 'public'
        and p.tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end;
$$;

commit;
