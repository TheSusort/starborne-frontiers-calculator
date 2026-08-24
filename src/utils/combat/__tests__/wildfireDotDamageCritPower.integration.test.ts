/**
 * Sub-project I, PR I4a/I4b — Wildfire's `dotDamage`-channel crit-power scaling, combat-engine
 * integration.
 *
 * Locks the FOUNDATION shape: "when an enemy has Scorching Radiation, this Unit deals N%
 * additional Inferno damage to that unit for every 10% crit power" — a `dotDamage` modifier
 * gated on the NAMED enemy debuff (reusing I1's name-specific `enemy-debuff` gating, same as
 * Incinerator/Tygr) and SCALED by the caster's own live crit power (the 'self-crit-power'
 * condition subject, evaluateConditions.ts).
 *
 * I4a SHIPPED a single-target / cast-time approximation (per the sub-project I design doc §9):
 * the gate was baked ONCE per cast against the primary target's modifierCtx, so an inferno tick
 * later in the SAME round as its own Scorching-Radiation infliction was (incorrectly) NOT
 * boosted — a same-turn causality guard that made sense for an outgoing-damage-style CAST gate
 * (I1) but not for a DoT TICK, which is a genuinely LATER, separate event.
 *
 * I4b (this file, updated) fixes that: the gate is now re-evaluated PER VICTIM PER TICK against
 * that victim's CURRENT live status (see `victimDotMult` in engine.ts) — a DoT tick has no
 * anti-causality concern about seeing that SAME round's own earlier infliction, because ticking
 * happens strictly AFTER casting within a round (default speeds: attacker 100 > enemy 50, so the
 * attacker's cast — infliction + inferno application — always precedes the enemy's own tick this
 * round). Round 1 below is now boosted (the gate is live and Scorching Radiation already landed
 * earlier in round 1's own cast); Per-victim(AoE) scoping and the expiring-mid-fight case are the
 * I4b-specific tests further down. Distributing the bonus to OTHER allies (the refit-3 "all
 * allies deal…" team-aura text) remains deferred to I4c.
 *
 * Comparison strategy: two runs with IDENTICAL DoT application/stacking dynamics (same
 * active skill firing the same debuff + dot abilities every round) — one WITH the new
 * dotDamage-scaling modifier ability, one WITHOUT. Because both runs apply the exact same
 * DoT entries each round, any difference in `infernoDamage` is attributable ONLY to the
 * modifier's dotMult delta — sidestepping cross-round DoT-stacking arithmetic entirely.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor } from '../state';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `wfdp${++idc}`,
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

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// A single positioned, passive (attack:0) enemy — the sole recipient of the focus attacker's
// positional cast. security:0 so the Scorching Radiation debuff-inflict always lands.
const passiveEnemyAt = (position: Position): EnemyAttacker => ({
    id: 'enemy-front',
    stats: {
        attack: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 1,
        security: 0,
    },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

// critDamage: 150 — the caster's own crit power. With perUnit 0.1 (Wildfire's base passive,
// "1% additional … for every 10% crit power") the scaling contributes 150 * 0.1 = +15%.
const engineBase = (shipSkills: ShipSkills): CombatEngineInput => ({
    attack: 10_000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills,
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
    // hacking 200 vs enemy security 0 → inflict landing chance clamp((200-0)/100) = 1.0.
    hacking: 200,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    enemyAttackers: [passiveEnemyAt('M4')],
});

/** Shared payload abilities: a plain hit + a Scorching Radiation inflict + an Inferno DoT,
 *  fired every round (identical in both the "with modifier" and "control" skill lists). */
function payloadAbilities(): Ability[] {
    return [
        ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
        ab({
            type: 'debuff',
            config: {
                type: 'debuff',
                buffName: 'Scorching Radiation',
                application: 'inflict',
                duration: 5,
                stacks: 1,
                isStackable: false,
                parsedEffects: {},
            },
        }),
        ab({
            type: 'dot',
            config: { type: 'dot', dotType: 'inferno', tier: 10, stacks: 1, duration: 5 },
        }),
    ];
}

/** The Wildfire-shape modifier: dotDamage, gated on the named enemy debuff + scaled by the
 *  caster's own live crit power (perUnit 0.1 = the base passive's "1% … per 10% crit power"). */
function wildfireModifier(): Ability {
    return ab({
        target: 'self',
        type: 'modifier',
        conditions: [
            { subject: 'enemy-debuff', derivable: true, buffName: 'Scorching Radiation' },
            { subject: 'self-crit-power', derivable: true },
        ],
        scaling: { conditionIndex: 1, perUnit: 0.1 },
        config: { type: 'modifier', channel: 'dotDamage', value: 0, isMultiplicative: false },
    });
}

describe('Wildfire dotDamage crit-power scaling (sub-project I, PR I4a/I4b) — engine integration', () => {
    it("I4b: round 1 IS boosted — the tick happens after this round's own infliction, live", () => {
        idc = 0;
        const withMod: ShipSkills = {
            slots: [{ slot: 'active', abilities: [...payloadAbilities(), wildfireModifier()] }],
        };
        const control: ShipSkills = { slots: [{ slot: 'active', abilities: payloadAbilities() }] };

        const withModResult = runCombat(engineBase(withMod));
        const controlResult = runCombat(engineBase(control));

        // At default speeds the attacker (100) acts before the enemy (50) every round, so by
        // the time the enemy dummy TICKS its inferno entries this round, the attacker's OWN
        // cast (earlier this same round) has already inflicted Scorching Radiation. I4b reads
        // the victim's status LIVE at tick time (no pre-turn snapshot — a tick is a genuinely
        // later event than the cast that applied it, unlike a same-cast outgoing-modifier gate)
        // → the gate is already true in round 1. This supersedes I4a's cast-time approximation,
        // which incorrectly read false here (see the file header).
        expect(controlResult.rounds[0].infernoDamage).toBeGreaterThan(0);
        expect(withModResult.rounds[0].infernoDamage).toBeCloseTo(
            controlResult.rounds[0].infernoDamage * 1.15,
            0
        );
    });

    it('round 2 (Scorching Radiation still present): Inferno ticks are boosted by critPower × perUnit%', () => {
        idc = 0;
        const withMod: ShipSkills = {
            slots: [{ slot: 'active', abilities: [...payloadAbilities(), wildfireModifier()] }],
        };
        const control: ShipSkills = { slots: [{ slot: 'active', abilities: payloadAbilities() }] };

        const withModResult = runCombat(engineBase(withMod));
        const controlResult = runCombat(engineBase(control));

        // Round 1's own Scorching Radiation infliction is now pre-existing at the start of
        // round 2 → the gate reads true → dotMult gains +15pp (critDamage 150 * perUnit 0.1).
        // Both runs apply IDENTICAL DoT entries/stacking each round, so the ratio isolates the
        // modifier's delta cleanly regardless of how many entries are actively ticking.
        expect(controlResult.rounds[1].infernoDamage).toBeGreaterThan(0);
        expect(withModResult.rounds[1].infernoDamage).toBeCloseTo(
            controlResult.rounds[1].infernoDamage * 1.15,
            0
        );
    });

    it('I4b single-target equivalence: when Scorching Radiation is present for the WHOLE fight, every round gets the SAME critPower × perUnit% boost (matches what I4a intended for its scoped case)', () => {
        // payloadAbilities() re-inflicts Scorching Radiation every round (duration 5, refreshed
        // before it can expire) → the victim carries the status for the entire fight. Per-tick
        // live evaluation (I4b) then agrees with a cast-time bake (I4a) on EVERY round, because
        // the gate is true regardless of WHEN it is read. This is the regression the design doc
        // asks for: I4b must not diverge from I4a's numbers once the cast-time/tick-time
        // distinction stops mattering (status always present).
        idc = 0;
        const withMod: ShipSkills = {
            slots: [{ slot: 'active', abilities: [...payloadAbilities(), wildfireModifier()] }],
        };
        const control: ShipSkills = { slots: [{ slot: 'active', abilities: payloadAbilities() }] };
        const numRounds = 4;

        const withModResult = runCombat({ ...engineBase(withMod), numRounds });
        const controlResult = runCombat({ ...engineBase(control), numRounds });

        for (let r = 0; r < numRounds; r++) {
            expect(controlResult.rounds[r].infernoDamage).toBeGreaterThan(0);
            expect(withModResult.rounds[r].infernoDamage).toBeCloseTo(
                controlResult.rounds[r].infernoDamage * 1.15,
                0
            );
        }
    });

    it('an enemy WITHOUT Scorching Radiation never gets the boost, even across many rounds', () => {
        // Same modifier + crit power, but the skill never inflicts the named debuff at all
        // (only the plain hit + Inferno DoT) — the enemy-debuff gate never lands.
        idc = 0;
        const noStatusPayload = (): Ability[] => [
            ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
            ab({
                type: 'dot',
                config: { type: 'dot', dotType: 'inferno', tier: 10, stacks: 1, duration: 5 },
            }),
        ];
        const withMod: ShipSkills = {
            slots: [{ slot: 'active', abilities: [...noStatusPayload(), wildfireModifier()] }],
        };
        const control: ShipSkills = {
            slots: [{ slot: 'active', abilities: noStatusPayload() }],
        };

        const withModResult = runCombat({ ...engineBase(withMod), numRounds: 3 });
        const controlResult = runCombat({ ...engineBase(control), numRounds: 3 });

        for (let r = 0; r < 3; r++) {
            expect(withModResult.rounds[r].infernoDamage).toBe(
                controlResult.rounds[r].infernoDamage
            );
        }
    });
});

// ---------------------------------------------------------------------------
// I4b — per-VICTIM gating. The cast-time approximation (I4a) baked ONE dotMult from the
// PRIMARY target's gate and applied it to every tick the caster's DoTs produced, on ANY
// victim. These tests prove the fix: the SAME applier's ctx produces a DIFFERENT effective
// dotMult depending on which victim is ticking, based on THAT victim's own live status.
// ---------------------------------------------------------------------------
describe('Wildfire dotDamage crit-power scaling — I4b per-victim/per-tick gating', () => {
    // A passive, high-HP, positioned enemy — reused for both the (targeted) front victim and
    // the (untouched) covered victim in the AoE test below.
    const passiveVictimAt = (id: string, position: Position, security = 0): EnemyAttacker => ({
        id,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 1,
            security,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
    });

    it('AoE mixed-victim: the SAME applier ctx boosts a tick on a Scorching-Radiation victim but NOT a tick on an untouched victim', () => {
        idc = 0;
        // The focus's OWN cast (hit + Scorching Radiation inflict + Inferno DoT, all single-
        // target 'enemy' — top-level pattern stays non-AoE 'base') only ever touches the
        // resolved anchor 'front'. 'covered' is NEVER hit or debuffed by the focus's normal
        // cast; instead we seed an Inferno entry directly onto it (__testTapActors) sourced
        // from the SAME applier ('attacker') — proving the gate is evaluated per VICTIM, not
        // baked once into the applier's ctx.
        const shipSkills: ShipSkills = {
            slots: [{ slot: 'active', abilities: [...payloadAbilities(), wildfireModifier()] }],
        };
        const result = runCombat({
            attack: 10_000,
            crit: 0,
            critDamage: 150,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills,
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
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
            hacking: 200,
            healTargetId: 'attacker',
            mode: 'healing',
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            enemyAttackers: [passiveVictimAt('front', 'M4'), passiveVictimAt('covered', 'M3')],
            __testTapActors: (actors: CombatActor[]) => {
                const covered = actors.find((a) => a.id === 'covered');
                covered?.infernoEntries.push({
                    tier: 10,
                    stacks: 1,
                    remainingRounds: 5,
                    sourceId: 'attacker',
                });
            },
        } as CombatEngineInput);

        // 'front': direct hit (10000) + BOOSTED inferno tick (10000 × 0.10 × 1.15 = 1150), since
        // this round's own Scorching-Radiation infliction is already live by tick time (I4b).
        expect(result.rounds[0].perTargetDamage?.['front']).toBe(11_150);
        // 'covered': no direct hit (non-AoE cast never touches it) — pure UNBOOSTED inferno tick
        // (10000 × 0.10 × 1.00 = 1000), from the SAME applier 'attacker' whose ctx carries the
        // Wildfire modifier. If the gate were still baked once per applier (I4a), 'covered' would
        // wrongly inherit 'front'’s boost.
        expect(result.rounds[0].perTargetDamage?.['covered']).toBe(1_000);
    });

    it('expiry: the bonus drops on a later tick once Scorching Radiation expires on the victim, even though the Inferno DoT itself keeps ticking', () => {
        idc = 0;
        // Scorching Radiation is inflicted ONLY on turn 1 (every-n-turns period 99 offset 1 —
        // matches turnsTaken===1, never again) with a SHORT duration so it expires quickly and is
        // never refreshed. The Inferno DoT (long duration 10) is applied every round so a single
        // long-lived entry keeps ticking well past the status's expiry.
        const onceOnTurn1 = {
            subject: 'every-n-turns' as const,
            derivable: true,
            period: 99,
            offset: 1,
        };
        const skills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                        ab({
                            type: 'debuff',
                            conditions: [onceOnTurn1],
                            config: {
                                type: 'debuff',
                                buffName: 'Scorching Radiation',
                                application: 'inflict',
                                duration: 1,
                                stacks: 1,
                                isStackable: false,
                                parsedEffects: {},
                            },
                        }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'inferno',
                                tier: 10,
                                stacks: 1,
                                duration: 10,
                            },
                        }),
                        wildfireModifier(),
                    ],
                },
            ],
        };

        const numRounds = 4;
        const withModResult = runCombat({ ...engineBase(skills), numRounds });
        const control: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                        ab({
                            type: 'debuff',
                            conditions: [onceOnTurn1],
                            config: {
                                type: 'debuff',
                                buffName: 'Scorching Radiation',
                                application: 'inflict',
                                duration: 1,
                                stacks: 1,
                                isStackable: false,
                                parsedEffects: {},
                            },
                        }),
                        ab({
                            type: 'dot',
                            config: {
                                type: 'dot',
                                dotType: 'inferno',
                                tier: 10,
                                stacks: 1,
                                duration: 10,
                            },
                        }),
                    ],
                },
            ],
        };
        const controlResult = runCombat({ ...engineBase(control), numRounds });

        // Round 1: Scorching Radiation just inflicted this round, live by tick time → boosted.
        expect(controlResult.rounds[0].infernoDamage).toBeGreaterThan(0);
        expect(withModResult.rounds[0].infernoDamage).toBeCloseTo(
            controlResult.rounds[0].infernoDamage * 1.15,
            0
        );
        // From SOME later round onward the 1-turn-duration status has expired and is never
        // refreshed (onceOnTurn1 never fires again) — the boost disappears even though the
        // long-lived (duration 10) Inferno entry keeps ticking every round at the SAME
        // (unboosted) rate as the control. Find the first round the ratio drops to 1.0 and
        // assert every round from there on stays unboosted.
        const ratios = withModResult.rounds.map((rd, r) =>
            controlResult.rounds[r].infernoDamage > 0
                ? rd.infernoDamage / controlResult.rounds[r].infernoDamage
                : undefined
        );
        const droppedIdx = ratios.findIndex((ratio) => ratio !== undefined && ratio < 1.1);
        expect(droppedIdx).toBeGreaterThan(0); // boosted for at least round 1, drops LATER
        for (let r = droppedIdx; r < numRounds; r++) {
            expect(withModResult.rounds[r].infernoDamage).toBeCloseTo(
                controlResult.rounds[r].infernoDamage,
                0
            );
        }
    });
});
