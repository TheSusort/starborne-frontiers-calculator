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
 * team-symmetric over every actor). "Healing received" is the same defect on a second axis and is
 * NOT fixed — the second test pins that gap and says why.
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

const enemyShip = (): Ship => ({
    id: 'enemy',
    name: 'Enemy',
    rarity: 'legendary',
    faction: 'MPL',
    type: 'ATTACKER',
    baseStats: {
        hp: 1_000_000, // survives the whole fight, so the leech basis never shrinks
        attack: 2500,
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

const input = (leech: boolean): BattleSimulationInput => ({
    playerTeam: [placement(leecherShip(leech), 'M4')],
    enemyTeam: [placement(enemyShip(), 'T1')],
    rounds: 3,
});

type Row = { hpPct: number; damageDealt: number; incomingDamage: number; healingReceived: number };
const lastRow = (leech: boolean): Row => {
    const result = simulateBattle(input(leech));
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

    // ── KNOWN GAP, pinned deliberately ───────────────────────────────────────────────────────
    // "Healing received" is the SECOND surface of the same defect and is NOT fixed here. The
    // `hp-snapshot` could not carry it: the natural source, the round's per-recipient healing axis,
    // is PLAYER-SIDE ONLY — measured empty for every actor on the enemy-side arm of
    // `reversedRepairs.engine.test.ts` even where an enemy medic really repaired an enemy victim
    // for 10 000, so substituting it regressed the enemy side from correct to 0.
    //
    // This assertion pins the gap as it stands rather than describing it in a comment. When the
    // recipient axis becomes team-symmetric and this row starts reporting the leech, this goes RED
    // — which is the point: it is a reminder, not a claim that 0 is correct.
    it('does NOT yet report the leech as healing received (recipient axis is player-side only)', () => {
        const leeching = lastRow(true);
        // Liveness: the bar DID move, so the repair really happened — the 0 below is a reporting
        // gap on a different axis, not an absent repair.
        expect(leeching.hpPct).toBeGreaterThan(lastRow(false).hpPct);
        expect(leeching.healingReceived).toBe(0);
    });
});
