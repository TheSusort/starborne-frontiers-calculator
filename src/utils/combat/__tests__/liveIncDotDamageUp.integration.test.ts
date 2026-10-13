/**
 * #676: a DoT tick reads the TICKING VICTIM's own Inc. DoT Damage Up, live, at the tick — not a
 * value captured from the applier's bound target at the applier's last turn.
 *
 * In-game oracle (#672 T7): Asphyxiator's Inferno III ticked 4090 on Nemesis (no debuffs) and 4254
 * on Voron, who carried Inc. DoT Damage Up III (added after the Inferno landed) and a 20% DoT
 * reduction passive: 4090 x 1.3 x 0.8 = 4253.6. The victim's Up sits additively in the applier's
 * DoT multiplier; the reduction multiplies separately.
 *
 * Board: the DoT applier casts from M4 at the enemy front (M4); M3 is its neighbour. Every tick
 * lands at the victim's own turn-start. With attack 1000 an Inferno stack of tier 15 ticks
 * 1 x 0.15 x 1000 = 150 at base. Hacking dwarfs every security, so every debuff and DoT lands.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, AbilityTarget, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import type { ActiveDoTStack, CombatActor } from '../state';

beforeEach(() => {
    setupKeyedRng(676);
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
type Slot = ShipSkills['slots'][number];

const HP = 1e9;
const ATTACK = 1000;
const BASE_TICK = 150; // 1 stack x tier 15 x attack 1000

let idc = 0;
const ab = (p: Pick<Ability, 'type' | 'config'> & { target?: AbilityTarget }): Ability => ({
    id: `live-inc-dot-${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const incDotUp = (tier: 'I' | 'III', duration: number): Ability =>
    ab({
        type: 'debuff',
        config: {
            type: 'debuff',
            buffName: `Inc. DoT Damage Up ${tier}`,
            parsedEffects: { incomingDotDamage: tier === 'I' ? 10 : 30 },
            stacks: 1,
            isStackable: false,
            application: 'inflict',
            duration,
        },
    });

const inferno = (target: AbilityTarget = 'enemy'): Ability =>
    ab({
        type: 'dot',
        target,
        config: { type: 'dot', dotType: 'inferno', tier: 15, stacks: 1, duration: 5 },
    });

const dotReductionPassive = (pct: number): Slot => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'incoming-reduction',
            target: 'self',
            config: {
                type: 'incoming-reduction',
                scope: 'dot',
                condition: 'always',
                pct,
                critFamily: false,
            },
        }),
    ],
});

const EMPTY_ACTIVE: Slot = { slot: 'active', abilities: [] };
/** A kit whose charged skill casts `abilities`; its active does nothing. */
const chargedOnce = (abilities: Ability[], extra: Slot[] = []): ShipSkills => ({
    slots: [EMPTY_ACTIVE, { slot: 'charged', abilities }, ...extra],
});
/** A kit that casts `abilities` on its active every turn. */
const everyTurn = (abilities: Ability[]): ShipSkills => ({
    slots: [{ slot: 'active', abilities }],
});

/** When a kit casts: its active every turn, its charged skill on round 1 only, or its charged
 *  skill from round 2 (one turn to charge). */
type Timing = 'every-turn' | 'round-1-only' | 'from-round-2';
const kitFor = (abilities: Ability[], timing: Timing): ShipSkills =>
    timing === 'every-turn' ? everyTurn(abilities) : chargedOnce(abilities);
const chargeFields = (timing: Timing) =>
    timing === 'every-turn'
        ? { chargeCount: 0, startCharged: false }
        : timing === 'round-1-only'
          ? { chargeCount: 9, startCharged: true }
          : { chargeCount: 1, startCharged: false };

const offenceStats = {
    attack: ATTACK,
    crit: 0,
    critDamage: 0,
    defence: 0,
    hp: HP,
    security: 0,
    hacking: 1e6,
};

const enemyShip = (
    id: string,
    position: Position,
    speed: number,
    shipSkills: ShipSkills = { slots: [EMPTY_ACTIVE] },
    timing: Timing = 'every-turn'
): EnemyAttacker => ({
    id,
    stats: { ...offenceStats, speed },
    ...chargeFields(timing),
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills,
});

const allyShip = (
    id: string,
    position: Position,
    speed: number,
    shipSkills: ShipSkills,
    timing: Timing = 'every-turn'
): TeamActor => ({
    id,
    speed,
    ...chargeFields(timing),
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    walk: {
        shipSkills,
        stats: { ...offenceStats, defensePenetration: 0 },
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: timing !== 'every-turn',
    },
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: ATTACK,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 9,
    shipSkills: { slots: [EMPTY_ACTIVE] },
    numRounds: 4,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: true,
    startCharged: true,
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
    speed: 100,
    ...over,
});

/** Inferno tick damage per round on each victim (`ticks[victimId][round]`), and the Inferno
 *  detonation damage each victim took. */
const runTicks = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const ticks: Record<string, Record<number, number>> = {};
    const detonations: Record<string, number> = {};
    bus.on('dot-ticked', (e: Extract<CombatEvent, { type: 'dot-ticked' }>) => {
        if (e.dotType !== 'inferno') return;
        (ticks[e.targetId] ??= {})[e.round] = (ticks[e.targetId]?.[e.round] ?? 0) + e.damage;
    });
    bus.on('dot-detonated', (e: Extract<CombatEvent, { type: 'dot-detonated' }>) => {
        detonations[e.targetId] = (detonations[e.targetId] ?? 0) + e.damage;
    });
    runCombat({ ...input, bus });
    return { ticks, detonations };
};

/** Turn order every round: the DoT applier (speed 100), then the debuffer (75), then the victims
 *  (50), which tick at their own turn-start. A debuff the debuffer lands therefore arrives AFTER
 *  the applier's turn and BEFORE the tick. */
const DEBUFFER_SPEED = 75;
/** The focus Infernos the enemy front once, on round 1. */
const focusInfernoOnFront = chargedOnce([inferno()]);
const twoEnemies = (frontSkills?: ShipSkills): EnemyAttacker[] => [
    enemyShip('enemy-a', 'M4', 50, frontSkills),
    enemyShip('enemy-b', 'M3', 50),
];
/** An ally that lands `abilities` on the enemy front. */
const debuffer = (
    id: string,
    abilities: Ability[],
    timing: Timing = 'every-turn',
    speed = DEBUFFER_SPEED
): TeamActor => allyShip(id, 'M3', speed, kitFor(abilities, timing), timing);
/** A seeded Inferno stack from the focus: tier 15, 1 stack. */
const seededInferno = (remainingRounds: number): ActiveDoTStack => ({
    tier: 15,
    stacks: 1,
    remainingRounds,
    sourceId: 'attacker',
});
const seedOnBothEnemies =
    (remainingRounds: number) =>
    (actors: CombatActor[]): void => {
        for (const id of ['enemy-a', 'enemy-b']) {
            actors.find((a) => a.id === id)?.infernoEntries.push(seededInferno(remainingRounds));
        }
    };

describe('#676 Inc. DoT Damage Up is read per victim at each tick', () => {
    it('a debuff landed on round 2, after the Inferno, boosts the ticks that follow', () => {
        const { ticks } = runTicks(
            base({
                shipSkills: focusInfernoOnFront,
                enemyAttackers: twoEnemies(),
                teamActors: [debuffer('debuffer', [incDotUp('III', 2)], 'from-round-2')],
            })
        );
        expect(ticks['enemy-a'][1]).toBeCloseTo(BASE_TICK, 6);
        expect(ticks['enemy-a'][2]).toBeCloseTo(BASE_TICK * 1.3, 6);
        expect(ticks['enemy-a'][3]).toBeCloseTo(BASE_TICK * 1.3, 6);
    });

    it('an Inferno spread to a neighbour does not read the primary target’s debuff', () => {
        // One cast: Inc. DoT Damage Up III on the primary only, Inferno on the primary and on its
        // neighbour.
        const { ticks } = runTicks(
            base({
                shipSkills: chargedOnce([
                    incDotUp('III', 3),
                    inferno('enemy'),
                    inferno('adjacent-enemies'),
                ]),
                enemyAttackers: twoEnemies(),
            })
        );
        expect(ticks['enemy-a'][1]).toBeCloseTo(BASE_TICK * 1.3, 6);
        expect(ticks['enemy-b'][1]).toBeCloseTo(BASE_TICK, 6);
    });

    it('a neighbour carrying the debuff is boosted while the primary is not', () => {
        // The focus's Inferno is seeded on both enemies; the debuffer lands Inc. DoT Damage Up III
        // on the neighbour only.
        const { ticks } = runTicks(
            base({
                hasChargedSkill: false,
                startCharged: false,
                enemyAttackers: twoEnemies(),
                teamActors: [
                    { ...debuffer('debuffer', [incDotUp('III', 2)]), target: parseTarget('back') },
                ],
                __testTapActors: seedOnBothEnemies(5),
            })
        );
        expect(ticks['enemy-b'][1]).toBeCloseTo(BASE_TICK * 1.3, 6);
        expect(ticks['enemy-a'][1]).toBeCloseTo(BASE_TICK, 6);
    });

    it('ticks return to base once the debuff expires', () => {
        const { ticks } = runTicks(
            base({
                shipSkills: focusInfernoOnFront,
                enemyAttackers: twoEnemies(),
                teamActors: [debuffer('debuffer', [incDotUp('III', 1)], 'round-1-only')],
            })
        );
        // The 1-turn debuff wears off at the carrier's own turn end, after its round-1 tick.
        expect(ticks['enemy-a'][1]).toBeCloseTo(BASE_TICK * 1.3, 6);
        expect(ticks['enemy-a'][2]).toBeCloseTo(BASE_TICK, 6);
        expect(ticks['enemy-a'][4]).toBeCloseTo(BASE_TICK, 6);
    });

    it('the same holds for an enemy’s Inferno on a player ship carrying the debuff', () => {
        // Mirror board: the enemy caster Infernos the focus (its front) once; a second enemy lands
        // Inc. DoT Damage Up III on it from round 2. The focus ticks at its own turn-start.
        const { ticks } = runTicks(
            base({
                attack: 0,
                speed: 50,
                hasChargedSkill: false,
                startCharged: false,
                teamActors: [allyShip('ally-b', 'M3', 50, { slots: [EMPTY_ACTIVE] })],
                enemyAttackers: [
                    enemyShip('enemy-caster', 'M4', 100, focusInfernoOnFront, 'round-1-only'),
                    enemyShip(
                        'enemy-debuffer',
                        'M3',
                        DEBUFFER_SPEED,
                        chargedOnce([incDotUp('III', 2)]),
                        'from-round-2'
                    ),
                ],
            })
        );
        expect(ticks['attacker'][1]).toBeCloseTo(BASE_TICK, 6);
        expect(ticks['attacker'][2]).toBeCloseTo(BASE_TICK * 1.3, 6);
    });

    it('Inc. DoT Damage Up I and III on one victim count once, the higher tier winning', () => {
        const { ticks } = runTicks(
            base({
                shipSkills: focusInfernoOnFront,
                enemyAttackers: twoEnemies(),
                teamActors: [
                    debuffer('debuffer-1', [incDotUp('I', 2)]),
                    debuffer('debuffer-3', [incDotUp('III', 2)], 'every-turn', DEBUFFER_SPEED - 1),
                ],
            })
        );
        expect(ticks['enemy-a'][1]).toBeCloseTo(BASE_TICK * 1.3, 6);
    });

    it('oracle: a 20% DoT-reduction carrier with Inc. DoT Damage Up III ticks base x 1.3 x 0.8', () => {
        // The game capture: 4090 on the clean neighbour, 4254 on the carrier (4090 x 1.3 x 0.8).
        const { ticks } = runTicks(
            base({
                shipSkills: focusInfernoOnFront,
                enemyAttackers: twoEnemies({ slots: [EMPTY_ACTIVE, dotReductionPassive(20)] }),
                teamActors: [debuffer('debuffer', [incDotUp('III', 2)], 'from-round-2')],
            })
        );
        expect(ticks['enemy-a'][1]).toBeCloseTo(BASE_TICK * 0.8, 6);
        expect(ticks['enemy-a'][2]).toBeCloseTo(BASE_TICK * 1.3 * 0.8, 6);
    });

    it('a detonation reads each detonated victim’s own Inc. DoT Damage Up', () => {
        // Seeded Inferno on both enemies, 2 rounds left: 1 x 0.15 x 1000 x 2 = 300 at base. A
        // faster ally lands Inc. DoT Damage Up III on the front; the focus then detonates Inferno
        // across a Line-Range-1 footprint covering both.
        const { detonations } = runTicks(
            base({
                numRounds: 1,
                shipSkills: chargedOnce([
                    ab({ type: 'damage', config: { type: 'damage', multiplier: 1 } }),
                    ab({
                        type: 'detonate-dot',
                        config: { type: 'detonate-dot', dotType: 'inferno', powerPct: 100 },
                    }),
                ]),
                pattern: parsePattern('Pattern-Line-Range-1'),
                enemyAttackers: twoEnemies(),
                teamActors: [debuffer('debuffer', [incDotUp('III', 2)], 'every-turn', 200)],
                __testTapActors: seedOnBothEnemies(2),
            })
        );
        expect(detonations['enemy-a']).toBeCloseTo(300 * 1.3, 6);
        expect(detonations['enemy-b']).toBeCloseTo(300, 6);
    });
});
