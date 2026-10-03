/**
 * `control-applied` fires once per enemy its paired named status LANDED on, naming that enemy
 * (owner ruling 6: self-gain reactions to a control fire per enemy). A recipient that resisted gets
 * none; the others still emit.
 *
 * The caster fires Pattern-Circle-Range-1 anchored on M4, striking M4 (A), M3 (B) and T4 (C).
 * Its hacking dwarfs A's and C's security; B's security dwarfs its hacking, so B resists.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, AbilityTarget, Condition, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

let idc = 0;
/** Damage + a Stasis status + its control twin, both aimed at `target`. */
const stasisKit = (
    target: AbilityTarget,
    controlConditions: Condition[] = [],
    statusConditions: Condition[] = []
): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: `ca-${++idc}`,
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 1 },
                },
                {
                    id: `ca-${++idc}`,
                    type: 'control',
                    target,
                    trigger: 'on-cast',
                    conditions: controlConditions,
                    config: { type: 'control', effect: 'stasis' },
                },
                {
                    id: `ca-${++idc}`,
                    type: 'debuff',
                    target,
                    trigger: 'on-cast',
                    conditions: statusConditions,
                    config: {
                        type: 'debuff',
                        buffName: 'Stasis',
                        parsedEffects: {},
                        stacks: 1,
                        isStackable: false,
                        duration: 1,
                        application: 'inflict',
                    },
                } satisfies Ability,
            ],
        },
    ],
});

const realActive = (ship: string): ShipSkills => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const slot = buildShipAbilities(built).slots.find((s) => s.slot === 'active');
    if (!slot) throw new Error(`${ship} has no active slot`);
    return { slots: [{ slot: 'active', abilities: slot.abilities }] };
};

const enemy = (id: string, position: Position, security = 0): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 150, security },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
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
    hp: 1e9,
    hacking: 1e4,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Circle-Range-1'),
    speed: 100,
    ...over,
});

/** `casterId`'s round-1 control-applied events as `effect:targetId`, sorted. */
const controls = (
    input: CombatEngineInput,
    casterId: string,
    corrosionSeeds: Record<string, number> = {}
): string[] => {
    const bus = createEventBus();
    const out: string[] = [];
    bus.on('control-applied', (e: Extract<CombatEvent, { type: 'control-applied' }>) => {
        if (e.casterId === casterId && e.round === 1) out.push(`${e.effect}:${e.targetId}`);
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (all) => {
            for (const a of all)
                for (let i = 0; i < (corrosionSeeds[a.id] ?? 0); i++)
                    a.corrosionEntries.push({
                        stacks: 1,
                        tier: 1,
                        remainingRounds: 9,
                        sourceId: 'seed',
                    });
        },
    });
    return out.sort();
};

const RESISTANT = 1e12;

beforeEach(() => {
    idc = 0;
    setupKeyedRng(19);
});

describe('player caster', () => {
    it('an all-enemies Stasis landing on A and C, resisted by B → events for A and C', () => {
        expect(
            controls(
                base({
                    shipSkills: stasisKit('all-enemies'),
                    enemyAttackers: [
                        enemy('enemy-a', 'M4'),
                        enemy('enemy-b', 'M3', RESISTANT),
                        enemy('enemy-c', 'T4'),
                    ],
                }),
                'attacker'
            )
        ).toEqual(['stasis:enemy-a', 'stasis:enemy-c']);
    });

    it('a single-target Stasis that lands → one event naming the target', () => {
        expect(
            controls(
                base({
                    pattern: parsePattern('Pattern-Base'),
                    shipSkills: stasisKit('enemy'),
                    enemyAttackers: [enemy('enemy-a', 'M4'), enemy('enemy-b', 'M3')],
                }),
                'attacker'
            )
        ).toEqual(['stasis:enemy-a']);
    });

    it('a single-target Stasis that is resisted → no event', () => {
        expect(
            controls(
                base({
                    pattern: parsePattern('Pattern-Base'),
                    shipSkills: stasisKit('enemy'),
                    enemyAttackers: [enemy('enemy-a', 'M4', RESISTANT)],
                }),
                'attacker'
            )
        ).toEqual([]);
    });

    it("Vindicator's active Provoke on the target's neighbours → one event per neighbour", () => {
        expect(
            controls(
                base({
                    pattern: parsePattern('Pattern-Base'),
                    shipSkills: realActive('Vindicator'),
                    enemyAttackers: [
                        enemy('enemy-a', 'M4'),
                        enemy('enemy-b', 'M3'),
                        enemy('enemy-c', 'T4'),
                    ],
                }),
                'attacker'
            )
        ).toEqual(['provoke:enemy-b', 'provoke:enemy-c']);
    });
});

describe("a control's own enemy condition is asked of each recipient", () => {
    it('ungated all-enemies Stasis, control gated on 3+ debuffs: only B qualifies → event for B', () => {
        expect(
            controls(
                base({
                    shipSkills: stasisKit('all-enemies', [
                        {
                            subject: 'enemy-debuff',
                            derivable: true,
                            countComparator: 'gte',
                            countThreshold: 3,
                        },
                    ]),
                    enemyAttackers: [
                        enemy('enemy-a', 'M4'),
                        enemy('enemy-b', 'M3'),
                        enemy('enemy-c', 'T4'),
                    ],
                }),
                'attacker',
                { 'enemy-b': 3 }
            )
        ).toEqual(['stasis:enemy-b']);
    });
});

describe("a paired status every recipient's gate turns away", () => {
    it('gated all-enemies Stasis nobody qualifies for, ungated control → no event', () => {
        const threePlusDebuffs: Condition = {
            subject: 'enemy-debuff',
            derivable: true,
            countComparator: 'gte',
            countThreshold: 3,
        };
        expect(
            controls(
                base({
                    shipSkills: stasisKit('all-enemies', [], [threePlusDebuffs]),
                    enemyAttackers: [
                        enemy('enemy-a', 'M4'),
                        enemy('enemy-b', 'M3'),
                        enemy('enemy-c', 'T4'),
                    ],
                }),
                'attacker'
            )
        ).toEqual([]);
    });
});

describe('enemy caster', () => {
    const ally = (id: string, position: Position, security: number): TeamActor => ({
        id,
        speed: 150,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        walk: {
            shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 1e9,
                security,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });
    const caster: EnemyAttacker = {
        id: 'enemy-caster',
        stats: {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1e9,
            speed: 10,
            security: 0,
            hacking: 1e4,
        },
        chargeCount: 0,
        startCharged: false,
        position: 'M4',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Circle-Range-1'),
        shipSkills: stasisKit('all-enemies'),
    };

    it('an all-enemies Stasis landing on the focus and C, resisted by B → events for both', () => {
        expect(
            controls(
                base({
                    attack: 0,
                    hacking: 0,
                    speed: 150,
                    teamActors: [ally('ally-b', 'M3', RESISTANT), ally('ally-c', 'T4', 0)],
                    enemyAttackers: [caster],
                }),
                'enemy-caster'
            )
        ).toEqual(['stasis:ally-c', 'stasis:attacker']);
    });
    it("enemy Vindicator's active Provoke on the target's neighbours → one event per neighbour", () => {
        const vindicator: EnemyAttacker = {
            id: 'enemy-vindicator',
            stats: {
                attack: 1,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1e9,
                speed: 10,
                security: 0,
                hacking: 1e4,
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M4',
            target: parseTarget('front'),
            pattern: parsePattern('Pattern-Base'),
            shipSkills: realActive('Vindicator'),
        };
        expect(
            controls(
                base({
                    attack: 0,
                    hacking: 0,
                    speed: 150,
                    teamActors: [ally('ally-b', 'M3', 0), ally('ally-c', 'T4', 0)],
                    enemyAttackers: [vindicator],
                }),
                'enemy-vindicator'
            )
        ).toEqual(['provoke:ally-b', 'provoke:ally-c']);
    });
});
