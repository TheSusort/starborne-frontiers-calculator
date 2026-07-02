/**
 * Sub-project F, PR F5: pre-fight ship passives + Chimei charged start THROUGH
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

const makeShip = (
    id: string,
    name: string,
    over: Partial<Ship> = {}
): Ship =>
    ({
        id,
        name,
        rarity: 'legendary',
        faction: 'TERRAN_COMBINE' as FactionName,
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
    }) as Ship;

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
                    refits: Array.from({ length: refitCount }, () => ({})) as unknown as Ship['refits'],
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
