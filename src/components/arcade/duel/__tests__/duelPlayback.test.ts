import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import {
    beatSeconds,
    buildDuelBeats,
    compactStatuses,
    MAX_PLAYBACK_SECONDS,
    type DuelBeat,
} from '../duelPlayback';
import { csvAvailable, loadShipSkillRecords } from '../../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../../scripts/lib/shipDataSnapshot';
import type { Ship } from '../../../../types/ship';
import type { BattleResult, ShipRoundState } from '../../../../utils/calculators/battleSimulator';
import type {
    CombatLogEntry,
    CombatLogRound,
    CombatLogTarget,
    CombatLogTurn,
} from '../../../../utils/combat/log/types';
import type { CombatStatsDeps } from '../../../../utils/ship/combatStats';
import { buildTeam } from '../../../../utils/simulator/buildTeam';
import { runSeededBattle } from '../../../../utils/simulator/seededRuns';

// ── Hand-built results ──────────────────────────────────────────────────────────────────────────

const P = 'p';
const E = 'e';

const entry = (
    kind: CombatLogEntry['kind'],
    actorId: string,
    targets: CombatLogTarget[] = [],
    extra: Partial<CombatLogEntry> = {}
): CombatLogEntry => ({ kind, actorId, targets, reactions: [], ...extra });

const turn = (
    actorId: string,
    entries: CombatLogEntry[],
    extra: Partial<CombatLogTurn> = {}
): CombatLogTurn => ({ actorId, chargeBefore: 0, chargeMax: 0, entries, ...extra });

const snap = (currentHp: number, shieldPool = 0, maxHp = 1000) => ({
    statsSnapshot: {
        attack: 0,
        defence: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        speed: 0,
        hacking: 0,
        security: 0,
        currentHp,
        maxHp,
        shieldPool,
    },
});

const logRound = (
    round: number,
    turns: CombatLogTurn[],
    endOfRound: CombatLogEntry[] = [],
    startOfRound: CombatLogEntry[] = []
): CombatLogRound => ({ round, startOfRound, turns, endOfRound });

type ShipSnap = Partial<Pick<ShipRoundState, 'hpPct' | 'shieldPct' | 'alive'>> & {
    buffs?: string[];
    debuffs?: string[];
};
const ship = (side: 'player' | 'enemy', s: ShipSnap) => ({
    actorId: side === 'player' ? P : E,
    side,
    hpPct: s.hpPct ?? 100,
    shieldPct: s.shieldPct ?? 0,
    alive: s.alive ?? true,
    activeBuffs: s.buffs ?? [],
    activeDebuffs: s.debuffs ?? [],
});

const battle = (
    combatLog: CombatLogRound[],
    rounds: { player: ShipSnap; enemy: ShipSnap }[],
    lastRound = rounds.length
): BattleResult =>
    ({
        outcome: { winner: 'player', lastRound },
        roster: [
            { actorId: P, side: 'player', name: 'P', position: 'M2' },
            { actorId: E, side: 'enemy', name: 'E', position: 'M2' },
        ],
        combatLog,
        rounds: rounds.map((r, i) => ({
            round: i + 1,
            turnOrder: [],
            ships: [ship('player', r.player), ship('enemy', r.enemy)],
        })),
    }) as unknown as BattleResult;

describe('compactStatuses', () => {
    it('drops duplicates and keeps only the highest tier of one status, where it first appeared', () => {
        expect(
            compactStatuses([
                'Attack Down II',
                'Provoke',
                'Attack Down III',
                'Provoke',
                'Attack Down I',
                'Corrosion',
                'Attack Up II',
            ])
        ).toEqual(['Attack Down III', 'Provoke', 'Corrosion', 'Attack Up II']);
    });
});

describe('beatSeconds', () => {
    it('is half a second a turn until the fight would run past the cap, then shrinks to fit', () => {
        expect(beatSeconds(4)).toBe(0.5);
        expect(beatSeconds(20)).toBe(0.5);
        expect(beatSeconds(40)).toBe(MAX_PLAYBACK_SECONDS / 40);
        expect(beatSeconds(40) * 40).toBeLessThanOrEqual(MAX_PLAYBACK_SECONDS);
        expect(beatSeconds(0)).toBe(0);
    });
});

describe('buildDuelBeats (hand-built)', () => {
    it('an empty combat log has no beats', () => {
        expect(buildDuelBeats(battle([], [{ player: {}, enemy: {} }]))).toEqual([]);
    });

    it('a miss pops MISS and leaves HP alone; a crit is flagged and sets HP from the hit', () => {
        const beats = buildDuelBeats(
            battle(
                [
                    logRound(1, [
                        turn(P, [
                            entry('attack', P, [{ targetId: E, didHit: false }], {
                                slot: 'active',
                            }),
                        ]),
                        turn(E, [
                            entry('attack', E, [
                                { targetId: P, amount: 1234.6, didCrit: true, resultingHpPct: 60 },
                            ]),
                        ]),
                    ]),
                ],
                [{ player: { hpPct: 60 }, enemy: {} }]
            )
        );
        expect(beats.map((b) => b.actor)).toEqual(['player', 'enemy']);
        expect(beats[0].hits).toEqual([
            { side: 'enemy', ship: 0, kind: 'miss', amount: 0, crit: false },
        ]);
        expect(beats[0].enemy[0].hpPct).toBe(100);
        expect(beats[1].hits).toEqual([
            { side: 'player', ship: 0, kind: 'damage', amount: 1234.6, crit: true },
        ]);
        expect(beats[1].player[0].hpPct).toBe(60);
    });

    it('a charged cast is flagged from any of its entries, and the charge then reads empty', () => {
        const beats = buildDuelBeats(
            battle(
                [
                    logRound(1, [
                        turn(P, [entry('buff', P, [{ targetId: P }], { slot: 'active' })], {
                            chargeBefore: 1,
                            chargeMax: 2,
                        }),
                    ]),
                    logRound(2, [
                        turn(
                            P,
                            [
                                entry('control', P, [{ targetId: E }], { slot: 'charged' }),
                                entry('attack', P, [{ targetId: E, amount: 10 }]),
                            ],
                            { chargeBefore: 2, chargeMax: 2 }
                        ),
                        turn(
                            E,
                            [
                                entry('attack', E, [{ targetId: P, amount: 5 }], {
                                    slot: 'charged',
                                    skillName: 'Overload',
                                }),
                            ],
                            { chargeBefore: 3, chargeMax: 3 }
                        ),
                    ]),
                ],
                [
                    { player: {}, enemy: {} },
                    { player: {}, enemy: {} },
                ]
            )
        );
        expect(beats[0].charged).toBeNull();
        expect(beats[0].player[0].charge).toEqual({ value: 1, max: 2 });
        expect(beats[0].enemy[0].charge).toBeNull();
        expect(beats[1].charged).toEqual({});
        expect(beats[1].player[0].charge).toEqual({ value: 0, max: 2 });
        expect(beats[2].charged).toEqual({ skillName: 'Overload' });
        expect(beats[2].enemy[0].charge).toEqual({ value: 0, max: 3 });
    });

    it('a shield appears with its grant, shrinks by what a hit did not put through, then breaks', () => {
        const beats = buildDuelBeats(
            battle(
                [
                    logRound(1, [
                        // Max HP 1000 for both sides comes from these snapshots.
                        turn(P, [entry('shield', P, [{ targetId: P, amount: 500 }])], snap(1000)),
                        turn(
                            E,
                            [
                                entry('attack', E, [
                                    // 300 damage: 200 into the shield, 100 (10% HP) through it.
                                    {
                                        targetId: P,
                                        amount: 300,
                                        resultingHpPct: 90,
                                        shieldWasHit: true,
                                    },
                                ]),
                            ],
                            snap(1000)
                        ),
                        turn(P, [
                            entry('shield-stripped', E, [{ targetId: P, amount: 100 }]),
                            entry('attack', E, [{ targetId: P, amount: 50, shieldWasHit: true }], {
                                reactions: [entry('shield-destroyed', P, [{ targetId: P }])],
                            }),
                        ]),
                        // Keeps the beats above off the round end, which would snap them.
                        turn(E, []),
                    ]),
                ],
                [{ player: { hpPct: 90 }, enemy: {} }]
            )
        );
        expect(beats[0].player[0].shieldPct).toBe(50);
        expect(beats[0].hits).toEqual([
            { side: 'player', ship: 0, kind: 'shield', amount: 500, crit: false },
        ]);
        expect(beats[1].player[0].shieldPct).toBeCloseTo(30);
        expect(beats[1].player[0].hpPct).toBe(90);
        expect(beats[2].player[0].shieldPct).toBe(0);
        expect(beats[1].player[0].shieldPct).toBeGreaterThan(0);
    });

    it("the actor's turn-start snapshot corrects its own HP and shield on the previous beat", () => {
        const beats = buildDuelBeats(
            battle(
                [
                    logRound(1, [
                        turn(E, [entry('attack', E, [{ targetId: P, amount: 400 }])]),
                        turn(P, [], snap(700, 250)),
                    ]),
                ],
                [{ player: { hpPct: 70, shieldPct: 25 }, enemy: {} }]
            )
        );
        expect(beats[0].player[0]).toMatchObject({ hpPct: 70, shieldPct: 25 });
    });

    it('start-of-round effects already in the turn-start snapshot are not counted again', () => {
        const beats = buildDuelBeats(
            battle(
                [
                    logRound(
                        1,
                        [turn(P, [], snap(600, 100)), turn(E, [])],
                        [],
                        [
                            entry('hot-ticked', P, [{ targetId: P, amount: 100 }]),
                            entry('shield', P, [{ targetId: P, amount: 100 }]),
                        ]
                    ),
                ],
                [{ player: { hpPct: 60, shieldPct: 10 }, enemy: {} }]
            )
        );
        expect(beats[0].player[0]).toMatchObject({ hpPct: 60, shieldPct: 10 });
        expect(beats[0].hits.map((h) => h.kind)).toEqual(['heal', 'shield']);
    });

    it('a heal pops its landed amount and raises HP by it over max HP, before the round end', () => {
        const beats = buildDuelBeats(
            battle(
                [
                    logRound(1, [
                        turn(P, [entry('heal', P, [{ targetId: P, amount: 100 }])], snap(500)),
                        turn(E, []),
                    ]),
                ],
                [{ player: { hpPct: 60 }, enemy: {} }]
            )
        );
        expect(beats[0].hits).toEqual([
            { side: 'player', ship: 0, kind: 'heal', amount: 100, crit: false },
        ]);
        expect(beats[0].player[0].hpPct).toBe(60);
    });

    it('a ship destroyed mid-round reads 0 with no statuses and takes no later turn that round', () => {
        const beats = buildDuelBeats(
            battle(
                [
                    logRound(1, [
                        turn(P, [
                            entry('attack', P, [{ targetId: E, amount: 900, resultingHpPct: 0 }], {
                                reactions: [entry('death', E, [{ targetId: P }])],
                            }),
                        ]),
                        turn(E, [entry('attack', E, [{ targetId: P, amount: 1 }])]),
                    ]),
                ],
                // The simulator still lists a destroyed ship's last statuses.
                [{ player: {}, enemy: { hpPct: 0, alive: false, buffs: ['Attack Up I'] } }]
            )
        );
        expect(beats).toHaveLength(1);
        expect(beats[0].enemy[0]).toMatchObject({ hpPct: 0, alive: false, buffs: [], debuffs: [] });
        expect(beats[0].player[0].hpPct).toBe(100);
    });

    it('buffs and debuffs change only at round end, compacted, and every value snaps there', () => {
        const beats = buildDuelBeats(
            battle(
                [
                    logRound(1, [
                        turn(P, [entry('debuff', P, [{ targetId: E }], { note: 'Provoke' })]),
                        turn(E, [
                            entry('attack', E, [{ targetId: P, amount: 10, resultingHpPct: 99 }]),
                        ]),
                    ]),
                    logRound(2, [turn(P, []), turn(E, [])]),
                ],
                [
                    {
                        player: {
                            hpPct: 98.5,
                            shieldPct: 12,
                            buffs: ['Attack Up II', 'Attack Up III'],
                        },
                        enemy: { debuffs: ['Provoke'] },
                    },
                    { player: { hpPct: 98.5 }, enemy: {} },
                ]
            )
        );
        expect(beats[0].enemy[0].debuffs).toEqual([]);
        expect(beats[1].enemy[0].debuffs).toEqual(['Provoke']);
        expect(beats[1].player[0]).toMatchObject({
            hpPct: 98.5,
            shieldPct: 12,
            buffs: ['Attack Up III'],
        });
        expect(beats[2].player[0].buffs).toEqual(['Attack Up III']);
        expect(beats[3].player[0].buffs).toEqual([]);
    });

    it("start- and end-of-round effects join the round's first and last beats", () => {
        const tick = (target: string, hp: number) =>
            entry('dot-ticked', target, [{ targetId: target, amount: 50, resultingHpPct: hp }]);
        const beats = buildDuelBeats(
            battle(
                [logRound(1, [turn(P, []), turn(E, [])], [tick(E, 90)], [tick(P, 95)])],
                [{ player: { hpPct: 95 }, enemy: { hpPct: 90 } }]
            )
        );
        expect(beats[0].hits).toEqual([
            { side: 'player', ship: 0, kind: 'damage', amount: 50, crit: false },
        ]);
        expect(beats[1].hits).toEqual([
            { side: 'enemy', ship: 0, kind: 'damage', amount: 50, crit: false },
        ]);
    });

    it('a round with effects but no turns is one beat with no actor', () => {
        const beats = buildDuelBeats(
            battle(
                [
                    logRound(
                        1,
                        [],
                        [entry('dot-ticked', E, [{ targetId: E, amount: 50, resultingHpPct: 90 }])]
                    ),
                ],
                [{ player: {}, enemy: { hpPct: 90 } }]
            )
        );
        expect(beats).toHaveLength(1);
        expect(beats[0]).toMatchObject({ round: 1, actor: null, charged: null });
    });

    it('log rounds past outcome.lastRound are ignored', () => {
        const beats = buildDuelBeats(
            battle(
                [logRound(1, [turn(P, [])]), logRound(2, [turn(P, [])])],
                [{ player: {}, enemy: {} }],
                1
            )
        );
        expect(beats.map((b) => b.round)).toEqual([1]);
    });
});

// ── Real fights ─────────────────────────────────────────────────────────────────────────────────

const deps: CombatStatsDeps = {
    getGearPiece: () => undefined,
    getEngineeringStatsForShipType: () => undefined,
};

interface Datum {
    name: string;
    role: string;
    hp: number;
    attack: number;
    defense: number;
    hacking: number;
    security: number;
    speed: number;
    critRate: number;
    critDamage: number;
}

const corpusShip = (name: string, attackScale = 1): Ship => {
    const data: Datum[] = JSON.parse(readFileSync('docs/ship-data.json', 'utf8'));
    const d = data.find((x) => x.name.toLowerCase() === name.toLowerCase());
    const rec = loadShipSkillRecords().find((r) => r.name.toLowerCase() === name.toLowerCase());
    if (!rec || !d) throw new Error(`no corpus ship named ${name}`);
    return {
        id: rec.name.toLowerCase(),
        name: rec.name,
        type: d.role,
        rarity: 'legendary',
        baseStats: {
            attack: d.attack * attackScale,
            crit: d.critRate,
            critDamage: d.critDamage,
            hacking: d.hacking,
            security: d.security,
            defence: d.defense,
            hp: d.hp,
            speed: d.speed,
        },
        equipment: {},
        implants: {},
        refits: [0, 1, 2, 3].map((i) => ({ id: `r${i}`, stats: [] })),
        activeSkillText: rec.active,
        chargeSkillText: rec.charge,
        chargeSkillCharge: rec.chargeCharge,
        firstPassiveSkillText: rec.passives[0],
        secondPassiveSkillText: rec.passives[1],
        thirdPassiveSkillText: rec.passives[2],
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
        chargedTarget: 'front',
        chargedPattern: 'Pattern-Base',
    } as unknown as Ship;
};

const fight = (player: Ship, enemy: Ship, seed: number) =>
    runSeededBattle(
        {
            playerTeam: buildTeam({ M2: { ship: player } }, deps),
            enemyTeam: buildTeam({ M2: { ship: enemy } }, deps),
        },
        seed
    );

/** Every turn the log played up to the last round, by a ship still alive when it came. */
const loggedTurns = (r: BattleResult) =>
    r.combatLog.filter((round) => round.round <= r.outcome.lastRound).flatMap((x) => x.turns);

/** The state `beat` shows for roster ship `actorId`: its side's ships are in roster order. */
const shownFor = (r: BattleResult, beat: DuelBeat, actorId: string) => {
    const entry = r.roster.find((x) => x.actorId === actorId)!;
    const index = r.roster.filter((x) => x.side === entry.side).indexOf(entry);
    return beat[entry.side][index];
};

/** Each round's last beat carries that round's end snapshot exactly, for every ship. */
function expectRoundEndsSnap(r: BattleResult, beats: DuelBeat[]) {
    for (const round of r.rounds) {
        const last = beats.filter((b) => b.round === round.round).at(-1);
        expect(last, `round ${round.round} has a beat`).toBeDefined();
        for (const s of round.ships) {
            const shown = shownFor(r, last!, s.actorId);
            expect(shown.hpPct).toBeCloseTo(s.hpPct, 6);
            expect(shown.shieldPct).toBeCloseTo(s.shieldPct, 6);
            expect(shown.alive).toBe(s.alive);
            expect(shown.buffs).toEqual(s.alive ? compactStatuses(s.activeBuffs) : []);
            expect(shown.debuffs).toEqual(s.alive ? compactStatuses(s.activeDebuffs) : []);
        }
    }
}

/** Where a turn-start snapshot exists, the beat before it (same round) shows that ship exactly. */
function expectTurnStartsMatch(r: BattleResult, beats: DuelBeat[]) {
    let i = 0;
    let checked = 0;
    for (const round of r.combatLog.filter((x) => x.round <= r.outcome.lastRound)) {
        round.turns.forEach((t, k) => {
            const snapshot = t.statsSnapshot;
            if (k > 0 && snapshot) {
                const shown = shownFor(r, beats[i - 1], t.actorId);
                expect(shown.hpPct).toBeCloseTo((100 * snapshot.currentHp) / snapshot.maxHp, 6);
                expect(shown.shieldPct).toBeCloseTo(
                    Math.min(100, (100 * snapshot.shieldPool) / snapshot.maxHp),
                    6
                );
                checked++;
            }
            i++;
        });
    }
    expect(checked).toBeGreaterThan(0);
}

describe('buildDuelBeats (generic fighters, no corpus)', () => {
    const fighter = (id: string, attack: number, hp: number): Ship =>
        ({
            id,
            name: id,
            rarity: 'legendary',
            faction: 'ATLAS_SYNDICATE',
            type: 'ATTACKER',
            baseStats: { hp, attack, defence: 1000, crit: 50, critDamage: 50, speed: 100 },
            equipment: {},
            implants: {},
            refits: [],
            activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
            activeTarget: 'front',
            activePattern: 'Pattern-Base',
        }) as unknown as Ship;

    it('one beat per turn, each landing damage on the other ship, ending on the kill', () => {
        const r = fight(fighter('strong', 6000, 20000), fighter('weak', 500, 8000), 123);
        const beats = buildDuelBeats(r);
        expect(beats).toHaveLength(loggedTurns(r).length);
        for (const b of beats) {
            expect(b.actor).not.toBeNull();
            const other = b.actor === 'player' ? 'enemy' : 'player';
            expect(b.hits.some((h) => h.side === other && h.kind !== 'heal')).toBe(true);
        }
        expect(beats.at(-1)!.enemy[0]).toMatchObject({ hpPct: 0, alive: false });
        expectRoundEndsSnap(r, beats);
    });
});

describe('buildDuelBeats (three ships a side)', () => {
    const roster = ['p0', 'p1', 'p2', 'e0', 'e1', 'e2'].map((actorId, i) => ({
        actorId,
        side: i < 3 ? 'player' : 'enemy',
        name: actorId,
        position: (['T2', 'M2', 'B2'] as const)[i % 3],
    }));
    const snapshotShip = (actorId: string, hpPct: number, alive = true) => ({
        actorId,
        side: actorId.startsWith('p') ? 'player' : 'enemy',
        hpPct,
        shieldPct: 0,
        alive,
        activeBuffs: [],
        activeDebuffs: [],
    });

    it('gives every ship its own state and lands each number on the ship it struck', () => {
        const r = {
            outcome: { winner: 'player', lastRound: 1 },
            roster,
            combatLog: [
                logRound(1, [
                    turn('p1', [
                        entry('attack', 'p1', [
                            { targetId: 'e2', amount: 300, resultingHpPct: 40 },
                        ]),
                    ]),
                    turn('e0', [entry('attack', 'e0', [{ targetId: 'p2', didHit: false }])]),
                    turn('p0', [
                        entry('attack', 'p0', [{ targetId: 'e1', amount: 900, resultingHpPct: 0 }]),
                        entry('death', 'e1'),
                    ]),
                ]),
            ],
            rounds: [
                {
                    round: 1,
                    turnOrder: [],
                    ships: [
                        snapshotShip('p0', 100),
                        snapshotShip('p1', 100),
                        snapshotShip('p2', 100),
                        snapshotShip('e0', 100),
                        snapshotShip('e1', 0, false),
                        snapshotShip('e2', 40),
                    ],
                },
            ],
        } as unknown as BattleResult;
        const beats = buildDuelBeats(r);
        expect(beats.map((b) => [b.actor, b.actorShip])).toEqual([
            ['player', 1],
            ['enemy', 0],
            ['player', 0],
        ]);
        expect(beats[0].hits).toEqual([
            { side: 'enemy', ship: 2, kind: 'damage', amount: 300, crit: false },
        ]);
        expect(beats[1].hits).toEqual([
            { side: 'player', ship: 2, kind: 'miss', amount: 0, crit: false },
        ]);
        expect(beats[0].enemy.map((s) => s.hpPct)).toEqual([100, 100, 40]);
        const last = beats.at(-1)!;
        expect(last.player).toHaveLength(3);
        expect(last.enemy.map((s) => s.alive)).toEqual([true, false, true]);
        expect(last.enemy.map((s) => s.hpPct)).toEqual([100, 0, 40]);
    });

    it('a real 3v3 shows all six ships, each matching its round-end snapshot', () => {
        const fighter = (id: string, attack: number, hp: number): Ship =>
            ({
                id,
                name: id,
                rarity: 'legendary',
                faction: 'ATLAS_SYNDICATE',
                type: 'ATTACKER',
                baseStats: { hp, attack, defence: 1000, crit: 50, critDamage: 50, speed: 100 },
                equipment: {},
                implants: {},
                refits: [],
                activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
                activeTarget: 'front',
                activePattern: 'Pattern-Base',
            }) as unknown as Ship;
        const board = (prefix: string, attack: number) => ({
            T2: { ship: fighter(`${prefix}T`, attack, 15000) },
            M2: { ship: fighter(`${prefix}M`, attack, 15000) },
            B2: { ship: fighter(`${prefix}B`, attack, 15000) },
        });
        const r = runSeededBattle(
            {
                playerTeam: buildTeam(board('p', 4000), deps),
                enemyTeam: buildTeam(board('e', 3000), deps),
                rounds: 5,
            },
            11
        );
        expect(r.roster.filter((x) => x.side === 'player').map((x) => x.position)).toEqual([
            'T2',
            'M2',
            'B2',
        ]);
        const beats = buildDuelBeats(r);
        expect(beats.length).toBeGreaterThan(0);
        for (const b of beats) {
            expect(b.player).toHaveLength(3);
            expect(b.enemy).toHaveLength(3);
        }
        expectRoundEndsSnap(r, beats);
        const struck = new Set(beats.flatMap((b) => b.hits.map((h) => `${h.side}${h.ship}`)));
        expect(struck.size).toBeGreaterThan(1);
    });
});

describe.skipIf(!csvAvailable() || !shipDataAvailable())('buildDuelBeats (corpus ships)', () => {
    it('FrontLine v APEX: shields, strips, debuffs and a charged disable', () => {
        const r = fight(corpusShip('FrontLine'), corpusShip('APEX'), 7);
        const beats = buildDuelBeats(r);
        expect(beats).toHaveLength(loggedTurns(r).length);
        expectRoundEndsSnap(r, beats);
        expectTurnStartsMatch(r, beats);
        // FrontLine starts with a shield and regrants it each turn.
        expect(beats.some((b) => b.player[0].shieldPct > 0)).toBe(true);
        expect(
            beats.some((b) => b.hits.some((h) => h.side === 'player' && h.kind === 'shield'))
        ).toBe(true);
        // APEX's debuffs show on FrontLine, and its charged skill is flagged on its own turn.
        expect(beats.some((b) => b.player[0].debuffs.includes('Speed Down II'))).toBe(true);
        const charged = beats.filter((b) => b.charged);
        expect(charged.length).toBeGreaterThan(0);
        expect(charged.some((b) => b.actor === 'enemy')).toBe(true);
        for (const b of beats) expect(b.round).toBeLessThanOrEqual(r.outcome.lastRound);
    });

    it('AEGIS v Curator: its own buffs, and crits from the enemy', () => {
        const r = fight(corpusShip('AEGIS'), corpusShip('Curator'), 7);
        const beats = buildDuelBeats(r);
        expectRoundEndsSnap(r, beats);
        expectTurnStartsMatch(r, beats);
        expect(beats.some((b) => b.player[0].buffs.includes('Hacking Up III'))).toBe(true);
        expect(beats.some((b) => b.hits.some((h) => h.kind === 'damage' && h.crit))).toBe(true);
    });

    it('Crucialis v Guardian: a charged finishing blow ends the beats on the kill', () => {
        const r = fight(corpusShip('Crucialis', 3), corpusShip('Guardian'), 7);
        const beats = buildDuelBeats(r);
        expectRoundEndsSnap(r, beats);
        const last = beats.at(-1)!;
        expect(last.round).toBe(r.outcome.lastRound);
        expect(last.actor).toBe('player');
        expect(last.charged).not.toBeNull();
        expect(last.enemy[0]).toMatchObject({ hpPct: 0, alive: false, buffs: [], debuffs: [] });
    });
});
