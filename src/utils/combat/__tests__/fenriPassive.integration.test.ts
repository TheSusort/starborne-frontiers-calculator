/**
 * Fenri's passive (#519):
 *
 *   "The Boss is immune to Control debuffs and Charge Loss effects and takes 50% less damage
 *    from DoTs. Every turn, the Boss gains Pressing Onslaught. Whenever any enemy unit dies, the
 *    Boss repairs 10% of its MAX HP and gains Attack Up II for 2 turns. Additionally, on kill,
 *    the Boss clears Pressing Onslaught."
 *
 * Owner rulings:
 *  - Stasis, Disable and every speed debuff are never attempted on him: no landing roll, no
 *    resist, no landing.
 *  - Provoke, Taunt and Concentrate Fire land on him as ordinary debuffs (rolled, resistible),
 *    but never force his target choice; Stealth never hides a unit from him either.
 *  - Charge Loss = charge removal.
 *  - Pressing Onslaught: +1 stack at the start of every round (never on an extra action),
 *    permanent, uncapped, never purged; every stack clears only on Fenri's DIRECT-damage kill —
 *    a DoT or a bomb kill is not his kill.
 *  - Any enemy death (DoT and bomb included) heals him 10% and grants Attack Up II.
 *
 * Every case runs with Fenri as the player focus, as an enemy, and as a walked player team actor.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import {
    createStatusEngine,
    type RegisteredAbilityStatus,
    type StatusEngine,
} from '../statusEngine';
import type { CombatActor } from '../state';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import {
    boardInput,
    hitKit,
    NO_KIT,
    realKit,
    type BoardUnit,
    type Placement,
} from '../__testutils__/realKitBoard';
import { textKit } from '../__testutils__/textKit';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { bossShip } from '../../../constants/bountyBosses';
import type { ShipSkills } from '../../../types/abilities';
import type { ConditionContext } from '../../abilities/evaluateConditions';
import { parseTarget } from '../../targetingParser';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable())
        throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
});
beforeEach(() => setupKeyedRng(1));

const FENRI_KIT = buildShipAbilities(bossShip('fenri', 32)!);
/** Fenri's kit with the immunity flags off: the arm that proves a scenario would land. */
const VULNERABLE_KIT: ShipSkills = {
    ...FENRI_KIT,
    controlImmune: undefined,
    chargeLossImmune: undefined,
};
const PO = 'Pressing Onslaught';

const fenriUnit = (kit: ShipSkills = FENRI_KIT, extra: Partial<BoardUnit> = {}): BoardUnit => ({
    id: 'fenri',
    kit,
    position: 'M1',
    speed: 100,
    attack: 10_000,
    hacking: 0,
    hp: 1_000_000,
    chargeCount: 99,
    ...extra,
});

const baseCtx: ConditionContext = {
    selfBuffNames: [],
    selfDebuffNames: [],
    enemyBuffNames: [],
    enemyDebuffCount: 0,
    effectiveCritRate: 0,
    enemyAdjacentCount: 0,
    adjacentAllyCount: 0,
    enemyDestroyedCount: 0,
    selfHpPct: 100,
    enemyHpPct: 100,
};

const stacksOf = (eng: StatusEngine, ownerId: string, buffName: string): number =>
    eng
        .activeAbilityStatuses('self', () => baseCtx, ownerId)
        .find((s) => s.active.buffName === buffName)?.active.stacks ?? 0;

interface FightLog {
    fenriId: string;
    events: CombatEvent[];
    engine: StatusEngine;
    actors: CombatActor[];
}

const run = (input: CombatEngineInput, fenriId: string): FightLog => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const record = (e: CombatEvent) => events.push(e);
    for (const type of [
        'debuff-applied',
        'debuff-resisted',
        'control-applied',
        'buff-applied',
        'ability-performed',
        'ship-destroyed',
        'heal-performed',
    ] as const)
        bus.on(type, record);
    let engine: StatusEngine | undefined;
    let actors: CombatActor[] = [];
    runCombat({
        ...input,
        bus,
        __testTapStatusEngine: (e) => (engine = e),
        __testTapActors: (a) => (actors = a),
    });
    return { fenriId, events, engine: engine!, actors };
};

const onFenri = (log: FightLog, buffName: string) => ({
    applied: log.events.filter(
        (e) => e.type === 'debuff-applied' && e.targetId === log.fenriId && e.buffName === buffName
    ).length,
    resisted: log.events.filter(
        (e) => e.type === 'debuff-resisted' && e.targetId === log.fenriId && e.buffName === buffName
    ).length,
    controlled: log.events.filter((e) => e.type === 'control-applied' && e.targetId === log.fenriId)
        .length,
});

// ---------------------------------------------------------------------------------------------
// Control immunity
// ---------------------------------------------------------------------------------------------

const DEBUFFER_TEXTS: Record<string, string> = {
    'Speed Down II':
        'This Unit deals <unit-damage>1% damage</unit-damage> and inflicts <unit-skill>Speed Down II</unit-skill> for 2 turns.',
    Stasis: 'This Unit deals <unit-damage>1% damage</unit-damage> and inflicts <unit-skill>Stasis</unit-skill> for 1 turn.',
    Provoke:
        'This Unit deals <unit-damage>1% damage</unit-damage> and applies <unit-skill>Provoke</unit-skill> for 1 turn.',
    'Concentrate Fire':
        'This Unit deals <unit-damage>1% damage</unit-damage> and applies <unit-skill>Concentrate Fire</unit-skill> for 1 turn.',
    Disable:
        'This Unit deals <unit-damage>1% damage</unit-damage> and inflicts <unit-skill>Disable</unit-skill> for 1 turn.',
    'Defense Down II':
        'This Unit deals <unit-damage>1% damage</unit-damage> and inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns.',
};

const debuffer = (buffName: string): BoardUnit => ({
    id: 'debuffer',
    kit: textKit('Debuffer', { active: DEBUFFER_TEXTS[buffName] }),
    position: 'M4',
    speed: 300,
    attack: 1,
    hacking: 1e6,
});

/** Fenri's placement, including as a walked team actor beside a player focus. */
type FenriSeat = Placement | 'player-ally';
const SEATS: FenriSeat[] = ['player', 'enemy', 'player-ally'];

const seatInput = (
    seat: FenriSeat,
    fenri: BoardUnit,
    opponents: BoardUnit[],
    rounds: number,
    allies: BoardUnit[] = []
): { input: CombatEngineInput; fenriId: string; id: (u: BoardUnit) => string } => {
    if (seat === 'player-ally') {
        const focus: BoardUnit = { id: 'focus', kit: NO_KIT, position: 'B1', speed: 1 };
        const { input, id } = boardInput('player', focus, [fenri, ...allies], opponents, rounds);
        return { input, fenriId: id(fenri), id };
    }
    const { input, id } = boardInput(seat, fenri, allies, opponents, rounds);
    return { input, fenriId: id(fenri), id };
};

describe.each<FenriSeat>(SEATS)('Fenri control immunity (Fenri seated %s)', (seat) => {
    const fightWith = (kit: ShipSkills, opponent: BoardUnit) => {
        const { input, fenriId } = seatInput(seat, fenriUnit(kit), [opponent], 2);
        return run(input, fenriId);
    };

    it.each(['Speed Down II', 'Stasis', 'Disable'])(
        'a cast %s on Fenri is never attempted',
        (buffName) => {
            const vulnerable = onFenri(fightWith(VULNERABLE_KIT, debuffer(buffName)), buffName);
            expect(vulnerable.applied).toBeGreaterThan(0);

            const immune = onFenri(fightWith(FENRI_KIT, debuffer(buffName)), buffName);
            expect(immune).toEqual({ applied: 0, resisted: 0, controlled: 0 });
        }
    );

    it.each(['Provoke', 'Concentrate Fire'])(
        'a cast %s lands on Fenri, or is resisted, like any debuff',
        (buffName) => {
            expect(
                onFenri(fightWith(FENRI_KIT, debuffer(buffName)), buffName).applied
            ).toBeGreaterThan(0);

            // Held in his debuff store, where every per-debuff count reads it.
            const lasting: BoardUnit = {
                ...debuffer(buffName),
                kit: textKit('Debuffer', {
                    active: DEBUFFER_TEXTS[buffName].replace('for 1 turn', 'for 2 turns'),
                }),
            };
            const held = seatInput(seat, fenriUnit(), [lasting], 1);
            const heldLog = run(held.input, held.fenriId);
            expect(
                heldLog.engine
                    .timedAbilityStatuses('enemy', undefined, held.fenriId)
                    .map((st) => st.active.buffName)
            ).toContain(buffName);

            // An applied debuff is resisted on affinity disadvantage (electric beats thermal).
            const { input, fenriId } = seatInput(
                seat,
                fenriUnit(FENRI_KIT, { affinity: 'electric' }),
                [{ ...debuffer(buffName), affinity: 'thermal' }],
                4
            );
            const resisted = onFenri(run(input, fenriId), buffName);
            expect(resisted.resisted).toBeGreaterThan(0);
        }
    );

    it('a non-control debuff still lands on Fenri', () => {
        const log = fightWith(FENRI_KIT, debuffer('Defense Down II'));
        expect(onFenri(log, 'Defense Down II').applied).toBeGreaterThan(0);
    });

    const standaloneController = (effect: 'stasis' | 'concentrate-fire'): BoardUnit => ({
        ...debuffer('Stasis'),
        kit: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ...hitKit(1).slots[0].abilities,
                        {
                            id: `test-${effect}`,
                            type: 'control',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'control', effect },
                        },
                    ],
                },
            ],
        },
    });

    it('a standalone Stasis control does not announce a control on Fenri', () => {
        const controller = standaloneController('stasis');
        expect(onFenri(fightWith(VULNERABLE_KIT, controller), 'Stasis').controlled).toBeGreaterThan(
            0
        );
        expect(onFenri(fightWith(FENRI_KIT, controller), 'Stasis').controlled).toBe(0);
    });

    it('a standalone Concentrate Fire control announces a control on Fenri', () => {
        const controller = standaloneController('concentrate-fire');
        expect(
            onFenri(fightWith(FENRI_KIT, controller), 'Concentrate Fire').controlled
        ).toBeGreaterThan(0);
    });

    // Reactive inflictions: Iridium (Speed Down on being attacked) and Flamel (Stasis + Speed
    // Down). Fenri attacks each; both ride the reactive debuff path.
    it.each([
        ['Iridium', ['Speed Down I', 'Speed Down II']],
        ['Flamel', ['Stasis', 'Speed Down I']],
    ])('%s reacting to Fenri lands nothing of %j on him', (ship, names) => {
        const reactor: BoardUnit = {
            id: 'reactor',
            kit: realKit(ship),
            position: 'M4',
            speed: 1,
            hacking: 1e6,
            hp: 1e12,
        };
        const tally = (kit: ShipSkills) => {
            const log = fightWith(kit, reactor);
            return names
                .map((n) => onFenri(log, n))
                .reduce((a, b) => ({
                    applied: a.applied + b.applied,
                    resisted: a.resisted + b.resisted,
                    controlled: a.controlled + b.controlled,
                }));
        };
        expect(tally(VULNERABLE_KIT).applied).toBeGreaterThan(0);
        expect(tally(FENRI_KIT)).toEqual({ applied: 0, resisted: 0, controlled: 0 });
    });

    it('charge removal leaves his charges alone', () => {
        const drainer: BoardUnit = {
            id: 'drainer',
            kit: textKit('Drainer', {
                active: 'This Unit deals <unit-damage>1% damage</unit-damage> and <unit-skill>removes all charges</unit-skill> from the enemy charged skill.',
            }),
            position: 'M4',
            speed: 300,
            attack: 1,
            hacking: 1e6,
        };
        const chargedCasts = (kit: ShipSkills) => {
            const { input, fenriId } = seatInput(
                seat,
                fenriUnit(kit, { chargeCount: 2 }),
                [drainer],
                6
            );
            return run(input, fenriId).events.filter(
                (e) =>
                    e.type === 'ability-performed' &&
                    e.actorId === fenriId &&
                    e.sourceSlot === 'charged'
            ).length;
        };
        expect(chargedCasts(VULNERABLE_KIT)).toBe(0);
        expect(chargedCasts(FENRI_KIT)).toBeGreaterThan(0);
    });
});

describe('Fenri control immunity — scheduled (picker) debuffs', () => {
    it("the player's picked Speed Down II is never attempted on Fenri", () => {
        const picker: BoardUnit = { id: 'picker', kit: hitKit(1), position: 'M4', speed: 300 };
        const scheduled = (kit: ShipSkills) => {
            const fenri = fenriUnit(kit);
            const { input, id } = boardInput('enemy', fenri, [], [picker], 2);
            const log = run(
                {
                    ...input,
                    hacking: 1e6,
                    enemyDebuffs: [
                        {
                            id: 'sd',
                            buffName: 'Speed Down II',
                            stacks: 1,
                            parsedEffects: { speed: -30 },
                            isStackable: false,
                            skillSource: 'active',
                            skillDuration: 2,
                            application: 'inflict',
                        },
                    ],
                },
                id(fenri)
            );
            return onFenri(log, 'Speed Down II');
        };
        expect(scheduled(VULNERABLE_KIT).applied).toBeGreaterThan(0);
        expect(scheduled(FENRI_KIT)).toEqual({ applied: 0, resisted: 0, controlled: 0 });
    });

    // A pick with no skill source is re-applied every round and re-rolls its landing each time.
    it("the player's recurring Speed Down II neither lands on nor is resisted by Fenri", () => {
        const picker: BoardUnit = { id: 'picker', kit: hitKit(1), position: 'M4', speed: 300 };
        const recurring = (kit: ShipSkills, hacking: number) => {
            const fenri = fenriUnit(kit);
            const { input, id } = boardInput('enemy', fenri, [], [picker], 2);
            const bus = createEventBus();
            const resisted: CombatEvent[] = [];
            bus.on('debuff-resisted', (e) => {
                if (e.targetId === id(fenri) && e.buffName === 'Speed Down II') resisted.push(e);
            });
            const { rounds } = runCombat({
                ...input,
                bus,
                hacking,
                enemyDebuffs: [
                    {
                        id: 'sd',
                        buffName: 'Speed Down II',
                        stacks: 1,
                        parsedEffects: { speed: -30 },
                        isStackable: false,
                        application: 'inflict',
                    },
                ],
            });
            const named = (list: { buffName: string }[] | undefined) =>
                (list ?? []).filter((b) => b.buffName === 'Speed Down II').length;
            return {
                landed: rounds.reduce((n, r) => n + named(r.activeEnemyDebuffs), 0),
                resisted: resisted.length,
            };
        };
        expect(recurring(VULNERABLE_KIT, 1e6).landed).toBeGreaterThan(0);
        expect(recurring(VULNERABLE_KIT, 0).resisted).toBeGreaterThan(0);
        expect(recurring(FENRI_KIT, 1e6)).toEqual({ landed: 0, resisted: 0 });
        expect(recurring(FENRI_KIT, 0)).toEqual({ landed: 0, resisted: 0 });
    });
});

describe.each<FenriSeat>(SEATS)('Fenri ignores forced targeting (Fenri seated %s)', (seat) => {
    // Fenri targets `front`: his normal pick is the front unit at M4. The forcing unit stands
    // at M1, so a forced hit and a normal one land on different units.
    const normalPick: BoardUnit = { id: 'normal', kit: NO_KIT, position: 'M4', speed: 1, hp: 1e12 };
    const fast = (id: string, active: string, position: BoardUnit['position']): BoardUnit => ({
        id,
        kit: textKit(id, { active }),
        position,
        speed: 300,
        attack: 1,
        hacking: 1e6,
        hp: 1e12,
    });
    /** The unit each of Fenri's round-1 sub-attacks lands on (its first victim; `targetId` names
     *  the cast's target on every sub-attack). */
    const targets = (
        kit: ShipSkills,
        opponents: BoardUnit[],
        allies: BoardUnit[] = []
    ): (string | undefined)[] => {
        const { input, fenriId, id } = seatInput(seat, fenriUnit(kit), opponents, 1, allies);
        const log = run(input, fenriId);
        const byId = new Map(opponents.map((u) => [id(u), u.id]));
        return log.events.flatMap((e) =>
            e.type === 'ability-performed' && e.actorId === fenriId && e.abilityType === 'damage'
                ? [byId.get(e.victimIds?.[0] ?? e.targetId)]
                : []
        );
    };
    const firstTarget = (kit: ShipSkills, opponents: BoardUnit[], allies: BoardUnit[] = []) =>
        targets(kit, opponents, allies)[0];

    it('Provoke on Fenri does not force his target', () => {
        const provoker = fast(
            'provoker',
            'This Unit deals <unit-damage>1% damage</unit-damage> and applies <unit-skill>Provoke</unit-skill> for 1 turn.',
            'M1'
        );
        expect(firstTarget(VULNERABLE_KIT, [normalPick, provoker])).toBe('provoker');
        expect(firstTarget(FENRI_KIT, [normalPick, provoker])).toBe('normal');
    });

    it('a Taunting enemy does not force his target', () => {
        const taunter = fast(
            'taunter',
            'This Unit gains <unit-skill>Taunt</unit-skill> for 2 turns.',
            'M1'
        );
        expect(firstTarget(VULNERABLE_KIT, [normalPick, taunter])).toBe('taunter');
        expect(firstTarget(FENRI_KIT, [normalPick, taunter])).toBe('normal');
    });

    const marked: BoardUnit = { id: 'marked', kit: NO_KIT, position: 'M1', speed: 1, hp: 1e12 };
    // Fenri's ally marks the back unit before Fenri acts.
    const marker: BoardUnit = {
        ...fast(
            'marker',
            'This Unit deals <unit-damage>1% damage</unit-damage> and applies <unit-skill>Concentrate Fire</unit-skill> for 2 turns.',
            'T1'
        ),
        target: parseTarget('back'),
    };

    it('Concentrate Fire on an enemy does not force his target', () => {
        expect(firstTarget(VULNERABLE_KIT, [normalPick, marked], [marker])).toBe('marked');
        expect(firstTarget(FENRI_KIT, [normalPick, marked], [marker])).toBe('normal');
    });

    it('every hit of a multi-hit cast ignores Concentrate Fire, not only the first', () => {
        const twoHits = hitKit(1, 2);
        expect(targets(twoHits, [normalPick, marked], [marker])).toEqual(['marked', 'marked']);
        expect(
            targets({ ...twoHits, controlImmune: true }, [normalPick, marked], [marker])
        ).toEqual(['normal', 'normal']);
    });

    it('a Stealthed front enemy is still his target', () => {
        const stealthed = fast(
            'stealthed',
            'This Unit gains <unit-skill>Stealth</unit-skill> for 2 turns.',
            'M4'
        );
        const visible: BoardUnit = {
            id: 'visible',
            kit: NO_KIT,
            position: 'M1',
            speed: 1,
            hp: 1e12,
        };
        expect(firstTarget(VULNERABLE_KIT, [stealthed, visible])).toBe('visible');
        expect(firstTarget(FENRI_KIT, [stealthed, visible])).toBe('stealthed');
    });
});

describe.each<FenriSeat>(SEATS)('Fenri control immunity tripwire (Fenri seated %s)', (seat) => {
    // Real control/speed kits, charged and hacking-maxed, against Fenri: charged and active casts
    // (Xcellence, Morao, Bizon, Huanying), a passive-slot rider on the cast (Bayah), a
    // start-of-round grant on the highest-attack enemy (Selenite) and an adjacent-enemies fan-out
    // (Vindicator, aimed at a decoy beside Fenri). Whatever path each infliction takes, no
    // Stasis, Disable or speed debuff reaches Fenri: no landing, no resist, no control, nothing
    // left in his debuff store. Provoke and Concentrate Fire reach him like any debuff.
    const BLOCKED = /^(Stasis|Disable|Speed Down.*)$/;
    const FORCING = /^(Provoke|Taunt|Concentrate Fire)$/;
    const BLOCKED_EFFECTS: ReadonlySet<string> = new Set(['stasis', 'disable']);
    const controller = (ship: string): BoardUnit => ({
        id: ship.toLowerCase(),
        kit: realKit(ship),
        position: 'M4',
        speed: 300,
        attack: 1,
        hacking: 1e6,
        chargeCount: 1,
        startCharged: true,
        target: parseTarget('front'),
    });
    const outcome = (ship: string, kit: ShipSkills, names: RegExp = BLOCKED) => {
        // The decoy stands in front of Fenri (M1) so Vindicator's fan-out reaches him.
        const allies: BoardUnit[] =
            ship === 'Vindicator'
                ? [{ id: 'decoy', kit: NO_KIT, position: 'M2', speed: 1, hp: 1e12 }]
                : [];
        const { input, fenriId } = seatInput(
            seat,
            // Durable: Vindicator's Magnetized Shielding reflects Fenri's hits back at him.
            fenriUnit(kit, { hp: 1e12 }),
            [controller(ship)],
            3,
            allies
        );
        const log = run(input, fenriId);
        const touching = log.events.filter(
            (e) =>
                (e.type === 'debuff-applied' || e.type === 'debuff-resisted') &&
                e.targetId === fenriId &&
                names.test(e.buffName)
        ).length;
        const controlled = log.events.filter(
            (e) =>
                e.type === 'control-applied' &&
                e.targetId === fenriId &&
                BLOCKED_EFFECTS.has(e.effect)
        ).length;
        const held = log.engine
            .timedAbilityStatuses('enemy', undefined, fenriId)
            .map((st) => st.active.buffName)
            .filter((n) => names.test(n));
        return { touching, controlled, held };
    };

    it.each(['Xcellence', 'Bizon', 'Bayah'])(
        "%s's Stasis, Disable and speed debuffs never touch Fenri",
        (ship) => {
            expect(outcome(ship, VULNERABLE_KIT).touching).toBeGreaterThan(0);
            expect(outcome(ship, FENRI_KIT)).toEqual({ touching: 0, controlled: 0, held: [] });
        }
    );

    it.each(['Morao', 'Huanying', 'Selenite', 'Vindicator'])(
        "%s's Provoke or Concentrate Fire reaches Fenri",
        (ship) => {
            expect(outcome(ship, FENRI_KIT, FORCING).touching).toBeGreaterThan(0);
        }
    );
});

// ---------------------------------------------------------------------------------------------
// Pressing Onslaught
// ---------------------------------------------------------------------------------------------

describe.each<FenriSeat>(SEATS)('Pressing Onslaught (Fenri seated %s)', (seat) => {
    const durable = (id: string, position: BoardUnit['position']): BoardUnit => ({
        id,
        kit: NO_KIT,
        position,
        speed: 1,
        hp: 1e12,
    });

    it('direct damage grows by 10% per round, uncapped', () => {
        const dummy = durable('dummy', 'M4');
        const { input, fenriId } = seatInput(seat, fenriUnit(), [dummy], 12);
        const bus = createEventBus();
        const hits: Extract<CombatEvent, { type: 'ability-performed' }>[] = [];
        bus.on('ability-performed', (e: Extract<CombatEvent, { type: 'ability-performed' }>) => {
            if (e.actorId === fenriId && e.abilityType === 'damage') hits.push(e);
        });
        runCombat({ ...input, bus });
        const byRound = (r: number) => hits.find((h) => h.round === r)!.damage!;
        expect(byRound(2) / byRound(1)).toBeCloseTo(1.2 / 1.1, 9);
        expect(byRound(3) / byRound(1)).toBeCloseTo(1.3 / 1.1, 9);
        expect(byRound(12) / byRound(1)).toBeCloseTo(2.2 / 1.1, 9);
    });

    it('his White Phosphorus ticks do not grow with his stacks', () => {
        // Doom Shot in round 1 lands one White Phosphorus III; it ticks while stacks pile up.
        const dummy = durable('dummy', 'M4');
        const fenri = fenriUnit(FENRI_KIT, { startCharged: true, hacking: 1e6 });
        const { input, id } = seatInput(seat, fenri, [dummy], 5);
        const ticks: number[] = [];
        const bus = createEventBus();
        bus.on('dot-ticked', (e: Extract<CombatEvent, { type: 'dot-ticked' }>) => {
            if (e.targetId === id(dummy) && e.tier === 45) ticks.push(e.damage / e.stacks);
        });
        runCombat({ ...input, bus });
        expect(ticks.length).toBeGreaterThan(1);
        for (const t of ticks) expect(t).toBeCloseTo(ticks[0], 6);
    });

    const stacksAfter = (rounds: number, fenri: BoardUnit, opponents: BoardUnit[]) => {
        const { input, id } = seatInput(seat, fenri, opponents, rounds);
        const log = run(input, id(fenri));
        return { log, id, stacks: stacksOf(log.engine, log.fenriId, PO) };
    };

    it("Fenri's direct kill clears every stack; the next round adds one", () => {
        const victim: BoardUnit = { id: 'victim', kit: NO_KIT, position: 'M4', speed: 1, hp: 1 };
        const opponents = [victim, durable('body', 'M1')];
        const one = stacksAfter(1, fenriUnit(), opponents);
        expect(
            one.log.events.some(
                (e) =>
                    e.type === 'ship-destroyed' &&
                    e.actorId === one.id(victim) &&
                    e.killerId === one.log.fenriId
            )
        ).toBe(true);
        expect(one.stacks).toBe(0);
        expect(stacksAfter(2, fenriUnit(), opponents).stacks).toBe(1);
        expect(stacksAfter(4, fenriUnit(), opponents).stacks).toBe(3);
    });

    it('a DoT kill by his ally heals Fenri and grants Attack Up II, keeping his stacks', () => {
        const burner: BoardUnit = {
            id: 'burner',
            kit: textKit('Burner', {
                active: 'This Unit inflicts <unit-skill>Inferno III</unit-skill> for 3 turns.',
            }),
            position: 'T1',
            speed: 300,
            attack: 1_000_000,
            hacking: 1e6,
            target: parseTarget('back'),
        };
        const victim: BoardUnit = { id: 'victim', kit: NO_KIT, position: 'M1', speed: 1, hp: 10 };
        const body = durable('body', 'M4');
        const fenri = fenriUnit();
        const { input, id } = seatInput(seat, fenri, [victim, body], 4, [burner]);
        const fenriId = id(fenri);
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        for (const type of ['ship-destroyed', 'buff-applied', 'heal-performed'] as const)
            bus.on(type, (e: CombatEvent) => events.push(e));
        let engine: StatusEngine | undefined;
        let actors: CombatActor[] = [];
        runCombat({
            ...input,
            bus,
            __testTapStatusEngine: (e) => (engine = e),
            __testTapActors: (a) => {
                actors = a;
                for (const x of a) if (x.id === fenriId) x.currentHp = x.stats.hp / 2;
            },
        });
        const death = events.find((e) => e.type === 'ship-destroyed' && e.actorId === id(victim));
        expect(death).toBeDefined();
        expect(death && 'byDirectDamage' in death ? death.byDirectDamage : undefined).toBe(false);
        expect(
            events.some(
                (e) =>
                    e.type === 'buff-applied' &&
                    e.actorId === fenriId &&
                    e.buffName === 'Attack Up II'
            )
        ).toBe(true);
        expect(actors.find((a) => a.id === fenriId)!.currentHp).toBeCloseTo(0.6 * 1_000_000, 0);
        expect(stacksOf(engine!, fenriId, PO)).toBe(4);
    });

    it("Fenri's own bomb kill heals him but keeps his stacks", () => {
        // Fenri's passive with a bomb-throwing active: the 1% hit never kills, the bomb does.
        const bomberFenri: ShipSkills = {
            ...FENRI_KIT,
            slots: [
                ...textKit('Bomber', {
                    active: 'This Unit deals <unit-damage>1% damage</unit-damage> and inflicts <unit-skill>Bomb III</unit-skill> for 1 turn.',
                }).slots.filter((s) => s.slot === 'active'),
                ...FENRI_KIT.slots.filter((s) => s.slot === 'passive'),
            ],
        };
        const fenri = fenriUnit(bomberFenri, { hacking: 1e6 });
        const victim: BoardUnit = {
            id: 'victim',
            kit: NO_KIT,
            position: 'M4',
            speed: 1,
            hp: 20_000,
        };
        const { log, id, stacks } = stacksAfter(4, fenri, [victim, durable('body', 'M1')]);
        const death = log.events.find(
            (e) => e.type === 'ship-destroyed' && e.actorId === id(victim)
        ) as Extract<CombatEvent, { type: 'ship-destroyed' }> | undefined;
        expect(death?.killerId).toBe(log.fenriId);
        expect(
            log.events.some(
                (e) =>
                    e.type === 'buff-applied' &&
                    e.actorId === log.fenriId &&
                    e.buffName === 'Attack Up II'
            )
        ).toBe(true);
        expect(stacks).toBe(4);
    });

    it('a purge on Fenri never removes Pressing Onslaught', () => {
        const purger: BoardUnit = {
            id: 'purger',
            kit: textKit('Purger', {
                active: 'This Unit <unit-skill>purges 2 buffs</unit-skill> from the enemy and deals <unit-damage>1% damage</unit-damage>.',
            }),
            position: 'M4',
            speed: 300,
            attack: 1,
            hacking: 1e6,
        };
        const { log, stacks } = stacksAfter(3, fenriUnit(), [purger]);
        expect(log.events.length).toBeGreaterThan(0);
        expect(stacks).toBe(3);
    });
});

describe('Pressing Onslaught accrual cadence (status engine)', () => {
    const accum = (buffName: string, maxStacks?: number): RegisteredAbilityStatus => ({
        payload: { buffName, stacks: 1, isStackable: true, parsedEffects: { outgoingDamage: 10 } },
        side: 'self',
        sourceSlot: 'passive',
        conditions: [],
        casterId: 'f',
        kind: 'accumulating',
        ...(maxStacks !== undefined ? { maxStacks } : {}),
        stackTrigger: 'per-round',
    });

    it('banks once per round, never on an extra action; an every-turn stack still does', () => {
        const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        eng.registerAbilityStatuses([accum(PO), accum('Blast', 10)], 'f');
        eng.beginRound(1);
        eng.beginTurn('f');
        eng.beginTurn('f');
        expect(stacksOf(eng, 'f', PO)).toBe(1);
        expect(stacksOf(eng, 'f', 'Blast')).toBe(2);
        eng.beginRound(2);
        eng.beginTurn('f');
        expect(stacksOf(eng, 'f', PO)).toBe(2);
    });
});
