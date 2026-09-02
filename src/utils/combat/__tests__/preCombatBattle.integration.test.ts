/**
 * Pre-fight ship passives + Chimei charged start THROUGH
 * `simulateBattle` (positioned squads → runCombat → BattleResult).
 *
 * Fixture style copied from calculators/__tests__/battleSimulatorSquadLeaders.test.ts
 * (minimal Ship factory + statOverrides placements), extended with passive/charge skill
 * texts and refits so the REAL parse→build→pre-fight→engine pipeline is exercised.
 *
 * Board geometry: M3 ↔ M2, M4, T2, T3, B2, B3 (hex adjacency) — B1 is NOT adjacent to M3.
 * Enemy 'front' targeting hits the front-most (highest-column) living player ship.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setRateGateRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { simulateBattle, BattlePlacement, BattleResult } from '../../calculators/battleSimulator';
import type { Ship } from '../../../types/ship';
import type { FactionName } from '../../../constants/factions';
import type { Position } from '../../../types/encounters';

// Deterministic rate gates so paired runs are comparable via toEqual (crit is 0 across
// the fixtures, but pinning the RNG keeps the deep-equality tests airtight).
beforeEach(() => setRateGateRng(() => 0.999999));
afterEach(() => resetRateGateRng());

const LIONHEART_TEXT =
    'At the start of combat, this Unit grants all adjacent allies 10% of its HP.';
const ENFORCER_TEXT =
    'At the start of combat this Unit gains +15% crit rate and +10% hacking if adjacent to a supporter.';
const FULLY_CHARGED_TEXT = 'This Unit starts combat fully charged.';

const makeShip = (id: string, name: string, over: Partial<Ship> = {}): Ship => ({
    id,
    name,
    rarity: 'legendary',
    faction: 'TERRAN_COMBINE',
    type: 'ATTACKER',
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
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
    ...over,
});

const placement = (
    ship: Ship,
    position: Position,
    attack: number,
    hp: number
): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 200,
        defence: 0,
        hp,
    },
});

const enemyTeam = (attack = 2000): BattlePlacement[] => [
    placement(makeShip('e1', 'Enemy Front'), 'M4', attack, 500_000),
    placement(makeShip('e2', 'Enemy Back'), 'M1', attack, 500_000),
];

const shipRow = (result: BattleResult, round: number, actorId: string) => {
    const row = result.rounds[round - 1]?.ships.find((s) => s.actorId === actorId);
    if (!row) throw new Error(`no round-${round} row for ${actorId}`);
    return row;
};

/** maxHp implied by a round row: cumulative HP loss (no heals in these fixtures) against
 *  the reported end-of-round hpPct. Valid only while hpPct < 100 and > 0. */
const impliedMaxHp = (cumulativeHpLoss: number, hpPct: number): number =>
    cumulativeHpLoss / (1 - hpPct / 100);

const NEIGHBOUR_ID = 'p:nb:1';
const LION_HP = 40_000;
const NEIGHBOUR_HP = 100_000;

/** Player squad: Lionheart-real-text focus at M3, neighbour at M4 (adjacent), far ship
 *  at B1 (NOT adjacent to M3). `lionPassive` toggles the pre-combat passive on/off. */
const lionheartTeams = (opts: { lionPassive: boolean; lionFaction?: FactionName }) => ({
    playerTeam: [
        placement(
            makeShip('lion', 'Lionheart', {
                faction: opts.lionFaction ?? 'TERRAN_COMBINE',
                ...(opts.lionPassive ? { firstPassiveSkillText: LIONHEART_TEXT } : {}),
            }),
            'M3',
            5000,
            LION_HP
        ),
        placement(makeShip('nb', 'Neighbour'), 'M4', 4000, NEIGHBOUR_HP),
        placement(makeShip('far', 'Far Ship'), 'B1', 3000, NEIGHBOUR_HP),
    ],
    enemyTeam: enemyTeam(),
});

describe('simulateBattle pre-fight ship passives — Lionheart adjacency grant', () => {
    it("the adjacent neighbour's maxHp reflects +10% of Lionheart's hp; the non-adjacent ship is unchanged", () => {
        const baseline = simulateBattle({ ...lionheartTeams({ lionPassive: false }), rounds: 1 });
        const granted = simulateBattle({ ...lionheartTeams({ lionPassive: true }), rounds: 1 });

        // Both enemies target 'front' → the M4 neighbour takes identical round-1 damage.
        const nbBase = shipRow(baseline, 1, NEIGHBOUR_ID);
        const nbGranted = shipRow(granted, 1, NEIGHBOUR_ID);
        expect(nbBase.damageTaken).toBeGreaterThan(0);
        expect(nbGranted.damageTaken).toBe(nbBase.damageTaken);

        // Same damage against a larger maxHp → higher hpPct; the implied maxHp is exactly
        // the base hp + 10% of Lionheart's hp.
        expect(nbGranted.hpPct).toBeGreaterThan(nbBase.hpPct);
        expect(impliedMaxHp(nbGranted.incomingDamage, nbGranted.hpPct)).toBeCloseTo(
            NEIGHBOUR_HP + 0.1 * LION_HP,
            3
        );
        expect(impliedMaxHp(nbBase.incomingDamage, nbBase.hpPct)).toBeCloseTo(NEIGHBOUR_HP, 3);

        // The non-adjacent ship's round is byte-identical (grant reached only the neighbour).
        expect(shipRow(granted, 1, 'p:far:2')).toEqual(shipRow(baseline, 1, 'p:far:2'));
        // Lionheart itself keeps its own hp (donor unchanged).
        expect(shipRow(granted, 1, 'attacker').hpPct).toBe(shipRow(baseline, 1, 'attacker').hpPct);
    });

    it('ordering rule: a squad leader boosting Lionheart is applied FIRST — the grant reads post-leader hp', () => {
        // Midas (MPL, legendary) stage I: +10% HP & +10% Attack to MPL allies. Lionheart is
        // the only MPL ship → its post-leader hp = LION_HP × 1.1, and the neighbour's grant
        // must be 10% of THAT (leaders-first), not of the raw LION_HP.
        const withLeader = simulateBattle({
            ...lionheartTeams({ lionPassive: true, lionFaction: 'MPL' }),
            rounds: 1,
            playerSquadLeader: { faction: 'MPL', name: 'Midas', stage: 1 },
        });
        const nb = shipRow(withLeader, 1, NEIGHBOUR_ID);
        expect(nb.damageTaken).toBeGreaterThan(0);
        expect(impliedMaxHp(nb.incomingDamage, nb.hpPct)).toBeCloseTo(
            NEIGHBOUR_HP + 0.1 * (LION_HP * 1.1),
            3
        );
    });

    it('the grant survives the donor’s death (permanent, never reset)', () => {
        // Lionheart up FRONT (M4) with tiny hp → both enemies kill it in round 1. The
        // neighbour (M3) keeps fighting; its hp accounting in later rounds still reflects
        // the granted maxHp — there is no death-reset path for pre-fight grants.
        const teams = {
            playerTeam: [
                placement(
                    makeShip('lion', 'Lionheart', { firstPassiveSkillText: LIONHEART_TEXT }),
                    'M4',
                    5000,
                    3000 // dies to the first 2000-attack hit pair
                ),
                placement(makeShip('nb', 'Neighbour'), 'M3', 4000, NEIGHBOUR_HP),
            ],
            enemyTeam: enemyTeam(),
        };
        const result = simulateBattle({ ...teams, rounds: 3 });

        // Donor died.
        expect(shipRow(result, 1, 'attacker').alive).toBe(false);

        // After the donor's death the neighbour becomes the front target and takes damage;
        // its implied maxHp STILL includes the 10%-of-donor grant (10% of 3000 = 300).
        const nbRound3 = shipRow(result, 3, NEIGHBOUR_ID);
        const cumulativeLoss = [1, 2, 3].reduce(
            (sum, r) => sum + shipRow(result, r, NEIGHBOUR_ID).incomingDamage,
            0
        );
        expect(cumulativeLoss).toBeGreaterThan(0);
        expect(impliedMaxHp(cumulativeLoss, nbRound3.hpPct)).toBeCloseTo(
            NEIGHBOUR_HP + 0.1 * 3000,
            3
        );
    });
});

describe('simulateBattle Chimei charged start ("starts combat fully charged")', () => {
    /** Chimei-shaped focus: charged skill 400% (cap 2), active 100%, the fully-charged
     *  passive on the R2 tier — active only when the ship has ≥ 2 refits. */
    const chimeiTeams = (refitCount: number) => ({
        playerTeam: [
            placement(
                makeShip('chimei', 'Chimei', {
                    chargeSkillText: 'This Unit deals <unit-damage>400% damage</unit-damage>.',
                    chargeSkillCharge: 2,
                    secondPassiveSkillText: FULLY_CHARGED_TEXT,
                    refits: Array.from(
                        { length: refitCount },
                        () => ({})
                    ) as unknown as Ship['refits'],
                }),
                'M4',
                5000,
                200_000
            ),
        ],
        enemyTeam: enemyTeam(1000),
    });

    it('with refits ≥ 2 the charged skill fires round 1 (4× the active-only round-1 damage)', () => {
        const charged = simulateBattle({ ...chimeiTeams(2), rounds: 1 });
        const uncharged = simulateBattle({ ...chimeiTeams(0), rounds: 1 });

        const chargedDmg = shipRow(charged, 1, 'attacker').damageDealt;
        const unchargedDmg = shipRow(uncharged, 1, 'attacker').damageDealt;
        expect(unchargedDmg).toBeGreaterThan(0);
        // Charged 400% vs active 100% — the round-1 charged cast is exactly 4×.
        expect(chargedDmg).toBeCloseTo(4 * unchargedDmg, 6);
    });

    it('below the refit threshold the passive row is inactive → starts uncharged (identical to no-passive)', () => {
        const belowThreshold = simulateBattle({ ...chimeiTeams(0), rounds: 2 });
        const noPassiveTeams = chimeiTeams(0);
        noPassiveTeams.playerTeam[0].ship.secondPassiveSkillText = undefined;
        const noPassive = simulateBattle({ ...noPassiveTeams, rounds: 2 });
        expect(belowThreshold).toEqual(noPassive);
    });
});

describe('simulateBattle pre-fight ship passives — non-regression (no-op proof)', () => {
    it('an ungated role-conditional passive (no supporter adjacent) is deep-equal to no passive at all', () => {
        const build = (withPassive: boolean) => ({
            playerTeam: [
                placement(
                    makeShip('enf', 'Enforcer', {
                        type: 'ATTACKER',
                        ...(withPassive ? { firstPassiveSkillText: ENFORCER_TEXT } : {}),
                    }),
                    'M4',
                    5000,
                    100_000
                ),
                // Adjacent ally is an ATTACKER — the SUPPORTER gate stays unmet.
                placement(makeShip('nb', 'Neighbour'), 'M3', 4000, 100_000),
            ],
            enemyTeam: enemyTeam(),
        });
        const withGatedPassive = simulateBattle({ ...build(true), rounds: 2 });
        const without = simulateBattle({ ...build(false), rounds: 2 });
        expect(withGatedPassive).toEqual(without);
    });

    it('a squad with no pre-combat passives and no charged-start text is unaffected end-to-end', () => {
        const teams = lionheartTeams({ lionPassive: false });
        const a = simulateBattle({ ...teams, rounds: 2 });
        const b = simulateBattle({ ...lionheartTeams({ lionPassive: false }), rounds: 2 });
        expect(a).toEqual(b);
        expect('preFight' in a).toBe(false);
    });
});

// ─── Epic PR4: start-of-combat one-time SHIELD grant (Crucialis/FrontLine) ──────────────────
//
// "This Unit gains Shield equal to 25% of its Max HP at the start of combat" (FrontLine's real
// corpus clause, docs/ship-skills.csv) is parsed `type:'shield', trigger:'pre-combat'` and
// seeded ONCE by `seedPreCombatShields` (engine.ts, round 1 before any turn) — distinct from the
// text-regex `applyPreCombatShipPassives` seam that the Lionheart/Enforcer tests above exercise
// (that seam has no shield handling at all; this is the ability-model pre-combat/pre-fight seam,
// sub-project F). Proves TWO things through the real parse → build → engine pipeline:
//   1. the pool exists BEFORE round 1's first hit (it absorbs damage in round 1 itself);
//   2. it is granted EXACTLY ONCE — once drained, later rounds do NOT re-seed it even though the
//      focus casts a skill every round (the bug this PR fixes: on-cast would re-grant the full
//      25%-of-maxHP pool on every cast, making the ship effectively unkillable by anything that
//      doesn't out-damage the shield in a single hit).
describe('simulateBattle pre-combat SHIELD grant — FrontLine "at the start of combat" shield', () => {
    const FRONTLINE_SHIELD_TEXT =
        'This Unit gains <unit-damage>Shield equal to 25%</unit-damage> of its Max HP at the start of combat.';
    const FOCUS_HP = 100_000;
    const HIT = 8_000; // enemy attack × 100% active skill, defence 0 → exactly 8,000 HP dmg/hit

    /** Single focus (M4, front) vs a single enemy (M4-mirrored) dealing a fixed HIT/round. */
    const shieldTeams = (opts: { shieldPassive: boolean }) => ({
        playerTeam: [
            placement(
                makeShip('front', 'FrontLine', {
                    ...(opts.shieldPassive ? { firstPassiveSkillText: FRONTLINE_SHIELD_TEXT } : {}),
                }),
                'M4',
                0, // the focus never damages the enemy — irrelevant to this test
                FOCUS_HP
            ),
        ],
        enemyTeam: [placement(makeShip('e1', 'Enemy Front'), 'M4', HIT, 500_000)],
    });

    // NOTE on RED status: this round-1 case is a CHARACTERIZATION test, not a regression test —
    // it passes both before and after the trigger fix. At equal speed the focus's own turn (which
    // is where an on-cast grant would have applied too) resolves BEFORE the enemy's turn within
    // round 1, so a buggy on-cast grant would coincidentally protect round 1 exactly the same way
    // a correct pre-fight seed does. The behavior that ACTUALLY distinguishes pre-fight-once from
    // on-cast-every-turn is proven by the next test (the pool is never re-granted after it drains).
    it('round 1: the shield is already active before the first hit lands', () => {
        const baseline = simulateBattle({ ...shieldTeams({ shieldPassive: false }), rounds: 1 });
        const shielded = simulateBattle({ ...shieldTeams({ shieldPassive: true }), rounds: 1 });

        const base1 = shipRow(baseline, 1, 'attacker');
        const shield1 = shipRow(shielded, 1, 'attacker');

        // No shield: the full hit lands on HP.
        expect(base1.damageTaken).toBe(HIT);
        expect(base1.currentShieldPool).toBe(0);

        // With the pre-combat shield: 25,000 seeded before round 1 absorbs the 8,000 hit
        // entirely — HP takes NO damage, and the remaining pool reflects the deduction.
        expect(shield1.incomingShieldAbsorbed).toBe(HIT);
        expect(shield1.currentShieldPool).toBe(0.25 * FOCUS_HP - HIT);
        expect(shield1.hpPct).toBe(100);
    });

    it('the pool is granted EXACTLY ONCE: after it drains, later rounds take full damage again (no re-grant on cast)', () => {
        // 25,000 / 8,000 per round drains after 4 hits (3 full absorbs + 1 partial): rounds
        // 1-3 fully absorbed (24,000 of 25,000), round 4 absorbs the last 1,000 and lets 7,000
        // through, round 5 the pool is EMPTY and — if the passive still re-granted on every
        // cast (the bug) — round 5 would show ANOTHER full/partial absorption. It does not.
        const result = simulateBattle({ ...shieldTeams({ shieldPassive: true }), rounds: 5 });
        const round = (r: number) => shipRow(result, r, 'attacker');

        expect(round(1).currentShieldPool).toBe(25_000 - HIT); // 17,000
        expect(round(2).currentShieldPool).toBe(25_000 - 2 * HIT); // 9,000
        expect(round(3).currentShieldPool).toBe(25_000 - 3 * HIT); // 1,000
        expect(round(4).currentShieldPool).toBe(0); // last 1,000 absorbed, pool exhausted
        expect(round(4).incomingShieldAbsorbed).toBe(1_000);
        // `damageTaken` is the GROSS per-victim hit (pre-shield, always HIT here); `incomingDamage`
        // is the NET HP damage that actually landed after shield mitigation — 7,000 spills through.
        expect(round(4).damageTaken).toBe(HIT);
        expect(round(4).incomingDamage).toBe(HIT - 1_000);

        // Round 5: NO re-grant. The pool stays at 0 and the full hit lands on HP net, even
        // though the focus has cast a skill every round so far (4 casts) — proving the grant
        // is a one-time pre-fight seed, not an on-cast re-application.
        expect(round(5).currentShieldPool).toBe(0);
        expect(round(5).incomingShieldAbsorbed).toBe(0);
        expect(round(5).incomingDamage).toBe(HIT);
    });
});
