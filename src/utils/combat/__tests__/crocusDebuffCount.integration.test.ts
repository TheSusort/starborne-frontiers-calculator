/**
 * Crocus's "If an enemy has 3 or more debuffs, this Unit inflicts Stasis … on that enemy" counts
 * EVERY debuff on that enemy (owner ruling 2026-10-03): two Corrosion stacks plus an Attack Down
 * is three, so the enemy is stasised. Each struck enemy is counted on its own.
 *
 * A faster teammate lands Attack Down before the caster acts (hacking dwarfs every security);
 * Corrosion entries are seeded before round 1. The caster's own Corrosion II is written before the
 * gate, so when it lands it is one more debuff on that enemy (owner ruling R29).
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
import type { Ability, AbilityTarget, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import type { ActiveDoTStack } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const crocusActive = (): ShipSkills => {
    const built = buildTraceShip('Crocus');
    if (!built) throw new Error('Crocus missing from reference data');
    const slot = buildShipAbilities(built).slots.find((s) => s.slot === 'active');
    if (!slot) throw new Error('Crocus has no active slot');
    return { slots: [{ slot: 'active', abilities: slot.abilities }] };
};

let idc = 0;
const attackDownKit = (target: AbilityTarget): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: `cd-${++idc}`,
                    type: 'debuff',
                    target,
                    trigger: 'on-cast',
                    conditions: [],
                    config: {
                        type: 'debuff',
                        buffName: 'Attack Down II',
                        parsedEffects: { attack: -20 },
                        stacks: 1,
                        isStackable: false,
                        duration: 3,
                        application: 'inflict',
                    },
                } satisfies Ability,
                {
                    id: `cd-${++idc}`,
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 1 },
                },
            ],
        },
    ],
});

const gatedAllEnemiesStasis = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: `cd-${++idc}`,
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 1 },
                },
                {
                    id: `cd-${++idc}`,
                    type: 'debuff',
                    target: 'all-enemies',
                    trigger: 'on-cast',
                    conditions: [
                        {
                            subject: 'enemy-debuff',
                            derivable: true,
                            countComparator: 'gte',
                            countThreshold: 3,
                        },
                    ],
                    config: {
                        type: 'debuff',
                        buffName: 'Stasis',
                        parsedEffects: {},
                        stacks: 1,
                        isStackable: false,
                        duration: 1,
                        application: 'inflict',
                    },
                },
            ],
        },
    ],
});

const corrosion = (n: number): ActiveDoTStack[] =>
    Array.from({ length: n }, () => ({ stacks: 1, tier: 1, remainingRounds: 9, sourceId: 'seed' }));

const harmless = (id: string, position: Position): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 150, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

/** A player teammate faster than everyone, landing `kit` from M3. */
const teammate = (kit: ShipSkills, pattern: string): TeamActor => ({
    id: 'mate',
    speed: 300,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: 'M3',
    target: parseTarget('front'),
    pattern: parsePattern(pattern),
    walk: {
        shipSkills: kit,
        stats: {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 1e6,
            defence: 0,
            hp: 1e9,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

/** An inert player-side ship. */
const playerShip = (id: string, position: Position): TeamActor => ({
    ...teammate({ slots: [{ slot: 'active', abilities: [] }] }, 'Pattern-Base'),
    id,
    speed: 150,
    position,
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: crocusActive(),
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
    hacking: 1e6,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: 100,
    ...over,
});

const stasised = (
    input: CombatEngineInput,
    casterId: string,
    seeded: Record<string, number>
): string[] => {
    const bus = createEventBus();
    const out: string[] = [];
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.sourceId === casterId && e.buffName === 'Stasis' && e.round === 1)
            out.push(e.targetId);
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (all) => {
            for (const a of all) {
                const n = seeded[a.id];
                if (n) a.corrosionEntries.push(...corrosion(n));
            }
        },
    });
    return out.sort();
};

beforeEach(() => {
    idc = 0;
    setupKeyedRng(17);
});

describe("player Crocus's active counts every debuff on the enemy", () => {
    const enemies = (): EnemyAttacker[] => [harmless('enemy-a', 'M4'), harmless('enemy-b', 'M3')];

    it('two Corrosion stacks plus Attack Down → stasised', () => {
        expect(
            stasised(
                base({
                    teamActors: [teammate(attackDownKit('enemy'), 'Pattern-Base')],
                    enemyAttackers: enemies(),
                }),
                'attacker',
                { 'enemy-a': 2 }
            )
        ).toEqual(['enemy-a']);
    });

    // Her own Corrosion II, written before the gate, is the second debuff (R29).
    it('one Corrosion stack alone → not stasised', () => {
        expect(stasised(base({ enemyAttackers: enemies() }), 'attacker', { 'enemy-a': 1 })).toEqual(
            []
        );
    });

    it('two Corrosion stacks and her own Corrosion II → stasised', () => {
        expect(stasised(base({ enemyAttackers: enemies() }), 'attacker', { 'enemy-a': 2 })).toEqual(
            ['enemy-a']
        );
    });
});

describe('a debuff-count gate on a cast reaching several enemies counts each one', () => {
    it('Attack Down on all three; Corrosion A 0, B 2, C 1 → B alone', () => {
        expect(
            stasised(
                base({
                    pattern: parsePattern('Pattern-Circle-Range-1'),
                    shipSkills: gatedAllEnemiesStasis(),
                    teamActors: [teammate(attackDownKit('all-enemies'), 'Pattern-Circle-Range-1')],
                    enemyAttackers: [
                        harmless('enemy-a', 'M4'),
                        harmless('enemy-b', 'M3'),
                        harmless('enemy-c', 'T4'),
                    ],
                }),
                'attacker',
                { 'enemy-b': 2, 'enemy-c': 1 }
            )
        ).toEqual(['enemy-b']);
    });
});

describe('enemy-side Crocus counts every debuff on the player ship', () => {
    const enemyMate: EnemyAttacker = {
        id: 'enemy-mate',
        stats: {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1e9,
            speed: 300,
            security: 0,
            hacking: 1e6,
        },
        chargeCount: 0,
        startCharged: false,
        position: 'M3',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        shipSkills: attackDownKit('enemy'),
    };
    const enemyCrocus: EnemyAttacker = {
        id: 'enemy-crocus',
        stats: {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1e9,
            speed: 10,
            security: 0,
            hacking: 1e6,
        },
        chargeCount: 0,
        startCharged: false,
        position: 'M4',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        shipSkills: crocusActive(),
    };

    it('two Corrosion stacks plus Attack Down on the focus → stasised', () => {
        expect(
            stasised(
                base({
                    attack: 0,
                    hacking: 0,
                    speed: 150,
                    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
                    enemyAttackers: [enemyMate, enemyCrocus],
                }),
                'enemy-crocus',
                { attacker: 2 }
            )
        ).toEqual(['attacker']);
    });
    it('Attack Down on all three; Corrosion focus 0, B 2, C 1 → B alone', () => {
        const enemyAoeMate: EnemyAttacker = {
            ...enemyMate,
            id: 'enemy-aoe-mate',
            pattern: parsePattern('Pattern-Circle-Range-1'),
            shipSkills: attackDownKit('all-enemies'),
        };
        const enemyGated: EnemyAttacker = {
            ...enemyCrocus,
            id: 'enemy-gated',
            pattern: parsePattern('Pattern-Circle-Range-1'),
            shipSkills: gatedAllEnemiesStasis(),
        };
        expect(
            stasised(
                base({
                    attack: 0,
                    hacking: 0,
                    speed: 150,
                    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
                    teamActors: [playerShip('ally-b', 'M3'), playerShip('ally-c', 'T4')],
                    enemyAttackers: [enemyAoeMate, enemyGated],
                }),
                'enemy-gated',
                { 'ally-b': 2, 'ally-c': 1 }
            )
        ).toEqual(['ally-b']);
    });
});
