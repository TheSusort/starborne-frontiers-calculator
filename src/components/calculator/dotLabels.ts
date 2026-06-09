import { DoTType } from '../../types/calculator';

/** Tier → display name per DoT type (Corrosion/Inferno/Bomb). Shared by the DPS buff panel and the
 *  healing enemy-effects panel so both render DoTs identically. */
export const DOT_NAMES: Record<DoTType, Record<number, string>> = {
    corrosion: { 3: 'Corrosion I', 6: 'Corrosion II', 9: 'Corrosion III' },
    inferno: { 15: 'Inferno I', 30: 'Inferno II', 45: 'Inferno III' },
    bomb: { 100: 'Bomb I', 200: 'Bomb II', 300: 'Bomb III' },
};

/** The minimal `{ type, tier, stacks }` shape both DoT displays render (a superset of the engine's
 *  `EnemyDoTState` and the DPS `ActiveDoTState`/`DoTApplicationEntry` fields). */
export interface DoTLabelInput {
    type: DoTType;
    tier: number;
    stacks: number;
}

/** Human label for a DoT: tier name (falling back to `type (tier)`) with a `×N` stack suffix when
 *  more than one stack. Used for the DPS applied/active DoT rows and the healing enemy DoT rows. */
export function dotStateLabel(dot: DoTLabelInput): string {
    const name = DOT_NAMES[dot.type]?.[dot.tier] ?? `${dot.type} (${dot.tier})`;
    return dot.stacks > 1 ? `${name} ×${dot.stacks}` : name;
}
