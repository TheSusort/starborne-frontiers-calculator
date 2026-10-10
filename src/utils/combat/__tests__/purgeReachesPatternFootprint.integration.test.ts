/**
 * "Purges N buffs from the enemy" on a pattern skill purges EVERY enemy the skill strikes (owner
 * ruling 2026-10-03): Sefuba's active hits A, B and C, each holding one buff, and removes one buff
 * from each of the three. An enemy outside the pattern keeps its buff.
 *
 * Real parsed kits (buildTraceShip on docs/ship-skills.csv) on Pattern-Circle-Range-1 anchored on
 * M4, which strikes M4, M3 and T4 (and B4); M2 is outside it. Every buff holder is faster than the
 * caster and grants itself its buffs on its own round-1 turn, so the buffs are on the board when
 * the caster acts. Nobody but the caster deals damage or repairs.
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
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor } from '../state';
import type { StatusEngine } from '../statusEngine';

const hasReferenceData = (): boolean => csvAvailable() && shipDataAvailable();

beforeAll(() => {
    if (!hasReferenceData()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const circle = (): ParsedPattern => parsePattern('Pattern-Circle-Range-1');
const single = (): ParsedPattern => parsePattern('Pattern-Base');

const realSlot = (ship: string, slot: 'active' | 'charged' | 'passive'): Ability[] => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.find((s) => s.slot === slot);
    if (!found) throw new Error(`${ship} has no ${slot} slot`);
    return found.abilities;
};

let idc = 0;
/** A removable timed self buff with no stat effects. */
const selfBuff = (name: string): Ability => ({
    id: `sb-${++idc}`,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: name,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 3,
    },
});
const buffKit = (n: number): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: Array.from({ length: n }, (_, i) => selfBuff(`Neutral Buff ${i + 1}`)),
        },
    ],
});

const IN_PATTERN: Position[] = ['M4', 'M3', 'T4'];
const OUTSIDE: Position = 'M2';

/** A durable, harmless enemy that grants itself `buffs` buffs before the caster acts. */
const buffedEnemy = (id: string, position: Position, buffs: number): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 150, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: single(),
    shipSkills: buffKit(buffs),
});

const enemyRow = (buffs: number): EnemyAttacker[] => [
    ...IN_PATTERN.map((p, i) => buffedEnemy(`enemy-${'abc'[i]}`, p, buffs)),
    buffedEnemy('enemy-out', OUTSIDE, buffs),
];

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1e9,
    hacking: 0,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: circle(),
    speed: 100,
    ...over,
});

interface Measured {
    /** `casterId`'s round-1 purges, as `targetId → removed`. */
    purged: Record<string, number>;
    /** Removable timed buffs each listed actor still holds after round 1. */
    buffsLeft: Record<string, number>;
    actors: Map<string, CombatActor>;
}

const measure = (
    input: CombatEngineInput,
    casterId: string,
    holders: string[],
    startHp: Record<string, number> = {}
): Measured => {
    const bus = createEventBus();
    const purged: Record<string, number> = {};
    bus.on('purge-performed', (e: Extract<CombatEvent, { type: 'purge-performed' }>) => {
        if (e.casterId !== casterId || e.round !== 1) return;
        purged[e.targetId] = (purged[e.targetId] ?? 0) + e.count;
    });
    const actors = new Map<string, CombatActor>();
    let engine: StatusEngine | undefined;
    runCombat({
        ...input,
        bus,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
        __testTapActors: (all) => {
            for (const a of all) {
                actors.set(a.id, a);
                const f = startHp[a.id];
                if (f !== undefined) a.currentHp = a.stats.hp * f;
            }
        },
    });
    const buffsLeft = Object.fromEntries(
        holders.map((id) => [id, engine!.timedAbilityStatuses('self', id).length])
    );
    return { purged, buffsLeft, actors };
};

const ENEMY_IDS = ['enemy-a', 'enemy-b', 'enemy-c', 'enemy-out'];

beforeEach(() => {
    idc = 0;
    setupKeyedRng(5);
});

describe("Tithonus's active purge reaches his whole pattern", () => {
    const tithonus = (pattern: ParsedPattern): Measured =>
        measure(
            base({
                shipSkills: {
                    slots: [{ slot: 'active', abilities: realSlot('Tithonus', 'active') }],
                },
                pattern,
                enemyAttackers: enemyRow(1),
            }),
            'attacker',
            ENEMY_IDS
        );

    it('A, B and C each holding one buff → all three lose it; the enemy outside keeps its own', () => {
        const { purged, buffsLeft } = tithonus(circle());
        expect(purged).toEqual({ 'enemy-a': 1, 'enemy-b': 1, 'enemy-c': 1 });
        expect(buffsLeft).toEqual({ 'enemy-a': 0, 'enemy-b': 0, 'enemy-c': 0, 'enemy-out': 1 });
    });

    it('a single-target pattern purges the target alone', () => {
        const { purged, buffsLeft } = tithonus(single());
        expect(purged).toEqual({ 'enemy-a': 1 });
        expect(buffsLeft).toEqual({ 'enemy-a': 0, 'enemy-b': 1, 'enemy-c': 1, 'enemy-out': 1 });
    });
});

describe('enemy-side Tithonus purges every player ship he hits', () => {
    /** A durable player-side ship that grants itself one buff before the enemy Tithonus acts. */
    const buffedAlly = (id: string, position: Position): TeamActor => ({
        id,
        speed: 150,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parseTarget('front'),
        pattern: single(),
        walk: {
            shipSkills: buffKit(1),
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 1e9,
            },
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });
    const enemyTithonus = (pattern: ParsedPattern): EnemyAttacker => ({
        id: 'enemy-tithonus',
        stats: {
            attack: 10_000,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1e9,
            speed: 10,
            security: 0,
            hacking: 0,
        },
        chargeCount: 0,
        startCharged: false,
        position: 'M4',
        target: parseTarget('front'),
        pattern,
        shipSkills: { slots: [{ slot: 'active', abilities: realSlot('Tithonus', 'active') }] },
    });
    const run = (pattern: ParsedPattern): Measured =>
        measure(
            base({
                attack: 0,
                speed: 150,
                shipSkills: buffKit(1),
                position: 'M4',
                teamActors: [
                    buffedAlly('ally-b', 'M3'),
                    buffedAlly('ally-c', 'T4'),
                    buffedAlly('ally-out', OUTSIDE),
                ],
                enemyAttackers: [enemyTithonus(pattern)],
            }),
            'enemy-tithonus',
            ['attacker', 'ally-b', 'ally-c', 'ally-out']
        );

    it('three player ships in his pattern, one buff each → all three lose it', () => {
        const { purged, buffsLeft } = run(circle());
        expect(purged).toEqual({ attacker: 1, 'ally-b': 1, 'ally-c': 1 });
        expect(buffsLeft).toEqual({ attacker: 0, 'ally-b': 0, 'ally-c': 0, 'ally-out': 1 });
    });

    it('a single-target pattern purges the target alone', () => {
        expect(run(single()).purged).toEqual({ attacker: 1 });
    });
});

describe("Sefuba's extra purge reaches every enemy her pattern purge reaches", () => {
    const SEFUBA_HP = 10_000;
    const sefubaKit = (): ShipSkills => ({
        slots: [
            { slot: 'active', abilities: realSlot('Sefuba', 'active') },
            { slot: 'passive', abilities: realSlot('Sefuba', 'passive') },
        ],
    });

    it('her refit passive carries the per-buff repair and the extra purge', () => {
        const passive = realSlot('Sefuba', 'passive');
        expect(passive.filter((a) => a.trigger === 'on-enemy-purged').map((a) => a.type)).toEqual(
            expect.arrayContaining(['heal', 'purge'])
        );
    });

    it('A, B and C holding two buffs each → one repair of 12% per buff removed, and each loses its second buff to the extra purge', () => {
        const { purged, buffsLeft, actors } = measure(
            base({
                attack: 1000,
                hp: SEFUBA_HP,
                shipSkills: sefubaKit(),
                enemyAttackers: enemyRow(2),
            }),
            'attacker',
            ENEMY_IDS,
            { attacker: 0.5 }
        );
        // Her active removes one buff from each enemy it strikes; the passive then repairs 12% per
        // buff the whole purge removed (once) and purges one more buff from each of those enemies.
        expect(purged).toEqual({ 'enemy-a': 1, 'enemy-b': 1, 'enemy-c': 1 });
        expect(buffsLeft).toEqual({ 'enemy-a': 0, 'enemy-b': 0, 'enemy-c': 0, 'enemy-out': 2 });
        const sefuba = actors.get('attacker')!;
        expect((100 * sefuba.currentHp) / sefuba.stats.hp).toBeCloseTo(50 + 3 * 12, 5);
    });
});
