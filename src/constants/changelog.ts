import { ChangelogEntry } from '../types/changelog';

export const CURRENT_VERSION = '1.57.0';

export const CHANGELOG: ChangelogEntry[] = [
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
