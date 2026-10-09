/**
 * The Warpstrike implant: "Increases damage by X% when directly damaging an enemy while debuffed,
 * and reduces a random active debuff's duration by 1 turn." Owner ruling 2026-10-04 (R35): the
 * debuff is picked at RANDOM over every debuff the wearer carries — named timed statuses and DoT
 * stacks alike (Corrosion, Inferno, generic, Bombs), each stack one candidate (R26). Unremovable
 * debuffs (Acidic Decay) are picked too: "unremovable" bars cleanse and purge, not a duration cut
 * (R173). A picked stack of a multi-stack entry is split off with its shortened duration and
 * keeps its `unremovable` flag and `family`; a DoT or named status cut to 0 expires without
 * ticking, and a Bomb or Echoing Burst cut to 0 detonates there and then (R113).
 *
 * A plain hitter wears a real legendary Warpstrike (built by the equipment registry) and hits once
 * in a one-round fight. Its debuffs are seeded on it before its turn; every reading is compared
 * against a control run without the implant, so the round's natural decrements cancel out. Each
 * case runs on both sides.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { GearPiece } from '../../../types/gear';
import type { ActiveDoTStack, CombatActor, PendingAccumulator, PendingBomb } from '../state';
import type { RegisteredAbilityStatus, StatusEngine } from '../statusEngine';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const HP = 1e6;
const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };
const HIT: Ability = {
    id: 'hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
};

/** The wearer's kit: one plain hit, plus the legendary Warpstrike's abilities from the real
 *  equipment registry when `withImplant`. */
const wearerKit = (withImplant: boolean): ShipSkills => {
    if (!withImplant) return { slots: [{ slot: 'active', abilities: [HIT] }] };
    const ship = {
        id: 'warp-ship',
        name: 'Warp Ship',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'ATTACKER',
        baseStats: {},
        equipment: {},
        implants: { implant_major: 'warp' },
        refits: [],
    } as unknown as Ship;
    const piece = {
        id: 'warp',
        slot: 'implant_major',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: null,
        subStats: [],
        setBonus: 'WARPSTRIKE',
    } as unknown as GearPiece;
    const implant = buildEquipmentAbilities(ship, (id) => (id === 'warp' ? piece : undefined));
    if (implant.length === 0) throw new Error('Warpstrike built no abilities');
    return {
        slots: [
            { slot: 'active', abilities: [HIT] },
            { slot: 'passive', abilities: implant },
        ],
    };
};

const harmlessEnemy = (id: string): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1e9, speed: 10, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: NO_SKILLS,
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 9,
    shipSkills: NO_SKILLS,
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
    hp: HP,
    hacking: 0,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: 100,
    ...over,
});

interface Side {
    wearerId: string;
    input: (kit: ShipSkills) => CombatEngineInput;
}

const PLAYER: Side = {
    wearerId: 'attacker',
    input: (kit) => base({ shipSkills: kit, enemyAttackers: [harmlessEnemy('enemy-a')] }),
};

const ENEMY: Side = {
    wearerId: 'enemy-wearer',
    input: (kit) =>
        base({
            attack: 0,
            speed: 150,
            enemyAttackers: [
                {
                    id: 'enemy-wearer',
                    stats: {
                        attack: 1000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: HP,
                        speed: 100,
                        security: 0,
                    },
                    chargeCount: 9,
                    startCharged: false,
                    position: 'M4',
                    target: parseTarget('front'),
                    pattern: parsePattern('Pattern-Base'),
                    shipSkills: kit,
                },
            ],
        }),
};

const SIDES: [string, Side][] = [
    ['player', PLAYER],
    ['enemy-side', ENEMY],
];

/** What the wearer carries before its turn. Named statuses go on at its round-1 turn start (the
 *  status store only accepts writes inside a round); DoT entries and Bombs go on before combat. */
interface Seed {
    named?: { name: string; turns: number }[];
    corrosion?: ActiveDoTStack[];
    inferno?: ActiveDoTStack[];
    bombs?: PendingBomb[];
    accumulators?: PendingAccumulator[];
}

interface After {
    named: Map<string, number>;
    corrosion: {
        stacks: number;
        remainingRounds: number;
        appliedSeq?: number;
        unremovable?: boolean;
        family?: string;
    }[];
    inferno: { stacks: number; remainingRounds: number }[];
    bombs: { stacks: number; countdown: number }[];
    /** `bomb-detonated` on the wearer whose detonator was the wearer itself. */
    forcedDetonations: number;
    /** `reactive-cleanse-performed` duration cuts the wearer performed. */
    cuts: number;
    /** Inferno ticks on the wearer. */
    infernoTicks: number;
    accumulators: { roundsRemaining: number }[];
    /** Rounds in which an Echoing Burst burst on the wearer. */
    bursts: number[];
    burstDamage: number[];
}

const timed = (
    name: string,
    turns: number
): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
    kind: 'timed',
    side: 'enemy',
    sourceSlot: 'active',
    conditions: [],
    duration: turns,
    payload: { buffName: name, stacks: 1, parsedEffects: {} },
});

const dot = (
    stacks: number,
    turns: number,
    extra: Partial<ActiveDoTStack> = {}
): ActiveDoTStack => ({
    stacks,
    tier: 1,
    remainingRounds: turns,
    sourceId: 'seed',
    ...extra,
});

const bomb = (stacks: number, countdown: number): PendingBomb => ({
    countdown,
    damagePerStack: 1,
    stacks,
    tier: 1,
    sourceId: 'seed',
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
    appliedSeq: 0,
});

const run = (side: Side, withImplant: boolean, seed: Seed, numRounds = 1): After => {
    const bus = createEventBus();
    const w = side.wearerId;
    const out: After = {
        named: new Map(),
        corrosion: [],
        inferno: [],
        bombs: [],
        forcedDetonations: 0,
        cuts: 0,
        infernoTicks: 0,
        accumulators: [],
        bursts: [],
        burstDamage: [],
    };
    let engine: StatusEngine | undefined;
    let wearer: CombatActor | undefined;
    bus.on('turn-started', (e: Extract<CombatEvent, { type: 'turn-started' }>) => {
        if (e.actorId !== w || e.round !== 1 || !engine) return;
        for (const n of seed.named ?? [])
            engine.applyTimedAbilityStatus(1, timed(n.name, n.turns), w, w);
    });
    bus.on('bomb-detonated', (e: Extract<CombatEvent, { type: 'bomb-detonated' }>) => {
        if (e.victimId === w && e.detonatorId === w) out.forcedDetonations += 1;
    });
    bus.on(
        'reactive-cleanse-performed',
        (e: Extract<CombatEvent, { type: 'reactive-cleanse-performed' }>) => {
            if (e.casterId === w && e.mode === 'reduce-duration') out.cuts += 1;
        }
    );
    bus.on('dot-ticked', (e: Extract<CombatEvent, { type: 'dot-ticked' }>) => {
        if (e.targetId === w && e.dotType === 'inferno') out.infernoTicks += 1;
    });
    bus.on(
        'accumulator-detonated',
        (e: Extract<CombatEvent, { type: 'accumulator-detonated' }>) => {
            if (e.victimId !== w) return;
            out.bursts.push(e.round);
            out.burstDamage.push(e.damage);
        }
    );
    runCombat({
        ...side.input(wearerKit(withImplant)),
        numRounds,
        bus,
        __testTapStatusEngine: (se: StatusEngine) => {
            engine = se;
        },
        __testTapActors: (all: CombatActor[]) => {
            wearer = all.find((a) => a.id === w);
            if (!wearer) throw new Error('wearer missing');
            wearer.currentHp = HP * 0.5;
            wearer.corrosionEntries.push(...(seed.corrosion ?? []).map((e) => ({ ...e })));
            wearer.infernoEntries.push(...(seed.inferno ?? []).map((e) => ({ ...e })));
            wearer.pendingBombs.push(...(seed.bombs ?? []).map((b) => ({ ...b })));
            wearer.pendingAccumulators.push(...(seed.accumulators ?? []).map((a) => ({ ...a })));
        },
    });
    if (!engine || !wearer) throw new Error('taps did not fire');
    for (const s of engine.timedAbilityStatuses('enemy', undefined, w)) {
        out.named.set(s.active.buffName, s.active.turnsRemaining as number);
    }
    out.corrosion = wearer.corrosionEntries.map((e) => ({
        stacks: e.stacks,
        remainingRounds: e.remainingRounds,
        appliedSeq: e.appliedSeq,
        ...(e.unremovable ? { unremovable: true } : {}),
        ...(e.family ? { family: e.family } : {}),
    }));
    out.inferno = wearer.infernoEntries.map((e) => ({
        stacks: e.stacks,
        remainingRounds: e.remainingRounds,
    }));
    out.bombs = wearer.pendingBombs.map((b) => ({ stacks: b.stacks, countdown: b.countdown }));
    out.accumulators = wearer.pendingAccumulators.map((a) => ({
        roundsRemaining: a.roundsRemaining,
    }));
    return out;
};

beforeEach(() => {
    setupKeyedRng(3);
});

const SEEDS = Array.from({ length: 24 }, (_, i) => i + 1);

for (const [tag, side] of SIDES) {
    describe(`${tag}: Warpstrike shortens a random removable debuff`, () => {
        it('carrying only one Corrosion stack → that stack loses a turn', () => {
            const seed: Seed = { corrosion: [dot(1, 9, { appliedSeq: 0 })] };
            const control = run(side, false, seed);
            const cut = run(side, true, seed);
            expect(control.corrosion).toHaveLength(1);
            expect(cut.corrosion.map((e) => e.remainingRounds)).toEqual([
                control.corrosion[0].remainingRounds - 1,
            ]);
            expect(cut.cuts).toBe(1);
        });

        it('one of three Corrosion stacks is split off with the shortened duration and the same appliedSeq', () => {
            const seed: Seed = { corrosion: [dot(3, 9, { appliedSeq: 0 })] };
            const control = run(side, false, seed);
            const cut = run(side, true, seed);
            const r = control.corrosion[0].remainingRounds;
            expect(control.corrosion).toEqual([{ stacks: 3, remainingRounds: r, appliedSeq: 0 }]);
            expect(cut.corrosion).toEqual([
                { stacks: 2, remainingRounds: r, appliedSeq: 0 },
                { stacks: 1, remainingRounds: r - 1, appliedSeq: 0 },
            ]);
        });

        it('a lone Inferno stack cut to 0 expires without its tick', () => {
            // Seeded at 2: the wearer's own turn takes one, the cut the other.
            const seed: Seed = { inferno: [dot(1, 2, { appliedSeq: 0 })] };
            const control = run(side, false, seed);
            const cut = run(side, true, seed);
            expect(control.inferno.map((e) => e.remainingRounds)).toEqual([1]);
            expect(cut.inferno).toEqual([]);
            expect(cut.cuts).toBe(1);
        });

        it('one named debuff and three Corrosion stacks → across seeds both kinds are picked', () => {
            const seed: Seed = {
                named: [{ name: 'Speed Down', turns: 9 }],
                corrosion: [dot(3, 9, { appliedSeq: 0 })],
            };
            setupKeyedRng(1);
            const control = run(side, false, seed);
            const namedBase = control.named.get('Speed Down');
            const dotBase = control.corrosion[0].remainingRounds;
            expect(namedBase).toBeDefined();
            let namedPicks = 0;
            let stackPicks = 0;
            for (const s of SEEDS) {
                setupKeyedRng(s);
                const cut = run(side, true, seed);
                const namedCut = cut.named.get('Speed Down') === namedBase! - 1;
                const shortStacks = cut.corrosion
                    .filter((e) => e.remainingRounds === dotBase - 1)
                    .reduce((n, e) => n + e.stacks, 0);
                // Exactly one debuff loses exactly one turn on every seed.
                expect((namedCut ? 1 : 0) + shortStacks).toBe(1);
                if (namedCut) namedPicks += 1;
                else stackPicks += 1;
            }
            expect(namedPicks).toBeGreaterThan(0);
            expect(stackPicks).toBeGreaterThan(0);
        });

        it('an unremovable debuff is picked too: across seeds both it and a removable one lose a turn (R173)', () => {
            const seed: Seed = {
                named: [{ name: 'Defense Down II', turns: 9 }],
                corrosion: [
                    dot(2, 9, { family: 'Acidic Decay', unremovable: true, appliedSeq: 0 }),
                ],
            };
            setupKeyedRng(1);
            const control = run(side, false, seed);
            const namedBase = control.named.get('Defense Down II');
            const decayBase = control.corrosion[0].remainingRounds;
            expect(namedBase).toBeDefined();
            let namedPicks = 0;
            let decayPicks = 0;
            for (const s of SEEDS) {
                setupKeyedRng(s);
                const cut = run(side, true, seed);
                const namedCut = cut.named.get('Defense Down II') === namedBase! - 1;
                const shortDecay = cut.corrosion
                    .filter((e) => e.remainingRounds === decayBase - 1)
                    .reduce((n, e) => n + e.stacks, 0);
                // Exactly one debuff loses exactly one turn on every seed.
                expect((namedCut ? 1 : 0) + shortDecay).toBe(1);
                // Every Acidic Decay stack stays unremovable and keeps its family.
                for (const e of cut.corrosion) {
                    expect(e.unremovable).toBe(true);
                    expect(e.family).toBe('Acidic Decay');
                }
                if (namedCut) namedPicks += 1;
                else decayPicks += 1;
            }
            expect(namedPicks).toBeGreaterThan(0);
            expect(decayPicks).toBeGreaterThan(0);
        });

        it('a named Acidic Decay is picked; a named Barrier Recharging never is (R173)', () => {
            const seed: Seed = {
                named: [
                    { name: 'Acidic Decay', turns: 9 },
                    { name: 'Barrier Recharging', turns: 9 },
                ],
            };
            setupKeyedRng(1);
            const control = run(side, false, seed);
            const decayBase = control.named.get('Acidic Decay');
            const barrierBase = control.named.get('Barrier Recharging');
            expect(decayBase).toBeDefined();
            expect(barrierBase).toBeDefined();
            for (const s of SEEDS) {
                setupKeyedRng(s);
                const cut = run(side, true, seed);
                expect(cut.named.get('Acidic Decay')).toBe(decayBase! - 1);
                expect(cut.named.get('Barrier Recharging')).toBe(barrierBase);
            }
        });

        it('a Bomb picked at countdown 1 detonates', () => {
            // Seeded at 2: the wearer's own turn takes it to 1, the cut to 0.
            const seed: Seed = { bombs: [bomb(1, 2)] };
            const control = run(side, false, seed);
            const cut = run(side, true, seed);
            expect(control.bombs).toEqual([{ stacks: 1, countdown: 1 }]);
            expect(control.forcedDetonations).toBe(0);
            expect(cut.bombs).toEqual([]);
            expect(cut.forcedDetonations).toBe(1);
        });

        it('an Echoing Burst cut from 1 round left to 0 bursts at the cut (R113)', () => {
            // Seeded at 2: the wearer's round-1 turn start takes it to 1, the cut to 0. Without
            // the cut it bursts at the wearer's round-2 turn start. The cut's burst pays what the
            // accumulator has gathered, `accumulated × pct/100`.
            const seed: Seed = {
                accumulators: [
                    {
                        roundsRemaining: 2,
                        pct: 50,
                        accumulated: 40,
                        sourceId: 'seed',
                        appliedSeq: 0,
                    },
                ],
            };
            const control = run(side, false, seed, 2);
            const cut = run(side, true, seed, 2);
            expect(control.bursts).toEqual([2]);
            expect(cut.bursts).toEqual([1]);
            expect(cut.burstDamage).toEqual([20]);
            expect(cut.accumulators).toEqual([]);
            expect(cut.cuts).toBeGreaterThanOrEqual(1);
        });

        it('one of two Bomb stacks at countdown 1 detonates alone; the other keeps its countdown', () => {
            const seed: Seed = { bombs: [bomb(2, 2)] };
            const control = run(side, false, seed);
            const cut = run(side, true, seed);
            expect(control.bombs).toEqual([{ stacks: 2, countdown: 1 }]);
            expect(cut.bombs).toEqual([{ stacks: 1, countdown: 1 }]);
            expect(cut.forcedDetonations).toBe(1);
        });

        it('carrying only Acidic Decay → it is cut and stays unremovable (R173)', () => {
            const seed: Seed = {
                corrosion: [
                    dot(2, 9, { family: 'Acidic Decay', unremovable: true, appliedSeq: 0 }),
                ],
            };
            const control = run(side, false, seed);
            const cut = run(side, true, seed);
            const r = control.corrosion[0].remainingRounds;
            expect(cut.corrosion).toEqual([
                {
                    stacks: 1,
                    remainingRounds: r,
                    appliedSeq: 0,
                    unremovable: true,
                    family: 'Acidic Decay',
                },
                {
                    stacks: 1,
                    remainingRounds: r - 1,
                    appliedSeq: 0,
                    unremovable: true,
                    family: 'Acidic Decay',
                },
            ]);
            expect(cut.cuts).toBe(1);
        });

        it('carrying only Barrier Recharging → nothing happens and nothing throws (R173)', () => {
            const seed: Seed = { named: [{ name: 'Barrier Recharging', turns: 9 }] };
            const control = run(side, false, seed);
            const cut = run(side, true, seed);
            expect(cut.named).toEqual(control.named);
            expect(cut.cuts).toBe(0);
        });
    });
}
