/**
 * Asphyxiator's charged Stasis lands on the targeted enemy alone (owner ruling 2026-10-03), even
 * though its text reads "on the targeted enemy and all adjacent enemies"; the gate is that enemy's
 * own debuff count. See `ENEMY_SCOPE_PINS` (buildShipAbilities.ts).
 *
 * Real parsed charged kit, single-target pattern, anchored on M4. M3 and T4 are board-adjacent to
 * M4. Debuffs are seeded as Corrosion entries before round 1; the caster's hacking dwarfs every
 * security, so each attempted Stasis lands.
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

const charged = (): Ability[] => {
    const built = buildTraceShip('Asphyxiator');
    if (!built) throw new Error('Asphyxiator missing from reference data');
    const slot = buildShipAbilities(built).slots.find((s) => s.slot === 'charged');
    if (!slot) throw new Error('Asphyxiator has no charged slot');
    return slot.abilities;
};
const chargedKit = (): ShipSkills => ({ slots: [{ slot: 'charged', abilities: charged() }] });

const corrosion = (n: number): ActiveDoTStack[] =>
    Array.from({ length: n }, () => ({
        stacks: 1,
        tier: 1,
        remainingRounds: 9,
        sourceId: 'seed',
    }));

const harmlessEnemy = (id: string, position: Position): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 150, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 1,
    shipSkills: chargedKit(),
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: true,
    startCharged: true,
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

/** Who `casterId`'s round-1 cast stasised, sorted. */
const stasised = (
    input: CombatEngineInput,
    casterId: string,
    seeded: Record<string, number>
): string[] => {
    const bus = createEventBus();
    const hit: string[] = [];
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.sourceId === casterId && e.buffName === 'Stasis' && e.round === 1)
            hit.push(e.targetId);
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
    return hit.sort();
};

beforeEach(() => {
    setupKeyedRng(7);
});

describe("Asphyxiator's charged Stasis parse", () => {
    it('targets the primary enemy, status and control twin alike', () => {
        const stasis = charged().filter(
            (a) =>
                (a.config.type === 'debuff' && a.config.buffName === 'Stasis') ||
                (a.config.type === 'control' && a.config.effect === 'stasis')
        );
        expect(stasis.map((a) => [a.type, a.target])).toEqual([
            ['control', 'enemy'],
            ['debuff', 'enemy'],
        ]);
    });
});

describe("player Asphyxiator's charged Stasis", () => {
    const enemies = (): EnemyAttacker[] => [
        harmlessEnemy('enemy-a', 'M4'),
        harmlessEnemy('enemy-b', 'M3'),
        harmlessEnemy('enemy-c', 'T4'),
    ];

    it('targeted enemy at 3 debuffs, neighbours at 0 → only the targeted enemy is stasised', () => {
        expect(stasised(base({ enemyAttackers: enemies() }), 'attacker', { 'enemy-a': 3 })).toEqual(
            ['enemy-a']
        );
    });

    it('targeted enemy at 1 debuff, a neighbour at 4 → nobody is stasised', () => {
        expect(
            stasised(base({ enemyAttackers: enemies() }), 'attacker', {
                'enemy-a': 1,
                'enemy-b': 4,
            })
        ).toEqual([]);
    });
});

describe("enemy-side Asphyxiator's charged Stasis", () => {
    const ally = (id: string, position: Position): TeamActor => ({
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
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    });
    const enemyAsphyxiator: EnemyAttacker = {
        id: 'enemy-asphyxiator',
        stats: {
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1e9,
            speed: 10,
            security: 0,
            hacking: 1e6,
        },
        chargeCount: 1,
        startCharged: true,
        position: 'M4',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        shipSkills: chargedKit(),
    };
    const input = (): CombatEngineInput =>
        base({
            attack: 0,
            hacking: 0,
            chargeCount: 0,
            hasChargedSkill: false,
            startCharged: false,
            speed: 150,
            shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
            teamActors: [ally('ally-b', 'M3'), ally('ally-c', 'T4')],
            enemyAttackers: [enemyAsphyxiator],
        });

    it('targeted player ship at 3 debuffs, neighbours at 0 → only it is stasised', () => {
        expect(stasised(input(), 'enemy-asphyxiator', { attacker: 3 })).toEqual(['attacker']);
    });
});
