import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type {
    BattlePlacement,
    BattleResult,
    BattleSimulationInput,
} from '../../calculators/battleSimulator';
import type { CombatLogEntryKind } from '../log/types';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { inertStandIn } from '../../../../scripts/lib/traceScenario';
import { runSeededBattle } from '../../simulator/seededRuns';
import type { AblationResult, BattleRunner } from './types';
import { canonicalPlacement } from './fixtures';
import { EXCLUDED_KINDS, lastFullAliveRound, MIN_WINDOW, oracleFingerprint } from './oracleKinds';

const ROUNDS = 20;

// Fixed placement slots, the same in all three battles, so only the player-side KITS vary.
const A_POS: Position = 'T1'; // playerTeam[0]: the focus actor
const B_POS: Position = 'T2'; // playerTeam[1]: a walked ally
const ENEMY_POS: Position = 'M2'; // the fixed neutral enemy

let neutralEnemyCache: Ship | null = null;

/** The fixed neutral opponent for all three ablation battles: Bedrock, a plain 90%-damage
 *  attacker with no charge skill and no passives (see classes.test.ts's ship-choice notes). The
 *  same opponent in every arm keeps the enemy from being a source of divergence. */
function neutralEnemy(): Ship {
    if (!neutralEnemyCache) {
        const enemy = buildTraceShip('Bedrock');
        if (!enemy) {
            throw new Error(
                'runAblation: docs/ship-skills.csv is missing from this worktree — Bedrock ' +
                    "(the fixed neutral enemy) can't be resolved. This is gitignored reference " +
                    'data expected to exist on dev machines; see CLAUDE.md.'
            );
        }
        neutralEnemyCache = enemy;
    }
    return neutralEnemyCache;
}

const board = (playerTeam: BattlePlacement[]): BattleSimulationInput => ({
    playerTeam,
    enemyTeam: [canonicalPlacement(neutralEnemy(), ENEMY_POS)],
    rounds: ROUNDS,
});

export interface AblationBoards {
    combined: BattleSimulationInput;
    /** A beside an inert stand-in for B. */
    baselineA: BattleSimulationInput;
    /** An inert stand-in for A beside B. */
    baselineB: BattleSimulationInput;
}

/**
 * The three ablation boards. Every board fields two player ships at the same array indices, so A
 * is `playerTeam[0]` and B is `playerTeam[1]` in BOTH boards each is compared on: each mints the
 * same actor id in its baseline as in the combined run, and the ownerId-keyed rate-gate RNG deals
 * it the same crit and landing stream. The stand-in carries the replaced ship's stats, affinity,
 * role and id (`inertStandIn`), so it rolls that ship's dice too and only the kit differs.
 */
export function ablationBoards(a: Ship, b: Ship, filler: Ship): AblationBoards {
    const placedA = canonicalPlacement(a, A_POS);
    const placedB = canonicalPlacement(b, B_POS);
    return {
        combined: board([placedA, placedB]),
        baselineA: board([placedA, inertStandIn(filler, placedB)]),
        baselineB: board([inertStandIn(filler, placedA), placedB]),
    };
}

function playerActorId(result: BattleResult, position: Position): string {
    const entry = result.roster.find((r) => r.side === 'player' && r.position === position);
    if (!entry) throw new Error(`runAblation: no player ship at ${position} in the roster`);
    return entry.actorId;
}

/** Kinds present in `comp` that never appear in `solo`, minus the excluded recipient-booked
 *  kinds: behaviour the actor shows ONLY beside its partner. (The reverse direction, kinds
 *  suppressed by the partner, is the differential oracle's concern.) */
export function extraKinds(
    solo: Set<CombatLogEntryKind>,
    comp: Set<CombatLogEntryKind>
): CombatLogEntryKind[] {
    return [...comp].filter((k) => !solo.has(k) && !EXCLUDED_KINDS.has(k));
}

/** Pure divergence logic: given each ship's baseline and combined fingerprints, decides whether
 *  either ship gained a kind only present beside its partner, and builds the detail string.
 *  `compared` is how many of the two ships had a comparable window. */
export function computeAblationResult(
    aName: string,
    bName: string,
    soloAKinds: Set<CombatLogEntryKind>,
    soloBKinds: Set<CombatLogEntryKind>,
    combinedAKinds: Set<CombatLogEntryKind>,
    combinedBKinds: Set<CombatLogEntryKind>,
    compared = 2
): AblationResult {
    const extraA = extraKinds(soloAKinds, combinedAKinds);
    const extraB = extraKinds(soloBKinds, combinedBKinds);

    const parts: string[] = [];
    if (extraA.length > 0) {
        parts.push(`${aName} gained kinds only present in composition: ${extraA.join(', ')}`);
    }
    if (extraB.length > 0) {
        parts.push(`${bName} gained kinds only present in composition: ${extraB.join(', ')}`);
    }

    const gained = [
        ...(extraA.length > 0 ? [{ ship: aName, kinds: extraA }] : []),
        ...(extraB.length > 0 ? [{ ship: bName, kinds: extraB }] : []),
    ];
    const diverges = parts.length > 0;
    const detail = diverges
        ? parts.join('; ')
        : `No divergence: ${aName} and ${bName} each produced only kinds already seen solo.`;

    return { diverges, detail, compared, gained };
}

/** One ship's baseline and combined fingerprints over the rounds it was alive for in both, or two
 *  empty sets when that window is shorter than `MIN_WINDOW`. */
function windowedPair(
    baseline: BattleResult,
    combined: BattleResult,
    position: Position
): { base: Set<CombatLogEntryKind>; comb: Set<CombatLogEntryKind>; compared: boolean } {
    const baseId = playerActorId(baseline, position);
    const combId = playerActorId(combined, position);
    const window = Math.min(
        lastFullAliveRound(baseline, baseId),
        lastFullAliveRound(combined, combId)
    );
    if (window < MIN_WINDOW) return { base: new Set(), comb: new Set(), compared: false };
    return {
        base: oracleFingerprint(baseline, baseId, window),
        comb: oracleFingerprint(combined, combId, window),
        compared: true,
    };
}

/** A kit of one active skill and nothing else: no charged skill, no passive. */
export const isPlainKit = (ship: Ship): boolean =>
    !ship.chargeSkillText &&
    !ship.firstPassiveSkillText &&
    !ship.secondPassiveSkillText &&
    !ship.thirdPassiveSkillText;

/**
 * The ablation stand-in: the first plain-kit pool ship (`isPlainKit`) that is neither subject nor
 * the neutral enemy.
 *
 * One stand-in serves every pair, so its kit sets the baseline arm's pace for the whole run. The
 * fight ends when the lone neutral enemy dies, and the arms are compared over the rounds both
 * lasted, so a stand-in that deals more than a plain attack (a charged skill, a damage passive,
 * a start-of-combat full charge) ends the baseline early. That shortens the compared window, drops
 * comparable runs, and turns a partner that only HASTENS a subject's kind (a bomb countdown cut
 * short) into a kind seen only beside the partner.
 */
export function ablationFiller(a: Ship, b: Ship, inertPool: readonly Ship[]): Ship {
    const enemyId = neutralEnemy().id;
    const filler = inertPool.find(
        (s) => s.id !== a.id && s.id !== b.id && s.id !== enemyId && isPlainKit(s)
    );
    if (!filler) {
        throw new Error(
            'runAblation: the inert pool has no plain-kit ship distinct from both subjects and ' +
                'the neutral enemy'
        );
    }
    return filler;
}

/**
 * Ablation/superposition oracle: runs the three `ablationBoards` under the SAME seed and checks
 * whether either ship, beside its partner, produced a kind it never produced beside an inert
 * stand-in. Fingerprints use the shared oracle kind policy (`oracleKinds.ts`): excluded kinds,
 * normalised resists, and only the rounds the ship was alive for in both runs.
 *
 * A pure function of (a, b, seed, pool). Its output is needs-triage, never a confirmed finding.
 */
export function runAblation(
    a: Ship,
    b: Ship,
    seed: number,
    inertPool: readonly Ship[],
    run: BattleRunner = runSeededBattle
): AblationResult {
    const boards = ablationBoards(a, b, ablationFiller(a, b, inertPool));
    const combined = run(boards.combined, seed);
    const pairA = windowedPair(run(boards.baselineA, seed), combined, A_POS);
    const pairB = windowedPair(run(boards.baselineB, seed), combined, B_POS);

    return computeAblationResult(
        a.name,
        b.name,
        pairA.base,
        pairB.base,
        pairA.comb,
        pairB.comb,
        Number(pairA.compared) + Number(pairB.compared)
    );
}
