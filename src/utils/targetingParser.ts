import { Ship } from '../types/ship';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TargetSide = 'enemy' | 'ally';
export type TargetSelection = 'front' | 'back' | 'skip' | 'all' | 'team' | 'others' | 'self';

export interface ParsedTarget {
    raw: string;
    side: TargetSide;
    selection: TargetSelection;
}

export type PatternShape =
    | 'base'
    | 'cone'
    | 'line'
    | 'cross'
    | 'curve'
    | 'circle'
    | 'backline'
    | 'root'
    | 'split'
    | 'burst'
    | 'scattershot'
    | 'wings'
    | 'range'
    | 'pickaxe'
    | 'all';

export interface PatternModifiers {
    support?: boolean;
    prolonged?: boolean;
    reverse?: boolean;
    notSelf?: boolean;
    double?: boolean;
    fromCentre?: boolean;
    anchorMod?: 'back' | 'center' | 'forward';
}

export interface ParsedPattern {
    raw: string;
    shape: PatternShape;
    range: number | 'all' | 'lane';
    modifiers: PatternModifiers;
}

export interface SkillTargeting {
    target: ParsedTarget;
    pattern: ParsedPattern;
}

export interface ShipTargeting {
    active?: SkillTargeting;
    charged?: SkillTargeting;
}

export interface TargetingCsvRow {
    name: string;
    activeTarget: string;
    activePattern: string;
    chargedTarget: string;
    chargedPattern: string;
}

/**
 * Parses the raw text of docs/ship-targeting.csv into rows.
 * NOTE: ship-targeting.csv has no quoted fields or embedded commas, so a naive
 * comma split is safe. Keep this the single source of truth for that assumption.
 */
export function parseTargetingCsv(csvText: string): TargetingCsvRow[] {
    return csvText
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .slice(1) // drop header
        .map((line) => {
            const [name, activeTarget, activePattern, chargedTarget, chargedPattern] =
                line.split(',');
            return {
                name: (name ?? '').trim(),
                activeTarget: (activeTarget ?? '').trim(),
                activePattern: (activePattern ?? '').trim(),
                chargedTarget: (chargedTarget ?? '').trim(),
                chargedPattern: (chargedPattern ?? '').trim(),
            };
        });
}

// ---------------------------------------------------------------------------
// Target axis
// ---------------------------------------------------------------------------

const TARGET_MAP: Record<string, { side: TargetSide; selection: TargetSelection }> = {
    front: { side: 'enemy', selection: 'front' },
    back: { side: 'enemy', selection: 'back' },
    skip: { side: 'enemy', selection: 'skip' },
    all: { side: 'enemy', selection: 'all' },
    allies: { side: 'ally', selection: 'team' },
    'all-allies': { side: 'ally', selection: 'all' },
    'other-allies': { side: 'ally', selection: 'others' },
    self: { side: 'ally', selection: 'self' },
};

export function parseTarget(raw: string): ParsedTarget {
    const key = raw.trim().toLowerCase();
    const mapped = TARGET_MAP[key];
    if (!mapped) {
        throw new Error(`Unknown target value: "${raw}"`);
    }
    return { raw, side: mapped.side, selection: mapped.selection };
}

// ---------------------------------------------------------------------------
// Pattern axis
// ---------------------------------------------------------------------------

// Known modifier/meta tokens that can appear in the body without being a shape.
const KNOWN_NON_SHAPE_TOKENS = new Set([
    'support',
    'prolonged',
    'reverse',
    'not',
    'self',
    'from',
    'centre',
    'center',
    'back',
    'forward',
    'double',
    'whole',
    'lane',
]);

// Shape detection is presence-based (not positional) and ORDER-SENSITIVE:
// check 'backline' before any 'line'/'back' rule so it isn't mis-split.
function detectShape(lower: string): PatternShape {
    if (/backline/.test(lower)) return 'backline';
    if (/scattershot/.test(lower)) return 'scattershot';
    if (/pickaxe/.test(lower)) return 'pickaxe';
    if (/cone/.test(lower)) return 'cone';
    if (/cross/.test(lower)) return 'cross';
    if (/curve/.test(lower)) return 'curve';
    if (/circle/.test(lower)) return 'circle';
    if (/wings/.test(lower)) return 'wings';
    if (/root/.test(lower)) return 'root';
    if (/split/.test(lower)) return 'split';
    if (/burst/.test(lower)) return 'burst';
    if (/line/.test(lower)) return 'line';
    if (/base/.test(lower)) return 'base';
    // standalone "all" shape (Pattern-All, Pattern-Support-All) with no other shape token
    if (/(^|-)all($|-)/.test(lower)) return 'all';
    // pure range shape (Pattern-Range-N): only when all remaining tokens are known
    if (/range-\d+/.test(lower)) {
        // Strip the range-N segment and split remaining tokens
        const withoutRange = lower.replace(/range-\d+/, '').replace(/^-|-$/, '');
        const unknownTokens = withoutRange
            .split('-')
            .filter((t) => t.length > 0 && !KNOWN_NON_SHAPE_TOKENS.has(t));
        if (unknownTokens.length === 0) return 'range';
    }
    throw new Error(`Unknown pattern shape in: "${lower}"`);
}

export function parsePattern(raw: string): ParsedPattern {
    // Normalize: fix the "Patern" typo, turn "Prolonged_Cone" into "Prolonged-Cone".
    const normalized = raw
        .trim()
        .replace(/^Patern-/i, 'Pattern-')
        .replace(/_/g, '-');
    const body = normalized.replace(/^Pattern-/i, '');
    const lower = body.toLowerCase();

    const modifiers: PatternModifiers = {};
    if (/(^|-)support(-|$)/.test(lower)) modifiers.support = true;
    if (/(^|-)prolonged(-|$)/.test(lower)) modifiers.prolonged = true;
    if (/(^|-)reverse(-|$)/.test(lower)) modifiers.reverse = true;
    if (/not-self/.test(lower)) modifiers.notSelf = true;
    if (/(^|-)double(-|$)/.test(lower)) modifiers.double = true;
    // British spelling only — the corpus uses "from-centre"; a future "from-center" would need adding here.
    if (/from-centre/.test(lower)) modifiers.fromCentre = true;
    // anchor modifier (mutually exclusive); 'back' must not fire on 'backline'
    if (/(^|-)back(-|$)/.test(lower)) modifiers.anchorMod = 'back';
    else if (/(^|-)center(-|$)/.test(lower)) modifiers.anchorMod = 'center';
    else if (/(^|-)forward(-|$)/.test(lower)) modifiers.anchorMod = 'forward';

    let range: number | 'all' | 'lane';
    const rangeMatch = lower.match(/range-(\d+)/);
    if (rangeMatch) {
        range = parseInt(rangeMatch[1], 10);
    } else if (/whole-lane/.test(lower)) {
        range = 'lane';
    } else if (/(^|-)all($|-)/.test(lower)) {
        range = 'all';
    } else {
        // Pattern-Base / Pattern-Base-Support — no range token, point-blank.
        range = 0;
    }

    return { raw, shape: detectShape(lower), range, modifiers };
}

// ---------------------------------------------------------------------------
// Per-skill and per-ship
// ---------------------------------------------------------------------------

export function parseSkillTargeting(target: string, pattern: string): SkillTargeting {
    return { target: parseTarget(target), pattern: parsePattern(pattern) };
}

export function parseShipTargeting(
    ship: Pick<
        Ship,
        'activeTarget' | 'activePattern' | 'chargedTarget' | 'chargedPattern' | 'chargeSkillCharge'
    >
): ShipTargeting {
    const result: ShipTargeting = {};

    if (ship.activeTarget && ship.activePattern) {
        result.active = parseSkillTargeting(ship.activeTarget, ship.activePattern);
    }

    if (ship.chargedTarget && ship.chargedPattern) {
        // Explicit override (charged differs from active).
        result.charged = parseSkillTargeting(ship.chargedTarget, ship.chargedPattern);
    } else if (result.active && ship.chargeSkillCharge != null) {
        // Empty charged columns mean "charged targets the same as active"; only
        // inherit when the ship actually has a charged skill.
        result.charged = result.active;
    }

    return result;
}
