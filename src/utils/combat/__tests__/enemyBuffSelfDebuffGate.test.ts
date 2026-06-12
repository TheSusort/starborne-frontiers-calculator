/**
 * enemy-buff / self-debuff condition gate tests (Tasks 7 + PR5-item11).
 *
 * Verifies that a player ability gated on `enemy-buff` fires when the
 * `enemyBuffNames` arg carries the named buff (and not when empty), and that a
 * `self-debuff`-gated ability fires when `selfDebuffNames` carries the named
 * debuff. Uses runPlayerTurn directly with explicit name arrays so the plumbing
 * into every buildRoundContext gate site is verified independently of the engine's
 * live state sourcing (which the runCombat tests in leech.test.ts cover).
 *
 * NOTE on `derivable: true`: only a DERIVABLE enemy-buff/self-debuff condition reads
 * the context name arrays — a non-derivable one returns manualCount (the editor path).
 *
 * As of PR 5 item 11 (Tasks 1 + 1b), real ship-data enemy-buff gates are now emitted
 * `derivable: true` by buildShipAbilities.ts:
 *   - `parseModifiers` Stealth branch: "while Stealthed" self-buff/enemy-buff gates.
 *   - `enemyEffectConditions`: "deal more to enemies with <Buff>" gates (e.g. Lodolite).
 * These runtime tests therefore lock the behavior that live ship abilities depend on,
 * not just hand-built conditions.
 */
import { describe, it, expect } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';

let idCounter = 0;
const ab = (partial: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `eb${++idCounter}`,
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    ...partial,
});

function makeRuntime(skills: ShipSkills, attackStat = 10000): PlayerActorRuntime {
    const actor = createActor({
        id: 'attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack: attackStat,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            defence: 0,
            hp: 20000,
            speed: 100,
        },
        chargeCount: 0,
        startCharged: false,
    });
    const never: PlayerActorRuntime['activeCritGate'] = () => false;
    return {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: [],
        hasChargedSkill: false,
        attack: attackStat,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        defence: 0,
        hp: 20000,
        healModifier: 0,
        debuffLandingChance: 1,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinityDisadvantage: false,
        activeCritGate: never,
        chargedCritGate: never,
        activeHealCritGate: never,
        chargedHealCritGate: never,
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
}

function makeArgs(
    runtime: PlayerActorRuntime,
    names: { enemyBuffNames?: string[]; selfDebuffNames?: string[] }
): PlayerTurnArgs {
    const enemy = createActor({
        id: 'enemy',
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            defence: 0,
            hp: 10_000_000,
            speed: 50,
        },
    });
    const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    statusEngine.beginRound(1);
    return {
        runtime,
        enemy,
        statusEngine,
        corrosionEntries: [],
        infernoEntries: [],
        pendingBombs: [],
        pendingAccumulators: [],
        enemyDefense: 0,
        enemyHp: 10_000_000,
        enemyType: undefined,
        bus: createEventBus(),
        round: 1,
        enemyHpDecline: 0,
        ...names,
    };
}

/** A damage skill with a +100%-attack MODIFIER ability gated on `cond`. When the gate
 *  passes, effectiveAttack doubles → directDamage doubles. Mirrors the selfHpGate pattern
 *  (modifier abilities fold via modifierTotalsFromAbilities against the gate ctx). */
const gatedAttackBuffSkill = (cond: Ability['conditions']): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'damage',
                    target: 'enemy',
                    config: { type: 'damage', multiplier: 100 },
                }),
                ab({
                    type: 'modifier',
                    target: 'self',
                    conditions: cond,
                    config: {
                        type: 'modifier',
                        channel: 'attack',
                        value: 100,
                        isMultiplicative: false,
                    },
                }),
            ],
        },
    ],
});

describe('enemy-buff gate in runPlayerTurn (Task 7)', () => {
    it('fires when enemyBuffNames carries the named buff; not when empty', () => {
        idCounter = 0;
        const cond: Ability['conditions'] = [
            { subject: 'enemy-buff', derivable: true, buffName: 'Attack Up' },
        ];

        const withBuff = runPlayerTurn(
            makeArgs(makeRuntime(gatedAttackBuffSkill(cond)), { enemyBuffNames: ['Attack Up'] })
        );
        const without = runPlayerTurn(
            makeArgs(makeRuntime(gatedAttackBuffSkill(cond)), { enemyBuffNames: [] })
        );

        // Gate passes → +100% attack → 10000 → 20000. Gate fails → 10000.
        expect(withBuff.directDamage).toBe(20000);
        expect(without.directDamage).toBe(10000);
    });

    it('name-filtered: a DIFFERENT enemy buff name does not satisfy the gate', () => {
        idCounter = 0;
        const cond: Ability['conditions'] = [
            { subject: 'enemy-buff', derivable: true, buffName: 'Attack Up' },
        ];
        const turn = runPlayerTurn(
            makeArgs(makeRuntime(gatedAttackBuffSkill(cond)), { enemyBuffNames: ['Defense Up'] })
        );
        expect(turn.directDamage).toBe(10000);
    });
});

describe('self-debuff gate in runPlayerTurn (Task 7)', () => {
    it('fires when selfDebuffNames carries the named debuff; not when empty', () => {
        idCounter = 0;
        const cond: Ability['conditions'] = [
            { subject: 'self-debuff', derivable: true, buffName: 'Defense Down' },
        ];

        const withDebuff = runPlayerTurn(
            makeArgs(makeRuntime(gatedAttackBuffSkill(cond)), {
                selfDebuffNames: ['Defense Down'],
            })
        );
        const without = runPlayerTurn(
            makeArgs(makeRuntime(gatedAttackBuffSkill(cond)), { selfDebuffNames: [] })
        );

        expect(withDebuff.directDamage).toBe(20000);
        expect(without.directDamage).toBe(10000);
    });

    it('default (omitted) name args behave as empty — gate does not fire', () => {
        idCounter = 0;
        const cond: Ability['conditions'] = [
            { subject: 'self-debuff', derivable: true, buffName: 'Defense Down' },
        ];
        const turn = runPlayerTurn(makeArgs(makeRuntime(gatedAttackBuffSkill(cond)), {}));
        expect(turn.directDamage).toBe(10000);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// PR5 item 11 — STATUS-GRANT gate path (LIVE_SUBJECTS lever, abilityStatusGating.ts).
//
// A buff/debuff GRANT gated on a derivable enemy-buff/self-debuff condition is
// registered through liveGateConditions. Before item 11 these subjects were
// neutralized to 'always' (assume-active) so the grant ALWAYS fired; now they read
// the live name arrays. In the single-ship DPS sim there is no live Taunt/Provoke
// (no enemy attackers, dummy enemy applies nothing) → count 0 → the grant does NOT
// fire at round 1. These tests lock that shift via the buff→modifier coupling:
// the granted self-buff feeds an attack modifier, so directDamage reveals whether
// the grant landed. This is the real fleet behavior change for Amartya, Anemone,
// Panon (Provoke self-debuff + Taunt enemy-buff), and Rikra.
// ─────────────────────────────────────────────────────────────────────────────

const GRANT_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 10000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 2,
    selfBuffs: [],
    enemyDebuffs: [],
    debuffLandingChance: 1,
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 2000,
    hp: 1_000_000,
    healTargetId: 'attacker',
    ...overrides,
});

/** Active deals damage + grants a self "Attack Up" (+100% attack, 99 turns) GATED on `cond`.
 *  A passive modifier reads that self-buff and folds nothing of its own — the grant's own
 *  parsedEffects.attack is what doubles directDamage once live. So if the grant never fires,
 *  directDamage stays at base every round. */
const grantGatedSelfBuffSkill = (cond: Ability['conditions']): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'damage',
                    target: 'enemy',
                    config: { type: 'damage', multiplier: 100 },
                }),
                ab({
                    type: 'buff',
                    target: 'self',
                    conditions: cond,
                    config: {
                        type: 'buff',
                        buffName: 'Attack Up',
                        parsedEffects: { attack: 100 },
                        stacks: 1,
                        isStackable: false,
                        duration: 99,
                    },
                }),
            ],
        },
    ],
});

describe('status-grant gate path — flat self-debuff/Provoke (item 11, Step 5b)', () => {
    it('a FLAT self-debuff(Provoke)-gated self-buff GRANT does NOT fire in DPS mode (no live debuff)', () => {
        idCounter = 0;
        // Mirrors Panon/Rikra: a self-buff grant gated on the unit being Provoked. In DPS
        // mode the unit never gets Provoked → the grant never fires → attack stays base.
        const cond: Ability['conditions'] = [
            { subject: 'self-debuff', derivable: true, buffName: 'Provoke' },
        ];
        const result = runCombat(GRANT_BASE({ shipSkills: grantGatedSelfBuffSkill(cond) }));
        // Grant never lands → +100% attack buff never applies → base 10000 both rounds.
        expect(result.rounds[0].directDamage).toBe(10000);
        expect(result.rounds[1].directDamage).toBe(10000);
    });

    it('a FLAT enemy-buff(Taunt)-gated self-buff GRANT does NOT fire in DPS mode (no live enemy buff)', () => {
        idCounter = 0;
        // Mirrors Amartya/Anemone/Panon's Taunt-gated grants: no enemy attacker holds Taunt
        // in DPS mode → grant never fires.
        const cond: Ability['conditions'] = [
            { subject: 'enemy-buff', derivable: true, buffName: 'Taunt' },
        ];
        const result = runCombat(GRANT_BASE({ shipSkills: grantGatedSelfBuffSkill(cond) }));
        expect(result.rounds[0].directDamage).toBe(10000);
        expect(result.rounds[1].directDamage).toBe(10000);
    });

    it('control: an UNGATED self-buff GRANT DOES fire (buff couples into damage as expected)', () => {
        idCounter = 0;
        // Proves the harness sees the grant when nothing gates it: the +100% attack self-buff
        // applies and couples into the same round's outgoing damage → directDamage doubles to
        // 20000 every round. Contrast the gated cases above, which stay at base 10000.
        const result = runCombat(GRANT_BASE({ shipSkills: grantGatedSelfBuffSkill([]) }));
        expect(result.rounds[0].directDamage).toBe(20000);
        expect(result.rounds[1].directDamage).toBe(20000);
    });
});

describe('status-grant gate path — count-scaled self-debuff (item 11, Step 4)', () => {
    it('a self-debuff-COUNT-scaled buff GRANT is not granted at round 1 with no debuffs (net-zero)', () => {
        idCounter = 0;
        // Mirrors Sustainer: a buff grant gated on a derivable self-debuff COUNT (gte 1),
        // with a count-scaled bonus. At combat start selfDebuffNames is empty → count 0 →
        // gate fails AND the bonus would be 0 anyway. Net-zero numerically; locked here so
        // the status-grant path's live read can't silently regress.
        const cond: Ability['conditions'] = [
            { subject: 'self-debuff', derivable: true, countComparator: 'gte', countThreshold: 1 },
        ];
        const result = runCombat(GRANT_BASE({ shipSkills: grantGatedSelfBuffSkill(cond) }));
        expect(result.rounds[0].directDamage).toBe(10000);
        expect(result.rounds[1].directDamage).toBe(10000);
    });
});
