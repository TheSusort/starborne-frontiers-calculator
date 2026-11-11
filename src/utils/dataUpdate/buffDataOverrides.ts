/**
 * Hand corrections to the upstream buff data that `npm run fetch-buffs` (updateBuffsData.ts)
 * re-applies after every fetch, so a regen cannot revert them. Each value here must also be what
 * `src/constants/buffs.ts` holds today — `buffDataOverrides.test.ts` fails when they differ.
 *
 * The official unit catalogue (starborne.com/frontiers/units, `statusEffects`) is the source for
 * every tier-magnitude correction below; the upstream fetch source has these tiers wrong.
 */
export const MANUAL_DESCRIPTION_OVERRIDES: Record<string, string> = {
    // The in-app tooltip for the bomb, including its destroyed-before-expiry splash (#161).
    'Bomb III':
        'Deals 300% Damage upon expiration. If this ship is destroyed before expiring it instead deals 75% damage to all adjacent ships. Detonation damage bypasses defense.',
    // Catalogue: "Increases Speed by 15/30/45%."
    'Speed Up I': '+15% Speed',
    // Catalogue: "Increases Security by 10/20/30 and Defense by 5/10/15%."
    'Binderburg Resilience I': '+10 Security, +5% Defense',
    'Binderburg Resilience II': '+20 Security, +10% Defense',
    // Catalogue: "Increases Incoming Repair by 10/20/30% and Security by 10/15/20"
    'Everliving Regeneration I': '+10% Incoming Repair, +10 Security',
    'Everliving Regeneration II': '+20% Incoming Repair, +15 Security',
    // Catalogue: "Increase outgoing detonation damage by 10/20/30%."
    'Out. Detonation Damage Up III': '+30% Outgoing Detonation Damage',
};

/**
 * Buff/debuff classification corrections. The catalogue files `Inc. DoT Damage Up` under
 * `kind: "Debuff"` ("Increases incoming DoT (Damage over Time) damage by 10/20/30%"); the upstream
 * fetch types it as a buff. The skill-text parser reads this type to put an "applies X" or an
 * "enemies with X" clause on the right side.
 */
export const MANUAL_TYPE_OVERRIDES: Record<string, 'buff' | 'debuff' | 'effect'> = {
    'Inc. DoT Damage Up I': 'debuff',
    'Inc. DoT Damage Up II': 'debuff',
    'Inc. DoT Damage Up III': 'debuff',
};

/**
 * Statuses the upstream fetch never produces, appended by `npm run fetch-buffs` when absent so a
 * regen cannot drop them. Each must also be present in `src/constants/buffs.ts`
 * (`buffDataOverrides.test.ts`).
 */
export const MANUAL_BUFF_ADDITIONS: Array<{
    name: string;
    description: string;
    type: 'buff' | 'debuff' | 'effect';
}> = [
    {
        name: 'Pressing Onslaught',
        description: '+10% Outgoing Direct Damage, Stackable',
        type: 'buff',
    },
    {
        name: 'Repair Self Over Time I',
        description: '10% Applying Unit HP%',
        type: 'buff',
    },
    {
        name: 'Enrage Attack III',
        description: '+6% Attack, Stackable',
        type: 'buff',
    },
    ...(
        [
            ['I', 15],
            ['II', 30],
            ['III', 45],
        ] as const
    ).map(([numeral, pct]) => ({
        name: `White Phosphorus ${numeral}`,
        description: `Deals Damage equal to ${pct}% of this units's attack, ignores defense and shield. Cannot be cleansed.`,
        type: 'debuff' as const,
    })),
    // Nifo's grants, from the catalogue: "Increases defense by 20% of the applying Unit's
    // defense" (a flat grant snapshotted from the applier, like Terran Guard) and "Reflects
    // 10/20/30% of the direct damage when hit as a primary target".
    {
        name: 'Defense Surge',
        description: '+20% Defense (Applying Unit)',
        type: 'buff',
    },
    ...(
        [
            ['I', 10],
            ['II', 20],
            ['III', 30],
        ] as const
    ).map(([numeral, pct]) => ({
        name: `Reflect ${numeral}`,
        description: `Reflects ${pct}% of the direct damage when hit as a primary target.`,
        type: 'buff' as const,
    })),
];
