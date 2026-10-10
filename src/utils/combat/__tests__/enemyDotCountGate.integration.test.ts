/**
 * SP-D engine population — Anemone's charged-skill Taunt gate ("If the primary enemy has 3
 * or more Damage over Time effects, this Unit gains Taunt for 1 turn"), live-derived from the
 * actual per-target DoT entry counts (corrosion + inferno + generic). A Bomb is a debuff but not
 * a damage-over-time effect (owner ruling R112), so it is not counted.
 *
 * Uses Anemone's REAL production-parsed charged-slot abilities (built via `buildShipAbilities`
 * on her charge_skill_text, in old-corpus wording) so the `enemy-dot-count` condition
 * under test is the production parser output, not a hand-written stand-in. The active slot is a
 * hand-crafted set of DoT-inflicting abilities (Anemone's own kit only inflicts Corrosion —
 * getting a THIRD, distinct DoT family onto the target organically would require other ships)
 * used to seed the target's pre-existing DoT entries in round 1, so round 2's charged cast reads
 * a real (not simulated) count via preDebuffGateCtx/postDebuffGateCtx — the SAME funnel Task 1
 * proved for Bayah's crit-power-gated Stasis.
 *
 * chargeCount is set to the CAP (1): round 1 (bank 0 < cap 1) fires the active seed abilities and
 * banks the unconditional +1 cadence; round 2 (bank 1 >= cap 1) fires the charged skill, whose
 * gate reads the round-1 DoT entries (2-turn duration — still present) plus this cast's own
 * Corrosion III, written before the gate (owner ruling R29).
 *
 * Team-symmetry: the SAME gate must fire whether Anemone is the focus PLAYER attacker or an
 * ENEMY attacker splashing a player-side target — no player/enemy branch in the implementation.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { StatusEngine } from '../statusEngine';
import { bareEnemy } from '../__testutils__/bareRosterFixture';

// Old-corpus wording of Anemone's charged skill (synthetic; the catalogue text differs) — same
// constant used by the Anemone triage probe / enemyDotCount.test.ts parser block.
const ANEMONE_CHARGE =
    'This Unit deals <unit-damage>200% damage</unit-damage> and inflicts <unit-skill>Corrosion III</unit-skill> for 2 turns. If the primary enemy has 3 or more Damage over Time effects, this Unit gains <unit-skill>Taunt</unit-skill> for 1 turn.';

function anemoneShip(): Ship {
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        chargeSkillText: ANEMONE_CHARGE,
        chargeSkillCharge: 3,
    } as Ship;
}

/** Anemone's REAL production-parsed charged-slot abilities (damage + auto-filled Corrosion III +
 *  the gated Taunt self-buff carrying the enemy-dot-count/gte/3 condition under test). */
const anemoneChargedAbilities = (): Ability[] => {
    const built = buildShipAbilities(anemoneShip());
    const charged = built.slots.find((s) => s.slot === 'charged');
    if (!charged) throw new Error('no charged slot built from Anemone text');
    return charged.abilities;
};

type SeedDotType = 'corrosion' | 'inferno' | 'bomb';

let idc = 0;
/** Hand-crafted DoT-seeding ability (active slot): NOT Anemone's real active skill text — just
 *  scaffolding to land a pre-existing DoT entry of the given family on the target in round 1. */
const seedDot = (dotType: SeedDotType): Ability => ({
    id: `seed-${dotType}-${++idc}`,
    type: 'dot',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'dot', dotType, tier: 15, stacks: 1, duration: 2 },
});

const anemoneShipSkills = (seedDots: SeedDotType[]): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: seedDots.map(seedDot) },
        { slot: 'charged', abilities: anemoneChargedAbilities() },
    ],
});

describe('enemy-dot-count engine gate — Anemone charged-skill Taunt (player side)', () => {
    const tauntGranted = (seedDots: SeedDotType[]): boolean => {
        idc = 0;
        let engine: StatusEngine | undefined;
        runCombat({
            // A real opponent for the seeded DoTs to accrue on. Inert and huge-HP so the
            // 1000-attack focus cannot kill it across the two rounds the gate needs.
            enemyAttackers: bareEnemy({ stats: { hp: 1_000_000_000 } }),
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 1, // cap: round 1's baseline +1 cadence reaches it → round 2 casts charged
            shipSkills: anemoneShipSkills(seedDots),
            numRounds: 2,
            selfBuffs: [],
            enemyDebuffs: [],
            hasChargedSkill: true,
            startCharged: false,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 100,
            __testTapStatusEngine: (e) => {
                engine = e;
            },
        });
        return engine!
            .timedAbilityStatuses('self', 'attacker')
            .some((b) => b.active.buffName === 'Taunt');
    };

    it('target carries 3 pre-existing DoT entries (corrosion+inferno+bomb) → Taunt IS granted', () => {
        expect(tauntGranted(['corrosion', 'inferno', 'bomb'])).toBe(true);
    });

    it('a Bomb is not a DoT effect: Inferno + Bomb + her Corrosion III = 2 → Taunt is NOT granted', () => {
        expect(tauntGranted(['inferno', 'bomb'])).toBe(false);
    });

    it('target carries 2 pre-existing DoT entries + her own Corrosion III → Taunt IS granted', () => {
        expect(tauntGranted(['corrosion', 'inferno'])).toBe(true);
    });

    it('target carries only 1 pre-existing DoT entry (+ her Corrosion III = 2) → Taunt is NOT granted', () => {
        expect(tauntGranted(['corrosion'])).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Team-symmetry: the SAME gate fires when Anemone is the ENEMY attacker, seeding DoTs onto and
// then casting her charged skill against the player-side focus. Mirrors
// statVsTargetGate.integration.test.ts's Cobalt enemy-side harness — the focus is a passive HP
// sink (healTargetId unlocks the enemy roster) so the enemy's DoT-seeding + charged cast targets
// a REAL CombatActor.
// ---------------------------------------------------------------------------
describe('enemy-dot-count engine gate — Anemone charged-skill Taunt (enemy side, team-symmetric)', () => {
    const enemyTauntGranted = (seedDots: SeedDotType[]): boolean => {
        idc = 0;
        let engine: StatusEngine | undefined;
        runCombat({
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
            numRounds: 2,
            selfBuffs: [],
            enemyDebuffs: [],
            hasChargedSkill: false,
            startCharged: false,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 1,
            healTargetId: 'attacker',
            mode: 'healing',
            enemyAttackers: [
                {
                    id: 'e1',
                    stats: {
                        attack: 1000,
                        crit: 0,
                        critDamage: 0,
                        speed: 200,
                        hp: 1_000_000_000,
                        defence: 0,
                    },
                    chargeCount: 1,
                    startCharged: false,
                    shipSkills: anemoneShipSkills(seedDots),
                },
            ],
            __testTapStatusEngine: (e) => {
                engine = e;
            },
        } as CombatEngineInput);
        return engine!
            .timedAbilityStatuses('self', 'e1')
            .some((b) => b.active.buffName === 'Taunt');
    };

    it('an ENEMY Anemone whose target carries 3 pre-existing DoT entries IS granted Taunt', () => {
        expect(enemyTauntGranted(['corrosion', 'inferno', 'bomb'])).toBe(true);
    });

    it('an ENEMY Anemone whose target carries Inferno + Bomb (+ her Corrosion III) is NOT granted Taunt', () => {
        expect(enemyTauntGranted(['inferno', 'bomb'])).toBe(false);
    });

    it('an ENEMY Anemone whose target carries 2 pre-existing DoT entries + her Corrosion III IS granted Taunt', () => {
        expect(enemyTauntGranted(['corrosion', 'inferno'])).toBe(true);
    });

    it('an ENEMY Anemone whose target carries only 1 pre-existing DoT entry is NOT granted Taunt', () => {
        expect(enemyTauntGranted(['corrosion'])).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Belladonna's named-family gate counts Acidic Decay only: Acidic Decay exists only where her
// conversion passive re-tagged a Corrosion stack, and this fixture carries no such passive, so
// enemyDotFamilyCounts['Acidic Decay'] stays 0 and the Stasis inflict never lands even when the
// plain DoT count (corrosion+inferno+bomb) is high. Build-output coverage (the condition is
// actually EMITTED) lives in enemyDotCount.test.ts / modelCompletenessTriage.
// ---------------------------------------------------------------------------
const BELLADONNA_CHARGE =
    'This Unit deals <unit-damage>180% damage</unit-damage> and inflicts <unit-skill>Corrosion II</unit-skill> for 2 turns.<br />If the enemy has 3 or more <unit-skill>Acidic Decay</unit-skill>, inflict <unit-skill>Stasis</unit-skill> for 1 turn.';

function belladonnaShip(): Ship {
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        chargeSkillText: BELLADONNA_CHARGE,
        chargeSkillCharge: 3,
    } as Ship;
}

const belladonnaChargedAbilities = (): Ability[] => {
    const built = buildShipAbilities(belladonnaShip());
    const charged = built.slots.find((s) => s.slot === 'charged');
    if (!charged) throw new Error('no charged slot built from Belladonna text');
    return charged.abilities;
};

const belladonnaShipSkills = (seedDots: SeedDotType[]): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: seedDots.map(seedDot) },
        { slot: 'charged', abilities: belladonnaChargedAbilities() },
    ],
});

describe('enemy-dot-count engine gate — Belladonna charged-skill Stasis reads Acidic Decay only', () => {
    it('3 pre-existing plain DoT entries and no conversion passive: no Acidic Decay, so no Stasis', () => {
        idc = 0;
        const result = runCombat({
            // A real opponent for the seeded DoTs to accrue on. Inert and huge-HP so the
            // 1000-attack focus cannot kill it across the two rounds the gate needs.
            enemyAttackers: bareEnemy({ stats: { hp: 1_000_000_000 } }),
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 1,
            shipSkills: belladonnaShipSkills(['corrosion', 'inferno', 'bomb']),
            numRounds: 2,
            selfBuffs: [],
            enemyDebuffs: [],
            hasChargedSkill: true,
            startCharged: false,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 100,
        });
        // ANTI-VACUITY: this is a bare negative assertion, so it is only meaningful if the charged
        // cast carrying the gated Stasis clause actually FIRED in round 2. Without this, a fixture
        // that never reached the charged skill at all (wrong cadence, dead opponent, a throw
        // swallowed upstream) would pass for reasons unrelated to the gate.
        expect(result.rounds[1].action).toBe('charged');

        const round2Names = result.rounds[1].activeEnemyDebuffs.map((d) => d.buffName);
        // Plain Corrosion, Inferno and Bomb stacks are not Acidic Decay.
        expect(round2Names).not.toContain('Stasis');
    });
});
