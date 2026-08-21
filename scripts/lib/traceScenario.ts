import type { Ship, AffinityName } from '../../src/types/ship';
import type { Position } from '../../src/types/encounters';
import type { BattlePlacement, BattleSimulationInput } from '../../src/utils/calculators/battleSimulator';

export interface ScenarioOverrides {
    rounds?: number;
    reviewedCrit?: number;
    reviewedHpScale?: number;
    enemyAttackScale?: number;
    enemyAffinity?: AffinityName;
    includeFragileAlly?: boolean;
}

const placement = (
    ship: Ship,
    position: Position,
    over: Partial<{ hp: number; crit: number; attack: number }> = {}
): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: over.attack ?? ship.baseStats.attack,
        crit: over.crit ?? ship.baseStats.crit,
        critDamage: ship.baseStats.critDamage,
        defensePenetration: 0,
        hacking: ship.baseStats.hacking,
        security: ship.baseStats.security,
        defence: ship.baseStats.defence,
        hp: over.hp ?? ship.baseStats.hp,
        speed: ship.baseStats.speed,
    },
});

const fillerBase = (id: string, name: string, type: Ship['type'], stats: Partial<Ship['baseStats']>): Ship => ({
    id,
    name,
    rarity: 'legendary',
    faction: 'MPL',
    type,
    affinity: 'antimatter',
    baseStats: {
        hp: 260_000, attack: 1500, defence: 300, hacking: 200, security: 150,
        crit: 50, critDamage: 150, speed: 100, ...stats,
    },
    equipment: {},
    implants: {},
    refits: [],
    activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
});

// Filler ally with an on-attacked counter (a real reactive to co-exist alongside the reviewed
// ship). Enemy-targeted damage active only. (The old "NEVER an ally-heal" rule was the
// `dummyEnemyIsVestigial` gotcha — an ally-side active kept the dummy in the turn order and
// misrouted reactive resolvers. Both halves are gone: SP-M M1 Task 9b re-gated the resolvers on
// `hasPositionedEnemyRoster`, and SP-4c-2c deleted the gate and the dummy's turn. Kept as-is
// because a damage active is the simplest thing that co-exists with the reviewed ship.)
const counterAlly = (): Ship => ({
    ...fillerBase('trace-ally-counter', 'CounterAlly', 'DEFENDER', { attack: 1200, defence: 500, speed: 95 }),
    firstPassiveSkillText:
        'When this Unit is directly damaged as a primary target, it deals <unit-damage>70% damage</unit-damage> to that enemy.',
});

const plainAlly = (): Ship => fillerBase('trace-ally-plain', 'PlainAlly', 'ATTACKER', { attack: 1800, speed: 110 });

const fragileAlly = (): Ship =>
    fillerBase('trace-ally-fragile', 'FragileAlly', 'ATTACKER', { hp: 40_000, defence: 100, speed: 105 });

// Audit-calibration: the enemies carry LOW security (20) so the reviewed ship's hacking-based
// debuffs/DoTs actually LAND and can be observed. The whole corpus has BASE hacking 64–122
// (median ~87, no gear in this synthetic scenario), and landing chance = clamp(hacking − security,
// 0, 100)/100 — so the old fillerBase security (150, above every ship's hacking) gave a CATEGORICAL
// 0% landing for every hacking-based effect: every DoT/debuff ship looked broken (e.g. Demolisher's
// Bomb III "never applied" was purely this, not an engine bug). At security 20 a median ship lands
// ~67% and the lowest-hacking ship ~44% — enough to reliably surface the ability over 30 rounds
// while still leaving a realistic resist tail. This is an OBSERVABILITY concession, not a realism
// claim; resist behaviour has its own dedicated unit tests (dynamicLanding / anchorDebuffLanding).
// DO NOT raise this back toward ship-hacking magnitude without re-checking the DoT/debuff findings.
const ENEMY_SECURITY = 20;

const enemyAttacker = (id: string, name: string, affinity: AffinityName, attack: number): Ship => ({
    ...fillerBase(id, name, 'ATTACKER', { attack, hp: 240_000, speed: 100, security: ENEMY_SECURITY }),
    affinity,
});

const enemyDebuffer = (id: string, name: string, attack: number): Ship => ({
    ...fillerBase(id, name, 'ATTACKER', {
        attack,
        hp: 240_000,
        speed: 105,
        hacking: 260,
        security: ENEMY_SECURITY,
    }),
    activeSkillText:
        'This Unit deals <unit-damage>100% damage</unit-damage> and inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns.',
});

/**
 * The differential oracle's SOLO baseline: `subject` ALONE on the player side, facing the
 * caller's OWN enemy roster verbatim.
 *
 * Why this exists (and why the canned `buildStandardScenario` is wrong for it): the differential
 * oracle asks "does this ship behave differently when it has ALLIES?". Answering that requires
 * the two arms to differ in exactly one variable — the allies. Baselining against
 * `buildStandardScenario` changed TWO: it swapped the allies out AND swapped the opponents
 * (three canned fillers at security 20, fixed affinities, fixed attack) for the composition's
 * real random-corpus enemies. Opponent variance then reads as ally interference. That confound
 * produced real false positives: at seed 335 a Makoli differential whose own ddmin had reduced
 * the composition to `player:[Makoli]` — literally zero allies, so ally interference was
 * impossible by construction — still reported `missing:[cleanse]` against the canned baseline.
 * Re-run against the composition's own enemies, the same case collapses to no diff at all.
 *
 * Consequences worth knowing before using this:
 *  - The subject keeps its composition POSITION and `statOverrides` (the placement is passed
 *    through unchanged), so the only board difference is the absent allies.
 *  - The subject becomes `playerTeam[0]`, i.e. the engine's reserved focus id `'attacker'`. It
 *    was already the focus under `buildStandardScenario`, so this does NOT change (or fix) the
 *    focus-vs-walked instrumentation asymmetry — that stays a separate problem handled by the
 *    caller's excluded-kind restriction.
 *  - Alone against four real enemies, a fragile subject dies where it survived in the
 *    composition. That is a genuine loss of comparable placements, not a bug here; the caller's
 *    survived-the-whole-battle guard is what drops those.
 *
 * Pure: builds an input, runs nothing. The caller must run both arms under the SAME seed.
 */
export function buildSameEnemyBaseline(
    subject: BattlePlacement,
    enemyTeam: BattlePlacement[],
    rounds?: number
): BattleSimulationInput {
    if (enemyTeam.length === 0) {
        throw new Error('buildSameEnemyBaseline: enemyTeam is empty');
    }
    return { playerTeam: [subject], enemyTeam: [...enemyTeam], rounds };
}

export function buildStandardScenario(reviewed: Ship, overrides: ScenarioOverrides = {}): BattleSimulationInput {
    const hpScale = overrides.reviewedHpScale ?? 1;
    const atkScale = overrides.enemyAttackScale ?? 1;
    const enemyAff = overrides.enemyAffinity ?? 'chemical';

    const playerTeam: BattlePlacement[] = [
        placement(reviewed, 'M4', {
            hp: Math.round(reviewed.baseStats.hp * hpScale),
            crit: overrides.reviewedCrit ?? reviewed.baseStats.crit,
        }),
        placement(plainAlly(), 'M1'),
        placement(counterAlly(), 'B4'),
    ];
    if (overrides.includeFragileAlly) playerTeam.push(placement(fragileAlly(), 'B1'));

    const enemyTeam: BattlePlacement[] = [
        placement(enemyAttacker('trace-e-1', 'EnemyA', enemyAff, Math.round(1600 * atkScale)), 'T1'),
        placement(enemyDebuffer('trace-e-2', 'EnemyB', Math.round(1600 * atkScale)), 'M2'),
        placement(enemyAttacker('trace-e-3', 'EnemyC', 'electric', Math.round(1500 * atkScale)), 'B2'),
    ];

    return { playerTeam, enemyTeam, rounds: overrides.rounds ?? 30 };
}
