/**
 * PR-B Task B2 — TIMED bomb / accumulator detonation per POSITIONED PLAYER (enemy → player).
 *
 * The SYMMETRIC mirror of perVictimTimedDetonation.integration.test.ts (PR2, player → enemy).
 * PR2 made a timed bomb/accumulator stored on a positioned ENEMY burst at the START of that
 * enemy's own turn against its own HP via `enemySink`. THIS suite wires the same for a positioned
 * PLAYER actor: a focus attacker OR a walked-team ally carrying ENEMY-seeded timed containers
 * bursts them on its OWN turn against its OWN HP via `playerSink`.
 *
 * Today `applyPositionedTimedBurst` (the shared closure extracted in B1) is called ONLY at the
 * enemy-attacker turn site. The focus-attacker and walked-team turn sites never burst their own
 * timed containers → a timed bomb stored on a positioned PLAYER actor NEVER fires.
 *
 * B2 adds the burst call (+ dead-after-burst guard) at the focus-attacker and walked-team sites.
 * The POSITIONAL cases (1–5) MUST FAIL today. The NON-positional regression pin (case 6) and the
 * isPositional-gate negative pin (case 7) MUST PASS today (they guard existing behaviour / prove
 * the gate is non-vacuous).
 *
 * Crit 0 keeps every credited value an exact integer.
 *
 * --- The accumulator caveat (read before case 2) ---
 * `processAccumulators` does, per run: `acc.accumulated += allPlayersDirect; acc.roundsRemaining
 * -= 1;` and on `roundsRemaining <= 0` bursts `acc.accumulated * (acc.pct/100)`. The closure's
 * `allPlayersDirect` = `[...roundDamage.values()].reduce((s,d)=>s+d.direct,0)` — the round-global
 * sum of all players' DIRECT damage credited so far this round. In POSITIONAL mode the focus
 * attacker's direct credit is SUPPRESSED (`engine.ts` — the `if (!positional)` guard skips
 * `creditDamage(actor.id,'direct',…)`; the firing hit lands per-victim via `roundPerTargetDamage`
 * instead), and the enemy victims have attack 0. So `allPlayersDirect` is 0 → a positional player
 * accumulator's `accumulated` grows by 0 → it bursts for exactly its PRE-SEEDED
 * `accumulated * pct/100`. We exploit that for clean integers (mirrors the PR2 enemy case).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { ShipSkills, Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor, PendingBomb, PendingAccumulator } from '../state';
import type { CombatStatBlock } from '../../../types/calculator';
import type { CombatEvent } from '../events';
import { createEventBus } from '../events';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pvpt${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// A small single-hit basic attack (multiplier 100%, 1 hit). attack is kept tiny so the firing hit
// touches every footprint victim WITHOUT killing the high-HP ones (and without obscuring the burst).
const basicAttack = (): Ability =>
    ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

// An active slot carrying only a basic attack — no skill-triggered detonate (B2 is about TIMED
// bursts on the player's own turn, NOT skill-triggered detonation on the focus cast).
const basicSlot = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [basicAttack()],
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// AoE pattern: origin + one covered cell one step toward back (Pattern-Line-Range-1).
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// A positioned, zero-offense, finite-HP enemy victim. speed 1 → it takes a turn each round. attack 0
// → it contributes 0 direct (keeps allPlayersDirect clean). Present so the PLAYER actors are
// positional against it (isPositional(playerActor.position, enemyAttackerActors) is true).
const enemyAt = (id: string, position: Position, hp: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots: [] } as ShipSkills,
    }) as EnemyAttacker;

// A pre-seeded TIMED bomb. burst = stacks × damagePerStack × affinityMult × (1 + detMod/100).
// With neutral mults: burst = stacks × damagePerStack. countdown drives the timed expiry.
const timedBomb = (
    damagePerStack: number,
    stacks: number,
    countdown: number,
    sourceId = 'enemy-applier'
): PendingBomb => ({
    countdown,
    damagePerStack,
    stacks,
    tier: 100,
    sourceId,
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
});

// A pre-seeded accumulator. On the run that drops roundsRemaining to <= 0 it bursts for
// (accumulated + Σ allPlayersDirect over its active runs) × pct/100. In positional mode
// allPlayersDirect is 0 (see header caveat) → burst = accumulated × pct/100.
const accumulator = (
    accumulated: number,
    pct: number,
    roundsRemaining: number,
    sourceId = 'enemy-applier'
): PendingAccumulator => ({ accumulated, pct, roundsRemaining, sourceId });

const FOCUS_ATTACK = 100; // tiny firing hit.

// Positional BASE: focus at M4 fires a Line-Range-1 basic attack at `front` (M4) covering M3, with
// positioned enemy victims present so the focus is positional. The focus has HUGE HP by default so
// its OWN timed burst does not kill it.
const POSITIONAL_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: FOCUS_ATTACK,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicSlot()] },
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
    hp: 1_000_000_000,
    healModifier: 0,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: lineRange1Pattern(),
    enemyAttackers: [
        enemyAt('enemy-front', 'M4', 1_000_000_000),
        enemyAt('enemy-mid', 'M3', 1_000_000_000),
    ],
    ...overrides,
});

// Non-positional BASE: a single focus dummy enemy, NO position/target/pattern/enemyAttackers — the
// legacy focus-dummy timed path. Timed containers are seeded on the focus dummy ('enemy').
const NONPOS_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: [],
    attack: FOCUS_ATTACK,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicSlot()] },
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
    hp: 1_000_000_000,
    healModifier: 0,
    ...overrides,
});

// A walked-team ally: a positioned, offensive player team actor (kind 'team') with its own board
// position/target/pattern + a basic-attack active slot. It takes a turn each round (speed 100).
const teamStats = (hp: number): CombatStatBlock => ({
    attack: FOCUS_ATTACK,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    defence: 0,
    hp,
    hacking: 0,
});

const teamAlly = (id: string, position: Position, hp: number): TeamActorEngineInput =>
    ({
        id,
        speed: 100, // acts each round
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parsedTarget('front'),
        pattern: lineRange1Pattern(),
        walk: {
            shipSkills: { slots: [basicSlot()] },
            stats: teamStats(hp),
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
            healModifier: 0,
        },
    }) as TeamActorEngineInput;

// Tap an ordered event log.
const collect = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const types: CombatEvent['type'][] = [
        'bomb-detonated',
        'dot-detonated',
        'ship-destroyed',
        'turn-started',
    ];
    for (const t of types) bus.on(t, (e) => events.push(e as CombatEvent));
    const result = runCombat({ ...input, bus });
    return { events, result };
};

describe('per-positioned-player timed detonation (PR-B B2, enemy → player)', () => {
    it('case 1: a TIMED bomb bursts on the positioned FOCUS attacker’s OWN turn against its OWN HP', () => {
        idc = 0;
        // The focus 'attacker' (HP 1e9, won't die) carries a 2 × 1000 timed bomb with countdown 2.
        // On its OWN turn the countdown decrements: round 1 → 1 (no burst), round 2 → 0 (BURST).
        // burst = 2 × 1000 × 1 × (1 + 0/100) = 2000. Lands on the focus's OWN HP via playerSink.
        const { events, result } = collect(
            POSITIONAL_BASE({
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'attacker')
                        ?.pendingBombs.push(timedBomb(1000, 2, 2, 'enemy-applier'));
                },
            })
        );

        // Round 1: bomb only decremented (countdown 2 → 1), no burst.
        const round1 = result.rounds[0];
        expect(round1.perTargetDamage?.['attacker']).toBeUndefined();
        expect(round1.perActorDetonation?.['enemy-applier']).toBeUndefined();

        // Round 2: countdown → 0 → burst 2000 lands on the focus's OWN HP via applyVictimDamage,
        // recorded into THIS round's perTargetDamage['attacker'] + perActorDetonation[applier].
        const round2 = result.rounds[1];
        expect(round2.perTargetDamage?.['attacker']).toBe(2000);
        // Credited to the applier ('enemy-applier'), NOT the victim.
        expect(round2.perActorDetonation?.['enemy-applier']).toBe(2000);

        // Exactly one bomb-detonated, in round 2, attributed to the applier, damage 2000.
        const bombDet = events.filter((e) => e.type === 'bomb-detonated');
        expect(bombDet.length).toBe(1);
        expect(bombDet[0]).toMatchObject({
            actorId: 'enemy-applier',
            round: 2,
            damage: 2000,
            stacks: 2,
        });
    });

    it('case 2: an ACCUMULATOR bursts for accumulated × pct/100 on the FOCUS turn, credited to its applier', () => {
        idc = 0;
        // The focus 'attacker' carries a pre-loaded accumulator: accumulated 5000, pct 50,
        // roundsRemaining 1. On its FIRST own turn (round 1) the burst fires at turn-start, BEFORE
        // the focus's firing hit. In positional mode the focus's direct credit is suppressed and the
        // enemy victims have attack 0, so allPlayersDirect = 0 at that moment → accumulated += 0 →
        // 5000, roundsRemaining → 0 → BURST = 5000 × 50/100 = 2500. Lands on the focus's OWN HP.
        const { result } = collect(
            POSITIONAL_BASE({
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'attacker')
                        ?.pendingAccumulators.push(accumulator(5000, 50, 1, 'enemy-applier'));
                },
            })
        );

        // Round 1: accumulator burst 2500 on the focus's own HP.
        const round1 = result.rounds[0];
        expect(round1.perTargetDamage?.['attacker']).toBe(2500);
        expect(round1.perActorDetonation?.['enemy-applier']).toBe(2500);
    });

    it('case 3: a TIMED bomb bursts on the positioned WALKED-TEAM ally’s OWN turn against its OWN HP', () => {
        idc = 0;
        // A walked-team ally 'team-ally' (positioned M3, HP 1e9) carries a 2 × 1000 timed bomb with
        // countdown 2. On its OWN turn the countdown decrements: round 1 → 1 (no burst), round 2 → 0
        // (BURST = 2000). Lands on the ally's OWN HP via playerSink.
        const { events, result } = collect(
            POSITIONAL_BASE({
                teamActors: [teamAlly('team-ally', 'M3', 1_000_000_000)],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'team-ally')
                        ?.pendingBombs.push(timedBomb(1000, 2, 2, 'enemy-applier'));
                },
            })
        );

        // Round 1: bomb only decremented.
        expect(result.rounds[0].perTargetDamage?.['team-ally']).toBeUndefined();
        // Round 2: burst 2000 on the ally's own HP.
        const round2 = result.rounds[1];
        expect(round2.perTargetDamage?.['team-ally']).toBe(2000);
        expect(round2.perActorDetonation?.['enemy-applier']).toBe(2000);

        const bombDet = events.filter((e) => e.type === 'bomb-detonated');
        expect(bombDet.length).toBe(1);
        expect(bombDet[0]).toMatchObject({
            actorId: 'enemy-applier',
            round: 2,
            damage: 2000,
            stacks: 2,
        });
    });

    it('case 4: a LETHAL self-burst kills the FOCUS attacker; the round still assembles; a leftover bomb splashes its ally', () => {
        idc = 0;
        // The focus 'attacker' (HP 1000) carries a LETHAL accumulator (accumulated 2000, pct 100,
        // 1 round → burst 2000 > 1000 HP) AND a LEFTOVER timed bomb (countdown 5, never reaches 0).
        // The accumulator burst does NOT touch pendingBombs, so the leftover bomb is intact when
        // recordDestroyed fires → bomb-splash-on-death chains to the adjacent PLAYER ally 'team-ally'
        // (at M3, adjacent to the focus at M4 but a walked-team actor that takes no firing damage from
        // its own basic attack against itself). leftover splash = 1 × 800 × (tier/4)/100 =
        // 800 × 25/100 = 200. The focus dying must still let the round assemble (synthesized focus
        // turn) without a throw.
        const leftover = timedBomb(800, 1, 5, 'attacker');
        const { events, result } = collect(
            POSITIONAL_BASE({
                hp: 1000,
                teamActors: [teamAlly('team-ally', 'M3', 1_000_000_000)],
                __testTapActors: (actors: CombatActor[]) => {
                    const focus = actors.find((a) => a.id === 'attacker');
                    focus?.pendingAccumulators.push(accumulator(2000, 100, 1, 'enemy-applier')); // lethal
                    focus?.pendingBombs.push(leftover); // NOT consumed by the accumulator burst
                },
            })
        );

        // The focus died this round (round 1 — accumulator bursts on its first own turn).
        const destroyed = events.filter((e) => e.type === 'ship-destroyed');
        expect(destroyed.some((e) => e.actorId === 'attacker')).toBe(true);

        // The round still assembled (no throw): result.rounds[0] exists with the focus burst recorded.
        const round1 = result.rounds[0];
        expect(round1).toBeDefined();
        expect(round1.perActorDetonation?.['enemy-applier']).toBe(2000);

        // Its leftover bomb splashed the adjacent PLAYER ally (bomb-splash-on-death chain → playerSink).
        expect(round1.perActorSplash?.['team-ally']).toBe(200);
    });

    it('case 5: a LETHAL self-burst kills the WALKED-TEAM ally; the round still assembles', () => {
        idc = 0;
        // The walked-team ally 'team-ally' (HP 1000) carries a LETHAL accumulator (2000, pct 100,
        // 1 round → 2000 > 1000). On its first own turn it bursts and dies. No focus synthesis needed
        // (a walked-team actor is never the focus). The round must still assemble.
        const { events, result } = collect(
            POSITIONAL_BASE({
                teamActors: [teamAlly('team-ally', 'M3', 1000)],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'team-ally')
                        ?.pendingAccumulators.push(accumulator(2000, 100, 1, 'enemy-applier'));
                },
            })
        );

        const destroyed = events.filter((e) => e.type === 'ship-destroyed');
        expect(destroyed.some((e) => e.actorId === 'team-ally')).toBe(true);

        const round1 = result.rounds[0];
        expect(round1).toBeDefined();
        expect(round1.perTargetDamage?.['team-ally']).toBe(2000);
        expect(round1.perActorDetonation?.['enemy-applier']).toBe(2000);

        // The dead ally does not act afterward: a positioned ally with attack 100 against the dummy
        // sink produces no SECOND turn-started after death. It died on its round-1 turn (turn-started
        // fired once before the burst) and must NOT take a round-2 turn.
        const allyTurns = events.filter(
            (e) => e.type === 'turn-started' && e.actorId === 'team-ally'
        );
        expect(allyTurns.length).toBe(1);
    });

    it('case 6: REGRESSION (non-positional) — a player-actor timed container is INERT at the player turn (legacy focus-dummy path unchanged)', () => {
        idc = 0;
        // PIN — MUST PASS today. No position/target/pattern/enemyAttackers → the focus is
        // non-positional. We tap the PLAYER focus 'attacker' with a timed bomb. Without the B2
        // burst (and even with it — it is gated on isPositional), the non-positional player turn does
        // NOT burst the focus's own container. We separately seed the focus DUMMY ('enemy') with a
        // bomb to confirm the legacy focus-dummy timed path is unchanged (bursts on the dummy's turn).
        const { events, result } = collect(
            NONPOS_BASE({
                __testTapActors: (actors: CombatActor[]) => {
                    // Player focus actor's own container — must NOT burst (no positional path).
                    actors
                        .find((a) => a.id === 'attacker')
                        ?.pendingBombs.push(timedBomb(1000, 7, 2, 'enemy-applier'));
                    // Legacy focus-dummy timed path: 3 × 1000 bomb on the dummy → bursts round 2.
                    actors
                        .find((a) => a.id === 'enemy')
                        ?.pendingBombs.push(timedBomb(1000, 3, 2, 'attacker'));
                },
            })
        );

        // The player focus actor's bomb did NOT burst via any positional path (no per-victim surface).
        for (const round of result.rounds) {
            expect(round.perTargetDamage?.['attacker']).toBeUndefined();
            expect(round.perActorDetonation?.['enemy-applier']).toBeUndefined();
        }

        // Legacy focus-dummy path unchanged: round 1 no burst, round 2 burst 3000 via detonationDamage.
        expect(result.rounds[0].detonationDamage).toBe(0);
        expect(result.rounds[1].detonationDamage).toBe(3000);

        // Exactly one bomb-detonated (the dummy's), in round 2, attributed to the applier, damage 3000.
        // The focus actor's 7 × 1000 bomb produced NO event.
        const bombDet = events.filter((e) => e.type === 'bomb-detonated');
        expect(bombDet.length).toBe(1);
        expect(bombDet[0]).toMatchObject({
            actorId: 'attacker',
            round: 2,
            damage: 3000,
            stacks: 3,
        });
    });

    it('E5 symmetry: the same timed bomb bursts for identical damage + event on the player side and the enemy side', () => {
        idc = 0;
        // The SAME timed bomb (2 × 1000, countdown 2) is placed on a positioned PLAYER actor in one
        // runCombat invocation and on a positioned ENEMY actor in a second invocation. Both burst on
        // round 2. Crit 0 → exact integers. The only difference between the two runs is WHICH SIDE
        // carries the bomb — everything else (board shape, countdown, params) is identical.
        //
        // Player side: bomb on 'attacker' (positioned at M4, HP 1e9). The focus actor receives no
        // firing damage via perTargetDamage (its OWN firing hit is not self-inflicted), so in round 2
        // perTargetDamage['attacker'] = 2000 (burst only).
        //
        // Enemy side: bomb on 'enemy-back' (positioned at M2, HP 1e9). M2 is OUTSIDE the Line-
        // Range-1 footprint anchored at M4 (which covers M4 and M3 only), so it receives no firing
        // damage. In round 2 perTargetDamage['enemy-back'] = 2000 (burst only).
        //
        // Both bomb-detonated events must carry identical stacks (2) and damage (2000).

        // --- PLAYER side ---
        const playerRun = collect(
            POSITIONAL_BASE({
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'attacker')
                        ?.pendingBombs.push(timedBomb(1000, 2, 2, 'enemy-applier'));
                },
            })
        );
        const playerBurst = playerRun.result.rounds[1].perTargetDamage?.['attacker'];
        const playerBombDet = playerRun.events.filter((e) => e.type === 'bomb-detonated');
        // Sanity: exactly one event, on round 2.
        expect(playerBombDet.length).toBe(1);
        expect(playerBombDet[0]).toMatchObject({ round: 2, stacks: 2, damage: 2000 });
        expect(playerBurst).toBe(2000);

        // --- ENEMY side ---
        // Use a third enemy actor at M2 (outside the firing footprint) so its perTargetDamage
        // in round 2 is pure burst with no firing-hit contamination — a clean mirror of the player.
        idc = 0;
        const enemyRun = collect(
            POSITIONAL_BASE({
                enemyAttackers: [
                    enemyAt('enemy-front', 'M4', 1_000_000_000),
                    enemyAt('enemy-mid', 'M3', 1_000_000_000),
                    enemyAt('enemy-back', 'M2', 1_000_000_000), // outside footprint → no firing hit
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'enemy-back')
                        ?.pendingBombs.push(timedBomb(1000, 2, 2, 'attacker'));
                },
            })
        );
        const enemyBurst = enemyRun.result.rounds[1].perTargetDamage?.['enemy-back'];
        const enemyBombDet = enemyRun.events.filter((e) => e.type === 'bomb-detonated');
        // Sanity: exactly one event, on round 2.
        expect(enemyBombDet.length).toBe(1);
        expect(enemyBombDet[0]).toMatchObject({ round: 2, stacks: 2, damage: 2000 });
        expect(enemyBurst).toBe(2000);

        // --- Cross-side equality assertion (the E5 symmetry pin) ---
        expect(playerBurst).toBe(enemyBurst);
        expect(playerBombDet[0].damage).toBe(enemyBombDet[0].damage);
        expect(playerBombDet[0].stacks).toBe(enemyBombDet[0].stacks);
    });

    it('case 7: GATE-NEGATIVE — a positioned player WITH a timed container but enemyAttackers EMPTY does NOT burst', () => {
        idc = 0;
        // GATE PIN — the `isPositional` half. The new per-positioned-player burst is gated on
        //   hasTimedContainers && isPositional(actor.position, opposingRoster)
        // where opposingRoster = enemyAttackerActors for a player actor. isPositional(pos, opposing)
        // = !!pos && opposing.some(a => a.position !== undefined). We make the SECOND conjunct false
        // while keeping everything else true:
        //   • The focus 'attacker' HAS a board position (M4) → first conjunct satisfied.
        //   • It DOES carry a timed bomb → hasTimedContainers true.
        //   • It DOES take its own turn every round.
        //   • The ONLY thing false: enemyAttackers is EMPTY → enemyAttackerActors has no positioned
        //     actor → isPositional false → the burst is suppressed.
        //
        // NON-VACUITY CHECK (performed during development): temporarily editing the closure's gate to
        // `if (!hasTimedContainers) return;` (dropping the isPositional conjunct) makes THIS case burst
        // 4000 and the assertions below fail. After confirming, the flip was REVERTED. So this pin is
        // genuinely gated on isPositional, not vacuous.
        const { events, result } = collect(
            POSITIONAL_BASE({
                enemyAttackers: [], // positioned focus, but NO positioned enemy → isPositional false
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'attacker')
                        ?.pendingBombs.push(timedBomb(1000, 4, 2, 'enemy-applier'));
                },
            })
        );

        // The focus actor took a turn each of the 2 rounds (reached the turn body / the gate).
        const focusTurns = events.filter(
            (e) => e.type === 'turn-started' && e.actorId === 'attacker'
        );
        expect(focusTurns.length).toBeGreaterThanOrEqual(2);

        // The timed bomb did NOT burst via the per-positioned path in EITHER round.
        for (const round of result.rounds) {
            expect(round.perTargetDamage?.['attacker']).toBeUndefined();
            expect(round.perActorDetonation?.['enemy-applier']).toBeUndefined();
        }

        // And NO bomb-detonated event fired at all.
        const bombDet = events.filter((e) => e.type === 'bomb-detonated');
        expect(bombDet.length).toBe(0);
    });
});
