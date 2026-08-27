import { describe, it, expect } from 'vitest';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedBuffEffects } from '../../../types/calculator';
import {
    simulateDefenseSurvivability,
    DefenseSimulationInput,
    DefenderStats,
} from '../defenseSurvivabilitySim';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// #390 — THE ENEMY-SIDE AURA CHANNEL IS DEAD, AND THIS FILE IS WHY THAT IS WRITTEN DOWN
//
// WHAT #390 REPORTED. A 12-shape sweep in #388 reported "no movement" for a defender-applied
// enemy debuff across two slots, three target scopes, two debuff types and two triggers. Every
// reading in it was of a debuff that had never landed, because every shape carried
// `duration: 'recurring'`. The conclusion happened to survive re-measurement on a landing-proven
// shape, so nothing shipped wrong — but the instrument was broken and the agreement was luck.
// The issue asked for two things: the blast radius across the corpus, and the ROOT CAUSE.
//
// THE ROOT CAUSE (measured, not inferred — see the three arms below). It is a store-KEY mismatch,
// not a missing feature. An enemy-side buff/debuff whose `duration` is `'recurring'` or absent is
// classified `kind: 'aura'` (engine.ts's `registerActorAbilityStatuses`, the `isAura` branch) and
// handed to `statusEngine.registerAbilityStatuses(statuses, ownerId)` — with the THIRD argument,
// `enemyTargetId`, never supplied. It therefore defaults to `DEFAULT_ENEMY_TARGET` ('__enemy__')
// and the aura lands in `auraEnemyMaps.get('__enemy__')`.
//
// The fold reads a DIFFERENT key. `playerTurn.ts` calls
// `activeAbilityStatuses('enemy', resolveCtx(...), actor.id, targetId)` where `targetId` is the
// resolved victim's REAL id ('e1' here) — so it reads `auraEnemyMaps.get('e1')`, which is empty.
// And the loop that would fold it is fenced on `hasVictim`, so the one case where `targetId` is
// undefined (and the read would fall back to '__enemy__') is the case that never runs. Both
// branches miss: the channel is dead unconditionally, not dead in a corner.
//
// WHY THE TIMED SIBLING WORKS. `applyTimedAbilityStatus(r, status, actor.id, vid)` DOES thread the
// real victim id, so a numeric duration registers and reads under the same key. That asymmetry is
// the whole defect, and arm 1 vs arm 2 below is exactly it: same debuff, same magnitude, same
// window, one field changed.
//
// BLAST RADIUS, MEASURED TWICE (2026-08-27, post-#407).
//   • REAL SHIP KITS: zero. A sweep of every `docs/ship-skills.csv` row through
//     `buildShipAbilities` — every slot, every target — finds exactly two enemy-side
//     recurring statuses, both Amartya's `Exposed` (passives 2 and 3). Both carry the REACTIVE
//     trigger `on-enemy-taunt-gained`, and `partitionReactiveAbilities` strips reactive abilities
//     out of `castSkills` BEFORE the `isAura` classification runs — so neither one ever reaches
//     this channel. Nothing a player can field is affected today.
//   • TEST FIXTURES: exactly one is vacuous through this route — `triggers.test.ts`'s
//     "scenario 3: recurring (aura) enemy debuff never feeds the on-debuff-inflicted trigger".
//     Its comment now says so. Every other enemy-side `duration: 'recurring'` occurrence in the
//     repo is either self-side (the nearest enclosing `target:` is `self`), a parser/type-shape
//     assertion that never starts the engine, or a `toThrow` that never reaches a store.
//
// WHY CHARACTERIZE RATHER THAN FIX. The fix is one argument wide, and it is a BEHAVIOUR change to
// the combat engine with no corpus instance to validate it against — there is no in-game example
// to check the result of, which is the bar engine changes are held to here. So this file pins the
// current answer instead of guessing at a new one. THESE ASSERTIONS ARE NOT A SPEC: arms 2 and 3
// describe a defect. When the registration is fixed they SHOULD go red — that is the point. The
// fixture in `triggers.test.ts` named above becomes meaningful on the same day, and both should be
// updated together.
// ══════════════════════════════════════════════════════════════════════════════════════════════

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `d${++idCounter}`,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});
const skills = (abilities: Ability[]): ShipSkills => ({ slots: [{ slot: 'active', abilities }] });

// Attack 0 so the defender cannot kill the attacker and shorten its own window; hacking 200
// against the attacker's absent security so the landing roll is never what this file measures
// (the `hacking: 0` landing-chance-zero trap noted in rawIntakeAxis.test.ts).
const DEFENDER: DefenderStats = {
    hp: 100_000,
    defence: 0,
    security: 70,
    attack: 0,
    crit: 0,
    critDamage: 0,
    speed: 100,
    hacking: 200,
    healModifier: 0,
};

const BASE = (o: Partial<DefenseSimulationInput> = {}): DefenseSimulationInput => ({
    defender: DEFENDER,
    shipSkills: { slots: [] },
    selfBuffs: [],
    chargeCount: 0,
    startCharged: false,
    enemies: [],
    rounds: 5,
    ...o,
});

/**
 * One unkillable 10,000/round attacker over a 4-round window, and a defender whose only action is
 * to apply `Suppression` (−50% outgoing damage) to it. `duration` is the ONLY thing that varies.
 *
 * The debuff halves what the attacker THROWS, so it is read off `breakdown.gross` — an outgoing
 * channel is used rather than a defensive one precisely because the defender's own defence is 0
 * here, so nothing else in the fixture can move the figure.
 */
const suppress = (duration: number | 'recurring' | undefined) => {
    idCounter = 0;
    const effects: ParsedBuffEffects = { outgoingDamage: -50 };
    return simulateDefenseSurvivability(
        BASE({
            rounds: 4,
            enemies: [
                {
                    id: 'e1',
                    stats: {
                        attack: 10_000,
                        crit: 0,
                        critDamage: 0,
                        speed: 50,
                        hp: 100_000_000,
                        defence: 0,
                    },
                    chargeCount: 0,
                    startCharged: false,
                },
            ],
            shipSkills: skills([
                ab({
                    type: 'debuff',
                    target: 'all-enemies',
                    config: {
                        type: 'debuff',
                        buffName: 'Suppression',
                        parsedEffects: effects,
                        stacks: 1,
                        isStackable: false,
                        application: 'apply',
                        // `duration` is deliberately omitted (not set to undefined) on the
                        // durationless arm: `isAura` tests `cfg.duration === undefined`, which an
                        // explicit `undefined` also satisfies, but omitting it is the shape a
                        // parser that found no turn count actually produces.
                        ...(duration !== undefined ? { duration } : {}),
                    },
                }),
            ]),
        })
    ).breakdown.gross;
};

/** No debuff at all — the reference the two dead arms must be indistinguishable from. */
const NO_DEBUFF = 40_000; // 4 rounds x 10,000 thrown, defence 0

describe('#390 enemy-side aura debuff channel (characterization — arms 2/3 pin a DEFECT)', () => {
    // ── ARM 1: THE INSTRUMENT CAN REPORT THE OPPOSITE ────────────────────────────────────────
    // Without this arm the two flat readings below would hold just as well on an engine that
    // folded no enemy-applied outgoing modifier at all, and this whole file would be measuring
    // nothing. Same debuff, same magnitude, same window as arms 2 and 3.
    it('LANDING PROOF: a NUMERIC duration lands — the same debuff halves what the enemy throws', () => {
        expect(suppress(99)).toBe(20_000);
        expect(suppress(99)).toBeLessThan(NO_DEBUFF);
    });

    // ── ARM 2: THE DEFECT ────────────────────────────────────────────────────────────────────
    it("DEFECT: duration 'recurring' is INERT — indistinguishable from applying no debuff", () => {
        expect(suppress('recurring')).toBe(NO_DEBUFF);
    });

    // ── ARM 3: THE SAME DEFECT BY THE OTHER DOOR ─────────────────────────────────────────────
    // A durationless config reaches `isAura` through the `cfg.duration === undefined` disjunct
    // rather than the `'recurring'` one. Pinned separately so a fix that repairs only one of the
    // two entrances is visible as a half-fix rather than passing as a whole one.
    it('DEFECT: an ABSENT duration is inert by the same route', () => {
        expect(suppress(undefined)).toBe(NO_DEBUFF);
    });

    // ── THE DISCRIMINATOR, STATED AS AN ASSERTION ────────────────────────────────────────────
    // The single line #390 asked for: the fixture's `duration` decides whether the fixture
    // measures anything. Anyone writing a new enemy-debuff fixture should read this arm.
    it('the vacuity rule: only the numeric-duration fixture is a live instrument', () => {
        expect(suppress(99)).not.toBe(suppress('recurring'));
        expect(suppress('recurring')).toBe(suppress(undefined));
    });
});
