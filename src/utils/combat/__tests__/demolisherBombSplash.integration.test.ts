/**
 * Ship-kit W5 Task C3 — Demolisher's reactive bomb-splash: when a Bomb detonates on an enemy,
 * deal 100% of the Bomb's OWN damage to all enemies adjacent to the bombed enemy (the bomb
 * victim excluded), ignoring Defense and never critting. The ability is already parsed (Task
 * C1: `{ type:'damage', multiplier:100, target:'adjacent-enemies', trigger:'on-bomb-detonated',
 * config:{ ignoresDefense:true, noCrit:true } }`) and `bomb-detonated` already carries
 * `victimId` (Task C2). This suite wires the reactive EXECUTION (triggers.ts's `adjacent-
 * enemies` victim resolution + engine.ts's flat-basis/defense-bypass `applyReactiveDamage`).
 *
 * Harness: mirrors perVictimTimedDetonation.integration.test.ts (raw `runCombat`, positional
 * `enemyAttackers`, a bomb pre-seeded directly via `__testTapActors` rather than driven through
 * a real cast — isolates the reactive-splash mechanics from bomb-application/DoT-tier math) and
 * bombDetonatedVictimId.test.ts's bus-tap idiom for asserting the raw `bomb-detonated`/
 * `reactive-damage-performed` events rather than parsing the rendered combat log.
 *
 * Board layout (src/utils/targeting/board.ts hex adjacency): the bomb lands on 'tgt' at M4.
 * neighbors(M4) = [M3, T3, T4, B3, B4] — nbrA (M3) and nbrB (T3) are real neighbours; `far` (T1)
 * is not (mirrors adjacentEnemiesDot.integration.test.ts's B2 roster).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import type { CombatActor, PendingBomb } from '../state';
import type { CombatEvent } from '../events';
import { createEventBus } from '../events';
import { bareEnemy, BARE_ENEMY_ID } from '../__testutils__/bareRosterFixture';

// The Demolisher passive splash ability (Task C1's parsed shape, verbatim):
// "... deals 100% of the Bomb's damage to all adjacent enemies. This damage ignores Defense
// and cannot result in a critical hit."
const splashAbility = (): Ability => ({
    id: 'demolisher-splash',
    type: 'damage',
    target: 'adjacent-enemies',
    trigger: 'on-bomb-detonated',
    conditions: [],
    config: { type: 'damage', multiplier: 100, noCrit: true, ignoresDefense: true },
});

const casterShipSkills = (): ShipSkills => ({
    slots: [{ slot: 'passive', abilities: [splashAbility()] }],
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// A positioned enemy victim: zero offense (attack 0), finite HP, configurable defence.
const enemyAt = (
    id: string,
    position: Position,
    defence: number,
    hp = 1_000_000_000
): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence, hp, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots: [] } as ShipSkills,
    }) as EnemyAttacker;

// A bomb pre-seeded with countdown 1 — bursts on the holder's OWN very first turn (round 1).
// burst = damagePerStack × stacks × affinityMult (neutral mults) = 1000 × 2 = 2000.
const bomb = (sourceId: string): PendingBomb => ({
    countdown: 1,
    damagePerStack: 1000,
    stacks: 2,
    tier: 300,
    sourceId,
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
});

// Raw runCombat input: the CASTER is the focus 'attacker' (player side), positioned (so the
// enemy-side bombed victim's own-turn positional timed-burst gate — isPositional(pos,
// opposingRoster) — is satisfied), carrying ONLY the passive splash ability (zero-offense: no
// active slot, mirrors the "zero-offense parked actor" idiom used elsewhere in this suite).
const CASTER_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: casterShipSkills(),
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 1,
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
    hp: 1_000_000_000,
    position: 'M4',
    enemyAttackers: [
        enemyAt('tgt', 'M4', 0), // the bomb holder
        enemyAt('nbrA', 'M3', 5000), // neighbour of M4, HIGH defence
        enemyAt('nbrB', 'T3', 0), // neighbour of M4, zero defence
        enemyAt('far', 'T1', 0), // NOT a neighbour of M4
    ],
    ...overrides,
});

// Tap the raw bus for bomb-detonated + reactive-damage-performed (bombDetonatedVictimId's idiom).
const collect = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const types: CombatEvent['type'][] = ['bomb-detonated', 'reactive-damage-performed'];
    for (const t of types) bus.on(t, (e) => events.push(e as CombatEvent));
    const result = runCombat({ ...input, bus });
    return { events, result };
};

type ReactiveDamagePerformed = Extract<CombatEvent, { type: 'reactive-damage-performed' }>;
type BombDetonated = Extract<CombatEvent, { type: 'bomb-detonated' }>;

describe('Ship-kit W5 Task C3: Demolisher reactive bomb-splash to adjacent enemies', () => {
    it('board-neighbours of the bombed enemy each take splash damage; the bombed enemy and a non-neighbour do not', () => {
        const { events } = collect(
            CASTER_BASE({
                __testTapActors: (actors: CombatActor[]) => {
                    actors.find((a) => a.id === 'tgt')?.pendingBombs.push(bomb('attacker'));
                },
            })
        );

        const bombDet = events.filter((e): e is BombDetonated => e.type === 'bomb-detonated');
        expect(bombDet).toHaveLength(1);
        expect(bombDet[0]).toMatchObject({ actorId: 'attacker', victimId: 'tgt', damage: 2000 });

        const splashes = events.filter(
            (e): e is ReactiveDamagePerformed => e.type === 'reactive-damage-performed'
        );
        const byTarget = new Map(splashes.map((e) => [e.targetId, e]));

        // 1. Both board-neighbours took splash damage.
        expect(byTarget.get('nbrA')).toBeDefined();
        expect(byTarget.get('nbrB')).toBeDefined();
        // 2. The bombed enemy itself does NOT take extra splash (adjacent-only).
        expect(byTarget.get('tgt')).toBeUndefined();
        // 3. A NON-neighbour enemy takes no splash (real positional adjacency).
        expect(byTarget.get('far')).toBeUndefined();
        // Exactly the two neighbours, nothing else.
        expect(splashes).toHaveLength(2);

        // 4. Ignores Defense: nbrA (defence 5000) takes EXACTLY the flat bomb-damage figure
        //    (event.damage), identical to nbrB (defence 0) — defence had zero effect.
        expect(byTarget.get('nbrA')?.amount).toBe(bombDet[0].damage);
        expect(byTarget.get('nbrB')?.amount).toBe(bombDet[0].damage);

        // 5. Never crits: both splash procs report didCrit falsy.
        expect(byTarget.get('nbrA')?.didCrit).toBeFalsy();
        expect(byTarget.get('nbrB')?.didCrit).toBeFalsy();

        // All splash procs are attributed to the caster ('attacker'), the ability's owner.
        expect(splashes.every((e) => e.sourceId === 'attacker')).toBe(true);
    });

    it('team symmetry: an ENEMY-side Demolisher splashes onto PLAYER-side neighbours of the bombed player', () => {
        // Mirror roster: the bombed victim is the focus 'attacker' (player side, M4); its
        // neighbours + non-neighbour are PLAYER-side walked team actors (teamActors is the only
        // way to get a multi-actor POSITIONED roster on the player side). The caster moves to the
        // enemy side (enemyAttackers), carrying the same passive splash ability. Positions are
        // side-LOCAL (adjacency resolves within the same side's roster only, per adjacentAllyIds/
        // bySide), so reusing M3/T3/T1 labels here does not collide with the enemy-side caster.
        const teamNeighbour = (
            id: string,
            position: Position,
            defence: number
        ): TeamActorEngineInput =>
            ({
                id,
                speed: 1,
                chargeCount: 0,
                startCharged: false,
                selfBuffs: [],
                enemyDebuffs: [],
                position,
                walk: {
                    shipSkills: { slots: [] } as ShipSkills,
                    stats: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defensePenetration: 0,
                        defence,
                        hp: 1_000_000_000,
                        hacking: 0,
                    },
                    selfDotModifier: 0,
                    defensePenetrationBuff: 0,
                    affinityDamageModifier: 0,
                    affinityCritCap: 100,
                    affinityCritPenalty: 0,
                    hasChargedSkill: false,
                },
            }) as TeamActorEngineInput;

        const { events } = collect(
            CASTER_BASE({
                // The focus 'attacker' IS the bomb victim now (still M4), with no offense of its
                // own — mirrors the zero-offense caster idiom, just swapped roles.
                shipSkills: { slots: [] } as ShipSkills,
                enemyAttackers: [
                    // The caster moves to the enemy side; it still needs A position (any) so
                    // isPositional(attacker.position, enemyAttackerActors) is satisfied for the
                    // focus player's own positional timed-burst gate.
                    { ...enemyAt('e-caster', 'M4', 0), shipSkills: casterShipSkills() },
                ],
                teamActors: [
                    teamNeighbour('nbrA', 'M3', 5000),
                    teamNeighbour('nbrB', 'T3', 0),
                    teamNeighbour('far', 'T1', 0),
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    actors.find((a) => a.id === 'attacker')?.pendingBombs.push(bomb('e-caster'));
                },
            })
        );

        const bombDet = events.filter((e): e is BombDetonated => e.type === 'bomb-detonated');
        expect(bombDet).toHaveLength(1);
        expect(bombDet[0]).toMatchObject({
            actorId: 'e-caster',
            victimId: 'attacker',
            damage: 2000,
        });

        const splashes = events.filter(
            (e): e is ReactiveDamagePerformed => e.type === 'reactive-damage-performed'
        );
        const byTarget = new Map(splashes.map((e) => [e.targetId, e]));

        expect(byTarget.get('nbrA')).toBeDefined();
        expect(byTarget.get('nbrB')).toBeDefined();
        expect(byTarget.get('attacker')).toBeUndefined(); // the bombed player itself, excluded
        expect(byTarget.get('far')).toBeUndefined(); // non-neighbour
        expect(splashes).toHaveLength(2);
        expect(byTarget.get('nbrA')?.amount).toBe(bombDet[0].damage); // ignores Defense
        expect(byTarget.get('nbrB')?.amount).toBe(bombDet[0].damage);
        expect(splashes.every((e) => e.sourceId === 'e-caster')).toBe(true);
    });

    it('CRITICAL review fix: a bomb detonating on a PLAYER ally (own side) does NOT splash the enemy roster', () => {
        // Reviewer repro: the on-bomb-detonated listener (triggers.ts) previously enqueued for
        // EVERY bomb detonation with no side guard. Here 'attacker' is the player-side Demolisher
        // owner, but the bomb bursts on 'ally' — a SEPARATE actor on the OWNER'S OWN side (e.g.
        // an enemy's Bomb landing on a player teammate). Pre-fix: the listener fired anyway,
        // stamped eventCtx.victimId = 'ally', and the adjacent-enemies executor called
        // ctx.adjacentOpposingIdsFor('ally') — which looks 'ally' up in the ENEMY roster, fails
        // to find it (owner undefined), and (adjacency.ts's non-positional fallback) returned the
        // ENTIRE living enemy roster with adjacency ignored — splashing tgt/nbrA/nbrB/far all at
        // once. Post-fix: isOpposing('ally') is false for the player-side listener, so the
        // splash never fires at all.
        const { events } = collect(
            CASTER_BASE({
                teamActors: [
                    {
                        id: 'ally',
                        speed: 1,
                        chargeCount: 0,
                        startCharged: false,
                        selfBuffs: [],
                        enemyDebuffs: [],
                        position: 'T4',
                        walk: {
                            shipSkills: { slots: [] } as ShipSkills,
                            stats: {
                                attack: 0,
                                crit: 0,
                                critDamage: 0,
                                defensePenetration: 0,
                                defence: 0,
                                hp: 1_000_000_000,
                                hacking: 0,
                            },
                            selfDotModifier: 0,
                            defensePenetrationBuff: 0,
                            affinityDamageModifier: 0,
                            affinityCritCap: 100,
                            affinityCritPenalty: 0,
                            hasChargedSkill: false,
                        },
                    } as TeamActorEngineInput,
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    actors.find((a) => a.id === 'ally')?.pendingBombs.push(bomb('some-enemy'));
                },
            })
        );

        // Sanity: the own-side bomb still detonates (the harness is live) ...
        const bombDet = events.filter((e): e is BombDetonated => e.type === 'bomb-detonated');
        expect(bombDet.some((e) => e.victimId === 'ally')).toBe(true);

        // ... but produces ZERO reactive splash — none of the enemy roster (tgt/nbrA/nbrB/far)
        // takes any damage from it.
        const splashes = events.filter(
            (e): e is ReactiveDamagePerformed => e.type === 'reactive-damage-performed'
        );
        expect(splashes).toHaveLength(0);
    });

    it('DPS invariance: single-sink (non-positional) mode never splashes and leaves DPS byte-identical', () => {
        // The single-enemy-roster path. The floored enemy is the sole enemy-side actor, so
        // adjacentAllyIdsFor(it) resolves to the empty set (no OTHER same-side actor exists) —
        // DPS-inert by construction, not by a special-cased guard.
        //
        // SP-4b-2b: this used to reach a NON-positional dummy-sink path with NO `enemyAttackers`.
        // A roster is now required, and omitting `target`/`pattern` is not enough to stay
        // non-positional — `normalizeCombatRoster` FILLS both. This case therefore used the
        // documented "pressure source" (0 MAX hp) to keep `resolvesPositionalVictim` from finding
        // anyone targetable. SP-4c-2a's targetable-HP floor closes that shape too: the same 0-max-HP
        // enemy is now raised to 1,000,000 HP, so the run IS positional. That does not disturb the
        // claim under test — a single-member enemy roster still has no adjacent same-side actor
        // regardless of position — it only moves the bomb tap onto the real, now-floored enemy
        // (`BARE_ENEMY_ID`) instead of the no-longer-existing `'enemy'` dummy.
        const NONPOS_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
            enemyAttackers: bareEnemy({ stats: { hp: 0 } }),
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
            numRounds: 3,
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
            hp: 1_000_000_000,
            shipSkills: { slots: [] } as ShipSkills,
            ...overrides,
        });

        const withSplash = (): { result: ReturnType<typeof runCombat>; events: CombatEvent[] } => {
            const { events, result } = collect(
                NONPOS_BASE({
                    shipSkills: casterShipSkills(),
                    __testTapActors: (actors: CombatActor[]) => {
                        actors.find((a) => a.id === BARE_ENEMY_ID)?.pendingBombs.push(bomb('attacker'));
                    },
                })
            );
            return { result, events };
        };

        const baseline = (): ReturnType<typeof runCombat> => {
            const bus = createEventBus();
            return runCombat({
                ...NONPOS_BASE({
                    // No passive at all — the true DPS baseline this caster would produce
                    // without the splash reactive ability wired.
                    shipSkills: { slots: [] } as ShipSkills,
                    __testTapActors: (actors: CombatActor[]) => {
                        actors.find((a) => a.id === BARE_ENEMY_ID)?.pendingBombs.push(bomb('attacker'));
                    },
                }),
                bus,
            });
        };

        const { result, events } = withSplash();
        // ANTI-VACUITY for the MODE claim: prove the bomb genuinely detonated on the real,
        // now-floored enemy — or "no splash" would be explained by the run never reaching this
        // code at all. SP-4c-2a: this run is now positional (the floor makes the lone enemy
        // hittable), so the bomb's own detonation credits the per-victim channel
        // (perTargetDealt['attacker'][BARE_ENEMY_ID], burst = 1000 damagePerStack × 2 stacks =
        // 2000) instead of the legacy scalar sink. The CLAIM under test — a single-enemy roster
        // has no adjacent same-side actor, so it can never splash — is unaffected by which
        // channel the burst itself lands in.
        expect(result.rounds[0].perTargetDealt?.['attacker']?.[BARE_ENEMY_ID]).toBe(2000);
        // The natural bomb-detonation on the enemy still fires (sanity — the harness is live)...
        expect(events.some((e) => e.type === 'bomb-detonated')).toBe(true);
        // ...but it NEVER produces a splash proc.
        expect(events.some((e) => e.type === 'reactive-damage-performed')).toBe(false);

        // DPS output (per-round damage/detonation figures) is byte-identical to the no-passive
        // baseline — the extra reactive ability is a complete no-op in this mode.
        const base = baseline();
        expect(result.rounds).toEqual(base.rounds);
    });
});
