# Charge Phase 4 — Reactions to enemy charged-skill use (+ Block Buff primitive)

**Date:** 2026-06-24
**Status:** Design — pending review
**Parent spec:** `docs/superpowers/specs/2026-06-23-charge-generation-manipulation-design.md` (Phase 4 section)
**Branch base:** stacks on `feat/combat-charge-phase2-3-self-charge` (PR #153). Retarget to `main` as the charge stack (#151 → #152 → #153) merges.

## Summary

The final charge phase. A unit reacts when an **enemy** casts its charged skill. This needs a NEW opposing-scoped trigger (`on-enemy-charged-cast`) — the existing `on-charged-cast` is self-scoped (fires when *you* cast *your* charged skill) and cannot be reused. The effect ability types (purge, debuff, damage, shield) all already exist; this phase adds the trigger keying + parser.

Per user decision (2026-06-24), this phase **also lights up the Block Buff primitive** (a unit carrying Block Buff is immune to receiving buffs), because the primary corpus ship (Curator) inflicts Block Buff and shipping it inert would lose fidelity. D-PR15 had deferred Block Buff as "out of scope (lighting it moves goldens)"; investigation shows that warning was conservative — no existing combat golden uses any Block Buff ship, and Block Buff only blocks *new* buff applications (it does not alter folding or remove existing buffs), so existing fixtures are byte-identical.

## Corpus

Two ships react to enemy charged casts (verified against `docs/ship-skills.csv`):

- **Curator** (refit-tiered passive; resolve the active passive via `getShipSkillRows()`):
  - 1st passive: `"When an enemy uses their charged skill, this unit purges 1 buffs from that enemy."`
  - 2nd passive: `"...purges 1 buffs from that enemy, and inflicts Block Buff for 1 turns."`
  - 3rd passive: `"...purges 2 buffs from that enemy, and inflicts Block Buff for 2 turns."`
- **FrontLine** (2nd passive): `"...When an enemy uses their Charged skill, it deals 80% and gains a Shield equal to 30% of the damage dealt, once per round."`

Block Buff is also inflicted by **Bizon** (a different trigger — "after dealing damage to an enemy with more than 2 debuffs"); Bizon's applier is NOT in scope for this phase (only the Block Buff *primitive* it relies on). Block Buff appears bare (no Roman tiers) in the corpus → `deriveFamilyKey` yields `familyKey:'Block Buff', tier:0`.

## Piece 1 — `on-enemy-charged-cast` trigger

A new opposing-scoped `AbilityTrigger`, riding the same `skill-fired` event as `on-charged-cast` but gated on the opposing side, exactly mirroring `on-enemy-repaired`:

```ts
case 'on-enemy-charged-cast':
    bus.on('skill-fired', (e) => {
        // Opposing-scoped mirror of on-charged-cast. Team-agnostic: player
        // registration's isOpposing = enemy side; enemy registration's = player side.
        // Capture the casting enemy's id so the reaction targets THAT enemy.
        if (isOpposing(e.actorId) && e.slot === 'charged')
            enqueue({ ...intent, eventCtx: { ...intent.eventCtx, counterTargetId: e.actorId } });
    });
    break;
```

- Add `'on-enemy-charged-cast'` to the `AbilityTrigger` union and to `LIVE_TRIGGERS` (load-bearing: `isReactiveAbility` gates on membership).
- As-built: reuse the existing `Intent.eventCtx.counterTargetId` field to carry the casting enemy's id (no new field — zero executor change), rather than adding a separate `chargedCasterId`.
- `registerReactiveListeners` already receives a per-call `isOpposing` predicate (bySide PR2) and is registered for BOTH sides, so the trigger is symmetric by construction. The historical player-centric reactive-routing gap does not apply to this listener-style trigger.

The reaction effect executors (purge, debuff, damage, shield) must target the casting enemy. As-built, the casting enemy's id rides the existing `eventCtx.counterTargetId` field (already threaded into the purge/debuff executor target resolution like `repairerId`): when present, the reaction's enemy-target resolves to `counterTargetId` rather than the default enemy target — so no executor change is needed. Self-effects on the reactor (FrontLine's Shield) resolve to the owner as usual.

## Piece 2 — Parser → reaction abilities

Extend the skill-text parser to detect the `"When an enemy uses their charged skill, ..."` lead-in and emit reaction abilities on the `on-enemy-charged-cast` trigger. The effect clauses reuse existing parse paths:

- **Curator** → up to two abilities on the trigger:
  - `{ type:'purge', target:'enemy', trigger:'on-enemy-charged-cast', config:{ amount:N } }`
  - (epic/legendary only) `{ type:'debuff', target:'enemy', trigger:'on-enemy-charged-cast', config:{ buffName:'Block Buff', durationTurns:N } }`
- **FrontLine** → two abilities on the trigger, **once per round**:
  - `{ type:'damage', target:'enemy', trigger:'on-enemy-charged-cast', config:{ damagePercent:80 }, oncePerRound:true }`
  - `{ type:'shield', target:'self', trigger:'on-enemy-charged-cast', config:{ /* shield = 30% of damage dealt */ }, oncePerRound:true }`

The exact config shapes follow whatever the existing purge/debuff/damage/shield reaction abilities already use (the plan will pin field names against current types). FrontLine's "Shield equal to 30% of the damage dealt" reuses the existing damage-dealt-basis shield path; if that basis isn't already reachable for a reaction shield, the plan calls it out.

`oncePerRound` reuses the D-PR14 machinery (`Ability.oncePerRound` + per-round `IntentExecContext.oncePerRoundConsumed` Set): check-consumed → proc/effect → mark-on-success. Both FrontLine abilities share one gate so a single enemy charged cast fires the pair at most once per round; a second enemy charged cast in the same round does not re-fire.

## Piece 3 — Block Buff primitive

New module `src/utils/combat/blockBuffBuffs.ts`, mirroring `debuffImmunity.ts` / `buffProtectionBuffs.ts`:

```ts
export const BLOCK_BUFF_BUFFS: ReadonlySet<string> = new Set(['Block Buff']);
export const isBlockBuff = (name: string): boolean => BLOCK_BUFF_BUFFS.has(name);

/** True if `recipientId` currently carries a Block Buff status (inflicted on it, so it lives
 *  in the per-target debuff store — read via ownerDebuffNamesFor, NOT selfBuffNamesForOwners). */
export function recipientCarriesBlockBuff(statusEngine: StatusEngine, recipientId: string): boolean {
    return ownerDebuffNamesFor(statusEngine, recipientId).some(isBlockBuff);
}
```

`ownerDebuffNamesFor` (triggers.ts:931) reads `enemyMaps[targetId]` — the per-target store where inflicted statuses land. The statusEngine is unified across both teams and keyed by actor id, so this works **symmetrically**: a Block-Buffed player and a Block-Buffed enemy are both detected by reading their own inflicted-debuff store. The triggers↔blockBuffBuffs import is a call-time-safe cycle (`eslint-disable import/no-cycle`, the established repo pattern used by `debuffImmunity.ts`).

### Guard seams (timed apply seams only — user decision)

A recipient carrying Block Buff is **skipped per-recipient** at the timed self-buff application sites:

1. **Firing-skill self/ally buffs** — `playerTurn.ts` ~1095, inside `for (const rid of status.recipients ?? [actor.id])`: `if (recipientCarriesBlockBuff(statusEngine, rid)) continue;` before `applyTimedAbilityStatus`. This covers **both sides** (enemies run the same `runPlayerTurn` path) and covers self-buffs, single-ally grants, and all-allies grants (each recipient guarded independently).
2. **Reactive ally-buff grants** — the `cfg.type === 'buff'` executor in `triggers.ts`: guard each recipient before granting.

**Silent skip (user decision):** a blocked buff simply does not apply. No event, no log row, no new event type. Byte-identical plumbing.

### Out of scope (documented limitations)

- **Aura / accumulating buffs** are re-gated on read (not applied once), so a Block-Buffed unit's own recurring auras keep folding. Blocking those would touch the read-time folding path and risk golden movement. Noted in-code at the primitive.
- **Start-of-combat passive seeding** (engine.ts ~320) is NOT guarded: Block Buff is only ever inflicted mid-combat via a reaction, so no unit carries it at round-1 seeding. Noted in-code.

Block Buff does not remove existing buffs, does not alter stat folding, and is not granted to self by any in-scope ship — so it cannot move existing goldens.

## Editor / surfaces

- `on-enemy-charged-cast` → a `TRIGGER_OPTIONS` stub in `AbilityCard.tsx` (consistent with prior new triggers; no exhaustiveness test forces more).
- Block Buff already exists in `buffs.ts` (line 274) and `MANUAL_BUFFS`; no buff-registry change.
- DPS calculator page NOT wired — these are defensive/control/targeting reactions, not outgoing DPS for the reactor.

## Testing

Parser unit tests (Curator three refit tiers; FrontLine) + engine golden snapshots. Per project rule, never `vitest -u` to bless goldens blindly — inspect every diff. Dev server `:3000`; `gh auth switch --user TheSusort` for git/PR ops.

Engine goldens:
- **Curator purge-on-enemy-charged** — an enemy casts its charged skill; Curator purges N buffs from that enemy.
- **Curator Block-Buff-on-enemy-charged** — epic/legendary: purge + inflict Block Buff; then prove the enemy carrying Block Buff cannot gain a self-buff on its next turn (the primitive's behavioral assertion).
- **FrontLine damage+shield-on-enemy-charged** — deals 80% to the casting enemy + gains Shield = 30% of damage dealt.
- **Once-per-round limiting** — a second enemy charged cast in the same round does not re-fire FrontLine.
- **Block Buff symmetry** — a Block-Buffed unit (player OR enemy) is blocked from receiving a buff; an un-Block-Buffed unit is not (gate-flip, not vacuous).

## Docs / changelog

- `UNRELEASED_CHANGES` in `src/constants/changelog.ts`: reactions to enemy charged skills (Curator/FrontLine) + Block Buff now prevents the affected enemy from gaining buffs.
- Update `DocumentationPage.tsx` if its combat-mechanics section enumerates charge behavior or control effects.

## Risks

- **New opposing-scoped trigger** — genuinely new surface, but low risk: `registerReactiveListeners` is already team-agnostic and the trigger is a structural mirror of `on-enemy-repaired`.
- **Targeting "that enemy"** — the reaction must hit the casting enemy, not the default enemy target; as-built this reuses the existing `eventCtx.counterTargetId` field (already threaded into executor target resolution like `repairerId`), so no new wiring is needed.
- **Block Buff seam completeness** — guarding only the timed apply seams is a deliberate scope; aura/start-of-combat exclusions are documented limitations, not bugs.
```
