/**
 * PR6a characterization test — the collapsed `runPlayerTurn(buildTurnArgs(actor, …))` path.
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
import { Ability, ShipSkills } from '../../../types/abilities';

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
        debuffLandingChance: 1,
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
    debuffLandingChance: 1,
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
    speed: 100,
    ...overrides,
});

const totalIncoming = (r: ReturnType<typeof runCombat>): number =>
    r.healing!.rounds.reduce((sum, round) => sum + round.incomingDamage, 0);

const playerOutgoing = (r: ReturnType<typeof runCombat>) =>
    r.rounds.map((round) => ({
        totalRoundDamage: round.totalRoundDamage,
        cumulativeDamage: round.cumulativeDamage,
        directDamage: round.directDamage,
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
        expect(result.rounds.some((round) => round.directDamage > 0)).toBe(true);
        expect(result.rounds.some((round) => round.totalRoundDamage > 0)).toBe(true);

        // Team credit path (walked team): the team actor's damage lands in the teamDamage bucket
        // (NON-ZERO), never folded into the focus row — proving its turn resolved player-side bindings.
        expect(result.rounds.some((round) => (round.teamDamage ?? 0) > 0)).toBe(true);

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
        expect(withBuff.rounds.some((round) => round.totalRoundDamage > 0)).toBe(true);
        expect(noBuff.rounds.some((round) => round.totalRoundDamage > 0)).toBe(true);

        // NO CROSS-SIDE LEAK: the player's outgoing damage rows are byte-identical whether or not
        // the enemy buffed itself — the enemy self-buff never reached a player store.
        expect(playerOutgoing(withBuff)).toEqual(playerOutgoing(noBuff));
    });
});
