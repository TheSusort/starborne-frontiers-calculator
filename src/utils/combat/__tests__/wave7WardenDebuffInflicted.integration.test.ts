/**
 * wave7WardenDebuffInflicted.integration.test.ts — Ship-kit Wave 7 (Warden).
 *
 * Warden's passive: "…Additionally, when this Unit inflicts a Debuff, it inflicts Out. Damage
 * Down II for 1 turn." Parsed as {type:'debuff', target:'enemy', duration:1} with trigger 'on-cast'
 * (the recognizer only matched the gerund "inflicting"), which classifies it as a passive-slot
 * ENEMY-side TIMED status. That status has NO dispatch site — the per-turn timed loop fires only
 * `sourceSlot === action` (active/charged), and the combat-start seeder reads only the SELF side —
 * so "Out. Damage Down II" never appeared, across every qualifying turn.
 *
 * The fix routes it to the existing reactive `on-debuff-inflicted` trigger (parser: present-tense
 * self-subject recognizer). Warden inflicts Provoke every active turn, so Out. Damage Down II now
 * lands on those turns. The follow-up is ITSELF a debuff, so its own debuff-applied is branded
 * `viaDebuffInflictedReaction` and the on-debuff-inflicted listener skips it — a precise self-chain
 * guard (else the reaction would re-enter and blow MAX_INTENT_GENERATIONS), while debuffs from
 * other reactive triggers (on-crit/on-attacked) still chain as before.
 *
 * Real production kit via buildShipAbilities (mirrors apexSelfShieldGate.integration.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// Verbatim from docs/ship-skills.csv (Warden).
const WARDEN_ACTIVE =
    'This Unit deals <unit-damage>165% damage</unit-damage> and applies <unit-skill>Provoke</unit-skill> for 1 turn.';
const WARDEN_PASSIVE_R2 =
    'When directly damaged, this Unit inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns on that enemy and repairs itself 3% of its Max HP.<br /><br />Additionally, when this Unit inflicts a <unit-skill>Debuff</unit-skill>, it inflicts <unit-skill>Out. Damage Down II</unit-skill> for 1 turn.';

const wardenShip = (): Ship =>
    ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}], // R2 — the second passive (the one carrying Out. Damage Down II)
        activeSkillText: WARDEN_ACTIVE,
        secondPassiveSkillText: WARDEN_PASSIVE_R2,
    }) as Ship;

// Warden's REAL production-parsed active + passive slots.
const wardenSkills = (): ShipSkills => {
    const built = buildShipAbilities(wardenShip());
    const active = built.slots.find((s) => s.slot === 'active');
    const passive = built.slots.find((s) => s.slot === 'passive');
    if (!active || !passive) throw new Error('Warden active/passive slots missing');
    return { slots: [active, passive] };
};

const OUT_DD = 'Out. Damage Down II';

describe('Warden Out. Damage Down II — self-inflicted-debuff reactive (Ship-kit W7)', () => {
    const makeInput = (): CombatEngineInput => ({
        attack: 10_000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: wardenSkills(),
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
        hp: 1_000_000_000,
        speed: 100,
        hacking: 999, // >> enemy security so the reactive Out. Damage Down II lands
        healTargetId: 'attacker',
        mode: 'healing',
    });

    it('player-side: Out. Damage Down II lands (was never dispatched) and does NOT self-chain', () => {
        const bus = createEventBus();
        let outDd = 0;
        bus.on('debuff-applied', (e) => {
            if (e.type === 'debuff-applied' && e.sourceId === 'attacker' && e.buffName === OUT_DD)
                outDd++;
        });
        // Completing at all proves no MAX_INTENT_GENERATIONS throw (the self-chain is guarded).
        const result = runCombat({ ...makeInput(), bus });
        expect(result.rounds).toHaveLength(3);
        // Fires on Warden's own debuff-inflicting turns — at least once, and BOUNDED (a runaway
        // self-chain would be caught by the generation cap long before any sane count).
        expect(outDd).toBeGreaterThan(0);
        expect(outDd).toBeLessThanOrEqual(3);
    });
});

describe('Warden Out. Damage Down II — team symmetry (enemy-side Warden inflicts on the player)', () => {
    const enemyWarden = (): EnemyAttacker => ({
        id: 'warden-enemy',
        stats: {
            attack: 10_000,
            crit: 0,
            critDamage: 0,
            speed: 40,
            hp: 1_000_000,
            defence: 0,
            hacking: 999,
        },
        chargeCount: 0,
        startCharged: false,
        shipSkills: wardenSkills(),
    });

    const focusInput = (): CombatEngineInput => ({
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
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
        hp: 1_000_000_000,
        speed: 200, // focus acts first; the enemy Warden acts after and inflicts on the focus
        healTargetId: 'attacker',
        mode: 'healing',
        enemyAttackers: [enemyWarden()],
    });

    it('an enemy-side Warden inflicts Out. Damage Down II on the player focus, no self-chain', () => {
        const bus = createEventBus();
        let outDd = 0;
        bus.on('debuff-applied', (e) => {
            if (
                e.type === 'debuff-applied' &&
                e.sourceId === 'warden-enemy' &&
                e.buffName === OUT_DD
            )
                outDd++;
        });
        const result = runCombat({ ...focusInput(), bus });
        expect(result.rounds).toHaveLength(3);
        expect(outDd).toBeGreaterThan(0);
        expect(outDd).toBeLessThanOrEqual(3);
    });
});
