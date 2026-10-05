/**
 * The DPS calculator's "enemy debuffs" picks are debuffs YOUR side puts on the enemy (owner
 * ruling 65). The enemy never rolls them against your ship, and they never boost the enemy's own
 * attacks or counters on you. The enemy's OWN kit debuffs still reach your ship as before.
 *
 * Real `simulateDPS` runs with a real, positioned enemy carrying a real parsed kit, the board the
 * hunt measured: a 10,000-attack enemy hitting a 5,000-defence focus.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import type { CombatEvent } from '../../combat/events';
import { simulateDPS } from '../dpsSimulator';
import { damageKit, realEnemyInput, REAL_ENEMY_ID } from '../__testutils__/dpsRealEnemyFixture';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { setupKeyedRng } from '../rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { victimDefenceMitigation } from '../../combat/victimDamage';
import type { SelectedGameBuff, TeamActorInput } from '../../../types/calculator';
import type { Ability, ShipSkills } from '../../../types/abilities';

const tap = vi.hoisted(() => ({ recorded: [] as CombatEvent[], buses: 0 }));
vi.mock('../../combat/events', async (importOriginal) => {
    const mod = await importOriginal<typeof import('../../combat/events')>();
    return {
        ...mod,
        createEventBus: () => {
            const bus = mod.createEventBus();
            if (tap.buses++ > 0) return bus;
            const emit = bus.emit.bind(bus);
            bus.emit = (e) => {
                tap.recorded.push(e);
                emit(e);
            };
            return bus;
        },
    };
});

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

const FOCUS = 'attacker';

const DD2: SelectedGameBuff[] = [
    {
        id: 'dd2',
        buffName: 'Defense Down II',
        stacks: 1,
        parsedEffects: { defense: -30 },
        isStackable: false,
        skillDuration: 'recurring',
    },
];

/** Defence factor of a 5000-defence victim under Defense Down II (-30%), over the bare one. */
const DEFENSE_DOWN_II_RATIO =
    victimDefenceMitigation({ defence: 5000, defenceModifierPct: -30, affinity: 'antimatter' }, 0) /
    victimDefenceMitigation({ defence: 5000, defenceModifierPct: 0, affinity: 'antimatter' }, 0);

const kit = (name: string) => {
    const ship = buildTraceShip(name);
    if (!ship) throw new Error(`${name} missing from reference data`);
    return buildShipAbilities(ship);
};

const withPassive = (skills: ShipSkills, passive?: Ability): ShipSkills =>
    passive
        ? {
              ...skills,
              slots: [
                  ...skills.slots.filter((sl) => sl.slot !== 'passive'),
                  {
                      slot: 'passive',
                      abilities: [
                          ...(skills.slots.find((sl) => sl.slot === 'passive')?.abilities ?? []),
                          passive,
                      ],
                  },
              ],
          }
        : skills;

/** "When directly damaged, if the opponent has at least 1 debuff, gain a 10% shield" — a
 *  drain-time count gate on debuffs this ship's side has landed. */
const shieldIfOpponentDebuffed = (): Ability => ({
    id: 'probe-shield',
    type: 'shield',
    target: 'self',
    trigger: 'on-attacked',
    conditions: [
        { subject: 'enemy-debuff', derivable: true, countComparator: 'gte', countThreshold: 1 },
    ],
    config: { type: 'shield', pct: 10, basis: 'hp' },
});

interface Board {
    /** The calculator's picks (on the focus) — the thing under test. */
    picks?: SelectedGameBuff[];
    /** A team actor carrying picks of its own. */
    teamPicks?: SelectedGameBuff[];
    focusSpeed: number;
    enemySpeed: number;
    /** The enemy's real kit. */
    enemyKit: string;
    /** An extra passive ability added to the enemy's / the focus's kit. */
    enemyPassive?: Ability;
    focusPassive?: Ability;
    /** Hacking on both sides: 1000 lands every roll against 0 security, 0 never does. */
    hacking: number;
}

const runDps = (b: Board): CombatEvent[] => {
    tap.recorded.length = 0;
    tap.buses = 0;
    setupKeyedRng(1);
    const team: TeamActorInput[] = b.teamPicks
        ? [
              {
                  id: 'pickTeam',
                  speed: 1,
                  chargeCount: 0,
                  startCharged: false,
                  selfBuffs: [],
                  enemyDebuffs: b.teamPicks,
              },
          ]
        : [];
    simulateDPS(
        realEnemyInput({
            attack: 10_000,
            crit: 0,
            critDamage: 100,
            defence: 5000,
            hp: 1e12,
            speed: b.focusSpeed,
            rounds: 2,
            shipSkills: withPassive(damageKit(), b.focusPassive),
            enemyDefense: 5000,
            enemyHp: 1e12,
            hacking: b.hacking,
            enemySecurity: 0,
            enemyDebuffs: b.picks ?? [],
            ...(team.length ? { teamActors: team } : {}),
            enemyAttackers: [
                {
                    id: REAL_ENEMY_ID,
                    stats: {
                        attack: 10_000,
                        crit: 0,
                        critDamage: 100,
                        speed: b.enemySpeed,
                        defence: 5000,
                        hp: 1e12,
                        security: 0,
                        hacking: b.hacking,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    shipSkills: withPassive(kit(b.enemyKit), b.enemyPassive),
                },
            ],
        })
    );
    return [...tap.recorded];
};

type Ev<T extends CombatEvent['type']> = Extract<CombatEvent, { type: T }>;
const rows = <T extends CombatEvent['type']>(
    events: CombatEvent[],
    type: T,
    pick: (e: Ev<T>) => boolean
) => events.filter((e): e is Ev<T> => e.type === type && pick(e as Ev<T>));
const one = <T extends CombatEvent['type']>(
    events: CombatEvent[],
    type: T,
    pick: (e: Ev<T>) => boolean
): Ev<T> => {
    const found = rows(events, type, pick);
    expect(found).toHaveLength(1);
    return found[0];
};
/** The enemy's cast hit on the focus in `round`. */
const enemyCast = (events: CombatEvent[], round: number) =>
    one(
        events,
        'attacked',
        (e) => e.attackerId === REAL_ENEMY_ID && e.targetId === FOCUS && e.round === round
    ).damage!;
/** The focus's cast hit on the enemy in `round` — the instrument: the picks DO reach it. */
const focusCast = (events: CombatEvent[], round: number) =>
    one(
        events,
        'attacked',
        (e) => e.attackerId === FOCUS && e.targetId === REAL_ENEMY_ID && e.round === round
    ).damage!;

describe.each([
    ['focus faster', 200, 100],
    ['enemy faster (reverse board)', 100, 200],
] as const)('DPS picks are enemy-only — %s', (_label, focusSpeed, enemySpeed) => {
    const board = (over: Partial<Board>): Board => ({
        focusSpeed,
        enemySpeed,
        enemyKit: 'Bedrock',
        hacking: 1000,
        ...over,
    });

    it("the focus's own cast still reads a landed pick (instrument)", () => {
        const bare = runDps(board({}));
        const picked = runDps(board({ picks: DD2 }));
        expect(focusCast(picked, 1) / focusCast(bare, 1)).toBeCloseTo(DEFENSE_DOWN_II_RATIO, 9);
    });

    it("a pick never boosts the enemy's attack on the focus", () => {
        const bare = runDps(board({}));
        const picked = runDps(board({ picks: DD2 }));
        for (const round of [1, 2]) {
            expect(enemyCast(picked, round)).toBeCloseTo(enemyCast(bare, round), 9);
        }
    });

    it("a team actor's pick never boosts the enemy's attack on the focus either", () => {
        const bare = runDps(board({}));
        const picked = runDps(board({ teamPicks: DD2 }));
        for (const round of [1, 2]) {
            expect(enemyCast(picked, round)).toBeCloseTo(enemyCast(bare, round), 9);
        }
    });

    it('the enemy never rolls a pick against the focus', () => {
        // Hacking 0 vs security 0 would fail every roll, so any roll the enemy took for the pick
        // would show up as a resist named on the focus.
        const events = runDps(board({ picks: DD2, hacking: 0 }));
        expect(rows(events, 'debuff-resisted', (e) => e.targetId === FOCUS)).toHaveLength(0);
        expect(rows(events, 'debuff-applied', (e) => e.targetId === FOCUS)).toHaveLength(0);
        // Control: the focus's own roll of the same pick does fail, against the enemy.
        expect(
            rows(events, 'debuff-resisted', (e) => e.targetId === REAL_ENEMY_ID).length
        ).toBeGreaterThan(0);
    });

    it('a pick is never carried by the focus itself (status names)', () => {
        const events = runDps(board({ picks: DD2 }));
        const snaps = (id: string) => rows(events, 'status-snapshot', (e) => e.actorId === id);
        expect(snaps(FOCUS).length).toBeGreaterThan(0);
        for (const s of snaps(FOCUS)) expect(s.debuffNames).not.toContain('Defense Down II');
        // Control: the enemy does carry it.
        expect(snaps(REAL_ENEMY_ID).some((s) => s.debuffNames.includes('Defense Down II'))).toBe(
            true
        );
    });

    it("a pick never satisfies the enemy's own 'opponent debuffed' gate", () => {
        const grants = (events: CombatEvent[], id: string) =>
            rows(events, 'shield-applied', (e) => e.granterId === id).length;
        const enemy = runDps(board({ picks: DD2, enemyPassive: shieldIfOpponentDebuffed() }));
        expect(grants(enemy, REAL_ENEMY_ID)).toBe(0);
        // Player-side twin: the focus's own gate does count the pick it put on the enemy.
        const focus = runDps(board({ picks: DD2, focusPassive: shieldIfOpponentDebuffed() }));
        expect(grants(focus, FOCUS)).toBeGreaterThan(0);
        // Negative: with no pick, neither fires.
        const none = runDps(board({ focusPassive: shieldIfOpponentDebuffed() }));
        expect(grants(none, FOCUS)).toBe(0);
    });

    it("a pick never boosts the enemy's counter on the focus", () => {
        // Stalwart: "When this Unit is directly damaged as a primary target, it deals 70% damage
        // to the enemy". The focus hits him every round; he counters onto the focus.
        const counter = (events: CombatEvent[], round: number) =>
            one(
                events,
                'reactive-damage-performed',
                (e) => e.sourceId === REAL_ENEMY_ID && e.targetId === FOCUS && e.round === round
            ).amount;
        const bare = runDps(board({ enemyKit: 'Stalwart' }));
        const picked = runDps(board({ enemyKit: 'Stalwart', picks: DD2 }));
        for (const round of [1, 2]) {
            expect(counter(picked, round)).toBeCloseTo(counter(bare, round), 9);
        }
    });

    it("enemy-side twin: the enemy's OWN kit debuff still boosts its attack on the focus", () => {
        // Nayra: "inflicts Defense Down II and Crit Rate Down III for 2 turns, deals 170% damage".
        // Her hacking 1000 lands it on the focus, 0 never does; no picks at all.
        const landed = runDps(board({ enemyKit: 'Nayra', hacking: 1000 }));
        const resisted = runDps(board({ enemyKit: 'Nayra', hacking: 0 }));
        expect(enemyCast(landed, 1) / enemyCast(resisted, 1)).toBeCloseTo(DEFENSE_DOWN_II_RATIO, 9);
    });
});
