/**
 * #537 reachability census — can a firing slot deal ZERO direct damage because its damage
 * abilities all gated off?
 *
 * WHY THIS EXISTS. Two engine seams decide "this cast hit" from a PRE-GATE predicate
 * (`damageInputsFromSkill(firingSkill).scalingAbility !== undefined`), evaluated before
 * `gateFiringAbilities` has a round context to gate against:
 *
 *   1. `playerTurn.ts` — the §4.5 non-positional Stasis-break hook (`onHitBreakStasis`).
 *   2. `playerTurn.ts` — `positionalScalars`, which is what makes the engine drive
 *      `drivePositionalTurnApply`, whose `onVictimPreImpact` (engine.ts) marks EVERY stasised
 *      victim — anchor and covered — with no damage check of its own.
 *
 * Both therefore say "hit" for a cast whose damage ability gates OFF, contradicting the locked
 * ruling that ONLY DIRECT DAMAGE reduces Stasis (owner, 2026-09-15). Neither is reachable on the
 * shipped corpus, which is why the pre-gate predicate stands: this file is the measurement that
 * says so, and the alarm that fires the day it stops being true.
 *
 * THE PREDICATE IS THE POINT. A census over `ability.conditions` answers a DIFFERENT question:
 * it counts every conditioned damage ability, and almost all of them are scalers rather than
 * gates. A bare scaling-source condition scales a bonus and never drops the ability — Gallant's
 * "deals 115% Damage, increased to 135% against Defenders" parses as ONE damage ability whose
 * single condition is its scaler. `gateConditions` is what `gateFiringAbilities` actually filters
 * on, so it is what this file imports; a local reimplementation would desync from the real gate,
 * which is the one thing this census exists to catch. Same rule for slot selection — the engine
 * picks its firing skill with `selectFiringSkill`, so this file does too rather than indexing
 * `slots`.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import {
    gateConditions,
    gateFiringAbilities,
    damageInputsFromSkill,
    selectFiringSkill,
} from '../../abilities/applyAbilities';
import { buildRoundContext } from '../../abilities/roundContext';
import type { Ability } from '../../../types/abilities';

const FIRING_ACTIONS = ['active', 'charged'] as const;

const SEAMS =
    'Two seams read the PRE-GATE damage predicate and would both need fixing: the §4.5 ' +
    'Stasis-break hook in playerTurn.ts, AND `positionalScalars` in playerTurn.ts, which is ' +
    "what lets the engine's positional drive mark stasised victims in `onVictimPreImpact`. " +
    'Fixing only the hook leaves every placement-board cast still breaking Stasis.';

function requireReferenceData(): void {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'docs/ship-skills.csv and/or docs/ship-data.json are missing from this worktree ' +
                '(gitignored reference data). This census must read the real corpus — a ' +
                'synthetic fallback would turn a missing-data worktree into a green vacuous run.'
        );
    }
}

/** Every firing slot carrying at least one HARD-GATED damage ability, i.e. one that
 *  `gateFiringAbilities` can drop. A slot absent from this list can never lose its damage. */
function slotsWithHardGatedDamage(): string[] {
    const out: string[] = [];
    for (const record of loadShipSkillRecords()) {
        const ship = buildTraceShip(record.name);
        if (!ship) continue;
        const skills = buildShipAbilities(ship);
        for (const action of FIRING_ACTIONS) {
            const damage = (selectFiringSkill(skills, action)?.abilities ?? []).filter(
                (a: Ability) => a.config.type === 'damage'
            );
            if (damage.some((a) => gateConditions(a).length > 0)) {
                out.push(`${ship.name}:${action}`);
            }
        }
    }
    return out.sort();
}

describe('#537 gated-off damage vs the direct-damage Stasis break', () => {
    beforeAll(requireReferenceData);

    it('only Panon carries a hard-gated damage ability, on both firing slots', () => {
        expect(
            slotsWithHardGatedDamage(),
            `The set of firing slots whose damage can gate off has CHANGED. If it GREW, ` +
                `re-measure whether the new slot can deal zero damage (the next test's method); ` +
                `if it can, #537 is now reachable and the pre-gate predicate must be replaced by ` +
                `a post-gate one. If it SHRANK to empty, no firing slot can lose its damage at ` +
                `all, the pre-gate predicate is trivially safe, and the next test has lost its ` +
                `subject — delete both rather than re-baselining. ${SEAMS}`
        ).toEqual(['Panon:active', 'Panon:charged']);
    });

    it("Panon's two damage abilities are complementary, so a damage ability always fires", () => {
        // Panon: "deals 80% damage … If this Unit is Provoked or Taunted, this Unit instead
        // deals 120%". The parser emits BOTH instances as gated damage abilities — one gated on
        // "no Taunt AND no Provoke", the other on "Taunt OR Provoke" — so the pair is exhaustive
        // and the slot cannot deal zero. Asked through the REAL gate over the full 2x2 state
        // grid, not read off the conditions: De Morgan holds only while both subjects resolve,
        // and an absent subject reads as unmet (the SP-4d rule), which would drop BOTH.
        // `buildRoundContext` defaults `selfDebuffNames` to `[]`, so the omitted-subject arm is
        // the `false/false` row rather than a fifth case.
        const skills = buildShipAbilities(buildTraceShip('Panon')!);
        const survivors: string[] = [];
        for (const action of FIRING_ACTIONS) {
            for (const taunt of [false, true]) {
                for (const provoke of [false, true]) {
                    const ctx = buildRoundContext({
                        selfBuffNames: taunt ? ['Taunt'] : [],
                        selfDebuffNames: provoke ? ['Provoke'] : [],
                        landedEnemyDebuffCount: 0,
                        corrosionEntryCount: 0,
                        infernoEntryCount: 0,
                        bombCount: 0,
                        effectiveCritRate: 0,
                    });
                    const { gatedSkill } = gateFiringAbilities(
                        selectFiringSkill(skills, action),
                        ctx
                    );
                    const { scalingAbility } = damageInputsFromSkill(gatedSkill);
                    survivors.push(
                        `${action} taunt=${taunt} provoke=${provoke}: ${
                            scalingAbility ? 'damage' : 'NONE'
                        }`
                    );
                }
            }
        }

        expect(
            survivors.filter((s) => s.endsWith('NONE')),
            `Panon can now cast with every damage ability gated off, which makes #537 reachable: ` +
                `the cast deals nothing and still reduces the target's Stasis. ${SEAMS}`
        ).toEqual([]);
    });
});
