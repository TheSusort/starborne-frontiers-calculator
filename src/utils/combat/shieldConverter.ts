import type { StatusEngine } from './statusEngine';

/**
 * `Shield Converter` — "Nullifies the damage of the next direct hit, turning it into a Shield
 * instead." (constants/buffs.ts). Granted by Quixilver's charged skill, to itself.
 *
 * NAME-KEYED, like Hit Mitigation / Exposed / Barrier, rather than a `parsedEffects` entry: a
 * one-shot nullify has no honest standing value, so folding it into an incoming channel would leak
 * permanent damage immunity into every non-consuming reader (effective-HP, the DPS-mode aggregate
 * scalars, the buff-display UI).
 *
 * NOT the same thing as Quixilver's R2 passive, which also produces Shield. That passive converts
 * a fraction of damage the ship ACTUALLY TOOK into Shield; this status nullifies the hit outright
 * and turns it into Shield. They are separate mechanics that happen to share a resource.
 *
 * Consumption follows the Exposed/Hit Mitigation invariant — consume only on a hit that actually
 * READ the block. A Barrier-nullified hit, a bomb/detonation portion (the funnel's own definition
 * of direct is `byDirectDamage === true && bombPortion === 0`), and a hit already converted by an
 * earlier transform step must all leave the status intact.
 *
 * ORDERING: Hit Mitigation takes priority. A victim holding both spends only Hit Mitigation on a
 * given hit and keeps this one armed for the next. One hit spends exactly one block.
 */
export const SHIELD_CONVERTER = 'Shield Converter';

/**
 * True when the actor carries a Shield Converter that {@link consumeShieldConverter} can SPEND.
 *
 * Deliberately NOT `selfBuffNamesForOwners`. That union also surfaces ALWAYS-ACTIVE entries, which
 * `removeSelfBuffByName` cannot reach — and `isAlwaysActive` returns true for anything without a
 * `skillSource`, which every manual buff-picker selection lacks. Reading the broad union would make
 * a hand-picked Shield Converter an unspendable, permanent nullifier of every direct hit.
 *
 * Narrowed to the timed + persistent ability-status channel instead, so a hand-picked selection is
 * INERT. Inert is the faithful rendering: there is no standing value for "nullifies the next hit",
 * which is the same reason this is name-keyed rather than a `parsedEffects` entry.
 */
export function holdsShieldConverter(statusEngine: StatusEngine, actorId: string): boolean {
    return statusEngine
        .timedAbilityStatuses('self', actorId)
        .some((s) => s.active.buffName === SHIELD_CONVERTER);
}

/**
 * Consume the holder's Shield Converter after it nullifies a direct hit. Clears the actor's own
 * self stores, which STRICTLY CONTAINS what {@link holdsShieldConverter} reads — every channel the
 * read can see, this can spend. That containment is what makes the status a genuine one-shot.
 * A no-op when the actor carries none, so it is safe to call unconditionally.
 */
export function consumeShieldConverter(statusEngine: StatusEngine, actorId: string): void {
    statusEngine.removeSelfBuffByName(actorId, SHIELD_CONVERTER);
}
