export interface TutorialStep {
    targetId: string;
    title: string;
    description: string;
}

export interface TutorialGroup {
    id: string;
    steps: TutorialStep[];
}

// Ships page - initial visible elements
export const SHIPS_INITIAL_TUTORIAL: TutorialGroup = {
    id: 'ships-initial',
    steps: [
        {
            targetId: 'ships-filter-panel',
            title: 'Search, Filter & View',
            description:
                'Search ships by name, faction, or ship type. Filter by rarity, role, affinities, and more. Toggle between card and list view.',
        },
        {
            targetId: 'ships-create-button',
            title: 'Create Ship',
            description:
                'Manually add a ship - useful for testing loadouts before committing in-game.',
        },
        {
            targetId: 'ships-first-card',
            title: 'Ship Card',
            description:
                'Each ship card shows stats and equipped gear. Star a ship to mark it as a priority — a floating panel then alerts you whenever a starred ship has empty gear slots. Use the lock button to protect gear from being reassigned by autogear. Click the menu for more actions like edit, delete, and unequip. Stats include hacking/security from Code Guard and Cipher Link.',
        },
    ],
};

// Autogear page - initial visible elements
export const AUTOGEAR_INITIAL_TUTORIAL: TutorialGroup = {
    id: 'autogear-initial',
    steps: [
        {
            targetId: 'autogear-ship-selector',
            title: 'Select Ships',
            description: 'Select the ship(s) you want to optimize gear for.',
        },
        {
            targetId: 'autogear-settings-button',
            title: 'Settings',
            description: 'Configure stat priorities, set bonuses, and other optimization options.',
        },
        {
            targetId: 'autogear-ship-info-button',
            title: 'Ship Info',
            description:
                'View the ship details, for a detailed view of the ship and quick swaps of implants.',
        },
        {
            targetId: 'autogear-optimize-button',
            title: 'Optimize',
            description: 'Run the optimizer to find the best gear combination.',
        },
    ],
};

// Autogear - community recommendations (deferred, after ship select)
const AUTOGEAR_COMMUNITY_TUTORIAL: TutorialGroup = {
    id: 'autogear-community',
    steps: [
        {
            targetId: 'autogear-community-recommendations',
            title: 'Community Recommendations',
            description: 'Browse community-shared configurations for this ship for quick setup.',
        },
    ],
};

// Autogear - results (deferred, after optimization)
export const AUTOGEAR_RESULTS_TUTORIAL: TutorialGroup = {
    id: 'autogear-results',
    steps: [
        {
            targetId: 'autogear-gear-suggestions',
            title: 'Gear Suggestions',
            description:
                "These are the suggested gear pieces. Click 'Equip All' to apply them, 'Lock' to lock the gear to the ship, and 'Expand' to show the gear pieces as gear cards. Click on the lock icon next to an equipped gear piece to lock the gear to the ship it's equipped on and re-run autogear.",
        },
        {
            targetId: 'autogear-results-tabs',
            title: 'Results',
            description:
                "Compare your current stats vs the suggested loadout. The simulation shows estimated DPS, survivability, or healing based on the ship's role. There's built in support for ultimates Code Guard, Cipher Link and Arcane Siege.",
        },
    ],
};

// Autogear settings modal (deferred, on first open)
const AUTOGEAR_SETTINGS_TUTORIAL: TutorialGroup = {
    id: 'autogear-settings',
    steps: [
        {
            targetId: 'autogear-role-selector',
            title: 'Strategy',
            description:
                'Pick a role to auto-fill stat priorities, or choose Manual to configure everything yourself.',
        },
        {
            targetId: 'autogear-add-tweak',
            title: 'Your tweaks',
            description:
                'Add stat priorities, set requirements, or stat bonuses on top of the role defaults. Order matters — higher tweaks weigh more. Use the chevrons to reorder, or click Edit to change a value.',
        },
        {
            targetId: 'autogear-advanced-options',
            title: 'Advanced options',
            description:
                'Filters that change which gear is available to the optimizer (ignore equipped, ignore unleveled, use upgraded stats, complete sets, optimize implants, include calibrated). Click to expand.',
        },
    ],
};

// Gear page - tab overview
export const GEAR_TABS_TUTORIAL: TutorialGroup = {
    id: 'gear-tabs',
    steps: [
        {
            targetId: 'gear-tab-inventory',
            title: 'Inventory',
            description:
                'Browse, search, and filter all your gear pieces. Edit, delete, or calibrate gear from here.',
        },
        {
            targetId: 'gear-tab-calibration',
            title: 'Calibration',
            description:
                'Find the best calibration candidates for each ship, or in general for gear pieces.',
        },
        {
            targetId: 'gear-tab-analysis',
            title: 'Upgrade Analysis',
            description:
                'See which gear pieces benefit most from upgrading. Prioritize your upgrade resources on the pieces with the highest potential.',
        },
        {
            targetId: 'gear-tab-simulation',
            title: 'Simulate Upgrades',
            description:
                'Preview what your gear stats would look like at higher levels before spending resources.',
        },
    ],
};

// Gear page - upgrade analysis (deferred, on tab switch)
export const GEAR_ANALYSIS_TUTORIAL: TutorialGroup = {
    id: 'gear-analysis',
    steps: [
        {
            targetId: 'gear-analysis-run-button',
            title: 'Analyze Gear',
            description:
                'Run the analysis to find the best gear pieces to upgrade, per role. It simulates upgrading each piece to level 16 multiple times and ranks them by improvement.',
        },
        {
            targetId: 'gear-analysis-config-button',
            title: 'Config',
            description:
                'Open settings to filter by ship, role, rarity, max level, gear sets, and stat priorities. Optionally select a specific ship for more accurate results.',
        },
    ],
};

// Engineering page - tab overview
export const ENGINEERING_TABS_TUTORIAL: TutorialGroup = {
    id: 'engineering-tabs',
    steps: [
        {
            targetId: 'engineering-tab-stats',
            title: 'Engineering Stats',
            description:
                'View and manage engineering bonuses for each ship role. These bonuses apply to all ships of that role.',
        },
        {
            targetId: 'engineering-tab-preview',
            title: 'Preview Upgrade',
            description:
                'Preview how upgrading engineering stats would affect your ships before committing resources.',
        },
    ],
};

// Ship Database page
export const SHIP_DATABASE_TUTORIAL: TutorialGroup = {
    id: 'ship-database',
    steps: [
        {
            targetId: 'ship-db-filter-panel',
            title: 'Search & Filter',
            description:
                'Search ships by name or skill text. Filter by faction, role, rarity, and affinity. Sort by any stat.',
        },
        {
            targetId: 'ship-db-first-card',
            title: 'Ship Card',
            description:
                'Each card shows the ship at level 60 with base stats. Use the + button to add it to your fleet, the compare icon to view ships side by side, or the trophy to see the leaderboard.',
        },
        {
            targetId: 'ship-db-skill-buttons',
            title: 'Skill Details',
            description:
                'Hover over the skill buttons to see each skill description — active, charge, and passive abilities.',
        },
    ],
};

// Ship Details page
export const SHIP_DETAILS_TUTORIAL: TutorialGroup = {
    id: 'ship-details',
    steps: [
        {
            targetId: 'ship-details-card',
            title: 'Ship Card',
            description:
                'Full ship overview with equipped gear and implants. Click gear slots to equip or swap pieces. Use the menu for edit, delete, lock, and unequip actions.',
        },
        {
            targetId: 'ship-details-refits',
            title: 'Refits',
            description:
                'Shows all installed refits and the stat bonuses they provide. Refits are imported from your game data.',
        },
        {
            targetId: 'ship-details-stat-distribution',
            title: 'Stat Distribution',
            description:
                'Visualizes where your stats come from — base stats, gear, engineering, refits, and implants broken down per stat.',
        },
        {
            targetId: 'ship-details-upgrades',
            title: 'Upgrade Suggestions',
            description:
                'Recommendations for which gear pieces to upgrade next for the biggest stat improvements.',
        },
    ],
};

// Encounter Notes page
export const ENCOUNTER_NOTES_TUTORIAL: TutorialGroup = {
    id: 'encounter-notes',
    steps: [
        {
            targetId: 'encounters-add-button',
            title: 'Add Encounter',
            description:
                'Create a new encounter note to record a successful fleet formation. Give it a name, description, and place ships on the grid.',
        },
        {
            targetId: 'encounters-first-card',
            title: 'Encounter Card',
            description:
                'Each card shows the encounter name, description, and the fleet formation grid with ship positions.',
        },
        {
            targetId: 'encounters-card-actions',
            title: 'Actions',
            description:
                'Copy the encounter as an image, edit it, share it with the community, or delete it.',
        },
    ],
};

export const ALL_TUTORIAL_GROUPS: TutorialGroup[] = [
    SHIPS_INITIAL_TUTORIAL,
    AUTOGEAR_INITIAL_TUTORIAL,
    AUTOGEAR_COMMUNITY_TUTORIAL,
    AUTOGEAR_RESULTS_TUTORIAL,
    AUTOGEAR_SETTINGS_TUTORIAL,
    GEAR_TABS_TUTORIAL,
    GEAR_ANALYSIS_TUTORIAL,
    ENGINEERING_TABS_TUTORIAL,
    SHIP_DATABASE_TUTORIAL,
    SHIP_DETAILS_TUTORIAL,
    ENCOUNTER_NOTES_TUTORIAL,
];
