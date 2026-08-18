/**
 * PR2 — TIMED bomb / accumulator detonation per POSITIONED enemy (player → enemy).
 *
 * Today `processBombs` / `processAccumulators` (`engine.ts:700` / `:727`) run ONLY on the focus
 * dummy enemy's turn (`actor.kind === 'enemy' && actor.id === enemy.id`, `engine.ts:4794`) against
 * the focus dummy's OWN containers. In positional mode the real enemy victims are the
 * `enemyAttackerActors` — each its own turn-taking actor with its own per-actor containers — and
 * their turn body (the `else if (actor.kind === 'enemy')` branch, `engine.ts:4851`) never bursts
 * their own timed containers. So a timed bomb stored on a positioned enemy NEVER fires.
 *
 * PR2 (NOT yet implemented — Task 3) adds a per-positioned-enemy timed-burst step at the START of
 * the enemy-attacker turn body: it bursts `actor`'s OWN containers, routing each burst through
 * `applyVictimDamage(damage, actor, enemySink, <flags>)`, recording into
 * `roundPerTargetDamage[actor.id]` + the per-round `perActorDetonation[applier]` tally, emitting a
 * per-victim `bomb-detonated`, and skipping the action body when the burst kills the enemy.
 *
 * THIS suite pins that behaviour. The POSITIONAL cases (1–3) MUST FAIL today (timed bursts on
 * positioned enemies do not fire). The NON-positional regression pin (case 4) MUST PASS today —
 * it guards that PR2 does not disturb the existing `:4794` focus-dummy timed path.
 *
 * Crit 0 keeps every credited value an exact integer.
 *
 * --- The accumulator gather (read before case 2) ---
 * `processAccumulators` does, per run: `acc.accumulated += gatheredDirect; acc.roundsRemaining
 * -= 1;` and on `roundsRemaining <= 0` bursts `acc.accumulated * (acc.pct/100)`. `gatheredDirect`
 * is the DIRECT damage the ACCUMULATING side (here the players) has dealt so far this round.
 *
 * WAS A DEFECT, FIXED BY SP-4b-2 D1. This header used to read: "in POSITIONAL mode the focus
 * attacker's direct credit is SUPPRESSED … So `allPlayersDirect` is 0 every round → a positional
 * accumulator's `accumulated` grows by 0 → it bursts for exactly its PRE-SEEDED `accumulated *
 * pct/100`. We exploit that for clean integers." The suppression is real, but reading the
 * suppressed channel and calling the resulting 0 a convenience was the defect: EVERY positional
 * accumulate-detonate (the Echoing Burst gear-set family) detonated for zero in production. The
 * gather now reads the positional channel too, so the pre-seeded total grows by this round's real
 * player direct damage — for this fixture, the focus's Line-Range-1 firing hit: 100 on the M4
 * origin + 50 on the M3 covered cell = 150 per round, landing before enemy-mid's own turn.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { ShipSkills, Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor, PendingBomb, PendingAccumulator } from '../state';
import type { CombatEvent } from '../events';
import { createEventBus } from '../events';
import { bareEnemy } from '../__testutils__/bareRosterFixture';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pvt${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// A small single-hit basic attack (multiplier 100%, 1 hit). attack is kept tiny so the firing hit
// touches every footprint victim WITHOUT killing the high-HP ones (and without obscuring the burst).
const basicAttack = (): Ability =>
    ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

// An active slot carrying only a basic attack — no skill-triggered detonate (PR2 is about TIMED
// bursts on the enemy's own turn, NOT skill-triggered detonation on the focus cast).
const basicSlot = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [basicAttack()],
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// AoE pattern: origin + one covered cell one step toward back (Pattern-Line-Range-1). Anchored at
// the FRONT enemy (M4) it covers M3 — both are HIT by the firing damage (origin 100, covered 50).
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// A positioned, zero-offense, finite-HP enemy victim. speed 1 → it takes a turn each round (so its
// OWN-turn timed burst can fire). attack 0 → it contributes 0 direct (keeps allPlayersDirect clean).
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
    sourceId = 'attacker'
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
// (accumulated + Σ gatheredDirect over its active runs) × pct/100 — see the header note: since
// SP-4b-2 D1 `gatheredDirect` is the real player direct damage of the round (150 here), not 0.
const accumulator = (
    accumulated: number,
    pct: number,
    roundsRemaining: number,
    sourceId = 'attacker'
): PendingAccumulator => ({ accumulated, pct, roundsRemaining, sourceId });

const FOCUS_ATTACK = 100; // tiny firing hit — marks victims hit without killing high-HP ones.

// Positional BASE: focus at M4 fires a Line-Range-1 basic attack at `front` (M4) covering M3.
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
// legacy `:4794` focus-dummy timed path. Timed containers are seeded on the focus dummy ('enemy').
const NONPOS_BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    // SP-4b-2b: a run needs an opponent, and merely omitting `target`/`pattern` does NOT keep one
    // non-positional (`normalizeCombatRoster`'s `withTargeting` fills both). The remaining
    // non-positional shape is the documented 0-MAX-HP "pressure source": `resolvesPositionalVictim`
    // finds nobody targetable (positionalBinding.ts:60-70), so the cast stays on the legacy dummy
    // sink and every number in the cases below is byte-identical to the pre-branch run. The id is
    // deliberately distinct from the shared fixture's default so it cannot be confused with a
    // positioned carrier elsewhere in this file. (SP-4c must revisit these cases with the dummy.)
    enemyAttackers: bareEnemy({ id: 'pressure-source', stats: { hp: 0 } }),
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

// Tap an ordered event log (mirrors the PR1 integration test).
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

describe('per-positioned-enemy timed detonation (PR2, player → enemy)', () => {
    it('a TIMED bomb bursts on the positioned enemy’s OWN turn against its OWN HP', () => {
        idc = 0;
        // enemy-mid (HP 1e9, won't die) carries a 2 × 1000 timed bomb with countdown 2. On its
        // OWN turn the countdown decrements: round 1 → 1 (no burst), round 2 → 0 (BURST).
        // burst = 2 × 1000 × 1 × (1 + 0/100) = 2000.
        const { events, result } = collect(
            POSITIONAL_BASE({
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'enemy-mid')
                        ?.pendingBombs.push(timedBomb(1000, 2, 2, 'attacker'));
                },
            })
        );

        // Round 1: bomb only decremented (countdown 2 → 1), no burst. enemy-mid took ONLY the
        // round-1 firing hit (covered = 50, half of 100). No detonation tally this round.
        const round1 = result.rounds[0];
        expect(round1.perTargetDamage?.['enemy-mid']).toBe(50);
        expect(round1.perActorDetonation?.['enemy-mid']).toBeUndefined();
        expect(round1.perActorDetonation?.['attacker']).toBeUndefined();

        // Round 2: countdown → 0 → burst 2000 lands on enemy-mid's OWN HP via applyVictimDamage,
        // recorded into THIS round's perTargetDamage['enemy-mid'] alongside the round-2 firing hit 50.
        const round2 = result.rounds[1];
        expect(round2.perTargetDamage?.['enemy-mid']).toBe(50 + 2000);
        // Credited to the applier ('attacker'), NOT the victim, NOT the focus dummy.
        expect(round2.perActorDetonation?.['attacker']).toBe(2000);
        // The burst must NOT be folded into the focus dummy ('enemy') — it landed per-victim.
        expect(round2.perTargetDamage?.['enemy']).toBeUndefined();
        expect(round2.perActorDetonation?.['enemy']).toBeUndefined();

        // Exactly one bomb-detonated, in round 2, attributed to the applier, damage 2000.
        const bombDet = events.filter((e) => e.type === 'bomb-detonated');
        expect(bombDet.length).toBe(1);
        expect(bombDet[0]).toMatchObject({
            actorId: 'attacker',
            round: 2,
            damage: 2000,
            stacks: 2,
        });
    });

    it('an ACCUMULATOR bursts for accumulated × pct/100 on expiry, credited to its applier', () => {
        idc = 0;
        // enemy-mid carries a pre-loaded accumulator: accumulated 5000, pct 50, roundsRemaining 1.
        // On its FIRST own turn (round 1): accumulated += gatheredDirect → 5000 + 150,
        // roundsRemaining → 0 → BURST = 5150 × 50/100 = 2575. Lands on enemy-mid's OWN HP.
        // SP-4b-2 D1: the 150 is the focus's own firing hit THIS round (origin 100 on enemy-front
        // + covered 50 on enemy-mid), which lands before enemy-mid takes its turn. Before D1 this
        // read 0 and the burst was 2500 — the gather was structurally empty on any positional run.
        const { result } = collect(
            POSITIONAL_BASE({
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'enemy-mid')
                        ?.pendingAccumulators.push(accumulator(5000, 50, 1, 'attacker'));
                },
            })
        );

        // Round 1: firing hit 50 (covered) + accumulator burst 2575 on enemy-mid's own HP.
        const round1 = result.rounds[0];
        const gathered = 100 + 50; // this round's player direct: origin + covered footprint cells
        const burst = (5000 + gathered) * (50 / 100);
        expect(burst).toBe(2575); // derivation, not a copied output
        expect(round1.perTargetDamage?.['enemy-mid']).toBe(50 + burst);
        // Credited to the applier ('attacker'), landing on enemy-mid, NOT the focus dummy.
        expect(round1.perActorDetonation?.['attacker']).toBe(burst);
        expect(round1.perTargetDamage?.['enemy']).toBeUndefined();
        expect(round1.perActorDetonation?.['enemy']).toBeUndefined();
    });

    it('a LETHAL timed burst kills the positioned enemy; a leftover bomb splashes its ally; the dead enemy does not act', () => {
        idc = 0;
        // enemy-mid (HP 1000) carries a LETHAL accumulator (accumulated 2000, pct 100, 1 round →
        // burst 2000 > 1000 HP) AND a LEFTOVER timed bomb (countdown 5, never reaches 0 in 2 rounds).
        // The accumulator burst does NOT touch pendingBombs, so the leftover bomb is intact when
        // recordDestroyed fires → bomb-splash-on-death chains to the adjacent ally enemy-back (M2,
        // a neighbour of M3 but OUTSIDE the M4-anchored Line-Range-1 footprint → it took no firing
        // damage, isolating the splash). leftover splash = 1 × 800 × (tier/4)/100 = 800 × 25/100 = 200.
        const leftover = timedBomb(800, 1, 5, 'enemy-mid');
        const { events, result } = collect(
            POSITIONAL_BASE({
                enemyAttackers: [
                    enemyAt('enemy-front', 'M4', 1_000_000_000),
                    enemyAt('enemy-mid', 'M3', 1000),
                    enemyAt('enemy-back', 'M2', 1_000_000_000), // adjacent to M3, outside footprint
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    const mid = actors.find((a) => a.id === 'enemy-mid');
                    mid?.pendingAccumulators.push(accumulator(2000, 100, 1, 'attacker')); // 2000 lethal
                    mid?.pendingBombs.push(leftover); // NOT consumed by the accumulator burst
                },
            })
        );

        // enemy-mid died this round (round 1 — accumulator bursts on its first own turn).
        const destroyed = events.filter((e) => e.type === 'ship-destroyed');
        expect(destroyed.some((e) => e.actorId === 'enemy-mid')).toBe(true);

        // Its leftover bomb splashed the adjacent ally (bomb-splash-on-death chain).
        const round1 = result.rounds[0];
        expect(round1.perActorSplash?.['enemy-back']).toBe(200);

        // The dead enemy does not act afterward: a positioned enemy with attack 0 has no observable
        // attack, so we assert it produced no SECOND turn-started after death. It died on its round-1
        // turn (turn-started fired once for it before the burst), and must NOT take a round-2 turn.
        const midTurns = events.filter(
            (e) => e.type === 'turn-started' && e.actorId === 'enemy-mid'
        );
        expect(midTurns.length).toBe(1);
    });

    it('REGRESSION (non-positional): a timed bomb on the focus dummy bursts EXACTLY as today', () => {
        idc = 0;
        // No position/target/pattern/enemyAttackers → the legacy `:4794` focus-dummy timed path.
        // Seed a 3 × 1000 timed bomb (countdown 2) on the focus dummy ('enemy'). On the dummy's
        // OWN turn the countdown decrements: round 1 → 1 (no burst), round 2 → 0 (BURST = 3000).
        // This is the existing behaviour PR2 must NOT disturb — it should PASS now.
        const { events, result } = collect(
            NONPOS_BASE({
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'enemy')
                        ?.pendingBombs.push(timedBomb(1000, 3, 2, 'attacker'));
                },
            })
        );

        // Round 1: bomb decremented only, detonationDamage 0.
        expect(result.rounds[0].detonationDamage).toBe(0);
        // Round 2: burst 3000 surfaced via the focus dummy's detonation channel (RoundData field).
        expect(result.rounds[1].detonationDamage).toBe(3000);

        // Exactly one bomb-detonated, in round 2, attributed to the applier, damage 3000.
        const bombDet = events.filter((e) => e.type === 'bomb-detonated');
        expect(bombDet.length).toBe(1);
        expect(bombDet[0]).toMatchObject({
            actorId: 'attacker',
            round: 2,
            damage: 3000,
            stacks: 3,
        });
    });

    // SP-4b: 'a NON-positional enemy attacker with a timed bomb does NOT burst via the
    // per-positioned-enemy path' lived here. It was a pure GATE PIN on the second conjunct of
    // `enemyHasTimedContainers && isPositional(actor.position, allPlayerActors)` — it forced
    // `allPlayerActors.some(a => a.position !== undefined)` false by leaving the focus unplaced.
    // `normalizeCombatRoster` places every actor on `runCombat`'s first line, so that conjunct is
    // now unconditionally true and the state it pinned is unreachable through the public entry
    // point. The gate is legacy/non-positional-world machinery that SP-4c deletes with the dummy,
    // so the pin was removed rather than kept alive under a bypass. The positive burst path is
    // still covered by 'a TIMED bomb bursts on the positioned enemy's OWN turn against its OWN HP'
    // above, which is what makes those assertions non-vacuous.
});
