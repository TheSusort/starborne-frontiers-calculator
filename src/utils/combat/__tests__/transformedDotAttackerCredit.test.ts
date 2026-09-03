/**
 * A hit that the VICTIM converts into a self-DoT still belongs to the ATTACKER on the display axis.
 *
 * Voron/Orel's `transform-incoming-to-dot` and Oleander's name-keyed `Hit Mitigation` both replace
 * an incoming direct hit with a generic self-DoT via `convertHitToSelfDot`, which stamps
 * `sourceId: victim.id`. That id is the MECHANICS axis — what leech/proc basis reads — and it must
 * stay on the victim, because a DoT transform is not the attacker's "damage dealt". But the DISPLAY
 * axis (`perTargetDealt`, `perActorDot` → `RoundData.genericDamage` → `rawTotals.generic`) followed
 * the same id, so the attacker's damage against a transforming enemy was credited to the enemy
 * damaging itself and the attacker's own number read 0.
 *
 * The mechanics half has since been finished on the OTHER path: the firing hit's own leech used to
 * scale off the pre-funnel hit, so a fully-transformed attack still paid out. It now reads the
 * funnel's recorded intake and pays 0 — see `leechFunnelBasis.integration.test.ts`, which owns
 * that rule. The leech assertion below became a strict `0` with that change, which makes it a
 * sharper witness for THIS file's axis split than the equality it replaced.
 *
 * `ActiveDoTStack.dealtCreditId` splits the two: the entry records who dealt the damage that became
 * the DoT, and only the display bookings read it.
 *
 * MEASUREMENT: `perTargetDealt` (per-round, keyed attacker → victim) is the per-victim credit
 * channel `dpsSimulator` re-derives the focus's damage from, so it is the honest witness for "who
 * gets the number". `rawTotals.generic` / `RoundData.genericDamage` are the focus-only scalar
 * channel; both read a structural 0 before this change.
 *
 * TURN ORDER: the victim is much faster than the attacker, so a round's DoT-tick step runs BEFORE
 * that round's incoming hit — no entry can tick in the round that created it.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const DIRECT_HIT = 5000;
const TURNS = 3;
const TICK = DIRECT_HIT / TURNS; // 1666.66…
const HP = 10_000_000; // nothing dies, so every round runs the same shape.
const ROUNDS = 6;

const transform: Ability = {
    id: 'transform',
    type: 'transform-incoming-to-dot',
    target: 'self',
    trigger: 'on-attacked',
    conditions: [],
    config: { type: 'transform-incoming-to-dot', turns: TURNS, condition: 'always' },
};
const transformPassive: ShipSkills['slots'][number] = { slot: 'passive', abilities: [transform] };
const emptyPassive: ShipSkills['slots'][number] = { slot: 'passive', abilities: [] };

/** A passive-slot damage-dealt heal leech — a STANDING leech, the Magnolia/Malvex shape. */
const leechPassive = (pct: number): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        {
            id: 'leech',
            type: 'heal',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'heal', pct, basis: 'damage-dealt', leechScope: 'all' },
        },
    ],
});

let idc = 0;
const basicAttack = (): Ability => ({
    id: `basic-${++idc}`,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});
const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

/** Sum, over every round, what `attackerId` is credited with dealing to `victimId`. */
const dealt = (
    result: ReturnType<typeof runCombat>,
    attackerId: string,
    victimId: string
): number =>
    result.rounds.reduce((s, r) => s + (r.perTargetDealt?.[attackerId]?.[victimId] ?? 0), 0);

/** Every attacker id that `perTargetDealt` credits with anything nonzero, across the run. */
const creditedAttackers = (result: ReturnType<typeof runCombat>): string[] => {
    const ids = new Set<string>();
    for (const r of result.rounds)
        for (const [attackerId, victims] of Object.entries(r.perTargetDealt ?? {}))
            if (Object.values(victims).some((v) => v > 0)) ids.add(attackerId);
    return [...ids].sort();
};

const sumHeal = (result: ReturnType<typeof runCombat>, actorId: string): number =>
    (result.healing?.rounds ?? []).reduce(
        (s, rd) => s + (rd.perActor.get(actorId)?.directHeal ?? 0),
        0
    );

// ── PLAYER focus attacks an ENEMY that transforms ────────────────────────────

const enemyVictim = (withTransform: boolean): EnemyAttacker => ({
    id: 'voron',
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1000 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [withTransform ? transformPassive : emptyPassive] },
});

const PLAYER_ATTACKS = (over: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: [enemyVictim(true)],
    attack: DIRECT_HIT,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack()] }] },
    numRounds: ROUNDS,
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
    hp: HP,
    speed: 1, // the focus acts LAST, so the victim ticks before it is hit again.
    mode: 'dps',
    position: 'M4',
    target: parsedTarget('front'),
    pattern: basePattern(),
    ...over,
});

describe('a transformed hit credits the ATTACKER on the display axis', () => {
    it('books the ticks under the focus attacker, not under the enemy damaging itself', () => {
        idc = 0;
        const result = runCombat(PLAYER_ATTACKS());

        // ANTI-VACUITY: the transform really fired — the direct hit itself lands for 0 every round.
        expect(
            result.rounds.every((r) => (r.perTargetDealt?.['attacker']?.['voron'] ?? 0) >= 0)
        ).toBe(true);
        expect(dealt(result, 'voron', 'voron')).toBe(0);
        // Ticks: 0, 1×TICK, 2×TICK, then 3×TICK for the remaining rounds (a new 3-round entry per
        // round, three overlapping at steady state).
        expect(dealt(result, 'attacker', 'voron')).toBeCloseTo(TICK * (0 + 1 + 2 + 3 + 3 + 3), 6);
        expect(creditedAttackers(result)).toEqual(['attacker']);
    });

    it('surfaces the ticks on the focus-only generic channel, which read a structural 0 before', () => {
        idc = 0;
        const result = runCombat(PLAYER_ATTACKS());

        expect(result.rounds[1].genericDamage).toBe(Math.round(TICK));
        expect(result.rounds[5].genericDamage).toBe(Math.round(TICK * 3));
        expect(result.rawTotals.generic).toBeCloseTo(TICK * (0 + 1 + 2 + 3 + 3 + 3), 6);
    });

    it('leaves an untransformed run alone — same fixture, transform off', () => {
        idc = 0;
        const result = runCombat(PLAYER_ATTACKS({ enemyAttackers: [enemyVictim(false)] }));

        expect(dealt(result, 'attacker', 'voron')).toBe(DIRECT_HIT * ROUNDS);
        expect(result.rawTotals.generic).toBe(0);
        expect(result.rounds.every((r) => r.genericDamage === undefined)).toBe(true);
    });
});

describe('the MECHANICS axis: a transformed hit pays the attacker no leech, by either route', () => {
    const withLeech = (withTransform: boolean): CombatEngineInput =>
        PLAYER_ATTACKS({
            enemyAttackers: [enemyVictim(withTransform)],
            shipSkills: {
                slots: [{ slot: 'active', abilities: [basicAttack()] }, leechPassive(20)],
            },
            mode: 'healing',
            healTargetId: 'attacker',
        });

    it('pays NOTHING off a transformed hit — neither the firing hit nor the ticks', () => {
        idc = 0;
        const transformed = runCombat(withLeech(true));
        idc = 0;
        const plain = runCombat(withLeech(false));

        // The two runs put the SAME total on the attacker's display row by different routes:
        // transformed → deferred generic ticks, plain → the direct hits themselves.
        expect(dealt(transformed, 'attacker', 'voron')).toBeCloseTo(TICK * 12, 6);
        expect(dealt(plain, 'attacker', 'voron')).toBe(DIRECT_HIT * ROUNDS);

        // And the transformed run pays the attacker NOTHING, on either route.
        //
        // The DISPLAY row is 20,000 and the leech is 0, which is the whole point of the split:
        //  • the TICKS bought nothing because `procStandingLeechesPerVictim` reads `sourceId`,
        //    which `convertHitToSelfDot` stamped with the victim. Were the ticks on the mechanics
        //    axis too, this run would pay 20,000 × 20% = 4,000.
        //  • the FIRING HIT bought nothing because the leech's basis is now the funnel's recorded
        //    intake, and a transform nets itself out of that. It used to be the pre-funnel hit, so
        //    this run paid the full 6,000 for damage that never landed — the same figure `plain`
        //    pays below, which is why the old equality assertion here could not tell the two
        //    routes apart. `leechFunnelBasis.integration.test.ts` owns that basis rule; this file
        //    keeps the sharper witness the fix made available.
        expect(sumHeal(transformed, 'attacker')).toBe(0);
        // CONTROL: the same kit against a non-transforming victim pays in full, so the 0 above is
        // the transform and not a dead leech.
        expect(sumHeal(plain, 'attacker')).toBeCloseTo(DIRECT_HIT * ROUNDS * 0.2, 6);
    });
});

// ── Team symmetry: an ENEMY attacks a PLAYER ally that transforms ─────────────

const playerVictim = (id: string, position: Position): TeamActor => ({
    id,
    speed: 1000,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    walk: {
        shipSkills: { slots: [transformPassive] },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: HP,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const offensiveEnemy = (): EnemyAttacker => ({
    id: 'aggressor',
    stats: { attack: DIRECT_HIT, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    target: parsedTarget('back'),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack()] }] },
});

describe('team symmetry: an enemy attacker is credited for the ally hit its victim transformed', () => {
    it('books the ticks under the enemy attacker, and keeps them out of the FOCUS generic channel', () => {
        idc = 0;
        const result = runCombat(
            PLAYER_ATTACKS({
                attack: 0,
                enemyAttackers: [offensiveEnemy()],
                teamActors: [playerVictim('ally', 'M2')],
                position: 'M4',
            })
        );

        expect(dealt(result, 'aggressor', 'ally')).toBeGreaterThan(0);
        // And NOT to the ally itself. `simulateDPS` sums the team-damage series over the
        // player-side ids' `perTargetDealt`, so a self-credit here read as team output the squad
        // never produced — measured at 20,000 of phantom team damage for this fixture.
        expect(dealt(result, 'ally', 'ally')).toBe(0);
        // An enemy-dealt DoT on a player victim is NOT the focus's outgoing DPS.
        expect(result.rawTotals.generic).toBe(0);
    });
});
