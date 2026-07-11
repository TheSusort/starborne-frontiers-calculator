import { ChangelogEntry } from '../types/changelog';

export const CURRENT_VERSION = '1.64.0';

// RELEASE CHECKLIST: move these strings into a new ChangelogEntry at the top of
// CHANGELOG (with the new version + today's date), clear this array back to [],
// and bump CURRENT_VERSION. All three steps must happen together.
export const UNRELEASED_CHANGES: string[] = [
    'Combat sim: positioned board battles with skill-pattern targeting; shields and damage absorption; implants and gear set effects; control effects (Disable, Stasis, stealth); DoT, bombs, and detonations; counterattacks and enemy reactions; detailed combat log; affinity and charge rules; random crit/proc variance. DPS calculator now includes implant and gear set effects.',
    'Combat sim charge fixes: Selenite only gains charge vs live Stealth; Graphite start-of-round grant requires a living stealthed enemy and logs at round start; Liberator ally-charge on enemy death fires once per round for any kill (including ally kills).',
    "Battle Simulator: pick a squad leader for each team (faction, leader, and upgrade stage, remembered between visits) — faction-scoped stat bonuses, and legendary stage-3 enemy debuffs, now apply in the simulation. A live preview under each board shows which placed ships each effect hits, and effects the sim can't model yet are marked 'Not simulated'.",
    "Battle Simulator: pre-fight ship passives are now simulated — Lionheart grants adjacent allies 10% of its HP, Centurion gains attack per adjacent ally, and Enforcer/Defiant/Stalwart gain their bonuses when placed next to a Supporter. Bonuses fold in after squad-leader auras, before round 1, and are permanent (they survive the granting ship's death). Ships whose skills say they start combat fully charged (e.g. Chimei) now begin the battle fully charged and fire their charged skill on round 1.",
    'Combat sim: damage bonuses that target enemies with a specific status now check for that exact status. Tygr, Rikra, Incinerator, Wrecker, and Lodolite only get their bonus damage against the named status (Stasis/Disable, Taunt/Provoke, Inferno, or Concentrate Fire) rather than against any debuffed enemy.',
    "Combat sim: in a multi-target attack, a damage bonus gated on a named enemy status (e.g. Tygr's bonus vs Stasis/Disable) is now checked against each hit target individually — a target without the status no longer gets the bonus just because another target in the same attack has it.",
    "Combat sim: team-wide damage auras now actually reach the team. Lodolite's +15% damage vs Concentrate Fire (or Stealth) and Panguan's +40% damage for Stealthed units apply to every living ally who qualifies, not just the caster's own attacks.",
    "Combat sim: Selenite's bonus direct damage now scales with the number of Stealthed enemies (10% per enemy), instead of a flat 10% whenever at least one enemy was Stealthed.",
    "Combat sim: Lodolite's charged skill now purges all buffs from the enemy with the most buffs, and her legendary refit strips 100% of that enemy's shield when she does.",
    "Combat sim: Wildfire's bonus Inferno damage against an enemy with Scorching Radiation (scaling with her own crit power, 1% per 10% crit power, 2% with her refit) is now re-checked on every Inferno tick against each affected enemy individually — a target that never had Scorching Radiation (or whose Scorching Radiation has since expired) no longer gets the bonus just because another of her targets currently has it.",
    "Combat sim: Wildfire's refit-3 passive now actually reaches the team — every living ally's Inferno damage against an enemy with Scorching Radiation is boosted by 2% per 10% of Wildfire's own crit power (not the ally's), matching her skill text.",
    'Fixed skill parsing that inflated DPS for Tormenter, Voron, Malvex, and FrontLine — defensive damage-reduction (and shield-scaling) clauses were being counted as extra attacks. Also fixed Amartya, who no longer grants herself a phantom Taunt buff from her "enemy gains Taunt" trigger text, and now correctly inflicts 2 stacks of Exposed (not 1) from her legendary refit passive.',
    'Combat sim: enemy ships whose skill only targets allies (like Graphite) no longer stop granting buffs and shields for the rest of the battle after the first player ship dies. (Enemy skills that also hit your team still pause when their bound target is dead — retargeting is a separate upcoming fix.)',
    "Combat sim: fixed conditional control-effect modeling for Crocus, Nayra, Makoli, Flamel, Guardian, and Meiying. Crocus's and Nayra's conditional Stasis (only landing when the target has 4+ debuffs, or was repaired this round) could reach the sim's reaction machinery unconditionally; Makoli, Flamel, Guardian, and Meiying each had a duplicate, always-firing control entry alongside their real (and already correctly gated) Disable, Stasis, and Provoke effects. Both are fixed — actual gameplay-facing effects are unaffected.",
    'Combat sim: Thresh\'s active-skill charge removal ("If the target is a Defender, this Unit removes 1 charge from the enemy and adds 1 charge to this Unit\'s Charged Skill") now only fires against Defenders, matching her paired self charge gain — it previously fired against any target.',
    "Combat sim: fixed round-boundary and start-of-combat timing for several ships. Judge's execute damage, Chimei's Stealth-gated repair, Incinerator's Inferno damage, Chakara's speed-based follow-up hit, Rhodium's co-located damage, and Nayra/Isha's Affinity Override buffs now fire at the actual start/end of the round instead of being folded into the ship's own turn. Cobalt's start-of-turn Out. Damage Up buff is no longer limited to his first turn. Crucialis, FrontLine, and IonScorp's start-of-combat Shields are now granted once before the battle begins, instead of re-applying every time the ship acts.",
    "Combat sim: Judge's, Chakara's, Incinerator's, and Rhodium's round-boundary damage, plus Grif's and FrontLine's reactive damage procs, now respect the target's defense, matching every other attack in the game — this damage previously ignored defense entirely. It can also land critical hits now, except for Rhodium's round-boundary damage and Grif's proc, whose skill text says 'cannot critically hit'.",
    "Skill parsing fixes: Panon's \"If this Unit is Provoked or Taunted\" branch (and Thresh's \"more damage when affected by Taunt or Provoke\" bonus) now correctly check the ship's own status instead of the enemy's; Bayah's Terran Bolster II and Oleander's second buff pair now keep their turn durations in multi-buff sentences instead of dropping them; and Nyxen's cleanse now records the debuff category it targets (Bombs / damage-over-time).",
    "Skill parsing: several conditional damage bonuses that were previously dropped are now modeled. Rikra's bonus vs Taunted or Provoked enemies, Wrecker's bonus vs enemies with Inferno, Yin Jian's bonus while Stealthed, Crucialis's charged-skill bonus on a critical hit, and Gallant's higher damage (and Stasis) against Defenders now apply. Valiant's and Sustainer's charged skills now scale their damage with the number of buffs on the caster. Rikra's Defense Up buff is also no longer mistakenly treated as self-conditional on Taunt/Provoke.",
    "Skill parsing: per-count repairs now scale in the skill model — Oleander's active repair gains an extra 8.5% per debuffed enemy, and Meatshield's charged repair scales at 1.5% per debuff on itself, instead of showing a flat repair.",
    "Combat sim: Malvex's, Quixilver's, and FrontLine's bonus damage that scales with their own current Shield is now modeled — it uses their live Shield pool at the moment they attack, so it grows as their Shield does over the fight. Also added: APEX, Laika, and Malvex now strip a percentage of the target's Shield on cast (separate from Lodolite's full-strip-on-purge refit).",
    "Combat sim: added buff steal. Pallas's and Thresh's charged skills now actually steal a buff from their target instead of doing nothing extra, and Tithonus's charged skill steals a buff and grants it to herself and all adjacent allies (alongside her existing purge and damage). The stolen buff keeps its remaining duration.",
    "Combat sim: Heliodor's and Pestilence's debuff-duration-reduction passives are now modeled — when directly damaged (Heliodor) or after inflicting a debuff (Pestilence), all active debuffs on the affected ship(s) now actually lose 1 turn of duration, instead of only the paired repair effect applying.",
    "Combat sim: several defensive passives are now modeled. Nosorog reflects damage back at an attacker that directly hits her as its primary target; Chakara's charged skill now bypasses part of the enemy's Defense; and Anemone, Panon, Wusheng, and Tormenter each take reduced damage under their stated conditions — Anemone and Wusheng take less direct damage (from an enemy afflicted with a damage-over-time effect, and while Stealthed, respectively), while Panon reduces all incoming damage (direct and damage-over-time) while she has Barrier Recharging, and Tormenter's reduction (both direct and damage-over-time) grows as her HP drops.",
    'Combat sim: several "when hit" passives now actually trigger on being attacked instead of never firing. Bizon gains XAOC Swiftness on receiving direct damage, Sansi inflicts Inc. Repair Down when hit, and Purifier cleanses a debuff when directly damaged.',
    'Combat sim: several "on killing an enemy" passives now actually trigger on a kill instead of never firing. Madax and Rikra repair themselves when an enemy dies, and Obsidian and Valiant gain charges for their Charged Skill on a kill.',
    'Combat sim: Crocus now repairs herself when another ally lands a critical Damage Over Time hit, matching her skill text, instead of only healing on her own turn.',
    "Combat sim: reactive Damage-over-Time effects now land on the real enemy that was hit instead of being lost — Crocus's on-ally-crit Corrosion lands on the enemy the ally struck, and on-attack Inferno gear (Burner set) lands on the enemy the wearer attacked. This also removes a phantom 'enemy' entry that could appear at the end of a round in team battles showing an inflated Corrosion/Inferno tick.",
    'Combat sim: Valkyrie and her lowest-HP ally now repair when her Echoing Burst detonates on an enemy, matching her skill text, instead of the repair never firing.',
    'Combat sim: Oleander now grants Repair Over Time II to an ally who inflicts a debuff (once per ally each round), matching her skill text, instead of the grant never firing.',
    'Combat sim: Hayyan now repairs an ally for 6% of her Max HP whenever a debuff is inflicted on that ally, matching her skill text, instead of the repair never firing.',
    'Combat sim: Ruiner now inflicts Bomb II on any enemy that performs a repair (once per round per enemy), matching her skill text, instead of never firing. Amartya now inflicts a stack of Defense Shred on the specific enemy defender that was just repaired, instead of never firing.',
    'Combat sim: Howler now cleanses a debuff from (and, with her refit, grants a stack of Blast to) the specific ally who just landed a critical hit, matching her skill text, instead of never firing.',
    'Combat sim: Cultivator now repairs the specific ally whose debuff she just cleansed for 4% of her Max HP, and Hayyan does the same for 4%, matching their skill text instead of never firing. Morao now repairs an extra 5% of her Max HP and gains Defense Up II whenever her own cleanse actually removes a debuff, instead of always firing regardless.',
    'Combat sim: Nuqtu now cleanses a debuff from herself (once per round) and gains Terran Bolster III whenever an enemy actually gets buffed, matching her skill text, instead of always firing on her own turn regardless of enemy buffs.',
    'Combat sim: Vindicator now retaliates when it resists an enemy debuff, dealing damage equal to 30% of its max HP to that enemy.',
    'Combat sim: Curator now inflicts Block Buff only when an enemy uses its Charged skill (its intended reaction), instead of also inflicting it on every one of its own turns — a duplicate application has been removed.',
    'Combat sim: Paracelsus now retaliates for 50% of its max HP and grants allies Everliving Regeneration II when killed by direct damage (previously the regen buff fired on every cast and the retaliation was missing).',
    'Combat sim: Ravager now gains Hacking Module Overdrive when a debuff it inflicts is resisted (previously the buff was granted on every cast).',
    'Combat sim: Voron now correctly takes 20% less damage from Damage-over-Time effects.',
    "Combat sim: Nosorog's Defense Up II now triggers when it removes a debuff (previously fired on every cast).",
    'Combat sim: Malvex now takes 10% less damage while it has an active shield.',
    "Combat sim: Bayah's charged skill now inflicts Stasis only when she has more Crit Power than the target, instead of always applying it.",
    "Combat sim: Cobalt's active skill now deals its extra damage (25% of max HP) only when it has more HP than the enemy, instead of always applying the bonus.",
    "Combat sim: Chakara's active skill now gains a Charged Skill charge only when all damaged enemies have more Speed than her, instead of always granting the charge.",
    "Combat sim: Berserker's Marauder Rage passives now only trigger when its attack actually hits 3 or more enemies, instead of always applying.",
    "Combat sim: Tygr's active skill now adds a Charged Skill charge only when it actually damages 2 or more enemies, instead of always granting the charge (including against a single target).",
    "Combat sim: Anemone's charged skill now gains Taunt only when the primary enemy actually has 3 or more Damage over Time effects, instead of always granting it. Belladonna's charged skill now models its \"3 or more Acidic Decay\" Stasis gate too, though it won't actually trigger in combat until the Acidic Decay status itself is added in a future update.",
    "Combat sim: Snakeroot's passive bonus damage now actually scales with the number of Damage-over-Time effects on the target (30% per stack, up from a flat 120% regardless of stacks), instead of always applying the full amount.",
    "Combat sim: Voron and Orel now convert incoming direct damage into a Damage-over-Time effect (spread over 3 turns) instead of taking it all up front — Orel only against attackers affected by Taunt or Provoke. Combined with Voron's existing 20%-less-from-DoT reduction, this smooths and softens the hits it takes.",
    'Combat sim: Belladonna now converts an ally\'s Corrosion into Acidic Decay of the same level (chance scaling with her Hacking) and can extend the new Acidic Decay by a turn, matching her skill text. Her charged skill\'s "3 or more Acidic Decay" Stasis gate now actually triggers in combat.',
    'Panon now deals its boosted damage (120%/170%) when Provoked or Taunted, matching its in-game "instead" effect.',
    "Meatshield now protects non-defender allies — direct damage to them is calculated against Meatshield's much higher defense.",
    "Combat sim: Lingshe's charged skill now reduces enemy Bomb timers (hacking-gated), detonating any that reach zero.",
    "Combat sim: AEGIS now grants Defense Up II and cleanses all debuffs from an ally within its Active pattern when that ally's Shield is destroyed, matching its skill text, instead of always granting Defense Up II to the whole team and cleansing itself on every cast.",
    "Combat sim: Wusheng's charged skill now always strikes with affinity advantage; Isha and Nayra's Affinity Override buffs now force affinity advantage on offense and defense, including their two-ship synergy (each grants the other its extra Override only when both are on the team).",
    'Kinetik and Cinya now correctly apply their per-turn shield / repair at the start of each of their turns (previously modelled as a one-off on cast).',
    'Meatshield now gains its 3 stacks of Protection once at the start of combat, instead of accumulating a stack on every skill use.',
    'Cobalt\'s start-of-turn "Out. Damage Up II" buff now boosts every one of its turns while at full HP, instead of every other turn.',
    "FrontLine's reactive shield (on an enemy charged skill) now scales off the actual damage it deals — accounting for enemy defense, crits, and affinity — instead of a flat approximation.",
    'Butcher now correctly gains Marauder Rage II when it inflicts a debuff in team battles (previously the buff only applied in the single-target DPS view).',
    "Combat sim: Sentinel no longer damages or heals on its own turn. Its reaction-only passives now correctly fire when an ally critically hits an enemy — dealing its bonus damage to that enemy and repairing the ally who landed the crit — instead of leaking onto Sentinel's own turn.",
    'Combat log: reactive damage and reactive repairs now show up in the log, nested under the turn that triggered them. Previously these procs (Sentinel, Grif, FrontLine, Judge, Vindicator, Paracelsus, and other "when …" damage/heal reactions) were applied but never displayed.',
    'Combat sim: Hermes now gains 1 charge per ally attack that lands a critical hit, instead of one charge per critical hit — a multi-hit or multi-target attack that crits several times now grants a single charge, matching the skill text.',
    'Combat sim: direct damage to a ship in Stasis now reduces its remaining Stasis by one turn instead of removing Stasis entirely — the target wakes up sooner with each hit rather than immediately.',
    "Combat sim: Damage-over-Time effects (Corrosion, Inferno, Bomb, and transform DoTs) now show up in a ship's active debuff list in the battle playback, alongside its other debuffs.",
    'Combat sim: fixed the HP shown for Voron (and Orel) after a hit is converted into a Damage-over-Time effect — the battle playback no longer double-counts the converted hit, so the HP bar reflects the real remaining HP.',
    'Combat log now shows damage-over-time (corrosion/inferno) tick damage each round.',
    'Combat log now shows counter-attacks and damage reflection.',
    "Combat log turns now include a collapsible snapshot of the acting ship's current modelled stats (HP, attack, defence, crit, speed, hacking, security).",
    'Combat sim: reactive self-buff passives (e.g. Hermes Everliving Regeneration) no longer trigger multiple times against area-of-effect and multi-hit attacks — they now apply once per attack.',
    'Combat sim: ships now enter combat with their fully-geared Security (and Shield Penetration), instead of falling back to un-geared base values — a ship showing 359 Security on its details page now fights with 359, not its base value. This affects how reliably debuffs land.',
    "Combat sim: AoE healing is now modelled. Support healers (e.g. Hermes) repair EVERY ally within their targeting pattern each cast — just like buffs — instead of a single ally. This also fixes player-team healers that previously healed no one (their heal was routed to a fixed ally outside the healing pattern), so player and enemy healers now behave identically. Healers whose skill explicitly targets one ally (e.g. Volk's 'ally with the most missing health') still heal a single lowest-HP ally.",
    "Combat sim: AoE heals now restore each ally's real HP (previously only one ally per team was actually healed), and the Abundant Renewal implant now works — when a healer over-repairs an ally, that ally gains a Shield equal to a share of the over-repaired amount. Each over-repaired ally gets its own shield scaled to its own overheal, on both teams.",
    "Combat sim now models Protection as a damage transfer: a ship holding Protection stacks (e.g. Meatshield) intercepts 10% per stack of the direct damage its allies take, absorbed on the protector's own defense — the attacker's affinity match-up against the original target is unchanged. Multiple protectors cascade in speed order.",
    'Combat sim: Lionheart now gains 10 stacks of Protection each round and absorbs the first hit redirected from an ally, then loses all Protection until the next round.',
    'Combat sim: Protection now redirects damage from any living ally, not only adjacent ones.',
];

export const CHANGELOG: ChangelogEntry[] = [
    {
        version: '1.64.0',
        date: '2026-06-19',
        changes: [
            'Simulator page (EXPERIMENTAL): new in progress combat simulator, with positioning, per round damage etc. More to come.',
            'Added squad leader page.',
            'Added targeting and pattern rules to ships.',
        ],
    },
    {
        version: '1.63.0',
        date: '2026-05-27',
        changes: [
            'DPS Calculator upgrades: team support ships (up to 4) contribute skill buffs and debuffs; buffs track active rounds with hover details; hacking/security stats model debuff landing probability; affinity scales hacking; corrosion DoT capped at 5000/1%/stack/round.',
            'Calculator pages auto-fill buff and debuff pickers from the selected ship\'s skill text, with a "skill" badge on pre-populated entries.',
            'Lore page audio reader — play ship bios and world lore via text-to-speech with a Play All option. Best in Edge.',
            'Autogear: implant type tweaks consolidated into a single Require / Exclude picker.',
            'Added proper 404 page',
        ],
    },
    {
        version: '1.62.0',
        date: '2026-05-19',
        changes: [
            'Calculator upgrades: buff pickers across DPS, Defense, Healing, and Speed; affinity modifiers and per-ship buffs (DPS); Security stat and Effective HP chart (Defense); charged heals and HoT simulation (Healing); Chrono Reaver ship selector with skill auto-fill.',
            'Ship Lore direct links; gear set dropdowns sorted alphabetically.',
        ],
    },
    {
        version: '1.61.0',
        date: '2026-05-13',
        changes: [
            'Added Engineering Optimizer — optimize your engineering spend to maximize the stats of your starred ships.',
            'Added Autogear All and Select All buttons — queue multiple ships for autogear at once from the starred ship alerts panel and the Suggested Next Autogear panel.',
            'Ship skills are now shown on the Ship Details page. The DPS Calculator auto-fills skill damage multipliers and detects "Start Charged" from your selected ship\'s skill data.',
            'DPS Calculator buff system upgraded — Attacker Buffs and Enemy Buffs / Debuffs are now picked from the full game buff list with automatic parsing, stack support, and defense penetration / DoT modifier calculations.',
        ],
    },
    {
        version: '1.60.0',
        date: '2026-05-07',
        changes: [
            "Gear Wishlist — track gear you're farming with flexible filters: slot, stars, rarity, set bonus, main stat, and substats.",
            'Import summary highlights wishlist hits in place of notable gear when matches are found',
            'Fixed several cloud sync and IndexedDB reliability issues',
        ],
    },
    {
        version: '1.59.0',
        date: '2026-05-04',
        changes: [
            'Updated profile page with a bunch of data management features. Disable cloud sync, clear cloud data. Moved backup/restore into profile.',
            'Added ship selection to calculator pages to quickly set own ships. ',
        ],
    },
    {
        version: '1.58.0',
        date: '2026-05-02',
        changes: [
            'Added Exclude implant types to autogear settings — users can now prevent specific implant types (e.g. Bulwark) from being used in autogear runs',
            'Added Buffs to autogear settings — users can now specify external stat buffs per ship in the autogear optimisation',
            'Added import summary to game import modal — shows the number of ships, gear, and implants imported',
        ],
    },
    {
        version: '1.57.0',
        date: '2026-04-27',
        changes: [
            'Added "Find Gear Upgrades" button to autogear results — navigates to Upgrade Analysis with ship, role, and stat priorities pre-filled and analysis auto-started',
            'Updated gear edit form to streamline upgrading gear.',
        ],
    },
    {
        version: '1.56.0',
        date: '2026-04-25',
        changes: [
            'Autogear settings redesigned — pick a role, then add stat priorities, set requirements, or stat bonuses via the new "Your tweaks" picker',
            'Reorder tweaks with up/down chevrons — order matters, higher tweaks weigh more',
            'Six rarely-changed filters tucked into an "Advanced options" accordion; "Ignore equipped" now defaults off',
            'Game data import validates with a schema and caps file size at 30 MB',
            'Sign-in modal redesigned — split-pane layout with a branded left panel and a tighter form on the right',
        ],
    },
    {
        version: '1.55.0',
        date: '2026-04-24',
        changes: [
            'Alt accounts — manage up to 5 additional game-account profiles under your login, each with its own ships, gear, engineering, loadouts, and optional public profile',
            'Switch profiles from the sidebar: click your profile picture to open the switcher dropdown',
            'Create, rename, and delete alts from the Profile page',
            'Drag and drop a game export JSON onto the Import button to import it — no file picker needed',
        ],
    },
    {
        version: '1.54.0',
        date: '2026-04-23',
        changes: [
            '"Use upgraded stats" auto-runs the upgrade simulation and considers unleveled gear at its simulated level-16 stats',
            'Autogear search space widened on large inventories for better results',
            'Many more implants in the autogear pool — especially majors, which were nearly excluded before',
            'Complete Sets option no longer zeroes out good layouts — now penalizes orphan pieces instead of incomplete sets',
            'Tutorial covers starring ships and Hard Requirements',
            'Fixed anonymous-user autogear console error',
        ],
    },
    {
        version: '1.53.1',
        date: '2026-04-20',
        changes: [
            'Fixed new email signups failing with "Database error saving new user"',
            'Fixed "Delete Local Storage" not actually clearing gear and implants',
            "Fixed signing out leaving the previous account's ships, gear, and stats visible",
        ],
    },
    {
        version: '1.53.0',
        date: '2026-04-18',
        changes: [
            'Stat priorities can now be flagged as Hard Requirements — the autogear optimizer retries up to 5 times to meet them, and shows the closest-miss with needed-vs-got if no feasible combo exists',
        ],
    },
    {
        version: '1.52.0',
        date: '2026-04-14',
        changes: [
            'Star your important ships to mark them as "always geared" — a persistent alert panel appears when starred ships have empty gear or implant slots',
            'After equipping autogear suggestions, a "Suggested Next Autogear" list shows donor ships that lost gear and starred ships needing attention — click to select them as the next autogear target',
            'Star toggle available on ship cards and autogear gear suggestions',
            'Alert panel is minimizable and stacks above the joke corner',
        ],
    },
    {
        version: '1.51.0',
        date: '2026-04-11',
        changes: [
            'Expanded DPS calculator with multi-round simulation — compare burst vs ramping ships over configurable combat rounds',
            'Added active/charged skill cycle with charge count support',
            'Added DoT support: corrosion, inferno, and bombs with configurable tiers, stacks, and duration',
            'New round-by-round cumulative damage chart with per-source tooltip breakdown',
        ],
    },
    {
        version: '1.50.0',
        date: '2026-03-31',
        changes: [
            'Loadout cards now have an Expand button that opens a modal showing full gear details and calculated stats',
            'Added Edit button to individual and team loadouts — opens the form pre-filled with the current name and ship for quick updates',
            'Added per-ship Equip button on team loadout cards to equip individual ships without equipping the whole team',
            'Fixed loadout equipping — gear assignments are now atomic (previously, rapid individual equip calls could race and overwrite each other)',
            'Gear conflict warning when equipping a loadout — a confirmation dialog lists which gear will be unequipped from other ships before proceeding',
            'New "Save as loadout" action in the ship card dropdown menu — quickly snapshot a ship\'s current gear as a named loadout',
            'Expanded loadout modal now shows full stat totals (base + gear + engineering + refits + implants)',
            'Stale gear detection — loadout cards show a warning when gear pieces no longer exist in inventory',
        ],
    },
    {
        version: '1.49.0',
        date: '2026-03-29',
        changes: [
            'Statistics charts now show rarity color-coded stacked bars — see the breakdown by rarity across gear sets, main stats, star levels, level distribution, gear slots, implant types, and implant set bonuses',
            'Refits by Rarity chart on the Ships tab is now color-coded by rarity',
            'Fixed labels across all statistics tabs — ship roles, factions, gear sets, gear slots, main stats, and implant set bonuses now display proper names instead of internal keys',
        ],
    },
    {
        version: '1.48.0',
        date: '2026-03-26',
        changes: [
            'Added monthly statistics snapshots — your stats are automatically saved each month so you can track your progression over time',
            'Compare with previous months via the dropdown on the Statistics page. Metric cards show delta indicators and charts display side-by-side grouped bars',
            'Added "Total Tokens Spent" card to the Engineering statistics tab',
            'Implant set bonus charts (minor, major, ultimate) now support snapshot comparison',
        ],
    },
    {
        version: '1.47.0',
        date: '2026-03-24',
        changes: [
            'Added Synthwave theme — toggle it from the sidebar (sparkles icon). Features neon glowing buttons, chrome metallic headers, CRT scanlines, synthwave background, gradient cards/modals, chromatic aberration on ship images, and more.',
            'Synthwave theme includes Orbitron and Exo 2 fonts for a retro-futuristic feel',
            'VHS static glitch transition when switching themes',
            'Added synthwave soundtrack with play/pause control in the sidebar',
            'Theme preference saved locally and persists across sessions',
        ],
    },
    {
        version: '1.46.0',
        date: '2026-03-19',
        changes: [
            'Added Lore page with two tabs: Ship Bios (149 ships with searchable bios, quotes, and authors) and World Lore (30 articles from starborne.com)',
            'Ship database cards now have a dropdown menu with compare, leaderboard, add to fleet, and read bio actions',
            'Ship bios replaced with official data from the developers, including character quotes and authors',
            'Cross-tab search on the lore page — search results from the other tab appear below with a section header',
            'Added help text to hit deconstruction calculator explaining defender buff sign conventions',
            'Reorganized sidebar: Ships, Lore, Implants, and Effects grouped under Database',
        ],
    },
    {
        version: '1.45.0',
        date: '2026-03-16',
        changes: [
            'Added arena season modifiers. Admins can create seasons with stackable stat modifier rules (filtered by faction, rarity, or role). Users can enable "Apply arena modifiers" in autogear settings to have the algorithm account for active arena season buffs when scoring gear.',
            'Autogear results show a 3rd column for stats and simulation with arena modifiers applied when enabled.',
        ],
    },
    {
        version: '1.44.0',
        date: '2026-03-15',
        changes: [
            'Added multiplier mode to autogear stat bonuses. Multiplier mode scales the role score by the stat value, useful for builds that want a stat to scale proportionally with the role (e.g., hacking on an attacker).',
            'Added click-to-copy on ship database skill buttons',
        ],
    },
    {
        version: '1.43.0',
        date: '2026-03-01',
        changes: [
            'Added video/image showcase to ship details page',
            'Added visual improvements to encounter pages',
            'Separated engineering and scoring roles in preview upgrade',
            'Fixed autogear lock button showing on gear already belonging to the ship being optimized',
            'Fixed overwriting existing stat priority instead of adding duplicates',
        ],
    },
    {
        version: '1.42.0',
        date: '2026-02-25',
        changes: [
            'Added Chrono Reaver calculator page',
            'Added charge skill charge to skill tooltip',
            'Added gear sorting by stat type to gear inventory',
            'Added ship sorting based on ship power to ship inventory',
        ],
    },
    {
        version: '1.41.0',
        date: '2026-02-21',
        changes: [
            "Added lock icon to already equipped gear pieces in autogear results. Clicking it will lock the gear to the ship it's equipped on and re-run autogear.",
        ],
    },
    {
        version: '1.40.0',
        date: '2026-02-17',
        changes: ['Added tutorials. Will be populated over time.'],
    },
    {
        version: '1.39.0',
        date: '2026-02-11',
        changes: [
            'Added video to ship cards. Will populate these gradually over time.',
            'Changed ship index page to use bigger images and collapsed stats.',
        ],
    },
    {
        version: '1.38.1',
        date: '2026-02-03',
        changes: [
            'Fixed a bug with asphodel/tormenter r2 crit rate',
            'Added some more useful numbers in the engineering preview',
        ],
    },
    {
        version: '1.38.0',
        date: '2026-01-27',
        changes: [
            'Added ship comparison panel to ship inventory and ship index page',
            'Added engineering preview tab to engineering stats page',
        ],
    },
    {
        version: '1.37.0',
        date: '2026-01-25',
        changes: [
            'Removed AI recommendations',
            'Added community recommendations',
            'Added share recommendation form',
        ],
    },
    {
        version: '1.36.0',
        date: '2026-01-21',
        changes: [
            'Added gear expand button in ship details page',
            'Added ship copy image to clipboard button in ship card',
            'Added buffs, skill multiplier to DPS calculator',
        ],
    },
    {
        version: '1.35.0',
        date: '2026-01-10',
        changes: [
            'Added critcal damage reduction to autogear',
            'Added hardened gear set',
            'Added gear main/sub stat filters to gear inventory',
        ],
    },
    {
        version: '1.34.0',
        date: '2026-01-07',
        changes: [
            'Added ship specific gear upgrade suggestions. PROTIP: Select a role to accompany a ship, as it takes quite a bit longer to compute with a ship.',
            'Added shortcut to ship details from autogear for quick swapping of implants.',
            'Fixed an issue with tooltips in offcanvases and modals.',
        ],
    },
    {
        version: '1.33.1',
        date: '2026-01-02',
        changes: ['MASSIVE AUTOGEAR PERFORMANCE OPTIMIZATION, insert wine glass emoji here'],
    },
    {
        version: '1.33.0',
        date: '2025-12-24',
        changes: ['Added defensive security debuffer role'],
    },
    {
        version: '1.32.0',
        date: '2025-12-21',
        changes: ['Added Speed calculator page'],
    },
    {
        version: '1.31.0',
        date: '2025-12-19',
        changes: [
            'Added Arcane Siege calculations to autogear',
            'Added gear set filter to upgrade analysis',
        ],
    },
    {
        version: '1.30.0',
        date: '2025-12-18',
        changes: ['Added CODE GUARD / CIPHER LINK calculations to the system'],
    },
    {
        version: '1.29.0',
        date: '2025-12-17',
        changes: ['Added role and stat filters to gear upgrade analysis'],
    },
    {
        version: '1.28.0',
        date: '2025-12-13',
        changes: ['Added calibration calculator'],
    },
    {
        version: '1.27.0',
        date: '2025-12-09',
        changes: ['Added profile page for logged in users'],
    },
    {
        version: '1.26.0',
        date: '2025-12-06',
        changes: [
            'Added bomb damage to debuffer stats',
            'Added implant testing/quick swap in the simulation page',
        ],
    },
    {
        version: '1.25.1',
        date: '2025-12-02',
        changes: [
            'Added AND mode to recruitment calculator',
            'Added affinity adjustments to recruitment calculator',
        ],
    },
    {
        version: '1.25.0',
        date: '2025-12-01',
        changes: ['Added recruitment calculator'],
    },
    {
        version: '1.24.1',
        date: '2025-11-21',
        changes: ['Added engineering points ranking to the engineering stats page'],
    },
    {
        version: '1.24.0',
        date: '2025-11-20',
        changes: [
            'Added statistics page',
            'Added edit button to gear in the gear upgrade analysis for easy update after upgrade in game.',
        ],
    },
    {
        version: '1.23.0',
        date: '2025-11-07',
        changes: ['Added effect index page'],
    },
    {
        version: '1.22.0',
        date: '2025-11-03',
        changes: ['Added optimize implants option to autogear'],
    },
    {
        version: '1.21.2',
        date: '2025-10-17',
        changes: [
            'Increased simulation count for gear upgrade analysis',
            'Separated upgrade analysis into analysis and simulation',
            'Added manual gear upgrade analysis button',
        ],
    },
    {
        version: '1.21.1',
        date: '2025-10-16',
        changes: ['Added max level filter to gear upgrade analysis'],
    },
    {
        version: '1.21.0',
        date: '2025-10-03',
        changes: ['Added AI autogear suggestions', 'Added admin tools'],
    },
    {
        version: '1.20.1',
        date: '2025-09-10',
        changes: ['Added supporter(shield) role'],
    },
    {
        version: '1.20.0',
        date: '2025-08-14',
        changes: ['Added leaderboard pages for ships, in the ship index page.'],
    },
    {
        version: '1.19.3',
        date: '2025-08-07',
        changes: [
            'Added print button to autogear page',
            'Added corrosion debuffer role',
            'Changed def pen chart to show damage increase.',
        ],
    },
    {
        version: '1.19.2',
        date: '2025-08-05',
        changes: ['Added rarity filter to upgrade analysis'],
    },
    {
        version: '1.19.1',
        date: '2025-08-05',
        changes: [
            'Fixed a bug with upgrade analysis, where percentage only set bonus stats where not taken into consideration.',
        ],
    },
    {
        version: '1.19.0',
        date: '2025-08-04',
        changes: ['Added defense penetration to DPS calculator'],
    },
    {
        version: '1.18.2',
        date: '2025-07-11',
        changes: ['Added level range and stat type filters to gear inventory.'],
    },
    {
        version: '1.18.1',
        date: '2025-07-11',
        changes: [
            'Autogear with simulated upgrades, now only takes into consideration the main stat upgrade, not the substats.',
        ],
    },
    {
        version: '1.18.0',
        date: '2025-07-10',
        changes: ['Added JSON diff calculator', 'Added optional import to cubedweb'],
    },
    {
        version: '1.17.2',
        date: '2025-07-07',
        changes: [
            'Fixed a bug with syncing to the backend when uploading a new export file.',
            'Added better notifications when importing data',
        ],
    },
    {
        version: '1.17.1',
        date: '2025-07-07',
        changes: [
            'Fixed a bug with gear upgrade analysis',
            'Fixed a bug with import, readded window refresh',
        ],
    },
    {
        version: '1.17.0',
        date: '2025-06-29',
        changes: ['Added support for autogearing multiple ships at once.'],
    },
    {
        version: '1.16.0',
        date: '2025-06-26',
        changes: [
            'Added implant slot to the ship card on the ship details page, to be able to swap implants.',
        ],
    },
    {
        version: '1.15.1',
        date: '2025-06-26',
        changes: ['Made autogear page more compact, and moved settings to a modal.'],
    },
    {
        version: '1.15.0',
        date: '2025-06-24',
        changes: [
            'Added tryToCompleteSets option to autogear. This option penalizes incomplete sets.',
            'Adjusted defender scoring to be more accurate, by reducing the number of enemies to 2, and increasing the enemy attack to 40k.',
        ],
    },
    {
        version: '1.14.1',
        date: '2025-06-23',
        changes: ['Fixed a bug with set bonus calculation of 4 piece sets'],
    },
    {
        version: '1.14.0',
        date: '2025-06-22',
        changes: [
            'Added crit 100% to Asphodel and Tormenter import',
            'Added hard check to autogear stat priorities',
            'Fixed a bug with offcanvas z-index',
        ],
    },
    {
        version: '1.13.1',
        date: '2025-06-21',
        changes: ['Improved autogear performance'],
    },
    {
        version: '1.13.0',
        date: '2025-06-17',
        changes: ['Added persistent autogear config per ship'],
    },
    {
        version: '1.12.1',
        date: '2025-06-17',
        changes: ['Added total upgrade cost to upgraded gear cards and gear suggestions'],
    },
    {
        version: '1.12.0',
        date: '2025-06-16',
        changes: [
            'Added gear slot tabs to gear analysis, so you can see the upgrades with the best probability of improving the role score for each slot, for each role.',
        ],
    },
    {
        version: '1.11.0',
        date: '2025-06-16',
        changes: [
            'Added gear upgrade simulation',
            'Added possibility in autogear to use upgraded stats',
        ],
    },
    {
        version: '1.10.0',
        date: '2025-06-14',
        changes: ['Added ship image view mode'],
    },
    {
        version: '1.9.0',
        date: '2025-06-13',
        changes: ['Added Help page'],
    },
    {
        version: '1.8.1',
        date: '2025-06-11',
        changes: ['Fixed ship details page after implants rework.'],
    },
    {
        version: '1.8.0',
        date: '2025-06-11',
        changes: [
            'Added implants as gear, as a first step to autoimplants, so you can browse implants in the gear inventory. NOTE: This require a re-import of your data.',
        ],
    },
    {
        version: '1.7.2',
        date: '2025-06-08',
        changes: ['Added high security defender role', 'Roles are now persisted between imports'],
    },
    {
        version: '1.7.1',
        date: '2025-06-07',
        changes: [
            'Fixed a bug with offensive debuffer score calculation',
            'Moved ship data to indexedDB',
            'Fixed a bug with equipping gear already equipped, not always unequipping from other ships',
        ],
    },
    {
        version: '1.7.0',
        date: '2025-06-07',
        changes: ['Added stat bonuses to autogear settings'],
    },
    {
        version: '1.6.0',
        date: '2025-06-07',
        changes: [
            'Added IndexedDB for gear inventory, to support HUGE inventories',
            'Add sorting ships by specific stats',
        ],
    },
    {
        version: '1.5.0',
        date: '2025-06-06',
        changes: [
            'Added defense penetration to attacker autogear calculation',
            'Added search by equipped ship to gear inventory',
        ],
    },
    {
        version: '1.4.1',
        date: '2025-06-06',
        changes: [
            'Fixed a bug with implant import',
            'Fixed a bug with ship import',
            'Fixed a bug with inventory import',
        ],
    },
    {
        version: '1.4.0',
        date: '2025-06-03',
        changes: ['Added bomber debuffer role'],
    },
    {
        version: '1.3.1',
        date: '2025-06-02',
        changes: [
            'Smoothed out inventory loading',
            'Fixed an issue where import was stalling',
            'Lock state is now saved between imports',
        ],
    },
    {
        version: '1.3.0',
        date: '2025-05-31',
        changes: [
            'Added lock ship equipment in Autogear page',
            'Adjusted debuffer score to be more accurate',
            'Added defensive debuffer role',
        ],
    },
    {
        version: '1.2.0',
        date: '2025-05-31',
        changes: [
            'Added set bonus stats to gear piece display',
            'Added set bonus stats to gear upgrade analysis',
            'Added autofocus to searchbars in gear and ship filters.',
            'Added better sorting to ship selector, and autofocus on searchbar',
            'Revamped gear upgrade analysis, shows better recommendations, and shows more pieces.',
            'Added ignore unleveled gear option to autogear',
        ],
    },
    {
        version: '1.1.0',
        date: '2025-05-31',
        changes: [
            'Adjusted autogear algorithm to be scalable to inventory size',
            'Simplified autogear filtering',
            'Removed numerous loads from db, relying on optimistic updates instead. Page refresh fetches all data again.',
        ],
    },
    {
        version: '1.0.3',
        date: '2025-05-30',
        changes: ['Fixed an issue with ship lock states'],
    },
    {
        version: '1.0.2',
        date: '2025-05-30',
        changes: [
            'Added search to gear and ship inventories',
            'Added pagination to gear and ship inventories',
        ],
    },
    {
        version: '1.0.1',
        date: '2025-05-30',
        changes: ['Added gear batchloading', 'Added Piercer gear bonus'],
    },
    {
        version: '1.0.0',
        date: '2025-05-29',
        changes: ['Supabase backend', 'Import GAME DATA!'],
    },
    {
        version: '0.26.0',
        date: '2025-04-09',
        changes: ['Added implant database page'],
    },
    {
        version: '0.25.0',
        date: '2025-04-07',
        changes: ['Added shared encounters page'],
    },
    {
        version: '0.24.2',
        date: '2025-03-28',
        changes: ['Added buffs data', 'Added buff/debuff tooltip'],
    },
    {
        version: '0.24.1',
        date: '2025-03-28',
        changes: ['Better handling of corrupted ship data'],
    },
    {
        version: '0.24.0',
        date: '2025-03-26',
        changes: ['Added healing calculator', 'Added hit deconstruction calculator'],
    },
    {
        version: '0.23.0',
        date: '2025-03-18',
        changes: [
            'Added navigation levels',
            'Added DPS calculator',
            'Added Effective HP calculator',
        ],
    },
    {
        version: '0.22.0',
        date: '2025-03-03',
        changes: [
            'Added shield and hp regen(heal on hit) stats',
            'Redid defender calculations to be more accurate, by increasing the number and strength of enemies in the simulation. Defender score is now based on how many rounds survived, rather than effective hp. This is done to be able to calculate the effect of shield set, and healing on hit on some ships.',
            "Units such as Heliodor and Cultivator can be reimported or for Isha added as a refit value to reflect the healing on hit into calculations. I've called this new stat HP Regen.",
        ],
    },
    {
        version: '0.21.0',
        date: '2025-02-27',
        changes: ['Added gear set priority form to the autogear settings page'],
    },
    {
        version: '0.20.1',
        date: '2025-02-26',
        changes: ['Added quick add to ship index page'],
    },
    {
        version: '0.20.0',
        date: '2025-02-25',
        changes: ['Added ship index page', 'Added some spice to the styling'],
    },
    {
        version: '0.19.0',
        date: '2025-01-28',
        changes: [
            'Added gear/implant swapping in simulation page',
            'Added collapsible implant/refit forms, with better mobile support',
        ],
    },
    {
        version: '0.18.2',
        date: '2025-01-28',
        changes: ['Ship dropdown menu with some nice shortcuts'],
    },
    {
        version: '0.18.1',
        date: '2025-01-26',
        changes: ['Added possibility to delete account from home page'],
    },
    {
        version: '0.18.0',
        date: '2025-01-26',
        changes: ['Added login', 'Added firebase storage', 'Styling & performance tweaks'],
    },
    {
        version: '0.17.0',
        date: '2025-01-21',
        changes: ['Added gear upgrade analysis', 'Fixed a bug with gear/ship link'],
    },
    {
        version: '0.16.4',
        date: '2025-01-15',
        changes: [
            'Added persistent filters/sorting on gear and ship inventories',
            'Upgrade suggestion tweaks',
        ],
    },
    {
        version: '0.16.3',
        date: '2025-01-13',
        changes: [
            'Added upgrade suggestions',
            'Added max limit to predefined modes secondary requirements',
        ],
    },
    {
        version: '0.16.2',
        date: '2025-01-10',
        changes: ['Added secondary requirements to autogear'],
    },
    {
        version: '0.16.1',
        date: '2025-01-09',
        changes: [
            'Adjusted effective hp calculation to be much more accurate, thanks to Engwaraato for the new formula',
        ],
    },
    {
        version: '0.16.0',
        date: '2025-01-09',
        changes: [
            'Added backup and restore feature',
            'Added ship details page with stat breakdown, refits and implants and gear slot analysis',
            'Updated ship data with more accurate stats, and more ships',
        ],
    },
    {
        version: '0.15.1',
        date: '2025-01-07',
        changes: [
            'Adjust stat forms',
            'Added Valkyrie ship, and adjust Liberator stats',
            'Add stat breakdown for ships',
        ],
    },
    {
        version: '0.15.0',
        date: '2025-01-06',
        changes: [
            'Added encounter export as image',
            'Added encounter description',
            'further adjustments to autogear algorithm',
        ],
    },
    {
        version: '0.14.3',
        date: '2025-01-06',
        changes: [
            'Autogear algorithm now always include the gear of the selected ship in the calculations',
        ],
    },
    {
        version: '0.14.2',
        date: '2025-01-05',
        changes: ['Fixed a bug with main stat value calculation on types hacking and security'],
    },
    {
        version: '0.14.1',
        date: '2025-01-05',
        changes: [
            'Added buffer role to autogearing predefined modes, focusing on speed, boost set and lastly effective hp',
            'Added manual stat priority weights',
            'Several adjustments to autogear algorithm and simulation, focusing on debuffers and defenders',
        ],
    },
    {
        version: '0.14.0',
        date: '2025-01-03',
        changes: ['Added home page', 'Added joke corner'],
    },
    {
        version: '0.13.0',
        date: '2025-01-03',
        changes: ['Added main stat value suggestions in gear form, based on stars and level'],
    },
    {
        version: '0.12.1',
        date: '2024-12-31',
        changes: ['Adjusted gear piece display to show the ship it is equipped on'],
    },
    {
        version: '0.12.0',
        date: '2024-12-31',
        changes: ['Added ship lock state, that will lock the equipment on the ship'],
    },
    {
        version: '0.11.0',
        date: '2024-12-28',
        changes: ['Added encounter list'],
    },
    {
        version: '0.10.0',
        date: '2024-12-22',
        changes: [
            'Added shipId to gear to stop duplicated gear on ships, both for ship page and autogearing',
            'Added team loadouts',
        ],
    },
    {
        version: '0.9.1',
        date: '2024-12-21',
        changes: [
            'Reworked autogear strategies to get better results',
            'Added autogear progress indicator',
            'Adjusted autogear view',
        ],
    },
    {
        version: '0.9.0',
        date: '2024-12-20',
        changes: ['Added autogear brute force mode', 'Improved predefined modes'],
    },
    {
        version: '0.8.0',
        date: '2024-12-19',
        changes: [
            'Added autogear predefined modes',
            '- Added Attacker (max damage)',
            '- Added Defender (max HP/def combo)',
            '- Added Debuffer (270 hacking / max damage)',
            '- Added Supporter (max heal output)',
        ],
    },
    {
        version: '0.7.2',
        date: '2024-12-16',
        changes: [
            'Fixed a bug with stat exclusion',
            'Added static ship data for all ships, instead of fetching from rocky',
        ],
    },
    {
        version: '0.7.1',
        date: '2024-12-15',
        changes: ['Added stat normalization', 'Optimized gear and ship forms'],
    },
    {
        version: '0.7',
        date: '2024-12-14',
        changes: ['Added notifications'],
    },
    {
        version: '0.6',
        date: '2024-12-14',
        changes: ['Added loadouts / ship profiles'],
    },
    {
        version: '0.5',
        date: '2024-12-12',
        changes: ['Added sorting', 'Formatting improvements'],
    },
    {
        version: '0.4',
        date: '2024-12-12',
        changes: [
            'Added the rest of the gear sets',
            'Added stat labels',
            'Added autogear attack simulation section',
            'Formatting improvements',
        ],
    },
    {
        version: '0.3',
        date: '2024-12-12',
        changes: [
            'Added more filters',
            'Fixed a bug with the changelog modal',
            'Added active filter display in the gear and ship inventories',
        ],
    },
    {
        version: '0.2.1',
        date: '2024-12-11',
        changes: ['Bugfix ship form', 'Modal closes on click outside'],
    },
    {
        version: '0.2.0',
        date: '2024-03-20',
        changes: [
            'Added changelog system',
            'Improved mobile responsiveness',
            'Fixed various UI bugs',
            'Added filters',
        ],
    },
    {
        version: '0.1.0',
        date: '2024-03-15',
        changes: [
            'Initial release',
            'Ship management system',
            'Gear inventory system',
            'Auto-gear calculator',
            'Engineering stats page',
        ],
    },
];
