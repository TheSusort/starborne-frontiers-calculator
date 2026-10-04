/**
 * An on-kill reaction worded on the owner's own kill ("Upon destroying an enemy with a debuff,
 * this Unit inflicts Stasis on all adjacent enemies" — Meiying; "When this Unit destroys an
 * enemy it adds 1 charge" — Valiant) fires only when the OWNER lands the kill (owner ruling R18,
 * 2026-10-04): any enemy she destroys, aimed or covered, that had at least one debuff → Stasis on
 * THAT enemy's neighbours. A teammate's kill, or a DoT tick (which has no killer), is not hers.
 * "When an enemy is destroyed" (Liberator) keeps reacting to every opposing death. A DoT counts as
 * a debuff for "an enemy with a debuff" (ruling 8: each DoT stack is a debuff).
 *
 * Real parsed kits (buildTraceShip, refit 4). Meiying fires Pattern-Backline-Range-2 at the back
 * line: A at M1 is aimed, B at M3 is covered; T1/B1 neighbour A, T3/B3 neighbour B. Every debuff
 * lands (hacking dwarfs security).
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
import type { RegisteredAbilityStatus, StatusEngine } from '../statusEngine';
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

const realSlot = (ship: string, slot: 'active' | 'passive'): Ability[] => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.find((s) => s.slot === slot);
    if (!found) throw new Error(`${ship} has no ${slot} slot`);
    return found.abilities;
};
const MEIYING = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: realSlot('Meiying', 'active') },
        { slot: 'passive', abilities: realSlot('Meiying', 'passive') },
    ],
});
/** `ship`'s passive alone: it never casts anything of its own. */
const passiveOnly = (ship: string): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        { slot: 'passive', abilities: realSlot(ship, 'passive') },
    ],
});
const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };
const HIT: ShipSkills = {
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'kill-hit',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
            ],
        },
    ],
};

const LOW = 1000;
const HIGH = 1e12;
const BIG = 1e6;

const corrosion = (n: number, sourceId: string): ActiveDoTStack[] =>
    Array.from({ length: n }, () => ({ stacks: 1, tier: 9, remainingRounds: 9, sourceId }));
const namedDebuff = (): Extract<RegisteredAbilityStatus, { kind: 'timed' }> => ({
    kind: 'timed',
    side: 'enemy',
    sourceSlot: 'active',
    conditions: [],
    duration: 9,
    payload: { buffName: 'Defense Down I', stacks: 1, parsedEffects: {} },
});

interface Cell {
    pos: Position;
    hp: number;
    /** A named debuff in the status engine. */
    debuff?: boolean;
    /** Corrosion entries, sourced from `dotSource`. */
    dots?: number;
}
type Label = 'A' | 'B' | 'T1' | 'B1' | 'T3' | 'B3';
const board = (a: Partial<Cell>, b: Partial<Cell> = {}): Record<Label, Cell> => ({
    A: { pos: 'M1', hp: HIGH, ...a },
    B: { pos: 'M3', hp: HIGH, ...b },
    T1: { pos: 'T1', hp: HIGH },
    B1: { pos: 'B1', hp: HIGH },
    T3: { pos: 'T3', hp: HIGH },
    B3: { pos: 'B3', hp: HIGH },
});

interface Run {
    /** Sorted labels Meiying's Stasis landed on. */
    stasis: string[];
    /** Sorted labels destroyed. */
    destroyed: string[];
}

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 6,
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
    hp: 1e9,
    hacking: 1e4,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('back'),
    pattern: parsePattern('Pattern-Backline-Range-2'),
    speed: 100,
    ...over,
});
const enemyAt = (id: string, c: Cell): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: c.hp, speed: 150, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position: c.pos,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: NO_SKILLS,
});
const playerShip = (
    id: string,
    position: Position,
    hp: number,
    skills: ShipSkills = NO_SKILLS,
    speed = 150,
    attack = 0
): TeamActor => ({
    id,
    speed,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parseTarget('back'),
    pattern: parsePattern('Pattern-Base'),
    walk: {
        shipSkills: skills,
        stats: {
            attack,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 1e4,
            defence: 0,
            hp,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const measure = (
    input: CombatEngineInput,
    casterId: string,
    idToLabel: Record<string, string>,
    cells: Record<Label, Cell>,
    dotSource: string
): Run => {
    const bus = createEventBus();
    const L = (id: string) => idToLabel[id] ?? id;
    const stasis: string[] = [];
    const destroyed: string[] = [];
    let engine: StatusEngine | undefined;
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.sourceId === casterId && e.buffName === 'Stasis') stasis.push(L(e.targetId));
    });
    bus.on('ship-destroyed', (e: Extract<CombatEvent, { type: 'ship-destroyed' }>) => {
        destroyed.push(L(e.actorId));
    });
    bus.on('round-started', (e: Extract<CombatEvent, { type: 'round-started' }>) => {
        if (e.round !== 1 || !engine) return;
        for (const [id, label] of Object.entries(idToLabel)) {
            if (cells[label as Label]?.debuff)
                engine.applyTimedAbilityStatus(1, namedDebuff(), undefined, id);
        }
    });
    runCombat({
        ...input,
        bus,
        __testTapStatusEngine: (se) => {
            engine = se;
        },
        __testTapActors: (all) => {
            for (const a of all) {
                const c = cells[idToLabel[a.id] as Label];
                if (c?.dots) a.corrosionEntries.push(...corrosion(c.dots, dotSource));
            }
        },
    });
    return { stasis: stasis.sort(), destroyed: destroyed.sort() };
};

interface Opts {
    meiAttack: number;
    /** A fast teammate with a lethal hit at the back line. */
    killer?: boolean;
    /** Corrosion entries' source: Meiying herself, or a teammate. */
    dotsFrom?: 'meiying' | 'teammate';
    rounds?: number;
}

/** Player Meiying at M4 against the six-enemy board. */
const playerSide = (cells: Record<Label, Cell>, o: Opts): Run => {
    const idToLabel: Record<string, string> = {};
    const enemies: EnemyAttacker[] = [];
    for (const [label, c] of Object.entries(cells)) {
        idToLabel[`e-${label}`] = label;
        enemies.push(enemyAt(`e-${label}`, c));
    }
    const team: TeamActor[] = [];
    if (o.killer) team.push(playerShip('killer', 'M3', 1e9, HIT, 200, BIG));
    if (o.dotsFrom === 'teammate') team.push(playerShip('dotter', 'M2', 1e9));
    return measure(
        base({
            shipSkills: MEIYING(),
            attack: o.meiAttack,
            numRounds: o.rounds ?? 1,
            teamActors: team,
            enemyAttackers: enemies,
        }),
        'attacker',
        idToLabel,
        cells,
        o.dotsFrom === 'teammate' ? 'dotter' : 'attacker'
    );
};

/** Enemy Meiying at M4 against the player side: A is the focus, the rest are team ships. */
const enemySide = (cells: Record<Label, Cell>, o: Opts): Run => {
    const idToLabel: Record<string, string> = { attacker: 'A' };
    const team: TeamActor[] = [];
    for (const [label, c] of Object.entries(cells)) {
        if (label === 'A') continue;
        idToLabel[`p-${label}`] = label;
        team.push(playerShip(`p-${label}`, c.pos, c.hp));
    }
    const enemies: EnemyAttacker[] = [
        {
            id: 'enemy-mei',
            stats: {
                attack: o.meiAttack,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1e9,
                speed: 10,
                security: 0,
                hacking: 1e4,
            },
            chargeCount: 6,
            startCharged: false,
            position: 'M4',
            target: parseTarget('back'),
            pattern: parsePattern('Pattern-Backline-Range-2'),
            shipSkills: MEIYING(),
        },
    ];
    if (o.killer)
        enemies.push({
            ...enemyAt('enemy-killer', { pos: 'M3', hp: 1e9 }),
            stats: {
                attack: BIG,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1e9,
                speed: 200,
                security: 0,
                hacking: 1e4,
            },
            target: parseTarget('back'),
            shipSkills: HIT,
        });
    if (o.dotsFrom === 'teammate') enemies.push(enemyAt('enemy-dotter', { pos: 'M2', hp: 1e9 }));
    return measure(
        base({
            attack: 0,
            hacking: 0,
            hp: cells.A.hp,
            speed: 150,
            position: cells.A.pos,
            teamActors: team,
            enemyAttackers: enemies,
        }),
        'enemy-mei',
        idToLabel,
        cells,
        o.dotsFrom === 'teammate' ? 'enemy-dotter' : 'enemy-mei'
    );
};

beforeEach(() => {
    setupKeyedRng(5);
});

describe('Meiying: her own kill of a debuffed enemy stasises its neighbours', () => {
    for (const [tag, side] of [
        ['player', playerSide],
        ['enemy-side', enemySide],
    ] as const) {
        it(`${tag}: she kills debuffed A → Stasis on T1 and B1`, () => {
            const r = side(board({ hp: LOW, debuff: true }), { meiAttack: BIG });
            expect(r.destroyed).toEqual(['A']);
            expect(r.stasis).toEqual(['B1', 'T1']);
        });

        it(`${tag}: a teammate kills debuffed A → nothing from Meiying`, () => {
            const r = side(board({ hp: LOW, debuff: true }), { meiAttack: 1, killer: true });
            expect(r.destroyed).toEqual(['A']);
            expect(r.stasis).toEqual([]);
        });

        it(`${tag}: A carrying only Corrosion is an enemy with a debuff → Stasis on T1 and B1`, () => {
            const r = side(board({ hp: LOW, dots: 1 }), { meiAttack: BIG, dotsFrom: 'teammate' });
            expect(r.destroyed).toEqual(['A']);
            expect(r.stasis).toEqual(['B1', 'T1']);
        });

        it(`${tag}: A with no debuff at all → nothing`, () => {
            const r = side(board({ hp: LOW }), { meiAttack: BIG });
            expect(r.destroyed).toEqual(['A']);
            expect(r.stasis).toEqual([]);
        });
    }

    it('player: her own Corrosion ticking debuffed A to death is no kill of hers → nothing', () => {
        const r = playerSide(board({ hp: LOW, debuff: true, dots: 40 }), {
            meiAttack: 1,
            dotsFrom: 'meiying',
            rounds: 2,
        });
        expect(r.destroyed).toEqual(['A']);
        expect(r.stasis).toEqual([]);
    });
});

describe('the wording decides whose kill counts', () => {
    /** `ship`'s passive with a charged slot to bank charges into; slow, so it never acts first. */
    const ownerShip = (ship: string): TeamActor => {
        const t = playerShip(
            'owner',
            'M3',
            1e9,
            {
                slots: [
                    ...passiveOnly(ship).slots,
                    { slot: 'charged', abilities: realSlot(ship, 'active') },
                ],
            },
            50
        );
        if (!t.walk) throw new Error('team ship without a walk');
        return { ...t, chargeCount: 6, walk: { ...t.walk, hasChargedSkill: true } };
    };
    /** A slow player-side `ship` (passive only) beside a fast lethal teammate; one enemy at M1. */
    const run = (ship: string) => {
        const bus = createEventBus();
        const charges: string[] = [];
        bus.on('charge-changed', (e: Extract<CombatEvent, { type: 'charge-changed' }>) => {
            if (e.round === 1 && e.newCharge > e.oldCharge && e.reason !== 'gen')
                charges.push(e.actorId);
        });
        let died = false;
        bus.on('ship-destroyed', (e: Extract<CombatEvent, { type: 'ship-destroyed' }>) => {
            if (e.actorId === 'e-x') died = true;
        });
        runCombat({
            ...base({
                shipSkills: HIT,
                attack: BIG,
                speed: 200,
                pattern: parsePattern('Pattern-Base'),
                teamActors: [ownerShip(ship)],
                enemyAttackers: [
                    enemyAt('e-x', { pos: 'M1', hp: LOW }),
                    enemyAt('e-y', { pos: 'B4', hp: HIGH }),
                ],
            }),
            bus,
        });
        expect(died).toBe(true);
        return charges;
    };

    it("Valiant ('When this Unit destroys an enemy'): a teammate's kill adds no charge", () => {
        expect(run('Valiant').filter((id) => id === 'owner')).toEqual([]);
    });

    it("Liberator ('When an enemy is destroyed'): a teammate's kill still charges all allies", () => {
        expect(run('Liberator')).toContain('owner');
    });
});
