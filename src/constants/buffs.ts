// Auto-generated on 2025-03-28T21:22:37.360Z
export interface Buff {
    name: string;
    description: string;
    type: 'buff' | 'debuff' | 'effect';
    imageKey?: string;
}

export const BUFFS: Buff[] = [
    {
        name: 'Hacking Up II',
        description: '+40 Hacking',
        type: 'buff',
    },
    {
        name: 'Hacking Up III',
        description: '+60 Hacking',
        type: 'buff',
    },
    {
        name: 'Atlas Coordination II',
        description: '+20% Attack',
        type: 'buff',
    },
    {
        name: 'Atlas Coordination III',
        description: '+30% Attack',
        type: 'buff',
    },
    {
        name: 'Cleanse',
        description: 'Remove specified number of debuffs',
        type: 'effect',
    },
    {
        name: 'Defense Up II',
        description: '+30% Defense',
        type: 'buff',
    },
    {
        name: 'Speed Down II',
        description: '-30% Speed',
        type: 'debuff',
    },
    {
        name: 'Crit Power Down III',
        description: '-45% Outgoing Crit Power',
        type: 'debuff',
    },
    {
        name: 'Attack Down II',
        description: '-30% Attack',
        type: 'debuff',
    },
    {
        name: 'Out. Damage Down II',
        description: '-30% Outgoing Direct Damage',
        type: 'debuff',
    },
    {
        name: 'Disable',
        description:
            'Prevents activation of passive and active skills. Charge skill charges do not generate.',
        type: 'debuff',
    },
    {
        name: 'Block Shield',
        description: 'Unit unable to gain shield for specified number of turns',
        type: 'debuff',
    },
    {
        name: 'Speed Up I',
        description: '+10% Speed',
        type: 'buff',
    },
    {
        name: 'Speed Up II',
        description: '+30% Speed',
        type: 'buff',
    },
    {
        name: 'Speed Up III',
        description: '+45% Speed',
        type: 'buff',
    },
    {
        name: 'Crit Power Down II',
        description: '-30% Outgoing Crit Power',
        type: 'debuff',
    },
    {
        name: 'Attack Down I',
        description: '-15% Attack',
        type: 'debuff',
    },
    {
        name: 'Out. Damage Down I',
        description: '-15% Outgoing Direct Damage',
        type: 'debuff',
    },
    {
        name: 'Corrosion',
        description: "Deals Damage equal to 3/6/9% of target's max HP, ignores defense and shield",
        type: 'debuff',
    },
    {
        name: 'Corrosion I',
        description: "Deals Damage equal to 3% of target's max HP, ignores defense and shield",
        type: 'debuff',
    },
    {
        name: 'Out. DoT Damage Down I',
        description: '-10% DoT Damage',
        type: 'debuff',
    },
    {
        name: 'Out. DoT Damage Down II',
        description: '-20% DoT Damage',
        type: 'debuff',
    },
    {
        name: 'Provoke',
        description: 'Forces Unit to attack the applying unit for specified number of turns',
        type: 'debuff',
    },
    {
        name: 'Corrosion II',
        description: "Deals Damage equal to 6% of target's max HP, ignores defense and shield",
        type: 'debuff',
    },
    {
        name: 'Corrosion III',
        description: "Deals Damage equal to 9% of target's max HP, ignores defense and shield",
        type: 'debuff',
    },
    {
        name: 'Speed Down I',
        description: '-15% Speed',
        type: 'debuff',
    },
    {
        name: 'Stealth',
        description: 'Remains untargetable unless no targets without stealth are available',
        type: 'buff',
    },
    {
        name: 'Tianchao Precision II',
        description: '+30% Crit Power, +20 Hacking',
        type: 'buff',
    },
    {
        name: 'Attack Down III',
        description: '-45% Attack',
        type: 'debuff',
    },
    {
        name: 'Crit Rate Down II',
        description: '-20% Crit Rate',
        type: 'debuff',
    },
    {
        name: 'Crit Rate Down III',
        description: '-30% Crit Rate',
        type: 'debuff',
    },
    {
        name: 'Gelecek Contagion II',
        description: '+30 Hacking, +5% Speed',
        type: 'buff',
    },
    {
        name: 'Defense Down II',
        description: '-30% Defense',
        type: 'debuff',
    },
    {
        name: 'Defense Down III',
        description: '-45% Defense',
        type: 'debuff',
    },
    {
        name: 'Inferno II',
        description: '30% Damage',
        type: 'debuff',
    },
    {
        name: 'Inferno III',
        description: '45% Damage',
        type: 'debuff',
    },
    {
        name: 'Stasis',
        description:
            'Prevents activation of passive and active skills. Charge skill charges do not generate. Effect removed upon taking damage',
        type: 'debuff',
    },
    {
        name: 'Inc. DoT Damage Up II',
        description: '+20% DoT Damage',
        type: 'buff',
    },
    {
        name: 'Inc. DoT Damage Up III',
        description: '+30% DoT Damage',
        type: 'buff',
    },
    {
        name: 'Overload',
        description: '+10% Outgoing Direct Damage, -10% Defense, Stackable up to 10 times',
        type: 'buff',
    },
    {
        name: 'Marauder Rage I',
        description: '+10% Attack',
        type: 'buff',
    },
    {
        name: 'Marauder Rage II',
        description: '+20% Attack, +10% Crit Power',
        type: 'buff',
    },
    {
        name: 'Marauder Rage III',
        description: '+30% Attack, +20% Crit Power',
        type: 'buff',
    },
    {
        name: 'Debuff Duration Extension',
        description:
            'Increase Duration of a Specified number of debuffs. Does not require Hacking. Affinity Adv units are immune',
        type: 'effect',
    },
    {
        name: 'Defense Down I',
        description: '-15% Defense',
        type: 'debuff',
    },
    {
        name: 'XAOC Swiftness I',
        description: '+10% Speed',
        type: 'buff',
    },
    {
        name: 'XAOC Swiftness II',
        description: '+20% Speed, +10% Attack',
        type: 'buff',
    },
    {
        name: 'Block Buff',
        description: 'Is immune to receiving buffs',
        type: 'buff',
    },
    {
        name: 'Purge',
        description: 'Remove specified number of buffs',
        type: 'effect',
    },
    {
        name: 'Out. Damage Up II',
        description: '+30% Outgoing Direct Damage',
        type: 'buff',
    },
    {
        name: 'Charge Manipulation',
        description:
            'Increaes or Decreases charge skill charges by noted amount. Does not need hacking. Does not affect enemies with affinity advantage over the applying unit.',
        type: 'effect',
    },
    {
        name: 'Detonation',
        description:
            'Removes all damaging effects of specified type, and deals the cumulative damage in a single Direct Damage attack.',
        type: 'effect',
    },
    {
        name: 'Atlas Coordination I',
        description: '+10% Attack',
        type: 'buff',
    },
    {
        name: 'Defense Up III',
        description: '+45% Defense',
        type: 'buff',
    },
    {
        name: 'Inc. Damage Down II',
        description: '-30% Incoming Direct Damage',
        type: 'buff',
    },
    {
        name: 'Binderburg Resilience II',
        description: '+20 Security',
        type: 'buff',
    },
    {
        name: 'Inc. Damage Down III',
        description: '-45% Incoming Direct Damage',
        type: 'buff',
    },
    {
        name: 'Binderburg Resilience III',
        description: '+30 Security, +15% Defense',
        type: 'buff',
    },
    {
        name: 'Out. Damage Down III',
        description: '-45% Outgoing Direct Damage',
        type: 'debuff',
    },
    {
        name: 'Security Up II',
        description: '+40Security',
        type: 'buff',
    },
    {
        name: 'Everliving Regeneration II',
        description: '+20% Incoming Repair, +20 Security',
        type: 'buff',
    },
    {
        name: 'Repair Over Time I',
        description: '10% Applying Unit HP%',
        type: 'buff',
    },
    {
        name: 'Repair Over Time II',
        description: '15% Applying Unit HP%',
        type: 'buff',
    },
    {
        name: 'Attack Up III',
        description: '+45% Attack',
        type: 'buff',
    },
    {
        name: 'Legion Discipline II',
        description: '+15% Attack, +15 Security, +10% Speed',
        type: 'buff',
    },
    {
        name: 'XAOC Swiftness III',
        description: '+30% Speed, +20% Attack',
        type: 'buff',
    },
    {
        name: 'Out. Damage Up III',
        description: '+45% Outgoing Direct Damage',
        type: 'buff',
    },
    {
        name: 'Crit Power Up II',
        description: '+30% Outgoing Crit Power',
        type: 'buff',
    },
    {
        name: 'Attack Up II',
        description: '+30% Attack',
        type: 'buff',
    },
    {
        name: 'Crit Power Up III',
        description: '+45% Outgoing Crit Power',
        type: 'buff',
    },
    {
        name: 'Crit Power Down I',
        description: '-15% Outgoing Crit Power',
        type: 'debuff',
    },
    {
        name: 'Crit Rate Down I',
        description: '-10% Outgoing Crit Rate',
        type: 'debuff',
    },
    {
        name: 'Binderburg Resilience I',
        description: '+10 Security',
        type: 'buff',
    },
    {
        name: 'Crit Rate Up I',
        description: '+10% Outgoing Crit Rate',
        type: 'buff',
    },
    {
        name: 'Attack Up I',
        description: '+15% Attack',
        type: 'buff',
    },
    {
        name: 'Crit Rate Up II',
        description: '+20% Outgoing Crit Rate',
        type: 'buff',
    },
    {
        name: 'Cheat Death',
        description: 'Survive the next fatal blow with 1HP, removing all buffs and debuffs.',
        type: 'buff',
    },
    {
        name: 'Inc. Damage Down I',
        description: '-15% Incoming Direct Damage',
        type: 'buff',
    },
    {
        name: 'Security Up III',
        description: '+60 Security',
        type: 'buff',
    },
    {
        name: 'Defense Matrix',
        description: '+5% Defense, Stackable',
        type: 'buff',
    },
    {
        name: 'Debuff Duration Expiration',
        description: 'Decrease Duration of a Specified number of debuffs',
        type: 'effect',
    },
    {
        name: 'Everliving Regeneration III',
        description: '+30% Incoming Repair, +20 Security',
        type: 'buff',
    },
    {
        name: 'Bomb I',
        description: '100% Attack',
        type: 'debuff',
    },
    {
        name: 'Bomb II',
        description: '200% Attack',
        type: 'debuff',
    },
    {
        name: 'Concentrate Fire',
        description:
            'All attacks are redirected to this unit. Does not require hacking. Does not affect units Affinity Advantage',
        type: 'debuff',
    },
    {
        name: 'Taunt',
        description: 'Forces enemies to target this unit',
        type: 'buff',
    },
    {
        name: 'Terran Tenacity I',
        description: '-10% Incoming Direct Damage',
        type: 'buff',
    },
    {
        name: 'Terran Tenacity II',
        description: '-20% Incoming Direct Damage',
        type: 'buff',
    },
    {
        name: 'Inc. Repair Down I',
        description: '-25% Incoming Repair',
        type: 'debuff',
    },
    {
        name: 'Inc. Repair Down II',
        description: '-50% Incoming Repair',
        type: 'debuff',
    },
    {
        name: 'Inc. Repair Down III',
        description: '-75% Incoming Repair',
        type: 'debuff',
    },
    {
        name: 'Inc. Damage Up I',
        description: '+15% Incoming Direct Damage',
        type: 'debuff',
    },
    {
        name: 'Inc. Damage Up II',
        description: '+30% Incoming Direct Damage',
        type: 'debuff',
    },
    {
        name: 'Legion Discipline III',
        description: '+20% Attack, +20 Security, +20% Speed',
        type: 'buff',
    },
    {
        name: 'Block Damage',
        description: 'Is Invulnerable to damage',
        type: 'buff',
    },
    {
        name: 'Blast',
        description: '+15% Outgoing Direct Damage, Stackable up to 4 times',
        type: 'buff',
    },
    {
        name: 'Terran Bolster II',
        description: '+10% Defense',
        type: 'buff',
    },
    {
        name: 'Terran Bolster III',
        description: '+15% Defense',
        type: 'buff',
    },
    {
        name: 'Inferno I',
        description: '15% Damage',
        type: 'debuff',
    },
    {
        name: 'Security Down II',
        description: '-40 Security',
        type: 'debuff',
    },
    {
        name: 'Exposed',
        description:
            'Increases the incoming damage of the next direct hit by 100%, removed after taking direct damage or at the end of the round.',
        type: 'debuff',
    },
    {
        name: 'Offensive Affinity Override',
        description:
            'Guarantees affinity advantage when attacking or being attacked, but is removed after attacking.',
        type: 'buff',
    },
    {
        name: 'Defensive Affinity Override',
        description:
            'Grants affinity advantage when attacking or being attacked, but is removed after being attacked',
        type: 'buff',
    },
    {
        name: 'Atlas Readiness II',
        description: '+20% Defense',
        type: 'buff',
    },
    {
        name: 'Warding Screen',
        description: '-5% Incoming Direct Damage, Stackable up to 4 times',
        type: 'buff',
    },
    {
        name: 'Reflect',
        description:
            'Reflects stated % of Damage Received. Reflected damage is affected by DEF and cannot Crit',
        type: 'buff',
    },
    {
        name: 'Hit Mitigation',
        description:
            'Blocks the next direct hit, transforming the damage receieved into dot dealt over 3 rounds.',
        type: 'buff',
    },
    {
        name: 'Damage to Dot',
        description: 'Converts taken damage into a DoT effect that ignore DEF and is unremovable.',
        type: 'debuff',
    },
    {
        name: 'Bomb III',
        description: '300% Damage',
        type: 'debuff',
    },
    {
        name: 'Terran Guard I',
        description: '+5% Defense (Applying Unit)',
        type: 'buff',
    },
    {
        name: 'Terran Guard II',
        description: '+10% Defense (Applying Unit)',
        type: 'buff',
    },
    {
        name: 'Terran Guard III',
        description: '+15% Defense (Applying Unit)',
        type: 'buff',
    },
    {
        name: 'Block Attacks',
        description: 'Block specified number of Incoming Direct Damage attacks',
        type: 'buff',
    },
    {
        name: 'Barrier Recharging',
        description: 'Prevent the activation of Passive Ability for specified number of turns',
        type: 'debuff',
    },
    {
        name: 'Crit Power Up I',
        description: '+15% Outgoing Crit Power',
        type: 'buff',
    },
    {
        name: 'Hacking Down I',
        description: '-20 Hacking',
        type: 'debuff',
    },
    {
        name: 'Hacking Down II',
        description: '-40 Hacking',
        type: 'debuff',
    },
    {
        name: 'Security Down I',
        description: '-20 Security',
        type: 'debuff',
    },
    {
        name: 'Hacking Up I',
        description: '+20 Hacking',
        type: 'buff',
    },
    {
        name: 'Supercharged I',
        description: '+15% Attack, +10% Crit Rate, + 10% Crit Power, -20% Defense',
        type: 'buff',
    },
    {
        name: 'Supercharged III',
        description: '+45% Attack, +30% Crit Rate, +30% Crit Power, -60% Defense',
        type: 'buff',
    },
    {
        name: 'Defense Up I',
        description: '+15% Defense',
        type: 'buff',
    },
    {
        name: 'Buff Duration Extension',
        description: 'Increases the Duration of buffs by specified amount of turns',
        type: 'effect',
    },
    {
        name: 'Out. Repair Down II',
        description: '-50% Outgoing Repair',
        type: 'debuff',
    },
    {
        name: 'Block Repair',
        description: 'Unit unable to be repaired',
        type: 'debuff',
    },
    {
        name: 'Charge Overdrive I',
        description: '+10% Defense Penetration',
        type: 'buff',
    },
    {
        name: 'Charge Overdrive II',
        description: '+20% Defense Penetration',
        type: 'buff',
    },
    {
        name: 'Inc. DoT Damage Up I',
        description: '+10% DoT Damage',
        type: 'buff',
    },
    {
        name: 'Out. DoT Damage Up II',
        description: '+20% DoT Damage',
        type: 'buff',
    },
    {
        name: 'Out. Damage Up I',
        description: '+15% Outgoing Direct Damage',
        type: 'buff',
    },
    {
        name: 'Everliving Regeneration I',
        description: '+10% Incoming Repair',
        type: 'buff',
    },
    {
        name: 'Magnetized Shielding',
        description: 'Increase DEF by 10x Unit Security',
        type: 'buff',
    },
    {
        name: 'Crit Rate Up III',
        description: '+30% Outgoing Crit Rate',
        type: 'buff',
    },
    {
        name: 'Inc. Damage Up III',
        description: '+45% Incoming Direct Damage',
        type: 'debuff',
    },
    {
        name: 'Inflict',
        description: 'Requires hacking.',
        type: 'effect',
    },
    {
        name: 'Apply',
        description: 'Does not require hacking, but enemies with affinity disadvantage are immune.',
        type: 'effect',
    },
    {
        name: 'Out. Detonation Damage Up III',
        description: '+45% Outgoing Detonation Damage',
        type: 'buff',
    },
    {
        name: "Rogue's Liberty",
        description: 'Ignores Taunt and Provoke.',
        type: 'buff',
    },
    {
        name: 'Leech II',
        description: 'Repair for 30% of damage dealt.',
        type: 'buff',
    },
    {
        name: 'Shield Converter',
        description:
            'Nullifies the damage of the next direct hit, turning it into a Shield instead.',
        type: 'buff',
    },
    {
        name: 'Echoing Burst',
        description:
            'Accumulates direct damage dealt and deals 100% of the damage upon expiration.',
        type: 'debuff',
    },
    {
        name: 'Titanite Plating',
        description: '+5% Defense, Stackable up to 5 times. Remove 1 stack per hit.',
        type: 'buff',
    },
    {
        name: 'Overclock III',
        description:
            '+30% Attack, +60% Crit Power. On removal or expiration, apply Speed Down I and Attack Down I to self for 2 turns.',
        type: 'buff',
    },
    {
        name: 'Barrier',
        description: 'Is invulnerable to damage.',
        type: 'buff',
    },
    {
        name: 'Barrier Recharging',
        description: 'Cannot be granted Barrier. Cannot be reduced. Unremovable.',
        type: 'debuff',
    },
    {
        name: 'Core Charge I',
        description:
            'Increase Out. direct damage by 4% and defense penetration by 1%. This effect is stackable up to 10 times.',
        type: 'buff',
    },
    {
        name: 'Hacking Module Overdrive',
        description: 'Hacking +9999',
        type: 'buff',
    },
    {
        name: 'Acidic Decay',
        description:
            "Deals Damage equal to 3/6/9% of target's max HP, ignores defense and shield. Unremovable.",
        type: 'debuff',
    },
    {
        name: 'Charged Overdrive II',
        description: 'Grants the next Charged Skill activation 20% Defense Penetration',
        type: 'buff',
    },
    {
        name: 'Toxic Overflow',
        description:
            'At the end of the round if a unit has Toxic Overflow and at last 1 stack of Corrosion, inflict Corrosion I for 3 turns to all adjacent allies and remove Toxic Overflow.',
        type: 'debuff',
    },
    {
        name: 'Protection',
        description:
            'Redirects 10% of incoming direct damage to allies to this unit. This effect is stackable, unremovable and stealable.',
        type: 'buff',
    },
    {
        name: 'Inc. Repair Up II',
        description: '+50% Incoming Repair',
        type: 'buff',
    },
    {
        name: 'Inc. Repair Up III',
        description: '+75% Incoming Repair',
        type: 'buff',
    },
];
