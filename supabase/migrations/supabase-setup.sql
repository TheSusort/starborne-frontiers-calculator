-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.encounter_formations (
  note_id uuid NOT NULL,
  position text NOT NULL,
  ship_id uuid,
  CONSTRAINT encounter_formations_pkey PRIMARY KEY (note_id, position),
  CONSTRAINT encounter_formations_note_id_fkey FOREIGN KEY (note_id) REFERENCES public.encounter_notes(id),
  CONSTRAINT encounter_formations_new_ship_id_fkey FOREIGN KEY (ship_id) REFERENCES public.ships(id)
);
CREATE TABLE public.encounter_notes (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid,
  name text NOT NULL,
  description text,
  is_public boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  CONSTRAINT encounter_notes_pkey PRIMARY KEY (id),
  CONSTRAINT encounter_notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.engineering_stats (
  user_id uuid NOT NULL,
  ship_type text NOT NULL,
  stat_name text NOT NULL,
  value numeric NOT NULL,
  type text NOT NULL,
  CONSTRAINT engineering_stats_pkey PRIMARY KEY (user_id, ship_type, stat_name),
  CONSTRAINT engineering_stats_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.gear_stats (
  gear_id uuid NOT NULL,
  name text NOT NULL,
  value numeric NOT NULL,
  type text NOT NULL,
  is_main boolean NOT NULL,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  CONSTRAINT gear_stats_pkey PRIMARY KEY (id),
  CONSTRAINT gear_stats_gear_id_fkey FOREIGN KEY (gear_id) REFERENCES public.inventory_items(id)
);
CREATE TABLE public.inventory_items (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid,
  slot text NOT NULL,
  level integer NOT NULL,
  stars integer NOT NULL,
  rarity text NOT NULL,
  set_bonus text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  firebase_id text UNIQUE,
  CONSTRAINT inventory_items_pkey PRIMARY KEY (id),
  CONSTRAINT inventory_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.loadout_equipment (
  loadout_id uuid NOT NULL,
  slot text NOT NULL,
  gear_id uuid,
  CONSTRAINT loadout_equipment_pkey PRIMARY KEY (loadout_id, slot),
  CONSTRAINT loadout_equipment_loadout_id_fkey FOREIGN KEY (loadout_id) REFERENCES public.loadouts(id),
  CONSTRAINT loadout_equipment_new_gear_id_fkey FOREIGN KEY (gear_id) REFERENCES public.inventory_items(id)
);
CREATE TABLE public.loadouts (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  ship_id uuid,
  CONSTRAINT loadouts_pkey PRIMARY KEY (id),
  CONSTRAINT loadouts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
  CONSTRAINT loadouts_new_ship_id_fkey FOREIGN KEY (ship_id) REFERENCES public.ships(id)
);
CREATE TABLE public.ship_base_stats (
  ship_id uuid NOT NULL,
  hp integer NOT NULL,
  attack integer NOT NULL,
  defence integer NOT NULL,
  hacking integer NOT NULL,
  security integer NOT NULL,
  crit integer NOT NULL,
  crit_damage integer NOT NULL,
  speed integer NOT NULL,
  heal_modifier integer NOT NULL,
  hp_regen integer,
  shield integer,
  defense_penetration integer,
  CONSTRAINT ship_base_stats_pkey PRIMARY KEY (ship_id),
  CONSTRAINT ship_base_stats_ship_id_fkey FOREIGN KEY (ship_id) REFERENCES public.ships(id)
);
CREATE TABLE public.ship_equipment (
  ship_id uuid NOT NULL,
  slot text NOT NULL,
  gear_id uuid,
  CONSTRAINT ship_equipment_pkey PRIMARY KEY (ship_id, slot),
  CONSTRAINT ship_equipment_ship_id_fkey FOREIGN KEY (ship_id) REFERENCES public.ships(id),
  CONSTRAINT ship_equipment_new_gear_id_fkey FOREIGN KEY (gear_id) REFERENCES public.inventory_items(id)
);
CREATE TABLE public.ship_implant_stats (
  implant_id uuid NOT NULL,
  name text NOT NULL,
  value numeric NOT NULL,
  type text NOT NULL,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  CONSTRAINT ship_implant_stats_pkey PRIMARY KEY (id),
  CONSTRAINT ship_implant_stats_implant_id_fkey FOREIGN KEY (implant_id) REFERENCES public.ship_implants(id)
);
CREATE TABLE public.ship_implants (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  ship_id uuid,
  description text,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  slot text,
  CONSTRAINT ship_implants_pkey PRIMARY KEY (id),
  CONSTRAINT ship_implants_ship_id_fkey FOREIGN KEY (ship_id) REFERENCES public.ships(id)
);
CREATE TABLE public.ship_refit_stats (
  refit_id uuid NOT NULL,
  name text NOT NULL,
  value numeric NOT NULL,
  type text NOT NULL,
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  CONSTRAINT ship_refit_stats_pkey PRIMARY KEY (id),
  CONSTRAINT ship_refit_stats_refit_id_fkey FOREIGN KEY (refit_id) REFERENCES public.ship_refits(id)
);
CREATE TABLE public.ship_refits (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  ship_id uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  CONSTRAINT ship_refits_pkey PRIMARY KEY (id),
  CONSTRAINT ship_refits_ship_id_fkey FOREIGN KEY (ship_id) REFERENCES public.ships(id)
);
CREATE TABLE public.ships (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid,
  name text NOT NULL,
  rarity text NOT NULL,
  faction text NOT NULL,
  type text NOT NULL,
  affinity text,
  equipment_locked boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  copies integer,
  rank integer,
  level integer,
  CONSTRAINT ships_pkey PRIMARY KEY (id),
  CONSTRAINT ships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.team_loadout_equipment (
  team_loadout_id uuid NOT NULL,
  slot text,
  gear_id uuid,
  ship_id uuid,
  CONSTRAINT team_loadout_equipment_team_loadout_id_fkey FOREIGN KEY (team_loadout_id) REFERENCES public.team_loadouts(id),
  CONSTRAINT team_loadout_equipment_new_gear_id_fkey FOREIGN KEY (gear_id) REFERENCES public.inventory_items(id),
  CONSTRAINT team_loadout_equipment_new_ship_id_fkey FOREIGN KEY (ship_id) REFERENCES public.ships(id)
);
CREATE TABLE public.team_loadout_ships (
  team_loadout_id uuid NOT NULL,
  position integer NOT NULL,
  ship_id uuid,
  CONSTRAINT team_loadout_ships_pkey PRIMARY KEY (team_loadout_id, position),
  CONSTRAINT team_loadout_ships_team_loadout_id_fkey FOREIGN KEY (team_loadout_id) REFERENCES public.team_loadouts(id),
  CONSTRAINT team_loadout_ships_new_ship_id_fkey FOREIGN KEY (ship_id) REFERENCES public.ships(id)
);
CREATE TABLE public.team_loadouts (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  CONSTRAINT team_loadouts_pkey PRIMARY KEY (id),
  CONSTRAINT team_loadouts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.users (
  id uuid NOT NULL,
  email character varying UNIQUE,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);