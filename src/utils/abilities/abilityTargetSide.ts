import type { AbilityTarget } from '../../types/abilities';

/**
 * THE one answer to "is this ability target enemy-side?" — the STORE axis, i.e. which of the
 * engine's two status stores a buff/debuff lands in (the caster's own SELF store, or the
 * per-victim ENEMY store keyed by the actor it was applied to).
 *
 * WHY A TOTAL `Record` AND NOT A `||` CHAIN. The key set is DERIVED from `AbilityTarget`, so `tsc`
 * rejects a new variant until somebody classifies it here. That is the whole point: before #399
 * this question was answered by four hand-written `||` chains in four files, three of which had
 * silently gone stale as selector targets were added — `engine.ts` (the status store side),
 * `playerTurn.ts` (the charge pool) and `triggers.ts` (charge removal) all omitted the three
 * selector targets, while `buffAbilityConverters.ts` listed them. A chain cannot fail to compile
 * when the union grows; this can. Same instrument as `enemyStoreChannelCoverage.test.ts` (#401),
 * applied to a different axis.
 *
 * The three SELECTOR targets are enemy-side. Each resolves at drain time to exactly ONE opposing
 * actor; naming one enemy rather than the whole opposing board changes the FOOTPRINT, never the
 * SIDE. `ABILITY_TARGET_SIDE` answers only the SIDE question; the footprint question — is this
 * target a selector, and which selection rule — is `ABILITY_TARGET_SELECTOR` below (#403). Two
 * axes, two total `Record`s, one file: they are asked about the same union and drifted apart
 * exactly once before, which is why they now sit together with a cross-check test.
 */
export const ABILITY_TARGET_SIDE: Record<AbilityTarget, 'self' | 'enemy'> = {
    self: 'self',
    ally: 'self',
    'all-allies': 'self',
    'lowest-hp-ally': 'self',
    'adjacent-allies': 'self',
    enemy: 'enemy',
    'all-enemies': 'enemy',
    // Enemy-side debuffs scoped to the resolved target's board neighbours, not self buffs.
    'adjacent-enemies': 'enemy',
    'target-and-adjacent-enemies': 'enemy',
    // Global selectors, resolved to one living opposing actor at drain time.
    'enemy-most-buffs': 'enemy',
    'enemy-highest-attack': 'enemy',
    'enemy-highest-speed': 'enemy',
};

export function isEnemyTarget(target: AbilityTarget): boolean {
    return ABILITY_TARGET_SIDE[target] === 'enemy';
}

/** Which of the three global enemy SELECTORS a target names, or `null` for every other target. */
export type EnemySelectorKind = 'most-buffs' | 'highest-attack' | 'highest-speed';

/**
 * THE one answer to "does this ability target name a single SELECTED opposing actor, and which
 * selection rule?" — the FOOTPRINT axis: which enemy a clause lands ON, as opposed to
 * `ABILITY_TARGET_SIDE`'s question of which STORE it lands IN.
 *
 * Same instrument, same reason: the key set is DERIVED from `AbilityTarget`, so `tsc` rejects a new
 * variant until somebody classifies it here. Before #403 the footprint question was simply not
 * asked on the cast path — `resolveDebuffRecipientIds` had no selector arm at all and the three
 * selector targets fell through its tail to `[anchorId]`, so a clause reading "applies Stasis to
 * the highest attack enemy" landed on whichever enemy the cast's pattern happened to anchor on.
 *
 * Resolving a kind to an actual actor id is the CALLER's job — it needs the live opposing roster
 * and live effective stats, which this module has no business knowing. `engine.ts`'s `buildTurnArgs`
 * supplies that as the `selectorEnemyIdFor` delegate (#403); `triggers.ts` resolves its own via
 * `ctx.enemyWithMostBuffs` / `enemyWithHighestAttack` / `enemyWithHighestSpeed`.
 */
export const ABILITY_TARGET_SELECTOR: Record<AbilityTarget, EnemySelectorKind | null> = {
    self: null,
    ally: null,
    'all-allies': null,
    'lowest-hp-ally': null,
    'adjacent-allies': null,
    enemy: null,
    'all-enemies': null,
    // Board-neighbour scopes are enemy-side but POSITIONAL, not selected — the footprint comes
    // from the anchor's neighbours, not from a global "highest X" search.
    'adjacent-enemies': null,
    'target-and-adjacent-enemies': null,
    'enemy-most-buffs': 'most-buffs',
    'enemy-highest-attack': 'highest-attack',
    'enemy-highest-speed': 'highest-speed',
};

/**
 * #403 review Finding 1: the `?? null` is NOT redundant with the `Record`'s type. `ABILITY_TARGET_SELECTOR`
 * is typed as total over `AbilityTarget`, but ability configs are user-persisted and unvalidated on
 * read (no Zod schema covers them — see `engine.ts`'s `passiveSlotPattern` exhaustiveness-guard
 * comment for the same fact stated at that call site). A `target` string OUTSIDE the union at
 * runtime indexes the `Record` to `undefined`, which is NOT `null` and so slips past a
 * `selectorKind !== null` guard downstream. An out-of-union target must resolve to "not a
 * selector" and fall through to the anchor tail — never be mistaken for a real selector arm. Do
 * not "simplify" this back to a bare index lookup.
 */
export function enemySelectorKind(target: AbilityTarget): EnemySelectorKind | null {
    return ABILITY_TARGET_SELECTOR[target] ?? null;
}
