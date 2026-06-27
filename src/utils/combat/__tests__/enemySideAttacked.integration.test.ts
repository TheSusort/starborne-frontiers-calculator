/**
 * enemySideAttacked.integration.test.ts — Task 2 (Step 3): POSITIONAL `shieldWasHit` on the
 * enemy→player path so a PLAYER Nyxen counters a POSITIONAL enemy attacker.
 *
 * The existing Nyxen end-to-end test (counterAttack.integration.test.ts) drives the
 * NON-positional path (`counterBase`, no enemy position/target/pattern), where the enemy's
 * incoming `applyIncomingToTarget` binds shieldBefore/hpDamage/barriered directly so
 * `shieldWasHit` is computed. The two-team battle sim runs enemy attacks POSITIONALLY
 * (`drivePositionalApply`), where those locals stayed at 0 → `shieldWasHit` was always false →
 * a player Nyxen never countered in the positioned sim.
 *
 * This test builds a positional two-team battle (mirroring twoTeamBattle.test.ts /
 * positionalDamage.integration.test.ts): a player FOCUS Nyxen — built via the REAL registry
 * (`buildShipAbilities`) so its self-shield active + shield-hit counter parse — that acts FIRST
 * (higher speed) and casts its 15%-Max-HP shield, then a POSITIONAL enemy attacker drains that
 * shield. The enemy must take counter damage (Nyxen's shield-hit counter fired). This is
 * impossible today because positional `shieldWasHit` is false → the counter never gates true.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// Verbatim CSV-derived skill text (docs/ship-skills.csv, Nyxen row). The active grants a
// self-shield equal to 15% of Max HP; the first passive parses to an on-attacked counter with
// requireShieldHit:true.
const NYXEN_ACTIVE =
    'This Unit <unit-aid>Cleanses 2 bombs</unit-aid>, Grants a <unit-damage>Shield equal to 15%</unit-damage> of its Max HP, and Grants <unit-skill>Atlas Readiness II</unit-skill> for 1 turn.';
const NYXEN_P1 =
    'This Unit deals <unit-damage>100% damage</unit-damage> when its Shield is directly damaged.';

/** A Ship carrying Nyxen's active (self-shield) + first passive (shield-hit counter), parsed
 *  through the real registry → a self-shield ability + an on-attacked counter (requireShieldHit). */
function nyxenShip(withActiveShield = true): Ship {
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        ...(withActiveShield ? { activeSkillText: NYXEN_ACTIVE } : {}),
        firstPassiveSkillText: NYXEN_P1,
    } as Ship;
}

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// Origin-only (single-target) footprint.
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// A no-passive single-hit basic-attack active slot (multiplier 100% = 1x, 1 hit).
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'esa-basic',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100 },
        },
    ],
});

// A POSITIONED enemy attacker that fires on the player roster: position + target + pattern + a
// damage skill so its firing hit produces positionalScalars (the enemy positional branch).
const offensiveEnemyAt = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection'],
    attack: number,
    hp: number,
    speed: number
): EnemyAttacker =>
    ({
        id,
        stats: { attack, crit: 0, critDamage: 0, defence: 0, hp, speed },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget(selection),
        pattern: basePattern(),
        shipSkills: { slots: [basicAttack()] },
    }) as EnemyAttacker;

/** Cumulative damage credited to `actorId` across the run via the round perTargetDamage maps. */
const totalPerTargetDamage = (result: ReturnType<typeof runCombat>, actorId: string): number => {
    let sum = 0;
    for (const rd of result.rounds) sum += rd.perTargetDamage?.[actorId] ?? 0;
    return sum;
};

/**
 * A positional two-team battle: the player FOCUS ('attacker', the heal target) is a Nyxen built
 * from the real registry, placed at M4 with a base pattern, acting FIRST (speed 200) so it casts
 * its self-shield active before the enemy hits. One positioned enemy ('foe', speed 50) fires
 * `front` → anchors the front-most player (the focus) → drains its live shield.
 *
 * SHIELD HP: focus HP 40_000 → 15% shield = 6_000. Enemy attack 3_000 < 6_000 so the hit dents
 * (does not fully drain) the shield → shieldWasHit true on a working positional path.
 */
const nyxenFocusBattle = (
    skills: ShipSkills,
    overrides: Partial<CombatEngineInput> = {}
): CombatEngineInput => ({
    attack: 10_000, // Nyxen (counter source) attack → counter = 10000 × 100% = 10000
    crit: 0, // no crit → deterministic counter
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: skills,
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 3,
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
    hp: 40_000,
    speed: 200, // acts BEFORE the enemy (speed 50) so the shield is live when the hit arrives
    healTargetId: 'attacker',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    enemyAttackers: [offensiveEnemyAt('foe', 'M4', 'front', 3_000, 1_000_000_000, 50)],
    ...overrides,
});

describe('Task 2 — POSITIONAL shieldWasHit: player Nyxen counters a positional enemy attacker', () => {
    it('player Nyxen (live shield) counters the POSITIONAL enemy attacker that dents its shield', () => {
        // Focus speed 200 casts its 15%-Max-HP self-shield FIRST; the speed-50 positional enemy
        // then drains a LIVE shield → positional shieldWasHit must be true → the shield-hit counter
        // fires against the enemy. The enemy's incoming counter damage surfaces via perTargetDamage.
        const shielded = buildShipAbilities(nyxenShip(/* withActiveShield */ true));
        const result = runCombat(nyxenFocusBattle(shielded));

        const fired = totalPerTargetDamage(result, 'foe');
        // Owner attack 10000 × 100% vs defence 0 / neutral affinity / no crit = 10000 per counter.
        expect(fired).toBeGreaterThan(0);
        for (const rd of result.rounds) {
            const dealt = rd.perTargetDamage?.['foe'] ?? 0;
            if (dealt > 0) expect(dealt).toBeCloseTo(10_000, 6);
        }
    });

    it('NEGATIVE control: no self-shield → no shield ever exists → NO counter on the positional path', () => {
        // Same positional setup but Nyxen has ONLY the passive (no active shield) → the shield never
        // exists → shieldWasHit never true → the foe takes zero counter damage.
        const noShield = buildShipAbilities(nyxenShip(/* withActiveShield */ false));
        const result = runCombat(nyxenFocusBattle(noShield));
        expect(totalPerTargetDamage(result, 'foe')).toBe(0);
    });
});
