/**
 * E2 Task 3 — PER-VICTIM standing leech on the positional apply path.
 *
 * Before E2, standing damage-dealt leeches were suppressed on the positional path: the
 * firing-hit damage lands per-victim via `applyPositionalDamage`, but the aggregate
 * `creditDamage(... 'direct' ...)` (which is what `procStandingLeeches` rides) is SKIPPED
 * for the positional case (no double-count). So a positional AoE attacker's own
 * standing leech never fired.
 *
 * E2 wires an `onVictimResolved` callback at the player→enemy positional sites that procs
 * the ACTING attacker's standing leeches off EACH footprint victim's dealt damage. Because
 * the per-victim `damage` is already role-scaled (origin full, covered half), leeching off
 * `damage` per victim yields exactly `origin dealt + 0.5×covered dealt`.
 *
 * Harness mirrors twoTeamBattle.test.ts / positionalDamage.integration.test.ts: positioned
 * actors, `healTargetId` to unlock the enemy roster, a passive damage-dealt heal leech on
 * the focus. Crit 0 keeps every credited value an exact integer; the heal-crit test pins the
 * per-victim heal-crit-gate cadence explicitly.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pvl${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// Single-hit basic attack: multiplier 100% (1x), 1 hit, no passive payload — so the firing
// hit's per-victim damage is attack × roleScale vs defence 0 (origin full, covered half).
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

// A passive-slot damage-dealt heal leech (STANDING). `target` defaults to 'self' → the
// acting attacker is the recipient.
const leechHeal = (
    pct: number,
    extra: { leechScope?: 'all' | 'detonation'; noCrit?: boolean } = {},
    target: Ability['target'] = 'self'
): Ability =>
    ab({
        type: 'heal',
        target,
        config: { type: 'heal', pct, basis: 'damage-dealt', leechScope: 'all', ...extra },
    });

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// AoE pattern: origin + one covered cell one step toward back (Pattern-Line-Range-1).
// Anchored at the FRONT enemy (M4) it covers M3 — origin full, covered half.
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

// A positioned, finite-HP enemy with zero offense (a stationary, damageable target).
const enemyAt = (id: string, position: Position, hp: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots: [] } as ShipSkills,
    }) as EnemyAttacker;

/** Sum a healing bucket over every round for `actorId` (defaults to the focus). */
const sumHeal = (
    result: ReturnType<typeof runCombat>,
    bucket: 'directHeal' | 'effectiveHeal' | 'overheal',
    actorId = 'attacker'
): number =>
    (result.healing?.rounds ?? []).reduce(
        (sum, rd) => sum + (rd.perActor.get(actorId)?.[bucket] ?? 0),
        0
    );

// Focus attacker positioned at M4 firing Line-Range-1 at `front`. attack 5000 × 100% × 1 hit
// vs defence-0 victims. Origin (front enemy at M4) takes 5000, covered (mid enemy at M3) 2500.
// The focus carries a passive 20% damage-dealt self heal leech.
const BASE = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: {
        slots: [
            basicAttack(),
            { slot: 'passive', abilities: [leechHeal(20, { leechScope: 'all' })] },
        ],
    },
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
    // Below max HP so the heal has deficit to consume (effectiveHeal observable).
    hp: 1_000_000,
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

describe('E2 T3 — per-victim standing leech on the positional path', () => {
    it('standing leech credits origin dealt + 0.5×covered dealt (20% of 5000 + 2500 = 1500)', () => {
        idc = 0;
        // Origin 5000 + covered 2500 = 7500 dealt; 20% leech → directHeal 1500. crit 0 → no fold.
        const result = runCombat(BASE());
        expect(sumHeal(result, 'directHeal')).toBeCloseTo(1500, 6);
    });

    it('standing leech with healModifier 50 folds × 1.5 per victim → 2250', () => {
        idc = 0;
        // (5000 + 2500) × 0.20 × 1.5 = 2250. healModifier folds into a heal-kind leech.
        const result = runCombat(BASE({ healModifier: 50 }));
        expect(sumHeal(result, 'directHeal')).toBeCloseTo(2250, 6);
    });

    it('standing leech heal-crit gate draws ONCE PER VICTIM (crit 100 → both victims double)', () => {
        idc = 0;
        // crit 100 → the FIRING damage crits (× 2 via critDamage 100), so the per-victim dealt
        // damage is origin 10000 / covered 5000. crit 100 also makes activeHealCritGate(1.0)
        // always crit, and the per-victim proc draws the gate ONCE PER VICTIM → both leeches
        // double via critDamage 100.
        // origin: 10000 × 0.20 × 2 = 4000; covered: 5000 × 0.20 × 2 = 2000 → total 6000.
        const result = runCombat(BASE({ crit: 100, critDamage: 100 }));
        expect(sumHeal(result, 'directHeal')).toBeCloseTo(6000, 6);
    });

    it('detonation-scoped leech does NOT fire on the per-victim direct channel', () => {
        idc = 0;
        // A detonation-scoped leech must be inert on the positional `direct` per-victim path
        // (no bomb in this run) → zero directHeal.
        const result = runCombat(
            BASE({
                shipSkills: {
                    slots: [
                        basicAttack(),
                        {
                            slot: 'passive',
                            abilities: [leechHeal(20, { leechScope: 'detonation' })],
                        },
                    ],
                },
            })
        );
        expect(sumHeal(result, 'directHeal')).toBe(0);
    });
});

/**
 * E2 Task 5 — PER-VICTIM TAKEN leech on the positional ENEMY branch (enemy→player).
 *
 * Before E2 the damage-taken HEAL/SHIELD leech was gated to the NON-positional path: on the
 * positional path the enemy's firing hit lands per-victim via drivePositionalApply, but the
 * leech block only credited the single heal target off the aggregate `damage` (gated out by
 * `!enemyPositional`). So a player victim's "when damaged, heal/shield" reactive never fired
 * when the enemy used a positional AoE.
 *
 * E2 wires an `onVictimResolved` callback at the ENEMY positional site that procs EACH player
 * victim's OWN taken-leeches (takenLeechesByOwner.get(victim.id)) off the per-victim
 * `{shieldBefore, hpDamage, barriered}` outcome, applying to the victim's OWN pool via the
 * Task-1 closures. The Barrier carve-out and requiresHpDamage gate are evaluated PER VICTIM,
 * mirroring the non-positional block.
 *
 * Harness: a positioned, OFFENSIVE enemy at M1 firing `front` with a Line-Range-1 AoE. The
 * front-most player (focus 'attacker' at M4) is the origin victim (full damage); the M3 team
 * player ('player-team') is the covered victim (half damage). ONE player carries a passive
 * damage-taken heal leech; the other does not. Crit 0 / healModifier 0 keeps every value an
 * exact integer.
 */
describe('E2 T5 — per-victim taken leech on the positional enemy branch', () => {
    // A passive-slot damage-taken HEAL leech (taken-leech). `target` is 'self' → the victim
    // heals its OWN pool off the damage IT took.
    const takenHeal = (
        pct: number,
        extra: { requiresHpDamage?: boolean; noCrit?: boolean } = {}
    ): Ability =>
        ab({
            type: 'heal',
            target: 'self',
            config: { type: 'heal', pct, basis: 'damage-taken', ...extra },
        });

    // A no-payload, always-active Barrier self-buff (full damage immunity). A victim carrying
    // this fully BLOCKS the incoming hit → no damage taken → the per-victim Barrier carve-out
    // skips its taken leech. Same shape barrier.test.ts uses.
    const barrierBuff = () => ({
        id: 'pvl-barrier',
        buffName: 'Barrier',
        stacks: 1,
        isStackable: false,
        parsedEffects: {},
    });

    // A walked team player at a board position. Optional shipSkills slots (else a bare basic
    // attack so it has a damage skill / position is meaningful). HP huge so it never dies.
    const playerAt = (
        id: string,
        position: Position,
        slots: ShipSkills['slots'] = [basicAttack()],
        hp = 1_000_000,
        selfBuffs: TeamActor['selfBuffs'] = []
    ): TeamActor => ({
        id,
        speed: 1, // order is irrelevant: the enemy AoE lands on a fixed footprint regardless.
        chargeCount: 0,
        startCharged: false,
        selfBuffs,
        enemyDebuffs: [],
        position,
        target: parsedTarget('front'),
        pattern: lineRange1Pattern(),
        walk: {
            shipSkills: { slots },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
            healModifier: 0,
        },
    });

    // An OFFENSIVE enemy at M1 firing a Line-Range-1 AoE at `front`. Anchored at the front-most
    // player (focus at M4) it covers the M3 player — origin full, covered half.
    const offensiveEnemyAt = (
        id: string,
        position: Position,
        attack: number,
        hp = 1_000_000_000
    ): EnemyAttacker =>
        ({
            id,
            stats: { attack, crit: 0, critDamage: 0, defence: 0, hp, speed: 10 },
            chargeCount: 0,
            startCharged: false,
            position,
            target: parsedTarget('front'),
            pattern: lineRange1Pattern(),
            shipSkills: { slots: [basicAttack()] },
        }) as EnemyAttacker;

    // 1v(focus+team): the enemy AoE hits BOTH players. The focus ('attacker', M4) is the origin
    // victim (full damage); the M3 team player is the covered victim (half). HP huge so nobody
    // dies; the focus has a HP deficit so its own taken leech (when present) has room to consume.
    const TAKEN_BASE = (
        overrides: {
            focusSlots?: ShipSkills['slots'];
            teamSlots?: ShipSkills['slots'];
            enemyAttack?: number;
            focusHp?: number;
            teamSelfBuffs?: TeamActor['selfBuffs'];
            focusSelfBuffs?: CombatEngineInput['selfBuffs'];
        } = {}
    ): CombatEngineInput => ({
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: overrides.focusSlots ?? [basicAttack()] },
        numRounds: 1,
        selfBuffs: overrides.focusSelfBuffs ?? [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: overrides.focusHp ?? 1_000_000,
        healModifier: 0,
        healTargetId: 'attacker',
        mode: 'healing',
        position: 'M4',
        target: parsedTarget('front'),
        pattern: lineRange1Pattern(),
        teamActors: [
            playerAt('player-team', 'M3', overrides.teamSlots, 1_000_000, overrides.teamSelfBuffs),
        ],
        enemyAttackers: [offensiveEnemyAt('enemy-atk', 'M1', overrides.enemyAttack ?? 5000)],
    });

    it('taken leech: the COVERED victim heals its OWN pool off the half damage it took; the origin victim does not', () => {
        idc = 0;
        // Enemy attack 5000 → origin (focus M4) takes 5000, covered (team M3) takes 2500.
        // Only the covered team player carries a 20% damage-taken heal leech.
        // covered directHeal = 2500 × 0.20 = 500; origin gets no leech → 0.
        const result = runCombat(
            TAKEN_BASE({
                teamSlots: [basicAttack(), { slot: 'passive', abilities: [takenHeal(20)] }],
            })
        );
        expect(sumHeal(result, 'directHeal', 'player-team')).toBeCloseTo(500, 6);
        expect(sumHeal(result, 'directHeal', 'attacker')).toBe(0);
        // The leech consumed against the deficit the SAME attack created (2500 taken) → all 500
        // effective, zero overheal. Proves the leech applied to the victim's OWN pool.
        expect(sumHeal(result, 'effectiveHeal', 'player-team')).toBeCloseTo(500, 6);
        expect(sumHeal(result, 'overheal', 'player-team')).toBe(0);
    });

    it('taken leech: the ORIGIN victim heals its OWN pool off the FULL damage it took', () => {
        idc = 0;
        // The focus (origin, full 5000) carries the 20% damage-taken heal leech.
        // origin directHeal = 5000 × 0.20 = 1000; covered (no leech) → 0.
        const result = runCombat(
            TAKEN_BASE({
                focusSlots: [basicAttack(), { slot: 'passive', abilities: [takenHeal(20)] }],
            })
        );
        expect(sumHeal(result, 'directHeal', 'attacker')).toBeCloseTo(1000, 6);
        expect(sumHeal(result, 'directHeal', 'player-team')).toBe(0);
    });

    it('taken leech: a victim under a full Barrier reads 0 (per-victim Barrier carve-out)', () => {
        idc = 0;
        // The ORIGIN focus carries an always-active Barrier → the enemy's origin hit is FULLY
        // BLOCKED (barriered, no damage taken) → its taken leech is skipped entirely. The covered
        // team player (no Barrier) still leeches off its half damage (2500 → 500) — proving the
        // Barrier carve-out is evaluated PER VICTIM, not globally.
        const result = runCombat(
            TAKEN_BASE({
                focusSlots: [basicAttack(), { slot: 'passive', abilities: [takenHeal(20)] }],
                focusSelfBuffs: [barrierBuff()],
                teamSlots: [basicAttack(), { slot: 'passive', abilities: [takenHeal(20)] }],
            })
        );
        // Barriered origin → 0 leech; covered (2500 taken) → 500.
        expect(sumHeal(result, 'directHeal', 'attacker')).toBe(0);
        expect(sumHeal(result, 'directHeal', 'player-team')).toBeCloseTo(500, 6);
    });

    it('taken leech requiresHpDamage: fires only when the hit deals HP damage past shield', () => {
        idc = 0;
        // No shield anywhere → the attack hits HP directly, but shieldBefore is 0, so a
        // requiresHpDamage (Quixilver-style) gate FAILS (needs shieldBefore > 0 AND hpDamage > 0).
        // Both victims carry the gated leech → neither fires.
        const noShield = runCombat(
            TAKEN_BASE({
                focusSlots: [
                    basicAttack(),
                    { slot: 'passive', abilities: [takenHeal(20, { requiresHpDamage: true })] },
                ],
                teamSlots: [
                    basicAttack(),
                    { slot: 'passive', abilities: [takenHeal(20, { requiresHpDamage: true })] },
                ],
            })
        );
        expect(sumHeal(noShield, 'directHeal', 'attacker')).toBe(0);
        expect(sumHeal(noShield, 'directHeal', 'player-team')).toBe(0);

        idc = 0;
        // Now the origin focus seeds a pre-existing Barrier-free SHIELD (HP-basis) on its own
        // turn (before the enemy at speed 10): 10% of 1,000,000 = 100,000. The enemy's 5000 hit
        // is FULLY absorbed by the shield (shieldBefore 100000, hpDamage 0) → the gate still
        // fails (no HP damage). So even WITH shield, a fully-absorbed hit does not fire the gate.
        const fullyAbsorbed = runCombat(
            TAKEN_BASE({
                focusSlots: [
                    {
                        slot: 'active',
                        abilities: [
                            ab({
                                type: 'damage',
                                target: 'enemy',
                                config: { type: 'damage', multiplier: 100 },
                            }),
                            ab({
                                type: 'shield',
                                target: 'self',
                                config: { type: 'shield', pct: 10, basis: 'hp' },
                            }),
                        ],
                    },
                    { slot: 'passive', abilities: [takenHeal(20, { requiresHpDamage: true })] },
                ],
            })
        );
        expect(sumHeal(fullyAbsorbed, 'directHeal', 'attacker')).toBe(0);

        idc = 0;
        // Finally: a SMALL shield (1% of 1,000,000 = 10,000) that the 50,000 hit punches
        // through — shieldBefore 10000 > 0 AND hpDamage 40000 > 0 → the gate PASSES. The leech
        // fires off the FULL damage taken (50,000), not the HP portion: 50000 × 0.20 = 10000.
        const punchThrough = runCombat(
            TAKEN_BASE({
                enemyAttack: 50_000,
                focusHp: 1_000_000,
                focusSlots: [
                    {
                        slot: 'active',
                        abilities: [
                            ab({
                                type: 'damage',
                                target: 'enemy',
                                config: { type: 'damage', multiplier: 100 },
                            }),
                            ab({
                                type: 'shield',
                                target: 'self',
                                config: { type: 'shield', pct: 1, basis: 'hp' },
                            }),
                        ],
                    },
                    { slot: 'passive', abilities: [takenHeal(20, { requiresHpDamage: true })] },
                ],
            })
        );
        expect(sumHeal(punchThrough, 'directHeal', 'attacker')).toBeCloseTo(10000, 6);
    });
});
