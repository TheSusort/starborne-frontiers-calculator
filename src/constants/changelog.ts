import { ChangelogEntry } from '../types/changelog';

export const CURRENT_VERSION = 'v0.7.1';

export const CHANGELOG: ChangelogEntry[] = [
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