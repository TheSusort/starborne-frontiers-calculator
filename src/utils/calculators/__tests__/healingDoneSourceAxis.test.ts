/**
 * #383 — "Healing done" must count EVERY repair channel, on BOTH sides.
 *
 * ── THE DEFECT ────────────────────────────────────────────────────────────────────────────────
 * `assembleBattleResult` built `healingDone` by summing `heal-performed.casterId`, and
 * `heal-performed` has exactly ONE production emit site: the cast path in `playerTurn.ts`. Every
 * other channel that performs a repair credited nobody, so the Simulator could show a ship that
 * RECEIVED 800 HP of repair (correct since #375) with `healingDone: 0` beside it — nobody credited
 * for having done it.
 *
 * THE GAME EXAMPLE. Magnolia's passive repairs her for 20% of the damage she deals. She hits for
 * 4000, restores 800 to herself, and her round row reads "Healing received 800 / Healing done 0".
 * Same for Isha, whose passive repairs 3% of her max HP whenever she is directly damaged.
 *
 * ── THE SHAPE OF THE HOLE: CHANNEL, NOT SIDE ──────────────────────────────────────────────────
 * Measured before the fix, an ENEMY cast medic already reported `healingDone` correctly (4.5M over
 * a 5-round fight) — the `healEventOnly` arm emits `heal-performed` too. So this is NOT #375's
 * defect on the other axis: the cast CHANNEL works on both sides, and the leech and reactive
 * CHANNELS work on neither. That distinction is load-bearing for the fix: substituting an axis
 * that did not cover the cast channel would have regressed those enemy rows from correct to 0,
 * which is exactly the trap #375 had to clear before it could read `repairReceived`.
 *
 * ── WHAT THE FIX READS ────────────────────────────────────────────────────────────────────────
 * A new side-agnostic SOURCE axis (`hp-snapshot.repairPerformed`), credited at every site where a
 * repair's pool application succeeds — both per-victim leeches, the reactive executor, and both
 * cast arms. It is a SIBLING of `perActor`, not a widening of it: `perActor` is PLAYER-ONLY by
 * design (E5 §4.1) and stays that way, which is why a new axis was needed at all.
 *
 * A HoT tick is deliberately NOT on it (locked ruling R2, #367: a tick is not a repair PERFORMED).
 * `repairReceived` books ticks; `repairPerformed` does not. The asymmetry is the contract.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setRateGateRng, resetRateGateRng } from '../rateAccumulator';
import { simulateBattle, BattlePlacement, BattleSimulationInput } from '../battleSimulator';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';

beforeEach(() => setRateGateRng(() => 0.999999)); // never crit — deterministic damage
afterEach(() => resetRateGateRng());

const BASIC_ACTIVE = 'This Unit deals <unit-damage>100% damage</unit-damage>.';
/** Magnolia's refit-1 passive, verbatim from docs/ship-skills.csv — a standing damage-dealt leech. */
const MAGNOLIA_P1 =
    'This Unit <unit-damage>repairs itself for 20%</unit-damage> of the damage it deals to enemies.';
/** Isha's refit-2 passive clause, verbatim — a REACTIVE self-repair on being directly damaged. */
const ISHA_REACTIVE =
    'When directly damaged, this Unit <unit-damage>repairs 3%</unit-damage> of its max HP.';

type ShipOpts = {
    id: string;
    name: string;
    attack: number;
    hp: number;
    speed?: number;
    passive?: string;
    activeSkillText?: string;
    activeTarget?: string;
    activePattern?: string;
    type?: Ship['type'];
};

const ship = (o: ShipOpts): Ship => ({
    id: o.id,
    name: o.name,
    rarity: 'legendary',
    faction: 'MPL',
    type: o.type ?? 'ATTACKER',
    baseStats: {
        hp: o.hp,
        attack: o.attack,
        defence: 0,
        hacking: 200,
        security: 100,
        crit: 0,
        critDamage: 0,
        speed: o.speed ?? 100,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText: o.activeSkillText ?? BASIC_ACTIVE,
    activeTarget: o.activeTarget ?? 'front',
    activePattern: o.activePattern ?? 'Pattern-Base',
    chargeSkillCharge: 0,
    ...(o.passive ? { firstPassiveSkillText: o.passive } : {}),
});

const at = (s: Ship, position: Position): BattlePlacement => ({
    ship: s,
    position,
    statOverrides: {
        attack: s.baseStats.attack,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: s.baseStats.hacking,
        defence: s.baseStats.defence,
        hp: s.baseStats.hp,
        speed: s.baseStats.speed,
    },
});

type Row = {
    healingDone: number;
    healingReceived: number;
    damageDealt: number;
    incomingDamage: number;
};
/** Sum every round's row for one actor — the whole-fight total for that actor. */
const totals = (input: BattleSimulationInput, actorId: string): Row => {
    const result = simulateBattle(input);
    const acc: Row = { healingDone: 0, healingReceived: 0, damageDealt: 0, incomingDamage: 0 };
    for (const r of result.rounds) {
        for (const s of r.ships) {
            if (s.actorId !== actorId) continue;
            acc.healingDone += s.healingDone;
            acc.healingReceived += s.healingReceived;
            acc.damageDealt += s.damageDealt;
            acc.incomingDamage += s.incomingDamage;
        }
    }
    return acc;
};

// ── CHANNEL 1: THE STANDING LEECH, BOTH SIDES ────────────────────────────────────────────────
// The leecher deals 4000 and repairs 20% of it back = 800 per round, to ITSELF. So done and
// received must BOTH read 800 on the same row: one repair, credited once on each axis.
describe('#383 a standing leech credits the leecher with healing DONE', () => {
    /** `leech` false is the inert control — same ship, same fight, no passive at all. */
    const playerSideInput = (leech: boolean): BattleSimulationInput => ({
        playerTeam: [
            at(
                ship({
                    id: 'leecher',
                    name: 'Leecher',
                    attack: 4000,
                    hp: 10_000,
                    speed: 100, // faster than the enemy → it deals (and leeches) before taking the hit
                    ...(leech ? { passive: MAGNOLIA_P1 } : {}),
                }),
                'M4'
            ),
        ],
        // 1,000,000 HP so it survives the whole fight and the leech basis never shrinks.
        enemyTeam: [
            at(ship({ id: 'enemy', name: 'Enemy', attack: 2500, hp: 1_000_000, speed: 50 }), 'T1'),
        ],
        rounds: 3,
    });

    it('credits the PLAYER-side leecher, matching what it received', () => {
        const leeching = totals(playerSideInput(true), 'attacker');
        const control = totals(playerSideInput(false), 'attacker');

        // Existence + liveness: the leech really had a basis, and the control really ran the same
        // fight without it. Without these the nominal below could pass on a drifted-to-zero fixture.
        expect(leeching.damageDealt).toBeGreaterThan(0);
        expect(leeching.incomingDamage).toBeCloseTo(control.incomingDamage, 6);
        expect(control.healingDone).toBe(0);
        expect(control.healingReceived).toBe(0);

        // NOMINAL: 3 rounds x 20% of 4000 = 800 x 3.
        expect(leeching.healingReceived).toBe(2400);
        // THE CLAIM. Pre-fix this was 0 while `healingReceived` read 2400.
        expect(leeching.healingDone).toBe(2400);
    });

    // TEAM SYMMETRY (feedback_engine_team_symmetry): the same passive on the enemy side must
    // credit the enemy leecher's own row identically. The engine is side-agnostic here and the
    // report must be too — an enemy Magnolia is as real to the player watching the fight.
    it('credits the ENEMY-side leecher identically', () => {
        const enemySideInput = (leech: boolean): BattleSimulationInput => ({
            playerTeam: [
                at(
                    ship({ id: 'victim', name: 'Victim', attack: 2500, hp: 1_000_000, speed: 50 }),
                    'M4'
                ),
            ],
            enemyTeam: [
                at(
                    ship({
                        id: 'eleech',
                        name: 'EnemyLeecher',
                        attack: 4000,
                        hp: 10_000,
                        speed: 100,
                        ...(leech ? { passive: MAGNOLIA_P1 } : {}),
                    }),
                    'M4'
                ),
            ],
            rounds: 3,
        });
        const leeching = totals(enemySideInput(true), 'e:eleech:0');
        const control = totals(enemySideInput(false), 'e:eleech:0');

        expect(leeching.damageDealt).toBeGreaterThan(0);
        expect(control.healingDone).toBe(0);
        expect(control.healingReceived).toBe(0);

        expect(leeching.healingReceived).toBe(2400);
        expect(leeching.healingDone).toBe(2400);
    });
});

// ── CHANNEL 2: THE REACTIVE REPAIR ───────────────────────────────────────────────────────────
// Isha repairs 3% of her max HP when directly damaged. The repair is performed by her passive, so
// SHE is the source; it lands on her, so she is also the recipient. `reactive-heal-performed` is
// absent from the assembler's event allowlist by design, so before #383 this channel credited
// nobody at all on the done axis.
describe('#383 a reactive repair credits its performer with healing DONE', () => {
    const reactiveInput = (reactive: boolean): BattleSimulationInput => ({
        playerTeam: [
            at(
                ship({
                    id: 'isha',
                    name: 'Isha',
                    attack: 1000,
                    hp: 100_000,
                    speed: 50, // slower → it is hit each round, which is what arms the reaction
                    ...(reactive ? { passive: ISHA_REACTIVE } : {}),
                }),
                'M4'
            ),
        ],
        enemyTeam: [
            at(ship({ id: 'enemy', name: 'Enemy', attack: 5000, hp: 1_000_000, speed: 100 }), 'T1'),
        ],
        rounds: 3,
    });

    it('credits the reacting ship, matching what it received', () => {
        const reacting = totals(reactiveInput(true), 'attacker');
        const control = totals(reactiveInput(false), 'attacker');

        // Liveness: the ship really was directly damaged, so the reaction really had a trigger.
        expect(reacting.incomingDamage).toBeGreaterThan(0);
        // Existence: the inert control runs the same fight and repairs nothing, so anything below
        // is this passive and not some other channel the fixture happens to run.
        expect(control.healingDone).toBe(0);
        expect(control.healingReceived).toBe(0);

        // 3% of 100,000 max HP = 3000 per hit. The repair is real on the received axis...
        expect(reacting.healingReceived).toBeGreaterThan(0);
        // ...and THE CLAIM: it is now credited on the done axis too, at the same value (a self
        // repair — one repair, both axes, same ship).
        expect(reacting.healingDone).toBe(reacting.healingReceived);
    });
});

// ── THE CHANNEL THAT ALREADY WORKED: DO NOT REGRESS IT ───────────────────────────────────────
// This is the guard the fix most needed. `healingDone` was already correct for a CAST heal on
// BOTH sides, sourced from `heal-performed`. Reading a new axis instead is only safe if that axis
// covers the cast channel too — an axis credited at the leech and reactive sites alone would have
// silently zeroed every medic in the game while "fixing" the leech.
describe('#383 the cast-heal channel keeps reporting healing DONE on both sides', () => {
    const medic = (id: string, name: string) =>
        ship({
            id,
            name,
            attack: 0,
            hp: 1_000_000,
            activeTarget: 'allies',
            activePattern: 'Pattern-Circle-Support-Range-1',
            activeSkillText: 'This Unit repairs 30% of its Max HP.',
            type: 'Support',
        });

    it('credits a PLAYER cast medic', () => {
        const done = totals(
            {
                playerTeam: [
                    at(ship({ id: 'p1', name: 'Front', attack: 5000, hp: 300_000 }), 'M4'),
                    at(medic('p2', 'Medic'), 'M3'),
                ],
                enemyTeam: [
                    at(ship({ id: 'e1', name: 'Enemy', attack: 20_000, hp: 1_000_000 }), 'M4'),
                ],
                rounds: 5,
            },
            'p:p2:1'
        ).healingDone;
        expect(done).toBeGreaterThan(0);
    });

    it('credits an ENEMY cast medic', () => {
        const done = totals(
            {
                playerTeam: [
                    at(ship({ id: 'p1', name: 'Front', attack: 20_000, hp: 1_000_000 }), 'M4'),
                ],
                enemyTeam: [
                    at(ship({ id: 'e1', name: 'EnemyFront', attack: 5000, hp: 300_000 }), 'M4'),
                    at(medic('e2', 'EnemyMedic'), 'M3'),
                ],
                rounds: 5,
            },
            'e:e2:1'
        ).healingDone;
        expect(done).toBeGreaterThan(0);
    });
});

// ── THE CHANNEL THAT MUST STAY OFF: A REPAIR OVER TIME TICK ──────────────────────────────────
// Locked ruling R2 (#367): a HoT tick is NOT a repair PERFORMED. It emits no `heal-performed`,
// fires no on-repaired trigger, and credits no source — the holder's `healingReceived` books it
// and nobody's `healingDone` does. That asymmetry between the two columns is the contract, and it
// is exactly what a well-meaning "make the axes agree" change would break, so it is pinned here
// next to the credits rather than left as a comment on the axis.
//
// Flamel's active does BOTH in one cast — "repairs 13% of its Max HP AND grants Repair Over Time I
// for 2 turns" — so a single fixture separates them: the 13% is a performed repair and lands on
// both columns, the ticks land on `received` alone.
describe('#383 a Repair Over Time tick books received but NOT done (R2)', () => {
    /** Flamel's refit-1 active, verbatim from docs/ship-skills.csv. */
    const FLAMEL_ACTIVE =
        'This Unit <unit-damage>repairs 13%</unit-damage> of its Max HP and grants <unit-skill>Repair Over Time I</unit-skill> for 2 turns.';

    it('credits the cast portion only, while received counts the ticks too', () => {
        const medic = ship({
            id: 'flamel',
            name: 'Flamel',
            attack: 0,
            hp: 100_000,
            speed: 100,
            activeSkillText: FLAMEL_ACTIVE,
            activeTarget: 'self',
            type: 'Support',
        });
        const totalsFor = totals(
            {
                playerTeam: [at(medic, 'M4')],
                // Damages the medic hard enough that its repairs are not entirely clipped as
                // overheal — the ticks have to actually land for this to measure anything.
                enemyTeam: [
                    at(
                        ship({
                            id: 'enemy',
                            name: 'Enemy',
                            attack: 8000,
                            hp: 1_000_000,
                            speed: 50,
                        }),
                        'T1'
                    ),
                ],
                rounds: 4,
            },
            'attacker'
        );

        // LIVENESS on both columns: the cast really repaired (so `done` is not zero by accident)
        // and the ticks really landed on top of it (so the gap below is the ticks, not a rounding
        // artefact). Without the second, an inert HoT would let this pass as 0 < 0.
        expect(totalsFor.healingDone).toBeGreaterThan(0);
        expect(totalsFor.healingReceived).toBeGreaterThan(totalsFor.healingDone);

        // THE CLAIM, nominal: 13% of 100,000 max HP = 13,000 per cast, once per round over 4
        // rounds. Every HP above that on the received column is tick HP, and none of it is
        // credited as performed.
        expect(totalsFor.healingDone).toBe(52_000);
    });
});
