import type { Ship, AffinityName } from '../../src/types/ship';
import type { Position } from '../../src/types/encounters';
import type { BattlePlacement, BattleSimulationInput } from '../../src/utils/calculators/battleSimulator';
import { mulberry32 } from '../../src/utils/calculators/rateAccumulator';

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
 * The differential oracle's BASELINE board: the same battle the composition ran, with every ally
 * except `subject` swapped for an INERT ship — same board cell, same stat overrides, no
 * interaction kit — and the enemy roster passed through verbatim.
 *
 * WHAT THE ORACLE IS ASKING, and why two earlier designs answered a different question. The
 * question is "does this ship behave differently BECAUSE OF ITS ALLIES?", so the two arms must
 * differ in exactly one variable.
 *
 *  - `buildStandardScenario` (the original baseline) changed at least four: it swapped the allies
 *    out, swapped the opponents for three canned fillers at security 20 with fixed affinities and
 *    a fixed attack, re-pinned the subject to M4 as `playerTeam[0]`, and ran a full 30 rounds
 *    instead of ending in a wipe. Opponent variance read as ally interference. Measured: at seed
 *    300/count 100 six of its ten differentials ddmin'd to a player side of exactly ONE ship —
 *    zero allies, so ally interference was impossible by construction — and it reported one anyway.
 *  - Holding the enemies fixed but EMPTYING the player side fixed the opponent confound and broke
 *    something else: the subject lost the three bodies that were soaking incoming attacks, so it
 *    died alone where it had survived in the composition. Comparable placements fell from 161/2800
 *    to 21/2800 (seed 1000/count 700) and the calibration gate dropped to inspecting 2 of 160
 *    placements. 40 of 43 pre-change findings did not collapse — they became invisible.
 *
 * This design separates those. Holding position, stats and count fixed and varying only the ally
 * KITS means:
 *  - the subject keeps three allies soaking damage and taking turns, so it survives the baseline
 *    about as often as it survives the composition;
 *  - the contrast is "interacting allies vs non-interacting allies" rather than "allies vs none",
 *    which is what the oracle claims to measure;
 *  - the subject keeps its ARRAY INDEX, so it mints the same actor id in both arms. Focus stays
 *    focus and a walked ally stays walked, which retires the focus-vs-walked instrumentation
 *    asymmetry for this comparison, and — because the rate-gate RNG is keyed by owner id — stops
 *    the crit/landing streams re-drawing between the arms.
 *
 * The fillers inherit the REPLACED ally's `statOverrides` and cell, not their own base stats, so
 * HP, attack, defence and above all SPEED are byte-identical between the arms: same turn order,
 * same incoming-damage budget, same battle length. Only the kit (and with it affinity, faction and
 * role, which ride the `Ship`) changes. "Inert" means an empty interaction-class tag set — the same
 * premise the calibration gate already rests on. It is not a claim of zero influence: an inert ship
 * still deals damage, and a role-reading pre-combat passive on the SUBJECT (Enforcer's
 * "adjacent to a supporter") can notice that its neighbour's role changed.
 *
 * Filler selection is deterministic in `seed`: same seed, same subject and same pool always build
 * the same board, which is what keeps the oracle reproducible and its ddmin stable. Fillers are
 * distinct from each other AND from the subject, because a repeated ship on one side mints a
 * duplicate actor id and `runCombat` throws on that.
 *
 * A one-ship player side returns the composition unchanged, so the two arms are byte-identical and
 * no finding is possible. That is correct — no allies means no ally interference — and it is what
 * stops ddmin from "minimizing" a differential down to a solo player team.
 *
 * Pure: builds an input, runs nothing. The caller must run both arms under the SAME seed.
 */
export function buildInertAllyBaseline(
    playerTeam: readonly BattlePlacement[],
    subjectIndex: number,
    enemyTeam: readonly BattlePlacement[],
    inertPool: readonly Ship[],
    seed: number,
    rounds?: number
): BattleSimulationInput {
    if (enemyTeam.length === 0) {
        throw new Error('buildInertAllyBaseline: enemyTeam is empty');
    }
    if (subjectIndex < 0 || subjectIndex >= playerTeam.length) {
        throw new Error(
            `buildInertAllyBaseline: subjectIndex ${subjectIndex} is out of range for a ` +
                `${playerTeam.length}-ship player team`
        );
    }

    const subject = playerTeam[subjectIndex];
    const allySlots = playerTeam.length - 1;
    if (allySlots === 0) {
        return { playerTeam: [subject], enemyTeam: [...enemyTeam], rounds };
    }

    // Distinct-by-identity requirement: the subject's own ship is excluded too, since the engine
    // mints `p:<shipId>:<idx>` and two placements sharing a shipId on one side collide.
    const excluded = new Set<string>([subject.ship.id]);
    const usable = inertPool.filter((s) => !excluded.has(s.id));
    if (usable.length < allySlots) {
        throw new Error(
            `buildInertAllyBaseline: need ${allySlots} distinct inert filler(s) but the pool ` +
                `offers only ${usable.length} usable one(s) — a repeated ship on one side is an ` +
                'illegal board and mints duplicate actor ids'
        );
    }

    // Deterministic draw without replacement: a partial Fisher-Yates over a COPY of the usable
    // pool, driven entirely by mulberry32(seed). Same seed + same pool + same subject => same
    // board, every time. The pool order comes from the caller and must itself be stable.
    const rng = mulberry32(seed);
    const shuffled = [...usable];
    const drawn: Ship[] = [];
    for (let i = 0; i < allySlots; i++) {
        const j = i + Math.floor(rng() * (shuffled.length - i));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        drawn.push(shuffled[i]);
    }

    let nextFiller = 0;
    const baselineTeam = playerTeam.map((original, i) =>
        i === subjectIndex
            ? original
            : {
                  ship: drawn[nextFiller++],
                  position: original.position,
                  statOverrides: original.statOverrides,
              }
    );

    return { playerTeam: baselineTeam, enemyTeam: [...enemyTeam], rounds };
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
