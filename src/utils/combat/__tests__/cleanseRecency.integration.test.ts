/**
 * A cleanse removes the NEWEST debuff first, named debuff or DoT stack alike (owner ruling
 * 2026-10-04): an ally carrying Attack Down and 2 Corrosion stacks, cleansed of 1 debuff, loses
 * whichever of the three was inflicted most recently. The stacks of one application share its
 * time; a typed cleanse (Nyxen's "cleanses 2 damage over time debuffs") filters first, then takes
 * the newest of what is left.
 *
 * The debuffs are inflicted for real, in speed order, by faster opponents (hand-built one-clause
 * kits, hacking dwarfing security) before the cleanser — Laika ("cleanses 1 debuff", self) or a
 * hand-built self cleanse — acts. Each case runs on both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { ownerDebuffNamesFor } from '../triggers';
import type { StatusEngine } from '../statusEngine';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import type { CombatActor } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

beforeEach(() => {
    setupKeyedRng(32);
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const laika = (): ShipSkills => {
    const built = buildTraceShip('Laika');
    if (!built) throw new Error('Laika missing from reference data');
    const active = buildShipAbilities(built).slots.find((s) => s.slot === 'active');
    if (!active) throw new Error('Laika has no active');
    return { slots: [active] };
};
const selfCleanse = (count: number, debuffType?: 'bomb' | 'dot'): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'self-cleanse',
                    type: 'cleanse',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'cleanse', count, ...(debuffType ? { debuffType } : {}) },
                },
            ],
        },
    ],
});
const one = (ability: Ability): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [ability] }],
});
const ATTACK_DOWN = one({
    id: 'attack-down',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Attack Down II',
        parsedEffects: { attack: -30 },
        stacks: 1,
        isStackable: false,
        duration: 5,
        application: 'inflict',
    },
});
const dot = (dotType: 'corrosion' | 'inferno', stacks: number): ShipSkills =>
    one({
        id: `${dotType}-${stacks}`,
        type: 'dot',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'dot',
            dotType,
            tier: dotType === 'corrosion' ? 3 : 15,
            stacks,
            duration: 5,
        },
    });

const HP = 1e9;

/** One inflicter: its kit and where it stands in the turn order (faster acts first). */
interface Inflicter {
    kit: ShipSkills;
    speed: number;
}

const inflicterEnemy = (i: Inflicter, n: number): EnemyAttacker => ({
    id: `inflicter-${n}`,
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: HP,
        speed: i.speed,
        security: 0,
        hacking: 1e6,
    },
    chargeCount: 0,
    startCharged: false,
    position: (['M3', 'T3', 'B3'] as Position[])[n],
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: i.kit,
});
const inflicterAlly = (i: Inflicter, n: number): TeamActor => ({
    id: `inflicter-${n}`,
    speed: i.speed,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: (['M3', 'T3', 'B3'] as Position[])[n],
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    walk: {
        shipSkills: i.kit,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 1e6,
            defence: 0,
            hp: HP,
            security: 0,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 9,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: true,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: HP,
    hacking: 1e6,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: 10,
    ...over,
});

interface Side {
    tag: string;
    cleanserId: string;
    input: (cleanser: ShipSkills, inflicters: Inflicter[]) => CombatEngineInput;
}

/** The cleanser is the M4 front ship at speed 10, so every inflicter acts before it. */
const PLAYER: Side = {
    tag: 'player',
    cleanserId: 'attacker',
    input: (cleanser, inflicters) =>
        base({ shipSkills: cleanser, enemyAttackers: inflicters.map(inflicterEnemy) }),
};
const ENEMY: Side = {
    tag: 'enemy-side',
    cleanserId: 'enemy-cleanser',
    input: (cleanser, inflicters) => {
        const [first, ...rest] = inflicters;
        return base({
            // The player front ship is the first inflicter.
            shipSkills: first.kit,
            speed: first.speed,
            position: 'M3',
            teamActors: rest.map((i, n) => inflicterAlly(i, n + 1)),
            enemyAttackers: [
                {
                    id: 'enemy-cleanser',
                    stats: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: HP,
                        speed: 10,
                        security: 0,
                        hacking: 1e6,
                    },
                    chargeCount: 9,
                    startCharged: false,
                    position: 'M4',
                    target: parseTarget('front'),
                    pattern: parsePattern('Pattern-Base'),
                    shipSkills: cleanser,
                },
            ],
        });
    },
};

interface After {
    corrosion: number[];
    inferno: number[];
    named: string[];
}

const run = (side: Side, cleanser: ShipSkills, inflicters: Inflicter[]): After => {
    const bus = createEventBus();
    const out: After = { corrosion: [], inferno: [], named: [] };
    let engine: StatusEngine | undefined;
    runCombat({
        ...side.input(cleanser, inflicters),
        bus,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
        __testTapActors: (all: CombatActor[]) => {
            const c = all.find((a) => a.id === side.cleanserId);
            if (!c) throw new Error('cleanser missing');
            bus.on('round-ended', () => {
                out.corrosion = c.corrosionEntries.map((e) => e.stacks);
                out.inferno = c.infernoEntries.map((e) => e.stacks);
                out.named = engine ? ownerDebuffNamesFor(engine, side.cleanserId) : [];
            });
        },
    });
    return out;
};

/** Inflicted in this order: the first acts first (fastest). */
const inOrder = (...kits: ShipSkills[]): Inflicter[] =>
    kits.map((kit, i) => ({ kit, speed: 300 - i * 50 }));

for (const side of [PLAYER, ENEMY]) {
    describe(`${side.tag}: a cleanse takes the newest debuff, named or DoT stack`, () => {
        it('control: with no cleanse, all three debuffs stand', () => {
            const a = run(
                side,
                { slots: [{ slot: 'active', abilities: [] }] },
                inOrder(dot('corrosion', 2), ATTACK_DOWN)
            );
            expect(a).toEqual({ corrosion: [2], inferno: [], named: ['Attack Down II'] });
        });

        it('Attack Down inflicted after the 2 Corrosion stacks → cleanse 1 takes Attack Down', () => {
            const a = run(side, laika(), inOrder(dot('corrosion', 2), ATTACK_DOWN));
            expect(a).toEqual({ corrosion: [2], inferno: [], named: [] });
        });

        it('2 Corrosion stacks inflicted after Attack Down → cleanse 1 takes one stack', () => {
            const a = run(side, laika(), inOrder(ATTACK_DOWN, dot('corrosion', 2)));
            expect(a).toEqual({ corrosion: [1], inferno: [], named: ['Attack Down II'] });
        });

        it('cleanse 3 across both kinds: the newest 2-stack entry and Attack Down go, the oldest stack stays', () => {
            const a = run(
                side,
                selfCleanse(3),
                inOrder(dot('corrosion', 1), ATTACK_DOWN, dot('corrosion', 2))
            );
            expect(a).toEqual({ corrosion: [1], inferno: [], named: [] });
        });

        it('cleanse 2 across both kinds: the newest Inferno stack and Attack Down go, the older Corrosion stays', () => {
            const a = run(
                side,
                selfCleanse(2),
                inOrder(dot('corrosion', 1), ATTACK_DOWN, dot('inferno', 1))
            );
            expect(a).toEqual({ corrosion: [1], inferno: [], named: [] });
        });

        it("a typed 'damage over time' cleanse 1 takes the newest DoT, not the first family", () => {
            const a = run(
                side,
                selfCleanse(1, 'dot'),
                inOrder(dot('corrosion', 1), dot('inferno', 1), ATTACK_DOWN)
            );
            expect(a).toEqual({ corrosion: [1], inferno: [], named: ['Attack Down II'] });
        });
    });
}
