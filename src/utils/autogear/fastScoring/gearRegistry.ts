import type { GearPiece } from '../../../types/gear';
import type { GearSlotName } from '../../../constants';
import type { BaseStats, Stat } from '../../../types/stats';
import { PERCENTAGE_ONLY_STATS } from '../../../types/stats';
import { getCalibratedMainStat, isCalibrationEligible } from '../../gear/calibrationUtils';
import { STAT_INDEX, STAT_COUNT, createStatVector, type StatVector } from './statVector';

export interface GearRegistry {
    /** piece.id (string) -> integer id in [0, N) */
    readonly idOf: Map<string, number>;
    /** int id -> original piece reference */
    readonly pieces: readonly GearPiece[];
    /** flat buffer: N * STAT_COUNT. Piece `i`'s vector is [i*STAT_COUNT, (i+1)*STAT_COUNT). */
    readonly statBuffer: Float64Array;
    /** int id -> integer set bonus id, 0 = none */
    readonly setIds: Uint8Array;
    /** int id -> slot id (0..slotCount-1) */
    readonly slotIds: Uint8Array;
    /** set name -> integer set id (1-indexed; 0 reserved for "none") */
    readonly setNameToId: Map<string, number>;
    /** integer set id -> set name */
    readonly setIdToName: readonly string[];
    /** slot name -> integer slot id */
    readonly slotNameToId: Map<GearSlotName, number>;
    /** integer slot id -> slot name */
    readonly slotIdToName: readonly GearSlotName[];
}

/**
 * Build a registry for the pre-filtered inventory of a single run. Piece stats
 * (main + sub, NOT counting set bonuses — those are applied later in the pipeline)
 * are precomputed into statBuffer as Float64 contributions. When `shipId` is
 * provided, calibration bonuses are applied to the main stat of any piece that is
 * calibrated to that ship (mirrors the slow-path behaviour in statsCalculator).
 *
 * `percentRef` is the reference used for percentage-typed flexible stats. For
 * gear/implant pieces this MUST be the "afterEngineering" stats (i.e. the
 * ship's baseStats with refits+engineering applied), NOT the raw baseStats.
 * See Invariant 1 in the plan preamble.
 *
 * This function mirrors the "piece contributes to afterGear" portion of
 * calculateTotalStats. Keep in sync when that pipeline changes.
 */
export function buildGearRegistry(
    inventory: readonly GearPiece[],
    percentRef: BaseStats,
    shipId = ''
): GearRegistry {
    const pieces = [...inventory];
    const idOf = new Map<string, number>();
    const statBuffer = new Float64Array(pieces.length * STAT_COUNT);
    const setIds = new Uint8Array(pieces.length);
    const slotIds = new Uint8Array(pieces.length);

    const setNameToId = new Map<string, number>();
    const setIdToName: string[] = ['']; // 0 = none
    const slotNameToId = new Map<GearSlotName, number>();
    const slotIdToName: GearSlotName[] = [];

    const tmp = createStatVector();

    for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i];
        idOf.set(piece.id, i);

        // Slot id
        let slotId = slotNameToId.get(piece.slot);
        if (slotId === undefined) {
            slotId = slotIdToName.length;
            slotNameToId.set(piece.slot, slotId);
            slotIdToName.push(piece.slot);
        }
        slotIds[i] = slotId;

        // Set id
        if (piece.setBonus) {
            let setId = setNameToId.get(piece.setBonus);
            if (setId === undefined) {
                setId = setIdToName.length; // next integer
                setNameToId.set(piece.setBonus, setId);
                setIdToName.push(piece.setBonus);
            }
            setIds[i] = setId;
        } else {
            setIds[i] = 0;
        }

        // Compute stat contribution (main + subs) into tmp, then copy into buffer.
        // This replicates addStatModifier from statsCalculator for a single piece,
        // using percentRef (= afterEngineering) as the percentage reference.
        for (let k = 0; k < STAT_COUNT; k++) tmp[k] = 0;
        const shouldApplyCalibration =
            !!shipId && piece.calibration?.shipId === shipId && isCalibrationEligible(piece);
        const mainStat =
            shouldApplyCalibration && piece.mainStat
                ? getCalibratedMainStat(piece)
                : piece.mainStat;
        applyPieceStat(mainStat, tmp, percentRef);
        if (piece.subStats) {
            for (const s of piece.subStats) applyPieceStat(s, tmp, percentRef);
        }
        const base = i * STAT_COUNT;
        for (let k = 0; k < STAT_COUNT; k++) statBuffer[base + k] = tmp[k];
    }

    return {
        idOf,
        pieces,
        statBuffer,
        setIds,
        slotIds,
        setNameToId,
        setIdToName,
        slotNameToId,
        slotIdToName,
    };
}

function applyPieceStat(
    stat: Stat | undefined | null,
    target: StatVector,
    percentRef: BaseStats
): void {
    if (!stat) return;
    const idx = STAT_INDEX[stat.name];
    if (idx === undefined) return;

    const isPercentOnly = (PERCENTAGE_ONLY_STATS as readonly string[]).includes(stat.name);
    if (isPercentOnly) {
        target[idx] += stat.value;
    } else if (stat.type === 'percentage') {
        const refValue = (percentRef as unknown as Record<string, number>)[stat.name] ?? 0;
        target[idx] += refValue * (stat.value / 100);
    } else {
        target[idx] += stat.value;
    }
}

/**
 * Copy piece `pieceId`'s precomputed stat vector into `target` additively.
 * Used in the hot loop.
 */
export function addPieceStatsInto(
    registry: GearRegistry,
    pieceId: number,
    target: StatVector
): void {
    const base = pieceId * STAT_COUNT;
    for (let k = 0; k < STAT_COUNT; k++) target[k] += registry.statBuffer[base + k];
}
