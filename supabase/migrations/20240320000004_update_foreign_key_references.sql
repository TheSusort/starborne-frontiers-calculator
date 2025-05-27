-- Create a temporary mapping table to store old Firebase IDs and new Supabase UUIDs
create or replace function create_id_mappings_table()
returns void
language plpgsql
security definer
as $$
begin
    create table if not exists id_mappings (
        old_id text not null,
        new_id uuid not null,
        table_name text not null,
        primary key (old_id, table_name)
    );
end;
$$;

-- Function to drop foreign key constraints
create or replace function drop_foreign_key_constraints()
returns void
language plpgsql
security definer
as $$
begin
    alter table ship_equipment drop constraint if exists ship_equipment_new_gear_id_fkey;
    alter table ship_equipment drop constraint if exists ship_equipment_gear_id_fkey;
    alter table encounter_formations drop constraint if exists encounter_formations_new_ship_id_fkey;
    alter table encounter_formations drop constraint if exists encounter_formations_ship_id_fkey;
    alter table loadouts drop constraint if exists loadouts_new_ship_id_fkey;
    alter table loadouts drop constraint if exists loadouts_ship_id_fkey;
    alter table loadout_equipment drop constraint if exists loadout_equipment_new_gear_id_fkey;
    alter table loadout_equipment drop constraint if exists loadout_equipment_gear_id_fkey;
    alter table team_loadout_ships drop constraint if exists team_loadout_ships_new_ship_id_fkey;
    alter table team_loadout_ships drop constraint if exists team_loadout_ships_ship_id_fkey;
    alter table team_loadout_equipment drop constraint if exists team_loadout_equipment_new_gear_id_fkey;
    alter table team_loadout_equipment drop constraint if exists team_loadout_equipment_new_ship_id_fkey;
    alter table team_loadout_equipment drop constraint if exists team_loadout_equipment_gear_id_fkey;
    alter table team_loadout_equipment drop constraint if exists team_loadout_equipment_ship_id_fkey;
end;
$$;

-- Function to re-add foreign key constraints
create or replace function add_firebase_foreign_key_constraints()
returns void
language plpgsql
security definer
as $$
begin
    alter table ship_equipment add constraint ship_equipment_gear_id_fkey foreign key (gear_id) references inventory_items(firebase_id);
    alter table encounter_formations add constraint encounter_formations_ship_id_fkey foreign key (ship_id) references ships(firebase_id);
    alter table loadouts add constraint loadouts_ship_id_fkey foreign key (ship_id) references ships(firebase_id);
    alter table loadout_equipment add constraint loadout_equipment_gear_id_fkey foreign key (gear_id) references inventory_items(firebase_id);
    alter table team_loadout_ships add constraint team_loadout_ships_ship_id_fkey foreign key (ship_id) references ships(firebase_id);
    alter table team_loadout_equipment add constraint team_loadout_equipment_gear_id_fkey foreign key (gear_id) references inventory_items(firebase_id);
    alter table team_loadout_equipment add constraint team_loadout_equipment_ship_id_fkey foreign key (ship_id) references ships(firebase_id);
end;
$$;

-- Function to convert columns from uuid to text
create or replace function foreign_keys_uuid_to_text()
returns void
language plpgsql
security definer
as $$
begin
    alter table ship_equipment alter column gear_id type text using gear_id::text;
    alter table encounter_formations alter column ship_id type text using ship_id::text;
    alter table loadouts alter column ship_id type text using ship_id::text;
    alter table loadout_equipment alter column gear_id type text using gear_id::text;
    alter table team_loadout_ships alter column ship_id type text using ship_id::text;
    alter table team_loadout_equipment alter column gear_id type text using gear_id::text;
    alter table team_loadout_equipment alter column ship_id type text using ship_id::text;
end;
$$;

-- Function to populate the mapping table for ships
create or replace function populate_ship_mappings(user_id uuid)
returns void
language plpgsql
security definer
as $$
begin
    insert into id_mappings (old_id, new_id, table_name)
    select firebase_id, id, 'ships'
    from ships s
    where s.user_id = populate_ship_mappings.user_id;
end;
$$;

-- Function to populate the mapping table for inventory items
create or replace function populate_inventory_mappings(user_id uuid)
returns void
language plpgsql
security definer
as $$
begin
    insert into id_mappings (old_id, new_id, table_name)
    select firebase_id, id, 'inventory_items'
    from inventory_items i
    where i.user_id = populate_inventory_mappings.user_id;
end;
$$;

-- Function to update ship_equipment references
create or replace function update_ship_equipment_references()
returns void
language plpgsql
security definer
as $$
begin
    -- Add new column
    alter table ship_equipment add column new_gear_id uuid;

    -- Update new column with mapped IDs
    update ship_equipment se
    set new_gear_id = im.new_id
    from id_mappings im
    where se.gear_id = im.old_id
    and im.table_name = 'inventory_items';

    -- Add foreign key constraint
    alter table ship_equipment add constraint ship_equipment_new_gear_id_fkey
        foreign key (new_gear_id) references inventory_items(id) on delete cascade;

    -- Drop old column and rename new one
    alter table ship_equipment drop column gear_id;
    alter table ship_equipment rename column new_gear_id to gear_id;
end;
$$;

-- Function to update encounter formations references
create or replace function update_encounter_formations_references()
returns void
language plpgsql
security definer
as $$
begin
    -- Add new column
    alter table encounter_formations add column new_ship_id uuid;

    -- Update new column with mapped IDs
    update encounter_formations ef
    set new_ship_id = im.new_id
    from id_mappings im
    where ef.ship_id = im.old_id
    and im.table_name = 'ships';

    -- Add foreign key constraint
    alter table encounter_formations add constraint encounter_formations_new_ship_id_fkey
        foreign key (new_ship_id) references ships(id) on delete cascade;

    -- Drop old column and rename new one
    alter table encounter_formations drop column ship_id;
    alter table encounter_formations rename column new_ship_id to ship_id;
end;
$$;

-- Function to update loadouts references
create or replace function update_loadouts_references()
returns void
language plpgsql
security definer
as $$
begin
    -- Add new column
    alter table loadouts add column new_ship_id uuid;

    -- Update new column with mapped IDs
    update loadouts l
    set new_ship_id = im.new_id
    from id_mappings im
    where l.ship_id = im.old_id
    and im.table_name = 'ships';

    -- Add foreign key constraint
    alter table loadouts add constraint loadouts_new_ship_id_fkey
        foreign key (new_ship_id) references ships(id) on delete cascade;

    -- Drop old column and rename new one
    alter table loadouts drop column ship_id;
    alter table loadouts rename column new_ship_id to ship_id;
end;
$$;

-- Function to update loadout equipment references
create or replace function update_loadout_equipment_references()
returns void
language plpgsql
security definer
as $$
begin
    -- Add new column
    alter table loadout_equipment add column new_gear_id uuid;

    -- Update new column with mapped IDs
    update loadout_equipment le
    set new_gear_id = im.new_id
    from id_mappings im
    where le.gear_id = im.old_id
    and im.table_name = 'inventory_items';

    -- Add foreign key constraint
    alter table loadout_equipment add constraint loadout_equipment_new_gear_id_fkey
        foreign key (new_gear_id) references inventory_items(id) on delete cascade;

    -- Drop old column and rename new one
    alter table loadout_equipment drop column gear_id;
    alter table loadout_equipment rename column new_gear_id to gear_id;
end;
$$;

-- Function to update team loadout ships references
create or replace function update_team_loadout_ships_references()
returns void
language plpgsql
security definer
as $$
begin
    -- Add new column
    alter table team_loadout_ships add column new_ship_id uuid;

    -- Update new column with mapped IDs
    update team_loadout_ships tls
    set new_ship_id = im.new_id
    from id_mappings im
    where tls.ship_id = im.old_id
    and im.table_name = 'ships';

    -- Add foreign key constraint
    alter table team_loadout_ships add constraint team_loadout_ships_new_ship_id_fkey
        foreign key (new_ship_id) references ships(id) on delete cascade;

    -- Drop old column and rename new one
    alter table team_loadout_ships drop column ship_id;
    alter table team_loadout_ships rename column new_ship_id to ship_id;
end;
$$;

-- Function to update team loadout equipment references
create or replace function update_team_loadout_equipment_references()
returns void
language plpgsql
security definer
as $$
begin
    -- Add new column
    alter table team_loadout_equipment add column new_gear_id uuid;
    alter table team_loadout_equipment add column new_ship_id uuid;

    -- Update new column with mapped IDs
    update team_loadout_equipment tle
    set new_gear_id = im.new_id
    from id_mappings im
    where tle.gear_id = im.old_id
    and im.table_name = 'inventory_items';

    update team_loadout_equipment tle
    set new_ship_id = im.new_id
    from id_mappings im
    where tle.ship_id = im.old_id
    and im.table_name = 'ships';

    -- Add foreign key constraint
    alter table team_loadout_equipment add constraint team_loadout_equipment_new_gear_id_fkey
        foreign key (new_gear_id) references inventory_items(id) on delete cascade;

    alter table team_loadout_equipment add constraint team_loadout_equipment_new_ship_id_fkey
        foreign key (new_ship_id) references ships(id) on delete cascade;

    -- Drop old column and rename new one
    alter table team_loadout_equipment drop column gear_id;
    alter table team_loadout_equipment rename column new_gear_id to gear_id;
    alter table team_loadout_equipment drop column ship_id;
    alter table team_loadout_equipment rename column new_ship_id to ship_id;
end;
$$;

-- Function to verify data integrity
create or replace function verify_data_integrity()
returns table (
    table_name text,
    old_id text,
    new_id uuid,
    status text
)
language plpgsql
security definer
as $$
begin
    return query
    select
        'ship_equipment' as table_name,
        se.gear_id::text as old_id,
        i.id as new_id,
        case when i.id is not null then 'OK' else 'MISSING' end as status
    from ship_equipment se
    left join inventory_items i on se.gear_id = i.id
    union all
    select
        'encounter_formations' as table_name,
        ef.ship_id::text as old_id,
        s.id as new_id,
        case when s.id is not null then 'OK' else 'MISSING' end as status
    from encounter_formations ef
    left join ships s on ef.ship_id = s.id
    union all
    select
        'loadouts' as table_name,
        l.ship_id::text as old_id,
        s.id as new_id,
        case when s.id is not null then 'OK' else 'MISSING' end as status
    from loadouts l
    left join ships s on l.ship_id = s.id
    union all
    select
        'team_loadout_ships' as table_name,
        tls.ship_id::text as old_id,
        s.id as new_id,
        case when s.id is not null then 'OK' else 'MISSING' end as status
    from team_loadout_ships tls
    left join ships s on tls.ship_id = s.id
    union all
    select
        'team_loadout_equipment' as table_name,
        tle.gear_id::text as old_id,
        i.id as new_id,
        case when i.id is not null then 'OK' else 'MISSING' end as status
    from team_loadout_equipment tle
    left join inventory_items i on tle.gear_id = i.id;
end;
$$;

-- Function to clean up the mapping table
create or replace function cleanup_mapping_table()
returns void
language plpgsql
security definer
as $$
begin
    drop table if exists id_mappings;
end;
$$;

