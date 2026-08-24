/**
 * Ship-kit Wave 8 Task 8 follow-up — Xcellence's `on-own-debuff-resisted` shield-basis reactive
 * damage (ENGINE integration, the runtime coverage `wave8Xcellence.test.ts` deliberately left out —
 * that file only asserts the parsed ability SHAPE).
 *
 * Xcellence's refit-active passive (verbatim from docs/ship-skills.csv, second_passive_skill_text):
 * "...At the start of each turn this Unit gains Shield equal to 20% of its Max HP.<br /><br />
 * When an enemy resists a debuff infliction, this Unit deals damage equal to 115% of this Unit's
 * current shield.." Two live engine mechanics compose here:
 *   1. A per-turn `start-of-turn` shield grant (20% Max HP), which COMPOUNDS round over round —
 *      the proc never consumes the pool, it only reads it (engine.ts's `applyReactiveDamage`,
 *      `shieldBasisPct` branch reads the owner's LIVE `shieldPool`).
 *   2. The `on-own-debuff-resisted` reactive damage proc (task-8-report.md's engine-executor gap
 *      fix) — INFLICTOR-scoped: fires on Xcellence when a debuff IT inflicted is resisted by its
 *      target, dealing 115% of Xcellence's CURRENT (live, compounding) shield.
 *
 * Driven through the REAL pipeline: `simulateBattle` (placement-based two-team battle, mirrors
 * `ravagerResistReaction.integration.test.ts` — the shipped precedent for this SAME
 * `on-own-debuff-resisted` trigger) → `buildShipAbilities` parses the verbatim CSV passive text
 * into the `on-own-debuff-resisted` damage ability (`shieldBasisPct: 115`) AND the `start-of-turn`
 * shield ability (`pct: 20`, `basis: 'hp'`) → the engine drains the shield grant BEFORE the acting
 * owner's cast each round (SP-G G2), then the reactive damage executor reads the live
 * `shieldPool` when the owner's OWN inflicted debuff (Speed Down II / Stasis) is resisted.
 *
 * Deterministic resist: Xcellence's hacking is forced to 0 while the target's security defaults
 * to 100 (resolveStats' `security ?? 100`) — the live hacking-vs-security landing chance clamps to
 * 0, so every debuff Xcellence inflicts is resisted, no RNG pin needed (same trick
 * ravagerResistReaction.integration.test.ts uses).
 *
 * The reactive proc is logged as a bare `kind:'attack'` combat-log entry with NO incrementally-
 * built target list (buildCombatLog's `reactive-damage-performed` handler, single push) — it sits
 * alongside Xcellence's OWN primary 150%-of-attack(100) cast (~150 raw damage, `kind:'attack'`
 * too). The two are told apart by MAGNITUDE: the shield-basis proc is >= 230,000 for a
 * 1,000,000-HP carrier — three orders of magnitude above the primed 150-damage cast — a reliable,
 * deterministic split for this fixture (there is no other structural marker; both share
 * `kind:'attack'`).
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { CombatLogRound } from '../log/types';
import { flattenCombatLog, flattenRound } from '../log/__testutils__/flattenCombatLog';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';

const CARRIER_HP = 1_000_000;

/** A real Xcellence carrying the VERBATIM docs/ship-skills.csv active/second-passive texts
 *  (mirrors wave8Xcellence.test.ts's `shipFromCsv`, widened to a full `Ship` so it can be placed
 *  in a `simulateBattle` two-team battle, mirroring `ravagerResistReaction.integration.test.ts`'s
 *  `makeRavager`). 4 refits → getShipSkillRows selects secondPassiveSkillText (the R2 passive
 *  carrying both the shield grant and the on-resist proc), same refit count wave8Xcellence.test.ts
 *  uses for the same ship. */
function xcellenceShip(id: string): Ship {
    const rec = loadShipSkillRecords().find((r) => r.name.toUpperCase() === 'XCELLENCE');
    if (!rec) throw new Error(`docs/ship-skills.csv: no record for "Xcellence"`);
    return {
        id,
        name: 'Xcellence',
        rarity: 'legendary',
        faction: 'ATLAS_SYNDICATE',
        type: 'Attacker',
        baseStats: {
            hp: 0,
            attack: 0,
            defence: 0,
            hacking: 200,
            security: 100,
            crit: 0,
            critDamage: 0,
            speed: 100,
        },
        equipment: {},
        implants: {},
        refits: Array.from({ length: 4 }, () => ({})) as unknown as Ship['refits'],
        affinity: 'chemical',
        activeSkillText: rec.active,
        chargeSkillCharge: rec.chargeCharge,
        chargeSkillText: rec.charge,
        secondPassiveSkillText: rec.passives[1],
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    };
}

/** A harmless target — just needs to be alive so Xcellence's debuffs have somewhere to land (and
 *  miss). Its default security (100) vs Xcellence's forced hacking 0 guarantees a 0% landing
 *  chance, mirroring ravagerResistReaction.integration.test.ts's `makeTarget`. */
const makeTarget = (id: string): Ship => ({
    id,
    name: 'Target',
    rarity: 'legendary',
    faction: 'AURELIAN_SOVEREIGNTY',
    type: 'Defender',
    baseStats: {
        hp: 0,
        attack: 0,
        defence: 0,
        hacking: 200,
        security: 100,
        crit: 0,
        critDamage: 0,
        speed: 50,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: 'antimatter',
    activeSkillText: 'This Unit deals <unit-damage>10% damage</unit-damage>.',
    chargeSkillCharge: 0,
    activeTarget: 'front',
    activePattern: 'Pattern-Base',
});

/** Xcellence placement. `hacking` defaults to 0 (forced resist — every inflicted debuff misses).
 *  Pass `hacking: 200` for the control case (>= the target's default security 100 → every debuff
 *  LANDS, the resist proc never fires). `hp: CARRIER_HP` is also the shield-grant basis (20% of
 *  this Unit's own Max HP per turn). */
const xcellencePlacement = (ship: Ship, position: Position, hacking = 0): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: 100,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking,
        defence: 0,
        hp: CARRIER_HP,
        security: 100,
        speed: 100,
    },
});

const targetPlacement = (ship: Ship, position: Position): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: 1,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 200,
        defence: 0,
        hp: CARRIER_HP,
        security: 100,
        speed: 50,
    },
});

/** Sums this round's on-resist shield-basis reactive-damage entries attributed to `actorId` (see
 *  the file header for why a >1,000 magnitude filter is the reliable split vs the primary cast). */
const onResistDamageForRound = (round: CombatLogRound, actorId: string): number =>
    flattenRound(round)
        .filter((e) => e.kind === 'attack' && e.actorId === actorId)
        .flatMap((e) => e.targets)
        .filter((t) => (t.amount ?? 0) > 1_000)
        .reduce((sum, t) => sum + (t.amount ?? 0), 0);

describe.skipIf(!csvAvailable())(
    'Wave 8 Task 8 — Xcellence on-resist shield-basis reactive damage (engine integration)',
    () => {
        it('deals 115% of Xcellence’s LIVE shieldPool per proc, compounding round over round', () => {
            const result = simulateBattle({
                playerTeam: [xcellencePlacement(xcellenceShip('xcellence'), 'M4')],
                enemyTeam: [targetPlacement(makeTarget('target'), 'M4')],
                rounds: 3,
            });
            const round = (n: number): CombatLogRound =>
                result.combatLog.find((r) => r.round === n)!;

            // Round 1: ONE 20%-of-CARRIER_HP shield grant has landed (start-of-turn, before the
            // cast) → the proc reads 200,000 as its basis → 115% of that.
            expect(onResistDamageForRound(round(1), 'attacker')).toBeCloseTo(
                CARRIER_HP * 0.2 * 1.15,
                0
            );
            // Round 2: TWO grants have landed (the proc never consumes the pool — it only reads
            // it) → 115% of 400,000 = exactly 2x round 1's credit. Proves the basis COMPOUNDS.
            expect(onResistDamageForRound(round(2), 'attacker')).toBeCloseTo(
                CARRIER_HP * 0.4 * 1.15,
                0
            );
            // Round 3: THREE grants → 115% of 600,000 = 3x round 1 — the basis is the LIVE
            // shieldPool at proc time, not a fixed snapshot from an earlier round.
            expect(onResistDamageForRound(round(3), 'attacker')).toBeCloseTo(
                CARRIER_HP * 0.6 * 1.15,
                0
            );
        });

        it('team symmetry: an ENEMY-owned Xcellence fires the identical on-resist proc against a resisting player unit', () => {
            const result = simulateBattle({
                playerTeam: [targetPlacement(makeTarget('target'), 'M4')],
                enemyTeam: [xcellencePlacement(xcellenceShip('xcellence'), 'M4')],
                rounds: 2,
            });
            const round = (n: number): CombatLogRound =>
                result.combatLog.find((r) => r.round === n)!;

            // Xcellence is enemyTeam[0] → minted id `e:xcellence:0` (battleSimulator.ts id scheme,
            // same convention ravagerResistReaction.integration.test.ts documents for Ravager).
            expect(onResistDamageForRound(round(1), 'e:xcellence:0')).toBeCloseTo(
                CARRIER_HP * 0.2 * 1.15,
                0
            );
            expect(onResistDamageForRound(round(2), 'e:xcellence:0')).toBeCloseTo(
                CARRIER_HP * 0.4 * 1.15,
                0
            );
        });

        it('control: when Xcellence’s inflicted debuffs LAND (no resist), the on-resist proc never fires', () => {
            // Same real Xcellence kit, hacking raised to 200 (>= the target's default security
            // 100) — every inflicted debuff now LANDS instead of resisting. Non-vacuity guard:
            // proves the credit above is caused by the RESIST, not an unconditional per-cast proc.
            const result = simulateBattle({
                playerTeam: [xcellencePlacement(xcellenceShip('xcellence'), 'M4', 200)],
                enemyTeam: [targetPlacement(makeTarget('target'), 'M4')],
                rounds: 2,
            });

            const totalOnResistDamage = result.combatLog.reduce(
                (sum, r) => sum + onResistDamageForRound(r, 'attacker'),
                0
            );
            expect(totalOnResistDamage).toBe(0);

            // Confirm the trigger condition (a resisted debuff) never actually occurred.
            const resists = flattenCombatLog(result).filter((e) => e.kind === 'debuff-resisted');
            expect(resists.length).toBe(0);
        });
    }
);
