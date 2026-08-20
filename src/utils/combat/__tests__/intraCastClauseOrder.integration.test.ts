/**
 * Intra-cast CLAUSE ORDER governs resolution order within one cast (user-confirmed game rule,
 * 2026-08-03): "deals X% damage and inflicts Exposed" resolves the damage FIRST, so the debuff is
 * not active for that damage — whereas "inflicts Exposed and deals X% damage" applies first and can
 * be spent by the same cast.
 *
 * The engine used to apply every cast debuff before the cast's damage resolved, regardless of
 * order, so a damage-then-debuff skill amplified its own hit. That over-credited 13 clause pairs
 * across 10 corpus ships (Defense Down: Amartya, Bizon, Kafa ×2, Kinetik ×2, Prospect, Valkyrie,
 * Yuyan · Inc. Damage Up: Larkspur, Valkyrie, Zosimos · Exposed: Nayra).
 *
 * Ability order within a slot IS clause order — `buildShipAbilities` sorts each slot's abilities by
 * their position in the skill text — so these fixtures build the two orders directly.
 *
 * The chosen model is FULL resolution order: a post-damage clause's application, its
 * `debuff-applied` event, and anything reacting to it all land after the damage. Only the LANDING
 * ROLL stays at its original point in the turn, so the RNG draw order is untouched.
 *
 * MULTI-HIT SCOPE (PR8 of the multi-hit full-walk epic). Every fixture below is a 2-HIT cast, and
 * the unit this rule is scoped to is the SUB-ATTACK, not the cast — because the other locked rule
 * says a multi-hit skill is N consecutive FULL attacks, each running the entire pipeline. So for a
 * 2-hit cast:
 *
 *   damage-then-debuff → attack 0 deals plain damage, THEN lands the debuff; attack 1's damage
 *                        rides it. Total = 1.5x a debuff-free control (one of the two hits
 *                        amplified), not 1.0x.
 *   debuff-then-damage → each attack lands the debuff and then spends it. Total = 2.0x.
 *
 * The rule still has its teeth: 1.5x is what "a post-damage clause never amplifies the damage it
 * follows" looks like once the unit is the attack — the clause misses its OWN attack every time.
 * Were it still applying before the damage it followed, these would read 2.0x, which is exactly
 * what the debuff-first fixtures do read. The gap between the two orders is the assertion.
 *
 * These numbers were 1.0x / 1.5x before PR8, when the landing was drawn once per cast and flushed
 * once after all N sub-attacks. N=1 is unchanged (the Zosimos corpus case at the bottom is a
 * single-hit cast and still reads exactly its control).
 */
import { describe, it, expect } from 'vitest';
import { parsePattern, parseTarget } from '../../targetingParser';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';

const HITS = 2;

const twoHitAttack = (): Ability => ({
    id: 'atk',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 * HITS, hits: HITS },
});

const noopAttack = (): Ability => ({
    id: 'noop',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0, hits: 1 },
});

/** `application: 'apply'` always lands, so the comparison isolates ordering from the landing roll. */
const castDebuff = (buffName: string, parsedEffects: Record<string, number> = {}): Ability => ({
    id: `cast-${buffName}`,
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName,
        parsedEffects,
        stacks: 1,
        isStackable: false,
        duration: 5,
        application: 'apply',
    },
});

const stats = (attack: number, speed: number) => ({
    attack,
    crit: 0,
    critDamage: 0,
    speed,
    defence: 0,
    hp: 1_000_000_000,
    security: 0,
});

/** The focus actor casts `abilities` (in the given clause order) at a passive enemy. */
function focusCast(
    abilities: Ability[],
    numRounds = 1
): { damageTo: (id: string) => number; events: CombatEvent[] } {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const t of ['debuff-applied', 'attacked'] as const) bus.on(t, (e) => events.push(e));

    const input: CombatEngineInput = {
        attack: 10_000,
        crit: 0,
        critDamage: 150,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [{ slot: 'active', abilities }] } as ShipSkills,
        numRounds,
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
        speed: 900,
        hacking: 100_000,
        healTargetId: 'attacker',
        mode: 'battle',
        position: 'M1',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        enemyAttackers: [
            {
                id: 'foe',
                stats: stats(0, 1),
                chargeCount: 0,
                startCharged: false,
                position: 'M1',
                target: parseTarget('front'),
                pattern: parsePattern('Pattern-Base'),
                shipSkills: { slots: [{ slot: 'active', abilities: [noopAttack()] }] },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
        ],
        bus,
    };

    const result = runCombat(input);
    return {
        damageTo: (id) =>
            result.rounds.reduce((sum, rd) => sum + (rd.perTargetDamage?.[id] ?? 0), 0),
        events,
    };
}

/** ENEMY → PLAYER mirror: the enemy casts the ordered clauses at the focus actor. */
function enemyCast(abilities: Ability[]): number {
    const input: CombatEngineInput = {
        attack: 1_000,
        crit: 0,
        critDamage: 150,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [{ slot: 'active', abilities: [noopAttack()] }] } as ShipSkills,
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
        speed: 900, // focus acts first with its no-op, then the enemy casts
        hacking: 100_000,
        healTargetId: 'attacker',
        mode: 'battle',
        position: 'M1',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        enemyAttackers: [
            {
                id: 'foe',
                stats: stats(10_000, 100),
                chargeCount: 0,
                startCharged: false,
                position: 'M1',
                target: parseTarget('front'),
                pattern: parsePattern('Pattern-Base'),
                hacking: 100_000,
                shipSkills: { slots: [{ slot: 'active', abilities }] },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
        ],
    };
    const result = runCombat(input);
    return result.rounds[0]?.perTargetDamage?.['attacker'] ?? 0;
}

const INC_UP = { incomingDamage: 100 };

describe('intra-cast clause order — a debuff clause AFTER the damage clause misses that damage', () => {
    it('Exposed inflicted AFTER the damage clause does not amplify the sub-attack it follows', () => {
        const plain = focusCast([twoHitAttack()]).damageTo('foe');
        const damageFirst = focusCast([twoHitAttack(), castDebuff('Exposed')]).damageTo('foe');

        expect(plain).toBeGreaterThan(0);
        // Attack 0 plain, then Exposed lands; attack 1 doubled and spends it → 3 half-shares vs 2.
        // The clause missing its OWN attack is what keeps this below the 2.0 the debuff-first
        // ordering reads.
        expect(damageFirst / plain).toBeCloseTo(1.5, 5);
    });

    it('Exposed inflicted BEFORE the damage clause is spent on that same sub-attack', () => {
        const plain = focusCast([twoHitAttack()]).damageTo('foe');
        const debuffFirst = focusCast([castDebuff('Exposed'), twoHitAttack()]).damageTo('foe');

        // Each attack applies Exposed and then spends it on its own hit → both hits doubled.
        expect(debuffFirst / plain).toBeCloseTo(2, 5);
    });

    it('the same rule governs the stat channels — Inc. Damage Up after damage misses the sub-attack it follows', () => {
        const plain = focusCast([twoHitAttack()]).damageTo('foe');
        const damageFirst = focusCast([
            twoHitAttack(),
            castDebuff('Inc. Damage Up II', INC_UP),
        ]).damageTo('foe');
        const debuffFirst = focusCast([
            castDebuff('Inc. Damage Up II', INC_UP),
            twoHitAttack(),
        ]).damageTo('foe');

        // Attack 0 plain, then Inc. Damage Up lands; attack 1 carries it. A standing modifier is
        // never consumed, so at N=2 this reads the same 1.5 as Exposed — the distinguishing
        // comparison is against the debuff-first ordering below.
        expect(damageFirst / plain).toBeCloseTo(1.5, 5);
        // Not consumed on hit — a standing modifier amplifies BOTH hits of its own cast.
        expect(debuffFirst / plain).toBeCloseTo(2, 5);
    });

    it('a deferred debuff still LANDS — it amplifies the NEXT cast instead', () => {
        const plain = focusCast([twoHitAttack()], 2).damageTo('foe');
        const { damageTo, events } = focusCast([twoHitAttack(), castDebuff('Exposed')], 2);

        // It was really applied, not dropped.
        expect(events.filter((e) => e.type === 'debuff-applied')).not.toHaveLength(0);
        // Round 1 already reads 1.5x (attack 0 plain, attack 1 rides and spends what attack 0
        // applied, then reapplies a fresh Exposed after its own damage). That leftover carries into
        // round 2, so BOTH of round 2's hits ride and reapply it in turn — round 2 reads 2.0x.
        expect(damageTo('foe')).toBeGreaterThan(plain);
    });

    it("a post-damage clause emits each debuff-applied AFTER its own sub-attack's hits", () => {
        const { events } = focusCast([twoHitAttack(), castDebuff('Exposed')]);

        // One landing per sub-attack, each emitted after THAT sub-attack's `attacked` — never
        // before it (which would report the debuff as active for damage it did not amplify) and
        // never both at the end (which is the once-per-cast flush PR8 replaced). Asserted as the
        // exact interleaving rather than a pair of indices: the whole point is the alternation.
        expect(events.map((e) => e.type)).toEqual([
            'attacked',
            'debuff-applied',
            'attacked',
            'debuff-applied',
        ]);
        // And the amounts confirm which side of its own landing each attack fell on: attack 0
        // unamplified, attack 1 doubled by attack 0's Exposed.
        const amounts = events
            .filter((e): e is Extract<CombatEvent, { type: 'attacked' }> => e.type === 'attacked')
            .map((e) => e.damage ?? 0);
        expect(amounts[0]).toBeGreaterThan(0);
        expect(amounts[1] / amounts[0]).toBeCloseTo(2, 5);
    });

    it('is team-symmetric — an ENEMY cast obeys clause order against a player victim', () => {
        const plain = enemyCast([twoHitAttack()]);
        const damageFirst = enemyCast([twoHitAttack(), castDebuff('Exposed')]);
        const debuffFirst = enemyCast([castDebuff('Exposed'), twoHitAttack()]);

        expect(plain).toBeGreaterThan(0);
        // Same two ratios as the player-side cases above (1.5 post-damage, 2.0 pre-damage) — the
        // enemy path routes through the same shared positional helper, so a regression that reached
        // only one side would split them.
        expect(damageFirst / plain).toBeCloseTo(1.5, 5);
        expect(debuffFirst / plain).toBeCloseTo(2, 5);
    });
});

// =============================================================================
// Corpus grounding: the rule must hold for text that came out of the PARSER, not just for
// hand-built ability arrays. Zosimos's active is the canonical damage-then-debuff shape and one of
// the 13 affected clause pairs — its Inc. Damage Up II must not amplify the cast that applies it.
// =============================================================================

const ZOSIMOS_ACTIVE =
    'This Unit deals <unit-damage>170% damage</unit-damage> and inflicts <unit-skill>Inc. Repair Down II</unit-skill> and <unit-skill>Inc. Damage Up II</unit-skill> for 2 turns.';

describe('intra-cast clause order — real corpus skill text (Zosimos active)', () => {
    it('parses damage-before-debuff and defers the debuffs past its own damage', async () => {
        const { buildShipAbilities } = await import('../../abilities/buildShipAbilities');
        const ship = { refits: [], activeSkillText: ZOSIMOS_ACTIVE } as unknown as Ship;
        const active = buildShipAbilities(ship).slots.find((s) => s.slot === 'active')!.abilities;

        // Premise: the parser really does put the damage clause first (this is what the engine's
        // status-collection walk reads to set `afterDamageClause`).
        const damageAt = active.findIndex(
            (a) => a.config.type === 'damage' && a.config.multiplier > 0
        );
        const incUpAt = active.findIndex(
            (a) => a.config.type === 'debuff' && a.config.buffName === 'Inc. Damage Up II'
        );
        expect(damageAt).toBeGreaterThanOrEqual(0);
        expect(incUpAt).toBeGreaterThan(damageAt);

        // And the engine honours it: the cast's own damage matches a debuff-free control.
        const withKit = focusCast(active).damageTo('foe');
        const control = focusCast(active.filter((a) => a.config.type === 'damage')).damageTo('foe');
        expect(control).toBeGreaterThan(0);
        expect(withKit).toBe(control);
    });
});
