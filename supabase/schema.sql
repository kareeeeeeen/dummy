-- ============================================================
-- TaniSPPG — Supabase Schema v2 (Postgres + PostGIS)
-- Run the WHOLE file in Supabase SQL Editor.
-- v2 adds: wa_inbound_log (declines/unclear visible in dashboard)
-- ============================================================

create extension if not exists postgis;

create table sppg (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kecamatan   text not null,
  location    geography(point, 4326) not null,
  wa_number   text,
  created_at  timestamptz default now()
);

create table commodities (
  id      serial primary key,
  name    text unique not null,
  unit    text not null default 'kg',
  aliases text[] default '{}'
);

create table farmers (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  wa_number         text unique not null,
  gapoktan          text,
  location          geography(point, 4326) not null,
  kecamatan         text,
  reliability_score numeric(3,2) default 0.70 check (reliability_score between 0 and 1),
  verified_by       text,
  created_at        timestamptz default now()
);

create table farmer_commodities (
  farmer_id     uuid references farmers(id) on delete cascade,
  commodity_id  int references commodities(id) on delete cascade,
  est_capacity_kg_per_week numeric,
  primary key (farmer_id, commodity_id)
);

create table demands (
  id          uuid primary key default gen_random_uuid(),
  sppg_id     uuid references sppg(id) not null,
  week_start  date not null,
  status      text not null default 'open'
              check (status in ('open','matching','confirmed','fulfilled','cancelled')),
  created_at  timestamptz default now()
);

create table demand_items (
  id            uuid primary key default gen_random_uuid(),
  demand_id     uuid references demands(id) on delete cascade,
  commodity_id  int references commodities(id) not null,
  qty_kg        numeric not null check (qty_kg > 0),
  max_price_per_kg numeric,
  status        text not null default 'open'
                check (status in ('open','partially_filled','filled'))
);

create table applications (
  id              uuid primary key default gen_random_uuid(),
  demand_item_id  uuid references demand_items(id) on delete cascade,
  farmer_id       uuid references farmers(id) not null,
  offered_qty_kg  numeric not null check (offered_qty_kg > 0),
  price_per_kg    numeric not null check (price_per_kg > 0),
  raw_message     text,
  parse_confidence numeric(3,2),
  status          text not null default 'pending'
                  check (status in ('pending','accepted','rejected')),
  created_at      timestamptz default now(),
  unique (demand_item_id, farmer_id)
);

create table matches (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid references applications(id) unique not null,
  confirmed_at    timestamptz default now(),
  delivered       boolean,
  delivered_at    timestamptz
);

create table wa_outbound_log (
  id             bigserial primary key,
  farmer_id      uuid references farmers(id),
  demand_item_id uuid references demand_items(id),
  message        text,
  provider_id    text,
  sent_at        timestamptz default now()
);

-- v2: EVERY inbound reply logged here, including declines and unclear —
-- the dashboard shows these to prove the parser handles messy input.
create table wa_inbound_log (
  id             bigserial primary key,
  farmer_id      uuid references farmers(id),
  demand_item_id uuid references demand_items(id),
  raw_message    text,
  intent         text check (intent in ('offer','decline','question','unclear')),
  confidence     numeric(3,2),
  received_at    timestamptz default now()
);

create index idx_farmers_location on farmers using gist (location);
create index idx_applications_item on applications (demand_item_id, status);
create index idx_inbound_item on wa_inbound_log (demand_item_id);

-- Weighted ranking view: distance 40% + price 35% + reliability 25%
create or replace view ranked_applications as
with base as (
  select
    a.id as application_id, a.demand_item_id, a.farmer_id,
    f.name as farmer_name, f.wa_number, f.gapoktan, f.kecamatan,
    f.reliability_score, a.offered_qty_kg, a.price_per_kg,
    a.raw_message, a.status,
    st_distance(f.location, s.location) / 1000.0 as distance_km
  from applications a
  join farmers f       on f.id = a.farmer_id
  join demand_items di on di.id = a.demand_item_id
  join demands d       on d.id = di.demand_id
  join sppg s          on s.id = d.sppg_id
),
bounds as (
  select demand_item_id,
    max(distance_km) as max_dist, min(distance_km) as min_dist,
    max(price_per_kg) as max_price, min(price_per_kg) as min_price
  from base group by demand_item_id
)
select b.*,
  round((
      0.40 * (1 - coalesce((b.distance_km  - bo.min_dist ) / nullif(bo.max_dist  - bo.min_dist , 0), 0))
    + 0.35 * (1 - coalesce((b.price_per_kg - bo.min_price) / nullif(bo.max_price - bo.min_price, 0), 0))
    + 0.25 * b.reliability_score
  )::numeric, 3) as match_score
from base b join bounds bo using (demand_item_id);

create or replace function farmers_to_notify(p_demand_item_id uuid, p_radius_km numeric default 30)
returns table (farmer_id uuid, name text, wa_number text, distance_km numeric)
language sql stable as $$
  select f.id, f.name, f.wa_number,
         round((st_distance(f.location, s.location) / 1000.0)::numeric, 1)
  from demand_items di
  join demands d on d.id = di.demand_id
  join sppg s    on s.id = d.sppg_id
  join farmer_commodities fc on fc.commodity_id = di.commodity_id
  join farmers f on f.id = fc.farmer_id
  where di.id = p_demand_item_id
    and st_dwithin(f.location, s.location, p_radius_km * 1000)
  order by 4;
$$;

create or replace function update_reliability() returns trigger
language plpgsql as $$
begin
  if new.delivered is distinct from old.delivered and new.delivered is not null then
    update farmers f
    set reliability_score = least(1.0, greatest(0.0,
          reliability_score + case when new.delivered then 0.05 else -0.15 end))
    from applications a
    where a.id = new.application_id and f.id = a.farmer_id;
  end if;
  return new;
end;
$$;

create trigger trg_reliability after update on matches
for each row execute function update_reliability();

-- Realtime: dashboard live mode subscribes to application inserts
alter publication supabase_realtime add table applications;
alter publication supabase_realtime add table wa_inbound_log;

-- ============================================================
-- SEED DATA
-- ============================================================
insert into sppg (name, kecamatan, location, wa_number) values
('SPPG Garut Pusat', 'Garut Kota',
 st_setsrid(st_makepoint(107.9087, -7.2278), 4326)::geography, '+628110000001');

insert into commodities (name, unit, aliases) values
('wortel','kg',array['carrot','bortol']),
('tomat','kg',array['tomato','tomat merah']),
('cabai merah','kg',array['cabe','cabai','lombok']),
('bayam','ikat',array['spinach']),
('kentang','kg',array['potato']),
('kol','kg',array['kubis','cabbage']),
('ayam','kg',array['ayam potong']),
('telur','kg',array['telor']);

insert into farmers (name, wa_number, gapoktan, kecamatan, location, reliability_score, verified_by)
select
  (array['Pak Asep','Pak Ujang','Pak Dedi','Pak Cecep','Pak Yayat','Bu Endang','Pak Tatang','Bu Iis','Bu Nenden','Bu Euis'])[1 + (i % 10)]
    || ' ' ||
  (array['Suryana','Hidayat','Permana','Ruhiyat','Kusnadi','Saputra','Mulyana','Rahmat','Sutisna','Gunawan'])[1 + ((i/10) % 10)]
    || ' ' || i,
  '+62812' || lpad((7000000 + i)::text, 7, '0'),
  (array['Gapoktan Mekar Tani','Gapoktan Sri Rejeki','Gapoktan Tani Mukti'])[1 + (i % 3)],
  (array['Cilawu','Bayongbong','Samarang','Tarogong Kaler','Karangpawitan'])[1 + (i % 5)],
  st_setsrid(st_makepoint(
    107.9087 + (random() - 0.5) * 0.30,
    -7.2278  + (random() - 0.5) * 0.30
  ), 4326)::geography,
  round((0.55 + random() * 0.40)::numeric, 2),
  'Penyuluh Kec. ' || (array['Cilawu','Bayongbong','Samarang','Tarogong Kaler','Karangpawitan'])[1 + (i % 5)]
from generate_series(1, 50) as i;

insert into farmer_commodities (farmer_id, commodity_id, est_capacity_kg_per_week)
select f.id, c.id, round((30 + random() * 120)::numeric, 0)
from farmers f
cross join lateral (select id from commodities order by random() limit 2 + (random() > 0.5)::int) c
on conflict do nothing;

-- IMPORTANT before live demo: point 2-3 farmers at REAL team numbers, e.g.
-- update farmers set wa_number = '+62812XXXXXXX' where id = (select id from farmers limit 1);

-- ============================================================
-- RLS: open reads, writes only via service-role key in API routes
-- ============================================================
do $$ declare t text;
begin
  foreach t in array array['sppg','farmers','demands','demand_items','applications',
                           'matches','commodities','farmer_commodities','wa_inbound_log','wa_outbound_log']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy "read all" on %I for select using (true)', t);
  end loop;
end $$;
