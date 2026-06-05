import { SelectedGameBuff } from '../../types/calculator';
import { PERSISTENT_STACKING_BUFFS } from '../../constants/persistentStackingBuffs';
import { ActiveBuff } from './statusEngine';

// Synthesize resisted ActiveBuff rows from rejected TIMED enemy upsert names: each
// carries its would-be duration (the buff's numeric skillDuration) and emits a
// debuff-resisted tap. Shared by the attacker and team turns (both upsert timed enemy
// debuffs through the status engine's landing hook). The `: 1` fallback is unreachable
// today (only numeric-skillDuration buffs enter the timed resist path) — kept safe.
// A persistent-stacking name (would have landed as a never-expiring stack) surfaces its
// resisted display row as 'permanent', not its skill-text turn count — display-only.
export function synthesizeResisted(
    names: string[],
    enemyDebuffLookup: Map<string, SelectedGameBuff[]>,
    emitResisted: (buffName: string) => void
): ActiveBuff[] {
    return names.map((buffName) => {
        emitResisted(buffName);
        if (PERSISTENT_STACKING_BUFFS.has(buffName)) {
            return { buffName, turnsRemaining: 'permanent' as const };
        }
        const lookup = enemyDebuffLookup.get(buffName) ?? [];
        const dur = lookup.find((b) => typeof b.skillDuration === 'number')?.skillDuration;
        return { buffName, turnsRemaining: typeof dur === 'number' ? dur : 1 };
    });
}
