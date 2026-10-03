/**
 * A cast enemy status's condition gate is asked of EACH enemy it reaches, against that enemy's
 * own state (owner rulings 3 and 4, 2026-10-03): with A at 3 debuffs, B at 1 and C at 4, an
 * "if the enemy has 3 or more debuffs, inflict Stasis" clause that reaches all three stasises A
 * and C. See `recipientGateCtx` in playerTurn.ts.
 *
 * The clauses are hand-built `'all-enemies'` statuses, the one target that already reaches every
 * struck enemy. The caster fires Pattern-Circle-Range-1 anchored on M4, which strikes M4 (A), M3
 * (B) and T4 (C). Its hacking dwarfs every security, so each attempted Stasis lands. The enemies
 * are faster than the caster and harmless.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, Condition, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import type { ActiveDoTStack } from '../state';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

let idc = 0;
const hit = (): Ability => ({
    id: `pv-${++idc}`,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});
const gatedStasis = (conditions: Condition[]): Ability => ({
    id: `pv-${++idc}`,
    type: 'debuff',
    target: 'all-enemies',
    trigger: 'on-cast',
    conditions,
    config: {
        type: 'debuff',
        buffName: 'Stasis',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 1,
        application: 'inflict',
    },
});
const selfHeal = (): Ability => ({
    id: `pv-${++idc}`,
    type: 'heal',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct: 10, basis: 'target-hp' },
});
const casterKit = (conditions: Condition[]): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [hit(), gatedStasis(conditions)] }],
});
const emptyKit = (): ShipSkills => ({ slots: [{ slot: 'active', abilities: [] }] });

const THREE_DEBUFFS: Condition[] = [
    { subject: 'enemy-debuff', derivable: true, countComparator: 'gte', countThreshold: 3 },
];
const MORE_CRIT_POWER: Condition[] = [
    { subject: 'stat-vs-target', derivable: true, compareStat: 'crit-power', statComparator: 'gt' },
];
const REPAIRED: Condition[] = [{ subject: 'target-repaired-this-round', derivable: true }];

const corrosion = (n: number): ActiveDoTStack[] =>
    Array.from({ length: n }, () => ({ stacks: 1, tier: 1, remainingRounds: 9, sourceId: 'seed' }));

/** Per-actor board setup applied before round 1. */
interface Seed {
    debuffs?: number;
    critDamage?: number;
    hpFraction?: number;
}

const BOARD: [string, Position][] = [
    ['a', 'M4'],
    ['b', 'M3'],
    ['c', 'T4'],
];

const enemy = (key: string, position: Position, kit: ShipSkills): EnemyAttacker => ({
    id: `enemy-${key}`,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e6, speed: 150, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: kit,
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 100,
    crit: 0,
    critDamage: 100,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: emptyKit(),
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
    hp: 1e6,
    hacking: 1e6,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Circle-Range-1'),
    speed: 100,
    ...over,
});

/** Who `casterId`'s round-1 cast stasised, sorted. */
const stasised = (
    input: CombatEngineInput,
    casterId: string,
    seeds: Record<string, Seed>
): string[] => {
    const bus = createEventBus();
    const hitIds: string[] = [];
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.sourceId === casterId && e.buffName === 'Stasis' && e.round === 1)
            hitIds.push(e.targetId);
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (all) => {
            for (const a of all) {
                const s = seeds[a.id];
                if (!s) continue;
                if (s.debuffs) a.corrosionEntries.push(...corrosion(s.debuffs));
                if (s.critDamage !== undefined) a.stats.critDamage = s.critDamage;
                if (s.hpFraction !== undefined) a.currentHp = a.stats.hp * s.hpFraction;
            }
        },
    });
    return hitIds.sort();
};

beforeEach(() => {
    idc = 0;
    setupKeyedRng(11);
});

describe('player caster: the gate reads each struck enemy', () => {
    const run = (conditions: Condition[], seeds: Record<string, Seed>, kits = emptyKit) =>
        stasised(
            base({
                shipSkills: casterKit(conditions),
                enemyAttackers: BOARD.map(([k, p]) => enemy(k, p, kits())),
            }),
            'attacker',
            seeds
        );

    it('3+ debuffs: A at 3, B at 1, C at 4 → A and C', () => {
        expect(
            run(THREE_DEBUFFS, {
                'enemy-a': { debuffs: 3 },
                'enemy-b': { debuffs: 1 },
                'enemy-c': { debuffs: 4 },
            })
        ).toEqual(['enemy-a', 'enemy-c']);
    });

    it('3+ debuffs: A at 1, B at 4 → B alone', () => {
        expect(
            run(THREE_DEBUFFS, { 'enemy-a': { debuffs: 1 }, 'enemy-b': { debuffs: 4 } })
        ).toEqual(['enemy-b']);
    });

    it('more crit power than the enemy: A 50, B 200, C 50 against 100 → A and C', () => {
        expect(
            run(MORE_CRIT_POWER, {
                'enemy-a': { critDamage: 50 },
                'enemy-b': { critDamage: 200 },
                'enemy-c': { critDamage: 50 },
            })
        ).toEqual(['enemy-a', 'enemy-c']);
    });

    it('repaired this round: only B (wounded, repairs itself before the cast) → B', () => {
        expect(
            run(REPAIRED, { 'enemy-b': { hpFraction: 0.5 } }, () => ({
                slots: [{ slot: 'active', abilities: [selfHeal()] }],
            }))
        ).toEqual(['enemy-b']);
    });
});

describe('enemy caster: the gate reads each struck player ship', () => {
    const ally = (id: string, position: Position, kit: ShipSkills): TeamActor => ({
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
            shipSkills: kit,
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 1e6,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });
    const caster = (conditions: Condition[]): EnemyAttacker => ({
        id: 'enemy-caster',
        stats: {
            attack: 100,
            crit: 0,
            critDamage: 100,
            defence: 0,
            hp: 1e6,
            speed: 10,
            security: 0,
            hacking: 1e6,
        },
        chargeCount: 0,
        startCharged: false,
        position: 'M4',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Circle-Range-1'),
        shipSkills: casterKit(conditions),
    });
    const run = (conditions: Condition[], seeds: Record<string, Seed>, kits = emptyKit) =>
        stasised(
            base({
                attack: 0,
                hacking: 0,
                speed: 150,
                shipSkills: kits(),
                teamActors: [ally('ally-b', 'M3', kits()), ally('ally-c', 'T4', kits())],
                enemyAttackers: [caster(conditions)],
            }),
            'enemy-caster',
            seeds
        );

    it('3+ debuffs: focus at 3, B at 1, C at 4 → focus and C', () => {
        expect(
            run(THREE_DEBUFFS, {
                attacker: { debuffs: 3 },
                'ally-b': { debuffs: 1 },
                'ally-c': { debuffs: 4 },
            })
        ).toEqual(['ally-c', 'attacker']);
    });

    it('more crit power than the target: focus 50, B 200, C 50 against 100 → focus and C', () => {
        expect(
            run(MORE_CRIT_POWER, {
                attacker: { critDamage: 50 },
                'ally-b': { critDamage: 200 },
                'ally-c': { critDamage: 50 },
            })
        ).toEqual(['ally-c', 'attacker']);
    });

    it('repaired this round: only B (wounded, repairs itself before the cast) → B', () => {
        expect(
            run(REPAIRED, { 'ally-b': { hpFraction: 0.5 } }, () => ({
                slots: [{ slot: 'active', abilities: [selfHeal()] }],
            }))
        ).toEqual(['ally-b']);
    });
});
