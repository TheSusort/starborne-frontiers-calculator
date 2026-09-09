import { PERCENTAGE_ONLY_STATS } from '../../types/stats';
import type { Stat, StatName, StatType } from '../../types/stats';

/**
 * The wire format for `inventory_items.stats`.
 *
 * Rows are stored as a compact jsonb array of one string per stat — slot 0 is
 * the main stat, the rest are substats in order:
 *
 *     ["a60","k6","s3","C6"]   attack +60 flat; hacking +6, speed +3, crit +6%
 *
 * Measured at 146.5 B/row against 388.4 for the long form it replaces
 * (`docs/superpowers/specs/2026-09-09-gear-stats-encoding-measurement.md`), which
 * spent 64% of every row on the literal strings `mainStat`, `subStats`, `name`,
 * `type` and `value`. `decodeGearStats` reads both shapes; `encodeGearStats`
 * only ever writes the compact one.
 *
 * `stats` appears in no index and no SQL query reads inside it, so the shape is
 * free to change — but the array stays a real jsonb array rather than one
 * delimited string so that `stats @> '["a60"]'` and `jsonb_array_elements_text`
 * keep working without a hand-rolled parser.
 */

/** One character per stat name; case carries the type. */
const SYMBOL_BY_NAME: Record<StatName, string> = {
    attack: 'a',
    hp: 'h',
    defence: 'd',
    crit: 'c',
    hacking: 'k',
    speed: 's',
    security: 'y',
    critDamage: 'p',
    healModifier: 'm',
    shield: 'e',
    hpRegen: 'r',
    defensePenetration: 'n',
    shieldPenetration: 'i',
    damageReduction: 'u',
};

const NAME_BY_SYMBOL: Record<string, StatName> = Object.fromEntries(
    Object.entries(SYMBOL_BY_NAME).map(([name, symbol]) => [symbol, name as StatName])
);

const PERCENTAGE_ONLY: ReadonlySet<string> = new Set(PERCENTAGE_ONLY_STATS);

/** Slot 0 always exists; it holds this when the piece has no main stat. */
const NO_MAIN_STAT = '';

export interface GearStats {
    mainStat: Stat | null;
    subStats: Stat[];
}

/** The long-form shape written before the compact encoding. Read-only now. */
interface LegacyStat {
    name: string;
    type: string;
    value: number;
}
interface LegacyStats {
    mainStat?: LegacyStat | null;
    subStats?: LegacyStat[] | null;
}

const encodeStat = (stat: Stat): string => {
    // Typed `string | undefined` deliberately: `SYMBOL_BY_NAME` is total over
    // `StatName`, but a total Record constrains what can be AUTHORED, not what
    // arrives at runtime — a persisted piece can carry a name outside the union,
    // and TypeScript would otherwise call the guard below dead.
    const symbol: string | undefined = SYMBOL_BY_NAME[stat.name];
    if (!symbol) {
        throw new Error(`Cannot encode gear stat: "${stat.name}" is not a StatName`);
    }
    const percentageOnly = PERCENTAGE_ONLY.has(stat.name);
    // A percentage-only stat has no flat form. Emitting the lowercase symbol
    // would produce a cell that decode rejects, so it fails here instead —
    // at the write, in the session that created it.
    if (stat.type === 'flat' && percentageOnly) {
        throw new Error(`Cannot encode gear stat: "${stat.name}" is percentage-only, got flat`);
    }
    // An absent type is not a contradiction: the writer sites this replaces
    // defaulted it to flat, so older local data can arrive without one. A
    // flexible stat keeps that default; a percentage-only stat takes the only
    // type it can legally have.
    // `${NaN}` and `${Infinity}` would write the cells "aNaN" and "aInfinity",
    // which decode rejects — breaking this module's contract that encode never
    // emits a cell decode cannot read.
    if (!Number.isFinite(stat.value)) {
        throw new Error(
            `Cannot encode gear stat: "${stat.name}" has a non-finite value ${String(stat.value)}`
        );
    }
    const percentage = stat.type === 'percentage' || percentageOnly;
    return `${percentage ? symbol.toUpperCase() : symbol}${stat.value}`;
};

const decodeStat = (cell: string): Stat => {
    const symbol = cell.slice(0, 1);
    const name: StatName | undefined = NAME_BY_SYMBOL[symbol.toLowerCase()];
    if (!name) {
        throw new Error(
            `Cannot decode gear stat: "${symbol}" is not a stat symbol (cell "${cell}")`
        );
    }
    const raw = cell.slice(1);
    const value = Number(raw);
    if (raw === '' || !Number.isFinite(value)) {
        throw new Error(
            `Cannot decode gear stat: "${raw}" is not a numeric value (cell "${cell}")`
        );
    }
    // The name decides the type wherever the name already determines it, so a
    // stray case fold cannot turn a percentage stat into a flat one.
    const type: StatType =
        PERCENTAGE_ONLY.has(name) || symbol === symbol.toUpperCase() ? 'percentage' : 'flat';
    return { name, value, type } as Stat;
};

const decodeLegacyStat = (stat: LegacyStat): Stat =>
    ({
        name: stat.name,
        value: stat.value,
        type: stat.type === 'percentage' ? 'percentage' : 'flat',
    }) as Stat;

/**
 * Writes the compact shape. Throws rather than emitting a cell that
 * `decodeGearStats` would reject.
 */
export const encodeGearStats = (stats: GearStats): string[] => [
    stats.mainStat ? encodeStat(stats.mainStat) : NO_MAIN_STAT,
    ...(stats.subStats ?? []).map(encodeStat),
];

/**
 * Reads either shape: the compact array, or the long form still on rows that
 * predate the migration. A missing or malformed value decodes to an empty
 * piece, matching what the call sites did with a null `stats` column before.
 */
export const decodeGearStats = (wire: unknown): GearStats => {
    if (Array.isArray(wire)) {
        const cells = wire as string[];
        return {
            mainStat: cells[0] ? decodeStat(cells[0]) : null,
            subStats: cells.slice(1).filter(Boolean).map(decodeStat),
        };
    }
    if (wire && typeof wire === 'object') {
        const legacy = wire as LegacyStats;
        return {
            mainStat: legacy.mainStat ? decodeLegacyStat(legacy.mainStat) : null,
            subStats: (legacy.subStats ?? []).map(decodeLegacyStat),
        };
    }
    return { mainStat: null, subStats: [] };
};

/**
 * `encodeGearStats`/`decodeGearStats` throw, because a stat they cannot
 * represent or read is corruption and should be loud. These wrappers are for
 * the boundaries where ONE bad piece must not take the whole operation down:
 *
 * - a leaderboard or public profile spans every user's gear, so one unreadable
 *   row would otherwise hide the page from everyone
 * - an inventory sync writes tens of thousands of rows after already clearing
 *   `calibration_ship_id`, so throwing midway loses the calibration AND skips
 *   the re-upload
 *
 * Single-piece actions (adding or editing one gear piece) should keep using the
 * throwing pair: there the failure belongs in front of the user who caused it.
 */
export const tryEncodeGearStats = (stats: GearStats): string[] | null => {
    try {
        return encodeGearStats(stats);
    } catch (error) {
        console.error('Skipping gear piece with unencodable stats:', error);
        return null;
    }
};

export const tryDecodeGearStats = (wire: unknown): GearStats | null => {
    try {
        return decodeGearStats(wire);
    } catch (error) {
        console.error('Skipping gear piece with unreadable stats:', error);
        return null;
    }
};
