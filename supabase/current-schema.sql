-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.ai_recommendation_votes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  recommendation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  vote_type text NOT NULL CHECK (vote_type = ANY (ARRAY['upvote'::text, 'downvote'::text])),
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  CONSTRAINT ai_recommendation_votes_pkey PRIMARY KEY (id),
  CONSTRAINT ai_recommendation_votes_recommendation_id_fkey FOREIGN KEY (recommendation_id) REFERENCES public.ai_recommendations(id),
  CONSTRAINT ai_recommendation_votes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.ai_recommendations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ship_name text NOT NULL,
  ship_refit_level integer NOT NULL DEFAULT 0,
  ship_implants jsonb DEFAULT '{}'::jsonb,
  ship_role text NOT NULL,
  stat_priorities jsonb DEFAULT '[]'::jsonb,
  stat_bonuses jsonb DEFAULT '[]'::jsonb,
  set_priorities jsonb DEFAULT '[]'::jsonb,
  reasoning text,
  upvotes integer DEFAULT 0,
  downvotes integer DEFAULT 0,
  total_votes integer DEFAULT (upvotes + downvotes),
  score numeric DEFAULT
CASE
    WHEN ((upvotes + downvotes) = 0) THEN (0)::numeric
    ELSE ((upvotes)::numeric / ((upvotes + downvotes))::numeric)
END,
  created_by uuid,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  CONSTRAINT ai_recommendations_pkey PRIMARY KEY (id),
  CONSTRAINT ai_recommendations_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);
CREATE TABLE public.autogear_configs (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  ship_id text NOT NULL,
  config jsonb NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  CONSTRAINT autogear_configs_pkey PRIMARY KEY (id),
  CONSTRAINT autogear_configs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.daily_usage_stats (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  date date NOT NULL UNIQUE,
  total_autogear_runs integer DEFAULT 0,
  total_data_imports integer DEFAULT 0,
  unique_active_users integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT daily_usage_stats_pkey PRIMARY KEY (id)
);
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
CREATE TABLE public.heartbeats (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  user_id uuid,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT heartbeats_pkey PRIMARY KEY (id),
  CONSTRAINT heartbeats_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
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
  calibration_ship_id uuid,
  CONSTRAINT inventory_items_pkey PRIMARY KEY (id),
  CONSTRAINT inventory_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
  CONSTRAINT inventory_items_calibration_ship_id_fkey FOREIGN KEY (calibration_ship_id) REFERENCES public.ships(id)
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
  shield_penetration integer,
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
  CONSTRAINT ship_implants_id_fkey FOREIGN KEY (id) REFERENCES public.inventory_items(id),
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
CREATE TABLE public.ship_template_proposals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ship_name text NOT NULL,
  ship_id text NOT NULL,
  proposed_stats jsonb NOT NULL,
  current_stats jsonb,
  stat_differences jsonb,
  proposed_by_user_id text NOT NULL,
  proposal_count integer DEFAULT 1,
  status text DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text])),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  reviewed_at timestamp with time zone,
  reviewed_by text,
  CONSTRAINT ship_template_proposals_pkey PRIMARY KEY (id)
);
CREATE TABLE public.ship_templates (
  id text NOT NULL,
  name text NOT NULL,
  rarity text NOT NULL,
  faction text NOT NULL,
  type text NOT NULL,
  affinity text,
  image_key text,
  active_skill_text text,
  charge_skill_text text,
  first_passive_skill_text text,
  second_passive_skill_text text,
  base_stats jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  definition_id text,
  third_passive_skill_text text,
  CONSTRAINT ship_templates_pkey PRIMARY KEY (id)
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
  template_id text DEFAULT convert_to_template_id(name),
  CONSTRAINT ships_pkey PRIMARY KEY (id),
  CONSTRAINT ships_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id),
  CONSTRAINT ships_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.ship_templates(id)
);
CREATE TABLE public.system_alerts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  alert_type character varying NOT NULL,
  severity character varying NOT NULL CHECK (severity::text = ANY (ARRAY['info'::character varying, 'warning'::character varying, 'critical'::character varying]::text[])),
  message text NOT NULL,
  metadata jsonb,
  resolved boolean DEFAULT false,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT system_alerts_pkey PRIMARY KEY (id)
);
CREATE TABLE public.system_health_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  snapshot_date date NOT NULL UNIQUE,
  total_ships integer DEFAULT 0,
  total_inventory integer DEFAULT 0,
  total_loadouts integer DEFAULT 0,
  total_encounters integer DEFAULT 0,
  total_users integer DEFAULT 0,
  total_active_users integer DEFAULT 0,
  avg_ships_per_user numeric DEFAULT 0,
  avg_gear_per_user numeric DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT system_health_snapshots_pkey PRIMARY KEY (id)
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
CREATE TABLE public.user_activity_log (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  activity_date date NOT NULL,
  autogear_runs integer DEFAULT 0,
  data_imports integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_activity_log_pkey PRIMARY KEY (id),
  CONSTRAINT user_activity_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id)
);
CREATE TABLE public.users (
  id uuid NOT NULL,
  email character varying UNIQUE,
  created_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone DEFAULT timezone('utc'::text, now()),
  autogear_run_count integer DEFAULT 0,
  data_import_count integer DEFAULT 0,
  is_admin boolean DEFAULT false,
  username text UNIQUE CHECK (username IS NULL OR length(username) >= 3 AND length(username) <= 20 AND username ~ '^[a-zA-Z0-9]+$'::text),
  is_public boolean DEFAULT false,
  in_game_id text,
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);