import { RARITIES, RarityName } from '../../constants/rarities';
import { BACKGROUND_TIERS, BOUNTIES, BackgroundTierId, BountyId } from '../../constants/bounties';
import { RankMetric } from '../../utils/bountyCredits';

export interface BountySettings {
    bountyId: BountyId;
    stars: number[];
    rarities: RarityName[];
    sets: string[];
    generalSellPct: number;
    extraCreditsPct: number;
    secondsPerFight: number | null;
    overheadSeconds: number;
    secondsOverrides: Record<string, number>;
    metric: RankMetric;
    mode: 'normal' | 'background';
    defaultTier: BackgroundTierId;
    tierOverrides: Record<string, BackgroundTierId>;
}

export const DEFAULT_SETTINGS: BountySettings = {
    bountyId: 'fenri',
    stars: [],
    rarities: [],
    sets: [],
    generalSellPct: 0,
    extraCreditsPct: 0,
    secondsPerFight: null,
    overheadSeconds: 5,
    secondsOverrides: {},
    metric: 'energy',
    mode: 'normal',
    defaultTier: 'win',
    tierOverrides: {},
};

const isTierId = (v: unknown): v is BackgroundTierId => BACKGROUND_TIERS.some((t) => t.id === v);

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const isSettings = (v: unknown): v is BountySettings => {
    if (!v || typeof v !== 'object') return false;
    const s = v as Record<string, unknown>;
    const overrides = s.secondsOverrides;
    const tierOverrides = s.tierOverrides;
    return (
        BOUNTIES.some((b) => b.id === s.bountyId) &&
        Array.isArray(s.stars) &&
        s.stars.every((x) => Number.isInteger(x) && x >= 1 && x <= 6) &&
        Array.isArray(s.rarities) &&
        s.rarities.every((x) => typeof x === 'string' && Object.hasOwn(RARITIES, x)) &&
        Array.isArray(s.sets) &&
        s.sets.every((x) => typeof x === 'string') &&
        isFiniteNumber(s.generalSellPct) &&
        isFiniteNumber(s.extraCreditsPct) &&
        (s.secondsPerFight === null || isFiniteNumber(s.secondsPerFight)) &&
        isFiniteNumber(s.overheadSeconds) &&
        !!overrides &&
        typeof overrides === 'object' &&
        !Array.isArray(overrides) &&
        Object.values(overrides).every(isFiniteNumber) &&
        (s.metric === 'run' || s.metric === 'energy' || s.metric === 'minute') &&
        (s.mode === 'normal' || s.mode === 'background') &&
        isTierId(s.defaultTier) &&
        !!tierOverrides &&
        typeof tierOverrides === 'object' &&
        !Array.isArray(tierOverrides) &&
        Object.values(tierOverrides).every(isTierId)
    );
};
