/**
 * A `basis:'damage-taken'` REACTIVE — and the threshold gate beside it — read what the victim
 * actually TOOK, not the hit as thrown.
 *
 * OWNER RULING 2026-09-03. Meatshield redirects a 1,000-damage hit off a squishy ally; the ally
 * actually took 700. Adaptive Plating on that ally scales off 700. The ruling explicitly covers
 * the gate too: Tenacity's "only if the hit exceeded 25% of max HP" reads THE SAME figure, so a
 * hit that clears the threshold as thrown but not as taken does NOT fire it. The split option —
 * funnel figure for the magnitude, raw for the gate — was offered and declined. One figure, both
 * uses. This deliberately matches the leech basis ruled in PR #464 (`incomingBooked`).
 *
 * THE DEFECT CHAIN. `attacked.damage` is the PRE-funnel per-victim hit: the engine accumulates it
 * from `onVictimResolved`'s `damage`, which is handed down before the funnel recorded anything.
 * The `on-attacked` listener stamped it as `eventCtx.triggerDamage` (which the heal/shield
 * executor's `damage-taken` basis reads) and gated on it. `attacked` now carries a separate
 * `takenDamage` — the funnel's own `incomingBooked` for this victim — mirroring the shape the
 * on-deal-damage path already uses for `deliveredDamage`, and both readers prefer it.
 *
 * The basis moves on ANY funnel divergence, not only a Protection cascade: an incoming-block proc
 * or a shield/barrier interaction shifts `incomingBooked` too. Protection is used here because it
 * is the one that moves a KNOWN fraction and can be turned on and off in one flag.
 *
 * WHY THE PROTECTOR'S DEFENCE IS NON-ZERO. With the protector at 0 defence the redirected chunk
 * re-mitigates at ratio 1 and `victim remainder + protector chunk` sums back to exactly the
 * undiverted hit — so a fixture built that way cannot tell "the victim's own intake" from "the
 * whole hit reconstructed". These protectors mitigate differently from their victims, so 3,500 and
 * 5,000 are the only two candidate answers and the assertions discriminate them.
 *
 * SHIELD FORK. Adaptive Plating's live shape is a SHIELD; the arithmetic below uses the HEAL fork
 * because a repair amount is not clipped by a pool. Both forks resolve the identical
 * `nonTargetHpBasis` line in `executeIntent`, so the shield row is asserted once and the rest of
 * the arithmetic rides the heal.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { SelectedGameBuff } from '../../../types/calculator';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const ATTACK = 5000;
const PROTECTION_STACKS = 3;
/** Three stacks divert 30%, so a 5,000 hit leaves 3,500 on the victim. */
const TAKEN = 3500;
const REACTIVE_PCT = 20;
/** Non-zero, so the diverted chunk re-mitigates differently and the two shares do NOT sum to the
 *  undiverted hit — see the header. */
const PROTECTOR_DEFENCE = 5000;
/** 25% of this is 4,000: above what the victim TAKES when protected, below the raw hit. */
const GATED_HP = 16_000;
const HUGE_HP = 1_000_000_000;

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `dtb${++idc}`,
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
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const attackSkill = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

/** Adaptive Plating's shape in its heal fork: an ON-ATTACKED reactive scaled by damage TAKEN. */
const adaptivePlatingHeal = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'heal',
            target: 'self',
            trigger: 'on-attacked',
            config: { type: 'heal', pct: REACTIVE_PCT, basis: 'damage-taken', noCrit: true },
        }),
    ],
});

/** The live corpus fork of the same reactive: a self SHIELD scaled by damage taken. */
const adaptivePlatingShield = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'shield',
            target: 'self',
            trigger: 'on-attacked',
            config: { type: 'shield', pct: REACTIVE_PCT, basis: 'damage-taken' },
        }),
    ],
});

/**
 * Tenacity's gate, on a reactive whose SIZE does not depend on the hit — the observable is purely
 * whether it fired. `procChance` is deliberately omitted: the real implant rolls one, and an RNG
 * draw here would make "did not fire" ambiguous.
 */
const tenacityGatedHeal = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'heal',
            target: 'self',
            trigger: 'on-attacked',
            requireIncomingDamageFracOfMaxHp: 0.25,
            config: { type: 'heal', pct: 10, basis: 'target-hp', noCrit: true },
        }),
    ],
});

/** Grants SELF `Protection` the production way — an aura (a duration-less stackable buff). */
const protectionAuraPassive = (stacks: number): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'buff',
            target: 'self',
            config: {
                type: 'buff',
                buffName: 'Protection',
                parsedEffects: {},
                stacks,
                isStackable: true,
            },
        }),
    ],
});

/** The focus ship has no passive slot, so its Protection comes from an accumulator that lands
 *  its full complement on round 1 (rate = cap = stacks). */
const protectionAccum = (stacks: number): SelectedGameBuff => ({
    id: 'prot-1',
    buffName: 'Protection',
    stacks,
    parsedEffects: {},
    isStackable: true,
    maxStacks: stacks,
    stackTrigger: 'per-round',
});

/** The `reactive-heal-performed` amounts paid to `casterId`, in resolution order. */
const reactiveHeals = (input: CombatEngineInput, casterId: string): number[] => {
    const out: number[] = [];
    const bus = createEventBus();
    bus.on('reactive-heal-performed', (e) => {
        if (e.casterId === casterId) out.push(e.amount);
    });
    runCombat({ ...input, bus });
    return out;
};

/** The `shield-applied` amounts `granterId` produced, in resolution order. */
const reactiveShields = (input: CombatEngineInput, granterId: string): number[] => {
    const out: number[] = [];
    const bus = createEventBus();
    bus.on('shield-applied', (e) => {
        if (e.granterId === granterId) out.push(e.amount);
    });
    runCombat({ ...input, bus });
    return out;
};

/** Damage `id` actually TOOK across the run — the per-actor intake bucket. */
const incomingOf = (input: CombatEngineInput, id: string): number => {
    let sum = 0;
    for (const rd of runCombat(input).rounds) sum += rd.perActorIncoming?.[id]?.incoming ?? 0;
    return sum;
};

// ══════════════════════════════════════════════════════════════════════════════════════════════
// An ENEMY hits a PLAYER ally; the FOCUS ship protects it and the ally reacts.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const teamActor = (
    id: string,
    position: Position,
    slots: ShipSkills['slots'],
    hp: number
): TeamActorEngineInput => ({
    id,
    speed: 100,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    role: 'ATTACKER',
    walk: {
        shipSkills: { slots },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

/** One flat enemy hit at the player front column. */
const aggressor = (): EnemyAttacker => ({
    id: 'aggressor',
    stats: { attack: ATTACK, crit: 0, critDamage: 0, defence: 0, hp: HUGE_HP, speed: 50 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    affinity: 'antimatter',
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [attackSkill()] },
});

const playerVictimInput = (
    victimSlots: ShipSkills['slots'],
    opts: { protect?: boolean; victimHp?: number } = {}
): CombatEngineInput => {
    idc = 0;
    return {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [] },
        numRounds: 1,
        selfBuffs: opts.protect ? [protectionAccum(PROTECTION_STACKS)] : [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinity: 'antimatter',
        defence: PROTECTOR_DEFENCE,
        hp: HUGE_HP,
        hacking: 100_000,
        healTargetId: 'victim',
        mode: 'healing',
        position: 'M2',
        target: parsedTarget('front'),
        pattern: basePattern(),
        teamActors: [teamActor('victim', 'M4', victimSlots, opts.victimHp ?? HUGE_HP)],
        enemyAttackers: [aggressor()],
    };
};

describe('a damage-TAKEN reactive scales off what the victim took (owner ruling 2026-09-03)', () => {
    it('CONTROL: unprotected, the reactive pays pct x the whole hit', () => {
        const heals = reactiveHeals(playerVictimInput([adaptivePlatingHeal()]), 'victim');

        expect(heals).toHaveLength(1);
        expect(heals[0]).toBeCloseTo((ATTACK * REACTIVE_PCT) / 100, 6);
    });

    it('...and the redirect is real: the victim took 70%, the protector took the rest', () => {
        // NON-VACUITY GUARD. Without it an inert cascade would leave the victim on the full hit
        // and every assertion below would be measuring a fixture that never redirected anything.
        const plain = playerVictimInput([adaptivePlatingHeal()]);
        const guarded = playerVictimInput([adaptivePlatingHeal()], { protect: true });

        expect(incomingOf(plain, 'victim')).toBeCloseTo(ATTACK, 6);
        expect(incomingOf(guarded, 'victim')).toBeCloseTo(TAKEN, 6);
        expect(incomingOf(guarded, 'attacker')).toBeGreaterThan(0);
        // The protector mitigates its chunk differently, so the two shares do NOT sum back to the
        // undiverted hit — which is what makes 3,500 and 5,000 distinguishable answers here.
        expect(incomingOf(guarded, 'victim') + incomingOf(guarded, 'attacker')).not.toBeCloseTo(
            ATTACK,
            0
        );
    });

    it('a Protection redirect shrinks the basis — pct x what the victim actually took', () => {
        const heals = reactiveHeals(
            playerVictimInput([adaptivePlatingHeal()], { protect: true }),
            'victim'
        );

        expect(heals).toHaveLength(1);
        expect(heals[0]).toBeCloseTo((TAKEN * REACTIVE_PCT) / 100, 6);
    });

    it('the SHIELD fork of the same reactive reads the same figure', () => {
        const alone = reactiveShields(playerVictimInput([adaptivePlatingShield()]), 'victim');
        const guarded = reactiveShields(
            playerVictimInput([adaptivePlatingShield()], { protect: true }),
            'victim'
        );

        expect(alone).toHaveLength(1);
        expect(alone[0]).toBeCloseTo((ATTACK * REACTIVE_PCT) / 100, 6);
        expect(guarded).toHaveLength(1);
        expect(guarded[0]).toBeCloseTo((TAKEN * REACTIVE_PCT) / 100, 6);
    });
});

describe('the >25%-max-HP gate reads the same figure as the basis (ruling: no split)', () => {
    it('CONTROL: unprotected, a 5,000 hit on 16,000 max HP clears the gate and fires', () => {
        const heals = reactiveHeals(
            playerVictimInput([tenacityGatedHeal()], { victimHp: GATED_HP }),
            'victim'
        );

        expect(heals).toHaveLength(1);
    });

    it('protected, the same hit lands 3,500 of 16,000 — under the gate, so it does NOT fire', () => {
        const heals = reactiveHeals(
            playerVictimInput([tenacityGatedHeal()], { victimHp: GATED_HP, protect: true }),
            'victim'
        );

        // 3,500 <= 0.25 x 16,000 = 4,000. The raw hit (5,000) clears it; the funnel figure does
        // not. The control above is what makes this absence a measurement.
        expect(heals).toHaveLength(0);
    });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TEAM SYMMETRY — the PLAYER focus hits an ENEMY; another ENEMY protects it and it reacts.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const enemyAt = (
    id: string,
    position: Position,
    slots: ShipSkills['slots'],
    over: { defence?: number; hp?: number } = {}
): EnemyAttacker => ({
    id,
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: over.defence ?? 0,
        hp: over.hp ?? HUGE_HP,
        speed: 1,
    },
    chargeCount: 0,
    startCharged: false,
    position,
    affinity: 'antimatter',
    shipSkills: { slots },
});

const enemyVictimInput = (
    victimSlots: ShipSkills['slots'],
    opts: { protect?: boolean; victimHp?: number } = {}
): CombatEngineInput => {
    idc = 0;
    return {
        attack: ATTACK,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [attackSkill()] },
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
        affinity: 'antimatter',
        defence: 0,
        hp: HUGE_HP,
        hacking: 100_000,
        healTargetId: 'attacker',
        mode: 'healing',
        speed: 1,
        position: 'M1',
        target: parsedTarget('front'),
        pattern: basePattern(),
        enemyAttackers: [
            enemyAt('anchor', 'M4', victimSlots, { hp: opts.victimHp ?? HUGE_HP }),
            enemyAt(
                'covered',
                'M3',
                opts.protect ? [protectionAuraPassive(PROTECTION_STACKS)] : [],
                {
                    defence: PROTECTOR_DEFENCE,
                }
            ),
        ],
    };
};

describe('team symmetry: an enemy victim behind an enemy protector reads the same figure', () => {
    it('CONTROL: unprotected, the enemy reactive pays pct x the whole hit', () => {
        const heals = reactiveHeals(enemyVictimInput([adaptivePlatingHeal()]), 'anchor');

        expect(heals).toHaveLength(1);
        expect(heals[0]).toBeCloseTo((ATTACK * REACTIVE_PCT) / 100, 6);
    });

    it('protected, it pays pct x what the enemy victim actually took', () => {
        const guarded = enemyVictimInput([adaptivePlatingHeal()], { protect: true });

        // NON-VACUITY: the enemy-side cascade really moved a slice.
        expect(incomingOf(guarded, 'anchor')).toBeCloseTo(TAKEN, 6);
        expect(incomingOf(guarded, 'covered')).toBeGreaterThan(0);

        const heals = reactiveHeals(guarded, 'anchor');
        expect(heals).toHaveLength(1);
        expect(heals[0]).toBeCloseTo((TAKEN * REACTIVE_PCT) / 100, 6);
    });

    it('and the gate goes quiet on the enemy side too', () => {
        const control = reactiveHeals(
            enemyVictimInput([tenacityGatedHeal()], { victimHp: GATED_HP }),
            'anchor'
        );
        const guarded = reactiveHeals(
            enemyVictimInput([tenacityGatedHeal()], { victimHp: GATED_HP, protect: true }),
            'anchor'
        );

        expect(control).toHaveLength(1);
        expect(guarded).toHaveLength(0);
    });
});
