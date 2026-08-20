/**
 * Per-victim skill-triggered detonation on the POSITIONAL apply path (WALKED-TEAM ally → enemy).
 *
 * The THIRD cast-site mirror of perVictimDetonation.integration.test.ts (focus player → enemy) and
 * perVictimEnemyDetonation.integration.test.ts (enemy → player). PR1 (#168) made the FOCUS attacker's
 * positional detonate skill land per footprint enemy victim; PR3 (#170) wired the SAME for an ENEMY
 * attacker. THIS suite wires the last remaining cast-site: a WALKED-TEAM ally (a non-focus player
 * actor with `kind: 'team'`, its own board position + parsed target + parsed pattern) firing a
 * positional AoE detonate skill at the enemy team. EACH enemy footprint victim HIT by the firing
 * damage (and still alive) detonates its OWN stored containers — bombs (full shield drain, no pen)
 * and inferno+corrosion (BYPASS shield, DoT semantics) — landing on that victim's own HP via
 * `applyVictimDamage`, routed through `enemySink` (player→enemy), emitting per-victim
 * `bomb-detonated` / `dot-detonated`, and surfacing on the per-round `perActorDetonation` tally
 * credited to the WALKED-TEAM ally.
 *
 * Before this task the walked-team positional path applied ONLY the firing hit per-victim and DROPPED
 * the detonation slice (it stayed on the legacy aggregate anchor credit because it had no per-victim
 * loop and `positional` was withheld from its turn args).
 *
 * SEEDING: containers cannot be applied per-footprint-victim via abilities, so each ENEMY victim's
 * `pendingBombs` / `corrosionEntries` / `infernoEntries` is pre-seeded directly through the
 * `__testTapActors` construction hook (the same approach the focus + enemy tests use). The walked-team
 * ally fires a Line-Range-1 AoE detonate skill at `front`, anchored at the front enemy (M4) covering
 * M3 — both are HIT by the firing damage.
 *
 * Crit 0 keeps every credited value an exact integer.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor, PendingBomb, ActiveDoTStack } from '../state';
import type { CombatStatBlock } from '../../../types/calculator';
import type { CombatEvent } from '../events';
import { createEventBus } from '../events';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pvwt${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// A small single-hit basic attack (multiplier 100%, 1 hit). attack is kept tiny so the FIRING hit
// touches every footprint victim (marking them "hit") WITHOUT killing the high-HP ones.
const basicAttack = (): Ability =>
    ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

const detonate = (dotType: 'bomb' | 'inferno' | 'corrosion', powerPct = 100): Ability =>
    ab({
        type: 'detonate-dot',
        target: 'enemy',
        config: { type: 'detonate-dot', dotType, powerPct },
    });

// An active slot: a basic attack (so the firing hit lands per-victim) plus the requested detonate
// abilities (which the engine turns into the per-victim detonation recipe in positional mode).
const detonateSlot = (...dets: Ability[]): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [basicAttack(), ...dets],
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// AoE pattern: origin + one covered cell one step toward back (Pattern-Line-Range-1). Anchored at
// the FRONT enemy (M4) it covers M3 — both are HIT by the firing damage.
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

const TEAM_ATTACK = 100; // tiny firing hit — marks victims hit without killing high-HP ones.

// A positioned, zero-offense, finite-HP enemy victim (a stationary, damageable target).
type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
const enemyAt = (id: string, position: Position, hp: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots: [] } as ShipSkills,
    }) as EnemyAttacker;

// The detonating WALKED-TEAM ally: a positioned, offensive player team actor (kind 'team') whose
// active slot is a basic attack + the requested detonate abilities. target/pattern on the team-actor
// input feed parsedTargetFor/parsedPatternFor → it takes the positional apply path.
const teamStats = (): CombatStatBlock => ({
    attack: TEAM_ATTACK,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    defence: 0,
    hp: 1_000_000_000,
    hacking: 0,
});

const teamDetonator = (id: string, position: Position, dets: Ability[]): TeamActorEngineInput =>
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
            shipSkills: { slots: [detonateSlot(...dets)] },
            stats: teamStats(),
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
            healModifier: 0,
        },
    }) as TeamActorEngineInput;

// A pre-seeded bomb with all multipliers neutral (bomb payout = stacks × damagePerStack × powerPct).
const bomb = (damagePerStack: number, stacks: number, sourceId = 'team-det'): PendingBomb => ({
    countdown: 5, // never decremented to 0 before detonation
    damagePerStack,
    stacks,
    tier: 100,
    sourceId,
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
});

// A pre-seeded corrosion entry. Detonation corrosion payout (powerPct 100, neutral mults) =
// stacks × (tier/100) × min(victimHp, 500_000) × remainingRounds.
const corrosion = (tier: number, stacks: number, remainingRounds: number): ActiveDoTStack => ({
    stacks,
    tier,
    remainingRounds,
    sourceId: 'team-det',
});

// The focus player attacker is zero-offense and parked OUT of the enemy footprint (M1, isolated):
// it fires nothing meaningful (empty active slot) so the only damage source is the WALKED-TEAM ally.
// The team detonator sits at M4 (origin of the Line-Range-1 anchored at the front enemy). The two
// enemy victims occupy the front column (M4) and the cell behind (M3): the M4-anchored Line-Range-1
// footprint covers BOTH.
const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    // Focus player attacker: zero-offense, empty slot, parked at M1 (out of the footprint). It is
    // the heal target. It deals no damage → the team ally is the only detonator.
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
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
    healModifier: 0,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M1',
    teamActors: [teamDetonator('team-det', 'M1', [detonate('bomb')])],
    enemyAttackers: [
        enemyAt('enemy-front', 'M4', 1_000_000_000),
        enemyAt('enemy-mid', 'M3', 1_000_000_000),
    ],
    ...overrides,
});

// Tap an ordered event log.
const collect = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const types: CombatEvent['type'][] = ['bomb-detonated', 'dot-detonated', 'ship-destroyed'];
    for (const t of types) bus.on(t, (e) => events.push(e as CombatEvent));
    const result = runCombat({ ...input, bus });
    return { events, result };
};

describe('per-victim skill-triggered detonation (positional WALKED-TEAM ally → enemy)', () => {
    it('BOTH the origin and the covered enemy victim detonate their OWN bombs (covered no longer ignored)', () => {
        idc = 0;
        // Each victim carries a 2 × 1000 bomb → detonates for 2000 (powerPct 100, neutral mults).
        const { events, result } = collect(
            BASE({
                __testTapActors: (actors: CombatActor[]) => {
                    actors.find((a) => a.id === 'enemy-front')?.pendingBombs.push(bomb(1000, 2));
                    actors.find((a) => a.id === 'enemy-mid')?.pendingBombs.push(bomb(1000, 2));
                },
            })
        );
        const round = result.rounds[0];
        // Per-target damage = firing hit (origin full 100 / covered half 50) + detonation 2000 each.
        expect(round.perTargetDamage?.['enemy-front']).toBe(100 + 2000);
        expect(round.perTargetDamage?.['enemy-mid']).toBe(50 + 2000);
        // The per-round detonation tally credits the WALKED-TEAM ally the SUM across both victims.
        expect(round.perActorDetonation?.['team-det']).toBe(4000);
        // bomb-detonated emitted per victim (one per bomb-carrying victim hit), crediting the ally.
        const bombDet = events.filter((e) => e.type === 'bomb-detonated');
        expect(bombDet.length).toBe(2);
        for (const e of bombDet) {
            expect(e.actorId).toBe('team-det');
            expect(e.damage).toBe(2000);
        }
    });

    it("corrosion detonation uses the VICTIM's own HP for min(hp, 500k)", () => {
        idc = 0;
        // Only the covered victim (enemy-mid, HP 300_000) carries corrosion: tier 100, 1 stack,
        // remainingRounds 1 → payout = 1 × (100/100) × min(300_000, 500_000) × 1 = 300_000.
        const { result } = collect(
            BASE({
                teamActors: [teamDetonator('team-det', 'M1', [detonate('corrosion')])],
                enemyAttackers: [
                    enemyAt('enemy-front', 'M4', 1_000_000_000),
                    enemyAt('enemy-mid', 'M3', 300_000),
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'enemy-mid')
                        ?.corrosionEntries.push(corrosion(100, 1, 1));
                },
            })
        );
        const round = result.rounds[0];
        // covered victim: firing hit 50 (half of 100) + corrosion detonation 300_000 (bypass).
        expect(round.perTargetDamage?.['enemy-mid']).toBe(50 + 300_000);
        expect(round.perActorDetonation?.['team-det']).toBe(300_000);
    });

    it('an enemy victim whose detonation exceeds its HP DIES; a leftover bomb then splashes its ally', () => {
        idc = 0;
        // Covered victim enemy-mid (HP 1000) carries BOTH a corrosion entry (detonated this cast —
        // tier 100, 1 stack, 1 round, hp-capped 1000 → 1000 damage, lethal) AND a leftover bomb the
        // CORROSION-typed detonate does NOT consume. The detonate skill detonates ONLY corrosion, so
        // the bomb survives → enemy-mid dies from the corrosion detonation while still carrying the
        // bomb → bomb-splash-on-death fires to its adjacent ally (enemy-back at M2, a hex-neighbour of
        // M3 but OUTSIDE the M4-anchored Line-Range-1 footprint → it took no firing/detonation damage,
        // isolating the splash). enemy-front (origin, huge HP) just detonates nothing extra.
        const leftover = bomb(800, 1, 'enemy-mid'); // splash = 1 × 800 × (100/4)/100 = 200
        const { events, result } = collect(
            BASE({
                teamActors: [teamDetonator('team-det', 'M1', [detonate('corrosion')])],
                enemyAttackers: [
                    enemyAt('enemy-front', 'M4', 1_000_000_000),
                    enemyAt('enemy-mid', 'M3', 1000),
                    enemyAt('enemy-back', 'M2', 1_000_000_000), // adjacent to M3, outside footprint
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    const mid = actors.find((a) => a.id === 'enemy-mid');
                    mid?.corrosionEntries.push(corrosion(100, 1, 1)); // 1000 → lethal
                    mid?.pendingBombs.push(leftover); // NOT consumed by the corrosion detonate
                },
            })
        );
        const round = result.rounds[0];
        // enemy-mid died this round.
        const destroyed = events.filter((e) => e.type === 'ship-destroyed');
        expect(destroyed.some((e) => e.actorId === 'enemy-mid')).toBe(true);
        // Its leftover bomb splashed the adjacent ally (bomb-splash-on-death chain).
        expect(round.perActorSplash?.['enemy-back']).toBe(200);
    });

    it("dot-detonated emits per victim carrying that victim's id (inferno bypass)", () => {
        idc = 0;
        // enemy-mid carries an inferno entry; the detonate skill detonates inferno. Inferno payout =
        // stacks × (tier/100) × effectiveAttack × remainingRounds × dotMult × affinityMult × pct ×
        // detonationMult. With dotMult/affinityMult/detonationMult = 1, effectiveAttack = the team
        // ally's attack 100: 1 × (100/100) × 100 × 1 = 100.
        const { events, result } = collect(
            BASE({
                teamActors: [teamDetonator('team-det', 'M1', [detonate('inferno')])],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'enemy-mid')
                        ?.infernoEntries.push({
                            stacks: 1,
                            tier: 100,
                            remainingRounds: 1,
                            sourceId: 'team-det',
                        });
                },
            })
        );
        const round = result.rounds[0];
        const dotDet = events.filter((e) => e.type === 'dot-detonated');
        // Exactly one dot-detonated, carrying the covered victim's id.
        expect(dotDet.length).toBe(1);
        expect(dotDet[0].targetId).toBe('enemy-mid');
        expect(dotDet[0].damage).toBe(100);
        // Covered victim took firing 50 + inferno bypass 100.
        expect(round.perTargetDamage?.['enemy-mid']).toBe(50 + 100);
        expect(round.perActorDetonation?.['team-det']).toBe(100);
    });

    it('the former 0-max-HP pressure source is now FLOORED, so the walked-team detonate resolves per-victim, not through the legacy aggregate path', () => {
        idc = 0;
        // SP-4b-2b history: this used to say `enemyAttackers: undefined` and attribute the
        // non-positional routing partly to the missing PATTERN; `normalizeCombatRoster` closed
        // that by refusing an absent/empty roster and FILLING the missing pattern
        // (DEFAULT_BASE_PATTERN). The surviving lever was the roster: `teamPositional` is keyed
        // on `resolvesPositionalVictim`, which keys on MAX hp, so a 0-max-HP "pressure source"
        // roster was placed but unhittable and the legacy dummy path stayed reachable through
        // that gate.
        //
        // SP-4c-2a closes THAT gate too: the targetable-HP floor (normalizeRoster.ts,
        // MIN_TARGETABLE_MAX_HP) raises the same 0-max-HP enemy to 1,000,000 HP, so it IS
        // targetable and `teamPositional` is now true — the team ally's detonate resolves onto
        // this real, hittable enemy PER-VICTIM instead of falling back to a legacy anchor. The
        // tap moves onto the real enemy's id ('pressure-source'); the legacy 'enemy' dummy sink
        // still exists (engine.ts still creates it unconditionally) but is inert on a positional
        // run — dropped from the turn order and never credited — so it is never consulted here.
        // Its deletion is rung 4c-2d's job.
        //
        // ⚠️ DISCOVERED ASYMMETRY (not fixed here — engine.ts is out of scope for this task, and
        // this is pre-existing behaviour the floor merely makes reachable for the first time).
        // The round-row scalar `teamDamage` (engine.ts's `teamRoundDamage`) sums each non-focus
        // actor's OWN accumulator (`direct + corrosion + inferno + detonation + generic`), but
        // UNLIKE the focus's `detonationDamage` field — which explicitly folds
        // `perActorDetonation.get(focusActorId)` on top of `focus.detonation` — nothing folds a
        // walked team actor's positional detonation credit into `teamRoundDamage`. Confirmed by
        // standalone repro against the real engine: `teamDamage` reads 0 even though
        // `perActorDetonation['team-det']` correctly reads 2000 and `perTargetDamage` correctly
        // reads 2100. Worth a follow-up ticket for team-symmetric detonation display; not this
        // task's to fix.
        const { events, result } = collect(
            BASE({
                enemyAttackers: [enemyAt('pressure-source', 'M4', 0)],
                teamActors: [
                    {
                        id: 'team-det',
                        speed: 100,
                        chargeCount: 0,
                        startCharged: false,
                        selfBuffs: [],
                        enemyDebuffs: [],
                        position: 'M1',
                        target: parsedTarget('front'),
                        walk: {
                            shipSkills: { slots: [detonateSlot(detonate('bomb'))] },
                            stats: teamStats(),
                            selfDotModifier: 0,
                            defensePenetrationBuff: 0,
                            affinityDamageModifier: 0,
                            affinityCritCap: 100,
                            affinityCritPenalty: 0,
                            hasChargedSkill: false,
                            healModifier: 0,
                        },
                    } as TeamActorEngineInput,
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    // The floored enemy is real now — tap ITS id, not the legacy dummy.
                    actors
                        .find((a) => a.id === 'pressure-source')
                        ?.pendingBombs.push(bomb(1000, 2));
                },
            })
        );
        const round = result.rounds[0];
        // Positional surfaces populated: firing hit 100 + detonation burst 2000 on the real victim,
        // credited to the walked-team ally.
        expect(round.perTargetDamage?.['pressure-source']).toBe(2100);
        expect(round.perActorDetonation?.['team-det']).toBe(2000);
        // The legacy aggregate scalar does NOT fold the positional detonation credit for a walked
        // team actor — see the DISCOVERED ASYMMETRY note above.
        expect(round.teamDamage).toBe(0);

        // Exactly ONE bomb-detonated (the real enemy's own bomb), crediting the team ally 2000.
        const bombDet = events.filter((e) => e.type === 'bomb-detonated');
        expect(bombDet.length).toBe(1);
        expect(bombDet[0].actorId).toBe('team-det');
        expect(bombDet[0].damage).toBe(2000);
    });

    // SP-4b: 'GATE-NEGATIVE: a walked-team detonate with a target but NO pattern stays on the
    // legacy single-anchor path' lived here. Its whole subject was the PATTERN conjunct of
    // `teamPositional` — a walked ally with a target and no pattern falling through to the legacy
    // single-anchor detonate, with the positional-only surfaces (perActorDetonation /
    // perTargetDamage) staying absent behind it. `normalizeCombatRoster` synthesizes
    // DEFAULT_BASE_PATTERN for every actor that lacks one, so the pattern-less branch cannot be
    // reached through `runCombat` any more, and that branch is the legacy single-anchor sink SP-4c
    // deletes. Removed rather than bypassed — a below-boundary hook would pin code scheduled for
    // deletion. The per-victim footprint behaviour it guarded (origin + covered each detonate
    // their OWN bomb, nothing outside the footprint) is asserted positively above.
});
