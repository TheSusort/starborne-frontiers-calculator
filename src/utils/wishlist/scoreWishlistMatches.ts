import type { GearPiece } from '../../types/gear';
import type { Ship } from '../../types/ship';
import type { EngineeringStat } from '../../types/stats';
import type { WishlistEntry } from '../../types/wishlist';
import { isGearSlotName, type GearSlotName } from '../../constants/gearTypes';
import { isShipTypeName, type ShipTypeName } from '../../constants/shipTypes';
import { baselineBreakdownCache, simulateUpgrade } from '../gear/potentialCalculator';
import {
    buildPotentialContext,
    type PotentialContext,
} from '../gear/fastPotential/potentialContext';
import { scoreCurrentWithShip, scorePieceApplied } from '../gear/fastPotential/scorePieceUpgrade';

/** Simulations per piece: Upgrade Analysis' legendary count. */
export const WISHLIST_SIMULATION_COUNT = 40;

/** A role target flags a match as an upgrade when it ranks this high in its slot. */
export const ROLE_UPGRADE_RANK = 3;

export interface WishlistMatchScore {
    pieceId: string;
    nowScore: number;
    /** Mean of the simulated level-16 outcomes; equals `nowScore` for a level-16 piece. */
    potentialScore: number;
    /** Ship target: percentage change vs the equipped piece, now vs now. */
    deltaNowPct?: number;
    /** Ship target: percentage change vs the equipped piece, levelled vs levelled. */
    deltaPotentialPct?: number;
    /** Role target: 1-based rank of `potentialScore` among every owned piece in the slot. */
    potentialRank?: number;
    rankPoolSize?: number;
    bestOwnedPotentialScore?: number;
    isUpgrade: boolean;
}

/**
 * `scored`: `scores` holds one entry per scorable match. Every other status leaves the matches
 * unscored; the entry is never rewritten.
 */
export type WishlistScoreStatus = 'scored' | 'no-target' | 'ship-missing' | 'role-unknown';

export interface WishlistScoreResult {
    status: WishlistScoreStatus;
    scores: WishlistMatchScore[];
}

export interface ScoreWishlistInput {
    entry: WishlistEntry;
    /** The pieces to score: the entry's matches. */
    matches: readonly GearPiece[];
    /** Every owned gear piece. A role target ranks matches against the pieces in their slot. */
    gearInventory: readonly GearPiece[];
    ships: readonly Ship[];
    /** Resolves any owned piece id, equipped ones included. */
    getGearPiece: (id: string) => GearPiece | undefined;
    getEngineeringStatsForShipType: (shipType: ShipTypeName) => EngineeringStat | undefined;
    simulationCount?: number;
    /** One simulated upgrade to level 16. Defaults to `simulateUpgrade`. */
    simulate?: (piece: GearPiece) => GearPiece;
    /** Awaited between slots so a caller can keep the UI responsive. */
    yieldToEventLoop?: () => Promise<void>;
    /** Checked between slots; true stops scoring and returns what is done so far. */
    shouldAbort?: () => boolean;
}

const unscored = (status: WishlistScoreStatus): WishlistScoreResult => ({ status, scores: [] });

/** Percentage change of `value` against `base`; a zero base reads as 100% for any gain. */
function pctChange(value: number, base: number): number {
    if (base > 0) return ((value - base) / base) * 100;
    return value > base ? 100 : 0;
}

const defaultSimulate = (piece: GearPiece): GearPiece => simulateUpgrade(piece).piece;

export async function scoreWishlistMatches(
    input: ScoreWishlistInput
): Promise<WishlistScoreResult> {
    const { target } = input.entry;
    if (!target) return unscored('no-target');

    const matches = input.matches.filter((p) => isGearSlotName(p.slot));
    if (target.kind === 'ship') {
        const ship = input.ships.find((s) => s.id === target.shipId);
        if (!ship) return unscored('ship-missing');
        return { status: 'scored', scores: await scoreForShip(input, ship, matches) };
    }
    if (!isShipTypeName(target.role)) return unscored('role-unknown');
    return { status: 'scored', scores: await scoreForRole(input, target.role, matches) };
}

function groupBySlot(pieces: readonly GearPiece[]): Map<GearSlotName, GearPiece[]> {
    const bySlot = new Map<GearSlotName, GearPiece[]>();
    for (const piece of pieces) {
        const slot = piece.slot as GearSlotName;
        const list = bySlot.get(slot);
        if (list) list.push(piece);
        else bySlot.set(slot, [piece]);
    }
    return bySlot;
}

/** Mean score of `count` simulated level-16 outcomes; a level-16 piece is not simulated. */
function potentialOf(
    ctx: PotentialContext,
    piece: GearPiece,
    slot: GearSlotName,
    nowScore: number,
    count: number,
    simulate: (piece: GearPiece) => GearPiece
): number {
    if (piece.level >= 16 || count <= 0) return nowScore;
    let sum = 0;
    for (let i = 0; i < count; i++) sum += scorePieceApplied(ctx, simulate(piece), slot);
    return sum / count;
}

async function scoreForShip(
    input: ScoreWishlistInput,
    ship: Ship,
    matches: readonly GearPiece[]
): Promise<WishlistMatchScore[]> {
    const count = input.simulationCount ?? WISHLIST_SIMULATION_COUNT;
    const simulate = input.simulate ?? defaultSimulate;
    const bySlot = groupBySlot(matches);
    const slots = [...bySlot.keys()];

    // `baselineBreakdownCache` is keyed by ship + slot only, so an entry left by an earlier run
    // (Upgrade Analysis, or this scorer before the ship's gear changed) would be read as the
    // ship's current "minus this slot" state. Drop this ship's keys before building the context
    // and again afterwards so nothing computed here outlives the call.
    const dropShipBaselines = (): void => {
        for (const slot of slots) baselineBreakdownCache.delete(`${ship.id}_${slot}_breakdown`);
    };
    dropShipBaselines();
    try {
        const ctx = buildPotentialContext({
            inventory: matches,
            shipRole: ship.type,
            slot: undefined,
            selectedStats: [],
            ship,
            getGearPiece: input.getGearPiece,
            getEngineeringStatsForShipType: input.getEngineeringStatsForShipType,
        });

        const scores: WishlistMatchScore[] = [];
        for (const [slot, pieces] of bySlot) {
            if (input.shouldAbort?.()) break;
            await input.yieldToEventLoop?.();

            const equippedId = ship.equipment[slot];
            const equipped = equippedId ? input.getGearPiece(equippedId) : undefined;
            // The slot baseline is "ship minus this slot"; the equipped piece and every
            // candidate go through the same baseline, so set bonuses are recomputed for each.
            const nowBase = equipped
                ? scorePieceApplied(ctx, equipped, slot)
                : scoreCurrentWithShip(ctx, pieces[0], slot);
            const potentialBase = equipped
                ? potentialOf(ctx, equipped, slot, nowBase, count, simulate)
                : nowBase;

            for (const piece of pieces) {
                if (equipped && piece.id === equipped.id) {
                    scores.push({
                        pieceId: piece.id,
                        nowScore: nowBase,
                        potentialScore: potentialBase,
                        deltaNowPct: 0,
                        deltaPotentialPct: 0,
                        isUpgrade: false,
                    });
                    continue;
                }
                const nowScore = scorePieceApplied(ctx, piece, slot);
                const potentialScore = potentialOf(ctx, piece, slot, nowScore, count, simulate);
                const deltaPotentialPct = pctChange(potentialScore, potentialBase);
                scores.push({
                    pieceId: piece.id,
                    nowScore,
                    potentialScore,
                    deltaNowPct: pctChange(nowScore, nowBase),
                    deltaPotentialPct,
                    // Filling an empty slot is an upgrade whatever the piece adds.
                    isUpgrade: equipped ? deltaPotentialPct > 0 : true,
                });
            }
        }
        return scores;
    } finally {
        dropShipBaselines();
    }
}

async function scoreForRole(
    input: ScoreWishlistInput,
    role: ShipTypeName,
    matches: readonly GearPiece[]
): Promise<WishlistMatchScore[]> {
    const count = input.simulationCount ?? WISHLIST_SIMULATION_COUNT;
    const simulate = input.simulate ?? defaultSimulate;

    // Rank against every owned piece in the slot. Matches are part of the pool even when the
    // caller's inventory has not caught up with them (a fresh import).
    const pool = new Map<string, GearPiece>();
    for (const piece of input.gearInventory)
        if (isGearSlotName(piece.slot)) pool.set(piece.id, piece);
    for (const piece of matches) pool.set(piece.id, piece);
    const poolBySlot = groupBySlot([...pool.values()]);

    const ctx = buildPotentialContext({
        inventory: [...pool.values()],
        shipRole: role,
        slot: undefined,
        selectedStats: [],
        ship: undefined,
        getGearPiece: undefined,
        getEngineeringStatsForShipType: undefined,
    });

    const scores: WishlistMatchScore[] = [];
    for (const [slot, pieces] of groupBySlot(matches)) {
        if (input.shouldAbort?.()) break;
        await input.yieldToEventLoop?.();

        const slotPool = poolBySlot.get(slot) ?? pieces;
        const potentials = new Map<string, number>();
        const nows = new Map<string, number>();
        for (const piece of slotPool) {
            const now = scorePieceApplied(ctx, piece, slot);
            nows.set(piece.id, now);
            potentials.set(piece.id, potentialOf(ctx, piece, slot, now, count, simulate));
        }
        const best = Math.max(...potentials.values());

        for (const piece of pieces) {
            const potentialScore = potentials.get(piece.id) as number;
            let rank = 1;
            for (const [id, other] of potentials)
                if (id !== piece.id && other > potentialScore) rank++;
            scores.push({
                pieceId: piece.id,
                nowScore: nows.get(piece.id) as number,
                potentialScore,
                potentialRank: rank,
                rankPoolSize: slotPool.length,
                bestOwnedPotentialScore: best,
                isUpgrade: rank <= ROLE_UPGRADE_RANK,
            });
        }
    }
    return scores;
}
