import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    runCombat,
    CombatEngineInput,
    __getAggregateStandingLeechApplications,
    __resetAggregateStandingLeechApplications,
} from '../engine';
import { Ability } from '../../../types/abilities';
import { bareEnemy } from '../__testutils__/bareRosterFixture';

// ─────────────────────────────────────────────────────────────────────────────
// #368 — the AGGREGATE `procStandingLeeches` arm, and WHY no fixture reaches it.
//
// #368 asked for "one fixture per unexercised site". For the aggregate standing-leech arm that
// turns out to be impossible, and this file is the executable record of the reason — the argument
// is short enough to check, and the fixture below pins the one step of it that could change.
//
// The arm is fed ONLY by `creditDamage`, whose two call sites both sit inside `if (!positional)`:
//
//     positional = tgt !== undefined && resolvesPositionalVictim(actor.position, enemies) &&
//                  target != null && pattern != null && turn.positionalScalars != null
//
// Every route to `!positional` also zeroes the amount, and `procStandingLeeches` returns early on
// `amount <= 0`:
//
//   · `tgt === undefined` (an ally-targeted cast) — runPlayerTurn fences its damage assembly on
//     `hasVictim`, so `turn.directDamage` is literally 0.
//   · `positionalScalars == null` — that is exactly `hasDamageAbility` (playerTurn.ts:3210, :4767),
//     so there is no damage clause to produce an amount.
//   · `resolvesPositionalVictim` false — `withTargetableHp` floors every ENEMY attacker's max HP
//     (normalizeRoster.ts), so on the player side this agrees with `isPositional`; the only way to
//     falsify it is an empty opposing roster, which again means no damage.
//   · `target`/`pattern` null — `normalizeCombatRoster` fills both for every actor.
//
// That leaves the DETONATION channel, `creditDamage(id, 'detonation', turn.detonationDamage)`,
// which does not need a damage clause. It is the one route with a non-obvious answer, and the test
// below is what closes it: `turn.detonationDamage` is ALSO always 0 here, because playerTurn
// assembles it in the `else if (hasVictim)` arm — reached only when the positional HINT is false.
// The hint (engine.ts:10459 `willApplyPositionally`) is `resolvesPositionalVictim && target != null
// && pattern != null` and deliberately OMITS `positionalScalars`, so a damage-less cast has
// hint TRUE while the engine's own `positional` is FALSE. playerTurn therefore takes its
// `if (positional)` arm, leaves `detonationDamage` at 0, and returns a `positionalDetonation`
// recipe — which the engine consumes only inside `if (positional)` (engine.ts:10617). Nothing
// consumes it, and the burst is silently dropped.
//
// So the aggregate arm is unreachable BY CONSTRUCTION, not merely by corpus. `leech.test.ts` owns
// the standing-leech coverage and asserts the counter stays 0; this file adds the same assertion
// over the one shape that looked like a way in.
//
// SIDE FINDING, measured and deliberately left alone here: the dropped burst above is a real
// behavioural gap — a cast that detonates without dealing damage bursts nothing at all. It is
// CORPUS-INERT: all 149 shipped ships were scanned through `buildTraceShip` + `buildShipAbilities`,
// 3 carry a `detonate-dot` ability, and all 3 pair it with a `damage` ability in the same slot
// (rate control: 249 slots carry a damage ability, so the scan was not silently finding nothing).
// The test below pins the current behaviour so that a future fix to the drop goes RED here rather
// than silently activating a non-team-symmetric heal route.
// ─────────────────────────────────────────────────────────────────────────────

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `r${++idCounter}`,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: bareEnemy({
        id: 'corrosion-host',
        stats: { hp: 10_000_000, security: 0 },
    }),
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
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
    defence: 2000,
    hp: 10000,
    // hacking 100 against a security-0 enemy → landing chance 1.0, so the Corrosion always lands.
    hacking: 100,
    ...overrides,
});

/** Applies Corrosion. `tier` is the MAGNITUDE (3/6/9), not a 1..3 level. */
const applyCorrosion = (): Ability =>
    ab({
        type: 'dot',
        target: 'enemy',
        config: { type: 'dot', dotType: 'corrosion', tier: 9, stacks: 3, duration: 3 },
    });

const detonateCorrosion = (): Ability =>
    ab({
        type: 'detonate-dot',
        target: 'enemy',
        config: { type: 'detonate-dot', dotType: 'corrosion', powerPct: 100 },
    });

/** A standing leech: passive-slot heal on basis 'damage-dealt', scope 'all' (every channel). */
const selfLeech = (pct: number): Ability =>
    ab({
        type: 'heal',
        target: 'self',
        config: { type: 'heal', pct, basis: 'damage-dealt', leechScope: 'all' },
    });

// Vitest isolates modules per test FILE, so this counter reads only this file's runs.
beforeAll(() => __resetAggregateStandingLeechApplications());
afterAll(() => {
    expect(__getAggregateStandingLeechApplications()).toBe(0);
});

describe('#368 aggregate procStandingLeeches — unreachable by construction', () => {
    it('a damage-less detonation cast drops its burst, so the aggregate arm still never runs', () => {
        idCounter = 0;
        const result = runCombat(
            BASE({
                numRounds: 3,
                healTargetId: 'attacker',
                mode: 'healing',
                shipSkills: {
                    slots: [
                        {
                            // NO `type: 'damage'` ability anywhere — that is the whole point:
                            // hasDamageAbility false ⟹ positionalScalars undefined ⟹ the engine's
                            // `positional` is false, which is the aggregate arm's precondition.
                            slot: 'active',
                            abilities: [applyCorrosion(), detonateCorrosion()],
                        },
                        { slot: 'passive', abilities: [selfLeech(20)] },
                    ],
                },
            })
        );

        // Liveness — the cast really is damage-less, so `positional` really is false. Without this
        // the rest could pass on a fixture that simply never fired.
        expect(result.rounds.every((r) => r.directDamage === 0)).toBe(true);
        // Existence — the Corrosion DID land, so there was something available to burst. A fixture
        // whose DoT silently failed to land would otherwise look identical to this one.
        expect(result.rounds.length).toBe(3);
        expect(result.rounds.some((r) => r.corrosionDamage > 0)).toBe(true);

        // THE PINNED DEFECT: three stacks of Corrosion are sitting on the enemy and the cast
        // carries a detonate clause, yet nothing bursts — the recipe is built and never consumed.
        expect(result.rounds.every((r) => r.detonationDamage === 0)).toBe(true);

        // THE CONSEQUENCE for #368: no detonation credit ⟹ `amount <= 0` ⟹ the aggregate arm
        // returns before its entry loop. The counter stays 0 even on this fixture, which was the
        // last shape that looked like a way in.
        expect(__getAggregateStandingLeechApplications()).toBe(0);

        // ...and yet the standing leech DOES pay out here, which is the useful half of this
        // fixture: the Corrosion TICKS credit through `procStandingLeechesPerVictim` (the live
        // twin), so `directHeal` is 20% of the corrosion damage. This is a run whose ONLY healing
        // is a standing leech and whose cast heals nothing — the instrument #372 needs for its
        // "reported hpPct must match the engine's currentHp" assertion.
        const healed = (result.healing?.rounds ?? []).reduce(
            (sum, rd) => sum + (rd.perActor.get('attacker')?.directHeal ?? 0),
            0
        );
        const corrosion = result.rounds.reduce((s, r) => s + r.corrosionDamage, 0);
        expect(healed).toBeGreaterThan(0);
        expect(healed).toBeCloseTo(corrosion * 0.2, 4);
    });
});
