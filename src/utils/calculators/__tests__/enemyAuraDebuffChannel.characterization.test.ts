import { describe, it, expect } from 'vitest';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedBuffEffects } from '../../../types/calculator';
import {
    simulateDefenseSurvivability,
    DefenseSimulationInput,
    DefenderStats,
} from '../defenseSurvivabilitySim';

// ══════════════════════════════════════════════════════════════════════════════════════════════
// #390 — THE ENEMY-SIDE AURA CHANNEL: REPAIRED FOR `all-enemies`, STILL DEAD FOR SUBSET SCOPES
//
// WHAT #390 REPORTED. A 12-shape sweep in #388 reported "no movement" for a defender-applied
// enemy debuff across two slots, three target scopes, two debuff types and two triggers. Every
// reading in it was of a debuff that had never landed, because every shape carried
// `duration: 'recurring'`. The conclusion happened to survive re-measurement on a landing-proven
// shape, so nothing shipped wrong — but the instrument was broken and the agreement was luck.
//
// THE ROOT CAUSE. A store-KEY mismatch, not a missing feature. An enemy-side buff/debuff whose
// `duration` is `'recurring'` or absent is classified `kind: 'aura'` (engine.ts's
// `registerActorAbilityStatuses`, the `isAura` branch) and handed to
// `statusEngine.registerAbilityStatuses(statuses, ownerId)` — with the THIRD argument,
// `enemyTargetId`, never supplied. It lands in `auraEnemyMaps.get('__enemy__')`. The fold reads a
// DIFFERENT key: `playerTurn.ts` calls `activeAbilityStatuses('enemy', resolveCtx(...), actor.id,
// targetId)` with the resolved victim's REAL id ('e1' here), which is an empty bucket. The loop is
// fenced on `hasVictim`, so the one case where `targetId` is undefined (and the read WOULD fall
// back to '__enemy__') never runs. Both branches missed. The enemy-side ACCUMULATING store
// (`accumEnemyMaps`) is written by the same call and was dead by the identical route.
//
// WHY THE TIMED SIBLING ALWAYS WORKED. `applyTimedAbilityStatus(r, status, actor.id, vid)` DOES
// thread the real victim id. That asymmetry was the entire defect, and arm 1 vs arm 2 below is
// exactly it: same debuff, same magnitude, same window, one field changed.
//
// THE OWNER RULING THAT MADE IT A BUG (2026-08-29). A debuff whose text states no turn window
// "stays until it is cleansed or removed in another way". That is precisely what the aura model
// is for — so a durationless enemy debuff SHOULD stand for the fight, and a channel that drops it
// is wrong, not merely unmodelled.
//
// WHAT THE REPAIR CAN AND CANNOT DO. The '__enemy__' bucket is written ONCE at actor construction,
// before any cast has resolved, so it cannot know WHICH enemy a clause will land on — there is no
// victim id in scope at that point. For `target: 'all-enemies'` that does not matter: every enemy
// is a recipient, so folding the bucket into every per-victim read is exactly right, and that is
// the repair (`ABILITY_TARGET_ENEMY_SCOPE` stamps `enemyScope: 'all'` on the status at
// registration; `activeAbilityStatuses` folds only those). For every SUBSET scope — single
// `enemy`, the two adjacency scopes, the three selectors — folding the bucket would smear a
// one-victim debuff across the whole opposing board, which is worse than dropping it. Repairing
// those needs registration to move to CAST time, per resolved victim. Arm 4 pins that gap open.
//
// BLAST RADIUS, RE-MEASURED 2026-08-29 (post-#428). Zero live corpus instances, on either store.
// `enemyAuraChannelCorpus.test.ts` is the standing census and the guard: 149 ships x refits 0/2/4,
// every slot, aura AND accumulating. The only enemy-side hits are Amartya's `Exposed` (aura) and
// `Defense Shred` (accumulating), and both carry a REACTIVE trigger — `partitionReactiveAbilities`
// strips reactive abilities out of `castSkills` BEFORE the `isAura` classification runs, so
// neither reaches this channel. Nothing a player can field is affected either way.
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
const suppress = (
    duration: number | 'recurring' | undefined,
    target: 'all-enemies' | 'enemy' = 'all-enemies'
) => {
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
                    target,
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

describe('#390 enemy-side aura debuff channel', () => {
    // ── ARM 1: THE INSTRUMENT CAN REPORT THE OPPOSITE ────────────────────────────────────────
    // Without this arm every reading below would hold just as well on an engine that folded no
    // enemy-applied outgoing modifier at all, and this whole file would be measuring nothing.
    // Same debuff, same magnitude, same window as every other arm.
    it('LANDING PROOF: a NUMERIC duration lands — the same debuff halves what the enemy throws', () => {
        expect(suppress(99)).toBe(20_000);
        expect(suppress(99)).toBeLessThan(NO_DEBUFF);
    });

    // ── ARM 2: THE REPAIR ────────────────────────────────────────────────────────────────────
    // Was `toBe(NO_DEBUFF)` — the defect. An `all-enemies` aura now folds for every victim.
    it("REPAIRED: an all-enemies duration:'recurring' debuff now lands, same as a timed one", () => {
        expect(suppress('recurring')).toBe(20_000);
    });

    // ── ARM 3: THE SAME REPAIR BY THE OTHER DOOR ─────────────────────────────────────────────
    // A durationless config reaches `isAura` through the `cfg.duration === undefined` disjunct
    // rather than the `'recurring'` one. Pinned separately so a change that repairs only one of
    // the two entrances is visible as a half-fix rather than passing as a whole one.
    it('REPAIRED: an ABSENT duration lands by the same route', () => {
        expect(suppress(undefined)).toBe(20_000);
    });

    // ── ARM 4: THE GAP THAT REMAINS, PINNED OPEN ─────────────────────────────────────────────
    // A SUBSET-scoped enemy aura (single `enemy` here; the two adjacency scopes and the three
    // selectors are the same case) is still dropped. This assertion is NOT a spec — it describes
    // the unrepaired half, and it exists so the half is loud rather than forgotten. Fixing it
    // means moving enemy-side aura registration to CAST time, where the resolved victim id is in
    // scope; the day that lands, this arm should go red and be rewritten to `20_000`.
    //
    // Note the fixture has exactly ONE enemy, so "smearing across the board" and "landing on the
    // right victim" would be indistinguishable HERE — that is why the repair keys on the target's
    // declared scope rather than on the live enemy count.
    it('STILL DEAD: a single-target durationless enemy debuff is dropped (subset scope)', () => {
        expect(suppress('recurring', 'enemy')).toBe(NO_DEBUFF);
        expect(suppress(undefined, 'enemy')).toBe(NO_DEBUFF);
    });

    // ── THE DISCRIMINATOR, STATED AS AN ASSERTION ────────────────────────────────────────────
    // What #390 asked for, restated for the post-repair world: on an `all-enemies` debuff the
    // `duration` field no longer decides whether the fixture measures anything, but on a
    // subset-scoped one it still does. Anyone writing a new enemy-debuff fixture should read this.
    it('the vacuity rule: subset-scoped durationless fixtures are still dead instruments', () => {
        expect(suppress(99, 'enemy')).not.toBe(suppress('recurring', 'enemy'));
        expect(suppress('recurring', 'enemy')).toBe(suppress(undefined, 'enemy'));
        // …while the all-enemies scope now agrees with the timed channel.
        expect(suppress('recurring')).toBe(suppress(99));
    });
});
