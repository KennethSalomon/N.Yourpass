-- =====================================================
--  YOURPASS BÉNIN — Schéma Supabase Complet v2.0
--  À exécuter dans l'éditeur SQL de Supabase
-- =====================================================

-- Extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ============================================================
-- 1. PROFILES (étend auth.users de Supabase)
-- ============================================================
create table if not exists public.profiles (
  id            uuid references auth.users(id) on delete cascade primary key,
  email         text unique not null,
  first_name    text,
  last_name     text,
  phone         text,
  account_type  text default 'user'
                  check (account_type in ('user', 'organizer', 'admin')),
  avatar_url    text,
  is_verified   boolean default false,
  is_active     boolean default true,
  metadata      jsonb default '{}',
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- RLS
alter table public.profiles enable row level security;

create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Admins voient tout
create policy "profiles_admin_all"
  on public.profiles for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.account_type = 'admin'
    )
  );

-- Auto-créer le profil à l'inscription
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  insert into public.profiles (id, email, first_name, last_name, account_type, phone)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'first_name',
    new.raw_user_meta_data->>'last_name',
    coalesce(new.raw_user_meta_data->>'account_type', 'user'),
    new.raw_user_meta_data->>'phone'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 2. EVENTS
-- ============================================================
create table if not exists public.events (
  id                    uuid default uuid_generate_v4() primary key,
  organizer_id          uuid references public.profiles(id) on delete cascade not null,
  title                 text not null,
  slug                  text unique,
  description           text,
  category              text check (category in (
                          'music','culture','business','sport',
                          'comedy','spirituality','other'
                        )),
  venue                 text not null,
  location              text not null default 'Cotonou, Bénin',
  event_date            timestamptz not null,
  end_date              timestamptz,
  cover_image           text,
  capacity              integer default 0,
  status                text default 'draft'
                          check (status in ('draft','published','cancelled','completed')),
  is_free               boolean default false,
  allow_resale          boolean default true,
  serenite_option       boolean default false,
  serenite_price        integer default 500,
  refund_deadline_hours integer default 48,
  tags                  text[],
  created_at            timestamptz default now(),
  updated_at            timestamptz default now()
);

alter table public.events enable row level security;

create policy "events_public_select"
  on public.events for select
  using (status = 'published');

create policy "events_organizer_all"
  on public.events for all
  using (auth.uid() = organizer_id);

-- ============================================================
-- 3. TICKET TYPES (catégories de billets par événement)
-- ============================================================
create table if not exists public.ticket_types (
  id              uuid default uuid_generate_v4() primary key,
  event_id        uuid references public.events(id) on delete cascade not null,
  name            text not null,          -- "Standard", "VIP", "Carré Or"
  description     text,
  price           integer not null default 0,
  quantity        integer not null,
  quantity_sold   integer default 0,
  max_per_order   integer default 10,
  sale_start      timestamptz,
  sale_end        timestamptz,
  is_active       boolean default true,
  sort_order      integer default 0,
  created_at      timestamptz default now()
);

alter table public.ticket_types enable row level security;

create policy "ticket_types_public_select"
  on public.ticket_types for select using (true);

create policy "ticket_types_organizer_all"
  on public.ticket_types for all
  using (
    exists (
      select 1 from public.events e
      where e.id = event_id and e.organizer_id = auth.uid()
    )
  );

-- ============================================================
-- 4. ORDERS (commandes / paiements)
-- ============================================================
create table if not exists public.orders (
  id                      uuid default uuid_generate_v4() primary key,
  user_id                 uuid references public.profiles(id) on delete set null,
  event_id                uuid references public.events(id) on delete set null,
  ticket_type_id          uuid references public.ticket_types(id) on delete set null,
  fedapay_transaction_id  text unique,
  quantity                integer not null default 1,
  unit_price              integer not null,
  service_fee             integer default 0,
  serenite_fee            integer default 0,
  discount                integer default 0,
  total_amount            integer not null,
  currency                text default 'XOF',
  status                  text default 'pending'
                            check (status in (
                              'pending','paid','cancelled',
                              'refunded','failed','expired'
                            )),
  payment_method          text,
  customer_name           text not null,
  customer_email          text not null,
  customer_phone          text,
  metadata                jsonb default '{}',
  paid_at                 timestamptz,
  cancelled_at            timestamptz,
  refunded_at             timestamptz,
  expires_at              timestamptz default (now() + interval '30 minutes'),
  created_at              timestamptz default now(),
  updated_at              timestamptz default now()
);

alter table public.orders enable row level security;

create policy "orders_select_own"
  on public.orders for select
  using (auth.uid() = user_id);

-- Service role gère tout (pas de RLS pour le backend)
-- Le backend utilise la SERVICE_ROLE_KEY qui bypass RLS

-- ============================================================
-- 5. TICKETS (billets individuels générés après paiement)
-- ============================================================
create table if not exists public.tickets (
  id                uuid default uuid_generate_v4() primary key,
  order_id          uuid references public.orders(id) on delete cascade,
  event_id          uuid references public.events(id) on delete set null,
  ticket_type_id    uuid references public.ticket_types(id) on delete set null,
  user_id           uuid references public.profiles(id) on delete set null,
  ticket_ref        text unique not null,
  payment_id        text,
  qr_data           text unique not null,
  qr_hash           text,                  -- hash SHA256 du qr_data pour vérification rapide
  holder_name       text not null,
  holder_email      text not null,
  ticket_type       text not null,         -- copie du nom du type
  amount            integer not null,
  status            text default 'valid'
                      check (status in (
                        'valid','used','cancelled',
                        'refunded','transferred','expired'
                      )),
  is_for_resale     boolean default false,
  resale_price      integer,
  serenite_enabled  boolean default false,
  refund_deadline   timestamptz,
  used_at           timestamptz,
  scanned_by        text,
  ticket_number     integer default 1,     -- numéro dans la commande (1/3, 2/3…)
  total_in_order    integer default 1,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

alter table public.tickets enable row level security;

create policy "tickets_select_own"
  on public.tickets for select
  using (auth.uid() = user_id);

-- ============================================================
-- 6. RESALES — Bourse aux billets
-- ============================================================
create table if not exists public.resales (
  id              uuid default uuid_generate_v4() primary key,
  ticket_id       uuid references public.tickets(id) on delete cascade unique,
  seller_id       uuid references public.profiles(id) on delete cascade,
  event_id        uuid references public.events(id) on delete cascade,
  listed_price    integer not null,
  original_price  integer not null,
  status          text default 'listed'
                    check (status in ('listed','sold','cancelled')),
  buyer_id        uuid references public.profiles(id),
  buyer_email     text,
  sold_at         timestamptz,
  created_at      timestamptz default now()
);

alter table public.resales enable row level security;

create policy "resales_public_select"
  on public.resales for select
  using (status = 'listed');

create policy "resales_seller_manage"
  on public.resales for all
  using (auth.uid() = seller_id);

-- ============================================================
-- 7. SCAN LOGS — Journal du contrôle d'accès
-- ============================================================
create table if not exists public.scan_logs (
  id           uuid default uuid_generate_v4() primary key,
  ticket_id    uuid references public.tickets(id) on delete set null,
  ticket_ref   text,
  event_id     uuid references public.events(id) on delete set null,
  scanned_at   timestamptz default now(),
  scanned_by   text,
  result       text check (result in ('valid','already_used','invalid','cancelled','wrong_event')),
  device_info  text,
  location     text,
  notes        text
);

-- Pas de RLS sur les logs (lecture réservée aux organisateurs via backend)

-- ============================================================
-- 8. PROMO CODES
-- ============================================================
create table if not exists public.promo_codes (
  id              uuid default uuid_generate_v4() primary key,
  event_id        uuid references public.events(id) on delete cascade,
  code            text unique not null,
  discount_type   text check (discount_type in ('percent','fixed')) default 'percent',
  discount_value  integer not null,
  max_uses        integer,
  current_uses    integer default 0,
  valid_from      timestamptz default now(),
  valid_until     timestamptz,
  is_active       boolean default true,
  created_at      timestamptz default now()
);

alter table public.promo_codes enable row level security;

create policy "promo_public_select"
  on public.promo_codes for select
  using (is_active = true and (valid_until is null or valid_until > now()));

-- ============================================================
-- 9. INDEXES (performances)
-- ============================================================
create index if not exists idx_tickets_ref       on public.tickets(ticket_ref);
create index if not exists idx_tickets_qr        on public.tickets(qr_data);
create index if not exists idx_tickets_user      on public.tickets(user_id);
create index if not exists idx_tickets_event     on public.tickets(event_id);
create index if not exists idx_tickets_payment   on public.tickets(payment_id);
create index if not exists idx_tickets_status    on public.tickets(status);
create index if not exists idx_orders_fedapay    on public.orders(fedapay_transaction_id);
create index if not exists idx_orders_user       on public.orders(user_id);
create index if not exists idx_orders_status     on public.orders(status);
create index if not exists idx_events_status     on public.events(status);
create index if not exists idx_events_date       on public.events(event_date);
create index if not exists idx_events_organizer  on public.events(organizer_id);
create index if not exists idx_resales_event     on public.resales(event_id);
create index if not exists idx_scan_logs_ticket  on public.scan_logs(ticket_ref);

-- ============================================================
-- 10. TRIGGERS auto-updated_at
-- ============================================================
create or replace function update_updated_at_column()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function update_updated_at_column();
create trigger events_updated_at before update on public.events
  for each row execute function update_updated_at_column();
create trigger orders_updated_at before update on public.orders
  for each row execute function update_updated_at_column();
create trigger tickets_updated_at before update on public.tickets
  for each row execute function update_updated_at_column();

-- ============================================================
-- 11. FONCTIONS UTILITAIRES
-- ============================================================

-- Incrémenter tickets vendus
create or replace function increment_tickets_sold(type_id uuid, qty integer)
returns void language plpgsql security definer as $$
begin
  update public.ticket_types
  set quantity_sold = quantity_sold + qty
  where id = type_id;
end;
$$;

-- Vérifier la disponibilité
create or replace function check_ticket_availability(type_id uuid, requested_qty integer)
returns boolean language plpgsql as $$
declare
  available integer;
begin
  select (quantity - quantity_sold) into available
  from public.ticket_types
  where id = type_id and is_active = true;
  return coalesce(available, 0) >= requested_qty;
end;
$$;

-- Stats organisateur
create or replace function get_organizer_stats(org_id uuid)
returns json language plpgsql security definer as $$
declare
  result json;
begin
  select json_build_object(
    'total_tickets', coalesce(sum(o.quantity), 0),
    'total_revenue', coalesce(sum(o.total_amount), 0),
    'total_events',  count(distinct e.id),
    'refund_rate',   round(
      100.0 * count(case when o.status = 'refunded' then 1 end) /
      nullif(count(case when o.status in ('paid','refunded') then 1 end), 0),
    1)
  ) into result
  from public.events e
  left join public.orders o on o.event_id = e.id and o.status in ('paid','refunded')
  where e.organizer_id = org_id;
  return result;
end;
$$;

-- Expirer les commandes pending trop vieilles (appeler via cron)
create or replace function expire_stale_orders()
returns integer language plpgsql security definer as $$
declare
  expired_count integer;
begin
  update public.orders
  set status = 'expired', updated_at = now()
  where status = 'pending' and expires_at < now();
  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;

-- ============================================================
-- 12. VUES PRATIQUES
-- ============================================================

create or replace view public.v_active_events as
select
  e.*,
  p.first_name || ' ' || p.last_name as organizer_name,
  coalesce(sum(tt.quantity) - sum(tt.quantity_sold), 0) as available_seats,
  count(distinct tt.id) as ticket_type_count,
  min(tt.price) as min_price,
  max(tt.price) as max_price
from public.events e
join public.profiles p on p.id = e.organizer_id
left join public.ticket_types tt on tt.event_id = e.id and tt.is_active = true
where e.status = 'published' and e.event_date > now()
group by e.id, p.first_name, p.last_name;

-- ============================================================
-- 13. DONNÉES DE DÉMO (supprimer en production)
-- ============================================================

-- Insérer un événement démo si besoin (optionnel)
-- insert into public.events (organizer_id, title, description, category, venue, location, event_date, capacity, status)
-- values (
--   '<UUID_ORGANISATEUR>',
--   'Cotonou Sound Festival',
--   'Le grand festival de musique africaine',
--   'music',
--   'Stade de l''Amitié',
--   'Cotonou, Bénin',
--   '2025-03-15 20:00:00+01',
--   4000,
--   'published'
-- );