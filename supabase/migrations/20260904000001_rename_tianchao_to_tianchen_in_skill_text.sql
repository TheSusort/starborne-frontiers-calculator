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
-- Idempotent, and a no-op on a database that holds neither phrase (a fresh or partially seeded
-- environment): every check below compares against what this database actually started with, so
-- nothing here requires a particular row to exist.
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
                 'Tianchao\s+all(?:y|ies)\y', 'g')) AS scope_mentions
  FROM public.ship_templates
 WHERE concat_ws(' ', active_skill_text, charge_skill_text, first_passive_skill_text,
                      second_passive_skill_text, third_passive_skill_text)
       ~ 'Tianchao\s+all(?:y|ies)\y'
 ORDER BY name;

-- The rename and its verification live in one block so the checks can compare against the
-- pre-update counts. Both halves of the contract are asserted rather than eyeballed: every
-- recipient scope moved, and the faction-NAMED buff mentions are CONSERVED — a count, not a
-- presence test, so a partial sweep that ate some of them fails too. A failure rolls everything
-- back.
--
-- The buff-name half can only fire for a row carrying BOTH shapes, because the UPDATE's WHERE
-- clause never touches a row that has no recipient scope. On the corpus as of 2026-09-04 no ship
-- has both (Fuying holds the scopes; the Precision buffs belong to four other ships), so that
-- check is inert here and goes live the moment one does.
DO $$
DECLARE
    -- The recipient scope, in the old and new spelling. Kept as constants so the UPDATE and the
    -- checks cannot drift apart.
    pat_old  text := 'Tianchao(\s+all(?:y|ies)\y)'; -- capture group: the UPDATE's \1 keeps the matched suffix
    pat_new  text := 'Tianchen(\s+all(?:y|ies)\y)';
    pat_buff text := 'Tianchao Precision';
    corpus text;
    scopes_before int;
    scopes_after int;
    renamed_before int;
    renamed_after int;
    buffs_before int;
    buffs_after int;
    touched int;
BEGIN
    -- Every skill-text column of every row, as one string. NULL columns are skipped by concat_ws
    -- and an empty table yields '' rather than NULL, so all counts are 0 on a fresh database.
    corpus := (
        SELECT coalesce(string_agg(
                 concat_ws(' ', active_skill_text, charge_skill_text, first_passive_skill_text,
                                second_passive_skill_text, third_passive_skill_text), ' '), '')
          FROM public.ship_templates);

    SELECT count(*) INTO scopes_before  FROM regexp_matches(corpus, pat_old,  'g');
    SELECT count(*) INTO renamed_before FROM regexp_matches(corpus, pat_new,  'g');
    SELECT count(*) INTO buffs_before   FROM regexp_matches(corpus, pat_buff, 'g');

    UPDATE public.ship_templates
       SET active_skill_text =
             regexp_replace(active_skill_text, pat_old, 'Tianchen\1', 'g'),
           charge_skill_text =
             regexp_replace(charge_skill_text, pat_old, 'Tianchen\1', 'g'),
           first_passive_skill_text =
             regexp_replace(first_passive_skill_text, pat_old, 'Tianchen\1', 'g'),
           second_passive_skill_text =
             regexp_replace(second_passive_skill_text, pat_old, 'Tianchen\1', 'g'),
           third_passive_skill_text =
             regexp_replace(third_passive_skill_text, pat_old, 'Tianchen\1', 'g'),
           updated_at = timezone('utc'::text, now())
     WHERE concat_ws(' ', active_skill_text, charge_skill_text, first_passive_skill_text,
                          second_passive_skill_text, third_passive_skill_text) ~ pat_old;
    GET DIAGNOSTICS touched = ROW_COUNT;

    corpus := (
        SELECT coalesce(string_agg(
                 concat_ws(' ', active_skill_text, charge_skill_text, first_passive_skill_text,
                                second_passive_skill_text, third_passive_skill_text), ' '), '')
          FROM public.ship_templates);

    SELECT count(*) INTO scopes_after  FROM regexp_matches(corpus, pat_old,  'g');
    SELECT count(*) INTO renamed_after FROM regexp_matches(corpus, pat_new,  'g');
    SELECT count(*) INTO buffs_after   FROM regexp_matches(corpus, pat_buff, 'g');

    IF scopes_after > 0 THEN
        RAISE EXCEPTION 'still % un-renamed "Tianchao all(y|ies)" recipient scope(s)', scopes_after;
    END IF;

    IF renamed_after <> renamed_before + scopes_before THEN
        RAISE EXCEPTION 'expected % renamed recipient scope(s), found %',
                        renamed_before + scopes_before, renamed_after;
    END IF;

    -- Conserved, whatever the starting count: 0 before and 0 after is a legitimate no-op, while
    -- any drop means the sweep reached a buff NAME.
    IF buffs_after <> buffs_before THEN
        RAISE EXCEPTION '"Tianchao Precision" buff-name mentions went from % to % — they must NOT be renamed',
                        buffs_before, buffs_after;
    END IF;

    RAISE NOTICE 'renamed % recipient scope(s) across % row(s); % buff-name mention(s) conserved',
                 scopes_before, touched, buffs_after;
END $$;

COMMIT;
