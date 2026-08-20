/**
 * ⚠️ THE FILENAME IS NOW HISTORY: THERE IS NO DUMMY `enemy` TURN GATE. SP-4c-2c deleted it.
 *
 * WHAT THIS FILE IS TODAY, in one sentence: a TRIPWIRE that the dummy `enemy` (id 'enemy') is in NO
 * turn order, asserted through both branches of the retired gate. The name is left alone only
 * because SP-4c-2d deletes the whole file with the actor; renaming it now would churn a file with
 * one rung to live.
 *
 * WHAT THE DUMMY IS. A vestigial actor that is still built and is still a member of
 * `allActors`/`allActorsById` — the enemy side's structural counterpart — and nothing else that
 * matters. It USED TO BE the player-offense damage sink in DPS-calc mode; SP-4c-2b ended that
 * (`selectTurnTarget` no longer hands it to a player actor at all — a player that resolves nobody
 * gets `tgt: undefined` and runs a no-victim turn). It USED TO OWN a DoT-tick turn, which is what
 * this file was originally written about; SP-4c-2c ended that too — `turnOrderActors` drops it
 * unconditionally, so it never acts on any run and the phantom "enemy" line it used to leak into
 * the combat log is gone.
 *
 * WHAT THE RETIRED GATE WAS, kept because the two cases below are still shaped by it. The deleted
 * `dummyEnemyIsVestigial` was an AND of TWO conjuncts, and it dropped the dummy's turn when both
 * held:
 *   1. `enemyAttackerActors.some(isTargetableRosterMember)` — TARGETABLE (positioned AND max
 *      hp > 0), not merely POSITIONED;
 *   2. `allPlayerActors.every(a => a.position != null && t?.side === 'enemy')` — every player actor
 *      positioned AND aiming its parsed ACTIVE target at the ENEMY side.
 * Conjunct 1 had already become a TAUTOLOGY before the gate died: SP-4b-1 positions every enemy,
 * SP-4b-2b refuses an empty roster, and SP-4c-2a's `MIN_TARGETABLE_MAX_HP` floor
 * (`normalizeRoster.ts`) raises every enemy attacker's max HP above 0 — so the placed-but-unhittable
 * 0-max-HP roster that USED to be this file's route into the not-fully-positional branch cannot be
 * constructed any more (that premise is what the TRIPWIRE case below pins).
 * Conjunct 2 was the last falsifiable one, and it is why the first case below exists: a player actor
 * whose parsed ACTIVE target is ALLY-side (a healer or support ship) failed `t?.side === 'enemy'`,
 * so the whole AND read false even with a real, hittable, positioned enemy on the board — and the
 * dummy KEPT its turn. That was the last shape in which the dummy acted at all. It survives the
 * normalization boundary by design (`withTargeting` FILLS an absent target but never SUBSTITUTES an
 * ally-side one — "FILL, never SUBSTITUTE", `normalizeRoster.ts:79-81`), which is what makes it a
 * usable fixture even now that it changes nothing.
 *
 * SO THE TWO CASES ARE A MATCHED PAIR reading the SAME answer — the dummy is absent — off the two
 * branches of the dead gate. Keep both: a single case would be satisfied by a reintroduced gate that
 * happened to pick the branch it exercises.
 *
 * ⭐ SP-4c-2d HAND-OFF. This whole file goes with the dummy rather than being migrated: once there
 * is no dummy there is no actor whose absence from the turn order could be asserted.
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
 * This WAS the last falsifier of the retired `dummyEnemyIsVestigial`'s SECOND conjunct
 * (`t?.side === 'enemy'`), the only one left once the floor made the first conjunct a tautology, and
 * therefore the last shape that kept the dummy in the turn order. Since SP-4c-2c it falsifies
 * nothing — there is no gate — and it is kept because it still SELECTS that branch's fixture shape.
 * It reaches the engine unrewritten: `normalizeCombatRoster`'s `withTargeting` fills an ABSENT
 * target only.
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
    // A 0-max-HP roster: what USED to be the "pressure source" idiom (placed but unhittable, so the
    // retired `dummyEnemyIsVestigial`'s first conjunct read false and the dummy stayed in the turn
    // order). SP-4c-2a's floor retired the idiom — this member now arrives at the engine at
    // MIN_TARGETABLE_MAX_HP, and the TRIPWIRE case below is the only thing that still cares. NOTHING
    // puts the dummy in the turn order any more (SP-4c-2c); the two cases below both override this
    // roster with a genuinely hittable enemy and differ only in which branch of the DEAD gate their
    // target side would have selected.
    enemyAttackers: bareEnemy({ id: 'pressure-source', stats: { hp: 0 } }),
    attack: 10000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttack()] },
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

/**
 * The ordered ids of every actor that emitted `turn-started`, NOT a count of one id.
 *
 * Deliberately a ROSTER and not a counter: a counter keyed on `'enemy'` reads 0 both when the dummy
 * is correctly absent AND when the sensor itself is broken (event renamed, dummy re-id'd, bus
 * unwired), which is the repo's fixture-vacuity defect class. Asserting the whole roster makes the
 * dummy's absence a POSITIVE observation — the actors that DID act have to be named for the
 * assertion to pass, so a dead sensor reads `[]` and fails.
 */
const actorIdsThatTookTurns = (input: CombatEngineInput): string[] => {
    const bus = createEventBus();
    const ids: string[] = [];
    bus.on('turn-started', (e: Extract<CombatEvent, { type: 'turn-started' }>) => {
        ids.push(e.actorId);
    });
    runCombat({ ...input, bus });
    return ids;
};

describe('dummy enemy turn gate', () => {
    // The two cases below are a MATCHED PAIR over the ONE conjunct the floor left falsifiable, so
    // the file reads the dummy's absence through BOTH branches of the retired gate instead of only
    // one. They differ in a single field — the focus's parsed active target's `side` — and the
    // roster is a real, positioned, hittable enemy in BOTH, so the first conjunct would have been
    // true in both and cannot be what moves the reading.
    //
    // BOTH NOW ASSERT THE SAME OUTCOME, and that is the rung's whole point: SP-4c-2c dropped the
    // dummy unconditionally, so the branch that used to keep its tick turn no longer does. The pair
    // is a tripwire against the gate being reintroduced, not a distinction between two behaviours.
    it('a player actor with an ALLY-side target: the dummy STILL takes no turn', () => {
        idc = 0;
        // SP-4c-2c INVERTED THIS CASE, and it is now the file's most load-bearing one.
        //
        // Until this rung the reading was `> 0`: the focus is a support ship (positioned at M4,
        // active target ALLY-side), so conjunct 2 of the retired `dummyEnemyIsVestigial`
        // (`t?.side === 'enemy'`) was false, the AND was false, and the dummy stayed in the turn
        // order to tick its containers. That was the LAST shape in which the dummy acted.
        //
        // The gate is gone: `turnOrderActors` now drops the dummy unconditionally. This case and
        // its enemy-side twin below are therefore a MATCHED PAIR reading the dummy's absence
        // through the two branches of the retired gate. That makes them a tripwire against the
        // gate being reintroduced — but only because each asserts the WHOLE `turn-started` roster
        // rather than a count of one id: the dummy's absence is witnessed alongside the presence
        // of the actors that DID act, so a sensor that stopped observing anything fails here
        // instead of reading a green 0. Keep BOTH: a single case could be satisfied by a
        // reintroduced gate that happened to pick the branch it exercises.
        expect(
            actorIdsThatTookTurns(
                BASE({
                    healTargetId: 'attacker',
                    mode: 'healing',
                    position: 'M4',
                    target: allySideTarget(),
                    pattern: basePattern(),
                    enemyAttackers: [basicEnemyAt('enemy-front', 'M4')],
                })
            )
        ).toEqual(['attacker', 'enemy-front']);
    });

    it('positional team-vs-team: the dummy enemy is excluded from the turn order', () => {
        idc = 0;
        // The CONTROL for the case above: identical fixture, `side: 'enemy'` instead of `'ally'`.
        // This is the branch where BOTH conjuncts of the retired gate held, so the dummy was
        // dropped even before SP-4c-2c — this case therefore reads the same as it always did, and
        // it is the ally-side twin above that moved. Same whole-roster assertion, and the same
        // roster: flipping the target's side moves who each actor SHOOTS, never who TAKES A TURN.
        expect(
            actorIdsThatTookTurns(
                BASE({
                    healTargetId: 'attacker',
                    mode: 'healing',
                    position: 'M4',
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    enemyAttackers: [basicEnemyAt('enemy-front', 'M4')],
                })
            )
        ).toEqual(['attacker', 'enemy-front']);
    });

    // TRIPWIRE, and ONLY a tripwire. It pins a PREMISE the header leans on, not a behaviour of the
    // engine's turn order — the turn-order claim is the matched pair above.
    //
    // The premise: the ROUTE this file's old first case took into the not-fully-positional branch is
    // unconstructible. That route was BASE's 0-max-HP "pressure source" roster, which the retired
    // `dummyEnemyIsVestigial`'s FIRST conjunct (`enemyAttackerActors.some(isTargetableRosterMember)`,
    // i.e. max hp > 0) read as not-fully-positional. SP-4c-2a's floor made that conjunct a tautology
    // and so the roster can no longer be built; SP-4c-2c then deleted the gate outright, which is
    // why this case is now the only thing in the file that still refers to the conjuncts at all.
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
