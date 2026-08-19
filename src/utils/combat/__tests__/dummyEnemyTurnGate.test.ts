/**
 * Dummy `enemy` turn gate.
 *
 * The engine carries a vestigial dummy `enemy` actor (id 'enemy') that is the player-offense
 * damage sink in DPS-calc mode. In a POSITIONAL team-vs-team sim it is not a real combatant —
 * every player resolves a real positioned enemy target, so the dummy never receives anything and
 * its DoT-tick turn is a pure no-op that only leaked a phantom "enemy" line into the combat log.
 *
 * This test pins the gate: the dummy `enemy` takes a turn (emits turn-started) ONLY when the
 * battle is NOT fully positional. In a positional-complete battle it is excluded from the turn
 * order entirely.
 *
 * PRECISION on "positional-complete", because the distinction is what this file's fixtures turn on.
 * `dummyEnemyIsVestigial` (engine.ts:2680-2686) is an AND of TWO conjuncts:
 *   1. `enemyAttackerActors.some(isTargetableRosterMember)` — TARGETABLE (positioned AND max
 *      hp > 0), not merely POSITIONED;
 *   2. `allPlayerActors.every(a => a.position != null && t?.side === 'enemy')` — every player actor
 *      positioned AND aiming its parsed ACTIVE target at the ENEMY side.
 *
 * Conjunct 1 is now a TAUTOLOGY and no longer discriminates anything: SP-4b-1 positions every
 * enemy, SP-4b-2b refuses an empty roster, and SP-4c-2a's `MIN_TARGETABLE_MAX_HP` floor
 * (`normalizeRoster.ts`) raises every enemy attacker's max HP above 0 — so the placed-but-unhittable
 * 0-max-HP roster that USED to be this file's route into the not-fully-positional branch cannot be
 * constructed any more (see the TRIPWIRE case below).
 *
 * Conjunct 2 is still FALSIFIABLE, and it is the live route the cases below use: a player actor
 * whose parsed ACTIVE target is ALLY-side (a healer or support ship) fails `t?.side === 'enemy'`,
 * so the whole AND is false even with a real, hittable, positioned enemy on the board — and the
 * dummy stays in the turn order. That shape survives the normalization boundary by design:
 * `withTargeting` FILLS an absent target but never SUBSTITUTES an ally-side one ("FILL, never
 * SUBSTITUTE", `normalizeRoster.ts:79-81`).
 *
 * ⭐ SP-4c HAND-OFF. This whole file's SUBJECT — the dummy's turn-order gate — is deleted by SP-4c
 * along with the dummy itself, so these cases go with it rather than being migrated: once there is
 * no dummy there is no actor for the gate to include or exclude.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { bareEnemy } from '../__testutils__/bareRosterFixture';
import { normalizeCombatRoster, MIN_TARGETABLE_MAX_HP } from '../normalizeRoster';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `det${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});
const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
/**
 * An ALLY-side active target — a healer/support ship's binding.
 *
 * This is the live falsifier of `dummyEnemyIsVestigial`'s SECOND conjunct (`t?.side === 'enemy'`),
 * and the only one left now the floor has made the first conjunct a tautology. It reaches the engine
 * unrewritten: `normalizeCombatRoster`'s `withTargeting` fills an ABSENT target only.
 */
const allySideTarget = (): ParsedTarget => ({
    raw: 'ally-team',
    side: 'ally',
    selection: 'team',
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } })],
});

const basicEnemyAt = (id: string, position: Position): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 1,
            security: 0,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [basicAttack()] },
    }) as EnemyAttacker;

const BASE = (over: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    // A 0-max-HP roster: what USED to be the "pressure source" idiom (placed but unhittable, so
    // `dummyEnemyIsVestigial`'s first conjunct read false and the dummy stayed in the turn order).
    // SP-4c-2a's floor retired the idiom — this member now arrives at the engine at
    // MIN_TARGETABLE_MAX_HP, and the TRIPWIRE case below is the only thing that still cares. The
    // cases that need the dummy in the turn order falsify the SECOND conjunct instead
    // (`allySideTarget`), and override this roster with a genuinely hittable enemy.
    enemyAttackers: bareEnemy({ id: 'pressure-source', stats: { hp: 0 } }),
    attack: 10000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttack()] },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000_000,
    speed: 100,
    ...over,
});

const enemyTurnStartedCount = (input: CombatEngineInput): number => {
    const bus = createEventBus();
    let count = 0;
    bus.on('turn-started', (e: Extract<CombatEvent, { type: 'turn-started' }>) => {
        if (e.actorId === 'enemy') count += 1;
    });
    runCombat({ ...input, bus });
    return count;
};

describe('dummy enemy turn gate', () => {
    // The two cases below are a MATCHED PAIR over the ONE conjunct the floor left falsifiable, so
    // the file distinguishes the gate's two branches instead of only observing one. They differ in
    // a single field — the focus's parsed active target's `side` — and the roster is a real,
    // positioned, hittable enemy in BOTH, so the first conjunct is true in both and cannot be what
    // moves the reading.
    //
    // The claim this pair restores is the one this file was written for and which SP-4c-2a's first
    // pass wrongly conceded as unconstructible: the dummy still takes its tick turn while a player
    // actor could still fall back to it.
    it('a player actor with an ALLY-side target: the dummy enemy still takes its tick turn', () => {
        idc = 0;
        // The focus is a support ship: positioned at M4, active target ALLY-side. Conjunct 2 of
        // `dummyEnemyIsVestigial` (`t?.side === 'enemy'`) is therefore false → the AND is false →
        // the dummy is NOT dropped from the turn order and emits `turn-started` on its own turn.
        // (Derivation of the bound: every actor in the turn order takes one turn per round, so with
        // BASE's `numRounds: 1` this is a single dummy turn. The original assertion this restores
        // was `> 0`, which is kept: extra-action grants could legitimately add turns, and the
        // load-bearing claim is "the dummy is in the turn order at all".)
        const count = enemyTurnStartedCount(
            BASE({
                healTargetId: 'attacker',
                mode: 'healing',
                position: 'M4',
                target: allySideTarget(),
                pattern: basePattern(),
                enemyAttackers: [basicEnemyAt('enemy-front', 'M4')],
            })
        );
        expect(count).toBeGreaterThan(0);
    });

    it('positional team-vs-team: the dummy enemy is excluded from the turn order', () => {
        idc = 0;
        // The CONTROL for the case above: identical fixture, `side: 'enemy'` instead of `'ally'`.
        // Both conjuncts hold → positional-complete → the dummy is vestigial and dropped.
        const count = enemyTurnStartedCount(
            BASE({
                healTargetId: 'attacker',
                mode: 'healing',
                position: 'M4',
                target: parsedTarget('front'),
                pattern: basePattern(),
                enemyAttackers: [basicEnemyAt('enemy-front', 'M4')],
            })
        );
        expect(count).toBe(0);
    });

    // TRIPWIRE, and ONLY a tripwire — the coverage it replaces is restored above, not conceded.
    //
    // What IS gone is the ROUTE this file's old first case took into the not-fully-positional
    // branch: BASE's 0-max-HP "pressure source" roster, which `dummyEnemyIsVestigial`'s FIRST
    // conjunct (`enemyAttackerActors.some(isTargetableRosterMember)`, i.e. max hp > 0) read as
    // not-fully-positional. SP-4c-2a's floor makes that FIRST CONJUNCT — not the whole gate — a
    // tautology, so the roster can no longer be built.
    //
    // This case asserts that premise directly. It fails, and so flags that the retired route is
    // constructible again, if EITHER:
    //   • the floor is removed or gains an escape hatch (`withTargetableHp` in normalizeRoster.ts,
    //     which today floors unconditionally); or
    //   • `isTargetableRosterMember` is re-keyed from STATIC `stats.hp` to live `currentHp`
    //     (positionalBinding.ts:45) — a corpse would then read as untargetable and reopen the
    //     shape from the other end, which the HP assertion here would not otherwise notice.
    it('TRIPWIRE: the 0-max-HP route into the not-fully-positional branch is gone — the floor arrives already hittable', () => {
        const floored = normalizeCombatRoster(BASE());
        expect(floored.enemyAttackers[0].stats.hp).toBe(MIN_TARGETABLE_MAX_HP);
    });
});
