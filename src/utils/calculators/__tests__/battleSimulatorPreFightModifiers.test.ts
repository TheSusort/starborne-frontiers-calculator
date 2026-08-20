/**
 * Sub-project F, PR F3: squad-leader MODIFIER channels reach the battle — integration
 * tests through `simulateBattle` with real SQUAD_LEADERS data (fixture style copied from
 * battleSimulatorSquadLeaders.test.ts).
 *
 * Channel → leader under test (each isolates its modifier by comparing the stage that
 * ADDS the modifier against the stage just below it, so the shared stat stages cancel):
 *   - outgoingDamage        → XAOC "Predator" stage III (+5% outgoing direct damage)
 *   - incomingCritDamage    → TERRAN_COMBINE "Optimizer" stage III (-10% incoming crit damage)
 *   - outgoingCritDamage    → ATLAS_SYNDICATE "Negotiator" stage III (enemies lose 10% crit
 *                             damage — the crit-conditional damage modifier, NOT Crit Power)
 *   - startingShieldPctOfHp → ATLAS_SYNDICATE "Broker" stage III (start shielded 20% max HP)
 *   - incomingDamage        → covered in battleSimulatorSquadLeaders.test.ts (Midas stage II)
 *   - outgoingHeal/incomingHeal → engine-level tests (preFightModifiersEngine.test.ts) — no
 *     battle-sim fixture ship carries a parseable heal skill.
 *
 * Plus the F3 inertness proof: a STAT-ONLY leader run is deep-equal to a no-leader run
 * with the same stats pre-multiplied by hand (the modifier plumbing attaches nothing when
 * every channel is zero).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setRateGateRng, resetRateGateRng } from '../rateAccumulator';
import { simulateBattle, BattlePlacement, BattleSimulationInput } from '../battleSimulator';
import type { Ship } from '../../../types/ship';
import type { FactionName } from '../../../constants/factions';
import type { Position } from '../../../types/encounters';

beforeEach(() => setRateGateRng(() => 0.999999));
afterEach(() => resetRateGateRng());

const makeShip = (
    id: string,
    name: string,
    faction: FactionName,
    opts: { activeTarget: string; activePattern: string }
): Ship => ({
    id,
    name,
    rarity: 'legendary',
    faction,
    type: 'Attacker',
    baseStats: {
        hp: 0,
        attack: 0,
        defence: 0,
        hacking: 200,
        security: 100,
        crit: 0,
        critDamage: 0,
        speed: 100,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    chargeSkillCharge: 0,
    activeTarget: opts.activeTarget,
    activePattern: opts.activePattern,
});

const placement = (
    ship: Ship,
    position: Position,
    stats: { attack: number; hp: number; crit?: number; critDamage?: number }
): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: stats.attack,
        crit: stats.crit ?? 0,
        critDamage: stats.critDamage ?? 0,
        defensePenetration: 0,
        hacking: 200,
        defence: 0,
        hp: stats.hp,
    },
});

const FRONT = { activeTarget: 'front', activePattern: 'Pattern-Base' } as const;
const BACK = { activeTarget: 'back', activePattern: 'Pattern-Base' } as const;

/** 2v2 board: p1 = leader-faction focus up front, p2 = off-faction (MPL) in the back. */
const buildTeams = (
    p1Faction: FactionName,
    enemyStats: { attack: number; crit?: number; critDamage?: number } = { attack: 2000 }
): Pick<BattleSimulationInput, 'playerTeam' | 'enemyTeam'> => ({
    playerTeam: [
        placement(makeShip('p1', 'Player Front', p1Faction, FRONT), 'M4', {
            attack: 5000,
            hp: 100_000,
        }),
        placement(makeShip('p2', 'Player Back', 'MPL', BACK), 'M3', {
            attack: 4000,
            hp: 100_000,
        }),
    ],
    enemyTeam: [
        placement(makeShip('e1', 'Enemy Front', 'MPL', FRONT), 'M4', {
            ...enemyStats,
            hp: 100_000,
        }),
        placement(makeShip('e2', 'Enemy Back', 'MPL', BACK), 'M1', {
            ...enemyStats,
            hp: 100_000,
        }),
    ],
});

const round1 = (result: ReturnType<typeof simulateBattle>, actorId: string) => {
    const row = result.rounds[0].ships.find((s) => s.actorId === actorId);
    if (!row) throw new Error(`no round-1 row for ${actorId}`);
    return row;
};

describe('simulateBattle pre-fight modifiers — outgoingDamage (Predator III)', () => {
    it('adds exactly +5% to the XAOC ship’s dealt damage on top of the stage-II stat folds', () => {
        // Stage II (+8% HP, +8% attack) vs stage III (adds ONLY the +5% outgoing modifier):
        // the stat stages cancel in the ratio, isolating the channel.
        const stage2 = simulateBattle({
            ...buildTeams('XAOC'),
            rounds: 2,
            playerSquadLeader: { faction: 'XAOC', name: 'Predator', stage: 2 },
        });
        const stage3 = simulateBattle({
            ...buildTeams('XAOC'),
            rounds: 2,
            playerSquadLeader: { faction: 'XAOC', name: 'Predator', stage: 3 },
        });

        expect(round1(stage2, 'attacker').damageDealt).toBeGreaterThan(0);
        expect(round1(stage3, 'attacker').damageDealt).toBeCloseTo(
            1.05 * round1(stage2, 'attacker').damageDealt
        );
        // Off-faction teammate untouched by the channel.
        expect(round1(stage3, 'p:p2:1').damageDealt).toBe(round1(stage2, 'p:p2:1').damageDealt);
        // Fully simulated → no unsimulated report.
        expect('preFight' in stage3).toBe(false);
    });
});

describe('simulateBattle pre-fight modifiers — incomingCritDamage (Optimizer III)', () => {
    // Optimizer: I +8% Defence (fixture defence 0 → inert), II +20 Security (no debuffs →
    // inert), III -10% incoming crit damage. Stage III vs II isolates the channel.
    const CRIT_ENEMIES = { attack: 2000, crit: 100, critDamage: 50 };
    const NOCRIT_ENEMIES = { attack: 2000, crit: 0, critDamage: 50 };

    it('crit-only: Terran allies take exactly 10% smaller CRIT hits', () => {
        const stage2 = simulateBattle({
            ...buildTeams('TERRAN_COMBINE', CRIT_ENEMIES),
            rounds: 2,
            playerSquadLeader: { faction: 'TERRAN_COMBINE', name: 'Optimizer', stage: 2 },
        });
        const stage3 = simulateBattle({
            ...buildTeams('TERRAN_COMBINE', CRIT_ENEMIES),
            rounds: 2,
            playerSquadLeader: { faction: 'TERRAN_COMBINE', name: 'Optimizer', stage: 3 },
        });
        // crit 100 → every enemy hit crits → the whole damage taken scales ×0.9.
        expect(round1(stage2, 'attacker').damageTaken).toBeGreaterThan(0);
        expect(round1(stage3, 'attacker').damageTaken).toBeCloseTo(
            0.9 * round1(stage2, 'attacker').damageTaken
        );
        // Off-faction teammate untouched.
        expect(round1(stage3, 'p:p2:1').damageTaken).toBe(round1(stage2, 'p:p2:1').damageTaken);
    });

    it('non-crit hits are NOT reduced (crit-conditionality)', () => {
        const stage2 = simulateBattle({
            ...buildTeams('TERRAN_COMBINE', NOCRIT_ENEMIES),
            rounds: 2,
            playerSquadLeader: { faction: 'TERRAN_COMBINE', name: 'Optimizer', stage: 2 },
        });
        const stage3 = simulateBattle({
            ...buildTeams('TERRAN_COMBINE', NOCRIT_ENEMIES),
            rounds: 2,
            playerSquadLeader: { faction: 'TERRAN_COMBINE', name: 'Optimizer', stage: 3 },
        });
        expect(round1(stage2, 'attacker').damageTaken).toBeGreaterThan(0);
        expect(round1(stage3, 'attacker').damageTaken).toBe(round1(stage2, 'attacker').damageTaken);
    });
});

describe('simulateBattle pre-fight modifiers — outgoingCritDamage (Negotiator III enemy debuff)', () => {
    // Negotiator III: "Enemy units lose 10% crit damage" — a crit-conditional damage
    // modifier on the ENEMIES' outgoing damage (their crits deal 10% less), NOT the
    // critDamage stat. Stage III vs II isolates it (the stage-III speed debuff does not
    // change per-hit damage; players already precede enemies at equal speed).
    const CRIT_ENEMIES = { attack: 2000, crit: 100, critDamage: 50 };
    const NOCRIT_ENEMIES = { attack: 2000, crit: 0, critDamage: 50 };

    it('crit-only: enemy CRIT hits on every player ship deal exactly 10% less', () => {
        const stage2 = simulateBattle({
            ...buildTeams('ATLAS_SYNDICATE', CRIT_ENEMIES),
            rounds: 2,
            playerSquadLeader: { faction: 'ATLAS_SYNDICATE', name: 'Negotiator', stage: 2 },
        });
        const stage3 = simulateBattle({
            ...buildTeams('ATLAS_SYNDICATE', CRIT_ENEMIES),
            rounds: 2,
            playerSquadLeader: { faction: 'ATLAS_SYNDICATE', name: 'Negotiator', stage: 3 },
        });
        expect(round1(stage2, 'attacker').damageTaken).toBeGreaterThan(0);
        // The debuff rides the ENEMY attackers, so BOTH player victims (leader-faction and
        // off-faction alike) take 10% smaller crits.
        expect(round1(stage3, 'attacker').damageTaken).toBeCloseTo(
            0.9 * round1(stage2, 'attacker').damageTaken
        );
        expect(round1(stage3, 'p:p2:1').damageTaken).toBeCloseTo(
            0.9 * round1(stage2, 'p:p2:1').damageTaken
        );
    });

    it('non-crit enemy hits are NOT reduced (crit-conditionality)', () => {
        const stage2 = simulateBattle({
            ...buildTeams('ATLAS_SYNDICATE', NOCRIT_ENEMIES),
            rounds: 2,
            playerSquadLeader: { faction: 'ATLAS_SYNDICATE', name: 'Negotiator', stage: 2 },
        });
        const stage3 = simulateBattle({
            ...buildTeams('ATLAS_SYNDICATE', NOCRIT_ENEMIES),
            rounds: 2,
            playerSquadLeader: { faction: 'ATLAS_SYNDICATE', name: 'Negotiator', stage: 3 },
        });
        expect(round1(stage3, 'attacker').damageTaken).toBe(round1(stage2, 'attacker').damageTaken);
    });
});

describe('simulateBattle pre-fight modifiers — starting shield (Broker III)', () => {
    it('seeds 20% of post-leader max HP as a shield pool that absorbs before HP', () => {
        // Broker: I +8% attack, II +8% Crit Power, III start shielded 20% of max HP.
        // Broker never modifies HP, so the seed is 20% of the raw 100k = 20,000 — far more
        // than one round of incoming damage (2,000 per enemy hit), so HP stays untouched.
        const stage2 = simulateBattle({
            ...buildTeams('ATLAS_SYNDICATE'),
            rounds: 2,
            playerSquadLeader: { faction: 'ATLAS_SYNDICATE', name: 'Broker', stage: 2 },
        });
        const stage3 = simulateBattle({
            ...buildTeams('ATLAS_SYNDICATE'),
            rounds: 2,
            playerSquadLeader: { faction: 'ATLAS_SYNDICATE', name: 'Broker', stage: 3 },
        });

        const shielded = round1(stage3, 'attacker');
        const unshielded = round1(stage2, 'attacker');

        // Without the seed the ATLAS ship bleeds HP round 1; with it the shield absorbs
        // the full intake and HP stays at 100%.
        expect(unshielded.hpPct).toBeLessThan(100);
        expect(shielded.hpPct).toBe(100);
        expect(shielded.incomingShieldAbsorbed).toBeGreaterThan(0);
        // End-of-round pool = the 20% seed minus what round 1 drained.
        expect(shielded.currentShieldPool).toBeCloseTo(
            0.2 * 100_000 - shielded.incomingShieldAbsorbed
        );
        // The off-faction teammate gets NO seed (faction-scoped ally effect).
        expect(round1(stage3, 'p:p2:1').currentShieldPool).toBe(0);
        expect('preFight' in stage3).toBe(false);
    });
});

describe('simulateBattle pre-fight modifiers — inertness (stat-only leader)', () => {
    it('a stat-only leader run is deep-equal to a no-leader run with the stats pre-multiplied by hand', () => {
        // Midas stage 1 = +10% HP & +10% attack on MPL allies, NO modifier effects. The F3
        // plumbing must attach nothing (hasAnyPreFightModifier false everywhere), so the run
        // is IDENTICAL to applying the same multipliers directly to the placement stats.
        const withLeader = simulateBattle({
            playerTeam: [
                placement(makeShip('p1', 'Player Front', 'MPL', FRONT), 'M4', {
                    attack: 5000,
                    hp: 100_000,
                }),
            ],
            enemyTeam: [
                placement(makeShip('e1', 'Enemy Front', 'MPL', FRONT), 'M4', {
                    attack: 2000,
                    hp: 100_000,
                }),
            ],
            rounds: 3,
            playerSquadLeader: { faction: 'MPL', name: 'Midas', stage: 1 },
        });
        const handScaled = simulateBattle({
            playerTeam: [
                placement(makeShip('p1', 'Player Front', 'MPL', FRONT), 'M4', {
                    attack: 5000 * 1.1,
                    hp: 100_000 * 1.1,
                }),
            ],
            enemyTeam: [
                placement(makeShip('e1', 'Enemy Front', 'MPL', FRONT), 'M4', {
                    attack: 2000,
                    hp: 100_000,
                }),
            ],
            rounds: 3,
        });
        expect(withLeader).toEqual(handScaled);
        expect('preFight' in withLeader).toBe(false);
    });
});
