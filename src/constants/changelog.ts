import { ChangelogEntry } from '../types/changelog';

export const CURRENT_VERSION = '0.14.3';

export const CHANGELOG: ChangelogEntry[] = [
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
