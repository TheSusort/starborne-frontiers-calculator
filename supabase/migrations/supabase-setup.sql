-- Users table (handled by Supabase Auth)
create table users (
  id uuid references auth.users primary key,
  email text unique,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Ships table
create table ships (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references users(id) on delete cascade,
  firebase_id text,
  name text not null,
  rarity text not null,
  faction text not null,
  type text not null,
  affinity text,
  equipment_locked boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Ship base stats
create table ship_base_stats (
  ship_id uuid references ships(id) on delete cascade,
  hp integer not null,
  attack integer not null,
  defence integer not null,
  hacking integer not null,
  security integer not null,
  crit integer not null,
  crit_damage integer not null,
  speed integer not null,
  heal_modifier integer not null,
  hp_regen integer,
  shield integer,
  primary key (ship_id)
);

-- Ship refits
create table ship_refits (
  id uuid default uuid_generate_v4() primary key,
  ship_id uuid references ships(id) on delete cascade,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Ship refit stats
create table ship_refit_stats (
  id uuid default uuid_generate_v4() primary key,
  refit_id uuid references ship_refits(id) on delete cascade,
  name text not null,
  value numeric not null,
  type text not null
);

-- Ship implants
create table ship_implants (
  id uuid default uuid_generate_v4() primary key,
  ship_id uuid references ships(id) on delete cascade,
  description text,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Ship implant stats
create table ship_implant_stats (
  id uuid default uuid_generate_v4() primary key,
  implant_id uuid references ship_implants(id) on delete cascade,
  name text not null,
  value numeric not null,
  type text not null
);

-- Inventory items
create table inventory_items (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references users(id) on delete cascade,
  firebase_id text,
  slot text not null,
  level integer not null,
  stars integer not null,
  rarity text not null,
  set_bonus text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Ship equipment
create table ship_equipment (
  ship_id uuid references ships(id) on delete cascade,
  slot text not null,
  gear_id text references inventory_items(id),
  primary key (ship_id, slot)
);

-- Gear stats
create table gear_stats (
  id uuid default uuid_generate_v4() primary key,
  gear_id uuid references inventory_items(id) on delete cascade,
  name text not null,
  value numeric not null,
  type text not null,
  is_main boolean not null
);

-- Encounter notes
create table encounter_notes (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references users(id) on delete cascade,
  name text not null,
  description text,
  is_public boolean default false,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Encounter formations
create table encounter_formations (
  note_id uuid references encounter_notes(id) on delete cascade,
  ship_id uuid references ships(id) on delete cascade,
  position text not null,
  primary key (note_id, position)
);

-- Loadouts
create table loadouts (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references users(id) on delete cascade,
  name text not null,
  ship_id uuid references ships(id) on delete cascade,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Loadout equipment
create table loadout_equipment (
  loadout_id uuid references loadouts(id) on delete cascade,
  slot text not null,
  gear_id uuid references inventory_items(id),
  primary key (loadout_id, slot)
);

-- Team loadouts
create table team_loadouts (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references users(id) on delete cascade,
  name text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()),
  updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- Team loadout ships
create table team_loadout_ships (
  team_loadout_id uuid references team_loadouts(id) on delete cascade,
  position integer not null,
  ship_id uuid references ships(id) on delete cascade,
  primary key (team_loadout_id, position)
);

-- Team loadout equipment
create table team_loadout_equipment (
  team_loadout_id uuid references team_loadouts(id) on delete cascade,
  ship_id uuid references ships(id) on delete cascade,
  slot text not null,
  gear_id uuid references inventory_items(id),
  primary key (team_loadout_id, ship_id, slot)
);

-- Engineering stats
create table engineering_stats (
  user_id uuid references users(id) on delete cascade,
  ship_type text not null,
  stat_name text not null,
  value numeric not null,
  type text not null,
  primary key (user_id, ship_type, stat_name)
);

-- Row Level Security Policies
alter table ships enable row level security;
alter table inventory_items enable row level security;
alter table encounter_notes enable row level security;
alter table loadouts enable row level security;
alter table team_loadouts enable row level security;
alter table engineering_stats enable row level security;

-- RLS Policies
create policy "Users can only access their own ships"
  on ships for all
  using (auth.uid() = user_id);

create policy "Users can only access their own inventory"
  on inventory_items for all
  using (auth.uid() = user_id);

create policy "Users can only access their own encounter notes"
  on encounter_notes for all
  using (auth.uid() = user_id);

create policy "Users can only access their own loadouts"
  on loadouts for all
  using (auth.uid() = user_id);

create policy "Users can only access their own team loadouts"
  on team_loadouts for all
  using (auth.uid() = user_id);

create policy "Users can only access their own engineering stats"
  on engineering_stats for all
  using (auth.uid() = user_id);