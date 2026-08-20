/**
 * castRiderDeliveredBasis.integration.test.ts — a CAST `damage-dealt` rider scales off the damage
 * the cast actually DELIVERED, across its whole footprint.
 *
 * THE LOCKED RULE: "% of damage dealt" means the FINAL on-screen number — post crit, post
 * amplification, post the target's defence — summed over everyone the attack landed on. A
 * Protection redirect COUNTS (the hit landed, just on someone else); a damage-into-DoT transform
 * does NOT (nothing landed now). `SubAttackOutcome.deliveredDamage` is the one value in the engine
 * that implements that rule exactly.
 *
 * THE BUG: `basisValue`'s `damage-dealt` arm returned the local `directDamage` — the PRE-FUNNEL
 * display figure, computed once against the bound ANCHOR's defence profile before any victim is
 * struck. Two independent errors fell out of that, and every one of the seven corpus riders has an
 * AoE pattern, so both were live for all of them:
 *
 *   1. AoE UNDER-CREDIT. The anchor's share stood in for the whole footprint, so a cast that
 *      landed on three ships repaired as though it had landed on one. Measured on the real kits:
 *      Tithonus 2.02x too small, FrontLine 2.33x.
 *   2. PHANTOM CREDIT. `directDamage` is positive even when nothing landed, so a cast deferred
 *      entirely into a DoT transform — or one that struck nobody at all — still paid out in full.
 *
 * The passive-slot leech (`standingLeeches`) and the `on-crit` implant rider (Bloodthirst) were
 * already post-funnel; the CAST rider was the last one reading the stale basis.
 *
 * WHY THE FIX IS A DEFERRAL, NOT A DIFFERENT NUMBER. The delivered total does not exist when the
 * heal block runs: `runPlayerTurn` resolves the whole heal/shield pass and returns, and only THEN
 * does the engine drive the per-victim apply. So a cast carrying such a rider now defers its
 * support resolution to a thunk the engine invokes after the drive, with the cast's delivered sum.
 * Paired with the SAME condition that already defers `ability-performed` to the engine, so the two
 * cannot disagree about whether a cast is engine-resolved.
 *
 * CONSEQUENCE, ACCEPTED: for those casts the repair/shield now resolves AFTER the attack rather
 * than before it, so the combat log shows the attack line then the repair line. That is the honest
 * order — the repair is scaled off that attack.
 *
 * SCOPE. The DPS calculator never reaches this code (`simulateDPS` sets neither `healTargetId` nor
 * `mode: 'battle'`, so the whole heal block is unreachable). The healing calculator reaches
 * it but threads no positions, so no positional apply runs, nothing defers, and it keeps reading
 * `directDamage` — byte-identical, and pinned by healingGoldenParity + healing.test.ts. Only the
 * positional battle simulator changes.
 *
 * ANTI-VACUITY. Every test re-measures the delivered basis inline, so a future change that made
 * the two bases agree again turns this file red instead of hollowing it out.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { resetRateGateRng } from '../../calculators/rateAccumulator';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type AbilityPerformed = Extract<CombatEvent, { type: 'ability-performed' }>;

const HP = 10_000_000;
/** One victim's slice: attack 5000 x 100% multiplier, doubled by the guaranteed crit. */
const SLICE = 10_000;
const RIDER_PCT = 20;
/** The repair draws its OWN crit (effectiveCrit 100), which doubles it via critDamage 100. */
const riderFor = (deliveredTotal: number) => ((deliveredTotal * RIDER_PCT) / 100) * 2;

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `crd-${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

/** The shipped cast-rider shape (Opal/Iridium/Tithonus repair, FrontLine/Quixilver shield):
 *  a firing-slot heal scaling off the damage the cast deals. */
const castWithRider = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            config: { type: 'damage', multiplier: 100 },
        }),
        ab({
            type: 'heal',
            target: 'self',
            trigger: 'on-cast',
            config: { type: 'heal', pct: RIDER_PCT, basis: 'damage-dealt' },
        }),
    ],
});

/** Voron's transform: the whole post-block hit is deferred into a DoT, so nothing lands NOW. */
const voronTransform = (turns: number): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'transform-incoming-to-dot',
            target: 'self',
            trigger: 'on-attacked',
            config: { type: 'transform-incoming-to-dot', turns, condition: 'always' },
        }),
    ],
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
/** Origin + one covered cell one step toward back — the AoE footprint (M4 anchor covers M3). */
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

const enemyAt = (id: string, position: Position, slots: ShipSkills['slots'] = []) =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        affinity: 'antimatter',
        shipSkills: { slots },
    }) as EnemyAttacker;

const focusCast = (
    pattern: ParsedPattern,
    enemies: EnemyAttacker[],
    overrides: Partial<CombatEngineInput> = {}
): CombatEngineInput => ({
    attack: 5000,
    crit: 100,
    critDamage: 100,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [castWithRider()] },
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
    affinity: 'antimatter',
    defence: 0,
    hp: HP,
    hacking: 100_000,
    healTargetId: 'attacker',
    position: 'M1',
    target: parsedTarget('front'),
    pattern,
    mode: 'battle',
    enemyAttackers: enemies,
    ...overrides,
});

/** The rider's paid amounts, plus the per-sub-attack delivered figures it should have scaled off. */
const observe = (input: CombatEngineInput, attackerId = 'attacker') => {
    const bus = createEventBus();
    const repairs: number[] = [];
    const delivered: (number | undefined)[] = [];
    bus.on('heal-performed', (e) => {
        if (e.type === 'heal-performed' && e.casterId === attackerId) repairs.push(e.amount);
    });
    bus.on('ability-performed', (e: AbilityPerformed) => {
        if (e.actorId === attackerId && e.abilityType === 'damage')
            delivered.push(e.deliveredDamage);
    });
    runCombat({ ...input, bus });
    return { repairs, delivered };
};

describe('a cast damage-dealt rider scales off the whole footprint it delivered to', () => {
    afterEach(() => resetRateGateRng());

    it('an AoE cast repairs off BOTH victims, not just the anchor', () => {
        const { repairs, delivered } = observe(
            focusCast(lineRange1Pattern(), [enemyAt('v1', 'M4'), enemyAt('v2', 'M3')])
        );
        // FIXTURE GUARD: one sub-attack landing on two victims — the anchor for a full slice and
        // the covered cell for the pattern's reduced share, 15,000 together. The anchor's own
        // 10,000 is what the rider used to see, so the two bases DISAGREE here; if this ever reads
        // a bare SLICE the footprint collapsed and the assertion below proves nothing.
        const FOOTPRINT = 1.5 * SLICE;
        expect(delivered).toEqual([FOOTPRINT]);
        // Pre-fix: riderFor(SLICE) = 4000 — the anchor's share standing in for the whole cast.
        expect(repairs).toHaveLength(1);
        expect(repairs[0]).toBeCloseTo(riderFor(FOOTPRINT), 6);
    });

    it('CONTROL: a single-target cast is unchanged — one victim, one slice', () => {
        // Pins that the fix did not simply inflate every rider: with one victim the anchor share
        // IS the footprint total, so this value is identical before and after.
        const { repairs, delivered } = observe(focusCast(basePattern(), [enemyAt('v1', 'M4')]));
        expect(delivered).toEqual([SLICE]);
        expect(repairs).toHaveLength(1);
        expect(repairs[0]).toBeCloseTo(riderFor(SLICE), 6);
    });

    it('a cast fully deferred into a DoT transform repairs NOTHING', () => {
        const { repairs, delivered } = observe(
            focusCast(basePattern(), [enemyAt('v1', 'M4', [voronTransform(3)])])
        );
        // FIXTURE GUARD: the transform ran and nothing landed now.
        expect(delivered).toEqual([0]);
        // Pre-fix: 4000, paid out of a hit that dealt no damage at all.
        expect(repairs).toEqual([]);
    });
});
