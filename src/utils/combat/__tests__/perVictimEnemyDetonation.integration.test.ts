/**
 * Per-victim skill-triggered detonation on the POSITIONAL apply path (ENEMY → player).
 *
 * The mirror of perVictimDetonation.integration.test.ts (player → enemy). PR1 (#168) made the
 * PLAYER focus attacker's positional detonate skill land per footprint enemy victim. PR3 wires the
 * SAME behaviour for an ENEMY attacker: when a positioned enemy fires a positional AoE detonate
 * skill at the player team, EACH player footprint victim HIT by the firing damage (and still alive)
 * detonates its OWN stored containers — bombs (full shield drain, no pen) and inferno+corrosion
 * (BYPASS shield, DoT semantics) — landing on that victim's own HP via `applyVictimDamage`, routed
 * through `playerSink`, emitting per-victim `bomb-detonated` / `dot-detonated`, and surfacing on the
 * per-round `perActorDetonation` tally credited to the ENEMY attacker.
 *
 * Before PR3 the enemy positional path applied ONLY the firing hit per-victim and DROPPED the
 * detonation slice (the resolved E5 §4.3 "DETONATION CAVEAT" in the enemy positional apply path).
 *
 * SEEDING: containers cannot be applied per-footprint-victim via abilities, so each PLAYER victim's
 * `pendingBombs` / `corrosionEntries` / `infernoEntries` is pre-seeded directly through the
 * `__testTapActors` construction hook (the same approach the player→enemy test uses). The enemy
 * fires a Line-Range-1 AoE detonate skill at `front`, anchored at the front player covering the one
 * behind it — both are HIT by the firing damage.
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
    id: `pved${++idc}`,
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
// the FRONT player it covers the cell behind — both are HIT by the firing damage.
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

const ENEMY_ATTACK = 100; // tiny firing hit — marks victims hit without killing high-HP ones.

// A neutral combat stat block for a positioned, zero-offense PLAYER team victim. crit 0 keeps
// every credited value an exact integer; finite hp makes the victim damageable/killable.
const victimStats = (hp: number): CombatStatBlock => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    shieldPenetration: 0,
    defence: 0,
    hp,
    hacking: 0,
});

// A positioned, zero-offense PLAYER team victim (walked so it has real stats/position). Its active
// slot is empty → its own turn deals nothing (it is purely a damageable target).
const playerVictim = (id: string, position: Position, hp: number): TeamActorEngineInput =>
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
            stats: victimStats(hp),
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
            healModifier: 0,
        },
    }) as TeamActorEngineInput;

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// A positioned ENEMY attacker that fires a positional AoE detonate skill at the player team.
const enemyDetonator = (id: string, position: Position, dets: Ability[]): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: ENEMY_ATTACK,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000,
            speed: 100,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: lineRange1Pattern(),
        shipSkills: { slots: [detonateSlot(...dets)] },
    }) as EnemyAttacker;

// A pre-seeded bomb with all multipliers neutral (bomb payout = stacks × damagePerStack × powerPct).
const bomb = (damagePerStack: number, stacks: number, sourceId = 'enemy-det'): PendingBomb => ({
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
    sourceId: 'enemy-det',
});

// The two player victims occupy the front column (M4) and the cell behind (M3): the M4-anchored
// Line-Range-1 footprint covers BOTH. The focus attacker (id 'attacker') is the heal target and
// sits OUT of the footprint (M1, an isolated cell) so it is never hit — keeping the focus dummy
// enemy HP and the focus player both inert. front = id 'pl-front' at M4; covered = 'pl-mid' at M3.
const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    // Focus player attacker: zero-offense, parked OUT of the enemy footprint (M1). It is the heal
    // target (enemyAttackers require one). It fires nothing meaningful (empty active slot below).
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
    teamActors: [
        playerVictim('pl-front', 'M4', 1_000_000_000),
        playerVictim('pl-mid', 'M3', 1_000_000_000),
    ],
    enemyAttackers: [enemyDetonator('enemy-det', 'M4', [detonate('bomb')])],
    ...overrides,
});

// Tap an ordered event log (mirrors the player→enemy test).
const collect = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const types: CombatEvent['type'][] = ['bomb-detonated', 'dot-detonated', 'ship-destroyed'];
    for (const t of types) bus.on(t, (e) => events.push(e as CombatEvent));
    const result = runCombat({ ...input, bus });
    return { events, result };
};

describe('per-victim skill-triggered detonation (positional ENEMY → player)', () => {
    it('BOTH the origin and the covered PLAYER victim detonate their OWN bombs (covered no longer ignored)', () => {
        idc = 0;
        // Each victim carries a 2 × 1000 bomb → detonates for 2000 (powerPct 100, neutral mults).
        const { events, result } = collect(
            BASE({
                __testTapActors: (actors: CombatActor[]) => {
                    actors.find((a) => a.id === 'pl-front')?.pendingBombs.push(bomb(1000, 2));
                    actors.find((a) => a.id === 'pl-mid')?.pendingBombs.push(bomb(1000, 2));
                },
            })
        );
        const round = result.rounds[0];
        // Per-target damage = firing hit (origin full 100 / covered half 50) + detonation 2000 each.
        expect(round.perTargetDamage?.['pl-front']).toBe(100 + 2000);
        expect(round.perTargetDamage?.['pl-mid']).toBe(50 + 2000);
        // The per-round detonation tally credits the ENEMY attacker the SUM across both victims.
        expect(round.perActorDetonation?.['enemy-det']).toBe(4000);
        // bomb-detonated emitted per victim (one per bomb-carrying victim hit), crediting the enemy.
        const bombDet = events.filter((e) => e.type === 'bomb-detonated');
        expect(bombDet.length).toBe(2);
        for (const e of bombDet) {
            expect(e.actorId).toBe('enemy-det');
            expect(e.damage).toBe(2000);
        }
    });

    it("corrosion detonation uses the VICTIM's own HP for min(hp, 500k)", () => {
        idc = 0;
        // Only the covered victim (pl-mid, HP 300_000) carries corrosion: tier 100, 1 stack,
        // remainingRounds 1 → payout = 1 × (100/100) × min(300_000, 500_000) × 1 = 300_000.
        const { result } = collect(
            BASE({
                enemyAttackers: [enemyDetonator('enemy-det', 'M4', [detonate('corrosion')])],
                teamActors: [
                    playerVictim('pl-front', 'M4', 1_000_000_000),
                    playerVictim('pl-mid', 'M3', 300_000),
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'pl-mid')
                        ?.corrosionEntries.push(corrosion(100, 1, 1));
                },
            })
        );
        const round = result.rounds[0];
        // covered victim: firing hit 50 (half of 100) + corrosion detonation 300_000 (bypass).
        expect(round.perTargetDamage?.['pl-mid']).toBe(50 + 300_000);
        expect(round.perActorDetonation?.['enemy-det']).toBe(300_000);
    });

    it('a PLAYER victim whose detonation exceeds its HP DIES; a leftover bomb then splashes its ally', () => {
        idc = 0;
        // Covered victim pl-mid (HP 1000) carries BOTH a corrosion entry (detonated this cast —
        // tier 100, 1 stack, 1 round, hp-capped 1000 → 1000 damage, lethal) AND a leftover bomb the
        // CORROSION-typed detonate does NOT consume. The detonate skill detonates ONLY corrosion, so
        // the bomb survives → pl-mid dies from the corrosion detonation while still carrying the
        // bomb → bomb-splash-on-death fires to its adjacent ally (pl-back at M2, a hex-neighbour of
        // M3 but OUTSIDE the M4-anchored Line-Range-1 footprint → it took no firing/detonation
        // damage, isolating the splash). pl-front (origin, huge HP) just detonates nothing extra.
        const leftover = bomb(800, 1, 'pl-mid'); // splash = 1 × 800 × (100/4)/100 = 200
        const { events, result } = collect(
            BASE({
                enemyAttackers: [enemyDetonator('enemy-det', 'M4', [detonate('corrosion')])],
                teamActors: [
                    playerVictim('pl-front', 'M4', 1_000_000_000),
                    playerVictim('pl-mid', 'M3', 1000),
                    playerVictim('pl-back', 'M2', 1_000_000_000), // adjacent to M3, outside footprint
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    const mid = actors.find((a) => a.id === 'pl-mid');
                    mid?.corrosionEntries.push(corrosion(100, 1, 1)); // 1000 → lethal
                    mid?.pendingBombs.push(leftover); // NOT consumed by the corrosion detonate
                },
            })
        );
        const round = result.rounds[0];
        // pl-mid died this round.
        const destroyed = events.filter((e) => e.type === 'ship-destroyed');
        expect(destroyed.some((e) => e.actorId === 'pl-mid')).toBe(true);
        // Its leftover bomb splashed the adjacent ally (bomb-splash-on-death chain).
        expect(round.perActorSplash?.['pl-back']).toBe(200);
    });

    it("dot-detonated emits per victim carrying that victim's id (inferno bypass)", () => {
        idc = 0;
        // pl-mid carries an inferno entry; the detonate skill detonates inferno. Inferno payout =
        // stacks × (tier/100) × effectiveAttack × remainingRounds × dotMult × affinityMult × pct ×
        // detonationMult. With dotMult/affinityMult/detonationMult = 1, effectiveAttack = enemy
        // attack 100: 1 × (100/100) × 100 × 1 = 100.
        const { events, result } = collect(
            BASE({
                enemyAttackers: [enemyDetonator('enemy-det', 'M4', [detonate('inferno')])],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'pl-mid')
                        ?.infernoEntries.push({
                            stacks: 1,
                            tier: 100,
                            remainingRounds: 1,
                            sourceId: 'enemy-det',
                        });
                },
            })
        );
        const round = result.rounds[0];
        const dotDet = events.filter((e) => e.type === 'dot-detonated');
        // Exactly one dot-detonated, carrying the covered victim's id.
        expect(dotDet.length).toBe(1);
        expect(dotDet[0].targetId).toBe('pl-mid');
        expect(dotDet[0].damage).toBe(100);
        // Covered victim took firing 50 + inferno bypass 100.
        expect(round.perTargetDamage?.['pl-mid']).toBe(50 + 100);
        expect(round.perActorDetonation?.['enemy-det']).toBe(100);
    });

    it('the per-victim detonation does NOT touch the focus dummy enemy HP (no cumulativeDamage double-count)', () => {
        idc = 0;
        // The focus dummy `enemy` (the player's notional target) must be untouched by the enemy's
        // per-victim detonation — the detonation lands on PLAYER victims via playerSink, never folded
        // into the focus enemy's HP/cumulativeDamage. The focus player at M1 is zero-offense and out
        // of the footprint, so it deals no damage to the dummy either → enemy HP stays at full.
        const { result } = collect(
            BASE({
                __testTapActors: (actors: CombatActor[]) => {
                    actors.find((a) => a.id === 'pl-front')?.pendingBombs.push(bomb(1000, 2));
                    actors.find((a) => a.id === 'pl-mid')?.pendingBombs.push(bomb(1000, 2));
                },
            })
        );
        const round = result.rounds[0];
        // The focus dummy `enemy` HP row is untouched by the enemy→player detonation: enemyHpPct stays
        // at 100 (entering-round value, the dummy never took damage — the focus player at M1 deals
        // none, and the per-victim detonation lands on PLAYER victims via playerSink, never folded into
        // the focus enemy HP / cumulativeDamage). The detonation is fully accounted on the player
        // victims' perTargetDamage instead.
        expect(round.enemyHpPct).toBe(100);
        expect(
            (round.perTargetDamage?.['pl-front'] ?? 0) + (round.perTargetDamage?.['pl-mid'] ?? 0)
        ).toBe(100 + 2000 + 50 + 2000);
    });

    // SP-4b: 'REGRESSION: a NON-positional enemy detonate still drains via the legacy single-apply
    // path' lived here. It pinned an enemy attacker with NO position/target/pattern draining the
    // heal target through `applyIncomingToTarget(damage, tgt, {bombPortion})` — i.e. the legacy
    // single-anchor sink (`TurnBindings.legacyVictim`) itself, plus the two positional-only
    // surfaces staying absent behind it. `normalizeCombatRoster` makes that input unrepresentable
    // at `runCombat`'s door, and the sink it described is what SP-4c/4e delete outright, so the
    // test was removed rather than bypassed: keeping it alive under a below-boundary hook would
    // pin machinery that is scheduled for deletion. The positional detonation arithmetic it
    // shared a file with is covered by the per-victim cases above.
    it('E5-SYMMETRY: the SAME detonate ship pays out IDENTICALLY whether it acts as a PLAYER or an ENEMY', () => {
        idc = 0;
        // The defining team-symmetry pin. A detonate ship firing a Line-Range-1 bomb detonate at two
        // positioned victims (origin huge HP, covered HP 300_000) carrying identical seeded bombs must
        // produce IDENTICAL per-victim detonation payout integers + events whether the detonator is on
        // the PLAYER side (PR1 path) or the ENEMY side (PR3 path).
        const SEED_BOMB = () => bomb(1500, 3); // 3 × 1500 = 4500 per victim
        const ORIGIN_HP = 1_000_000_000;
        const COVERED_HP = 300_000;

        // --- PLAYER side (PR1 path): the FOCUS attacker detonates two ENEMY victims. ---
        const playerBus = createEventBus();
        const playerEvents: CombatEvent[] = [];
        playerBus.on('bomb-detonated', (e) => playerEvents.push(e as CombatEvent));
        const playerResult = runCombat({
            bus: playerBus,
            attack: ENEMY_ATTACK,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [detonateSlot(detonate('bomb'))] },
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
            position: 'M4',
            target: parsedTarget('front'),
            pattern: lineRange1Pattern(),
            enemyAttackers: [
                {
                    id: 'e-origin',
                    stats: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: ORIGIN_HP,
                        speed: 1,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M4',
                    shipSkills: { slots: [] } as ShipSkills,
                } as EnemyAttacker,
                {
                    id: 'e-cover',
                    stats: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: COVERED_HP,
                        speed: 1,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M3',
                    shipSkills: { slots: [] } as ShipSkills,
                } as EnemyAttacker,
            ],
            __testTapActors: (actors: CombatActor[]) => {
                actors.find((a) => a.id === 'e-origin')?.pendingBombs.push(SEED_BOMB());
                actors.find((a) => a.id === 'e-cover')?.pendingBombs.push(SEED_BOMB());
            },
        });
        const playerRound = playerResult.rounds[0];

        // --- ENEMY side (PR3 path): an ENEMY attacker detonates two PLAYER victims. ---
        const enemyBus = createEventBus();
        const enemyEvents: CombatEvent[] = [];
        enemyBus.on('bomb-detonated', (e) => enemyEvents.push(e as CombatEvent));
        const enemyResult = runCombat({
            bus: enemyBus,
            ...BASE({
                teamActors: [
                    playerVictim('pl-front', 'M4', ORIGIN_HP),
                    playerVictim('pl-mid', 'M3', COVERED_HP),
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    actors.find((a) => a.id === 'pl-front')?.pendingBombs.push(SEED_BOMB());
                    actors.find((a) => a.id === 'pl-mid')?.pendingBombs.push(SEED_BOMB());
                },
            }),
        });
        const enemyRound = enemyResult.rounds[0];

        // IDENTICAL per-victim detonation payout (origin vs covered), regardless of side.
        expect(playerRound.perTargetDamage?.['e-origin']).toBe(
            enemyRound.perTargetDamage?.['pl-front']
        );
        expect(playerRound.perTargetDamage?.['e-cover']).toBe(
            enemyRound.perTargetDamage?.['pl-mid']
        );
        // IDENTICAL total detonation payout credited to the SAME detonating ship.
        expect(playerRound.perActorDetonation?.['attacker']).toBe(
            enemyRound.perActorDetonation?.['enemy-det']
        );
        expect(playerRound.perActorDetonation?.['attacker']).toBe(9000); // 4500 × 2
        // IDENTICAL bomb-detonated event payloads (count + per-event damage).
        expect(playerEvents.length).toBe(enemyEvents.length);
        expect(playerEvents.length).toBe(2);
        for (const e of [...playerEvents, ...enemyEvents]) {
            expect(e.type === 'bomb-detonated' && e.damage).toBe(4500);
        }
    });
});
