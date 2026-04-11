export interface Buff {
    id: string;
    stat: 'attack' | 'crit' | 'critDamage' | 'outgoingDamage';
    value: number;
}

export type DoTType = 'corrosion' | 'inferno' | 'bomb';

export interface DoTApplicationEntry {
    id: string;
    type: DoTType;
    tier: number; // 3/6/9 for corrosion, 15/30/45 for inferno, 100/200/300 for bomb
    stacks: number; // stacks applied per use
    duration: number; // rounds before expiry (corrosion/inferno), or countdown for bombs
}

export type DoTApplicationConfig = DoTApplicationEntry[];

export const DEFAULT_DOT_CONFIG: DoTApplicationConfig = [];
