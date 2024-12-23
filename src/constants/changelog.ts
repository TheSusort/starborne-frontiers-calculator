import { ChangelogEntry } from '../types/changelog';

export const CURRENT_VERSION = 'v0.10.0';

export const CHANGELOG: ChangelogEntry[] = [
    {
        version: 'v0.10.0',
        date: '2024-12-22',
        changes: [
            'Added shipId to gear to stop duplicated gear on ships, both for ship page and autogearing',
            'Added team loadouts',
        ]
    },
    {
        version: 'v0.9.1',
        date: '2024-12-21',
        changes: [
            'Reworked autogear strategies to get better results',
            'Added autogear progress indicator',
            'Adjusted autogear view'
        ]
    },
    {
        version: 'v0.9.0',
        date: '2024-12-20',
        changes: [
            'Added autogear brute force mode',
            'Improved predefined modes',
        ]
    },
    {
        version: 'v0.8.0',
        date: '2024-12-19',
        changes: [
            'Added autogear predefined modes',
            '- Added Attacker (max damage)',
            '- Added Defender (max HP/def combo)',
            '- Added Debuffer (270 hacking / max damage)',
            '- Added Supporter (max heal output)'
        ]
    },
    {
        version: 'v0.7.2',
        date: '2024-12-16',
        changes: [
            'Fixed a bug with stat exclusion',
            'Added static ship data for all ships, instead of fetching from rocky',
        ]
    },
    {
        version: 'v0.7.1',
        date: '2024-12-15',
        changes: [
            'Added stat normalization',
            'Optimized gear and ship forms'
        ]
    },
    {
        version: 'v0.7',
        date: '2024-12-14',
        changes: [
            'Added notifications',
        ]
    },
    {
        version: 'v0.6',
        date: '2024-12-14',
        changes: [
            'Added loadouts / ship profiles',
        ]
    },
    {
        version: 'v0.5',
        date: '2024-12-12',
        changes: [
            'Added sorting',
            'Formatting improvements',
        ]
    },
    {
        version: 'v0.4',
        date: '2024-12-12',
        changes: [
            'Added the rest of the gear sets',
            'Added stat labels',
            'Added autogear attack simulation section',
            'Formatting improvements',
        ]
    },
    {
        version: 'v0.3',
        date: '2024-12-12',
        changes: [
            'Added more filters',
            'Fixed a bug with the changelog modal',
            'Added active filter display in the gear and ship inventories',
        ]
    },
    {
        version: 'v0.2.1',
        date: '2024-12-11',
        changes: [
            'Bugfix ship form',
            'Modal closes on click outside',
        ]
    },
    {
        version: 'v0.2.0',
        date: '2024-03-20',
        changes: [
            'Added changelog system',
            'Improved mobile responsiveness',
            'Fixed various UI bugs',
            'Added filters',
        ]
    },
    {
        version: 'v0.1.0',
        date: '2024-03-15',
        changes: [
            'Initial release',
            'Ship management system',
            'Gear inventory system',
            'Auto-gear calculator',
            'Engineering stats page'
        ]
    }
];