import { ChangelogEntry } from '../types/changelog';

export const CURRENT_VERSION = 'v0.3';

export const CHANGELOG: ChangelogEntry[] = [
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