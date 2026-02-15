export interface TutorialStep {
    targetId: string;
    title: string;
    description: string;
}

export interface TutorialGroup {
    id: string;
    steps: TutorialStep[];
}

// Sidebar tutorial - shown on first visit to any page
export const SIDEBAR_TUTORIAL: TutorialGroup = {
    id: 'sidebar-import',
    steps: [
        {
            targetId: 'sidebar-import-button',
            title: 'Import Game Data',
            description:
                'Upload your game data export here to import your ships, gear, and engineering stats.',
        },
    ],
};

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
                'Each ship card shows stats and equipped gear. Use the lock button to protect gear from being reassigned by autogear. Click the menu for more actions like edit, delete, and unequip. Stats include hacking/security from Code Guard and Cipher Link.',
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
export const AUTOGEAR_COMMUNITY_TUTORIAL: TutorialGroup = {
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
                "These are the suggested gear pieces. Click 'Equip All' to apply them, 'Lock' to lock the gear to the ship, and 'Expand' to show the gear pieces as gear cards.",
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
export const AUTOGEAR_SETTINGS_TUTORIAL: TutorialGroup = {
    id: 'autogear-settings',
    steps: [
        {
            targetId: 'autogear-role-selector',
            title: 'Predefined Strategies',
            description:
                'Pick a role to auto-fill stat priorities, or choose Manual to configure everything yourself.',
        },
        {
            targetId: 'autogear-stat-priorities',
            title: 'Stat Priorities',
            description:
                "Set minimum and maximum targets for specific stats. The optimizer penalizes results that don't meet these thresholds.",
        },
        {
            targetId: 'autogear-set-priorities',
            title: 'Set Priorities',
            description: 'Require a specific number of pieces from a specific gear set.',
        },
        {
            targetId: 'autogear-stat-bonuses',
            title: 'Stat Bonuses',
            description:
                'Add small score bonuses for secondary stats. Useful for hybrid builds like a defender that also needs hacking. No normalization, so play around with this to find the best balance.',
        },
        {
            targetId: 'autogear-ignore-options',
            title: 'Gear Filters',
            description:
                "Control which gear is available to the optimizer. Ignore equipped keeps other ships' gear untouched. Ignore unleveled skips level-0 gear.",
        },
        {
            targetId: 'autogear-upgrade-options',
            title: 'Upgrade Options',
            description:
                'Use upgraded stats simulates gear at higher levels. Complete sets adds a bonus for finishing gear set requirements (Not recommended if minmaxing).',
        },
        {
            targetId: 'autogear-extra-options',
            title: 'Extra Options',
            description:
                'Optimize implants includes implant slots in the search. Include calibrated gear allows gear calibrated for other ships (scored without the calibration bonus).',
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

export const ALL_TUTORIAL_GROUPS: TutorialGroup[] = [
    SIDEBAR_TUTORIAL,
    SHIPS_INITIAL_TUTORIAL,
    AUTOGEAR_INITIAL_TUTORIAL,
    AUTOGEAR_COMMUNITY_TUTORIAL,
    AUTOGEAR_RESULTS_TUTORIAL,
    AUTOGEAR_SETTINGS_TUTORIAL,
    GEAR_TABS_TUTORIAL,
    ENGINEERING_TABS_TUTORIAL,
];
