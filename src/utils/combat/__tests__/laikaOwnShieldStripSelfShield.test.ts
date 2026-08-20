/**
 * Ship-kit correctness audit, Wave 3, Task 7 — Laika's `on-own-shield-strip` reactive trigger
 * (ENGINE integration). The HEAVIEST cascade fix of Wave 3: unlike Task 6 (which rode an
 * EXISTING bus event, `dot-ticked`), this trigger rides a BRAND-NEW `shield-stripped` event
 * (combat/events.ts) emitted from `stripShieldPct` (playerTurn.ts).
 *
 * Laika's kit (verbatim from docs/ship-skills.csv):
 *   - Active: "This Unit cleanses 1 debuff and deals 110% damage." — NO shield removal.
 *   - Charged: "This Unit removes 40% of the enemy Shield and deals 150% damage." — the ONLY
 *     slot that actually strips shield.
 *   - Second passive: "This Unit gains a Shield equal to 30% of its Max HP upon removing Shield
 *     from an enemy."
 *
 * Before this task the passive's self-shield fell through to the default `trigger:'on-cast'` —
 * an unconditioned self-shield that fired on EVERY cast, including active-skill rounds that never
 * touch an enemy's shield at all (investigation appendix §D/finding #3).
 *
 * Exercised through the REAL production pipeline (`buildShipAbilities` fed verbatim skill text,
 * never a hand-built ability) for BOTH the active/charged skills AND the reactive passive, so a
 * regression in either the shield-strip ability build OR the reactive-trigger wiring surfaces
 * here. Follows the `anemoneEnemyDotDamageHeal.test.ts` / `sansiEnemyRepairedHeal.test.ts` harness
 * style: a mutation-guard shape check, then `runCombat` engine tests proving the reactive fire is
 * gated on a REAL `shield-stripped` event (not on-cast) — firing only on a round where Laika's
 * OWN cast actually removed shield from an opposing actor, never merely because that actor HAS a
 * shield or because Laika cast SOME skill.
 *
 * The enemy/target actor is seeded with a pre-fight shield (`preFight.startingShieldPctOfHp`) so
 * there is real shield present to strip BEFORE Laika's first turn — no speed-ordering trick
 * needed (mirrors seedPreCombatShields' contract, consumed here only as a fixture convenience).
 *
 * Laika's self-shield is SELF-target, so `eventCtx` capture is not required to route the
 * recipient (`reactiveRecipients` resolves target==='self' to `[intent.ownerId]`
 * unconditionally) — the tests here verify the TRIGGER GATING (fires only alongside a REAL
 * shield-stripped event), which is the actual bug being fixed.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { emptyPreFightModifiers } from '../preFight/types';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { CombatActor } from '../state';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], ...over } as Ship;
}

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// Verbatim Laika skill text (docs/ship-skills.csv) — active/charged/second-passive.
const LAIKA_ACTIVE =
    'This Unit <unit-aid>cleanses 1</unit-aid> debuff and deals <unit-damage>110% damage</unit-damage>.';
const LAIKA_CHARGE =
    'This Unit removes 40% of the enemy Shield and deals <unit-damage>150% damage</unit-damage>.';
const LAIKA_P2 =
    'This Unit gains a <unit-damage>Shield equal to 30%</unit-damage> of its Max HP upon removing Shield from an enemy.';

/** Builds Laika's REAL active+charged+passive kit through the production parser/builder. */
function laikaShipSkills(): ShipSkills {
    const { slots } = buildShipAbilities(
        ship({
            activeSkillText: LAIKA_ACTIVE,
            chargeSkillText: LAIKA_CHARGE,
            chargeSkillCharge: 2,
            secondPassiveSkillText: LAIKA_P2,
        })
    );
    return { slots };
}

/** Extracts Laika's on-own-shield-strip self-shield through the REAL parser/builder. */
function laikaSelfShieldAbility(): Ability {
    const { slots } = buildShipAbilities(ship({ secondPassiveSkillText: LAIKA_P2 }));
    const passive = slots.find((s) => s.slot === 'passive');
    const shield = passive?.abilities.find((a) => a.type === 'shield' && a.target === 'self');
    if (!shield) throw new Error('mutation guard: Laika on-own-shield-strip self-shield not found');
    return shield;
}

// Sanity-check the extracted ability BEFORE using it as engine input — a mutation guard so a
// regression in the parser/builder wiring fails loudly here rather than silently no-op'ing below.
describe('Laika self-shield — extracted ability shape (mutation guard)', () => {
    it('rides on-own-shield-strip, self-targeted, 30% of Max HP', () => {
        const shield = laikaSelfShieldAbility();
        expect(shield.trigger).toBe('on-own-shield-strip');
        expect(shield.target).toBe('self');
        expect(shield.config.type).toBe('shield');
        if (shield.config.type === 'shield') {
            expect(shield.config.pct).toBe(30);
            expect(shield.config.basis).toBe('hp');
        }
    });
});

// Tap an ordered log of shield-applied events (the event a reactive shield emits — H3.6,
// triggers.ts — one per reactive shield, keyed on the granter) AND the post-combat actor list
// (__testTapActors) so tests can assert both the reaction fired AND the underlying strip landed.
function collectShieldApplied(input: CombatEngineInput) {
    const bus = createEventBus();
    const shieldsApplied: Extract<CombatEvent, { type: 'shield-applied' }>[] = [];
    bus.on('shield-applied', (e) => shieldsApplied.push(e));
    let actors: CombatActor[] = [];
    const result = runCombat({
        ...input,
        bus,
        __testTapActors: (a) => {
            actors = a;
        },
    });
    return { shieldsApplied, result, actors };
}

const BASE: CombatEngineInput = {
    enemyAttackers: [],
    // attack: 0 so Laika's own damage rider (110%/150%) never confounds the enemy's shieldPool
    // via the ordinary shield-absorbs-damage-first mechanic — the ONLY shield reduction under
    // test is the deliberate stripShieldPct call, not incidental combat damage.
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 2,
    shipSkills: laikaShipSkills(),
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: true,
    startCharged: true,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    // Laika's own Max HP — the self-shield's basis (30% × 1,000,000 = 300,000).
    hp: 1_000_000,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
};

// A single positional enemy carrying a pre-fight shield (50% of its own Max HP) so there is
// REAL shield present to strip before Laika's first turn.
const shieldedEnemy = (): EnemyAttacker =>
    ({
        id: 'enemy-front',
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 100_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position: 'M4',
        preFight: { ...emptyPreFightModifiers(), startingShieldPctOfHp: 50 },
        shipSkills: { slots: [] } as ShipSkills,
    }) as EnemyAttacker;

describe('Laika (player-side) — self-shield fires on a REAL shield strip, not on-cast', () => {
    it('the CHARGED skill (removes 40% of the enemy Shield) fires the reactive self-shield (30% of Max HP)', () => {
        const { shieldsApplied, actors } = collectShieldApplied({
            ...BASE,
            enemyAttackers: [shieldedEnemy()],
        });

        // Sanity: the enemy's pre-fight shield actually got stripped (the trigger's gating
        // event) — 50,000 (50% of 100,000) reduced by 40% → 30,000 remaining.
        const enemy = actors.find((a) => a.id === 'enemy-front');
        expect(enemy?.shieldPool).toBeCloseTo(30_000, 5);

        // The fix: the reactive self-shield fired, granting exactly 30% of Laika's own Max HP.
        const laikaShields = shieldsApplied.filter((e) => e.granterId === 'attacker');
        expect(laikaShields).toHaveLength(1);
        expect(laikaShields[0].amount).toBeCloseTo(1_000_000 * 0.3, 5);
        expect(laikaShields[0].recipientIds).toEqual(['attacker']);
    });

    it('the ACTIVE skill (cleanse + damage, no shield removal) does NOT fire the reactive self-shield, even though the enemy still carries a shield', () => {
        // hasChargedSkill: false forces EVERY turn onto the active slot (cleanse+damage) —
        // Laika never reaches stripShieldPct, so shield-stripped never emits, so the passive's
        // on-own-shield-strip trigger never fires. The enemy's pre-fight shield is left fully
        // intact as the mutation-guard signal that no strip occurred at all.
        const { shieldsApplied, actors } = collectShieldApplied({
            ...BASE,
            hasChargedSkill: false,
            startCharged: false,
            enemyAttackers: [shieldedEnemy()],
        });

        const enemy = actors.find((a) => a.id === 'enemy-front');
        expect(enemy?.shieldPool).toBeCloseTo(50_000, 5); // untouched — no strip occurred.

        const laikaShields = shieldsApplied.filter((e) => e.granterId === 'attacker');
        expect(laikaShields).toHaveLength(0);
    });
});

describe('Laika (enemy-side) — team symmetry: an enemy Laika reacts to its OWN shield strip on a player', () => {
    it('an enemy Laika’s charged strip on the focus player fires the enemy Laika’s reactive self-shield', () => {
        const enemyLaika: EnemyAttacker = {
            id: 'enemy-laika',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000, speed: 1000 },
            chargeCount: 2,
            startCharged: true,
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            shipSkills: laikaShipSkills(),
        } as EnemyAttacker;

        const input: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [] } as ShipSkills,
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
            // Focus player's own Max HP carries the pre-fight shield the enemy Laika strips.
            hp: 100_000,
            preFight: { ...emptyPreFightModifiers(), startingShieldPctOfHp: 50 },
            healTargetId: 'attacker',
            mode: 'healing',
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            enemyAttackers: [enemyLaika],
        };

        const { shieldsApplied, actors } = collectShieldApplied(input);

        // Sanity: the focus's pre-fight shield actually got stripped by the enemy Laika's
        // charged skill — 50,000 (50% of 100,000) reduced by 40% → 30,000 remaining.
        const focus = actors.find((a) => a.id === 'attacker');
        expect(focus?.shieldPool).toBeCloseTo(30_000, 5);

        // Symmetry: the enemy-side Laika fires its reactive self-shield exactly like a
        // player-side one — 30% of ITS OWN Max HP (1,000,000).
        const enemyShields = shieldsApplied.filter((e) => e.granterId === 'enemy-laika');
        expect(enemyShields).toHaveLength(1);
        expect(enemyShields[0].amount).toBeCloseTo(1_000_000 * 0.3, 5);

        // And it must never be misrouted onto the player focus.
        expect(shieldsApplied.some((e) => e.granterId === 'attacker')).toBe(false);
    });
});
