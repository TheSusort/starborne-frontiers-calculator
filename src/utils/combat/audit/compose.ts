import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { BattleSimulationInput } from '../../calculators/battleSimulator';
import { mulberry32 } from '../../calculators/rateAccumulator';
import { canonicalPlacement } from './fixtures';
import type { InteractionClass } from './types';

export interface TaggedShip {
    ship: Ship;
    classes: Set<InteractionClass>;
}

const ALL_POSITIONS: Position[] = [
    'T1',
    'T2',
    'T3',
    'T4',
    'M1',
    'M2',
    'M3',
    'M4',
    'B1',
    'B2',
    'B3',
    'B4',
];

const ALL_CLASSES: InteractionClass[] = [
    'leader-aura',
    'reactive-trigger',
    'persistent-stacking',
    'detonation-bomb',
    'protection-redirect',
    'cleanse-purge',
    'control',
    'shield',
    'stealth',
];

/** Mechanically-adjacent classes for BIAS purposes only — a deliberately simple heuristic
 *  (not a game-design claim) so the decaying bias in composeBattle() has somewhere to fall
 *  before reverting fully to the general pool. Each entry lists the classes whose ships are
 *  drawn at reduced-but-nonzero weight once a primary class is picked, chosen because those
 *  pairs are the ones most likely to interact in combat (e.g. reactive-trigger listens for
 *  almost every other primitive firing; cleanse-purge removes persistent-stacking debuffs). */
const ADJACENT_CLASSES: Record<InteractionClass, InteractionClass[]> = {
    'leader-aura': ['persistent-stacking', 'reactive-trigger'],
    'reactive-trigger': ['control', 'persistent-stacking', 'detonation-bomb'],
    'persistent-stacking': ['reactive-trigger', 'cleanse-purge', 'detonation-bomb'],
    'detonation-bomb': ['persistent-stacking', 'reactive-trigger'],
    'protection-redirect': ['shield', 'reactive-trigger'],
    'cleanse-purge': ['persistent-stacking', 'control'],
    control: ['reactive-trigger', 'stealth', 'cleanse-purge'],
    shield: ['protection-redirect', 'reactive-trigger'],
    stealth: ['control', 'reactive-trigger'],
};

/** Bias-strength decay applied per successive slot draw after the primary ship: the 2nd
 *  ship overall (i=0) draws most strongly toward the primary/adjacent pools; by the 7th
 *  successive draw the bias has decayed close to zero and the draw is effectively uniform
 *  over the whole corpus. */
const DECAY = 0.75;
const BASE_PRIMARY_WEIGHT = 0.5;
const BASE_ADJACENT_WEIGHT = 0.3;

function poolForClass(tagged: TaggedShip[], cls: InteractionClass): TaggedShip[] {
    return tagged.filter((t) => t.classes.has(cls));
}

function poolForClasses(tagged: TaggedShip[], classes: InteractionClass[]): TaggedShip[] {
    return tagged.filter((t) => classes.some((c) => t.classes.has(c)));
}

function pickFrom(rng: () => number, pool: TaggedShip[]): TaggedShip {
    return pool[Math.floor(rng() * pool.length)];
}

/** Draws one ship for slot index `i` (0-indexed among the 7 non-primary slots), biased
 *  toward `primaryPool`, then `adjacentPool`, decaying with `i`, falling back to `anyPool`
 *  (the whole corpus) whenever the biased pool is empty or the roll misses both biased
 *  bands. Guarantees a ship is always returned as long as `anyPool` is non-empty. */
function drawBiasedShip(
    rng: () => number,
    i: number,
    primaryPool: TaggedShip[],
    adjacentPool: TaggedShip[],
    anyPool: TaggedShip[]
): TaggedShip {
    const decay = DECAY ** i;
    const primaryWeight = BASE_PRIMARY_WEIGHT * decay;
    const adjacentWeight = BASE_ADJACENT_WEIGHT * decay;
    const roll = rng();

    if (roll < primaryWeight && primaryPool.length > 0) return pickFrom(rng, primaryPool);
    if (roll < primaryWeight + adjacentWeight && adjacentPool.length > 0) {
        return pickFrom(rng, adjacentPool);
    }
    return pickFrom(rng, anyPool);
}

/** Draws 4 distinct positions (of the 12 board slots) via a partial Fisher-Yates shuffle
 *  driven entirely by `rng`, so it consumes exactly 4 rng() calls per invocation. */
function drawDistinctPositions(rng: () => number): Position[] {
    const pool = [...ALL_POSITIONS];
    const picked: Position[] = [];
    for (let i = 0; i < 4; i++) {
        const j = i + Math.floor(rng() * (pool.length - i));
        [pool[i], pool[j]] = [pool[j], pool[i]];
        picked.push(pool[i]);
    }
    return picked;
}

/** Generates a legal 4v4 `BattleSimulationInput` from the tagged corpus, deterministically
 *  from `seed`, biased toward interaction-dense compositions:
 *
 *  1. Pick one interaction class actually present in the corpus as the "primary" class.
 *  2. Draw the first ship from the primary class's pool.
 *  3. Fill the remaining 7 slots with decaying bias toward the primary/adjacent classes
 *     (see `ADJACENT_CLASSES` / `drawBiasedShip`), falling back to the whole corpus so all
 *     8 slots always fill even if a class's pool is thin.
 *  4. Split the 8 drawn ships 4/4 into playerTeam/enemyTeam, each placed at 4 DISTINCT
 *     positions drawn from the 12 board slots. Ships MAY repeat across the two sides (the
 *     same ship's Set entries are independent Ship objects/positions) but never within one
 *     side's own 4 positions, since positions are drawn distinct per side.
 *
 *  Pure: all randomness flows through the single `mulberry32(seed)` stream (no Math.random,
 *  no Date.now) — same seed + corpus produces a byte-identical `BattleSimulationInput`. Does
 *  no filesystem/network I/O itself; the caller is responsible for loading/tagging the corpus
 *  (e.g. via buildTraceShip + tagShip) before calling this. */
export function composeBattle(seed: number, tagged: TaggedShip[]): BattleSimulationInput {
    if (tagged.length === 0) {
        throw new Error('composeBattle requires a non-empty tagged corpus');
    }
    const rng = mulberry32(seed);

    const presentClasses = ALL_CLASSES.filter((c) => poolForClass(tagged, c).length > 0);
    const primary =
        presentClasses.length > 0
            ? presentClasses[Math.floor(rng() * presentClasses.length)]
            : null;

    const primaryPool = primary ? poolForClass(tagged, primary) : [];
    const adjacentPool = primary ? poolForClasses(tagged, ADJACENT_CLASSES[primary]) : [];

    const drawn: TaggedShip[] = [];
    drawn.push(primaryPool.length > 0 ? pickFrom(rng, primaryPool) : pickFrom(rng, tagged));
    for (let i = 0; i < 7; i++) {
        drawn.push(drawBiasedShip(rng, i, primaryPool, adjacentPool, tagged));
    }

    const playerPositions = drawDistinctPositions(rng);
    const enemyPositions = drawDistinctPositions(rng);

    const playerTeam = drawn
        .slice(0, 4)
        .map((t, i) => canonicalPlacement(t.ship, playerPositions[i]));
    const enemyTeam = drawn
        .slice(4, 8)
        .map((t, i) => canonicalPlacement(t.ship, enemyPositions[i]));

    return { playerTeam, enemyTeam };
}
