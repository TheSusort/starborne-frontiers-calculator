/**
 * Every repair can crit except a Repair Over Time tick (R155), whatever it is sized off: a hit it
 * delivered, a hit it took, a reactive trigger or an implant. A skill whose own text says it
 * "cannot critically hit" still cannot.
 *
 * Valkyrie's Echoing Burst repair is the real parsed passive, run with her on the player side and
 * mirrored on the enemy side. Tithonus's real active is the text-driven no-crit control and a self
 * HoT is the tick control. The repair-crit draw is scripted: `allPass` crits every draw, and
 * `healCritsFail` fails only the repair draws, so the same board separates "the repair drew" from
 * "the repair cannot draw".
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedRng, setKeyedRng } from '../../calculators/rateAccumulator';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ship } from '../../../types/ship';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { CombatActor, PendingAccumulator } from '../state';
import type { Position } from '../../../types/encounters';
import { mirrorBoard, realSlots, NO_SKILLS, type MirrorTeams } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error('This suite requires docs/ship-skills.csv and docs/ship-data.json');
    }
});
beforeEach(() => setupKeyedRng(7));
afterEach(() => setKeyedRng(null));

const allPass = () => setKeyedRng(() => 0);
const healCritsFail = () => setKeyedRng((key) => (key.includes('heal-crit') ? 0.99 : 0));

const CRIT = 60;
const CRIT_DAMAGE = 50;

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// ── Valkyrie: a damage-dealt repair off an Echoing Burst ─────────────────────────────────────
const VALKYRIE_R1 =
    'This Unit ignores <unit-skill>Taunt</unit-skill> and <unit-skill>Provoke</unit-skill> effects ' +
    'and at the start of the round, this Unit gains <unit-skill>Speed Up II</unit-skill> for 1 turn. ' +
    '<br /><br />When an <unit-skill>Echoing Burst</unit-skill> explodes on an enemy, the Unit and ' +
    'the ally with the lowest current health percentage <unit-damage>repair 5%</unit-damage> of ' +
    'the damage dealt.';

const valkyriePassive = (): Ability[] =>
    buildShipAbilities({
        refits: [],
        firstPassiveSkillText: VALKYRIE_R1,
    } as unknown as Ship).slots.find((s) => s.slot === 'passive')?.abilities ?? [];

let idc = 0;
const hit100 = (): Ability => ({
    id: `rc${++idc}`,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});
const kit = (passive: Ability[] = []): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [hit100()] },
        ...(passive.length > 0 ? [{ slot: 'passive' as const, abilities: passive }] : []),
    ],
});
const accumulator = (sourceId: string): PendingAccumulator => ({
    accumulated: 0,
    pct: 100,
    roundsRemaining: 1,
    sourceId,
});
const foe = (id: string, attack: number, speed: number, shipSkills: ShipSkills, crit = 0) =>
    ({
        id,
        stats: {
            attack,
            crit,
            critDamage: crit > 0 ? CRIT_DAMAGE : 0,
            defence: 0,
            hp: 1_000_000_000,
            speed,
        },
        chargeCount: 0,
        startCharged: false,
        position: 'M4' as Position,
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        shipSkills,
    }) satisfies EnemyAttacker;

/** The repair Valkyrie's burst paid, on the side she stands on. */
const burstRepair = (side: 'player' | 'enemy'): number => {
    const base: CombatEngineInput = {
        attack: side === 'player' ? 1000 : 0,
        crit: side === 'player' ? CRIT : 0,
        critDamage: side === 'player' ? CRIT_DAMAGE : 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: side === 'player' ? kit(valkyriePassive()) : kit(),
        numRounds: 2,
        selfBuffs: [],
        enemyDebuffs: [],
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1_000_000_000,
        healModifier: 0,
        healTargetId: 'attacker',
        mode: 'healing',
        speed: side === 'player' ? 100 : 1,
        position: 'M4',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        enemyAttackers: [
            side === 'player'
                ? foe('enemy-front', 0, 1, kit())
                : foe('enemy-front', 1000, 500, kit(valkyriePassive()), CRIT),
        ],
    };
    const bus = createEventBus();
    const repairs: Extract<CombatEvent, { type: 'reactive-heal-performed' }>[] = [];
    bus.on('reactive-heal-performed', (e) => repairs.push(e));
    const owner = side === 'player' ? 'attacker' : 'enemy-front';
    const holder = side === 'player' ? 'enemy-front' : 'attacker';
    runCombat({
        ...base,
        bus,
        __testTapActors: (actors: CombatActor[]) => {
            actors.find((a) => a.id === holder)?.pendingAccumulators.push(accumulator(owner));
        },
    });
    const own = repairs.filter((e) => e.casterId === owner);
    expect(own).toHaveLength(1);
    return own[0].amount;
};

describe('R155: a damage-dealt repair crits (Valkyrie, Echoing Burst)', () => {
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: a 1,500 crit burst repairs 75, and the repair crits to 112.5`, () => {
            allPass();
            expect(burstRepair(side)).toBeCloseTo(75 * (1 + CRIT_DAMAGE / 100), 6);
        });
        it(`${side}-side: control, the repair draw failing leaves the plain 75`, () => {
            healCritsFail();
            expect(burstRepair(side)).toBeCloseTo(75, 6);
        });
    }
});

// ── Controls on mirrored boards ──────────────────────────────────────────────────────────────
const gainedBy = (
    teams: MirrorTeams,
    side: 'player' | 'enemy',
    event: 'heal-performed' | 'hot-ticked',
    who: string,
    woundHalf = false
): number[] => {
    const { input, idOf } = mirrorBoard(teams, side);
    const bus = createEventBus();
    const out: number[] = [];
    bus.on('heal-performed', (e) => {
        if (event === 'heal-performed' && e.casterId === idOf(who)) out.push(e.amount);
    });
    bus.on('hot-ticked', (e) => {
        if (event === 'hot-ticked' && e.holderId === idOf(who)) out.push(e.amount);
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            const a = all.find((x) => x.id === idOf(who));
            if (woundHalf && a) a.currentHp = a.stats.hp / 2;
        },
    });
    return out.map((x) => Math.round(x * 1000) / 1000);
};

describe('R155 controls: a text-driven "cannot critically hit" still cannot', () => {
    // Tithonus's real active: "repairs 7% of the damage dealt ... cannot critically hit".
    const board = (): MirrorTeams => ({
        caster: [
            {
                id: 'tithonus',
                position: 'M4',
                speed: 100,
                attack: 1_000,
                crit: CRIT,
                critDamage: CRIT_DAMAGE,
                skills: { slots: realSlots('Tithonus', ['active']) },
            },
        ],
        other: [{ id: 'dummy', position: 'M4', speed: 1 }],
    });
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: the repair is identical whether or not repair draws would crit`, () => {
            allPass();
            const passing = gainedBy(board(), side, 'heal-performed', 'tithonus');
            healCritsFail();
            const failing = gainedBy(board(), side, 'heal-performed', 'tithonus');
            expect(passing.length).toBeGreaterThan(0);
            expect(passing).toEqual(failing);
        });
    }
});

describe('R155 controls: a Repair Over Time tick never crits', () => {
    const hotBoard = (): MirrorTeams => ({
        caster: [
            {
                id: 'holder',
                position: 'M4',
                speed: 100,
                hp: 100_000,
                crit: CRIT,
                critDamage: CRIT_DAMAGE,
                skills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                {
                                    id: 'rc-hot',
                                    type: 'buff',
                                    target: 'self',
                                    trigger: 'on-cast',
                                    conditions: [],
                                    config: {
                                        type: 'buff',
                                        buffName: 'Repair Over Time II',
                                        parsedEffects: { hotPct: 10 },
                                        stacks: 1,
                                        isStackable: false,
                                        duration: 5,
                                    },
                                },
                            ],
                        },
                    ],
                },
            },
        ],
        other: [{ id: 'dummy', position: 'M4', speed: 1, skills: NO_SKILLS }],
    });
    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side: ticks are the plain 10,000 with every draw passing`, () => {
            allPass();
            const ticks = gainedBy(hotBoard(), side, 'hot-ticked', 'holder', true);
            expect(ticks.length).toBeGreaterThan(0);
            for (const t of ticks) expect(t).toBe(10_000);
        });
    }
});
