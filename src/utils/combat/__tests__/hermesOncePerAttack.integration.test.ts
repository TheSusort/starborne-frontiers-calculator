/**
 * Task 5 — reactive SELF-scoped riders fire ONCE PER ATTACK, not per hit / per AoE victim.
 *
 * User-reported bug: Hermes's reactive passive over-triggers against AoE / multi-hit attacks —
 * the combat log shows "Everliving Regeneration III" 2–4× for a single incoming attack, while the
 * charge gain nets exactly +1.
 *
 * ROOT CAUSE (verified in triggers.ts, `case 'on-ally-crit'`, ~lines 519-542):
 *   Hermes's charge AND Everliving Regeneration III are BOTH self-target riders on the
 *   `on-ally-crit` trigger (parsed from the R4 passive — see the mutation guard below). When an
 *   ally lands a multi-hit / AoE crit, the engine emits ONE `ability-performed` carrying
 *   `critHits = N`. The listener enqueues the rider `n` times where
 *       n = config.type === 'charge' ? (didCrit ? 1 : 0) : (critHits ?? (didCrit ? 1 : 0))
 *   so the CHARGE is already collapsed to 1 (explicit special-case), but the BUFF uses `critHits`
 *   → the Everliving intent is enqueued N times → the buff re-applies N× to Hermes. THAT is why
 *   the two diverge: the charge has a hand-rolled once-per-attack collapse; the buff does not.
 *
 * The other on-ally-crit riders (Sentinel's reactive DAMAGE → 'enemy', Sentinel/Howler's heal /
 * cleanse / Blast → 'ally', routed per-victim via damagedAllyId) LEGITIMATELY fire once per
 * critting hit. So the fix collapses ONLY self-target buff/heal/charge riders, keyed
 * `${ownerId}:${abilityId}`, cleared at each actor turn-start (mirroring `counterFiredThisTurn`).
 *
 * Everything is extracted through the REAL production path (buildShipAbilities on verbatim CSV
 * skill text, driven through runCombat) — never a hand-built self-rider.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// Hermes' R4 (refit-active) passive, verbatim from docs/ship-skills.csv (third passive).
const HERMES_R4 =
    "This Unit's Defense is increased by 20%.<br /><br />When an ally critically hits an enemy, " +
    'this Unit <unit-aid>gains 1 charge</unit-aid> to its Charged Skill and ' +
    '<unit-skill>Everliving Regeneration III</unit-skill> for 2 turns. Additionally, when this ' +
    'Unit critically repairs an ally, it <unit-aid>Cleanses 1</unit-aid> debuff from itself.';

/** Hermes' on-ally-crit riders through the REAL parser/builder (charge + Everliving buff). */
function hermesPassiveAbilities(): Ability[] {
    return (
        buildShipAbilities(ship({ thirdPassiveSkillText: HERMES_R4 })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? []
    );
}

describe('Hermes R4 riders — extracted shape (mutation guard)', () => {
    it('charge + Everliving Regeneration III both ride on-ally-crit, self-targeted', () => {
        const abilities = hermesPassiveAbilities();
        const charge = abilities.find((a) => a.type === 'charge');
        const everliving = abilities.find(
            (a) =>
                a.type === 'buff' &&
                a.config.type === 'buff' &&
                /Everliving/.test(a.config.buffName)
        );
        if (!charge || !everliving) throw new Error('mutation guard: Hermes R4 riders not found');
        expect(charge.trigger).toBe('on-ally-crit');
        expect(charge.target).toBe('self');
        expect(everliving.trigger).toBe('on-ally-crit');
        expect(everliving.target).toBe('self');
    });
});

/** A dummy enemy target: fat HP, does nothing meaningful. */
const dummyEnemy = (id: string, position: Position): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'noop',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 0 },
                        },
                    ],
                },
            ],
        },
    }) as EnemyAttacker;

/** Hermes observer (team actor): carries its full R4 passive (charge + Everliving). Acts last
 *  (speed 1) so the ally crit precedes it; chargeCount headroom of 6. */
const hermesObserver = (position: Position): TeamActorEngineInput =>
    ({
        id: 'hermes',
        speed: 1,
        chargeCount: 6,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        walk: {
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'noop',
                                type: 'damage',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'damage', multiplier: 0 },
                            },
                        ],
                    },
                    { slot: 'passive', abilities: hermesPassiveAbilities() },
                ],
            },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 20_000,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as TeamActorEngineInput;

/** The focus ally lands a 3-hit crit (all hits crit → critHits === 3) on a single enemy in ONE
 *  attack. Hermes, its ally, should apply Everliving Regeneration III EXACTLY once and gain
 *  EXACTLY one charge from that single attack. */
function runHermes() {
    const input: CombatEngineInput = {
        attack: 1000,
        crit: 100, // every hit crits
        critDamage: 100,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'multi-hit',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 100, hits: 3 },
                        },
                    ],
                },
            ],
        },
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: 1,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 500, // acts before Hermes
        healTargetId: 'hermes',
        position: 'M1',
        target: parsedTarget('front'),
        pattern: basePattern(),
        teamActors: [hermesObserver('M3')],
        enemyAttackers: [dummyEnemy('enemy-a', 'M4')],
    };

    const bus = createEventBus();
    const everliving: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
    const chargeGains: Extract<CombatEvent, { type: 'charge-changed' }>[] = [];
    bus.on('buff-applied', (e) => {
        if (e.actorId === 'hermes' && /Everliving/.test(e.buffName)) everliving.push(e);
    });
    bus.on('charge-changed', (e) => {
        if (e.actorId === 'hermes' && e.reason === 'manip') chargeGains.push(e);
    });
    runCombat({ ...input, bus });
    const chargeGained = chargeGains.reduce((s, e) => s + (e.newCharge - e.oldCharge), 0);
    return { everlivingApplications: everliving.length, chargeGained };
}

describe('Hermes Everliving Regeneration — once per attack, not per hit/victim', () => {
    it('a single 3-hit crit applies Everliving once and grants exactly one charge', () => {
        const { everlivingApplications, chargeGained } = runHermes();
        // Pre-fix: Everliving 3× (one per critting hit). Post-fix: 1× (one per attack that crits).
        expect(everlivingApplications).toBe(1);
        // Charge was already collapsed to +1 by the listener special-case; must stay +1.
        expect(chargeGained).toBe(1);
    });
});

/**
 * Regression lock — the guard is NARROW: it collapses ONLY self-target riders. An ally-target
 * reactive buff on the SAME on-ally-crit trigger (the shape of Howler's Blast grant / Sentinel's
 * ally repair) MUST still fire once per critting hit, routed to the crediting ally per victim.
 * A hand-built ally-target buff is used here purely to exercise the `target !== 'self'` branch of
 * the guard in isolation (real Cultivator/Graphite/Sentinel/Howler ally goldens across the suite
 * are the broader lock).
 */
function runAllyTargetRider() {
    const allyBuff: Ability = {
        id: 'ally-blast',
        type: 'buff',
        target: 'ally',
        trigger: 'on-ally-crit',
        conditions: [],
        config: {
            type: 'buff',
            buffName: 'Blast',
            duration: 2,
            stacks: 1,
            isStackable: false,
            parsedEffects: {},
        },
    };
    const observer = hermesObserver('M3');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (observer as any).id = 'howler';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (observer as any).walk.shipSkills.slots[1].abilities = [allyBuff];

    const input: CombatEngineInput = {
        attack: 1000,
        crit: 100,
        critDamage: 100,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'multi-hit',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 100, hits: 3 },
                        },
                    ],
                },
            ],
        },
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: 1,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 500,
        healTargetId: 'howler',
        position: 'M1',
        target: parsedTarget('front'),
        pattern: basePattern(),
        teamActors: [observer],
        enemyAttackers: [dummyEnemy('enemy-a', 'M4')],
    };

    const bus = createEventBus();
    const blasts: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
    bus.on('buff-applied', (e) => {
        if (/Blast/.test(e.buffName)) blasts.push(e);
    });
    runCombat({ ...input, bus });
    return blasts.length;
}

describe('ally-target on-ally-crit rider — still per critting hit (narrowness lock)', () => {
    it('an ally-target buff fires once per critting hit, NOT collapsed to one', () => {
        // The crediting ally landed 3 critting hits → the ally-routed buff applies 3×.
        expect(runAllyTargetRider()).toBe(3);
    });
});
