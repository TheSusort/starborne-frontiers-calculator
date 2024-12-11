import { ChangelogEntry } from '../types/changelog';
import { APP_VERSION } from './config';

export const CURRENT_VERSION = APP_VERSION;

export const CHANGELOG: ChangelogEntry[] = [
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