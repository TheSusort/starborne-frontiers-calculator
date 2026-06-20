/**
 * D-PR3 Task 6 — end-to-end engine integration for victim-side incoming %-reduction.
 *
 * The %-reduction folds into the POSITIONAL per-sub-hit damage path (victimHitDamage's
 * incoming term, via drivePositionalApply → applyPositionalDamage). So these tests drive the
 * enemy→player positional apply: a positioned ENEMY attacker fires a single-target hit at a
 * positioned PLAYER victim that carries an incoming-reduction passive (built from real
 * equipment via buildShipAbilitiesWithEquipment). The reduction is observed with the
 * death-bracket idiom from positionalDamage.integration.test.ts: size the victim's HP at/above
 * the expected landed damage and assert it dies / survives, pinning the damage to a range.
 *
 * Voidshade (self-stealth): reduces incoming direct damage by X% WHILE the victim is Stealthed.
 *   - The player victim casts a self-Stealth buff on its own turn (speed-ordered before the
 *     enemy), then the enemy hits it. A lone stealthed victim stays targetable (the positional
 *     stealth filter restores all candidates when every candidate is stealthed).
 *   - Assertion: with Voidshade + stealth the victim takes STRICTLY LESS than the unreduced 5000.
 *
 * Hyperion Gaze (incoming-crit-by-stealthed): reduces ONLY a CRIT by a STEALTHED attacker.
 *   - Reduces when the (stealthed) enemy crits; does NOT reduce on a non-crit, nor when the
 *     attacker is unstealthed.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus } from '../events';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { ShipSkills, Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

// ── Gear / ship stubs (mirrors equipmentAbilities.integration.test.ts) ─────────────
function makeShip(over: Partial<Ship>): Ship {
    return {
        id: 'victim-ship',
        name: 'Victim Ship',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'DEFENDER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        ...over,
    } as Ship;
}
function makePiece(over: Partial<GearPiece>): GearPiece {
    return {
        id: 'piece-1',
        slot: 'implant_major',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: null,
        subStats: [],
        setBonus: null,
        ...over,
    } as GearPiece;
}
function makeGetGearPiece(map: Record<string, GearPiece>): (id: string) => GearPiece | undefined {
    return (id) => map[id];
}

/** legendary Voidshade: -20% incoming direct damage while stealthed. */
const voidshadePiece = makePiece({
    id: 'voidshade-legendary',
    slot: 'implant_major',
    rarity: 'legendary',
    setBonus: 'VOIDSHADE',
});
/** legendary Hyperion Gaze: -35% incoming crit by a stealthed attacker (crit-reduction family). */
const hyperionPiece = makePiece({
    id: 'hyperion-legendary',
    slot: 'implant_major',
    rarity: 'legendary',
    setBonus: 'HYPERION_GAZE',
});

/** Build the passive slot abilities an equipped ship carries (incoming-reduction lands here). */
function passiveSlotFor(gearId: string, piece: GearPiece): ShipSkills['slots'][number] | undefined {
    const ship = makeShip({ implants: { implant_major: gearId } });
    const skills = buildShipAbilitiesWithEquipment(ship, makeGetGearPiece({ [gearId]: piece }));
    const passive = skills.slots.find((s) => s.slot === 'passive');
    return passive ? { slot: passive.slot, abilities: passive.abilities } : undefined;
}

// ── Targeting/pattern helpers ──────────────────────────────────────────────────────
const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// A self-Stealth buff active: the actor grants ITSELF 'Stealth' (99 turns) on its turn.
const stealthSelfBuff = (id: string): Ability => ({
    id,
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
});

// A no-op damage active (attack 0 victims deal nothing). Kept so an actor "casts" each round.
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

type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

/** A positioned PLAYER victim with optional equipment passive + optional self-Stealth cast. */
const playerVictim = (
    id: string,
    position: Position,
    hp: number,
    opts: { passive?: ShipSkills['slots'][number]; stealth?: boolean; speed?: number } = {}
): TeamActor => {
    const active: ShipSkills['slots'][number] = opts.stealth
        ? {
              slot: 'active',
              abilities: [stealthSelfBuff(`${id}-stealth`)],
          }
        : noopActive;
    return {
        id,
        speed: opts.speed ?? 1000, // act before the enemy so Stealth is up when it attacks
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        walk: {
            shipSkills: { slots: [active, ...(opts.passive ? [opts.passive] : [])] },
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

/** A positioned ENEMY attacker: attack 5000 × 100% × 1 hit vs defence 0 → 5000 firing-hit.
 *  `crit`/`critDamage` and an optional self-Stealth active drive the Hyperion gate. */
const offensiveEnemy = (
    id: string,
    position: Position,
    selection: ParsedTarget['selection'],
    opts: { crit?: number; critDamage?: number; stealth?: boolean } = {}
): EnemyAttacker => {
    const slots: ShipSkills['slots'] = [
        {
            slot: 'active',
            abilities: [
                ...(opts.stealth ? [stealthSelfBuff(`${id}-stealth`)] : []),
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
    ];
    return {
        id,
        stats: {
            attack: 5000,
            crit: opts.crit ?? 0,
            critDamage: opts.critDamage ?? 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 1, // acts AFTER the player victim → sees the victim's Stealth
        },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget(selection),
        pattern: basePattern(),
        shipSkills: { slots } as ShipSkills,
    } as EnemyAttacker;
};

const BASE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    // Focus is a passive bystander at M1 (NON-positional → its own turn never touches HP).
    shipSkills: { slots: [noopActive] },
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
    ...overrides,
});

/** Set of actor ids that emitted ship-destroyed in this run. */
const destroyedIds = (input: CombatEngineInput): Set<string> => {
    const bus = createEventBus();
    const ids = new Set<string>();
    bus.on('ship-destroyed', (e) => ids.add(e.actorId));
    runCombat({ ...input, bus });
    return ids;
};

/** Does the victim die at HP = `hp`? (true = took >= hp damage.) */
const diesAt = (build: (hp: number) => CombatEngineInput, hp: number, victimId: string): boolean =>
    destroyedIds(build(hp)).has(victimId);

describe('D-PR3 Task 6 — Voidshade incoming %-reduction (enemy→player positional path)', () => {
    // Enemy at M1 fires `front` (base, origin-only) → anchors the front-most player at M4.
    const run = (hp: number, opts: { voidshade: boolean; stealth: boolean }): CombatEngineInput =>
        BASE({
            teamActors: [
                playerVictim('victim', 'M4', hp, {
                    passive: opts.voidshade
                        ? passiveSlotFor('voidshade-legendary', voidshadePiece)
                        : undefined,
                    stealth: opts.stealth,
                }),
            ],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1', 'front')],
        });

    it('Voidshade + Stealth: victim takes STRICTLY LESS than the unreduced 5000', () => {
        // Voidshade legendary = -20% → expected landed = 5000 × 0.8 = 4000.
        // Pin the reduced damage to (3999, 4001): dies at HP 4000 (took ≥ 4000), survives at 4001.
        const build = (hp: number) => run(hp, { voidshade: true, stealth: true });
        expect(diesAt(build, 4000, 'victim')).toBe(true);
        expect(diesAt(build, 4001, 'victim')).toBe(false);
        // And it does NOT take the full 5000: survives at HP 4500 (would die if 5000 landed).
        expect(diesAt(build, 4500, 'victim')).toBe(false);
    });

    it('control: WITHOUT Voidshade the same stealthed victim takes the FULL 5000', () => {
        const build = (hp: number) => run(hp, { voidshade: false, stealth: true });
        expect(diesAt(build, 5000, 'victim')).toBe(true); // full damage lands
        expect(diesAt(build, 5001, 'victim')).toBe(false);
        // It DOES die at 4500 here (full 5000 > 4500), unlike the Voidshade case above.
        expect(diesAt(build, 4500, 'victim')).toBe(true);
    });

    it('control: Voidshade but NOT stealthed → no reduction (full 5000 lands)', () => {
        const build = (hp: number) => run(hp, { voidshade: true, stealth: false });
        expect(diesAt(build, 5000, 'victim')).toBe(true);
        expect(diesAt(build, 5001, 'victim')).toBe(false);
        expect(diesAt(build, 4500, 'victim')).toBe(true);
    });
});

describe('D-PR3 Task 6 — Hyperion Gaze (crit by stealthed attacker only)', () => {
    // critDamage 100 → a crit doubles the hit: 5000 × (1 + 100/100) = 10000 unreduced.
    // Hyperion legendary = -35% on a crit BY a stealthed attacker → 10000 × 0.65 = 6500.
    const run = (hp: number, opts: { crit: number; attackerStealth: boolean }): CombatEngineInput =>
        BASE({
            teamActors: [
                playerVictim('victim', 'M4', hp, {
                    passive: passiveSlotFor('hyperion-legendary', hyperionPiece),
                }),
            ],
            enemyAttackers: [
                offensiveEnemy('enemy-1', 'M1', 'front', {
                    crit: opts.crit,
                    critDamage: 100,
                    stealth: opts.attackerStealth,
                }),
            ],
        });

    it('crit by a STEALTHED attacker → reduced (6500 < unreduced 10000)', () => {
        const build = (hp: number) => run(hp, { crit: 100, attackerStealth: true });
        // Reduced crit pinned to (6499, 6501): dies at 6500, survives at 6501.
        expect(diesAt(build, 6500, 'victim')).toBe(true);
        expect(diesAt(build, 6501, 'victim')).toBe(false);
        // Does NOT take the full crit (10000): survives at 7000.
        expect(diesAt(build, 7000, 'victim')).toBe(false);
    });

    it('NON-crit by a stealthed attacker → NO reduction (full 5000)', () => {
        const build = (hp: number) => run(hp, { crit: 0, attackerStealth: true });
        expect(diesAt(build, 5000, 'victim')).toBe(true);
        expect(diesAt(build, 5001, 'victim')).toBe(false);
    });

    it('crit by an UNSTEALTHED attacker → NO reduction (full crit 10000)', () => {
        const build = (hp: number) => run(hp, { crit: 100, attackerStealth: false });
        // Full crit = 10000: dies at 10000, survives at 10001. Survives at 7000 (would die if reduced to 6500? no — reduced means LESS, so it WOULD die at 7000 only if >=7000 landed).
        expect(diesAt(build, 10000, 'victim')).toBe(true);
        expect(diesAt(build, 10001, 'victim')).toBe(false);
        // Took the FULL 10000 (not the reduced 6500): dies at 7000 too.
        expect(diesAt(build, 7000, 'victim')).toBe(true);
    });
});
