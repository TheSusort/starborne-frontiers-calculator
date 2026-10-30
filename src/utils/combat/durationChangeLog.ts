import type { CombatEvent } from './events';

type DurationChanged = Extract<CombatEvent, { type: 'status-duration-changed-log' }>;

/**
 * The `status-duration-changed-log` for one resolved extension clause. `movedOn` maps each
 * recipient the clause reached to the statuses it moved there; the row names the holders whose
 * statuses moved, or every recipient when nothing moved (see the event's doc in events.ts).
 */
export function durationChangedEvent(
    casterId: string,
    round: number,
    movedOn: ReadonlyMap<string, number>,
    turns: number,
    scope: DurationChanged['scope']
): DurationChanged {
    let count = 0;
    const moved: string[] = [];
    for (const [id, n] of movedOn) {
        count += n;
        if (n > 0) moved.push(id);
    }
    return {
        type: 'status-duration-changed-log',
        casterId,
        targetIds: count > 0 ? moved : [...movedOn.keys()],
        round,
        turns,
        count,
        scope,
    };
}
