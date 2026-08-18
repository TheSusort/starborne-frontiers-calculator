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

    it('REGRESSION: a NON-positional walked-team detonate still surfaces detonationDamage via the legacy aggregate path', () => {
        idc = 0;
        // No TARGETABLE enemy victims, so the dummy `enemy` sink is the only anchor. The walked-team
        // ally therefore falls back through selectTurnTarget onto the legacy dummy victim →
        // teamPositional is false → it stays on the legacy single-anchor path: the team turn
        // detonates the dummy `enemy` sink's seeded bomb (2 × 1000 = 2000) and the credit folds into
        // teamTurn.detonationDamage (legacy creditDamage → the aggregate teamDamage number). No
        // positional → the positional-only surfaces (perActorDetonation / perTargetDamage) stay
        // absent. This pins the legacy aggregate path byte-identical.
        //
        // SP-4b-2b: this used to say `enemyAttackers: undefined` and attribute the non-positional
        // routing partly to the missing PATTERN. Both premises are now wrong. `normalizeCombatRoster`
        // refuses an absent/empty roster outright, and it also FILLS the missing pattern
        // (DEFAULT_BASE_PATTERN), so the pattern conjunct of `teamPositional` can no longer be the
        // thing that is false. The surviving lever is the roster: `teamPositional` is keyed on
        // `resolvesPositionalVictim`, which keys on MAX hp — so a 0-max-HP "pressure source" roster
        // is placed but unhittable and the legacy path is reached through exactly the same gate as
        // before, with the same magnitudes. (MEASURED, not assumed: 2000 / 2100 below are unchanged
        // from the pre-branch `undefined` form.)
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
                        // position + target present but NO pattern → non-positional legacy path.
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
                    // Seed the dummy enemy sink's bomb (the legacy anchor target).
                    actors.find((a) => a.id === 'enemy')?.pendingBombs.push(bomb(1000, 2));
                },
            })
        );
        const round = result.rounds[0];
        // Legacy aggregate path: exactly ONE bomb-detonated (the single anchor = the dummy enemy),
        // crediting the team ally for 2000.
        const bombDet = events.filter((e) => e.type === 'bomb-detonated');
        expect(bombDet.length).toBe(1);
        expect(bombDet[0].actorId).toBe('team-det');
        expect(bombDet[0].damage).toBe(2000);
        // The aggregate teamDamage number (firing hit + detonation) reflects the legacy detonation:
        // firing direct 100 + detonation 2000 = 2100.
        expect(round.teamDamage).toBe(2100);
        // Non-positional → both positional-only surfaces stay absent (proves the positional branch is
        // non-vacuous: it is the ONLY path that populates perActorDetonation / perTargetDamage).
        expect(round.perActorDetonation).toBeUndefined();
        expect(round.perTargetDamage).toBeUndefined();
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
