/**
 * SP-0, Task 5: the epic's four high-level sim-golden fixtures.
 *
 * Construction pattern mirrors `battleSimulatorDefenseSubstitution.test.ts` exactly: hand-built
 * `Ship`s with verbatim (parser-confirmed) skill text, a `placement(ship, position)` helper
 * whose `statOverrides` mirror `baseStats`, and a plain `BattleSimulationInput` object. Ship
 * ids/names are STABLE and DISTINCT on purpose — they seed the keyed-RNG stream ids (Tasks 1-4
 * of this epic), so reusing/emptying an id would collide two ships onto the same RNG stream.
 *
 * Every fixture uses an intermediate crit (~50) so RNG is genuinely exercised (both crit and
 * non-crit draws occur across 8 rounds) and `rounds: 8` so multi-round mechanics (DoT ticks,
 * repeat detonation casts, sustained healing) actually fire more than once.
 *
 * Skill-text clauses below are ALL verified against the same parse path exercised by
 * `buildShipAbilities.test.ts` / `twoTeamBattle.test.ts` (this repo has no local
 * docs/ship-skills.csv to grep, per the task brief) — see the per-fixture comments for the
 * specific precedent each clause mirrors:
 *   - DoT infliction ("inflicts <unit-skill>Inferno II</unit-skill> for 2 turns") — the same
 *     shape as buildShipAbilities.test.ts's "Panguan active" case (Bomb II) and Crocus's
 *     Corrosion II infliction; routes through DOT_TIER_MAP auto-fill → a `dot` ability.
 *   - Combined "detonates X effects with N% of their power" + "inflicts X" on ONE skill — the
 *     same shape as buildShipAbilities.test.ts's "Incinerator charged" case (there: Inferno);
 *     here applied to Bomb so a single ship is both the bomb-applier AND (on its 2nd+ cast)
 *     the detonator.
 *   - The on-attacked counter passive ("When this Unit is directly damaged as a primary
 *     target, it deals N% damage to that enemy") — verbatim shape from buildShipAbilities.
 *     test.ts's "Stalwart" counterattack passive cases.
 *   - The ally-heal active ("This Unit repairs N% of its Max HP." with `activeTarget: 'allies'`)
 *     — verbatim shape from twoTeamBattle.test.ts's healer cases.
 *   - Targeting/positions follow `selectTargets.ts`: rows are T/M/B, columns 1 (back) - 4
 *     (front); a caster's row-scan starts at ITS OWN row then cycles T→M→B→T on the opposing
 *     side, so placing a lone defender in a row the attacker also occupies guarantees a
 *     single-target ("primary target") hit on that defender.
 */
import type { Ship, Refit } from '../../../../types/ship';
import type { Position } from '../../../../types/encounters';
import type { ShipTypeName } from '../../../../constants/shipTypes';
import type { BattlePlacement, BattleSimulationInput } from '../../battleSimulator';

const NO_REFITS: Refit[] = [];

/** Shared combat-stat shape used by every fixture ship: intermediate crit (~50) so RNG
 *  (crit draws, debuff-landing draws) is genuinely exercised across 8 rounds, without being
 *  deterministic in either direction. HP is generous relative to attack so the battle survives
 *  multiple rounds (non-degenerate) rather than wiping out in round 1. */
interface FixtureStatsOpts {
    hp: number;
    attack: number;
    defence: number;
    hacking: number;
    security: number;
    speed: number;
    crit?: number;
    critDamage?: number;
}

const baseStats = (o: FixtureStatsOpts) => ({
    hp: o.hp,
    attack: o.attack,
    defence: o.defence,
    hacking: o.hacking,
    security: o.security,
    crit: o.crit ?? 50,
    critDamage: o.critDamage ?? 150,
    speed: o.speed,
});

/** Mirrors `battleSimulatorDefenseSubstitution.test.ts`'s `placement`: statOverrides copy
 *  baseStats verbatim (plus a fixed 0 defensePenetration) so the engine's derived combat
 *  stats match what each ship's skill text implies. */
const placement = (ship: Ship, position: Position): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: ship.baseStats.attack,
        crit: ship.baseStats.crit,
        critDamage: ship.baseStats.critDamage,
        defensePenetration: 0,
        hacking: ship.baseStats.hacking,
        security: ship.baseStats.security,
        defence: ship.baseStats.defence,
        hp: ship.baseStats.hp,
        speed: ship.baseStats.speed,
    },
});

const shipBase = (id: string, name: string, type: ShipTypeName, stats: FixtureStatsOpts): Ship => ({
    id,
    name,
    rarity: 'legendary',
    faction: 'MPL',
    type,
    baseStats: baseStats(stats),
    equipment: {},
    implants: {},
    refits: NO_REFITS,
    affinity: 'antimatter',
    chargeSkillCharge: 0,
});

// ===========================================================================
// twoVsTwo — player: DoT-applier attacker + healer supporter; enemy: bomb-applier/
// detonator attacker + plain attacker. Positions per brief: player M4/M1, enemy T4/T1.
// ===========================================================================

/** Player front: inflicts Inferno II (a real DoT tick source) each cast. Same infliction
 *  shape as Crocus's Corrosion II clause (buildShipAbilities.test.ts, "Crocus passive") —
 *  DOT_TIER_MAP auto-fill turns this into a `dot` ability (dotType 'inferno') on the active
 *  slot, ticking on whichever enemy it lands on for its 2-turn duration. */
const twoVsTwoPlayerDot = (): Ship => ({
    ...shipBase('t2t2-p-dot', 'Vanguard', 'ATTACKER', {
        hp: 300_000,
        attack: 2000,
        defence: 300,
        hacking: 250,
        security: 150,
        speed: 120,
    }),
    activeSkillText:
        'This Unit deals <unit-damage>100% damage</unit-damage> and inflicts <unit-skill>Inferno II</unit-skill> for 2 turns.',
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
});

/** Player back: pure ally-heal support, verbatim shape from twoTeamBattle.test.ts's healer
 *  cases (`activeTarget: 'allies'`, bare "repairs N% of its Max HP."). */
const twoVsTwoPlayerHealer = (): Ship => ({
    ...shipBase('t2t2-p-healer', 'Aegis', 'SUPPORTER', {
        hp: 250_000,
        attack: 0,
        defence: 300,
        hacking: 200,
        security: 150,
        speed: 100,
    }),
    activeSkillText: 'This Unit repairs 20% of its Max HP.',
    activeTarget: 'allies',
    activePattern: 'Pattern-Base',
});

/** Enemy front: BOTH the bomb-applier AND (from its 2nd cast onward) the detonator — same
 *  combined "detonates X effects with N% of their power" + "inflicts X" shape as
 *  buildShipAbilities.test.ts's "Incinerator charged" case, applied to Bomb instead of
 *  Inferno. First cast: 0 stacks exist yet, so the detonate-dot payout is 0 and it just
 *  inflicts a fresh Bomb II (2-turn duration). Any later cast this ship survives to make
 *  detonates the still-live Bomb from the earlier cast for a real, non-zero payout. */
const twoVsTwoEnemyBomber = (): Ship => ({
    ...shipBase('t2t2-e-bomber', 'Breacher', 'ATTACKER', {
        hp: 300_000,
        attack: 1800,
        defence: 200,
        hacking: 250,
        security: 150,
        speed: 110,
    }),
    activeSkillText:
        'This Unit deals <unit-damage>120% damage</unit-damage>, detonates Bomb effects with 150% of their power, and inflicts <unit-skill>Bomb II</unit-skill> for 2 turns.',
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
});

const twoVsTwoEnemyAttacker = (): Ship =>
    shipBase('t2t2-e-attacker', 'Marauder', 'ATTACKER', {
        hp: 250_000,
        attack: 1500,
        defence: 200,
        hacking: 200,
        security: 150,
        speed: 90,
    });

/** Enemy plain attacker still needs active targeting fields — added via the base shape. */
const finalizeAttacker = (ship: Ship): Ship => ({
    ...ship,
    activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
});

export function twoVsTwo(): BattleSimulationInput {
    return {
        playerTeam: [placement(twoVsTwoPlayerDot(), 'M4'), placement(twoVsTwoPlayerHealer(), 'M1')],
        enemyTeam: [
            placement(twoVsTwoEnemyBomber(), 'T4'),
            placement(finalizeAttacker(twoVsTwoEnemyAttacker()), 'T1'),
        ],
        rounds: 8,
    };
}

// ===========================================================================
// threeVsThree — AoE-pattern attacker, a reactive (on-attacked counter) ship, and a
// support/hybrid (ally-heal) ship, spread across all three rows (T/M/B) on both sides so
// the AoE footprint genuinely covers multiple occupied cells.
// ===========================================================================

/** AoE attacker: `activePattern: 'Pattern-All'` is the actual footprint-widening mechanism —
 *  `resolveCells` (targeting/resolvePattern.ts) special-cases `shape === 'all'` to cover EVERY
 *  board position outright, regardless of anchor/geometry (confirmed against
 *  targetingParser.test.ts's `parsePattern('Pattern-All')` case: `{ shape: 'all', range:
 *  'all' }`). `activeTarget: 'front'` still supplies a valid enemy-side anchor for parsing,
 *  but the pattern's footprint is what actually multiplies the victim count — with the enemy
 *  team spread across T/M/B this fixture's single cast hits all three separate cells in one
 *  turn (verified: 3 distinct `targets` entries on Comet's `attack` log entry, one per enemy). */
const threeVsThreePlayerAoe = (): Ship => ({
    ...shipBase('t3t3-p-aoe', 'Comet', 'ATTACKER', {
        hp: 260_000,
        attack: 1600,
        defence: 250,
        hacking: 200,
        security: 150,
        speed: 130,
    }),
    activeSkillText: 'This Unit deals <unit-damage>80% damage</unit-damage> to all enemies.',
    activeTarget: 'front',
    activePattern: 'Pattern-All',
});

/** Reactive ship: verbatim on-attacked counter shape from buildShipAbilities.test.ts's
 *  "Stalwart first passive" case. Placed alone in row M so an enemy caster ALSO in row M
 *  (its row-scan starts at its OWN row first, per selectTargets.ts) lands a single-target
 *  ("primary target") hit here, satisfying `requirePrimaryTarget` and firing the counter. */
const threeVsThreePlayerReactive = (): Ship => ({
    ...shipBase('t3t3-p-reactive', 'Bastion', 'DEFENDER', {
        hp: 320_000,
        attack: 1200,
        defence: 500,
        hacking: 200,
        security: 200,
        speed: 100,
    }),
    activeSkillText: 'This Unit deals <unit-damage>90% damage</unit-damage>.',
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
    firstPassiveSkillText:
        'When this Unit is directly damaged as a primary target, it deals <unit-damage>70% damage</unit-damage> to that enemy.',
});

/** Support/hybrid ship: pure ally-heal active (no direct-damage ability), same shape as the
 *  twoVsTwo healer — its "incidental damage" (none dealt) is the documented dummy-sink case
 *  the brief calls out for a support ship in a mixed 3v3 roster. */
const threeVsThreePlayerSupport = (): Ship => ({
    ...shipBase('t3t3-p-support', 'Solace', 'SUPPORTER', {
        hp: 240_000,
        attack: 0,
        defence: 250,
        hacking: 200,
        security: 150,
        speed: 95,
    }),
    activeSkillText: 'This Unit repairs 15% of its Max HP.',
    activeTarget: 'allies',
    activePattern: 'Pattern-Base',
});

const threeVsThreeEnemyRaider = (): Ship =>
    finalizeAttacker(
        shipBase('t3t3-e-raider', 'Raider', 'ATTACKER', {
            hp: 220_000,
            attack: 1400,
            defence: 200,
            hacking: 220,
            security: 150,
            speed: 105,
        })
    );

const threeVsThreeEnemyVex = (): Ship =>
    finalizeAttacker(
        shipBase('t3t3-e-vex', 'Vex', 'ATTACKER', {
            hp: 220_000,
            attack: 1400,
            defence: 200,
            hacking: 220,
            security: 150,
            speed: 115,
        })
    );

const threeVsThreeEnemyGrim = (): Ship =>
    finalizeAttacker(
        shipBase('t3t3-e-grim', 'Grim', 'ATTACKER', {
            hp: 220_000,
            attack: 1400,
            defence: 200,
            hacking: 220,
            security: 150,
            speed: 85,
        })
    );

export function threeVsThree(): BattleSimulationInput {
    return {
        playerTeam: [
            // Row T: the AoE attacker.
            placement(threeVsThreePlayerAoe(), 'T4'),
            // Row M (alone): the reactive counter ship — the enemy Raider below shares row M,
            // so its 'front' row-scan lands here first as a single (primary) target.
            placement(threeVsThreePlayerReactive(), 'M4'),
            // Row B: the support/healer.
            placement(threeVsThreePlayerSupport(), 'B4'),
        ],
        enemyTeam: [
            // Row T: targets player row T (Comet) first.
            placement(threeVsThreeEnemyVex(), 'T1'),
            // Row M: targets player row M (Bastion) first — the primary-target counter trigger.
            placement(threeVsThreeEnemyRaider(), 'M1'),
            // Row B: targets player row B (Solace) first.
            placement(threeVsThreeEnemyGrim(), 'B1'),
        ],
        rounds: 8,
    };
}

// ===========================================================================
// dpsMode — a single focus attacker vs ONE skill-less enemy ship (the SP-U DPS-calc
// opponent shape: a static target with no active/charge/passive text at all).
// ===========================================================================

const dpsModeFocus = (): Ship =>
    finalizeAttacker(
        shipBase('dps-focus', 'Striker', 'ATTACKER', {
            hp: 200_000,
            attack: 2500,
            defence: 300,
            hacking: 200,
            security: 150,
            speed: 100,
        })
    );

/** Skill-less dummy opponent: every skill-text field is empty, so `buildShipAbilities`
 *  produces no abilities for it at all — a pure static punching bag, matching the SP-U
 *  DPS-calculator's opponent shape. */
const dpsModeOpponent = (): Ship =>
    shipBase('dps-opponent', 'Dummy', 'DEFENDER', {
        hp: 1_000_000,
        attack: 0,
        defence: 500,
        hacking: 200,
        security: 150,
        speed: 50,
    });

export function dpsMode(): BattleSimulationInput {
    return {
        playerTeam: [placement(dpsModeFocus(), 'M4')],
        enemyTeam: [placement(dpsModeOpponent(), 'T4')],
        rounds: 8,
    };
}

// ===========================================================================
// healingMode — player: healer + tank (Defender); enemy: two attackers inflicting debuffs
// against the tank's security (exercises heal routing + hacking-vs-security landing rolls).
// ===========================================================================

const healingModeHealer = (): Ship => ({
    ...shipBase('heal-healer', 'Solstice', 'SUPPORTER', {
        hp: 220_000,
        attack: 0,
        defence: 300,
        hacking: 220,
        security: 180,
        speed: 130,
    }),
    activeSkillText: 'This Unit repairs 25% of its Max HP.',
    activeTarget: 'allies',
    activePattern: 'Pattern-Base',
});

/** The tank: low security relative to the enemies' hacking, so the incoming debuffs actually
 *  exercise the hacking-vs-security landing roll rather than auto-landing/auto-resisting. */
const healingModeTank = (): Ship =>
    finalizeAttacker(
        shipBase('heal-tank', 'Bulwark', 'DEFENDER', {
            hp: 400_000,
            attack: 800,
            defence: 600,
            hacking: 150,
            security: 120,
            speed: 90,
        })
    );

const healingModeEnemyOne = (): Ship => ({
    ...shipBase('heal-enemy-1', 'Saboteur', 'ATTACKER', {
        hp: 240_000,
        attack: 1600,
        defence: 250,
        hacking: 260,
        security: 150,
        speed: 105,
    }),
    activeSkillText:
        'This Unit deals <unit-damage>100% damage</unit-damage> and inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns.',
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
});

const healingModeEnemyTwo = (): Ship => ({
    ...shipBase('heal-enemy-2', 'Corruptor', 'ATTACKER', {
        hp: 240_000,
        attack: 1600,
        defence: 250,
        hacking: 260,
        security: 150,
        speed: 100,
    }),
    activeSkillText:
        'This Unit deals <unit-damage>100% damage</unit-damage> and inflicts <unit-skill>Attack Down II</unit-skill> for 2 turns.',
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
});

export function healingMode(): BattleSimulationInput {
    return {
        playerTeam: [placement(healingModeTank(), 'M4'), placement(healingModeHealer(), 'M1')],
        enemyTeam: [placement(healingModeEnemyOne(), 'T4'), placement(healingModeEnemyTwo(), 'T1')],
        rounds: 8,
    };
}

// ===========================================================================
// deathPath (SP-U U5) — a DECISIVE-OUTCOME battle: a fast, high-attack player attacker vs a
// single fragile low-HP enemy that it wipes well inside the window. Closes the SP-0 follow-up
// (all four original sim goldens end in `draw`): this one terminates on a real wipe with
// `winner === 'player'`, `lastRound < 8`, and ≥1 death recorded.
// ===========================================================================

/** Fast glass-cannon attacker (speed 140 → acts first) that reliably kills the fragile enemy in
 *  a couple of rounds. Plain 100% single-target front damage. */
const deathPathExecutioner = (): Ship =>
    finalizeAttacker(
        shipBase('death-executioner', 'Executioner', 'ATTACKER', {
            hp: 300_000,
            attack: 12_000,
            defence: 400,
            hacking: 250,
            security: 200,
            speed: 140,
            crit: 60,
        })
    );

/** Fragile enemy: tiny HP pool, near-zero defence, slow (acts last), harmless attack — it is
 *  wiped in round 1 (confirmed by the golden's `lastRound: 1`), giving a decisive player win
 *  without the attacker ever being at risk. */
const deathPathHusk = (): Ship =>
    finalizeAttacker(
        shipBase('death-husk', 'Husk', 'DEFENDER', {
            hp: 30_000,
            attack: 300,
            defence: 0,
            hacking: 100,
            security: 100,
            speed: 50,
        })
    );

export function deathPath(): BattleSimulationInput {
    return {
        playerTeam: [placement(deathPathExecutioner(), 'M4')],
        enemyTeam: [placement(deathPathHusk(), 'T4')],
        rounds: 8,
    };
}

// ===========================================================================
// healCasting (SP-U U5) — locks sim-mode healing after the R6 (healTargetId) decouple. A pure
// ally-heal SUPPORTER on a real-vs-real team: the engine builds `healingCtx` off the
// `positionalTeamBattle` signal (no vestigial healTargetId) and routes each cast to the
// lowest-HP LIVING player ally via `lowestHpAllyId`. A fragile front ally soaks enemy fire while
// the healer repairs it every turn; the battle survives the window (draw), so sustained,
// per-turn heal routing is exercised across all 8 rounds. NOTE: the enemy's per-round damage is
// small relative to the healer's 20%-max-HP cast, so the front ally sits at ~95-100% HP for most
// of the golden — the heal is mostly OVERHEAL in this fixture. That's fine for its purpose: it
// still exercises the positionalTeamBattle wiring + lowestHpAllyId routing + heal application
// every round; it is not meant to be a low-HP/near-death healing stress case.
// ===========================================================================

/** Fragile front ally: low HP + modest defence so it visibly loses (and regains) HP each round,
 *  keeping it the lowest-HP ally so `lowestHpAllyId` routes the healer's cast here. */
const healCastingFrontAlly = (): Ship =>
    finalizeAttacker(
        shipBase('healcast-front', 'Ember', 'ATTACKER', {
            hp: 90_000,
            attack: 1_500,
            defence: 150,
            hacking: 200,
            security: 150,
            speed: 120,
        })
    );

/** Pure ally-heal supporter (same shape as the twoVsTwo healer): repairs 20% of its Max HP to an
 *  ally each turn. High HP + no offence so it is never the lowest-HP ally — the heal always
 *  routes to the fragile front ally. */
const healCastingHealer = (): Ship => ({
    ...shipBase('healcast-healer', 'Mender', 'SUPPORTER', {
        hp: 260_000,
        attack: 0,
        defence: 300,
        hacking: 200,
        security: 150,
        speed: 100,
    }),
    activeSkillText: 'This Unit repairs 20% of its Max HP.',
    activeTarget: 'allies',
    activePattern: 'Pattern-Base',
});

/** Enemy attacker: steady front damage onto the fragile ally — enough to dent it each round
 *  (so the heal has work to do) but not enough to out-race the healer within the window. */
const healCastingEnemy = (): Ship =>
    finalizeAttacker(
        shipBase('healcast-enemy', 'Reaver', 'ATTACKER', {
            hp: 300_000,
            attack: 2_000,
            defence: 200,
            hacking: 220,
            security: 150,
            speed: 90,
        })
    );

export function healCasting(): BattleSimulationInput {
    return {
        playerTeam: [placement(healCastingFrontAlly(), 'M4'), placement(healCastingHealer(), 'M1')],
        enemyTeam: [placement(healCastingEnemy(), 'T4')],
        rounds: 8,
    };
}
