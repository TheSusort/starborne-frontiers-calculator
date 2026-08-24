/**
 * #372 — the Simulator's HP bar must report the engine's real HP, not a derived figure.
 *
 * `assembleBattleResult` does not read `currentHp`; it DERIVES each row's `hpPct` as
 * `(maxHp − hpLost + healed) / maxHp`, and `healed` is accumulated from `heal-performed.perTarget`
 * plus `hot-ticked`. `heal-performed` has exactly ONE production emit site (playerTurn.ts, the cast
 * path), and neither leech proc emits it — so every HP a standing leech restores is invisible to
 * the bar, its low-HP colour, its aria-label and the "Healing received" figure.
 *
 * THE GAME EXAMPLE. Magnolia's passive is "This Unit repairs itself for 20% of the damage it deals
 * to enemies" (40% at refit 2). Put her in front, let an enemy hit her, and she repairs a fifth of
 * her own output back every round. Her real HP holds far above what the bar draws — the player sees
 * her sliding toward red while the engine has her healthy.
 *
 * These tests are DIFFERENTIAL against an inert control: the identical ship and fight with the
 * leech passive absent. The leech run's reported `hpPct` must come out HIGHER. Before the fix both
 * runs reported 25% — the leech's 800 HP per round was entirely invisible.
 *
 * SCOPE: the HP bar is fixed by reporting the engine's real `currentHp` (a round-tail `hp-snapshot`,
 * team-symmetric over every actor). "Healing received" was the same defect on a second axis, closed
 * separately by #375 — the second test below was its pinned tripwire and is now its claim.
 *
 * Real production surface: verbatim skill text through `skillTextParser`/`buildShipAbilities` into
 * `simulateBattle`, not a hand-injected ability (the pattern from
 * `battleSimulatorDefenseSubstitution.test.ts`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setRateGateRng, resetRateGateRng } from '../rateAccumulator';
import { simulateBattle, BattlePlacement, BattleSimulationInput } from '../battleSimulator';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';

beforeEach(() => setRateGateRng(() => 0.999999)); // never crit — deterministic damage both runs
afterEach(() => resetRateGateRng());

const BASIC_ACTIVE = 'This Unit deals <unit-damage>100% damage</unit-damage>.';

/** Magnolia's refit-1 passive, verbatim from docs/ship-skills.csv. */
const MAGNOLIA_P1 =
    'This Unit <unit-damage>repairs itself for 20%</unit-damage> of the damage it deals to enemies.';

/** The focus. `leech` false is the inert control: same ship, same fight, no passive at all. */
const leecherShip = (leech: boolean): Ship => ({
    id: 'leecher',
    name: 'Leecher',
    rarity: 'legendary',
    faction: 'MPL',
    type: 'ATTACKER',
    baseStats: {
        hp: 10_000,
        attack: 4000,
        defence: 0,
        hacking: 200,
        security: 100,
        crit: 0,
        critDamage: 0,
        speed: 100, // faster than the enemy → it deals (and leeches) before taking the hit
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText: BASIC_ACTIVE,
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
    chargeSkillCharge: 0,
    ...(leech ? { firstPassiveSkillText: MAGNOLIA_P1 } : {}),
});

/** `attack: 0` makes the enemy harmless, which leaves the leecher at full HP all fight — the
 *  pure-overheal arm the GROSS assertion needs. */
const enemyShip = (attack = 2500): Ship => ({
    id: 'enemy',
    name: 'Enemy',
    rarity: 'legendary',
    faction: 'MPL',
    type: 'ATTACKER',
    baseStats: {
        hp: 1_000_000, // survives the whole fight, so the leech basis never shrinks
        attack,
        defence: 0,
        hacking: 200,
        security: 100,
        crit: 0,
        critDamage: 0,
        speed: 50,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText: BASIC_ACTIVE,
    activeTarget: 'front', // anchors the front-most (M4) player — the leecher
    activePattern: 'Pattern-Base',
    chargeSkillCharge: 0,
});

const placement = (ship: Ship, position: Position): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: ship.baseStats.attack,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: ship.baseStats.hacking,
        defence: ship.baseStats.defence,
        hp: ship.baseStats.hp,
        speed: ship.baseStats.speed,
    },
});

const input = (leech: boolean, enemyAttack = 2500): BattleSimulationInput => ({
    playerTeam: [placement(leecherShip(leech), 'M4')],
    enemyTeam: [placement(enemyShip(enemyAttack), 'T1')],
    rounds: 3,
});

type Row = {
    hpPct: number;
    damageDealt: number;
    incomingDamage: number;
    healingReceived: number;
    healingDone: number;
};
const lastRow = (leech: boolean, enemyAttack?: number): Row => {
    const result = simulateBattle(input(leech, enemyAttack));
    const round = result.rounds[result.rounds.length - 1];
    const row = round.ships.find((s) => s.actorId === 'attacker');
    if (!row) throw new Error('no focus row');
    return row;
};

describe('#372 the HP bar reports real HP, not a derived figure', () => {
    it('a standing leech raises the reported hpPct above the no-leech control', () => {
        const control = lastRow(false);
        const leeching = lastRow(true);

        // Liveness — the control really is damaged, so there is room for the leech to show. Without
        // this both sides could sit clamped at 100% and the comparison would be vacuous.
        expect(control.hpPct).toBeGreaterThan(0);
        expect(control.hpPct).toBeLessThan(100);
        // Existence — the leecher really dealt damage, so its passive really had a basis to leech
        // from, and both runs took the same incoming damage (the only difference is the repair).
        expect(leeching.damageDealt).toBeGreaterThan(0);
        expect(leeching.incomingDamage).toBeCloseTo(control.incomingDamage, 6);

        // The claim: repairing a fifth of its own output back must move the bar.
        expect(leeching.hpPct).toBeGreaterThan(control.hpPct);
    });

    // ── THE SECOND AXIS, closed by #375 ──────────────────────────────────────────────────────
    // "Healing received" was the SECOND surface of the same defect: the row accumulated it from
    // `heal-performed` + `hot-ticked`, and a leech emits neither, so a ship repairing itself all
    // fight reported 0. The `hp-snapshot` now carries the round's GROSS repair, read off the
    // engine's per-recipient healing axis — which needed its two enemy-side credit arms lifted
    // first (`recipientAxisTeamSymmetry.test.ts`).
    //
    // This assertion was the pinned gap (`toBe(0)`, a deliberate tripwire). It is now the claim.
    it('reports the leech as healing received', () => {
        const leeching = lastRow(true);
        const control = lastRow(false);

        // Liveness: the bar moved, so the repair really happened.
        expect(leeching.hpPct).toBeGreaterThan(control.hpPct);
        // NOMINAL, not directional. Magnolia repairs 20% of the damage she deals; the enemy has 0
        // defence and nothing crits, so each round's attack lands 4000 and the leech pays 800.
        expect(leeching.healingReceived).toBe(800);
        // The inert control reports 0 — so the 800 above is the leech and not some other channel
        // this fixture happens to run.
        expect(control.healingReceived).toBe(0);
    });

    // GROSS, not effective — the contract this axis has always been held to, now asserted at the
    // REPORTED surface rather than only on the engine's axis. With a harmless enemy the leecher
    // never leaves full HP, so every round's 800 is entirely wasted: `consumed` is 0 and only the
    // gross bucket is non-zero. A fix that reported `effectiveHeal` reads 0 here and passes every
    // other test in this file.
    it('reports a wholly-wasted leech at its GROSS value, with the bar untouched', () => {
        const HARMLESS = 0;
        const leeching = lastRow(true, HARMLESS);

        // Liveness/existence: the leech had a basis (real damage dealt), and the ship really is at
        // full HP — so the repair below genuinely landed on nothing.
        expect(leeching.damageDealt).toBeGreaterThan(0);
        expect(leeching.incomingDamage).toBe(0);
        expect(leeching.hpPct).toBe(100);

        expect(leeching.healingReceived).toBe(800);
        // …and the control still reports nothing, so 800 is the leech.
        expect(lastRow(false, HARMLESS).healingReceived).toBe(0);
    });

    // ── STILL OPEN, on the OTHER axis ────────────────────────────────────────────────────────
    // "Healing done" has the identical hole and #375 does NOT close it: `healDone` accumulates
    // from `heal-performed.casterId`, which a leech never emits, so this leecher reports 0 done
    // while reporting 800 received. It cannot be fixed the same way — the engine's SOURCE axis
    // (`perActor`) is player-only BY DESIGN (E5 §4.1, an enemy heal must not enter the player
    // healing buckets), so there is no team-symmetric total to read. Pinned rather than described,
    // so whoever takes it on finds a red test instead of a comment.
    it('does NOT yet report the leech as healing DONE (source axis is player-only by design)', () => {
        const leeching = lastRow(true);
        // Liveness: the repair happened and IS reported on the received axis.
        expect(leeching.healingReceived).toBe(800);
        expect(leeching.healingDone).toBe(0);
    });
});
