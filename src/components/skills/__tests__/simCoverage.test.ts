import { describe, it, expect } from 'vitest';
import {
    isAbilityNotSimulated,
    isVictimlessInfliction,
    SIMULATED_CONTROL_EFFECTS,
    NOT_SIMULATED_TYPES,
} from '../simCoverage';
import { Ability, AbilityTrigger, ControlEffect } from '../../../types/abilities';

const ALL_CONTROL_EFFECTS: readonly ControlEffect[] = [
    'stasis',
    'provoke',
    'taunt',
    'concentrate-fire',
    'disable',
];

describe('isAbilityNotSimulated', () => {
    it('treats every control effect as simulated (last unmodeled effect closed)', () => {
        for (const effect of ALL_CONTROL_EFFECTS) {
            expect(
                isAbilityNotSimulated({
                    type: 'control',
                    config: { type: 'control', effect },
                } as Ability)
            ).toBe(false);
        }
    });

    it('leaves non-control types simulated as before', () => {
        expect(isAbilityNotSimulated({ type: 'damage' } as Ability)).toBe(false);
    });

    it('has no not-simulated ability types left', () => {
        expect(NOT_SIMULATED_TYPES.size).toBe(0);
    });
});

describe('SIMULATED_CONTROL_EFFECTS', () => {
    it('contains every control effect', () => {
        for (const effect of ALL_CONTROL_EFFECTS) {
            expect(SIMULATED_CONTROL_EFFECTS.has(effect)).toBe(true);
        }
        expect(SIMULATED_CONTROL_EFFECTS.size).toBe(ALL_CONTROL_EFFECTS.length);
    });
});

/**
 * SP-4c-2d: the engine now DROPS a reactive `dot`/`debuff` whose trigger names no enemy — before
 * this branch it landed on a vestigial hidden actor and did nothing useful either way. The editor
 * cannot stop the shape being authored (there is no target that would work, so blocking would leave
 * the user nowhere to go), so it warns instead.
 *
 * ⚠️ Every expectation below is MEASURED against the executor, not read off the ability model. The
 * measurement (one reactive passive on `start-of-round`, sweeping every enemy-side target, counting
 * `dot-applied` / `debuff-applied`) found that `ability.target` is almost irrelevant here:
 *
 *   dot    + start-of-round → 0 applications for EVERY target, including `all-enemies`,
 *                             `adjacent-enemies` and `enemy-highest-attack`. The branch consults
 *                             `target` only for an `all-enemies` fan-out gated on the triggering
 *                             event's cleansed-enemy ids, which a victimless trigger never carries.
 *   debuff + start-of-round → 0 applications for every target EXCEPT `enemy-highest-attack`, which
 *                             resolves its own victim through the highest-attack selector.
 *
 * That single exception is Selenite's real R2/R4 passive, so it gets its own case below.
 */
describe('isVictimlessInfliction', () => {
    const VICTIMLESS_TRIGGERS: AbilityTrigger[] = [
        'start-of-round',
        'end-of-round',
        'start-of-turn',
        'end-of-turn',
    ];

    it('flags a start-of-round dot aimed at a bare `enemy`', () => {
        expect(
            isVictimlessInfliction({
                type: 'dot',
                trigger: 'start-of-round',
                target: 'enemy',
            } as Ability)
        ).toBe(true);
    });

    it('flags all four victimless triggers, for both infliction types', () => {
        for (const trigger of VICTIMLESS_TRIGGERS) {
            for (const type of ['dot', 'debuff'] as const) {
                expect(isVictimlessInfliction({ type, trigger, target: 'enemy' } as Ability)).toBe(
                    true
                );
            }
        }
    });

    it('STILL flags the fan-out targets, which do not rescue the shape', () => {
        // The shipped spec assumed `all-enemies` / `adjacent-enemies` resolved a victim on their
        // own and cleared the warning. Measured: both apply nothing on a victimless trigger, for
        // both types. A predicate that cleared them would tell the user to pick a target that is
        // just as broken as the one they have.
        for (const target of [
            'all-enemies',
            'adjacent-enemies',
            'target-and-adjacent-enemies',
        ] as const) {
            expect(
                isVictimlessInfliction({
                    type: 'dot',
                    trigger: 'start-of-round',
                    target,
                } as Ability)
            ).toBe(true);
            expect(
                isVictimlessInfliction({
                    type: 'debuff',
                    trigger: 'start-of-round',
                    target,
                } as Ability)
            ).toBe(true);
        }
    });

    it("clears Selenite's shape — a debuff on the highest-attack enemy resolves its own target", () => {
        // SHIPPED SHIP, not a hypothetical: Selenite's R2/R4 passive is exactly
        // `debuff` + `start-of-round` + `enemy-highest-attack` ("at the start of the round, the
        // highest attack enemy is applied with Concentrate Fire"), confirmed by running
        // buildShipAbilities over the whole 148-ship corpus — it is the ONLY corpus ability of
        // this shape. The highest-attack selector picks the enemy itself, so nothing is dropped
        // and a warning here would be a false alarm on a real ship's kit.
        expect(
            isVictimlessInfliction({
                type: 'debuff',
                trigger: 'start-of-round',
                target: 'enemy-highest-attack',
            } as Ability)
        ).toBe(false);
    });

    it('keeps the highest-attack carve-out DEBUFF-ONLY — the dot branch has no such selector', () => {
        // Measured asymmetry: the dot executor never consults the highest-attack selector, so the
        // same target does NOT rescue a dot. Pinning it stops the carve-out being widened to
        // "any highest-attack ability" on the assumption that the two branches match.
        expect(
            isVictimlessInfliction({
                type: 'dot',
                trigger: 'start-of-round',
                target: 'enemy-highest-attack',
            } as Ability)
        ).toBe(true);
    });

    it('clears a bare `enemy` when the trigger names the enemy itself', () => {
        expect(
            isVictimlessInfliction({
                type: 'debuff',
                trigger: 'on-attacked',
                target: 'enemy',
            } as Ability)
        ).toBe(false);
    });

    it('clears `on-deal-damage`, which DOES name the enemy that was hit', () => {
        // Deliberate: on-deal-damage looks victimless (it is not one of the "on that enemy"
        // counter triggers) but its listener stamps the enemy the owner just hit, so a dot on it
        // lands. Flagging it would block a legitimate, shipped combination.
        expect(
            isVictimlessInfliction({
                type: 'dot',
                trigger: 'on-deal-damage',
                target: 'enemy',
            } as Ability)
        ).toBe(false);
    });

    it('ignores types that carry no infliction — a damage ability picks its own enemy', () => {
        // Measured: the reactive damage executor falls back to the first living opposing actor, so
        // a start-of-round damage proc aimed at `enemy` fires normally (Judge / Incinerator).
        for (const type of ['damage', 'heal', 'buff', 'charge', 'shield'] as const) {
            expect(
                isVictimlessInfliction({
                    type,
                    trigger: 'start-of-round',
                    target: 'enemy',
                } as Ability)
            ).toBe(false);
        }
    });
});
