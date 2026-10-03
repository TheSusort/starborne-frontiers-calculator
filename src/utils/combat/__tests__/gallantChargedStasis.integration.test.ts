/**
 * #600: Gallant's charged "increased to 185% with additional Stasis applied for 1 turn against
 * Defenders" puts Stasis on a Defender, and only on a Defender.
 *
 * In-fight example: Gallant fires his charged skill at an enemy Defender — the Defender takes
 * Stasis for 1 turn. Fired at an Attacker, no Stasis.
 *
 * Driven through the real parser (`buildShipAbilities` on old-corpus wording of the charged skill,
 * synthetic; the catalogue text differs) and `runCombat`.
 * "applied" is an apply, which lands unless Gallant is at an affinity disadvantage — neither side
 * carries an affinity here, so it always lands and no assertion depends on the seed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { bareEnemy, BARE_ENEMY_ID } from '../__testutils__/bareRosterFixture';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { EnemyBaseClass } from '../../../types/calculator';
import type { Ship } from '../../../types/ship';

const GALLANT_CHARGED =
    'This Unit deals <unit-damage>175% Damage</unit-damage>, increased to <unit-damage>185%</unit-damage> with additional <unit-skill>Stasis</unit-skill> applied for 1 turn against Defenders.';

const gallantSkills = () =>
    buildShipAbilities({
        refits: [{}, {}, {}, {}],
        chargeSkillText: GALLANT_CHARGED,
        chargeSkillCharge: 2,
    } as unknown as Ship);

const stasisLandedOnEnemy = (enemyType: EnemyBaseClass): number => {
    const bus = createEventBus();
    let landed = 0;
    bus.on('debuff-applied', (e) => {
        if (e.sourceId === 'attacker' && e.targetId === BARE_ENEMY_ID && e.buffName === 'Stasis')
            landed += 1;
    });
    const input: CombatEngineInput = {
        attack: 1_000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 2,
        shipSkills: gallantSkills(),
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
        hp: 10_000_000,
        enemyType,
        enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
        bus,
    };
    runCombat(input);
    return landed;
};

describe("#600: Gallant's charged Stasis (current text)", () => {
    beforeEach(() => setupKeyedRng(600));

    it('a Defender takes Stasis from the charged cast', () => {
        expect(stasisLandedOnEnemy('Defender')).toBe(1);
    });

    it('an Attacker does not', () => {
        expect(stasisLandedOnEnemy('Attacker')).toBe(0);
    });
});
