import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { BattleResult, BattleSimulationInput } from '../../calculators/battleSimulator';
import type { CombatLogEntryKind } from '../log/types';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import type { AblationResult } from './types';
import { canonicalPlacement } from './fixtures';
import { runSeededBattle } from './seededBattle';
import { fingerprintActor } from './fingerprint';

const ROUNDS = 20;

// Fixed placement slots — the same three slots across all three battles so only the
// player-side composition (A alone / B alone / A+B) varies.
const FOCUS_POS: Position = 'T1'; // A (solo) or A-as-focus (combined)
const ALLY_POS: Position = 'T2'; // B-as-ally (combined only)
const ENEMY_POS: Position = 'M2'; // the fixed neutral enemy, all three battles

let neutralEnemyCache: Ship | null = null;

/** The fixed neutral opponent for all three ablation battles: Bedrock, a plain 90%-damage
 *  attacker with no charge skill and no passives (confirmed in docs/ship-skills.csv — see
 *  classes.test.ts's ship-choice notes: "a plain attacker with no interaction primitives at
 *  all"). Using the SAME opponent across {A}, {B}, {A,B} keeps the enemy from being a source
 *  of the observed divergence — the only variable across the three battles is the player side. */
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

function battleFor(playerTeam: Ship[]): BattleSimulationInput {
    const positions: Position[] = [FOCUS_POS, ALLY_POS];
    return {
        playerTeam: playerTeam.map((ship, i) => canonicalPlacement(ship, positions[i])),
        enemyTeam: [canonicalPlacement(neutralEnemy(), ENEMY_POS)],
        rounds: ROUNDS,
    };
}

/** Resolve a placed ship's actorId in an already-run result via its roster — NEVER assume
 *  the reserved `'attacker'` id, since that's only guaranteed for playerTeam[0]. Matches by
 *  ship name + the exact slot it was placed in, both of which are under our control here. */
function resolveActorId(result: BattleResult, shipName: string, position: Position): string {
    const entry = result.roster.find((r) => r.name === shipName && r.position === position);
    if (!entry) {
        throw new Error(
            `runAblation: could not resolve actorId for "${shipName}"@${position} in the roster`
        );
    }
    return entry.actorId;
}

/** Kinds present in `comp` that never appear in `solo` — i.e. behavior the actor does ONLY
 *  in composition. This is the ablation oracle's divergence signal (the reverse direction,
 *  kinds suppressed in composition, is the differential oracle's concern, not this one's). */
function extraKinds(
    solo: Set<CombatLogEntryKind>,
    comp: Set<CombatLogEntryKind>
): CombatLogEntryKind[] {
    return [...comp].filter((k) => !solo.has(k));
}

/**
 * Ablation/superposition oracle: runs `{A}`, `{B}`, and `{A,B}` (A as player focus, B as
 * player ally, all vs the SAME fixed neutral enemy) under the SAME seed via `runSeededBattle`,
 * then checks whether either ship's combined-run fingerprint contains ability-kinds absent
 * from its own solo-run fingerprint.
 *
 * This is the NOISIEST oracle: the engine's RNG stream is keyed by ownerId, so a ship drawing
 * a different crit sequence as focus (`'attacker'`) vs as ally (`p:<id>:<idx>`) can trigger a
 * crit-gated ability in one run and not the other WITHOUT any real interaction between A and
 * B. That is expected, not a bug in this oracle — `diverges` is a signal for the needs-triage
 * bucket (Task 9/10), never a confirmed Finding on its own.
 */
export function runAblation(a: Ship, b: Ship, seed: number): AblationResult {
    const soloAResult = runSeededBattle(battleFor([a]), seed);
    const soloBResult = runSeededBattle(battleFor([b]), seed);
    const combinedResult = runSeededBattle(battleFor([a, b]), seed);

    const soloAId = resolveActorId(soloAResult, a.name, FOCUS_POS);
    const soloBId = resolveActorId(soloBResult, b.name, FOCUS_POS);
    const combinedAId = resolveActorId(combinedResult, a.name, FOCUS_POS);
    const combinedBId = resolveActorId(combinedResult, b.name, ALLY_POS);

    const soloAKinds = fingerprintActor(soloAResult, soloAId);
    const soloBKinds = fingerprintActor(soloBResult, soloBId);
    const combinedAKinds = fingerprintActor(combinedResult, combinedAId);
    const combinedBKinds = fingerprintActor(combinedResult, combinedBId);

    const extraA = extraKinds(soloAKinds, combinedAKinds);
    const extraB = extraKinds(soloBKinds, combinedBKinds);

    const parts: string[] = [];
    if (extraA.length > 0) {
        parts.push(`${a.name} gained kinds only present in composition: ${extraA.join(', ')}`);
    }
    if (extraB.length > 0) {
        parts.push(`${b.name} gained kinds only present in composition: ${extraB.join(', ')}`);
    }

    const diverges = parts.length > 0;
    const detail = diverges
        ? parts.join('; ')
        : `No divergence: ${a.name} and ${b.name} each produced only kinds already seen solo.`;

    return { diverges, detail };
}
