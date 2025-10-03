import { ChangelogEntry } from '../types/changelog';

export const CURRENT_VERSION = '1.21.0';

export const CHANGELOG: ChangelogEntry[] = [
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
