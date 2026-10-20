import {
    Zap,
    Ship,
    Wrench,
    Swords,
    Save,
    MapPin,
    BarChart3,
    Database,
    BookOpen,
    PieChart,
    Shield,
    Crosshair,
    HeartPulse,
    Scissors,
    FileDiff,
    Radio,
    Gauge,
    Hourglass,
    Coins,
    FlaskConical,
    GraduationCap,
    Gamepad2,
    LucideIcon,
} from 'lucide-react';

export interface HomeFeature {
    to: string;
    icon: LucideIcon;
    title: string;
    description: string;
    /** ISO date the feature shipped; shows a "New" chip until `NEW_FEATURE_DAYS` have passed. */
    addedOn?: string;
}

export interface HomeFeatureGroup {
    title: string;
    features: HomeFeature[];
}

export const NEW_FEATURE_DAYS = 60;

const DAY_MS = 24 * 60 * 60 * 1000;

/** True while a feature is younger than `NEW_FEATURE_DAYS`; missing, unparseable and future dates are not new. */
export const isNewFeature = (addedOn: string | undefined, now: Date): boolean => {
    if (!addedOn) return false;
    const added = new Date(addedOn).getTime();
    if (Number.isNaN(added)) return false;
    const ageMs = now.getTime() - added;
    return ageMs >= 0 && ageMs < NEW_FEATURE_DAYS * DAY_MS;
};

export const HOME_FEATURE_GROUPS: HomeFeatureGroup[] = [
    {
        title: 'Fleet',
        features: [
            {
                to: '/ships',
                icon: Ship,
                title: 'Fleet Manager',
                description:
                    'Comprehensive ship builder with stats, equipment, refits, and implants',
            },
            {
                to: '/ships/index',
                icon: Database,
                title: 'Ship Database',
                description: 'Browse every ship with its stats, skills, and community builds',
            },
            {
                to: '/engineering',
                icon: BarChart3,
                title: 'Engineering Bonuses',
                description: 'Track ship type bonuses and achieve 100% stat coverage',
            },
            {
                to: '/statistics',
                icon: PieChart,
                title: 'Fleet Statistics',
                description: 'See how your fleet and gear break down at a glance',
            },
            {
                to: '/ships/lore',
                icon: BookOpen,
                title: 'Ship Lore',
                description: 'Read ship bios, quotes, and background stories',
            },
        ],
    },
    {
        title: 'Gear',
        features: [
            {
                to: '/autogear',
                icon: Zap,
                title: 'AI Autogear',
                description: 'Intelligent gear optimization with recommendations for each ship',
            },
            {
                to: '/gear',
                icon: Wrench,
                title: 'Gear Inventory',
                description: 'Advanced filtering, sorting, and upgrade analysis for your gear',
            },
            {
                to: '/loadouts',
                icon: Save,
                title: 'Loadout System',
                description: 'Save and share gear setups for ships or entire teams',
            },
            {
                to: '/simulation',
                icon: FlaskConical,
                title: 'Gear Simulation',
                description: 'Test gear changes on a ship and compare the resulting stats',
            },
        ],
    },
    {
        title: 'Combat',
        features: [
            {
                to: '/simulator',
                icon: Swords,
                title: 'Combat Simulator',
                description:
                    'Test fleet compositions and strategies with detailed battle simulations',
            },
            {
                to: '/encounters',
                icon: MapPin,
                title: 'Encounter Tracker',
                description: 'Document and share fleet formations for PvE encounters and bosses',
            },
        ],
    },
    {
        title: 'Calculators',
        features: [
            {
                to: '/defense',
                icon: Shield,
                title: 'Defense Calculator',
                description: 'Work out how much damage a ship can absorb',
            },
            {
                to: '/damage',
                icon: Crosshair,
                title: 'Damage Calculator',
                description: 'Estimate DPS from stats, skills, and buffs',
            },
            {
                to: '/healing',
                icon: HeartPulse,
                title: 'Healing Calculator',
                description: 'Estimate repair output for supporters',
            },
            {
                to: '/damage-deconstruction',
                icon: Scissors,
                title: 'Hit Deconstruction',
                description: 'Break a single hit down into its damage components',
            },
            {
                to: '/json-diff',
                icon: FileDiff,
                title: 'JSON Diff Calculator',
                description: 'Compare two game exports and see what changed',
            },
            {
                to: '/recruitment',
                icon: Radio,
                title: 'Beacon Calculator',
                description: 'Plan beacon spending for recruitment',
            },
            {
                to: '/speed',
                icon: Gauge,
                title: 'Speed Calculator',
                description: 'Check turn order and speed thresholds',
            },
            {
                to: '/chrono-reaver',
                icon: Hourglass,
                title: 'Chrono Reaver',
                description: 'Calculate Chrono Reaver upgrade costs and progress',
            },
            {
                to: '/bounty-credits',
                icon: Coins,
                title: 'Bounty Credits',
                description: 'Plan your bounty credit earnings and spending',
                addedOn: '2026-10-16',
            },
        ],
    },
    {
        title: 'Extras',
        features: [
            {
                to: '/basics',
                icon: GraduationCap,
                title: 'Game Basics',
                description: 'A primer on the game systems for new players',
                addedOn: '2026-09-08',
            },
            {
                to: '/arcade',
                icon: Gamepad2,
                title: 'Arcade',
                description: 'Fly your ships in a quick arcade shooter and climb the leaderboard',
                addedOn: '2026-10-18',
            },
        ],
    },
];
