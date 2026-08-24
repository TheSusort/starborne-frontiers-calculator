/**
 * SP-4d Task 8 — the `enemies-hit-this-cast` phantom, closed. Direct assertions for the four rows
 * of the task's own measurement table, on both the cast-path (`playerTurn.ts`'s `ctx`, consumed by
 * `gateFiringAbilities` for the firing skill's own on-cast abilities) and the drain-booking path
 * (`engine.ts`'s three `enemiesHitThisCastByActor.set(...)` sites, consumed at drain time via
 * `enemiesHitThisCastFor`).
 *
 * Root cause: `aoeVictimIds` is populated ONLY for a positional AoE cast (`playerTurn.ts:1134` —
 * `undefined` for a single-target cast AND for a no-victim cast alike). Both sites used to
 * conflate those two `undefined` cases with a single fallback:
 *   - the cast-path ctx read `aoeVictimIds?.length` with NO fallback at all, so a genuine
 *     single-target cast reported absent instead of 1 (a regression: an earlier task removed the
 *     `?? 1` default that used to supply it);
 *   - the three drain-booking sites read `aoeVictimIds?.length ?? 1` unconditionally, so a cast
 *     that resolved NO victim (an ally-targeted heal/shield/buff) booked a fabricated 1 instead of
 *     the honest 0 (`noVictimResidualTripwires.test.ts`'s case (b), a corpus-inert but genuinely
 *     live residual — no shipped ally-target ship reads this gate, so nothing shipped observed it).
 *
 * The fix threads the SAME "did a victim resolve this turn" discriminator already used everywhere
 * else in this rung (`hasVictim` in playerTurn.ts, `tgt !== undefined` in engine.ts) through the
 * fallback: `aoeVictimIds?.length ?? (hasVictim ? 1 : 0)`. A single-target cast (victim resolved,
 * no AoE footprint computed) now reports 1; a no-victim cast now reports 0; an AoE cast is
 * unaffected (its footprint already comes from `aoeVictimIds.length`, never the fallback).
 *
 * CAST-PATH TESTING NOTE — why this file's cast-path block calls `runPlayerTurn` directly instead
 * of `runCombat`: `normalizeCombatRoster` (engine.ts's ONE normalization boundary, SP-4b-1) fills
 * EVERY actor's target/pattern/position unconditionally, for the focus, every team actor, and
 * every enemy attacker (`normalizeRoster.ts`'s `withTargeting`/`placeSide`, applied with no
 * opt-out). That means `aoeVictimIds` is NEVER actually undefined for a turn WITH a resolved
 * victim when reached through `runCombat` — `aoePattern`/`aoeTarget`/`tgt.position` are always
 * defined by the time `buildTurnArgs` computes it (measured directly: a `runCombat` call with no
 * position/target/pattern supplied still resolves `aoePattern: {shape:'base',...}`,
 * `aoeTarget: {selection:'front',...}`, `tgt.position: 'M4'`, giving `aoeVictimIds.length === 1`
 * even under the OLD, unfixed line). So the single-target "reports ABSENT" cell only exists at
 * `playerTurn.ts`'s OWN contract level — a direct `PlayerTurnArgs` caller that supplies `enemy`
 * (a real victim) without `aoeVictimIds` (no AoE footprint was computed for it), which
 * `runPlayerTurn`'s own type (`aoeVictimIds?: string[]`) explicitly allows and `runCombat` happens
 * to never exercise post-normalization. Testing it there — the exact site named in the brief — is
 * what actually exercises playerTurn.ts:2681, mirroring `selfHpGate.test.ts`'s established
 * direct-`runPlayerTurn` pattern. The self-charge-gain mechanism (`chargeGainFromSkill`,
 * playerTurn.ts ~2843) mutates `runtime.actor.charges` INSIDE `runPlayerTurn` itself, but so does
 * `advanceChargeCadence`'s own +1-per-active-turn baseline (playerTurn.ts:1311 — it is called from
 * BOTH playerTurn.ts, for the player's own turn, and engine.ts, for the enemy side; an earlier
 * draft of this file wrongly assumed engine.ts-only). So `chargesAfter` below carries the same
 * `BASELINE_CADENCE` confound as `enemiesHitGate.integration.test.ts`'s Tygr harness, and the
 * gate's effect is the delta between the met and not-met cases, not a bare 0-vs-1.
 *
 * DISCHARGES: `noVictimResidualTripwires.test.ts`'s case (b) — see that file's header for the
 * retirement note, mirroring how cases (a) and (c) were retired in SP-4d Task 7.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, type TeamActorEngineInput } from '../engine';
import { runPlayerTurn, type PlayerActorRuntime, type PlayerTurnArgs } from '../playerTurn';
import { createActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus, type CombatEvent } from '../events';
import { setupKeyedTestRng, makeRateGate } from '../../calculators/rateAccumulator';
import { bareEnemy, bareInput, BARE_ALLY_ID } from '../__testutils__/bareRosterFixture';
import type { Ability, Condition, ShipSkills } from '../../../types/abilities';

// Do NOT call resetRateGateRng() after setupKeyedTestRng() — reset un-seeds the test (see
// noVictimAbsentSubject.integration.test.ts's identical note).
beforeEach(() => setupKeyedTestRng(20260820));

const ALLY_TARGET = { raw: 'ally-team', side: 'ally' as const, selection: 'team' as const };
const BASE_PATTERN = { raw: 'base', shape: 'base' as const, range: 0, modifiers: {} };

// ---------------------------------------------------------------------------
// CAST PATH — playerTurn.ts:2681's ctx, read by gateFiringAbilities for the firing skill's own
// on-cast abilities (Tygr's self-charge-gain is the real corpus shape this seam serves). Direct
// `runPlayerTurn` unit harness — see the file header for why `runCombat` cannot express the
// single-target "no AoE footprint" shape.
// ---------------------------------------------------------------------------

/** Minimal runtime: attack/chargeCount are the only knobs this suite needs.
 *  `hasChargedSkill: true` unlocks `chargeGainFromSkill`'s self-charge-manip block
 *  (playerTurn.ts ~2840, `if (hasChargedSkill && action === 'active')`). */
function makeRuntime(skills: ShipSkills, chargeCount: number): PlayerActorRuntime {
    const actor = createActor({
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 0,
            hp: 20_000,
            speed: 100,
        },
        chargeCount,
        startCharged: false,
    });
    const alwaysFalse: PlayerActorRuntime['activeCritGate'] = () => false;
    return {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: [],
        hasChargedSkill: true,
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        defence: 0,
        hp: 20_000,
        healModifier: 0,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinityDisadvantage: false,
        activeCritGate: alwaysFalse,
        chargedCritGate: alwaysFalse,
        activeHealCritGate: alwaysFalse,
        chargedHealCritGate: alwaysFalse,
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
}

/** `withVictim: true` supplies `enemy` (hasVictim=true) and deliberately OMITS `aoeVictimIds` —
 *  the exact "single-target, no AoE footprint computed" shape. `withVictim: false` omits `enemy`
 *  too (hasVictim=false, the no-victim shape) — also without `aoeVictimIds`, matching
 *  `buildTurnArgs`'s real no-victim behaviour (§A.4: aoeVictimIds requires `tgt.position`, which a
 *  no-victim turn never has either). */
function makeArgs(runtime: PlayerActorRuntime, withVictim: boolean): PlayerTurnArgs {
    const enemy = withVictim
        ? createActor({
              id: 'enemy',
              side: 'enemy',
              kind: 'enemy',
              stats: {
                  attack: 0,
                  crit: 0,
                  critDamage: 0,
                  defensePenetration: 0,
                  shieldPenetration: 0,
                  defence: 0,
                  hp: 10_000_000,
                  speed: 50,
              },
          })
        : undefined;
    const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    statusEngine.beginRound(1);
    return {
        runtime,
        enemy,
        statusEngine,
        corrosionEntries: [],
        infernoEntries: [],
        genericDoTEntries: [],
        pendingBombs: [],
        pendingAccumulators: [],
        enemyDefense: 0,
        enemyHp: 10_000_000,
        enemyType: undefined,
        bus: createEventBus(),
        round: 1,
        // Deliberately no `aoeVictimIds` — this is the whole point of the harness.
    };
}

let idc = 0;
const chargeGain = (gate: Condition): Ability => ({
    id: `cg${++idc}`,
    type: 'charge',
    target: 'self',
    trigger: 'on-cast',
    conditions: [gate],
    config: { type: 'charge', amount: 1 },
});

const chargeKit = (gate: Condition): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [chargeGain(gate)] }],
});

/**
 * Runs one turn and returns the caster's `charges` afterward.
 *
 * NOT confound-free: `advanceChargeCadence` (state.ts) is called directly inside `runPlayerTurn`
 * itself (playerTurn.ts:1311, `hasChargedSkill && actor.charges < chargeCount` → +1), not only
 * from engine.ts as an earlier draft of this file assumed (verified by grepping call sites — there
 * are two, one inside playerTurn.ts for the player's own turn, one in engine.ts for the enemy
 * side). So every call here — met gate or not — carries a `+1` baseline on top of the ability's
 * own effect, exactly like `enemiesHitGate.integration.test.ts`'s `BASELINE_CADENCE`. The gate's
 * effect is still the observable signal: it is the difference between the met and not-met cases.
 */
const BASELINE_CADENCE = 1;

const chargesAfter = (gate: Condition, withVictim: boolean): number => {
    idc = 0;
    const runtime = makeRuntime(chargeKit(gate), 5);
    runPlayerTurn(makeArgs(runtime, withVictim));
    return runtime.actor.charges;
};

describe('SP-4d Task 8 — enemies-hit-this-cast, cast path (playerTurn.ts ctx)', () => {
    it('single-target cast hit 1 enemy: an `eq 1` self-charge gate FIRES (was ABSENT, unsatisfiable)', () => {
        expect(
            chargesAfter(
                {
                    subject: 'enemies-hit-this-cast',
                    derivable: true,
                    countComparator: 'eq',
                    countThreshold: 1,
                },
                true
            )
        ).toBe(BASELINE_CADENCE + 1);
    });

    it('single-target cast hit 1 enemy: an `eq 2` gate does NOT fire (sanity: not "always met")', () => {
        expect(
            chargesAfter(
                {
                    subject: 'enemies-hit-this-cast',
                    derivable: true,
                    countComparator: 'eq',
                    countThreshold: 2,
                },
                true
            )
        ).toBe(BASELINE_CADENCE);
    });

    it('a cast that resolves NO victim: an `eq 0` self-charge gate FIRES (the honest footprint is 0, not absent)', () => {
        expect(
            chargesAfter(
                {
                    subject: 'enemies-hit-this-cast',
                    derivable: true,
                    countComparator: 'eq',
                    countThreshold: 0,
                },
                false
            )
        ).toBe(BASELINE_CADENCE + 1);
    });

    it('a cast that resolves NO victim: an `eq 1` gate does NOT fire (the no-victim footprint is 0, not 1)', () => {
        expect(
            chargesAfter(
                {
                    subject: 'enemies-hit-this-cast',
                    derivable: true,
                    countComparator: 'eq',
                    countThreshold: 1,
                },
                false
            )
        ).toBe(BASELINE_CADENCE);
    });
});

describe('SP-4d Task 8 — cast path, integration control: the repair still lands on a no-victim runCombat turn', () => {
    // The direct-runPlayerTurn block above proves the CTX VALUE; this proves the fix does not
    // suppress the actual no-victim repair through the full engine (same shape
    // noVictimAbsentSubject.integration.test.ts already covers for other gates).
    it('a FOCUS ally-heal cast with a self-charge-gain sibling still delivers the heal', () => {
        const bus = createEventBus();
        const allyRepairs: number[] = [];
        bus.on('heal-performed', (e: Extract<CombatEvent, { type: 'heal-performed' }>) => {
            const forAlly = e.perTarget?.find((t) => t.targetId === BARE_ALLY_ID);
            if (forAlly && forAlly.amount > 0) allyRepairs.push(forAlly.amount);
        });
        const kit: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'repair1',
                            type: 'heal',
                            target: 'all-allies',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'heal', pct: 27, basis: 'hp' },
                        },
                        chargeGain({
                            subject: 'enemies-hit-this-cast',
                            derivable: true,
                            countComparator: 'eq',
                            countThreshold: 0,
                        }),
                    ],
                },
            ],
        };
        runCombat({
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 5,
            shipSkills: kit,
            numRounds: 1,
            selfBuffs: [],
            enemyDebuffs: [],
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            hasChargedSkill: true,
            startCharged: false,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            defence: 0,
            hp: 1_000_000,
            mode: 'battle',
            position: 'M4',
            target: ALLY_TARGET,
            pattern: BASE_PATTERN,
            teamActors: [
                {
                    id: BARE_ALLY_ID,
                    speed: 1,
                    chargeCount: 0,
                    startCharged: false,
                    selfBuffs: [],
                    enemyDebuffs: [],
                },
            ],
            enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
            bus,
        });
        expect(allyRepairs.length).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// DRAIN BOOKING — engine.ts's three `enemiesHitThisCastByActor.set(...)` sites, read at drain
// time via `enemiesHitThisCastFor` (Berserker's Marauder Rage is the real corpus shape). Uses a
// self-shield on a REACTIVE trigger so the gate is read from the booked map, not the cast-path ctx.
// ---------------------------------------------------------------------------

const reactiveShieldKit = (
    gate: Condition,
    trigger: 'on-deal-damage' | 'end-of-turn'
): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                trigger === 'on-deal-damage'
                    ? {
                          id: 'hit1',
                          type: 'damage' as const,
                          target: 'enemy' as const,
                          trigger: 'on-cast' as const,
                          conditions: [],
                          config: { type: 'damage' as const, multiplier: 100 },
                      }
                    : {
                          id: 'repair1',
                          type: 'heal' as const,
                          target: 'all-allies' as const,
                          trigger: 'on-cast' as const,
                          conditions: [],
                          config: { type: 'heal' as const, pct: 27, basis: 'hp' as const },
                      },
            ],
        },
        {
            slot: 'passive',
            abilities: [
                {
                    id: 'reactiveShield',
                    type: 'shield' as const,
                    target: 'self' as const,
                    trigger,
                    conditions: [gate],
                    config: { type: 'shield' as const, pct: 50, basis: 'hp' as const },
                },
            ],
        },
    ],
});

const shieldsOnActor = (
    actorId: string,
    build: (bus: ReturnType<typeof createEventBus>) => void
): number[] => {
    const bus = createEventBus();
    const shields: number[] = [];
    bus.on('shield-applied', (e: Extract<CombatEvent, { type: 'shield-applied' }>) => {
        const forActor = e.perTarget?.find((t) => t.targetId === actorId);
        if (forActor && forActor.amount > 0) shields.push(forActor.amount);
    });
    build(bus);
    return shields;
};

describe('SP-4d Task 8 — enemies-hit-this-cast, drain booking (engine.ts enemiesHitThisCastByActor)', () => {
    it('single-target cast hit 1 enemy: an `eq 1` reactive gate FIRES (unaffected by the fix — already correct)', () => {
        const shields = shieldsOnActor('attacker', (bus) =>
            runCombat({
                ...bareInput(),
                // 'battle' mode anchors `healTarget` to the focus actor, unlocking healingCtx —
                // the shield executor is a no-op without it (Task 9 note in triggers.ts:
                // "heal/shield/cleanse ... only DO anything in healing mode"). NOTE:
                // `normalizeCombatRoster` (SP-4b-1) fills a default position/target/pattern for
                // every actor regardless, so `aoeVictimIds` is actually `['enemy-id']` (length 1)
                // here too, not undefined — this row is genuinely unaffected by the fix either
                // way (both `?? 1` and `?? (tgt !== undefined ? 1 : 0)` read 1 once `tgt` is
                // defined), which is exactly what "already correct" means for this row. See the
                // cast-path describe block's header for the direct-`runPlayerTurn` proof that the
                // true "aoeVictimIds undefined" shape only exists below `runCombat`'s boundary.
                mode: 'battle',
                shipSkills: reactiveShieldKit(
                    {
                        subject: 'enemies-hit-this-cast',
                        derivable: true,
                        countComparator: 'eq',
                        countThreshold: 1,
                    },
                    'on-deal-damage'
                ),
                enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
                bus,
            })
        );
        expect(shields.length).toBeGreaterThan(0);
    });

    it('a FOCUS cast that resolves NO victim: an `eq 0` reactive gate FIRES (was booked as 1, now 0), and the repair still lands', () => {
        const allyRepairs: number[] = [];
        const shields = shieldsOnActor('attacker', (bus) => {
            bus.on('heal-performed', (e: Extract<CombatEvent, { type: 'heal-performed' }>) => {
                const forAlly = e.perTarget?.find((t) => t.targetId === BARE_ALLY_ID);
                if (forAlly && forAlly.amount > 0) allyRepairs.push(forAlly.amount);
            });
            runCombat({
                ...bareInput(),
                mode: 'battle',
                position: 'M4',
                target: ALLY_TARGET,
                pattern: BASE_PATTERN,
                shipSkills: reactiveShieldKit(
                    {
                        subject: 'enemies-hit-this-cast',
                        derivable: true,
                        countComparator: 'eq',
                        countThreshold: 0,
                    },
                    'end-of-turn'
                ),
                teamActors: [
                    {
                        id: BARE_ALLY_ID,
                        speed: 1,
                        chargeCount: 0,
                        startCharged: false,
                        selfBuffs: [],
                        enemyDebuffs: [],
                    },
                ],
                enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
                bus,
            });
        });
        expect(shields.length).toBeGreaterThan(0);
        expect(allyRepairs.length).toBeGreaterThan(0);
    });

    it('a WALKED TEAM cast that resolves NO victim: an `eq 0` reactive gate FIRES on the team member (mirrors the focus site)', () => {
        const healerId = 'team-healer';
        const teamHealer: TeamActorEngineInput = {
            id: healerId,
            speed: 5,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            position: 'M3',
            target: ALLY_TARGET,
            pattern: BASE_PATTERN,
            walk: {
                shipSkills: reactiveShieldKit(
                    {
                        subject: 'enemies-hit-this-cast',
                        derivable: true,
                        countComparator: 'eq',
                        countThreshold: 0,
                    },
                    'end-of-turn'
                ),
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 0,
                    defence: 0,
                    hp: 500_000,
                },
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        };
        const shields = shieldsOnActor(healerId, (bus) =>
            runCombat({
                ...bareInput(),
                // See the single-target drain-booking test's note: 'battle' mode is required to
                // unlock healingCtx, which the shield executor is a no-op without.
                mode: 'battle',
                teamActors: [teamHealer],
                enemyAttackers: bareEnemy({ stats: { hp: 10_000_000 } }),
                bus,
            })
        );
        expect(shields.length).toBeGreaterThan(0);
    });
});
