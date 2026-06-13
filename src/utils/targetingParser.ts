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
