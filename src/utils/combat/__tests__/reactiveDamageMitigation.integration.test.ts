/**
 * Epic PR4b: the reactive `damage` executor (triggers.ts `cfg.type === 'damage'`) now runs the
 * SAME defense-mitigated, crit-eligible pipeline as an on-cast hit (`ctx.applyReactiveDamage`,
 * mirroring the `counter` branch's `applyCounterAttack`) instead of the old flat
 * `effectiveAttack × multiplier × affinityMult` fold with NO mitigation and NO crit.
 *
 * These are FULL engine-integration tests (via `runCombat`, healing mode, the same harness style
 * as `enemyChargedCast.integration.test.ts`), exercising FrontLine's real on-enemy-charged-cast
 * shape (the one member of the affected family whose trigger carries a genuine
 * `eventCtx.counterTargetId` — the real casting actor — so the victim resolved by the `damage`
 * branch is a REAL, concrete actor on either side, not the ctx.enemy default fallback).
 *
 * RED STATUS (pre-PR4b baseline): tests 1 and 2 below FAIL (no mitigation, no crit ever rolled).
 * Test 3 (noCrit pin) PASSES both before and after — it is a negative control proving the flag
 * still suppresses crit under the NEW formula, not just under the old no-crit-ever executor.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import { dealtBy } from '../__testutils__/perTargetDealt';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `rdm${++idCounter}`,
    target: 'enemy',
    trigger: 'on-enemy-charged-cast',
    conditions: [],
    ...partial,
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** A reactive `damage` ability on the on-enemy-charged-cast trigger (FrontLine's real shape). */
const reactiveDamage = (multiplier: number, opts: { noCrit?: boolean } = {}): ShipSkills => ({
    slots: [
        {
            slot: 'passive',
            abilities: [
                ab({
                    type: 'damage',
                    config: { type: 'damage', multiplier, hits: 1, ...opts },
                }),
            ],
        },
    ],
});

/** A minimal (non-reactive) damage ability — used so the enemy's active/charged slots carry a
 *  real multiplier>0 damage ability (`hasChargedSkill` requires this — see engine.ts's
 *  hasChargedSkill derivation: `chargeCount >= 1 && charged-slot multiplier > 0`). */
const basicDamage = (multiplier: number, id: string): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

/** A basic enemy that ALWAYS fires its CHARGED skill on turn 1 (startCharged, chargeCount 1),
 *  with a configurable defence — the victim of a PLAYER-owned reactive. Both active/charged
 *  slots carry a real (non-reactive, on-cast) damage ability so `hasChargedSkill` is true. */
const chargedCastEnemy = (id: string, defence: number): EnemyAttacker => ({
    id,
    stats: { attack: 100, crit: 0, critDamage: 0, defence, hp: 1_000_000_000, speed: 40 },
    chargeCount: 1,
    startCharged: true,
    shipSkills: {
        slots: [
            { slot: 'active', abilities: [basicDamage(50, `${id}-a`)] },
            { slot: 'charged', abilities: [basicDamage(150, `${id}-c`)] },
        ],
    },
});

/** A control enemy that never charges — the on-enemy-charged-cast reaction never fires. */
const nonChargingEnemy = (id: string, defence: number): EnemyAttacker => ({
    id,
    stats: { attack: 100, crit: 0, critDamage: 0, defence, hp: 1_000_000_000, speed: 40 },
    chargeCount: 99,
    startCharged: false,
    shipSkills: {
        slots: [{ slot: 'active', abilities: [basicDamage(50, `${id}-a`)] }],
    },
});

/** Player-focus input: the focus OWNS the reactive `damage` ability (passive slot) and reacts to
 *  its opposing enemy's charged cast. Focus HP is huge so it never dies; its own active hit is
 *  ability-free (0% — isolates the reactive credit from any of the focus's own damage). */
const buildPlayerOwnerInput = (opts: {
    reactionAbilities: ShipSkills;
    enemy: EnemyAttacker;
    crit?: number;
    critDamage?: number;
}): CombatEngineInput => ({
    attack: 10_000,
    crit: opts.crit ?? 0,
    critDamage: opts.critDamage ?? 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: {
        slots: [{ slot: 'active', abilities: [] }, ...opts.reactionAbilities.slots],
    },
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
    speed: 200, // focus acts first
    healTargetId: 'attacker',
    mode: 'healing',
    enemyAttackers: [opts.enemy],
});

/** Sums every `direct`-channel creditDamage call attributed to `sourceId` across the whole run. */
const creditedDirectDamageFor = (sourceId: string, input: CombatEngineInput): number => {
    let total = 0;
    runCombat({
        ...input,
        __testTapCreditDamage: (id, channel, amount) => {
            if (id === sourceId && channel === 'direct') total += amount;
        },
    });
    return total;
};

/**
 * Sums the PER-VICTIM dealt credit attributed to `sourceId` across the whole run.
 *
 * SP-4b-1: this is where every reactive proc below now books. The normalization boundary places
 * every actor and synthesizes the missing `target`/`pattern`, so the proc resolves onto the real,
 * placed opposing actor and `applyReactiveDamage` takes its per-victim branch — lowering that
 * actor's real HP and crediting through `creditDealt` (→ `RoundData.perTargetDealt`). The
 * credit-only `creditDamage('direct')` channel that `creditedDirectDamageFor` taps is the LEGACY
 * sink's route and is no longer written at all. The two are mutually exclusive per proc, which is
 * why each magnitude below is paired with a "the old channel stays 0" assertion: `dealt > 0` alone
 * would still pass if a later change credited both and double-counted.
 */
const dealtFor = (sourceId: string, input: CombatEngineInput): number =>
    dealtBy(runCombat(input).rounds, sourceId);

describe('PR4b: reactive damage executor — defense mitigation + crit (player-owned)', () => {
    it('a high-defence victim receives LESS than attack × multiplier (mitigation now applies)', () => {
        const ATTACK = 10_000;
        const MULT = 80; // FrontLine's real multiplier

        const lowDefInput = buildPlayerOwnerInput({
            reactionAbilities: reactiveDamage(MULT),
            enemy: chargedCastEnemy('e1', 0),
        });
        const highDefInput = buildPlayerOwnerInput({
            reactionAbilities: reactiveDamage(MULT),
            enemy: chargedCastEnemy('e1', 50_000),
        });
        const lowDefence = dealtFor('attacker', lowDefInput);
        const highDefence = dealtFor('attacker', highDefInput);
        // Nothing is credited in parallel on the legacy scalar channel.
        expect(creditedDirectDamageFor('attacker', lowDefInput)).toBe(0);
        expect(creditedDirectDamageFor('attacker', highDefInput)).toBe(0);

        const unmitigated = ATTACK * (MULT / 100);
        // Pre-PR4b baseline: both lowDefence and highDefence would equal `unmitigated` exactly
        // (no mitigation at all). Post-PR4b: defence=0 mitigates to ~unmitigated (defence-0 damage
        // reduction is 0%), while defence=50,000 cuts it down substantially.
        expect(lowDefence).toBeCloseTo(unmitigated, 0);
        expect(highDefence).toBeLessThan(unmitigated);
        expect(highDefence).toBeLessThan(lowDefence);
    });

    it('a crit-capable reactive ability at 100% crit deals crit-scaled damage (deterministic gate)', () => {
        const noCritStat = dealtFor(
            'attacker',
            buildPlayerOwnerInput({
                reactionAbilities: reactiveDamage(80),
                enemy: chargedCastEnemy('e1', 0),
                crit: 0,
                critDamage: 150,
            })
        );
        const fullCrit = dealtFor(
            'attacker',
            buildPlayerOwnerInput({
                reactionAbilities: reactiveDamage(80),
                enemy: chargedCastEnemy('e1', 0),
                crit: 100,
                critDamage: 150,
            })
        );
        // crit:100 deterministically fires the dedicated reactive-damage crit gate on its very
        // first (only) draw; critDamage 150% → hitCritMultiplier = 1 + 150/100 = 2.5.
        // Non-vacuous: the no-crit baseline is a real, positive number, so the ×2.5 below is a
        // genuine scaling assertion rather than 0 === 0.
        expect(noCritStat).toBeGreaterThan(0);
        expect(fullCrit).toBeCloseTo(noCritStat * 2.5, 0);
    });

    it('a noCrit-flagged ability at 100% crit does NOT crit-scale (negative pin — passes before and after)', () => {
        const noCritFlagAt0 = dealtFor(
            'attacker',
            buildPlayerOwnerInput({
                reactionAbilities: reactiveDamage(80, { noCrit: true }),
                enemy: chargedCastEnemy('e1', 0),
                crit: 0,
                critDamage: 150,
            })
        );
        const noCritFlagAt100 = dealtFor(
            'attacker',
            buildPlayerOwnerInput({
                reactionAbilities: reactiveDamage(80, { noCrit: true }),
                enemy: chargedCastEnemy('e1', 0),
                crit: 100,
                critDamage: 150,
            })
        );
        // noCrit:true → the crit gate is never even rolled (the `!noCrit &&` short-circuit) →
        // identical damage regardless of the owner's crit stat.
        expect(noCritFlagAt0).toBeGreaterThan(0); // non-vacuous
        expect(noCritFlagAt100).toBeCloseTo(noCritFlagAt0, 0);
    });

    it('zero-damage guard: a 0-multiplier reactive credits nothing (raw <= 0 skip, #211 review)', () => {
        // Replaces the pre-#211 unit test for the removed creditReactiveDamage zero guard —
        // the equivalent guard now lives inside applyReactiveDamage (`if (raw <= 0) return`).
        const input = buildPlayerOwnerInput({
            reactionAbilities: reactiveDamage(0),
            enemy: chargedCastEnemy('e1', 0),
        });
        // Extended to BOTH channels — pinning only the scalar one went vacuous the moment the
        // proc moved to the per-victim channel.
        expect(creditedDirectDamageFor('attacker', input)).toBe(0);
        expect(dealtFor('attacker', input)).toBe(0);
    });

    it('gate-flip control: the reaction never fires without a charged cast (no credit at all)', () => {
        const input = buildPlayerOwnerInput({
            reactionAbilities: reactiveDamage(80),
            enemy: nonChargingEnemy('e1', 0),
        });
        // Both channels, for the same reason as the zero-damage guard above.
        expect(creditedDirectDamageFor('attacker', input)).toBe(0);
        expect(dealtFor('attacker', input)).toBe(0);
    });
});

// ─── Team-symmetric mitigation: an ENEMY-owned reactive damage credit, mitigated by the
// PLAYER's (the "attacker" focus) defence. Uses the SAME on-enemy-charged-cast shape,
// flipped: the ENEMY carries the reactive ability and reacts to the PLAYER firing its
// CHARGED skill (the enemy registration flips isOpposing so "enemy" from ITS frame means
// the player team — see engine.ts's enemyReactivePerOwner registration).
describe('PR4b: reactive damage executor — team-symmetric mitigation (enemy-owned)', () => {
    const buildEnemyOwnerInput = (opts: {
        reactionAbilities: ShipSkills;
        focusDefence: number;
    }): CombatEngineInput => ({
        attack: 10_000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 1, // the FOCUS (player) fires its CHARGED skill on turn 1
        startCharged: true,
        hasChargedSkill: true,
        shipSkills: {
            slots: [
                { slot: 'active', abilities: [] },
                { slot: 'charged', abilities: [] },
            ],
        },
        numRounds: 1,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: opts.focusDefence,
        hp: 1_000_000_000,
        speed: 200, // focus acts first so its charged cast fires before the enemy would act
        healTargetId: 'attacker',
        mode: 'healing',
        enemyAttackers: [
            {
                id: 'e1',
                stats: {
                    attack: 100,
                    crit: 0,
                    critDamage: 0,
                    defence: 0,
                    hp: 1_000_000_000,
                    speed: 40,
                },
                chargeCount: 0,
                startCharged: false,
                shipSkills: opts.reactionAbilities,
            },
        ],
    });

    it("an enemy-owned reactive credit is mitigated by the PLAYER victim's defence, identically to the player-owned case", () => {
        const ATTACK = 100; // the enemy owner's OWN attack (its reactive scales off ITS effectiveAttack)
        const MULT = 80;

        const lowDefInput = buildEnemyOwnerInput({
            reactionAbilities: reactiveDamage(MULT),
            focusDefence: 0,
        });
        const highDefInput = buildEnemyOwnerInput({
            reactionAbilities: reactiveDamage(MULT),
            focusDefence: 50_000,
        });
        const lowDefence = dealtFor('e1', lowDefInput);
        const highDefence = dealtFor('e1', highDefInput);
        expect(creditedDirectDamageFor('e1', lowDefInput)).toBe(0);
        expect(creditedDirectDamageFor('e1', highDefInput)).toBe(0);

        const unmitigated = ATTACK * (MULT / 100);
        expect(lowDefence).toBeCloseTo(unmitigated, 0);
        expect(highDefence).toBeGreaterThan(0);
        expect(highDefence).toBeLessThan(unmitigated);
        expect(highDefence).toBeLessThan(lowDefence);
    });
});
