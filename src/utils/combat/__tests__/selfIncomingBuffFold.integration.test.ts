/**
 * D-PR12 Task 3 — integration test for friendly-side incoming-damage buff fold.
 *
 * Before the engine change the buff is "emit-only": it is applied to the victim's own self
 * store but victimEnemyModifiers only reads the enemy-debuff store, so the incoming-damage
 * reduction is ignored and the victim takes the full hit.
 *
 * After the engine change victimIncomingModifiers reads BOTH stores (enemy-debuff + victim's
 * own self buffs), so an Inc. Damage Down self-buff reduces the landed hit.
 *
 * Harness mirrors incomingReductionEngine.test.ts (D-PR3 Task 6):
 *   - healingMode (healTargetId = 'attacker') → positioned enemy roster is built.
 *   - playerVictim: speed 1000 → acts BEFORE the enemy, so the self-buff is up when the enemy hits.
 *   - offensiveEnemy: attack 5000, speed 1, 100% multiplier → 5000 direct damage.
 *   - Inc. Damage Down II: incomingDamage = -30 → landed = 5000 × (1 − 0.30) = 3500.
 *   - HP bracket: victim hp = 4000 → DIES without buff (5000 > 4000), SURVIVES with buff (3500 < 4000).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { ShipSkills, Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';

type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// ── Targeting helpers ─────────────────────────────────────────────────────────
const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// ── Buff ability helpers ───────────────────────────────────────────────────────

/**
 * Self-buff ability that grants Inc. Damage Down II on the victim's own active turn.
 * parsedEffects.incomingDamage = -30 → the status payload carries incomingDamage: -30.
 * duration 2: the engine decrements on the SAME turn the buff is applied (post-victim-turn),
 * so duration 1 would expire before the enemy acts. duration 2 → 1 remaining when the enemy
 * fires → buff is active. (Mirrors how stealthSelfBuff uses duration 99 in the reference harness.)
 */
const incDamageDownSelfBuff = (id: string): Ability => ({
    id,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Inc. Damage Down II',
        parsedEffects: { incomingDamage: -30 },
        stacks: 1,
        isStackable: false,
        duration: 2,
    },
});

// No-op damage: actor "casts" but deals 0 damage.
const noopActive: ShipSkills['slots'][number] = {
    slot: 'active',
    abilities: [
        {
            id: 'noop-dmg',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 0 },
        },
    ],
};

// ── Actor constructors ─────────────────────────────────────────────────────────

/**
 * A positioned PLAYER victim that optionally grants itself Inc. Damage Down II before being hit.
 * speed 1000 → acts before the enemy (speed 1) so the buff is active when the hit lands.
 */
const playerVictim = (
    id: string,
    position: Position,
    hp: number,
    opts: { incDamageDown?: boolean } = {}
): TeamActor => {
    const active: ShipSkills['slots'][number] = opts.incDamageDown
        ? {
              slot: 'active',
              abilities: [incDamageDownSelfBuff(`${id}-inc-dmg-down`)],
          }
        : noopActive;
    return {
        id,
        speed: 1000,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        walk: {
            shipSkills: { slots: [active] },
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
        },
    };
};

/**
 * A positioned ENEMY attacker: attack 5000 × 100% × 1 hit vs defence 0 → 5000 damage.
 * speed 1 → acts AFTER the player victim so the victim's self-buff is up when the hit fires.
 */
const offensiveEnemy = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection']
): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 5000,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 1,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget(selection),
        pattern: basePattern(),
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: `${id}-hit`,
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 100 },
                        },
                    ],
                },
            ],
        } as ShipSkills,
    }) as EnemyAttacker;

// ── Engine input factory ───────────────────────────────────────────────────────
const BASE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [stealthOnlyActive('focus')] },
    // SP-4b-1: the focus is pinned to the back of the middle row AND cloaked.
    //
    // It used to be off the board entirely, and that is what kept the enemy's targeting on the
    // stealthed victim: `resolvePositionalTarget` drops stealthed cells UNLESS every candidate is
    // stealthed, and with the victim the only placed player actor that "restore all" branch always
    // fired. The normalization boundary places the focus too, so an un-stealthed focus becomes the
    // one visible cell and soaks every hit — which silently made the Case B "both effects" survival
    // a false pass (nothing was hitting the victim at all). Cloaking the focus restores the
    // restore-all branch, and the enemy's own-row front->back scan (row M) resolves onto the victim
    // at M4. Inert to the folds under test: every gate reads the VICTIM's own statuses.
    position: 'M1',
    speed: 2000, // ahead of every victim/enemy, so the focus's Stealth is up before anyone fires
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
    healTargetId: 'attacker', // healing mode → positioned enemy roster is built
    mode: 'healing',
    ...overrides,
});

// ── Assertion helpers ──────────────────────────────────────────────────────────

/** Set of actor ids that emitted ship-destroyed in this run. */
const destroyedIds = (input: CombatEngineInput): Set<string> => {
    const bus = createEventBus();
    const ids = new Set<string>();
    bus.on('ship-destroyed', (e) => ids.add(e.actorId));
    runCombat({ ...input, bus });
    return ids;
};

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('D-PR12 Task 3 — friendly-side Inc. Damage Down folds into per-victim incoming modifier', () => {
    /**
     * Build a run where the player victim is hit by a 5000-attack enemy.
     * incDamageDown = true  → victim grants itself Inc. Damage Down II (-30%) on its own turn.
     * incDamageDown = false → victim casts a no-op, takes the full 5000.
     */
    const run = (hp: number, incDamageDown: boolean): CombatEngineInput =>
        BASE({
            teamActors: [playerVictim('victim', 'M4', hp, { incDamageDown })],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1', 'front')],
        });

    it('baseline: WITHOUT Inc. Damage Down the victim takes the full 5000 and dies at hp=4000', () => {
        // Full 5000 > 4000 → dies.
        expect(destroyedIds(run(4000, false)).has('victim')).toBe(true);
        // Full 5000 > 5000? No, 5000 = 5000 → exactly kills.
        expect(destroyedIds(run(5000, false)).has('victim')).toBe(true);
        // Full 5000 < 5001 → survives.
        expect(destroyedIds(run(5001, false)).has('victim')).toBe(false);
    });

    it('WITH Inc. Damage Down II (-30%) the victim takes 3500 and survives at hp=4000', () => {
        // Reduced 3500 < 4000 → victim SURVIVES.
        // (Before the engine change this FAILS: victim still dies because the buff is emit-only.)
        expect(destroyedIds(run(4000, true)).has('victim')).toBe(false);
    });

    it('WITH Inc. Damage Down II the victim dies at hp=3500 (pinned to 3500 taken)', () => {
        // Reduced 3500 = 3500 → exactly kills at hp=3500.
        expect(destroyedIds(run(3500, true)).has('victim')).toBe(true);
        // Survives at hp=3501.
        expect(destroyedIds(run(3501, true)).has('victim')).toBe(false);
    });
});

// ── Case A helpers ────────────────────────────────────────────────────────────

/**
 * A positioned player ATTACKER (focus 'attacker') that fires a 100% single-hit at the
 * front enemy. attack 5000 × 100% vs defence 0 → 5000 raw damage. The focus position +
 * target + pattern triggers the positional path (drivePositionalApply → applyPositionalDamage
 * → victimHitDamage with the enemy's victimIncomingModifiers).
 */
const playerAttackerBase = (speed: number): Partial<CombatEngineInput> => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'focus-hit',
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 100 },
                    },
                ],
            },
        ],
    } as ShipSkills,
    speed,
    position: 'M4' as Position,
    target: { raw: 'front', side: 'enemy', selection: 'front' } as ParsedTarget,
    pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} } as ParsedPattern,
    hp: 1_000_000_000, // immortal — damage direction is player→enemy for this case
    defence: 0,
    selfBuffs: [],
    enemyDebuffs: [],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 1,
    healTargetId: 'attacker',
    mode: 'healing',
});

/**
 * A positioned ENEMY actor that, on its own turn, grants itself Inc. Damage Down II (-30%).
 * It ALSO fires a harmless damage hit at the player (attack 1 — does not kill the immortal focus).
 * speed: when high (e.g. 2000 > focus 1000), it acts FIRST and the self-buff is active when the
 * focus fires at it. When low (e.g. 1 < focus 1000), the focus fires BEFORE the enemy self-buffs →
 * the buff is NOT active at hit time → the full 5000 lands.
 */
const selfBuffingEnemy = (
    id: string,
    position: Position,
    hp: number,
    speed: number
): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 1, // negligible against immortal focus
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp,
            speed,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        target: { raw: 'front', side: 'enemy', selection: 'front' } as ParsedTarget,
        pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} } as ParsedPattern,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        // Self-buff fires first on this actor's own turn.
                        incDamageDownSelfBuff(`${id}-inc-dmg-down`),
                        // Trivial damage at the player (does not kill immortal focus).
                        {
                            id: `${id}-dmg`,
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 1 },
                        },
                    ],
                },
            ],
        } as ShipSkills,
    }) as EnemyAttacker;

// ── Case B helpers ────────────────────────────────────────────────────────────

function makeShipForVoidshade(id: string): Ship {
    return {
        id,
        name: 'Test Victim',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'DEFENDER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: { implant_major: 'voidshade-piece' },
        refits: [],
    } as Ship;
}

function makeVoidshadePiece(): GearPiece {
    return {
        id: 'voidshade-piece',
        slot: 'implant_major',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: null,
        subStats: [],
        setBonus: 'VOIDSHADE',
    } as GearPiece;
}

/** legendary Voidshade passive slot: -20% incoming direct damage while stealthed. */
function voidshadePassiveSlot(): ShipSkills['slots'][number] {
    const ship = makeShipForVoidshade('voidshade-ship');
    const piece = makeVoidshadePiece();
    const skills = buildShipAbilitiesWithEquipment(ship, (gearId) =>
        gearId === 'voidshade-piece' ? piece : undefined
    );
    const slot = skills.slots.find((s) => s.slot === 'passive');
    // Fail loudly rather than silently degrade: if VOIDSHADE ever stops emitting a passive
    // slot, the Case B "both effects" assertion would become a false-pass (only the friendly
    // buff would apply, and a product model would survive too). Guard against that.
    if (!slot) throw new Error('VOIDSHADE legendary should always produce a passive slot');
    return slot;
}

/** Active slot that self-casts BOTH Stealth (to gate Voidshade) and Inc. Damage Down II (-30%). */
const stealthAndIncDmgDownActive = (id: string): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: `${id}-stealth`,
            type: 'buff',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'buff',
                buffName: 'Stealth',
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
                duration: 99,
            },
        },
        incDamageDownSelfBuff(`${id}-inc-dmg-down`),
    ],
});

/** Active slot that self-casts Stealth ONLY (gates Voidshade; no Inc. Damage Down). */
const stealthOnlyActive = (id: string): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: `${id}-stealth`,
            type: 'buff',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'buff',
                buffName: 'Stealth',
                parsedEffects: {},
                stacks: 1,
                isStackable: false,
                duration: 99,
            },
        },
    ],
});

/**
 * Build a player victim for Case B:
 *   - passive: optional Voidshade slot (20% reduction while stealthed)
 *   - active:  depends on opts (stealth only / inc-dmg-down only / both)
 */
const caseB_victim = (
    hp: number,
    opts: { voidshade: boolean; stealth: boolean; incDmgDown: boolean }
): TeamActor => {
    let activeSlot: ShipSkills['slots'][number];
    if (opts.stealth && opts.incDmgDown) {
        activeSlot = stealthAndIncDmgDownActive('victim-cb');
    } else if (opts.stealth) {
        activeSlot = stealthOnlyActive('victim-cb');
    } else if (opts.incDmgDown) {
        activeSlot = {
            slot: 'active',
            abilities: [incDamageDownSelfBuff('victim-cb-inc-dmg-down')],
        };
    } else {
        activeSlot = noopActive;
    }

    const passive = opts.voidshade ? voidshadePassiveSlot() : undefined;
    return {
        id: 'victim-cb',
        speed: 1000, // acts BEFORE enemy (speed 1) so both buffs are up when the hit lands
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position: 'M4' as Position,
        walk: {
            shipSkills: { slots: [activeSlot, ...(passive ? [passive] : [])] },
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
        },
    };
};

// ─────────────────────────────────────────────────────────────────────────────
// Case A: team-agnostic — the fold works when the ENEMY is the victim
// ─────────────────────────────────────────────────────────────────────────────
describe('D-PR12 Task 4 Case A — enemy-side victim: Inc. Damage Down fold is team-agnostic', () => {
    /**
     * Focus 'attacker' (attack 5000, speed 1000) fires positionally at the front enemy.
     * The enemy is the sole enemy-side actor at position M4 (the front-most enemy).
     *
     * Two enemy speed variants:
     *   - speed 2000 → enemy acts BEFORE focus: self-buffs Inc. Damage Down II (-30%) on
     *     its own turn, THEN the focus fires. Buff is active → landed = 3500.
     *   - speed 1 → enemy acts AFTER focus: focus fires BEFORE self-buff, so the buff is
     *     NOT active at hit time → full 5000 lands.
     *
     * HP bracket: 4000 → dies on full 5000 (unbuffed); survives on reduced 3500 (buffed).
     * This proves victimIncomingModifiers(v.id) folds friendly self-buffs regardless of
     * which side v.id belongs to (direction-agnostic timed-ability status key).
     */
    const run = (enemyHp: number, enemyActsFirst: boolean): CombatEngineInput => ({
        ...BASE({}),
        ...playerAttackerBase(1000),
        enemyAttackers: [
            selfBuffingEnemy(
                'enemy-sb',
                'M4',
                enemyHp,
                enemyActsFirst ? 2000 : 1 // 2000 > focus speed 1000 → acts first
            ),
        ],
    });

    it('baseline: without early self-buff the enemy takes full 5000 and dies at hp=4000', () => {
        // Enemy speed=1 → focus (speed 1000) fires BEFORE enemy self-buffs.
        // Full 5000 > 4000 → dies.
        expect(destroyedIds(run(4000, false)).has('enemy-sb')).toBe(true);
        // At hp=5001 it survives (5000 < 5001), confirming the damage cap is 5000.
        expect(destroyedIds(run(5001, false)).has('enemy-sb')).toBe(false);
    });

    it('WITH early self-buff the enemy takes 3500 and survives at hp=4000 (enemy-side fold)', () => {
        // Enemy speed=2000 → enemy self-buffs BEFORE the focus fires.
        // victimIncomingModifiers('enemy-sb') folds the self-buff → landed = 3500 < 4000 → survives.
        // (If the fold were player-only, the full 5000 would land → the enemy would die here.)
        expect(destroyedIds(run(4000, true)).has('enemy-sb')).toBe(false);
    });

    it('WITH early self-buff the enemy dies at hp=3500 (pinned to 3500 taken)', () => {
        // Reduced 3500 = 3500 → exactly kills at hp=3500.
        expect(destroyedIds(run(3500, true)).has('enemy-sb')).toBe(true);
        // Survives at hp=3501.
        expect(destroyedIds(run(3501, true)).has('enemy-sb')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Case B: additive D-PR3 composition — NOT a product
// ─────────────────────────────────────────────────────────────────────────────
describe('D-PR12 Task 4 Case B — additive composition with D-PR3 incoming-reduction', () => {
    /**
     * Composition model (victimDamage.ts lines ~100-107):
     *
     *   incoming = (v.incomingDamageModifierPct ?? s.incomingDamageModifierPct) - equipReductionPct;
     *   nonCritFactor = (1 - damageReduction/100)
     *                 * (1 + s.outgoingDamageBuffPct/100)
     *                 * (1 + incoming/100)       ← ONE scalar factor
     *                 * affinityMult;
     *
     * D-PR12 friendly buff (-30) and D-PR3 Voidshade equipment reduction (20) BOTH land in the
     * SAME `incoming` scalar, subtracted together before the multiply:
     *
     *   incoming = (-30) - 20 = -50  →  nonCritFactor ∋ (1 + -50/100) = 0.50  →  taken = 2500
     *
     * ADDITIVE (correct) vs. PRODUCT (wrong — the product would be wrong because there's
     * literally one factor in the formula):
     *   additive:  5000 × (1 + (-30 - 20)/100) = 5000 × 0.50 = 2500
     *   product:   5000 × (1 - 0.30) × (1 - 0.20) = 5000 × 0.70 × 0.80 = 2800
     *
     * Discriminating hp = 2650:
     *   - additive 2500 < 2650 → SURVIVES (correct)
     *   - product  2800 > 2650 → would DIE (wrong)
     *
     * Sub-assertions prove BOTH terms are required: with ONLY one effect the victim still
     * dies at hp=2650 (4000 > 2650 and 3500 > 2650), so only the additive sum (2500 < 2650)
     * allows survival — pinning the additive-within-one-factor behavior.
     *
     * Voidshade legendary = 20% incoming-direct reduction WHILE STEALTHED.
     * The victim self-casts Stealth (duration 99) to gate the Voidshade reduction; this is
     * identical to the D-PR3 Task 6 harness (incomingReductionEngine.test.ts).
     */
    const run = (
        hp: number,
        opts: { voidshade: boolean; stealth: boolean; incDmgDown: boolean }
    ): CombatEngineInput =>
        BASE({
            teamActors: [caseB_victim(hp, opts)],
            enemyAttackers: [offensiveEnemy('enemy-cb', 'M1', 'front')],
        });

    it('BOTH D-PR3 (Voidshade 20%) AND Inc. Damage Down II (-30%) → survives at hp=2650 (additive 2500 < 2650)', () => {
        // Additive: incoming = -30 - 20 = -50 → taken = 5000 × 0.50 = 2500 < 2650 → SURVIVES.
        // Product model (wrong): 5000 × 0.70 × 0.80 = 2800 > 2650 → would die — survival here
        // discriminates ADDITIVE from product and proves (1 + incoming/100) is one factor.
        expect(
            destroyedIds(run(2650, { voidshade: true, stealth: true, incDmgDown: true })).has(
                'victim-cb'
            )
        ).toBe(false);
    });

    it('ONLY D-PR3 Voidshade (20%, no Inc. Damage Down) → dies at hp=2650 (4000 > 2650)', () => {
        // Without Inc. Damage Down: incoming = 0 - 20 = -20 → taken = 5000 × 0.80 = 4000.
        // 4000 > 2650 → DIES. Proves the D-PR3 term alone is insufficient to clear 2650.
        expect(
            destroyedIds(run(2650, { voidshade: true, stealth: true, incDmgDown: false })).has(
                'victim-cb'
            )
        ).toBe(true);
    });

    it('ONLY Inc. Damage Down II (-30%, no Voidshade/stealth) → dies at hp=2650 (3500 > 2650)', () => {
        // Without Voidshade: incoming = -30 - 0 = -30 → taken = 5000 × 0.70 = 3500.
        // 3500 > 2650 → DIES. Proves the D-PR12 term alone is insufficient to clear 2650.
        expect(
            destroyedIds(run(2650, { voidshade: false, stealth: false, incDmgDown: true })).has(
                'victim-cb'
            )
        ).toBe(true);
    });

    it('NO reductions → full 5000 damage (dies at hp=2650, survives at hp=5001)', () => {
        // Baseline pin: with neither term, incoming = 0 → taken = 5000 (no floor/cap surprise).
        expect(
            destroyedIds(run(2650, { voidshade: false, stealth: false, incDmgDown: false })).has(
                'victim-cb'
            )
        ).toBe(true);
        expect(
            destroyedIds(run(5001, { voidshade: false, stealth: false, incDmgDown: false })).has(
                'victim-cb'
            )
        ).toBe(false);
    });
});
