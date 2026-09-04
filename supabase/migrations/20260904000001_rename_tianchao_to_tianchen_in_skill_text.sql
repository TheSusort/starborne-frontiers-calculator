-- Rename the Tianchao faction to Tianchen in ship skill text.
--
-- SCOPE: the faction word only where it names a RECIPIENT ("Tianchao allies"). The same word also
-- appears in skill text as part of a BUFF NAME ("Tianchao Precision I/II"), and those must NOT be
-- touched here: a buff name in skill text is a lookup key against BUFFS in src/constants/buffs.ts.
-- Measured 2026-09-04 — feeding 'Tianchen Precision I' to buildShipAbilities emits NO ability at
-- all (not a mis-named one), so renaming it in the data would silently delete Anjian's, Yuyan's,
-- Huanying's and Sha Xing's Precision buff from the simulator. Renaming those needs a code change
-- to BUFFS first, and is deliberately not part of this migration.
--
-- The pattern below is the parser's own discriminator (skillTextParser.ts's FACTION_SCOPE_RES):
-- a recipient scope is the faction word immediately followed by ally/allies; a buff name is the
-- faction word followed by anything else. Same rule, so the data and the parser cannot disagree.
--
-- `ship_templates.faction` holds the KEY ('TIANCHAO'), not the display name, and is not touched.
-- Nothing else in the schema stores skill text.
--
-- Idempotent: re-running matches nothing, because 'Tianchen allies' is not 'Tianchao allies'.
--
-- NOTE: scripts/update-ship-skills.ts overwrites these columns from the frontiers.cubedweb.net
-- API. Running it before that source has renamed will revert this migration. The app tolerates
-- either spelling (factionSpellings in src/constants/factions.ts), so a revert is cosmetic.

BEGIN;

-- What this is about to change, for the record.
SELECT id,
       name,
       (SELECT count(*)
          FROM regexp_matches(
                 concat_ws(' ', active_skill_text, charge_skill_text, first_passive_skill_text,
                                second_passive_skill_text, third_passive_skill_text),
                 'Tianchao(\s+all(?:y|ies)\y)', 'g')) AS scope_mentions
  FROM public.ship_templates
 WHERE concat_ws(' ', active_skill_text, charge_skill_text, first_passive_skill_text,
                      second_passive_skill_text, third_passive_skill_text)
       ~ 'Tianchao\s+all(?:y|ies)\y'
 ORDER BY name;

UPDATE public.ship_templates
   SET active_skill_text =
         regexp_replace(active_skill_text, 'Tianchao(\s+all(?:y|ies)\y)', 'Tianchen\1', 'g'),
       charge_skill_text =
         regexp_replace(charge_skill_text, 'Tianchao(\s+all(?:y|ies)\y)', 'Tianchen\1', 'g'),
       first_passive_skill_text =
         regexp_replace(first_passive_skill_text, 'Tianchao(\s+all(?:y|ies)\y)', 'Tianchen\1', 'g'),
       second_passive_skill_text =
         regexp_replace(second_passive_skill_text, 'Tianchao(\s+all(?:y|ies)\y)', 'Tianchen\1', 'g'),
       third_passive_skill_text =
         regexp_replace(third_passive_skill_text, 'Tianchao(\s+all(?:y|ies)\y)', 'Tianchen\1', 'g'),
       updated_at = timezone('utc'::text, now())
 WHERE concat_ws(' ', active_skill_text, charge_skill_text, first_passive_skill_text,
                      second_passive_skill_text, third_passive_skill_text)
       ~ 'Tianchao\s+all(?:y|ies)\y';

-- Both halves of the contract, asserted rather than eyeballed: every recipient scope moved, and
-- every faction-NAMED buff stayed. A failure here rolls the whole thing back.
DO $$
DECLARE
    all_text text;
    leftover_scopes int;
    surviving_buff_names int;
BEGIN
    SELECT string_agg(
             concat_ws(' ', active_skill_text, charge_skill_text, first_passive_skill_text,
                            second_passive_skill_text, third_passive_skill_text), ' ')
      INTO all_text
      FROM public.ship_templates;

    SELECT count(*) INTO leftover_scopes
      FROM regexp_matches(all_text, 'Tianchao\s+all(?:y|ies)\y', 'g');

    SELECT count(*) INTO surviving_buff_names
      FROM regexp_matches(all_text, 'Tianchao Precision', 'g');

    IF leftover_scopes > 0 THEN
        RAISE EXCEPTION 'still % un-renamed "Tianchao all(y|ies)" recipient scope(s)',
                        leftover_scopes;
    END IF;

    -- A zero here means the buff names were swept too, which silently deletes those abilities.
    IF surviving_buff_names = 0 THEN
        RAISE EXCEPTION 'no "Tianchao Precision" buff names left — they must NOT be renamed';
    END IF;

    RAISE NOTICE 'recipient scopes renamed; % "Tianchao Precision" buff-name mention(s) preserved',
                 surviving_buff_names;
END $$;

COMMIT;
