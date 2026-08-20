/**
 * Sentinel's on-ally-crit passive — once per ATTACK, routed to the enemies that actually CRIT.
 *
 * USER-REPORTED BUG (combat log, Ruiner's turn — a 3-victim AoE where the SELECTED target
 * Heliodor did not crit but Hermes and Cultivator did):
 *
 *     Ruiner [active]
 *     Enemy Heliodor: 13,985 → 76%
 *     Enemy Hermes: 9,888 (crit)
 *     Enemy Cultivator: 11,664 (crit)
 *     ↳ reacts: Sentinel heals → Ruiner: 1,152     <- twice: one per critting hit
 *     ↳ reacts: Sentinel heals → Ruiner: 1,152
 *     ↳ reacts: Sentinel → Enemy Heliodor: 1,588   <- both on the ANCHOR, which never crit
 *     ↳ reacts: Sentinel → Enemy Heliodor: 1,588
 *
 * TWO root causes, both in the `on-ally-crit` listener (triggers.ts):
 *   1. It enqueued the intent `critHits` times — once per critting (hit, victim) pair — so the
 *      ally repair landed once per crit instead of once per attack. "When an ally critically hits
 *      an enemy, this Unit repairs the ally" is ONE reaction to ONE attack.
 *   2. It stamped `counterTargetId: e.targetId`. `ability-performed.targetId` is the cast's
 *      SELECTED anchor, and `critHits` is a bare COUNT — the crit IDENTITY resolved per victim in
 *      positionalApply was discarded. So "deals 60% damage to that enemy" dumped every proc on the
 *      anchor, which in an AoE is frequently a victim that never crit.
 *
 * Fixed by carrying `critVictimIds` (the DISTINCT crit victims) on `ability-performed` and
 * enqueuing ONCE per critting attack, with the damage executor fanning out over that set.
 *
 * Everything runs through the REAL production path — Sentinel's verbatim R2 passive text from
 * docs/ship-skills.csv through buildShipAbilities, driven by runCombat.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { setRateGateRng, setupKeyedTestRng } from '../../calculators/rateAccumulator';
import { Ship, AffinityName } from '../../../types/ship';
import { Ability } from '../../../types/abilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}], ...over } as Ship;
}

/** Sentinel's R2 (refit-active at 2 refits) passive, verbatim from docs/ship-skills.csv. */
const SENTINEL_R2 =
    'When an ally critically hits an enemy, this Unit ' +
    "<unit-damage>repairs the ally for 5%</unit-damage> of this Unit's Max HP and deals " +
    '<unit-damage>60% damage</unit-damage> to that enemy.<br />This attack cannot critically hit.';

function sentinelPassiveAbilities(): Ability[] {
    return (
        buildShipAbilities(ship({ secondPassiveSkillText: SENTINEL_R2 })).slots.find(
            (s) => s.slot === 'passive'
        )?.abilities ?? []
    );
}

describe('Sentinel R2 riders — extracted shape (mutation guard)', () => {
    it('an ally-targeted heal and an enemy-targeted damage both ride on-ally-crit', () => {
        const abilities = sentinelPassiveAbilities();
        const heal = abilities.find((a) => a.config.type === 'heal');
        const damage = abilities.find((a) => a.config.type === 'damage');
        if (!heal || !damage) throw new Error('mutation guard: Sentinel R2 riders not found');
        expect(heal.trigger).toBe('on-ally-crit');
        expect(heal.target).toBe('ally');
        expect(damage.trigger).toBe('on-ally-crit');
        expect(damage.target).toBe('enemy');
    });
});

const SENTINEL_MAX_HP = 20_000;

/** Sentinel as a team actor: carries only its real passive; acts last (speed 1) so the ally's
 *  crit precedes its own turn, and deals no damage of its own. */
const sentinel = (position: Position): TeamActorEngineInput =>
    ({
        id: 'sentinel',
        speed: 1,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        walk: {
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            {
                                id: 'noop',
                                type: 'damage',
                                target: 'enemy',
                                trigger: 'on-cast',
                                conditions: [],
                                config: { type: 'damage', multiplier: 0 },
                            },
                        ],
                    },
                    { slot: 'passive', abilities: sentinelPassiveAbilities() },
                ],
            },
            stats: {
                attack: 1000,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: SENTINEL_MAX_HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as TeamActorEngineInput;

const dummyEnemy = (id: string, position: Position, affinity: AffinityName): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        affinity,
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'noop',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 0 },
                        },
                    ],
                },
            ],
        },
    }) as EnemyAttacker;

/**
 * The focus ally fires a single-hit AoE (Pattern-Line-Range-1) at 'front'. The anchor is
 * `enemy-anchor` @ M4; `enemy-covered` @ M3 is the covered footprint victim.
 *
 * The split (anchor does NOT crit, covered victim DOES) is made deterministic by AFFINITY rather
 * than by scripting draw order — the crit gate is a real random sample, so both victims would
 * otherwise share one rate. The focus attacker is thermal at 25 crit:
 *   - vs the ELECTRIC anchor it is at a disadvantage → cap 75, penalty 25 → rate max(0, 25-25) = 0
 *     → `rng() < 0` is false for ANY rng value: the anchor can never crit.
 *   - vs the ANTIMATTER covered victim the matchup is neutral → rate 0.25 → `rng() = 0` crits.
 * With the RNG pinned at 0 both outcomes are forced, and this is exactly the reported shape:
 * the cast's selected target did not crit while a splash victim did.
 */
function runAoE(anchorAffinity: AffinityName = 'electric'): {
    reactiveDamage: Extract<CombatEvent, { type: 'reactive-damage-performed' }>[];
    reactiveHeals: Extract<CombatEvent, { type: 'reactive-heal-performed' }>[];
} {
    setRateGateRng(() => 0);

    const input: CombatEngineInput = {
        attack: 1000,
        crit: 25, // disadvantage penalty zeroes this vs the anchor; stays 25% vs the covered victim
        critDamage: 100,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'aoe',
                            type: 'damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'damage', multiplier: 100 },
                        },
                    ],
                },
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
        hp: 1_000_000_000,
        speed: 500, // acts before Sentinel
        affinity: 'thermal', // electric holds advantage over thermal → disadvantaged vs the anchor
        healTargetId: 'sentinel',
        mode: 'healing',
        position: 'M1',
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Line-Range-1'),
        teamActors: [sentinel('M2')],
        enemyAttackers: [
            dummyEnemy('enemy-anchor', 'M4', anchorAffinity),
            dummyEnemy('enemy-covered', 'M3', 'antimatter'),
        ],
    };

    const bus = createEventBus();
    const reactiveDamage: Extract<CombatEvent, { type: 'reactive-damage-performed' }>[] = [];
    const reactiveHeals: Extract<CombatEvent, { type: 'reactive-heal-performed' }>[] = [];
    bus.on('reactive-damage-performed', (e) => {
        if (e.sourceId === 'sentinel') reactiveDamage.push(e);
    });
    bus.on('reactive-heal-performed', (e) => {
        if (e.casterId === 'sentinel') reactiveHeals.push(e);
    });
    runCombat({ ...input, bus });
    return { reactiveDamage, reactiveHeals };
}

describe('Sentinel on-ally-crit — attack-scoped repair, crit-victim-scoped damage', () => {
    // src/setupTests.ts installs the seeded RNG per test; restore it after the scripted override.
    afterEach(() => setupKeyedTestRng(12345));

    it('repairs the critting ally ONCE for the whole attack, not once per critting hit', () => {
        const { reactiveHeals } = runAoE();
        expect(reactiveHeals).toHaveLength(1);
        expect(reactiveHeals[0].perTarget.map((pt) => pt.targetId)).toEqual(['attacker']);
    });

    it('lands its 60% damage on the enemy that CRIT, never on the non-critting anchor', () => {
        const { reactiveDamage } = runAoE();
        expect(reactiveDamage.map((e) => e.targetId)).toEqual(['enemy-covered']);
        // The reported bug: both procs landed on 'enemy-anchor', which never crit.
        expect(reactiveDamage.some((e) => e.targetId === 'enemy-anchor')).toBe(false);
    });

    // The reported shape verbatim: ONE AoE crits TWO enemies. Making the anchor antimatter puts
    // the attacker at a neutral matchup against both victims, so both crit off the pinned RNG.
    it('with TWO crit victims: one repair for the attack, one 60% hit per crit victim', () => {
        const { reactiveDamage, reactiveHeals } = runAoE('antimatter');
        // Was 2 repairs (one per critting hit) — "Sentinel heals → Ruiner: 1,152" twice.
        expect(reactiveHeals).toHaveLength(1);
        // Was 2 hits BOTH on the anchor; now one hit per DISTINCT crit victim.
        expect(reactiveDamage.map((e) => e.targetId).sort()).toEqual([
            'enemy-anchor',
            'enemy-covered',
        ]);
    });
});
