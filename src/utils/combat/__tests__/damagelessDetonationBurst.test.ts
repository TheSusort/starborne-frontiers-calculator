import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability } from '../../../types/abilities';
import { bareEnemy } from '../__testutils__/bareRosterFixture';

// ─────────────────────────────────────────────────────────────────────────────
// A cast that DETONATES but deals no damage bursts nothing at all (#368, #374).
//
// Found while proving the aggregate standing-leech arm unreachable, which is why it is worth a
// test of its own: it is the reason that arm could not be reached through the detonation channel.
//
// The engine has TWO positional predicates and they disagree on exactly this input:
//
//   · the HINT passed into runPlayerTurn — `willApplyPositionally` (engine.ts) — is
//     `resolvesPositionalVictim && target != null && pattern != null`, and OMITS positionalScalars.
//   · the engine's own `positional` adds `tgt !== undefined && turn.positionalScalars != null`,
//     and `positionalScalars != null` is exactly `hasDamageAbility` (playerTurn.ts).
//
// So for a cast with no `type: 'damage'` ability the hint is TRUE while `positional` is FALSE.
// playerTurn therefore takes its `if (positional)` arm: it leaves `detonationDamage` at 0 and
// returns a `positionalDetonation` recipe instead — and the engine consumes that recipe only
// inside its own `if (positional)` block. Nothing consumes it, and the burst is dropped.
//
// CORPUS-INERT, which is why this pins the behaviour instead of fixing it. All 149 shipped ships
// were scanned through `buildTraceShip` + `buildShipAbilities`: exactly 3 carry a `detonate-dot`
// ability — Crocus (Corrosion 180%), Incinerator (Inferno 180%) and Demolisher (Bomb 150%) — and
// all 3 detonate on their CHARGED skill, which also deals damage in the same slot. Rate control:
// 249 slots carry a damage ability, so the scan was not silently finding nothing.
//
// WHAT A PLAYER WOULD SEE if such a ship shipped: the charged skill animates, the charge is spent,
// and nothing happens — no burst number, and the Corrosion stacks still sitting on the enemy,
// still ticking normally. It reads as a dud skill rather than a wrong number.
//
// If the drop is ever fixed, the `detonationDamage === 0` assertion below goes RED and this comment
// is where to start.
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

/** A standing leech: passive-slot heal on basis 'damage-dealt' — the Magnolia/Valerian shape. */
const selfLeech = (pct: number): Ability =>
    ab({
        type: 'heal',
        target: 'self',
        config: { type: 'heal', pct, basis: 'damage-dealt', leechScope: 'all' },
    });

describe('a damage-less detonation cast', () => {
    const run = (): ReturnType<typeof runCombat> => {
        idCounter = 0;
        return runCombat(
            BASE({
                numRounds: 3,
                healTargetId: 'attacker',
                mode: 'healing',
                shipSkills: {
                    slots: [
                        {
                            // NO `type: 'damage'` ability anywhere — that is the whole point:
                            // hasDamageAbility false ⟹ positionalScalars undefined ⟹ the engine's
                            // `positional` is false while the runPlayerTurn hint is true.
                            slot: 'active',
                            abilities: [applyCorrosion(), detonateCorrosion()],
                        },
                        { slot: 'passive', abilities: [selfLeech(20)] },
                    ],
                },
            })
        );
    };

    it('drops its burst entirely', () => {
        const result = run();
        // Liveness — the cast really is damage-less, so `positional` really is false. Without this
        // the rest could pass on a fixture that simply never fired.
        expect(result.rounds).toHaveLength(3);
        expect(result.rounds.every((r) => r.directDamage === 0)).toBe(true);
        // Existence — the Corrosion DID land and IS ticking, so there was something to burst. A
        // fixture whose DoT silently failed to land would otherwise look identical to this one.
        expect(result.rounds.some((r) => r.corrosionDamage > 0)).toBe(true);
        // The claim: stacks on the enemy, a detonate clause on the cast, and no burst.
        expect(result.rounds.every((r) => r.detonationDamage === 0)).toBe(true);
    });

    it('still pays out its standing leech off the DoT ticks (the #372 instrument)', () => {
        const result = run();
        // The useful half of this fixture: the Corrosion TICKS credit through
        // `procStandingLeechesPerVictim`, so `directHeal` is 20% of the corrosion damage even
        // though the burst was dropped and no cast heal exists. That makes this a run whose ONLY
        // healing is a standing leech — the shape #372 needs to assert that the Simulator's
        // reported hpPct matches the engine's real currentHp.
        const healed = (result.healing?.rounds ?? []).reduce(
            (sum, rd) => sum + (rd.perActor.get('attacker')?.directHeal ?? 0),
            0
        );
        const corrosion = result.rounds.reduce((s, r) => s + r.corrosionDamage, 0);
        expect(corrosion).toBeGreaterThan(0);
        expect(healed).toBeCloseTo(corrosion * 0.2, 4);
    });
});
