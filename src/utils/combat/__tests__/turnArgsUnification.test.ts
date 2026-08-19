/**
 * PR6a + PR6b characterization tests — the collapsed `runPlayerTurn(buildTurnArgs(actor, …))` path.
 *
 * PR6a merged THREE near-duplicate runPlayerTurn call sites (focus / walked-team / enemy)
 * into one builder, with the per-side divergence living in `turnBindings(side)`. This test
 * exercises all three actor kinds in a SINGLE healing-mode runCombat call and asserts the
 * observable each side's bindings produce, so a binding that leaks across sides (e.g. the
 * enemy site picking up the player credit path, or vice-versa) breaks an assertion.
 *
 * Every assertion is anchored to a NON-ZERO baseline: each actor actually produces the
 * observable it is checked on, so the checks can genuinely fail if a binding regresses
 * (the project was burned twice by vacuous isolation tests that compared an observable the
 * actor never produced — see enemyTeamRouting.test.ts / CodeRabbit #103).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor } from '../state';
import { createStatusEngine } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { RoundData } from '../../calculators/dpsSimulator';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `tau${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// A basic-attack active slot (100% / 1 hit) — folds the actor's CURRENT effective attack,
// so a live Attack Up couples straight into the hit's damage.
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

const damageSkills = (): ShipSkills => ({ slots: [basicAttack()] });

// A walked team actor that deals damage on its turn (team credit path → teamDamage bucket).
const walkedTeamDamager = (id: string, speed: number): TeamActorEngineInput => ({
    id,
    speed,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    walk: {
        shipSkills: damageSkills(),
        stats: {
            attack: 4000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: 8000,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// An enemy attacker that hits the heal target. `selfBuff` controls whether it grants ITSELF
// an Attack Up before its hit (used to prove the enemy self-buff stays on the enemy side).
const enemyHitter = (id: string, speed: number, selfBuff: boolean): EnemyAttacker =>
    ({
        id,
        stats: { attack: 5000, crit: 0, critDamage: 0, speed },
        chargeCount: 0,
        startCharged: false,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        ...(selfBuff
                            ? [
                                  ab({
                                      type: 'buff',
                                      target: 'self',
                                      config: {
                                          type: 'buff',
                                          buffName: 'Enemy Attack Up',
                                          parsedEffects: { attack: 100 },
                                          stacks: 1,
                                          isStackable: false,
                                          duration: 99,
                                      },
                                  }),
                              ]
                            : []),
                        ab({
                            type: 'damage',
                            target: 'enemy',
                            config: { type: 'damage', multiplier: 100 },
                        }),
                    ],
                },
            ],
        } as ShipSkills,
    }) as EnemyAttacker;

// Healing-mode base: a DAMAGING focus attacker (so the player credit path is exercised),
// a heal target with a huge HP pool (survives, incoming damage observable), and room for
// team actors + enemy attackers. enemyHp huge so the dummy never dies.
const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 3000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: damageSkills(),
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
    hp: 1_000_000_000, // huge tank HP → survives both rounds, incoming damage observable
    healTargetId: 'attacker',
    mode: 'healing',
    speed: 100,
    ...overrides,
});

const totalIncoming = (r: ReturnType<typeof runCombat>): number =>
    r.healing!.rounds.reduce((sum, round) => sum + round.incomingDamage, 0);

/**
 * The FOCUS's own dealt damage for one round.
 *
 * SP-4c-2a (B1): `enemyHitter(...)` carries no `stats.hp`, so the targetable-HP floor
 * (normalizeRoster.ts) now raises it to MIN_TARGETABLE_MAX_HP and the run is positional — the
 * scalar `totalRoundDamage`/`directDamage` credits are suppressed to 0 in favour of the
 * per-victim map. Sum the per-victim channel (across every victim the focus dealt to) and fall
 * back to the scalar when it is absent.
 */
const playerDealt = (round: RoundData): number => {
    const perVictim = round.perTargetDealt?.['attacker'];
    return perVictim ? Object.values(perVictim).reduce((sum, v) => sum + v, 0) : round.directDamage;
};

/**
 * A given source actor's dealt damage for one round, read off the per-victim channel.
 *
 * SP-4c-2a: the same positional shift applies to a WALKED-TEAM actor's credit — under a
 * positional run its direct credit goes through `creditPositionalDirect` (the Echoing Burst
 * gather basis), which does NOT fold into the `teamDamage` display scalar (discovered via
 * standalone repro against the real engine: `teamDamage` reads 0 while `perTargetDealt['team1']`
 * correctly reads the dealt amount) — the same asymmetry documented in
 * perVictimWalkedTeamDetonation.integration.test.ts for the detonation channel. Read the
 * per-victim channel directly rather than the scalar `teamDamage`.
 */
const dealtBySource = (round: RoundData, sourceId: string): number => {
    const perVictim = round.perTargetDealt?.[sourceId];
    return perVictim ? Object.values(perVictim).reduce((sum, v) => sum + v, 0) : 0;
};

const playerOutgoing = (r: ReturnType<typeof runCombat>) =>
    r.rounds.map((round) => ({
        totalRoundDamage: round.totalRoundDamage,
        cumulativeDamage: round.cumulativeDamage,
        directDamage: round.directDamage,
        dealt: playerDealt(round),
    }));

describe('PR6a — collapsed runPlayerTurn path resolves per-side bindings', () => {
    it('focus, walked-team, and enemy turns each produce their own side observable in one run', () => {
        idc = 0;
        const result = runCombat(
            BASE({
                teamActors: [walkedTeamDamager('team1', 90)],
                enemyAttackers: [enemyHitter('e1', 40, false)],
            })
        );

        // Player credit path (focus): the focus attacker's damage row is NON-ZERO — buildTurnArgs
        // routed its hit through the player applyToVictim (applyOutgoingToEnemy) → a player damage row.
        expect(result.rounds.some((round) => playerDealt(round) > 0)).toBe(true);

        // Team credit path (walked team): the team actor's damage lands in the per-victim channel
        // under its OWN id (NON-ZERO), never folded into the focus row — proving its turn resolved
        // player-side bindings. (Not `round.teamDamage` — see `dealtBySource`'s comment.)
        expect(result.rounds.some((round) => dealtBySource(round, 'team1') > 0)).toBe(true);

        // Enemy intake path: the enemy attacker's hit lands as INCOMING damage on the heal target
        // (NON-ZERO) — proving the enemy turn resolved enemyTurnBindings.applyToVictim
        // (applyIncomingToTarget) and credited the enemy intake bucket, not a player damage row.
        expect(totalIncoming(result)).toBeGreaterThan(0);
    });

    it('an enemy self-buff stays on the enemy side and does not leak into player outgoing damage', () => {
        // WITH the enemy self-buff: the enemy grants itself Attack Up before its hit, so its
        // incoming damage to the tank is strictly higher than the no-buff control. This proves the
        // self-buff is LIVE (non-vacuity: enemy side actually changed between the two runs).
        idc = 0;
        const withBuff = runCombat(
            BASE({
                teamActors: [walkedTeamDamager('team1', 90)],
                enemyAttackers: [enemyHitter('e1', 40, true)],
            })
        );
        idc = 0;
        const noBuff = runCombat(
            BASE({
                teamActors: [walkedTeamDamager('team1', 90)],
                enemyAttackers: [enemyHitter('e1', 40, false)],
            })
        );

        // NON-VACUITY (enemy side): the enemy self-buff really folded into the enemy's hit.
        expect(totalIncoming(withBuff)).toBeGreaterThan(totalIncoming(noBuff));
        // NON-VACUITY (player side): the player team actually DEALS damage in both runs, so the
        // equality below is a real leak detector — a leaked enemy Attack Up would raise the player
        // output and break the toEqual.
        expect(withBuff.rounds.some((round) => playerDealt(round) > 0)).toBe(true);
        expect(noBuff.rounds.some((round) => playerDealt(round) > 0)).toBe(true);

        // NO CROSS-SIDE LEAK: the player's outgoing damage rows are byte-identical whether or not
        // the enemy buffed itself — the enemy self-buff never reached a player store.
        expect(playerOutgoing(withBuff)).toEqual(playerOutgoing(noBuff));
    });
});

// ---------------------------------------------------------------------------
// PR6b helpers — direct runPlayerTurn invocation
// ---------------------------------------------------------------------------

const PR6B_MAX_HP = 10_000_000;

/** Minimal player runtime (attack-only, no crits, no debuffs). */
function makePr6bRuntime(): PlayerActorRuntime {
    const actor = createActor({
        id: 'pr6b-attacker',
        side: 'player',
        kind: 'attacker',
        stats: {
            attack: 5000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 0,
            hp: 10000,
            speed: 100,
        },
        chargeCount: 0,
        startCharged: false,
    });

    const noGate: PlayerActorRuntime['activeCritGate'] = () => false;

    const skills: ShipSkills = {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'pr6b-dmg',
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 100 },
                    },
                ],
            },
        ],
    };

    return {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: [],
        hasChargedSkill: false,
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        defence: 0,
        hp: 10000,
        healModifier: 0,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinityDisadvantage: false,
        activeCritGate: noGate,
        chargedCritGate: noGate,
        activeHealCritGate: noGate,
        chargedHealCritGate: noGate,
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
}

/** Build a PlayerTurnArgs with the given enemy actor (its currentHp controls the derivation). */
function makePr6bArgs(runtime: PlayerActorRuntime, enemyCurrentHp: number): PlayerTurnArgs {
    const enemy = createActor({
        id: 'pr6b-enemy',
        side: 'enemy',
        kind: 'enemy',
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            shieldPenetration: 0,
            defence: 0,
            hp: PR6B_MAX_HP,
            speed: 50,
        },
    });
    // Override currentHp AFTER construction to simulate pre-existing HP loss.
    enemy.currentHp = enemyCurrentHp;

    const eng = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    eng.beginRound(1);

    return {
        runtime,
        enemy,
        statusEngine: eng,
        corrosionEntries: [],
        infernoEntries: [],
        genericDoTEntries: [],
        pendingBombs: [],
        pendingAccumulators: [],
        enemyDefense: 0,
        enemyHp: PR6B_MAX_HP,
        enemyType: undefined,
        bus: createEventBus(),
        round: 1,
        targetId: undefined,
    };
}

// ---------------------------------------------------------------------------
// PR6b — enemyHpPct is derived from the victim's live currentHp, not a passed scalar
// ---------------------------------------------------------------------------

describe('PR6b — enemyHpPct derived from victim currentHp', () => {
    it('victim at FULL HP → enemyHpPct === 100', () => {
        // currentHp === maxHp: no decline → pct = 100 * (1 - 0/maxHp) = 100.
        const runtime = makePr6bRuntime();
        const result = runPlayerTurn(makePr6bArgs(runtime, PR6B_MAX_HP));
        expect(result.enemyHpPct).toBe(100);
    });

    it('victim at HALF HP → enemyHpPct === 50', () => {
        // currentHp = maxHp/2: decline = 5_000_000 → pct = 100 * (1 - 0.5) = 50.
        // The arg object carries NO enemyHpDecline field (param removed in PR6b);
        // the derivation reads enemy.currentHp directly inside runPlayerTurn.
        const runtime = makePr6bRuntime();
        const result = runPlayerTurn(makePr6bArgs(runtime, PR6B_MAX_HP / 2));
        expect(result.enemyHpPct).toBe(50);
    });
});
