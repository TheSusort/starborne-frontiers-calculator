import type { AbilityTarget, AbilityType } from '../../types/abilities';

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

/**
 * THE one answer to "does this enemy-side target cover the WHOLE opposing board, or a subset of
 * it?" — the BOARD-COVERAGE axis, beside the SIDE axis above and the FOOTPRINT axis below. Fourth
 * total `Record` over the same derived key set, same instrument and same reason: `tsc` rejects a
 * new `AbilityTarget` until somebody classifies it here.
 *
 * WHY (#390). Enemy-side AURA and ACCUMULATING statuses are registered ONCE at actor construction,
 * into a bucket keyed `DEFAULT_ENEMY_TARGET` ('__enemy__') — before any cast has resolved, so no
 * victim id exists to key them by. Every reader looks them up under the resolved victim's REAL id,
 * so the bucket was never read and the whole channel was inert (`statusEngine.ts`'s
 * `activeAbilityStatuses`; measured in `enemyAuraDebuffChannel.characterization.test.ts`).
 *
 * Folding that bucket into every per-victim read repairs it — but ONLY for a target that genuinely
 * covers every enemy. For a subset scope the same fold would smear a one-victim debuff across the
 * whole opposing board, which is a worse answer than dropping it. Hence this axis: `'all'` folds,
 * `'subset'` stays dropped until enemy-side aura registration moves to cast time.
 *
 * `null` is the SELF side — the question does not apply there. Keep this in sync with
 * `ABILITY_TARGET_SIDE`: every `'enemy'` entry there must be non-`null` here, which
 * `abilityTargetSide.test.ts` cross-checks rather than trusting.
 */
export const ABILITY_TARGET_ENEMY_SCOPE: Record<AbilityTarget, 'all' | 'subset' | null> = {
    self: null,
    ally: null,
    'all-allies': null,
    'lowest-hp-ally': null,
    'adjacent-allies': null,
    // The one board-wide enemy scope: every opposing actor is a recipient by definition.
    'all-enemies': 'all',
    enemy: 'subset',
    // Positional scopes: the footprint comes from the anchor's neighbours, so which enemies are
    // covered is not knowable at registration time.
    'adjacent-enemies': 'subset',
    'target-and-adjacent-enemies': 'subset',
    // Global selectors: exactly ONE opposing actor, resolved at drain time.
    'enemy-most-buffs': 'subset',
    'enemy-highest-attack': 'subset',
    'enemy-highest-speed': 'subset',
};

/**
 * Does `target` cover every enemy on the board? Backs the #390 aura/accumulating fold.
 *
 * The `=== 'all'` comparison (rather than a truthiness check) is load-bearing for the same reason
 * `enemySelectorKind`'s `?? null` is: ability configs are user-persisted and unvalidated on read,
 * so an out-of-union `target` indexes this total `Record` to `undefined` at runtime. An
 * unrecognised target must answer "not board-wide" and keep its statuses OUT of the fold — the
 * conservative side, since a wrong `true` smears a debuff across enemies it never touched.
 */
export function isAllEnemiesTarget(target: AbilityTarget): boolean {
    return ABILITY_TARGET_ENEMY_SCOPE[target] === 'all';
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

/**
 * THE one answer to "which SIDE may an ability of this type aim at?" — the AUTHORING axis, beside
 * this file's two runtime axes (`ABILITY_TARGET_SIDE`, the store; `ABILITY_TARGET_SELECTOR`, the
 * footprint). Third total `Record` over a derived key set, same instrument and same reason: `tsc`
 * rejects a new `AbilityType` until somebody classifies it here.
 *
 * WHY (#407, owner ruling R4). `AbilityCard.tsx`'s target dropdown was not filtered by ability
 * type, so a user could author `type: 'buff'` aimed at `all-enemies` and SAVE it. That status lands
 * in the per-victim ENEMY store — the store side comes from the TARGET, not the config type — but
 * `playerTurn.ts`'s `matchingAbility` lookup searches `config.type === 'debuff'` only, so it
 * matched nothing, recipient resolution degraded to plain single-target, and the "all enemies" buff
 * hit exactly ONE enemy: the cast anchor. The ruling was to close this at the AUTHORING boundary
 * and leave the engine's predicate alone, so the fix is this map plus the editor filter. The
 * engine's behaviour for a shape that arrives anyway (hand-edited persisted data — #404's axis) is
 * still pinned by `selectorTargetStoreSide.test.ts`'s RESIDUAL arm.
 *
 * SEEDED FROM A MEASUREMENT, not from taste. All 1140 abilities `buildShipAbilities` derives from
 * `docs/ship-skills.csv` were swept for the type→target pairs that actually occur. Exactly three
 * types appear on BOTH sides and are therefore `'both'`:
 *   • `charge`        — self-gain (24), enemy-removal (8), ally-bulk grants (5);
 *   • `control`       — inflicted control (35 + 2 adjacency) AND Taunt, which
 *                       `parseControlInflicts` emits with `side: 'self'` (6);
 *   • `extend-status` — Ripper's `all-allies` buff-extend (2) AND Sokol/Lev's enemy debuff-extend
 *                       (2).
 * Every other type was observed on one side only. `buff` is `'self'` — 262 ally-side occurrences
 * (self 160, all-allies 87, ally 12, adjacent-allies 3) and NOT ONE enemy target — which is the
 * entry that closes the hole. `abilityTypeTargetSides.test.ts` re-runs that sweep as a gate.
 *
 * Note `charge` is narrowed FURTHER by `CHARGE_TARGET_OPTIONS` (#399 Change 1a) to exactly three
 * targets. `'both'` here answers only the SIDE question; the editor applies the stricter list
 * first, so the two are not in conflict. See `AbilityCard.tsx`'s `targetOptionsForSelect`.
 */
export const ABILITY_TYPE_TARGET_SIDES: Record<AbilityType, 'self' | 'enemy' | 'both'> = {
    damage: 'enemy',
    counter: 'enemy',
    'additional-damage': 'enemy',
    'shield-strip': 'enemy',
    modifier: 'self',
    buff: 'self',
    debuff: 'enemy',
    dot: 'enemy',
    'extend-dot': 'enemy',
    // Ripper extends ally buffs; Sokol/Lev extend enemy debuffs. Genuinely both.
    'extend-status': 'both',
    'detonate-dot': 'enemy',
    'accumulate-detonate': 'enemy',
    // Self-gain, enemy-removal and ally-bulk grants all exist in the corpus. Narrowed further by
    // CHARGE_TARGET_OPTIONS in the editor.
    charge: 'both',
    'extra-action': 'self',
    heal: 'self',
    shield: 'self',
    cleanse: 'self',
    purge: 'enemy',
    'buff-steal': 'enemy',
    // Inflicted control is enemy-side; Taunt is the self arm (parseControlInflicts, side 'self').
    control: 'both',
    'remove-self-buff': 'self',
    'incoming-reduction': 'self',
    'incoming-block': 'self',
    'incoming-shield-grant': 'self',
    'outgoing-amplification': 'self',
    'heal-amplification': 'self',
    'incoming-heal-amplification': 'self',
    'pre-combat-stat': 'self',
    'transform-incoming-to-dot': 'self',
    'convert-dot': 'enemy',
    'defense-substitution': 'self',
    'bomb-countdown-reduce': 'enemy',
    'conditional-stat': 'self',
};

/**
 * May an ability of `type` aim at `target`? Backs the editor's target-dropdown filter and the
 * corpus gate in `abilityTypeTargetSides.test.ts`.
 *
 * The `undefined` guard is NOT redundant with the `Record`'s type, for the same reason
 * `enemySelectorKind`'s `?? null` is not: abilities are user-persisted and unvalidated on read, so
 * an out-of-union `type` indexes this total `Record` to `undefined` at runtime. Treat that as "no
 * restriction" — the editor must not hide the target a saved ability already carries just because
 * its type is unrecognised, which would silently misrepresent stored data.
 */
export function targetSideAllowedForType(type: AbilityType, target: AbilityTarget): boolean {
    const allowed = ABILITY_TYPE_TARGET_SIDES[type];
    if (allowed === undefined || allowed === 'both') return true;
    return ABILITY_TARGET_SIDE[target] === allowed;
}
