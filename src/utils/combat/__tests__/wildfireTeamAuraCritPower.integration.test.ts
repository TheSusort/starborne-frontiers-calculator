/**
 * Sub-project I, PR I4c — Wildfire's refit-3 TEAM aura ("When an enemy has Scorching
 * Radiation, all allies deal 2% additional Inferno damage to that Unit for every 10% crit
 * power THIS UNIT has"), combat-engine integration.
 *
 * I4a/I4b (wildfireDotDamageCritPower.integration.test.ts) shipped the single-actor shape:
 * a `dotDamage`-channel modifier, gated per-victim/per-tick on the named enemy debuff
 * (Scorching Radiation) and scaled by the CASTER's own live crit power. That shape's ability
 * is parsed with `target: 'self'` for the base passives and `target: 'all-allies'` for the
 * refit-3 text (buildShipAbilities.ts's shared `dotCritPowerM` branch) — I3 (team-aura
 * distribution) ALREADY threads an `all-allies` `modifier` ability into every living same-side
 * ally's `modifierAbilities`, evaluated against the RECIPIENT's own ConditionContext. That is
 * correct for every OTHER all-allies aura (Lodolite/Panguan — the gate reads the recipient's
 * own status), but WRONG for Wildfire's refit-3 text: the LOCKED game rule (user-confirmed
 * 2026-07-03) is that "for every 10% crit power" scales by WILDFIRE's (the aura SOURCE's) own
 * crit power, never the dealing ally's.
 *
 * This suite locks the I4c fix: `engine.ts`'s `buildTurnArgs` now ALSO threads a per-source
 * breakdown (`allyDotDamageAuraSources`) carrying each ally aura source's OWN live crit power;
 * `runPlayerTurn` (playerTurn.ts) builds a `victimGatedDotDamage` LIST (one entry per source)
 * instead of a single ctx, so `victimDotMult` (engine.ts) folds each distributed aura against a
 * ctx whose `selfCritPower` is the SOURCE's, not the recipient/dealing-ally's.
 *
 * Since the flat `RoundData.infernoDamage` field is FOCUS-actor-only, a team ally's own Inferno
 * tick is measured via the `dot-ticked` bus event (which reports the per-round, per-dotType
 * SUMMED tick damage across every applier on the shared dummy enemy) — isolating it by ensuring
 * ONLY the measured applier ever applies an Inferno DoT in a given fixture.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatStatBlock } from '../../../types/calculator';
import type { CombatEvent } from '../events';
import { createEventBus } from '../events';

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `wtac${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const basicDamage = (multiplier: number, id?: string): Ability =>
    ab({ id, type: 'damage', config: { type: 'damage', multiplier } });

const scorchingRadiationInflict = (id: string): Ability =>
    ab({
        id,
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
    });

const infernoDot = (id: string): Ability =>
    ab({
        id,
        type: 'dot',
        config: { type: 'dot', dotType: 'inferno', tier: 10, stacks: 1, duration: 5 },
    });

// Wildfire's refit-3 team aura: all-allies dotDamage, gated on the named enemy debuff
// (Scorching Radiation) + scaled by the SOURCE's own live crit power. "2% additional … for
// every 10% crit power" → perUnit 0.2 (distinguishes it from the base passives' 0.1/0.2
// self-only shapes already locked by I4a/I4b).
const wildfireTeamAura = (): Ability =>
    ab({
        id: 'wildfire-team-aura',
        target: 'all-allies',
        type: 'modifier',
        conditions: [
            { subject: 'enemy-debuff', derivable: true, buffName: 'Scorching Radiation' },
            { subject: 'self-crit-power', derivable: true },
        ],
        scaling: { conditionIndex: 1, perUnit: 0.2 },
        config: { type: 'modifier', channel: 'dotDamage', value: 0, isMultiplicative: false },
    });

const passiveOnly = (...abilities: Ability[]): ShipSkills => ({
    slots: [{ slot: 'passive', abilities }],
});

// hacking 200 vs the dummy enemy's default security (100, unset) → any DoT/debuff-application
// landing gate this actor rolls (e.g. the ally's own Inferno DoT application) always lands —
// isolates the fixture from an UNRELATED landing-chance failure mode (0 hacking → 0% landing,
// the tick would never occur at all and every assertion below would read 0 either way).
const teamStats = (attack: number, critDamage: number): CombatStatBlock => ({
    attack,
    crit: 0,
    critDamage,
    defensePenetration: 0,
    defence: 0,
    hp: 1_000_000_000,
    hacking: 200,
});

// A walked team actor. speed 100 so it acts every round like the focus. `positional`, when
// supplied, targets the SAME resolved victim as the focus (position 'M4' / pattern base /
// target 'front') — REQUIRED for the engine's I1 name-specific `enemy-debuff` gate to
// populate (`enemyDebuffNames` is only threaded for a REAL resolved target, never the DPS
// dummy `enemy` sink — see engine.ts's `buildTurnArgs` guard `tgt.id !== enemy.id`).
const teamActor = (
    id: string,
    attack: number,
    critDamage: number,
    skills: ShipSkills,
    positional = false
): TeamActorEngineInput =>
    ({
        id,
        speed: 100,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        ...(positional
            ? { position: 'M4' as Position, target: parsedTarget('front'), pattern: basePattern() }
            : {}),
        walk: {
            shipSkills: skills,
            stats: teamStats(attack, critDamage),
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
            healModifier: 0,
        },
    }) as TeamActorEngineInput;

// The Wildfire aura-source team actor: passive-only (never itself fires a damage ability), so
// it never contributes an Inferno tick of its own — isolating the DISTRIBUTED bonus on the
// OTHER team ally being measured. `critPower` is the aura's scaling source. Never positional —
// it never fires a damage ability, so it has no resolved target of its own to gate on.
const wildfireAuraSource = (
    id: string,
    critPower: number,
    includeAura: boolean
): TeamActorEngineInput =>
    teamActor(id, 0, critPower, passiveOnly(...(includeAura ? [wildfireTeamAura()] : [])));

// A single positioned, passive (attack:0) enemy — security:0 so a Scorching Radiation inflict
// targeting it always lands (mirrors wildfireDotDamageCritPower.integration.test.ts).
type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
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
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
    }) as EnemyAttacker;

const baseEngineInput = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
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
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000_000,
    // hacking 200 vs the dummy enemy's default security (100) → inflict landing chance
    // clamp((200-100)/100) = 1.0 — the focus's Scorching Radiation inflict always lands.
    hacking: 200,
    healTargetId: 'attacker',
    ...overrides,
});

// Per-ROUND summed Inferno tick damage (`dot-ticked` events), across every applier of the
// fixture. Fixtures below are constructed so only ONE applier ever carries an Inferno DoT,
// isolating that applier's tick cleanly (mirrors the "identical DoT dynamics, compare deltas"
// strategy from wildfireDotDamageCritPower.integration.test.ts).
const infernoTicksByRound = (input: CombatEngineInput): number[] => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('dot-ticked', (e) => events.push(e as CombatEvent));
    const result = runCombat({ ...input, bus });
    const byRound: number[] = new Array(result.rounds.length).fill(0);
    for (const e of events) {
        if (e.type === 'dot-ticked' && e.dotType === 'inferno') {
            byRound[e.round - 1] += e.damage;
        }
    }
    return byRound;
};

describe('Wildfire refit-3 team-wide Inferno aura, scaled by the SOURCE crit power (sub-project I, PR I4c)', () => {
    it("an ally (LOW crit power) applying Inferno to a Scorching-Radiation victim is boosted by WILDFIRE's (the source's) crit power, not its own", () => {
        idc = 0;
        const ALLY_ATTACK = 10_000;
        const WILDFIRE_CRIT_POWER = 200; // → +40% (200 * perUnit 0.2)
        const ALLY_CRIT_POWER = 0; // if the bug regresses, the bonus would read 0 → ratio 1.0

        const focus: ShipSkills = {
            slots: [{ slot: 'active', abilities: [scorchingRadiationInflict('focus-sr')] }],
        };
        const ally: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [basicDamage(100, 'ally-dmg'), infernoDot('ally-dot')],
                },
            ],
        };
        const positional = {
            position: 'M4' as Position,
            target: parsedTarget('front'),
            pattern: basePattern(),
            enemyAttackers: [passiveEnemyAt('M4')],
        };

        const withMod = infernoTicksByRound(
            baseEngineInput({
                ...positional,
                shipSkills: focus,
                teamActors: [
                    teamActor('ally', ALLY_ATTACK, ALLY_CRIT_POWER, ally, true),
                    wildfireAuraSource('wildfire', WILDFIRE_CRIT_POWER, true),
                ],
            })
        );
        const control = infernoTicksByRound(
            baseEngineInput({
                ...positional,
                shipSkills: focus,
                teamActors: [
                    teamActor('ally', ALLY_ATTACK, ALLY_CRIT_POWER, ally, true),
                    wildfireAuraSource('wildfire', WILDFIRE_CRIT_POWER, false),
                ],
            })
        );

        // Round 1: the focus's own Scorching-Radiation infliction (this same round) is already
        // live by the time the shared dummy enemy ticks (I4b's per-tick live-status rule; the
        // focus/ally act before the enemy's tick at default speeds) → boosted from round 1.
        expect(control[0]).toBeGreaterThan(0);
        expect(withMod[0]).toBeCloseTo(control[0] * 1.4, 0);
        // Round 2: Scorching Radiation still present (duration 5, refreshed) → same +40%.
        expect(control[1]).toBeGreaterThan(0);
        expect(withMod[1]).toBeCloseTo(control[1] * 1.4, 0);
    });

    it('the SAME ally/aura pairing gets NO boost against a victim that never carries Scorching Radiation', () => {
        idc = 0;
        const ALLY_ATTACK = 10_000;
        const WILDFIRE_CRIT_POWER = 200;

        // The focus never inflicts Scorching Radiation at all.
        const focus: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };
        const ally: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [basicDamage(100, 'ally-dmg2'), infernoDot('ally-dot2')],
                },
            ],
        };
        const positional = {
            position: 'M4' as Position,
            target: parsedTarget('front'),
            pattern: basePattern(),
            enemyAttackers: [passiveEnemyAt('M4')],
        };

        const withMod = infernoTicksByRound(
            baseEngineInput({
                ...positional,
                numRounds: 3,
                shipSkills: focus,
                teamActors: [
                    teamActor('ally', ALLY_ATTACK, 0, ally, true),
                    wildfireAuraSource('wildfire', WILDFIRE_CRIT_POWER, true),
                ],
            })
        );
        const control = infernoTicksByRound(
            baseEngineInput({
                ...positional,
                numRounds: 3,
                shipSkills: focus,
                teamActors: [
                    teamActor('ally', ALLY_ATTACK, 0, ally, true),
                    wildfireAuraSource('wildfire', WILDFIRE_CRIT_POWER, false),
                ],
            })
        );

        for (let r = 0; r < 3; r++) {
            expect(withMod[r]).toBe(control[r]);
        }
    });

    it("Wildfire's OWN Inferno tick (single actor, target:'all-allies') is boosted EXACTLY once by its own crit power — no double-apply", () => {
        idc = 0;
        const CRIT_POWER = 150; // → +30% (150 * perUnit 0.2). A double-apply bug would read +60%.

        const withAura: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        basicDamage(100, 'wf-dmg'),
                        scorchingRadiationInflict('wf-sr'),
                        infernoDot('wf-dot'),
                    ],
                },
                { slot: 'passive', abilities: [wildfireTeamAura()] },
            ],
        };
        const withoutAura: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        basicDamage(100, 'wf-dmg'),
                        scorchingRadiationInflict('wf-sr'),
                        infernoDot('wf-dot'),
                    ],
                },
                { slot: 'passive', abilities: [] },
            ],
        };

        const withModResult = runCombat(
            baseEngineInput({ attack: 10_000, shipSkills: withAura, critDamage: CRIT_POWER })
        );
        const controlResult = runCombat(
            baseEngineInput({ attack: 10_000, shipSkills: withoutAura, critDamage: CRIT_POWER })
        );

        // Round 2: Scorching Radiation (inflicted every round) is guaranteed pre-existing.
        expect(controlResult.rounds[1].infernoDamage).toBeGreaterThan(0);
        expect(withModResult.rounds[1].infernoDamage).toBeCloseTo(
            controlResult.rounds[1].infernoDamage * 1.3,
            0
        );
    });

    it('TEAM-SYMMETRY: the SAME aura source on the ENEMY side boosts an enemy ally identically, scaled by the enemy aura SOURCE crit power', () => {
        idc = 0;
        const ALLY_ATTACK = 10_000;
        const WILDFIRE_CRIT_POWER = 200; // → +40%

        // Enemy hacking 300 vs the focus's default security (100, unset) → inflict landing
        // chance clamp((300-100)/100) = 1.0 — always lands.
        const dealerEnemy = (id: string, includeSr: boolean): EnemyAttacker =>
            ({
                id,
                stats: {
                    attack: ALLY_ATTACK,
                    crit: 0,
                    critDamage: 0,
                    defence: 0,
                    hp: 1_000_000_000,
                    speed: 100,
                    hacking: 300,
                },
                chargeCount: 0,
                startCharged: false,
                shipSkills: {
                    slots: [
                        {
                            slot: 'active',
                            abilities: includeSr
                                ? [
                                      basicDamage(100, 'e-ally-dmg'),
                                      scorchingRadiationInflict('e-ally-sr'),
                                      infernoDot('e-ally-dot'),
                                  ]
                                : [basicDamage(100, 'e-ally-dmg'), infernoDot('e-ally-dot')],
                        },
                    ],
                },
            }) as EnemyAttacker;

        const sourceEnemy = (includeAura: boolean): EnemyAttacker =>
            ({
                id: 'e-wildfire',
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: WILDFIRE_CRIT_POWER,
                    defence: 0,
                    hp: 1_000_000_000,
                    speed: 100,
                },
                chargeCount: 0,
                startCharged: false,
                shipSkills: passiveOnly(...(includeAura ? [wildfireTeamAura()] : [])),
            }) as EnemyAttacker;

        const withMod = infernoTicksByRound(
            baseEngineInput({
                numRounds: 3,
                hp: 1_000_000_000, // huge focus HP so the enemy's hits never destroy it
                shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
                enemyAttackers: [sourceEnemy(true), dealerEnemy('e-ally', true)],
            })
        );
        const control = infernoTicksByRound(
            baseEngineInput({
                numRounds: 3,
                hp: 1_000_000_000,
                shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
                enemyAttackers: [sourceEnemy(false), dealerEnemy('e-ally', true)],
            })
        );

        // Unlike the player-side dummy-enemy fixtures above (where the enemy's tick is a
        // round-end aggregate step, so a round-1 application already ticks THAT same round),
        // the FOCUS here is a real positioned actor whose DoT containers tick at ITS OWN
        // turn-start (the per-victim DoT-tick prologue) — at tied default speed 100 the focus's
        // turn-start precedes the enemy's application THIS round, so round 1's application isn't
        // visible until the focus's NEXT turn-start (round 2).
        expect(control[1]).toBeGreaterThan(0);
        expect(withMod[1]).toBeCloseTo(control[1] * 1.4, 0);
        expect(control[2]).toBeGreaterThan(0);
        expect(withMod[2]).toBeCloseTo(control[2] * 1.4, 0);
    });
});
