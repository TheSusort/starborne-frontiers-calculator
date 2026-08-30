/**
 * Live adjacency / kill-count scaling subjects — combat-engine integration.
 *
 * `buildRoundContext` used to return `adjacentAllyCount: 0`, `enemyAdjacentCount: 0` and
 * `enemyDestroyedCount: 0` as LITERALS: `BuildRoundContextState` had no matching field, so no
 * caller could ever override them. Every corpus reader of those three subjects therefore scaled
 * by a permanent zero:
 *
 *   - Panguan  active/charged — "increasing by 30%/40% for each Unit adjacent to the enemy"
 *   - Centurion active/charged — "with an additional 20%/30% for each adjacent ally"
 *   - Judge    R2 — "20% more direct damage for each destroyed enemy, up to max of 100%"
 *
 * Judge's is the starkest: the parser emits `value: 0` with the WHOLE bonus in `scaling`, so his
 * damage ramp was exactly 0% at every kill count, not merely capped low.
 *
 * The data was always there — `preCombatPassives.ts` already resolves Centurion's "500 attack per
 * adjacent ally" via `adjacentPlans.length`, and `buildTurnArgs` already threads `adjacentAllyIds`
 * / `adjacentEnemyIdsFor` into `runPlayerTurn` for the buff-steal and splash-DoT fan-outs. Only
 * the round context failed to ask for it.
 *
 * OWNER RULINGS (2026-08-30) locked here:
 *   - Panguan counts LIVING enemies board-adjacent to the TARGET (target itself excluded); a
 *     destroyed neighbour adds nothing. `adjacency.ts` filters on `destroyedRound === undefined`,
 *     so the living half is proven by adjacency.test.ts and is not re-proven here.
 *   - Judge counts every enemy destroyed SO FAR THIS BATTLE regardless of who landed the kill,
 *     cumulative across rounds (not per-round), capped by `scaling.cap`.
 *
 * Damage is read off the focus actor's own `ability-performed` event rather than
 * `perTargetDamage` — the same reasoning as stealthedEnemyCountScaling.integration.test.ts, whose
 * fixture shape this file follows: it is target-agnostic, so it cannot be perturbed by which
 * enemy positional targeting happens to select.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatEvent } from '../events';
import { createEventBus } from '../events';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `lcs${++idc}`,
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

/** An inert enemy: no skills, no attack, so it only ever contributes its POSITION (and, in the
 *  kill-count suite, its death). Speed 1 keeps it behind the focus actor in turn order. */
const enemyAt = (id: string, position: Position, hp = 1_000_000_000): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

/** Panguan-shape: base damage whose bonus scales per LIVING enemy adjacent to the target. */
const panguanShape = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'damage',
                    conditions: [{ subject: 'enemy-adjacent', derivable: false }],
                    config: { type: 'damage', multiplier: 100 },
                    scaling: { conditionIndex: 0, perUnit: 30 },
                }),
            ],
        },
    ],
});

/** Centurion-shape: base damage whose bonus scales per LIVING board-adjacent ALLY. */
const centurionShape = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'damage',
                    conditions: [{ subject: 'adjacent-ally', derivable: false }],
                    config: { type: 'damage', multiplier: 100 },
                    scaling: { conditionIndex: 0, perUnit: 20 },
                }),
            ],
        },
    ],
});

/** Judge-shape: a self outgoing-damage modifier carrying the WHOLE bonus in `scaling`
 *  (`value: 0`), capped at 100 — exactly what buildShipAbilities emits for his R2 text. */
const judgeShape = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({ type: 'damage', config: { type: 'damage', multiplier: 100 } }),
                ab({
                    type: 'modifier',
                    target: 'self',
                    conditions: [{ subject: 'enemy-destroyed', derivable: false }],
                    config: {
                        type: 'modifier',
                        channel: 'outgoingDamage',
                        value: 0,
                        isMultiplicative: true,
                    },
                    scaling: { conditionIndex: 0, perUnit: 20, cap: 100 },
                }),
            ],
        },
    ],
});

const engineBase = (
    shipSkills: ShipSkills,
    enemyAttackers: EnemyAttacker[],
    over: Partial<CombatEngineInput> = {}
): CombatEngineInput => ({
    attack: 10_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills,
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
    position: 'M1',
    target: parsedTarget('front'),
    pattern: basePattern(),
    speed: 100, // acts first, before any (speed-1) enemy
    enemyAttackers,
    ...over,
});

/** The focus actor's own emitted damage, per round (index 0 = its round-1 cast). */
const focusDamages = (input: CombatEngineInput): number[] => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('ability-performed', (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    return events
        .filter(
            (e): e is Extract<CombatEvent, { type: 'ability-performed' }> =>
                e.type === 'ability-performed' && e.actorId === 'attacker'
        )
        .map((e) => e.damage ?? 0);
};

const focusDamage = (input: CombatEngineInput): number => focusDamages(input)[0] ?? NaN;

// M4's board neighbours are M3, T3, T4, B3, B4 (see targeting/board.ts's AXIAL table). Only M4
// is placed in column 4 in these fixtures, so 'front' selection resolves it unambiguously and the
// neighbours sit in column 3 where they cannot steal the target slot.
describe('enemy-adjacent scaling (Panguan shape) — engine integration', () => {
    it('target has no living neighbour → base damage', () => {
        idc = 0;
        expect(focusDamage(engineBase(panguanShape(), [enemyAt('front', 'M4')]))).toBe(10_000);
    });

    it('ONE enemy adjacent to the target → +30%', () => {
        idc = 0;
        expect(
            focusDamage(engineBase(panguanShape(), [enemyAt('front', 'M4'), enemyAt('n1', 'M3')]))
        ).toBe(13_000);
    });

    it('TWO enemies adjacent to the target → +60% (a COUNT, not a presence gate)', () => {
        idc = 0;
        expect(
            focusDamage(
                engineBase(panguanShape(), [
                    enemyAt('front', 'M4'),
                    enemyAt('n1', 'M3'),
                    enemyAt('n2', 'T3'),
                ])
            )
        ).toBe(16_000);
    });

    it('a NON-adjacent enemy does not count (proves board adjacency, not a roster headcount)', () => {
        idc = 0;
        // T1 is two hexes from M4 — present on the roster, but not a neighbour.
        expect(
            focusDamage(engineBase(panguanShape(), [enemyAt('front', 'M4'), enemyAt('far', 'T1')]))
        ).toBe(10_000);
    });
});

// The focus attacker sits at M1 (neighbours: T1, M2, B1, B2 — see board.ts). Team actors are
// placed on and off that neighbour set to prove the same adjacency rule on the ally axis.
const TEAM_STATS = {
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    shieldPenetration: 0,
    defence: 0,
    hp: 1_000_000_000,
    speed: 1,
    hacking: 0,
    security: 0,
};

const inertTeamSkills = (): ShipSkills => ({ slots: [{ slot: 'active', abilities: [] }] });

const teamAt = (id: string, position: Position) => ({
    id,
    speed: 1, // acts AFTER the focus, so it cannot perturb the round-1 reading
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    shipSkills: inertTeamSkills(),
    stats: TEAM_STATS,
    position,
    walk: {
        shipSkills: inertTeamSkills(),
        stats: TEAM_STATS,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

describe('adjacent-ally scaling (Centurion shape) — engine integration', () => {
    it('no ally on the board → base damage', () => {
        idc = 0;
        expect(focusDamage(engineBase(centurionShape(), [enemyAt('front', 'M4')]))).toBe(10_000);
    });

    it('ONE board-adjacent ally → +20%', () => {
        idc = 0;
        expect(
            focusDamage(
                engineBase(centurionShape(), [enemyAt('front', 'M4')], {
                    teamActors: [teamAt('ally-1', 'M2')],
                })
            )
        ).toBe(12_000);
    });

    it('TWO board-adjacent allies → +40%', () => {
        idc = 0;
        expect(
            focusDamage(
                engineBase(centurionShape(), [enemyAt('front', 'M4')], {
                    teamActors: [teamAt('ally-1', 'M2'), teamAt('ally-2', 'T1')],
                })
            )
        ).toBe(14_000);
    });

    it('a NON-adjacent ally does not count', () => {
        idc = 0;
        // M4 is on the player half here (own-side coordinates) and is not an M1 neighbour.
        expect(
            focusDamage(
                engineBase(centurionShape(), [enemyAt('front', 'M4')], {
                    teamActors: [teamAt('ally-far', 'M4')],
                })
            )
        ).toBe(10_000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────
// The OTHER arm of the gate. `mode: 'dps'` is the single-ship DPS calculator: no board, and a
// synthetic enemy that exists to be hit rather than to die. A live reading there is a permanent
// structural 0, not an observation, so the engine WITHHOLDS all three counts and the condition
// falls back to the user's own `manualCount` — the number the skill editor's condition row asks
// for. Without these cases the mode gate would be untested in the direction that matters: a
// regression that dropped it would still pass every case above.
// ─────────────────────────────────────────────────────────────────────────────────────────────
const centurionManualShape = (manualCount: number): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'damage',
                    conditions: [{ subject: 'adjacent-ally', derivable: false, manualCount }],
                    config: { type: 'damage', multiplier: 100 },
                    scaling: { conditionIndex: 0, perUnit: 20 },
                }),
            ],
        },
    ],
});

describe('run-mode gate — manual counts survive in single-ship DPS mode', () => {
    const dpsBase = (shipSkills: ShipSkills, over: Partial<CombatEngineInput> = {}) => {
        // `mode: 'dps'` forbids healTargetId (runCombat throws), so it is dropped here rather
        // than overridden.
        const { healTargetId: _drop, ...rest } = engineBase(shipSkills, [enemyAt('front', 'M4')]);
        return { ...rest, mode: 'dps' as const, ...over };
    };

    it("the user's manual count is used, not a fabricated live 0", () => {
        idc = 0;
        // manualCount 3 × 20% = +60%. A live reading would be 0 allies → 10_000.
        expect(focusDamage(dpsBase(centurionManualShape(3)))).toBe(16_000);
    });

    it('the manual count still wins even when a board-adjacent ally IS present', () => {
        idc = 0;
        // One real adjacent ally would read 1 (+20%) if the gate leaked; the manual 3 (+60%)
        // proves the mode gate, not merely an empty roster.
        expect(
            focusDamage(dpsBase(centurionManualShape(3), { teamActors: [teamAt('ally-1', 'M2')] }))
        ).toBe(16_000);
    });

    it('the SAME fixture reads the live count once the run is a real fight', () => {
        idc = 0;
        // Identical skills and board, healing mode: the live 1 adjacent ally (+20%) now wins
        // over the manual 3. This is the instrument check — the two arms differ only by mode.
        expect(
            focusDamage(
                engineBase(centurionManualShape(3), [enemyAt('front', 'M4')], {
                    teamActors: [teamAt('ally-1', 'M2')],
                })
            )
        ).toBe(12_000);
    });
});

describe('enemy-destroyed scaling (Judge shape) — engine integration', () => {
    // A fragile enemy the focus one-shots (10_000 attack × 100% ≫ 1 HP) so kills accumulate
    // across rounds without needing a second damage source.
    it('nothing destroyed yet → the ramp contributes exactly 0%', () => {
        idc = 0;
        expect(focusDamage(engineBase(judgeShape(), [enemyAt('front', 'M4')]))).toBe(10_000);
    });

    it('ramps by +20% per enemy destroyed, cumulative across rounds', () => {
        idc = 0;
        const damages = focusDamages(
            engineBase(judgeShape(), [enemyAt('a', 'M4', 1), enemyAt('b', 'M3', 1)], {
                numRounds: 3,
            })
        );
        // R1: nothing dead yet → 10_000 (and the cast kills 'a').
        // R2: one enemy destroyed → +20% → 12_000 (and the cast kills 'b').
        expect(damages[0]).toBe(10_000);
        expect(damages[1]).toBe(12_000);
    });
});
