/**
 * Sub-project I, PR I3 — team-aura distribution for outgoing-damage `modifier` abilities
 * (Layer 1), combat-engine integration.
 *
 * `modifierTotalsFromAbilities` (applyAbilities.ts) has always ignored the `target` field on
 * a `modifier` ability — an `all-allies`-scoped aura ("all allies deal N% more damage…") only
 * ever affected the CASTER's own attacks, because `runPlayerTurn`'s `modifierAbilities` was
 * built from the acting actor's OWN firing + passive skills only (playerTurn.ts:1339, pre-I3).
 *
 * This suite locks the fix: `engine.ts`'s `buildTurnArgs` gathers `all-allies`-targeted
 * PASSIVE `modifier` abilities from every LIVING same-side ally (excluding the recipient's own
 * id — no double-count) and threads them as `allyModifierAbilities`, which `runPlayerTurn`
 * merges into `modifierAbilities` (playerTurn.ts). Because that list feeds BOTH the per-turn
 * `dmgStats` fold AND (PR I2) `perVictimOutgoing`, and is evaluated against the RECIPIENT's OWN
 * `ConditionContext`, a self-buff gate (Panguan's own Stealth) and an enemy-status gate
 * (Lodolite's Concentrate Fire) both resolve correctly from the recipient-attacker's
 * perspective — this is what makes "Friendly … units" include the caster for free.
 *
 * Two ship shapes from the design spec (§3 Pattern B / Pattern A):
 *   - Panguan-shape: "Friendly Stealthed units deal 40% more direct damage" — gated on the
 *     RECIPIENT's own `self-buff` Stealth.
 *   - Lodolite-shape: "all allies deal 15% more direct damage to enemies with Concentrate
 *     Fire" — gated on the (I1/I2) per-target NAMED `enemy-debuff`, composing with the
 *     existing name-specific + per-victim machinery.
 *
 * Damage is read off the `ability-performed` bus event (`damage` field), which fires once per
 * firing cast for EVERY actor on EITHER side — the same measurement works uniformly for a
 * walked-team ally and an enemy attacker, proving team-symmetry without bespoke plumbing.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatStatBlock } from '../../../types/calculator';
import type { CombatEvent } from '../events';
import { createEventBus } from '../events';
import { bareEnemy } from '../__testutils__/bareRosterFixture';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `tad${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const basicDamage = (multiplier: number, id?: string): Ability =>
    ab({ id, type: 'damage', target: 'enemy', config: { type: 'damage', multiplier } });

// A self-cast Stealth grant (99-turn duration, refreshed every cast) — mirrors the pattern in
// incomingBlockEngine.test.ts / allyChargeGrant.test.ts's `stealthEnemy`. Applied via the
// SAME timedSelfBySlot → statusEngine → same-turn read pipeline that lets Panguan's own
// Stealth gate its own attack the round it casts (no 2-round dance needed for self-buffs,
// unlike the enemy-debuff anti-causality rule).
const stealthSelfBuff = (id: string): Ability =>
    ab({
        id,
        type: 'buff',
        target: 'self',
        config: {
            type: 'buff',
            buffName: 'Stealth',
            parsedEffects: {},
            stacks: 1,
            isStackable: false,
            duration: 99,
        },
    });

// Panguan-shape aura: all-allies +40% outgoing damage, gated on the RECIPIENT's own Stealth.
const panguanAura = (value = 40): Ability =>
    ab({
        id: 'panguan-aura',
        type: 'modifier',
        target: 'all-allies',
        conditions: [{ subject: 'self-buff', buffName: 'Stealth', derivable: true }],
        config: { type: 'modifier', channel: 'outgoingDamage', value, isMultiplicative: true },
    });

// Lodolite-shape aura: all-allies +15% outgoing damage, gated on the (I1/I2) per-target
// NAMED enemy-debuff 'Concentrate Fire'.
const lodoliteAura = (value = 15): Ability =>
    ab({
        id: 'lodolite-aura',
        type: 'modifier',
        target: 'all-allies',
        conditions: [{ subject: 'enemy-debuff', buffName: 'Concentrate Fire', derivable: true }],
        config: { type: 'modifier', channel: 'outgoingDamage', value, isMultiplicative: true },
    });

const cfDebuffInflict = (id: string): Ability =>
    ab({
        id,
        type: 'debuff',
        config: {
            type: 'debuff',
            buffName: 'Concentrate Fire',
            application: 'inflict',
            duration: 5,
            stacks: 1,
            isStackable: false,
            parsedEffects: {},
        },
    });

const passiveOnly = (...abilities: Ability[]): ShipSkills => ({
    slots: [{ slot: 'passive', abilities }],
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const teamStats = (attack: number): CombatStatBlock => ({
    attack,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    defence: 0,
    hp: 1_000_000_000,
    hacking: 0,
});

// A walked, non-positional team ally with the given active slot and NO passive (never itself
// an aura source). speed 100 so it acts every round like the focus.
const teamAlly = (id: string, attack: number, skills: ShipSkills): TeamActorEngineInput =>
    ({
        id,
        speed: 100,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        walk: {
            shipSkills: skills,
            stats: teamStats(attack),
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
            healModifier: 0,
        },
    }) as TeamActorEngineInput;

// The aura-source team ally: passive-only (never fires a damage ability itself), so its own
// contribution to any measured damage total is always 0 — isolates the DISTRIBUTED bonus on
// the OTHER actor(s) being measured.
const auraSourceTeamActor = (id: string, aura: Ability): TeamActorEngineInput =>
    teamAlly(id, 0, passiveOnly(aura));

const baseEngineInput = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: bareEnemy(),
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
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
    healTargetId: 'attacker',
    mode: 'healing',
    ...overrides,
});

// Tap the event bus for `ability-performed`, indexed by actorId (each fires once per firing
// cast; the FIRST entry per actor per test suffices since every fixture here is single-round
// or reads only round 1/2 as noted per test).
const abilityPerformedByActor = (result: { events: CombatEvent[] }): Map<string, number[]> => {
    const map = new Map<string, number[]>();
    for (const e of result.events) {
        if (e.type !== 'ability-performed') continue;
        const list = map.get(e.actorId) ?? [];
        list.push(e.damage ?? 0);
        map.set(e.actorId, list);
    }
    return map;
};

const collect = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('ability-performed', (e) => events.push(e as CombatEvent));
    const result = runCombat({ ...input, bus });
    return { events, result };
};

describe('team-aura distribution for outgoing-damage modifiers (sub-project I, PR I3)', () => {
    describe('Panguan-shape (self-buff Stealth gate)', () => {
        it('an ally that is NOT the aura source receives the bonus when IT is Stealthed', () => {
            idc = 0;
            const ATTACK = 10_000;
            const { events } = collect(
                baseEngineInput({
                    teamActors: [
                        auraSourceTeamActor('source', panguanAura()),
                        teamAlly('ally', ATTACK, {
                            slots: [
                                {
                                    slot: 'active',
                                    abilities: [
                                        basicDamage(100, 'ally-dmg'),
                                        stealthSelfBuff('ally-stealth'),
                                    ],
                                },
                            ],
                        }),
                    ],
                })
            );
            const byActor = abilityPerformedByActor({ events });
            expect(byActor.get('ally')?.[0]).toBe(ATTACK * 1.4);
        });

        it('the SAME ally does NOT receive the bonus when it is NOT Stealthed', () => {
            idc = 0;
            const ATTACK = 10_000;
            const { events } = collect(
                baseEngineInput({
                    teamActors: [
                        auraSourceTeamActor('source', panguanAura()),
                        teamAlly('ally', ATTACK, {
                            slots: [{ slot: 'active', abilities: [basicDamage(100, 'ally-dmg')] }],
                        }),
                    ],
                })
            );
            const byActor = abilityPerformedByActor({ events });
            expect(byActor.get('ally')?.[0]).toBe(ATTACK);
        });

        it('a Stealthed Panguan gets its OWN aura exactly once (source-exclusion, no double-count)', () => {
            idc = 0;
            const ATTACK = 10_000;
            const { events } = collect(
                baseEngineInput({
                    attack: ATTACK,
                    shipSkills: {
                        slots: [
                            {
                                slot: 'active',
                                abilities: [
                                    basicDamage(100, 'panguan-dmg'),
                                    stealthSelfBuff('panguan-stealth'),
                                ],
                            },
                            { slot: 'passive', abilities: [panguanAura()] },
                        ],
                    },
                })
            );
            const byActor = abilityPerformedByActor({ events });
            // Exactly +40% (NOT +80% from a double-counted self + distributed fold).
            expect(byActor.get('attacker')?.[0]).toBe(ATTACK * 1.4);
        });

        it('TEAM-SYMMETRY: the SAME aura source on the ENEMY side buffs its enemy ally identically', () => {
            idc = 0;
            const ATTACK = 10_000;
            const sourceEnemy: EnemyAttacker = {
                id: 'e-source',
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defence: 0,
                    hp: 1_000_000_000,
                    speed: 100,
                },
                chargeCount: 0,
                startCharged: false,
                shipSkills: passiveOnly(panguanAura()),
            } as EnemyAttacker;
            const allyEnemy: EnemyAttacker = {
                id: 'e-ally',
                stats: {
                    attack: ATTACK,
                    crit: 0,
                    critDamage: 0,
                    defence: 0,
                    hp: 1_000_000_000,
                    speed: 100,
                },
                chargeCount: 0,
                startCharged: false,
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                basicDamage(100, 'e-ally-dmg'),
                                stealthSelfBuff('e-ally-stealth'),
                            ],
                        },
                    ],
                },
            } as EnemyAttacker;
            const { events } = collect(
                baseEngineInput({
                    hp: 1_000_000_000, // huge focus HP so the enemy's hits never destroy it
                    enemyAttackers: [sourceEnemy, allyEnemy],
                })
            );
            const byActor = abilityPerformedByActor({ events });
            expect(byActor.get('e-ally')?.[0]).toBe(ATTACK * 1.4);
        });
    });

    describe('Lodolite-shape (enemy-debuff Concentrate Fire gate, composes with I1/I2)', () => {
        // A single positioned, passive (attack:0) enemy target — security:0 so the CF inflict
        // always lands (mirrors enemyDebuffNameSpecificGate.integration.test.ts).
        const passiveEnemyAt = (position: Position): EnemyAttacker =>
            ({
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
                shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
            }) as EnemyAttacker;

        it('an ally that is NOT the aura source gets the bonus against a Concentrate-Fire enemy (I1 name-specific gate, per-turn)', () => {
            idc = 0;
            const ATTACK = 10_000;
            const result = runCombat(
                baseEngineInput({
                    numRounds: 2,
                    hacking: 200, // vs enemy security 0 → inflict always lands
                    position: 'M4',
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    attack: ATTACK,
                    shipSkills: {
                        slots: [
                            {
                                slot: 'active',
                                abilities: [
                                    basicDamage(180, 'ally-dmg'),
                                    cfDebuffInflict('ally-cf'),
                                ],
                            },
                        ],
                    },
                    teamActors: [auraSourceTeamActor('source', lodoliteAura())],
                    enemyAttackers: [passiveEnemyAt('M4')],
                })
            );
            // Round 1: nothing pre-exists on the target before this turn → gate false → base damage.
            expect(result.rounds[0].perTargetDamage?.['enemy-front']).toBe(18_000); // 10000 * 1.80
            // Round 2: round 1's own CF infliction is now pre-existing → the DISTRIBUTED aura
            // gates true → +15% on top of the base 180% multiplier.
            expect(result.rounds[1].perTargetDamage?.['enemy-front']).toBe(20_700); // 18000 * 1.15
        });

        it('the SAME ally does NOT get the bonus against a CLEAN enemy (never inflicts Concentrate Fire)', () => {
            idc = 0;
            const ATTACK = 10_000;
            const result = runCombat(
                baseEngineInput({
                    numRounds: 2,
                    hacking: 200,
                    position: 'M4',
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    attack: ATTACK,
                    shipSkills: {
                        slots: [{ slot: 'active', abilities: [basicDamage(180, 'ally-dmg')] }],
                    },
                    teamActors: [auraSourceTeamActor('source', lodoliteAura())],
                    enemyAttackers: [passiveEnemyAt('M4')],
                })
            );
            expect(result.rounds[0].perTargetDamage?.['enemy-front']).toBe(18_000);
            expect(result.rounds[1].perTargetDamage?.['enemy-front']).toBe(18_000);
        });
    });
});
