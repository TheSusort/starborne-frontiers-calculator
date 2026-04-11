export interface Buff {
    id: string;
    stat: 'attack' | 'crit' | 'critDamage' | 'outgoingDamage';
    value: number;
}

export interface DoTApplicationConfig {
    corrosionStacks: number;
    corrosionTier: 0 | 3 | 6 | 9;
    infernoStacks: number;
    infernoTier: 0 | 15 | 30 | 45;
    bombStacks: number;
    bombTier: 0 | 100 | 200 | 300;
    bombCountdown: number;
}

export const DEFAULT_DOT_CONFIG: DoTApplicationConfig = {
    corrosionStacks: 0,
    corrosionTier: 0,
    infernoStacks: 0,
    infernoTier: 0,
    bombStacks: 0,
    bombTier: 0,
    bombCountdown: 2,
};
