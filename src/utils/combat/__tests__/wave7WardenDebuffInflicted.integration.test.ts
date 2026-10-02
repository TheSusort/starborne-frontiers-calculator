/**
 * wave7WardenDebuffInflicted.integration.test.ts — Ship-kit Wave 7 (Warden).
 *
 * Warden's passive: "…Additionally, when this Unit inflicts a Debuff, it inflicts Out. Damage
 * Down II for 1 turn." The present-tense self-subject recognizer parses it as a reactive debuff on
 * `on-debuff-inflicted` ({type:'debuff', target:'enemy', duration:1}), routed onto the enemy the
 * triggering debuff landed on.
 *
 * The follow-up is ITSELF a debuff, so its own debuff-applied carries the reaction's id in
 * `debuffInflictedReactionChain` and the on-debuff-inflicted listener skips it for that reaction —
 * a precise self-chain guard (else the reaction would re-enter until MAX_INTENT_GENERATIONS
 * throws), while debuffs from other reactive triggers (on-crit/on-attacked) chain like cast
 * inflictions.
 *
 * Her own clause reads "inflicts" (`triggerApplicationFilter:'inflict'`): her active's Provoke is
 * an unconditional APPLY (no hacking roll), so it must NOT wake this passive. Only her Corrosion I
 * (an on-attacked reactive DoT, always rolled — DoTs are never an 'apply') does.
 *
 * Real production kit via buildShipAbilities (mirrors apexSelfShieldGate.integration.test.ts).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import { bareEnemy, attackingEnemy, damageKit } from '../__testutils__/bareRosterFixture';

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
    const makeInput = (enemyAttackers: CombatEngineInput['enemyAttackers']): CombatEngineInput => ({
        enemyAttackers,
        attack: 10_000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: wardenSkills(),
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

    it('her Corrosion I (a reactive DoT — always rolled, never an apply) still fires Out. Damage Down II', () => {
        const bus = createEventBus();
        let outDd = 0;
        bus.on('debuff-applied', (e) => {
            if (e.type === 'debuff-applied' && e.sourceId === 'attacker' && e.buffName === OUT_DD)
                outDd++;
        });
        // attackingEnemy hits Warden every round, arming her "when directly damaged" Corrosion I —
        // her only INFLICTED debuff (her active only APPLIES Provoke, see the test below).
        // Completing at all proves no MAX_INTENT_GENERATIONS throw (the self-chain is guarded).
        const result = runCombat({
            ...makeInput(attackingEnemy({ stats: { hp: 10_000_000 } })),
            bus,
        });
        expect(result.rounds).toHaveLength(3);
        // BOUNDED too — a runaway self-chain would be caught by the generation cap long before any
        // sane count.
        expect(outDd).toBeGreaterThan(0);
        expect(outDd).toBeLessThanOrEqual(3);
    });

    it('her Provoke-only active (an APPLY, no hacking roll) never fires Out. Damage Down II', () => {
        const bus = createEventBus();
        let outDd = 0;
        bus.on('debuff-applied', (e) => {
            if (e.type === 'debuff-applied' && e.sourceId === 'attacker' && e.buffName === OUT_DD)
                outDd++;
        });
        // bareEnemy's default attack:0 means Warden is never directly damaged, so Corrosion I
        // (the only INFLICTED debuff in her kit) never arms — her active still fires every round,
        // applying Provoke, which must not wake this passive.
        const result = runCombat({ ...makeInput(bareEnemy({ stats: { hp: 10_000_000 } })), bus });
        expect(result.rounds).toHaveLength(3);
        expect(outDd).toBe(0);
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

    const focusInput = (slots: ShipSkills['slots']): CombatEngineInput => ({
        attack: 10_000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots },
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

    const countOutDd = (sourceId: string) => {
        const bus = createEventBus();
        let outDd = 0;
        bus.on('debuff-applied', (e) => {
            if (e.type === 'debuff-applied' && e.sourceId === sourceId && e.buffName === OUT_DD)
                outDd++;
        });
        return { bus, get: () => outDd };
    };

    it('the focus hitting the enemy Warden arms her Corrosion I, which still fires Out. Damage Down II', () => {
        const { bus, get } = countOutDd('warden-enemy');
        // The focus's own damage kit hits the enemy Warden every round, arming her "when directly
        // damaged" Corrosion I — her only INFLICTED debuff.
        const result = runCombat({ ...focusInput(damageKit().slots), bus });
        expect(result.rounds).toHaveLength(3);
        expect(get()).toBeGreaterThan(0);
        expect(get()).toBeLessThanOrEqual(3);
    });

    it("the enemy Warden's Provoke-only active (an APPLY) never fires Out. Damage Down II on the player focus", () => {
        const { bus, get } = countOutDd('warden-enemy');
        // The focus has no active abilities, so the enemy Warden is never directly damaged —
        // Corrosion I never arms. She still applies Provoke every round, which must not wake
        // this passive.
        const result = runCombat({ ...focusInput([{ slot: 'active', abilities: [] }]), bus });
        expect(result.rounds).toHaveLength(3);
        expect(get()).toBe(0);
    });
});
