/**
 * apexSelfShieldGate.integration.test.ts — ship-kit Wave 4, Task 3.
 *
 * APEX's charged skill (docs/ship-skills.csv, charge_skill_text): "...If this Unit has Shield,
 * the primary target is inflicted with Disable for 2 turns." Previously `detectGrantConditions`
 * had no `self-shield` subject, so the Disable debuff (and its control twin, which inherits the
 * debuff's conditions per buildShipAbilities.ts:3237-3238) built with NO conditions — Disable
 * inflicted on every charged cast regardless of whether APEX actually held a shield.
 *
 * The fix has two pieces: (a) a new `self-shield` rule in `detectGrantConditions`
 * (skillTextParser.ts); (b) `'self-shield'` added to `LIVE_SUBJECTS` (abilityStatusGating.ts) —
 * REQUIRED because the named Disable timed debuff is gated via
 * `liveGateConditions(ability.conditions)` (engine.ts:260), which neutralizes any derivable
 * subject NOT in LIVE_SUBJECTS to `'always'`; without (b), (a) alone would still let Disable
 * fire unconditionally.
 *
 * Uses APEX's REAL charged-skill text via `buildShipAbilities` (not a hand-written stand-in,
 * mirroring statVsTargetGate.integration.test.ts's Bayah/Cobalt fixtures) so the self-shield
 * rule under test is the production parser output, exercised end-to-end through the real engine
 * gate. Self-shield state is seeded via a synthetic self-shield ability in APEX's ACTIVE slot on
 * round 1 (mirrors shieldBasisSecondaryDamage.integration.test.ts / lodolitePurgeShieldStrip
 * .integration.test.ts's `selfShield` fixture + `healTargetId:'attacker'` idiom — shieldPool
 * grows AFTER round 1's own processing, so round 2's charged cast sees it as a pre-existing live
 * value). `chargeCount:1`/`startCharged:false` → round 1 fires ACTIVE (banks 1 charge), round 2
 * fires CHARGED — exactly when the self-shield-gated Disable inflict is under test.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// Verbatim from docs/ship-skills.csv (charge_skill_text field, APEX row).
const APEX_CHARGE =
    'This Unit deals <unit-damage>220% damage</unit-damage> and inflicts <unit-skill>Attack Down II</unit-skill> and <unit-skill>Out. Damage Down II</unit-skill> for 2 turns. If this Unit has Shield, the primary target is inflicted with <unit-skill>Disable</unit-skill> for 2 turns.';

function apexShip(): Ship {
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        chargeSkillText: APEX_CHARGE,
        chargeSkillCharge: 3,
    } as Ship;
}

/** APEX's REAL production-parsed charged-slot abilities (damage + Attack Down II/Out. Damage
 *  Down II + the self-shield-gated Disable debuff, and its control twin). */
const apexChargedAbilities = (): Ability[] => {
    const built = buildShipAbilities(apexShip());
    const charged = built.slots.find((s) => s.slot === 'charged');
    if (!charged) throw new Error('no charged slot built from APEX text');
    return charged.abilities;
};

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `apx${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const damageAbility = (multiplier: number): Ability =>
    ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier } });

// Self-shield (50% of max HP), same shape as shieldBasisSecondaryDamage.integration.test.ts /
// lodolitePurgeShieldStrip.integration.test.ts's selfShield fixture.
const selfShield = (): Ability =>
    ab({ type: 'shield', target: 'self', config: { type: 'shield', pct: 50, basis: 'hp' } });

/** ACTIVE (round 1) + CHARGED (round 2, APEX's REAL kit) slots. `includeSelfShield` toggles
 *  whether the round-1 active grants APEX a shield — the only difference between Case A/B. */
const apexShipSkills = (includeSelfShield: boolean): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [...(includeSelfShield ? [selfShield()] : []), damageAbility(10)],
        },
        { slot: 'charged', abilities: apexChargedAbilities() },
    ],
});

describe('APEX charged Disable — self-shield gate, player-side (ship-kit Wave 4, Task 3)', () => {
    const makeInput = (includeSelfShield: boolean): CombatEngineInput => ({
        attack: 10000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 1,
        shipSkills: apexShipSkills(includeSelfShield),
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: 2,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: true,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 100_000,
        speed: 100,
        healTargetId: 'attacker', // activates the cast-path self-shield-grant block
        mode: 'healing',
    });

    // Counts the `control-applied` reaction event (effect:'disable') fired by APEX's charged
    // control-twin ability — the OTHER half of the self-shield-gated Disable model
    // (buildShipAbilities.ts:3237-3238 makes the control ability inherit the named debuff's
    // self-shield condition, but that inherited condition is only meaningful if the ctx
    // gateFiringAbilities evaluates it against actually carries `selfShielded` — playerTurn.ts's
    // `ctx` at ~1900, review follow-up to this task). The combat log's kind:'control' Disable
    // entry is driven by this same event, so asserting it here covers the log-visible symptom
    // too.
    const countControlAppliedDisable = (includeSelfShield: boolean): number => {
        const bus = createEventBus();
        let count = 0;
        bus.on('control-applied', (e) => {
            if (e.type === 'control-applied' && e.effect === 'disable') count++;
        });
        runCombat({ ...makeInput(includeSelfShield), bus });
        return count;
    };

    it('Case A: APEX never grants herself a shield → round-2 charged Disable does NOT inflict', () => {
        const result = runCombat(makeInput(false));
        expect(result.rounds).toHaveLength(2);
        const namesR2 = result.rounds[1].activeEnemyDebuffs.map((d) => d.buffName);
        expect(namesR2).not.toContain('Disable');
        // The unconditional co-debuff from the SAME charged cast still lands — proves the
        // charged skill genuinely fired round 2 (not just "everything gated off").
        expect(namesR2).toContain('Attack Down II');
        // The control-type twin (effect:'disable') must be suppressed too — same gate,
        // same ctx, same round.
        expect(countControlAppliedDisable(false)).toBe(0);
    });

    it('Case B: APEX holds a shield (round-1 self-grant) at the round-2 charged cast → Disable inflicts for 2 turns', () => {
        const result = runCombat(makeInput(true));
        expect(result.rounds).toHaveLength(2);
        const namesR2 = result.rounds[1].activeEnemyDebuffs.map((d) => d.buffName);
        expect(namesR2).toContain('Disable');
        expect(namesR2).toContain('Attack Down II');
        // The control-type twin must ALSO fire — it drives `control-applied` (on-stasis-applied-
        // style reactions) and the combat log's kind:'control' Disable entry, which are otherwise
        // invisible in `activeEnemyDebuffs` alone.
        expect(countControlAppliedDisable(true)).toBeGreaterThan(0);
    });
});

describe('APEX charged Disable — team symmetry (ENEMY-side APEX gates the SAME way)', () => {
    const buildEnemyApex = (includeSelfShield: boolean): EnemyAttacker => ({
        id: 'apex-enemy',
        stats: { attack: 10000, crit: 0, critDamage: 0, speed: 40, hp: 1_000_000, defence: 0 },
        chargeCount: 1,
        startCharged: false,
        shipSkills: apexShipSkills(includeSelfShield),
    });

    // The focus is a passive punching bag (huge HP, no offense) so it survives both rounds
    // regardless of APEX's damage — isolating whether Disable lands as the only signal.
    const focusInput = (apex: EnemyAttacker): CombatEngineInput => ({
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [{ slot: 'active', abilities: [damageAbility(0)] }] },
        enemyDefense: 0,
        enemyHp: 1_000_000_000,
        numRounds: 2,
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
        speed: 200, // focus acts first each round
        healTargetId: 'attacker',
        mode: 'healing',
        enemyAttackers: [apex],
    });

    const countDisableAppliedByApex = (includeSelfShield: boolean): number => {
        const bus = createEventBus();
        let count = 0;
        bus.on('debuff-applied', (e) => {
            if (
                e.type === 'debuff-applied' &&
                e.sourceId === 'apex-enemy' &&
                e.buffName === 'Disable'
            ) {
                count++;
            }
        });
        runCombat({ ...focusInput(buildEnemyApex(includeSelfShield)), bus });
        return count;
    };

    // Team-symmetry counterpart of countControlAppliedDisable above — the control-type twin's
    // gate ctx (playerTurn.ts's `ctx`) is built on the SAME acting-actor code path regardless of
    // which side APEX is fighting on, so an enemy-side APEX must gate the control-applied event
    // identically to a player-side APEX.
    const countControlAppliedDisableByApex = (includeSelfShield: boolean): number => {
        const bus = createEventBus();
        let count = 0;
        bus.on('control-applied', (e) => {
            if (
                e.type === 'control-applied' &&
                e.casterId === 'apex-enemy' &&
                e.effect === 'disable'
            ) {
                count++;
            }
        });
        runCombat({ ...focusInput(buildEnemyApex(includeSelfShield)), bus });
        return count;
    };

    it('Case A (enemy side): APEX never self-shields → Disable never lands on the player focus', () => {
        expect(countDisableAppliedByApex(false)).toBe(0);
        expect(countControlAppliedDisableByApex(false)).toBe(0);
    });

    it('Case B (enemy side): APEX holds a shield at the round-2 charged cast → Disable lands on the player focus', () => {
        expect(countDisableAppliedByApex(true)).toBeGreaterThan(0);
        expect(countControlAppliedDisableByApex(true)).toBeGreaterThan(0);
    });
});
