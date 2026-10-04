/**
 * Overclock's hangover. In-app Overclock III: "On removal or expiration, apply Speed Down I and
 * Attack Down I to self for 2 turns." The catalogue's family text says the same for every tier
 * ("Upon removal or expiration, apply [Speed Down] and [Attack Down] for 2 turns").
 *
 * The holder applies them to itself: `apply` (no landing roll), `casterId` = the holder, landing
 * in the holder's ordinary per-actor debuff store, so cleanse, debuff counts and same-family
 * highest-tier shadowing all treat them like any other debuff.
 *
 * "Removal or expiration" is every way the buff can leave (turn expiry, purge, steal, cleanse of
 * buffs), so the engine detects it as a disappearance rather than hooking each removal path:
 * `OverclockHangoverTracker.settle` runs after every actor's Post Turn and compares who holds an
 * Overclock now with who held one at the previous settle.
 */
import { BUFFS } from '../../constants/buffs';
import { parseBuffEffects } from '../calculators/buffParser';
import type { RegisteredAbilityStatus } from './statusEngine';

export const OVERCLOCK_HANGOVER_DEBUFFS = ['Speed Down I', 'Attack Down I'] as const;
export const OVERCLOCK_HANGOVER_TURNS = 2;

/** Any tier of the Overclock family. */
export const isOverclock = (buffName: string): boolean => /^Overclock(?: I{1,3})?$/.test(buffName);

/** The hangover statuses for `holderId`, payloads parsed from the real BUFFS entries. */
export function overclockHangoverStatuses(
    holderId: string
): Extract<RegisteredAbilityStatus, { kind: 'timed' }>[] {
    return OVERCLOCK_HANGOVER_DEBUFFS.map((buffName) => {
        const entry = BUFFS.find((b) => b.name === buffName);
        if (!entry) throw new Error(`overclockHangover: ${buffName} missing from BUFFS`);
        return {
            payload: {
                buffName,
                stacks: 1,
                parsedEffects: parseBuffEffects(buffName, entry.description),
                application: 'apply',
            },
            side: 'enemy',
            sourceSlot: 'passive',
            conditions: [],
            casterId: holderId,
            recipients: [holderId],
            kind: 'timed',
            duration: OVERCLOCK_HANGOVER_TURNS,
        };
    });
}

/** Tracks Overclock holders between settles; `settle` returns the ids that just lost theirs. */
export function createOverclockHangoverTracker(): {
    settle: (holds: (id: string) => boolean, livingIds: Iterable<string>) => string[];
} {
    let held = new Set<string>();
    return {
        settle: (holds, livingIds) => {
            const now = new Set<string>();
            const lost: string[] = [];
            for (const id of livingIds) {
                if (holds(id)) now.add(id);
                else if (held.has(id)) lost.push(id);
            }
            held = now;
            return lost;
        },
    };
}
