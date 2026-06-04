import { AbilityType } from '../../types/abilities';
import { DoTType } from '../../types/calculator';

/**
 * Engine-emitted combat events. Phase 1 is emit-only (the DPS adapter is the sole
 * consumer); Phase 3 maps reactive Ability.trigger values onto these. Contract:
 * listeners are synchronous, run in registration order, and never mutate combat
 * state — they produce intents (e.g. enqueued follow-up executions) only.
 */
export type CombatEvent =
    | { type: 'turn-started'; actorId: string; round: number }
    | { type: 'turn-ended'; actorId: string; round: number }
    | {
          type: 'skill-fired';
          actorId: string;
          round: number;
          slot: 'active' | 'charged';
          skillName?: string;
      }
    | {
          type: 'ability-performed';
          actorId: string;
          targetId: string;
          round: number;
          abilityType: AbilityType;
          damage?: number;
          didCrit?: boolean;
          didHit?: boolean;
      }
    | {
          type: 'buff-applied';
          actorId: string;
          round: number;
          buffName: string;
          duration: number | 'recurring';
      }
    /** Phase 1: declared but intentionally unemitted — reserved for Phase 2's owner post-turn expiry. */
    | { type: 'buff-expired'; actorId: string; round: number; buffName: string }
    | { type: 'debuff-applied'; targetId: string; round: number; buffName: string }
    | { type: 'debuff-resisted'; targetId: string; round: number; buffName: string }
    | { type: 'dot-applied'; targetId: string; round: number; dotType: DoTType; stacks: number }
    | {
          type: 'dot-ticked';
          targetId: string;
          round: number;
          dotType: 'corrosion' | 'inferno';
          damage: number;
      }
    | { type: 'dot-detonated'; targetId: string; round: number; damage: number }
    | { type: 'hp-changed'; targetId: string; round: number; oldPct: number; newPct: number }
    | { type: 'ship-destroyed'; actorId: string; round: number };

export type CombatEventType = CombatEvent['type'];

type Listener<T extends CombatEventType> = (event: Extract<CombatEvent, { type: T }>) => void;

export interface CombatEventBus {
    on<T extends CombatEventType>(type: T, listener: Listener<T>): void;
    emit(event: CombatEvent): void;
}

export function createEventBus(): CombatEventBus {
    const listeners = new Map<CombatEventType, Listener<CombatEventType>[]>();
    return {
        on(type, listener) {
            const existing = listeners.get(type) ?? [];
            listeners.set(type, [...existing, listener as unknown as Listener<CombatEventType>]);
        },
        emit(event) {
            for (const listener of listeners.get(event.type) ?? []) {
                listener(event as unknown as Extract<CombatEvent, { type: CombatEventType }>);
            }
        },
    };
}
