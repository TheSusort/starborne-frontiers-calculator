/**
 * SP-C engine population — Cobalt's owner-vs-target HP-comparison gate ("If this Unit has
 * more HP than the enemy, it additionally deals damage equal to 25% of its max HP").
 *
 * Uses the REAL parsed abilities (via `buildShipAbilities` on Cobalt's verbatim active-skill
 * text from docs/ship-skills.csv) so the `stat-vs-target`/hp/gt condition under test is the
 * production parser output, not a hand-written stand-in.
 *
 * Team-symmetry: the SAME gate must fire whether Cobalt is the focus PLAYER attacker (its
 * `stat-vs-target` condition gates via `runPlayerTurn`'s per-cast `ctx`, fed by the DPS-mode
 * `hp`/`enemyHp` top-level inputs) or an ENEMY attacker (the same condition gates via the
 * SAME code path, fed by `buildTurnArgs`'s live `actor`/`enemy` CombatActor pairing — no
 * player/enemy branch in the implementation).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import { bareEnemy } from '../__testutils__/bareRosterFixture';
import { dealtBy } from '../__testutils__/perTargetDealt';

// Verbatim from docs/ship-skills.csv (active_skill_text field) — same constant used by the
// SP-C Cobalt triage probe / statVsTarget.test.ts parser block.
const COBALT_ACTIVE =
    "This Unit purges <unit-aid>1 buff</unit-aid> from the enemy and deals <unit-damage>200% damage</unit-damage>. If this Unit has more HP than the enemy, it additionally deals <unit-damage>damage equal to 25%</unit-damage> of this Unit's max HP.";

function cobaltShip(): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}, {}, {}], activeSkillText: COBALT_ACTIVE } as Ship;
}

/** Cobalt's REAL production-parsed active-slot abilities (damage + purge + the gated
 *  additional-damage rider carrying the stat-vs-target/hp/gt condition under test). */
const cobaltActiveAbilities = (): Ability[] => {
    const built = buildShipAbilities(cobaltShip());
    const active = built.slots.find((s) => s.slot === 'active');
    if (!active) throw new Error('no active slot built from Cobalt text');
    return active.abilities;
};

const cobaltShipSkills = (): ShipSkills =>
    ({ slots: [{ slot: 'active', abilities: cobaltActiveAbilities() }] }) as ShipSkills;

describe('stat-vs-target engine gate — Cobalt HP-vs-target bonus damage', () => {
    it('player-side Cobalt: the 25%-max-HP bonus lands when its own maxHp exceeds the opponent maxHp', () => {
        const makeInput = (hp: number, enemyHp: number): CombatEngineInput => ({
            // SP-4b-2b: the gate compares Cobalt's max HP against ITS ACTUAL VICTIM's max HP.
            // On a positional run that victim is the roster entry, not the `enemyHp` scalar
            // (M6 — the scalar is inert), so the pool moves onto the roster entry's own
            // `stats.hp` and `enemyHp` is kept in step purely so the two never disagree.
            enemyAttackers: bareEnemy({ stats: { hp: enemyHp } }),
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: cobaltShipSkills(),
            enemyDefense: 0,
            enemyHp,
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
            hp,
            speed: 100,
        });

        // Base hit: 200% of 1000 attack vs 0 defence = 2000 direct damage (no crit, no defence
        // reduction). The 25%-of-50000-maxHp bonus (12500) is far larger — a clean signal.
        const advantaged = runCombat(makeInput(50000, 18000));
        const disadvantaged = runCombat(makeInput(10000, 18000));
        // M3: the scalar `directDamage` channel is dead on a positional run — read Cobalt's own
        // per-victim payout instead.
        expect(dealtBy([advantaged.rounds[0]], 'attacker')).toBeGreaterThan(10_000);
        expect(dealtBy([disadvantaged.rounds[0]], 'attacker')).toBeLessThan(3_000);
        // …and the disadvantaged run still landed its BASE hit, so `< 3_000` is a statement about
        // the bonus being gated off and not about the cast doing nothing at all.
        expect(dealtBy([disadvantaged.rounds[0]], 'attacker')).toBeGreaterThan(0);
    });

    it('enemy-side Cobalt: the SAME gate fires when Cobalt is the ENEMY attacker (team-symmetry)', () => {
        // The focus PLAYER is the passive heal-target sink (huge HP, no offense of its own beyond
        // a token basic attack) so runCombat unlocks the enemy roster (healTargetId requirement)
        // and the enemy attacker's turn targets it as a REAL CombatActor (real currentHp/stats.hp).
        const basicAttack: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'p-a',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 10 },
                        },
                    ],
                },
            ],
        } as ShipSkills;

        const makeInput = (cobaltHp: number, playerHp: number): CombatEngineInput => ({
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: basicAttack,
            enemyDefense: 0,
            enemyHp: 1_000_000_000, // the DPS-dummy the player's own basic attack pokes; irrelevant
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
            hp: playerHp,
            speed: 200, // focus acts first so it has a last-turn ctx before the enemy's cast
            healTargetId: 'attacker',
            mode: 'healing',
            enemyAttackers: [
                {
                    id: 'e1',
                    stats: {
                        attack: 1000,
                        crit: 0,
                        critDamage: 0,
                        speed: 40,
                        hp: cobaltHp,
                        defence: 0,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    shipSkills: cobaltShipSkills(),
                },
            ],
        });

        const events = (input: CombatEngineInput) => {
            const collected: number[] = [];
            const bus = createEventBus();
            bus.on('ability-performed', (e) => {
                if (
                    e.type === 'ability-performed' &&
                    e.actorId === 'e1' &&
                    e.abilityType === 'damage'
                ) {
                    collected.push(e.damage ?? 0);
                }
            });
            runCombat({ ...input, bus });
            return collected;
        };

        const advantaged = events(makeInput(50000, 18000));
        const disadvantaged = events(makeInput(10000, 18000));
        expect(advantaged[0]).toBeGreaterThan(10_000);
        expect(disadvantaged[0]).toBeLessThan(3_000);
    });
});

// Verbatim from docs/ship-skills.csv (charge_skill_text field) — same constant used by the
// SP-C Bayah triage probe / statVsTarget.test.ts parser block.
const BAYAH_CHARGE =
    'This Unit deals <unit-damage>150% damage</unit-damage> plus an additional amount equal to <unit-damage>30%</unit-damage> of its Defense and inflicts <unit-skill>Crit Rate Down II</unit-skill> for 2 turns. If this Unit has more Crit Power than the target, it inflicts <unit-skill>Stasis</unit-skill> for 1 turn.';

function bayahShip(): Ship {
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        chargeSkillText: BAYAH_CHARGE,
        chargeSkillCharge: 2,
    } as Ship;
}

const bayahChargedAbilities = (): Ability[] => {
    const built = buildShipAbilities(bayahShip());
    const charged = built.slots.find((s) => s.slot === 'charged');
    if (!charged) throw new Error('no charged slot built from Bayah text');
    return charged.abilities;
};

const bayahShipSkills = (): ShipSkills =>
    ({ slots: [{ slot: 'charged', abilities: bayahChargedAbilities() }] }) as ShipSkills;

describe('stat-vs-target engine gate — Bayah crit-power-vs-target Stasis inflict', () => {
    it('the ACTUAL Stasis timed-debuff application (not just the control-applied reaction) is gated on crit power', () => {
        // Distinct seam from Cobalt's additional-damage gate: Bayah's Stasis is BOTH a
        // `type:'control'` ability (gates via runPlayerTurn's payload `ctx`, driving the
        // `control-applied` reaction event) AND a named timed ENEMY DEBUFF (gates via the
        // EARLIER `preDebuffGateCtx`, which actually lands/removes the status). Reading
        // RoundData.activeEnemyDebuffs (the reliable per-round landed-debuff source used
        // elsewhere in this suite) proves the real effect landed, not just the event.
        const makeInput = (critDamage: number): CombatEngineInput => ({
            // SP-4b-2b: the gate compares crit power against the ACTUAL victim. `bareEnemy()`
            // carries critDamage 0, exactly like the dummy it replaces, so the gate arithmetic
            // below is unchanged.
            enemyAttackers: bareEnemy({ stats: { hp: 1_000_000 } }),
            attack: 1000,
            crit: 0,
            critDamage,
            defensePenetration: 0,
            chargeCount: 2,
            shipSkills: bayahShipSkills(),
            enemyDefense: 0,
            enemyHp: 1_000_000,
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
            hp: 10_000,
            speed: 100,
        });

        // The opposing roster entry has critDamage 0 (as the dummy did) — any positive self
        // critDamage exceeds it.
        const advantaged = runCombat(makeInput(200));
        const advantagedNames = advantaged.rounds[0].activeEnemyDebuffs.map((d) => d.buffName);
        expect(advantagedNames).toContain('Stasis');

        // Gate-flip control: self critDamage 0 vs the opponent's 0 → NOT strictly
        // greater → Stasis absent (Crit Rate Down II, the unconditional co-debuff, still lands).
        const disadvantaged = runCombat(makeInput(0));
        const disadvantagedNames = disadvantaged.rounds[0].activeEnemyDebuffs.map(
            (d) => d.buffName
        );
        expect(disadvantagedNames).not.toContain('Stasis');
        expect(disadvantagedNames).toContain('Crit Rate Down II');
    });
});

// Verbatim from docs/ship-skills.csv (active_skill_text field) — same constant used by the
// SP-C Chakara triage probe / statVsTarget.test.ts parser block.
const CHAKARA_ACTIVE =
    'This Unit deals <unit-damage>180% damage</unit-damage> with additional damage equal to <unit-damage>80%</unit-damage> of its Defense. If all damaged enemies have more Speed than this Unit, it <unit-aid>adds 1 charge</unit-aid> to its Charged Skill.';

function chakaraShip(): Ship {
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        activeSkillText: CHAKARA_ACTIVE,
    } as Ship;
}

const chakaraActiveAbilities = (): Ability[] => {
    const built = buildShipAbilities(chakaraShip());
    const active = built.slots.find((s) => s.slot === 'active');
    if (!active) throw new Error('no active slot built from Chakara text');
    return active.abilities;
};

const chakaraShipSkills = (): ShipSkills =>
    ({ slots: [{ slot: 'active', abilities: chakaraActiveAbilities() }] }) as ShipSkills;

describe('stat-vs-target engine gate — Chakara speed-vs-target charge gain', () => {
    it('the charge gain lands only when the opponent is faster than Chakara', () => {
        // chargeCount kept high so the ship never actually reaches its charged skill (stays on
        // 'active' every round) — isolating the charge-count delta as the only observable signal.
        const makeInput = (speed: number, enemySpeed: number): CombatEngineInput => ({
            // SP-4b-2b: "all damaged enemies have more Speed than this Unit" is evaluated against
            // the ACTUAL damaged enemies, so the comparison speed moves onto the roster entry's
            // own `stats.speed`. The `enemySpeed` scalar below is the vestigial fight-wide one
            // (M6, inert positionally) and is kept in step only so the two never disagree.
            enemyAttackers: bareEnemy({ stats: { speed: enemySpeed, hp: 1_000_000 } }),
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 5,
            shipSkills: chakaraShipSkills(),
            enemyDefense: 0,
            enemyHp: 1_000_000,
            numRounds: 1,
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
            hp: 10_000,
            speed,
            enemySpeed,
        });

        // Both runs bank the engine's unconditional per-turn charge (advanceChargeCadence) —
        // Chakara's ability grant is an ADDITIONAL +1 on top of that baseline, only when the
        // gate is met. Slower than the enemy (enemy has MORE Speed) → gate met → baseline + 1.
        const advantaged = runCombat(makeInput(40, 60));
        // Chakara faster than the enemy → gate NOT met → baseline only.
        const disadvantaged = runCombat(makeInput(60, 40));
        expect(advantaged.rounds[0].charges).toBe(disadvantaged.rounds[0].charges + 1);
    });
});
