import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability } from '../../../types/abilities';
import { createEventBus, CombatEvent } from '../events';
import { bareEnemy } from '../__testutils__/bareRosterFixture';

// ─────────────────────────────────────────────────────────────────────────────
// #424 — a LEECH-granted shield emits `shield-applied`, exactly like a cast one.
//
// #418/#420 fixed the gross-vs-net emit GATE at the three CAST sites. This is the other half:
// the two engine LEECH proc sites (`procStandingLeechesPerVictim` /
// `procTakenLeechesPerVictim`, engine.ts) granted a real pool and emitted nothing at all,
// saturated or not, so `on-shield-applied` — i.e. the RESONATING FURY implant — could not see
// them.
//
// GAME RULE (owner-ratified 2026-08-29, do not relitigate): a leech-granted shield IS
// "applying a shield". The example put to the owner was QUIXILVER wearing Resonating Fury,
// taking a hit that punches through into HP so her passive converts 25% of it into Shield —
// the Crit Power Up 3 roll DOES happen on that hit. Second ruling: ONE roll per ATTACK, not
// one per ship shielded, matching the cast path's one-emit-per-cast rule.
//
// CORPUS (measured 2026-08-29, all 149 `docs/ship-skills.csv` rows through
// `buildShipAbilities` + `partitionReactiveAbilities` — instrument validated at 149/149 built,
// and it does report carriers, so the empty arms below are a reading and not a blind zero):
//   • damage-TAKEN passive shields — MALVEX (15%), QUIXILVER (25%). LIVE; that is this fix.
//   • damage-DEALT passive shields — NONE. The standing map holds only Magnolia (heal 40%) and
//     Valerian (heal 15%). The issue named FrontLine here and that is WRONG: FrontLine's 30%
//     damage-dealt shield is an ACTIVE-slot cast rider (playerTurn.ts's firing-slot
//     `damage-dealt` case) plus a REACTIVE `on-enemy-charged` passive — both already emit
//     through the cast/reactive accumulators. It never enters the standing map.
// The standing site is covered here anyway: leaving one of two sibling arms silent is exactly
// the hand-copied-divergence shape #418 was filed against.
// ─────────────────────────────────────────────────────────────────────────────

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `ls${++idCounter}`,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

const damageAb = (multiplier = 100): Ability =>
    ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier } });

/** Malvex/Quixilver shape: passive-slot, basis 'damage-taken' → `takenLeechesByOwner`. */
const takenShield = (pct: number, requiresHpDamage = false): Ability =>
    ab({
        type: 'shield',
        target: 'self',
        config: { type: 'shield', pct, basis: 'damage-taken', requiresHpDamage },
    });

/** Passive-slot, basis 'damage-dealt' → `standingLeeches`. Corpus-dead today (see header). */
const standingShield = (pct: number): Ability =>
    ab({
        type: 'shield',
        target: 'self',
        config: { type: 'shield', pct, basis: 'damage-dealt', leechScope: 'all' },
    });

/** A plain CAST shield — the already-emitting path, used as this file's instrument check. */
const castShield = (pct: number): Ability =>
    ab({ type: 'shield', target: 'self', config: { type: 'shield', pct, basis: 'hp' } });

const resonatingFuryLike = (): Ability =>
    ab({
        type: 'buff',
        target: 'self',
        trigger: 'on-shield-applied',
        config: {
            type: 'buff',
            buffName: 'Crit Power Up',
            stacks: 3,
            duration: 1,
            parsedEffects: {},
        },
    } as unknown as Parameters<typeof ab>[0]);

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
/** speed 10 → always acts AFTER the focus, so a same-turn cast shield is up before the hit. */
const manualEnemy = (id: string, attack: number, speed = 10): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, speed },
    chargeCount: 0,
    startCharged: false,
});

const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: bareEnemy({ id: 'leech-target', stats: { hp: 10_000_000 } }),
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
    healTargetId: 'attacker',
    mode: 'healing',
    ...overrides,
});

type ShieldApplied = Extract<CombatEvent, { type: 'shield-applied' }>;
type BuffApplied = Extract<CombatEvent, { type: 'buff-applied' }>;

const runCapturing = (
    input: Partial<CombatEngineInput>
): { shields: ShieldApplied[]; buffs: BuffApplied[] } => {
    const bus = createEventBus();
    const shields: ShieldApplied[] = [];
    const buffs: BuffApplied[] = [];
    bus.on('shield-applied', (e) => {
        if (e.type === 'shield-applied') shields.push(e);
    });
    bus.on('buff-applied', (e) => {
        if (e.type === 'buff-applied' && e.buffName === 'Crit Power Up') buffs.push(e);
    });
    runCombat(BASE({ ...input, bus }));
    return { shields, buffs };
};

describe('#424 — leech-granted shields emit shield-applied', () => {
    // ── INSTRUMENT CHECK ─────────────────────────────────────────────────────
    // Before believing any count below, prove this harness CAN see a shield-applied at all.
    // A cast shield on the very same rig emits today, so a zero in the leech tests is a real
    // reading of the leech path rather than a dead bus subscription.
    it('instrument: a CAST shield on this same rig emits (so a zero below is a reading)', () => {
        idCounter = 0;
        const { shields } = runCapturing({
            numRounds: 1,
            hp: 10_000,
            defence: 0,
            enemyAttackers: [manualEnemy('atk1', 2000)],
            shipSkills: { slots: [{ slot: 'active', abilities: [castShield(10)] }] },
        });
        expect(shields).toHaveLength(1);
        expect(shields[0].granterId).toBe('attacker');
        expect(shields[0].amount).toBeCloseTo(1000, 4);
    });

    // ── The live case: Malvex / Quixilver ────────────────────────────────────
    it('damage-TAKEN leech (Malvex shape): one shield-applied per attack, keyed on the victim', () => {
        idCounter = 0;
        // attack 2000, defence 0 → D = 2000 per round; unconditional 15% proc → 300 each round.
        // R2's attack drains R1's 300 first, so the R2 grant is a genuine second application.
        const { shields } = runCapturing({
            numRounds: 2,
            hp: 10_000,
            defence: 0,
            enemyAttackers: [manualEnemy('atk1', 2000)],
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [damageAb(100)] },
                    { slot: 'passive', abilities: [takenShield(15)] },
                ],
            },
        });
        expect(shields).toHaveLength(2);
        // A damage-taken leech is a SELF-shield: the victim is both granter and recipient.
        expect(shields.map((e) => e.granterId)).toEqual(['attacker', 'attacker']);
        expect(shields.map((e) => e.recipientIds)).toEqual([['attacker'], ['attacker']]);
        expect(shields.map((e) => e.round)).toEqual([1, 2]);
        for (const e of shields) expect(e.amount).toBeCloseTo(300, 4);
    });

    it('THE SYMPTOM: Resonating Fury fires off a Quixilver-shape punch-through leech', () => {
        idCounter = 0;
        // The owner's own ratifying example. Cast shield 10% of 10,000 = 1,000 lands first
        // (focus acts before the speed-10 enemy); the 2,000 hit drains it and punches 1,000 into
        // HP, so requiresHpDamage passes and the passive converts 25% × 2,000 = 500 into Shield.
        // PRE-FIX the leech grant was silent and only the CAST shield's own event fired.
        const { shields, buffs } = runCapturing({
            numRounds: 1,
            hp: 10_000,
            defence: 0,
            enemyAttackers: [manualEnemy('atk1', 2000)],
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [castShield(10)] },
                    { slot: 'passive', abilities: [takenShield(25, true), resonatingFuryLike()] },
                ],
            },
        });
        // Two applications in the round: the cast (1,000) and the leech (500).
        expect(shields).toHaveLength(2);
        expect(shields[1].amount).toBeCloseTo(500, 4);
        // PRE-FIX this was 1 — the leech application granted a pool and rolled nothing.
        expect(buffs).toHaveLength(2);
    });

    it('aggregates within one proc call: two damage-taken entries emit ONE event, not two', () => {
        idCounter = 0;
        // The one-roll-per-ATTACK ruling. Two carriers on one hull convert 15% + 25% of the same
        // 2,000 hit; that is still ONE application of shield, so ONE roll — the cast path's rule.
        const { shields } = runCapturing({
            numRounds: 1,
            hp: 10_000,
            defence: 0,
            enemyAttackers: [manualEnemy('atk1', 2000)],
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [damageAb(100)] },
                    { slot: 'passive', abilities: [takenShield(15), takenShield(25)] },
                ],
            },
        });
        expect(shields).toHaveLength(1);
        // 2000 × 0.15 + 2000 × 0.25 = 800, booked as two recipient rows on one event.
        expect(shields[0].amount).toBeCloseTo(800, 4);
        expect(shields[0].recipientIds).toEqual(['attacker', 'attacker']);
    });

    // ── The sibling arm ──────────────────────────────────────────────────────
    it('damage-DEALT standing leech: the sibling arm emits too, keyed on the leecher', () => {
        idCounter = 0;
        // Corpus-dead today (see the file header) but wired so the two arms cannot drift.
        // attack 5000 vs defence 2000 on a 10M-HP dummy; the exact damage is irrelevant — what
        // is asserted is that an application happened and was keyed on the leecher.
        const { shields } = runCapturing({
            numRounds: 1,
            hp: 10_000,
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [damageAb(100)] },
                    { slot: 'passive', abilities: [standingShield(20)] },
                ],
            },
        });
        expect(shields).toHaveLength(1);
        expect(shields[0].granterId).toBe('attacker');
        expect(shields[0].recipientIds).toEqual(['attacker']);
        expect(shields[0].amount).toBeGreaterThan(0);
    });
});
