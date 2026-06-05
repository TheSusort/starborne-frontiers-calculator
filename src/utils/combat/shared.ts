import { SelectedGameBuff } from '../../types/calculator';
import { ActiveBuff } from './statusEngine';

// Synthesize resisted ActiveBuff rows from rejected TIMED enemy upsert names: each
// carries its would-be duration (the buff's numeric skillDuration) and emits a
// debuff-resisted tap. Shared by the attacker and team turns (both upsert timed enemy
// debuffs through the status engine's landing hook). The `: 1` fallback is unreachable
// today (only numeric-skillDuration buffs enter the timed resist path) — kept safe.
export function synthesizeResisted(
    names: string[],
    enemyDebuffLookup: Map<string, SelectedGameBuff[]>,
    emitResisted: (buffName: string) => void
): ActiveBuff[] {
    return names.map((buffName) => {
        emitResisted(buffName);
        const lookup = enemyDebuffLookup.get(buffName) ?? [];
        const dur = lookup.find((b) => typeof b.skillDuration === 'number')?.skillDuration;
        return { buffName, turnsRemaining: typeof dur === 'number' ? dur : 1 };
    });
}
