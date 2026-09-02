/**
 * Ship-kit Wave 8 Task 8 follow-up — Xcellence's `on-enemy-debuff-resisted` shield-basis reactive
 * damage (ENGINE integration, the runtime coverage `wave8Xcellence.test.ts` deliberately left out —
 * that file only asserts the parsed ability SHAPE).
 *
 * ⚠️ THE ARMS IN THIS FIRST BLOCK ARE BLIND TO THE TRIGGER'S SCOPE, and were shipped that way.
 * They force Xcellence's own hacking to 0 so only SELF-inflicted debuffs resist, which every
 * candidate scoping — inflictor, resister, side — reports identically. They stayed green for
 * months while `on-own-debuff-resisted` silently discarded every ally-inflicted resist (#413).
 * The scope, cause and granularity arms are in the second describe block at the bottom.
 *
 * Xcellence's refit-active passive (verbatim from docs/ship-skills.csv, second_passive_skill_text):
 * "...At the start of each turn this Unit gains Shield equal to 20% of its Max HP.<br /><br />
 * When an enemy resists a debuff infliction, this Unit deals damage equal to 115% of this Unit's
 * current shield.." Two live engine mechanics compose here:
 *   1. A per-turn `start-of-turn` shield grant (20% Max HP), which COMPOUNDS round over round —
 *      the proc never consumes the pool, it only reads it (engine.ts's `applyReactiveDamage`,
 *      `shieldBasisPct` branch reads the owner's LIVE `shieldPool`).
 *   2. The `on-enemy-debuff-resisted` reactive damage proc (task-8-report.md's engine-executor gap
 *      fix) — fires on Xcellence when ANY opposing unit resists a debuff, whoever inflicted it,
 *      dealing 115% of Xcellence's CURRENT (live, compounding) shield to the enemy that resisted.
 *
 * Driven through the REAL pipeline: `simulateBattle` (placement-based two-team battle, mirrors
 * `ravagerResistReaction.integration.test.ts` — Ravager stays on `on-own-debuff-resisted`, which
 * its text ("if ITS debuff is resisted") really does scope to the inflictor) → `buildShipAbilities`
 * parses the verbatim CSV passive text
 * into the `on-enemy-debuff-resisted` damage ability (`shieldBasisPct: 115`) AND the `start-of-turn`
 * shield ability (`pct: 20`, `basis: 'hp'`) → the engine drains the shield grant BEFORE the acting
 * owner's cast each round, then the reactive damage executor reads the live
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

// ----------------------------------------------------------------------------------------------
// #413 — THE SCOPE, THE CAUSE, AND THE GRANULARITY.
//
// Everything above this line exercises only the SELF-inflicted path: Xcellence's own hacking is
// forced to 0 so her OWN debuffs always resist. That fixture stayed green under the wrong trigger
// (`on-own-debuff-resisted`, inflictor-scoped) — it is blind to this bug by construction, which is
// exactly why the bug survived. These arms drive the three things that were wrong:
//
//   SCOPE       — an ALLY's resisted debuff must proc her. Her text is "When an enemy resists a
//                 debuff infliction": the subject is the resister, the object carries no
//                 possessive, so nothing scopes the infliction to her.
//   CAUSE       — only a hacking-vs-security ROLL that was drawn and FAILED counts. An
//                 affinity-disadvantage `apply` draws no roll and must not proc (locked ruling).
//   GRANULARITY — once per RESISTING ENEMY, per ATTACK. Two enemies resisting one cast → two
//                 procs, one hitting each. Two debuffs resisted by one enemy in one cast → one.
//
// Xcellence here carries hacking 200 (>= the target's security 100) so her OWN debuffs LAND —
// every proc these arms observe is therefore attributable to the ALLY's resist alone, which the
// self-inflicted fixture above could never isolate.
// ----------------------------------------------------------------------------------------------

/** A plain debuffer with a caller-supplied active skill text and affinity. Its only job is to cast
 *  a debuff that resists, so Xcellence can react to someone ELSE's infliction. */
const debufferShip = (
    id: string,
    activeSkillText: string,
    affinity: Ship['affinity'],
    activePattern = 'Pattern-Base'
): Ship => ({
    id,
    name: 'Debuffer',
    rarity: 'legendary',
    faction: 'AURELIAN_SOVEREIGNTY',
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
    refits: [],
    affinity,
    activeSkillText,
    chargeSkillCharge: 0,
    activeTarget: 'front',
    activePattern,
});

/** Speed 60: strictly BELOW Xcellence's 100 and above the targets' 50, so within round 1 the order
 *  is Xcellence → ally → targets. That matters — Xcellence's shield is granted at the start of HER
 *  turn, so an ally acting first would find an empty pool and a 0-damage proc, which reads exactly
 *  like the bug this file is about. */
const allyPlacement = (ship: Ship, position: Position, hacking: number): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: 1,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking,
        defence: 0,
        hp: CARRIER_HP,
        security: 100,
        speed: 60,
    },
});

/** One proc's worth of damage after ONE start-of-turn shield grant: 115% of 20% of Max HP. */
const ONE_PROC = CARRIER_HP * 0.2 * 1.15;

const INFLICT_ONE = 'This Unit Inflicts <unit-skill>Speed Down II</unit-skill> for 2 turns.';

/** A `chemical` target, so an `electric` applier stands at an affinity DISADVANTAGE against it
 *  (chemical has advantage over electric) and its `apply` debuff resists WITHOUT a landing roll —
 *  the cause the ruling excludes. Identical to `makeTarget` apart from the affinity. */
const makeChemicalTarget = (id: string): Ship => ({ ...makeTarget(id), affinity: 'chemical' });
const chemicalTargetPlacement = targetPlacement;

describe.skipIf(!csvAvailable())('#413 — Xcellence on-resist scope, cause and granularity', () => {
    it('procs on an ALLY-inflicted resisted debuff, not only on its own', () => {
        const result = simulateBattle({
            playerTeam: [
                // hacking 200 → Xcellence's OWN debuffs land, so she never self-triggers here.
                xcellencePlacement(xcellenceShip('xcellence'), 'M4', 200),
                // hacking 0 vs the target's security 100 → the ally's debuff always resists.
                allyPlacement(debufferShip('ally', INFLICT_ONE, 'antimatter'), 'M3', 0),
            ],
            enemyTeam: [targetPlacement(makeTarget('target'), 'M4')],
            rounds: 1,
        });
        const round1 = result.combatLog.find((r) => r.round === 1)!;

        // The ally's resist, and only the ally's, produced this.
        expect(onResistDamageForRound(round1, 'attacker')).toBeCloseTo(ONE_PROC, 0);
    });

    it('control: when the ALLY’s debuff LANDS, nothing procs', () => {
        // The same board with the ally's hacking raised to 200. Proves the credit above is caused
        // by the ally's RESIST and not merely by an ally being present and casting.
        const result = simulateBattle({
            playerTeam: [
                xcellencePlacement(xcellenceShip('xcellence'), 'M4', 200),
                allyPlacement(debufferShip('ally', INFLICT_ONE, 'antimatter'), 'M3', 200),
            ],
            enemyTeam: [targetPlacement(makeTarget('target'), 'M4')],
            rounds: 1,
        });

        expect(
            result.combatLog.reduce((sum, r) => sum + onResistDamageForRound(r, 'attacker'), 0)
        ).toBe(0);
        expect(flattenCombatLog(result).filter((e) => e.kind === 'debuff-resisted').length).toBe(0);
    });

    it('team symmetry: an ENEMY-side Xcellence procs on its own ally’s resisted debuff too', () => {
        const result = simulateBattle({
            playerTeam: [targetPlacement(makeTarget('target'), 'M4')],
            enemyTeam: [
                xcellencePlacement(xcellenceShip('xcellence'), 'M4', 200),
                allyPlacement(debufferShip('ally', INFLICT_ONE, 'antimatter'), 'M3', 0),
            ],
            rounds: 1,
        });
        const round1 = result.combatLog.find((r) => r.round === 1)!;

        // enemyTeam[0] → `e:xcellence:0` (battleSimulator's id scheme).
        expect(onResistDamageForRound(round1, 'e:xcellence:0')).toBeCloseTo(ONE_PROC, 0);
    });

    it('fires once per RESISTING ENEMY: two enemies resisting one ally cast give two procs', () => {
        const result = simulateBattle({
            playerTeam: [
                xcellencePlacement(xcellenceShip('xcellence'), 'M4', 200),
                allyPlacement(
                    debufferShip(
                        'ally',
                        'This Unit Inflicts <unit-skill>Speed Down II</unit-skill> to all enemies for 2 turns.',
                        'antimatter',
                        // Pattern-Base is a single cell — with it, "all enemies" reaches exactly
                        // one victim and this arm silently degrades into the single-enemy case.
                        'Pattern-All'
                    ),
                    'M3',
                    0
                ),
            ],
            enemyTeam: [
                targetPlacement(makeTarget('t1'), 'M4'),
                targetPlacement(makeTarget('t2'), 'M3'),
            ],
            rounds: 1,
        });
        const round1 = result.combatLog.find((r) => r.round === 1)!;

        // TWO procs, at the same live shield pool — the ally's one cast, resisted by two different
        // enemies. Asserted as 2x rather than "> ONE_PROC" so a third proc would fail too.
        expect(onResistDamageForRound(round1, 'attacker')).toBeCloseTo(2 * ONE_PROC, 0);
    });

    it('collapses to ONE proc when the same enemy resists two debuffs from one cast', () => {
        const result = simulateBattle({
            playerTeam: [
                xcellencePlacement(xcellenceShip('xcellence'), 'M4', 200),
                allyPlacement(
                    debufferShip(
                        'ally',
                        'This Unit Inflicts <unit-skill>Speed Down II</unit-skill> for 2 turns and Inflicts <unit-skill>Attack Down II</unit-skill> for 2 turns.',
                        'antimatter'
                    ),
                    'M3',
                    0
                ),
            ],
            enemyTeam: [targetPlacement(makeTarget('target'), 'M4')],
            rounds: 1,
        });
        const round1 = result.combatLog.find((r) => r.round === 1)!;

        // Two `debuff-resisted` events, one enemy, one attack → ONE proc. The vacuity guard is the
        // resist count: if only one debuff had parsed, this arm would assert nothing.
        const resists = flattenRound(round1).filter((e) => e.kind === 'debuff-resisted');
        expect(resists.length).toBeGreaterThanOrEqual(2);
        expect(onResistDamageForRound(round1, 'attacker')).toBeCloseTo(ONE_PROC, 0);
    });

    // THE REGRESSION THE ROUND-SCOPED KEY COULD NOT SEE. One ally, one turn, one resister — but a
    // `hits: 2` skill is TWO consecutive full-walk attacks, so the debuff loop runs at sub-attack 0
    // and again at sub-attack 1 and the same enemy resists twice. The ruling says two procs. Under
    // the old `(owner, ability, source)` key living in the per-ROUND set, the second was swallowed.
    it('fires twice when ONE enemy resists on two separate attacks in the same turn', () => {
        const result = simulateBattle({
            playerTeam: [
                xcellencePlacement(xcellenceShip('xcellence'), 'M4', 200),
                allyPlacement(
                    debufferShip(
                        'ally',
                        'This Unit attacks twice dealing <unit-damage>10% damage</unit-damage> and Inflicts <unit-skill>Speed Down II</unit-skill> for 2 turns.',
                        'antimatter'
                    ),
                    'M3',
                    0
                ),
            ],
            enemyTeam: [targetPlacement(makeTarget('target'), 'M4')],
            rounds: 1,
        });
        const round1 = result.combatLog.find((r) => r.round === 1)!;

        // The instrument: two resists really did occur. Without this, a fixture whose skill parsed
        // to a single hit would assert the OLD behaviour and read as a pass.
        expect(flattenRound(round1).filter((e) => e.kind === 'debuff-resisted').length).toBe(2);
        expect(onResistDamageForRound(round1, 'attacker')).toBeCloseTo(2 * ONE_PROC, 0);
    });

    // The two arms below split `emitBlockDebuffResist`, whose NAME says Block-Debuff but which
    // `playerTurn` also calls from the DoT LANDING-ROLL-FAILURE branch. Its doc comment asserted
    // the opposite ("Call ONLY on the block path") right up to this fix, so an implementer who
    // trusted it would tag both calls as no-roll and silently drop every rolled DoT resist. These
    // arms are what makes that mistake fail rather than pass.
    it('DOES proc on a DoT resisted by a failed landing roll', () => {
        const result = simulateBattle({
            playerTeam: [
                xcellencePlacement(xcellenceShip('xcellence'), 'M4', 200),
                allyPlacement(
                    debufferShip(
                        'ally',
                        'This Unit Inflicts <unit-skill>Corrosion II</unit-skill> for 2 turns.',
                        'antimatter'
                    ),
                    'M3',
                    0
                ),
            ],
            enemyTeam: [targetPlacement(makeTarget('target'), 'M4')],
            rounds: 1,
        });
        const round1 = result.combatLog.find((r) => r.round === 1)!;

        expect(flattenRound(round1).filter((e) => e.kind === 'debuff-resisted').length).toBe(1);
        expect(onResistDamageForRound(round1, 'attacker')).toBeCloseTo(ONE_PROC, 0);
    });

    // The OTHER axis the round-scoped key collapsed, and the one with no prior coverage at all:
    // two DIFFERENT allies, two separate TURNS, the same resisting enemy. The old guard lived in
    // the per-ROUND set, so the second ally's resist reused the first's key and was swallowed.
    // `counterFiredThisTurn` is cleared at each actor turn-start, which is what separates them.
    it('fires again for the same enemy when a SECOND ally is resisted later in the round', () => {
        const result = simulateBattle({
            playerTeam: [
                xcellencePlacement(xcellenceShip('xcellence'), 'M4', 200),
                allyPlacement(debufferShip('ally1', INFLICT_ONE, 'antimatter'), 'M3', 0),
                allyPlacement(debufferShip('ally2', INFLICT_ONE, 'antimatter'), 'M2', 0),
            ],
            enemyTeam: [targetPlacement(makeTarget('target'), 'M4')],
            rounds: 1,
        });
        const round1 = result.combatLog.find((r) => r.round === 1)!;

        // Two allies, two resists, one enemy — and Xcellence's shield pool is unchanged between
        // them (it is granted at the start of HER turn, which is already over), so two procs read
        // as exactly 2x one.
        expect(flattenRound(round1).filter((e) => e.kind === 'debuff-resisted').length).toBe(2);
        expect(onResistDamageForRound(round1, 'attacker')).toBeCloseTo(2 * ONE_PROC, 0);
    });

    it('does NOT proc on an affinity-disadvantage `apply` resist (no landing roll was drawn)', () => {
        const result = simulateBattle({
            playerTeam: [
                xcellencePlacement(xcellenceShip('xcellence'), 'M4', 200),
                // "Applies" → an `apply` debuff, which resolves on AFFINITY and draws no gate.
                // electric applier vs chemical target → chemical has advantage over electric →
                // the applier is at a disadvantage → it resists. hacking 200 deliberately: a roll,
                // had one been drawn, would have LANDED, so a proc here could only come from
                // counting a roll-less resist.
                allyPlacement(
                    debufferShip(
                        'ally',
                        'This Unit Applies <unit-skill>Speed Down II</unit-skill> for 2 turns.',
                        'electric'
                    ),
                    'M3',
                    200
                ),
            ],
            enemyTeam: [chemicalTargetPlacement(makeChemicalTarget('target'), 'M4')],
            rounds: 1,
        });
        const round1 = result.combatLog.find((r) => r.round === 1)!;

        // The INSTRUMENT first: a resist must actually have happened, or this arm proves nothing.
        expect(
            flattenRound(round1).filter((e) => e.kind === 'debuff-resisted').length
        ).toBeGreaterThan(0);
        // ...and it produced no proc.
        expect(onResistDamageForRound(round1, 'attacker')).toBe(0);
    });
});
