import { describe, it, expect } from 'vitest';
import { LIVE_TRIGGERS, ShipSkills, type Ability } from '../../../types/abilities';
import { createEventBus, type CombatEvent } from '../events';
import { CombatActor } from '../state';
import { runCombat, CombatEngineInput } from '../engine';
import { deriveTeamEngineActors } from '../../calculators/dpsSimulator';
import { TeamActorInput } from '../../../types/calculator';
import { bareEnemy } from '../__testutils__/bareRosterFixture';

describe('shield-applied event + on-shield-applied trigger (H3.5 definitions)', () => {
    it('includes on-shield-applied in LIVE_TRIGGERS', () => {
        expect(LIVE_TRIGGERS.has('on-shield-applied')).toBe(true);
    });

    it('emits and consumes a shield-applied event with the right fields', () => {
        const bus = createEventBus();
        const captured: CombatEvent[] = [];
        bus.on('shield-applied', (e) => captured.push(e));

        bus.emit({
            type: 'shield-applied',
            granterId: 'a',
            recipientIds: ['b', 'c'],
            round: 1,
            amount: 500,
        });

        expect(captured).toHaveLength(1);
        const event = captured[0];
        expect(event.type).toBe('shield-applied');
        if (event.type === 'shield-applied') {
            expect(event.granterId).toBe('a');
            expect(event.recipientIds).toEqual(['b', 'c']);
            expect(event.round).toBe(1);
            expect(event.amount).toBe(500);
        }
    });
});

// ---------------------------------------------------------------------------
// H3.6 — emit shield-applied once per shield-application CAST (NOT per recipient).
// ---------------------------------------------------------------------------

const baseEngineInput = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: bareEnemy(),
    // Focus does NO damage and IS the heal target — it just sits and receives shield.
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
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
    hp: 40_000,
    healTargetId: 'attacker',
    mode: 'healing',
    ...overrides,
});

// A team actor whose active skill grants a Shield equal to 25% of its Max HP to ALL ALLIES.
// recipientsFor('all-allies') → playerIds = ['attacker', 'team1'].
const SHIELD_ALL_ALLIES_SKILLS = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'team-shield',
                    type: 'shield',
                    target: 'all-allies',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'shield', pct: 25, basis: 'hp' },
                },
            ],
        },
    ],
});

describe('H3.6 — shield-applied emitted once per cast', () => {
    it('cast path: an all-allies shield cast emits EXACTLY ONE shield-applied with both recipients', () => {
        const teamActors: TeamActorInput[] = [
            {
                id: 'team1',
                speed: 200, // acts before the focus so the grant lands within round 1
                selfBuffs: [],
                enemyDebuffs: [],
                chargeCount: 0,
                startCharged: false,
                shipSkills: SHIELD_ALL_ALLIES_SKILLS(),
                stats: {
                    attack: 1000,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    shieldPenetration: 0,
                    hacking: 175,
                    defence: 0,
                    hp: 50_000,
                },
            },
        ];
        const engineTeam = deriveTeamEngineActors(teamActors, undefined);

        const bus = createEventBus();
        const events: Extract<CombatEvent, { type: 'shield-applied' }>[] = [];
        bus.on('shield-applied', (e) => {
            if (e.type === 'shield-applied') events.push(e);
        });

        let captured: CombatActor[] = [];
        runCombat(
            baseEngineInput({
                teamActors: engineTeam,
                bus,
                __testTapActors: (actors) => {
                    captured = actors;
                },
            })
        );

        // Exactly ONE shield-applied for the one all-allies cast.
        expect(events).toHaveLength(1);
        const ev = events[0];
        expect(ev.granterId).toBe('team1');
        // Both recipients gained shield → both present (order = recipient routing order).
        expect([...ev.recipientIds].sort()).toEqual(['attacker', 'team1']);
        // amount = total granted = focus pool + ally pool.
        const focus = captured.find((a) => a.id === 'attacker');
        const ally = captured.find((a) => a.id === 'team1');
        expect(ev.amount).toBeCloseTo((focus?.shieldPool ?? 0) + (ally?.shieldPool ?? 0), 6);
    });

    it('reactive path: a reactive self-shield (start-of-turn, self — same executor branch as the SHIELD gear set) emits ONE shield-applied keyed on the carrier', () => {
        // The SHIELD gear set (H2) resolves to { type:'shield', target:'self',
        // trigger:'start-of-turn' } and fires through the reactive heal/shield executor. This
        // test hand-builds the identical reactive self-shield passive (mirrors
        // reactiveShieldRouting.test.ts) so it exercises the SAME executor emission site without
        // routing through the gear-build path.
        const REACTIVE_SELF_SHIELD_SKILLS = (): ShipSkills => ({
            slots: [
                { slot: 'active', abilities: [] },
                {
                    slot: 'passive',
                    abilities: [
                        {
                            id: 'reactive-self-shield',
                            type: 'shield',
                            target: 'self',
                            trigger: 'start-of-turn',
                            conditions: [],
                            config: { type: 'shield', pct: 10, basis: 'hp' },
                        },
                    ],
                },
            ],
        });

        const teamActors: TeamActorInput[] = [
            {
                id: 'team1',
                speed: 200,
                selfBuffs: [],
                enemyDebuffs: [],
                chargeCount: 0,
                startCharged: false,
                shipSkills: REACTIVE_SELF_SHIELD_SKILLS(),
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    shieldPenetration: 0,
                    hacking: 175,
                    defence: 0,
                    hp: 50_000,
                },
            },
        ];
        const engineTeam = deriveTeamEngineActors(teamActors, undefined);

        const bus = createEventBus();
        const events: Extract<CombatEvent, { type: 'shield-applied' }>[] = [];
        bus.on('shield-applied', (e) => {
            if (e.type === 'shield-applied') events.push(e);
        });

        let captured: CombatActor[] = [];
        runCombat(
            baseEngineInput({
                teamActors: engineTeam,
                bus,
                __testTapActors: (actors) => {
                    captured = actors;
                },
            })
        );

        const ally = captured.find((a) => a.id === 'team1');
        // Sanity: the reactive shield landed a pool.
        expect(ally?.shieldPool ?? 0).toBeGreaterThan(0);

        // Exactly ONE shield-applied for the reactive self-shield, keyed on the carrier.
        expect(events).toHaveLength(1);
        const ev = events[0];
        expect(ev.granterId).toBe('team1');
        expect(ev.recipientIds).toEqual(['team1']);
        expect(ev.amount).toBeCloseTo(ally?.shieldPool ?? 0, 6);
    });

    it('zero-magnitude exclusion: a 0% shield cast resolves to nothing and emits NO event', () => {
        // NOTE (#418): this case is a ZERO-MAGNITUDE grant (pct 0), NOT a saturated pool — the
        // original title claimed "recipient already at cap" and the comment it replaced admitted
        // it could not force that state. The two are different rulings: nothing was applied here,
        // so nothing is emitted, whereas a SATURATED pool DID receive a grant that was entirely
        // clipped and must emit (see the saturation test below). Nothing in the suite observed
        // saturation before #418.
        const ZERO_SHIELD_SKILLS = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'zero-shield',
                            type: 'shield',
                            target: 'self',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'shield', pct: 0, basis: 'hp' },
                        },
                    ],
                },
            ],
        });

        const bus = createEventBus();
        const events: Extract<CombatEvent, { type: 'shield-applied' }>[] = [];
        bus.on('shield-applied', (e) => {
            if (e.type === 'shield-applied') events.push(e);
        });

        runCombat(
            baseEngineInput({
                shipSkills: ZERO_SHIELD_SKILLS(),
                attack: 0,
                bus,
            })
        );

        // No recipient gained shield → no event.
        expect(events).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// #418 — a SATURATED shield pool still emits shield-applied.
//
// The heal path gates its emit on the GROSS amount (playerTurn's `healRawSum > 0`), so an
// over-repair that is entirely clipped still emits and `overheal` carries the clip. The shield
// path used to gate on POST-CAP GROWTH, so a grant onto an already-full pool emitted nothing at
// all — and `shield-applied` drives Resonating Fury (`on-shield-applied`), so shielding a
// saturated ally silently failed to trigger it.
//
// Ruling (user, 2026-08-28): "It should emit the shield-applied event, just as the heal event
// should fire on a 100% HP ship receiving overhealing." The grant DID happen; the recipient was
// simply already full.
// ---------------------------------------------------------------------------

/** Self-shield worth 100% of Max HP, cast every round. Round 1 fills the pool to the maxHp cap;
 *  round 2's identical grant is therefore entirely clipped (granted 0, gross = maxHp). */
const SATURATING_SELF_SHIELD_SKILLS = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'saturating-shield',
                    type: 'shield',
                    target: 'self',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'shield', pct: 100, basis: 'hp' },
                },
            ],
        },
    ],
});

describe('#418 — a saturated shield pool still emits shield-applied', () => {
    it('cast path: the second (fully clipped) grant emits with amount 0 and the clip in overshield', () => {
        const bus = createEventBus();
        const events: Extract<CombatEvent, { type: 'shield-applied' }>[] = [];
        bus.on('shield-applied', (e) => {
            if (e.type === 'shield-applied') events.push(e);
        });

        let captured: CombatActor[] = [];
        runCombat(
            baseEngineInput({
                shipSkills: SATURATING_SELF_SHIELD_SKILLS(),
                attack: 0,
                numRounds: 2,
                bus,
                __testTapActors: (actors) => {
                    captured = actors;
                },
            })
        );

        // Instrument check: the pool really is pinned at the maxHp cap, so round 2 really is a
        // fully-clipped grant. Without this the test could pass for the wrong reason (e.g. the
        // enemy draining the pool so round 2 legitimately grew it).
        const focus = captured.find((a) => a.id === 'attacker');
        expect(focus?.shieldPool).toBe(40_000);

        // ONE event per cast — TWO casts over two rounds, the second one entirely clipped.
        expect(events).toHaveLength(2);

        const [first, second] = events;
        // Round 1: the pool grew by the full grant, so nothing was clipped.
        expect(first.amount).toBeCloseTo(40_000, 6);
        expect(first.recipientIds).toEqual(['attacker']);
        expect(first.overshield).toBeUndefined();

        // Round 2: the grant landed on a full pool. `amount` stays REAL POOL GROWTH (0) — the UI
        // reads it as growth — and `overshield` carries the clipped portion, mirroring `overheal`.
        expect(second.recipientIds).toEqual(['attacker']);
        expect(second.amount).toBe(0);
        expect(second.overshield).toBeCloseTo(40_000, 6);
        expect(second.perTarget).toEqual([{ targetId: 'attacker', amount: 0, overshield: 40_000 }]);
    });

    it('THE SYMPTOM: Resonating Fury still fires when the grant lands on a saturated pool', () => {
        // This is why #418 is a gameplay bug and not a logging one. `shield-applied` drives
        // `on-shield-applied`, so before the fix a granter whose recipient was already full got
        // NO buff proc at all — the kit silently stopped working from the round the pool capped.
        // The listener's own defensive `recipientIds.length === 0` guard used to be unreachable
        // "by construction"; a saturated recipient is exactly the case that makes it matter.
        const RF_SKILLS = (): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'saturating-shield',
                            type: 'shield',
                            target: 'self',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'shield', pct: 100, basis: 'hp' },
                        },
                    ],
                },
                {
                    slot: 'passive',
                    abilities: [
                        {
                            id: 'resonating-fury-like',
                            type: 'buff',
                            target: 'self',
                            trigger: 'on-shield-applied',
                            conditions: [],
                            config: {
                                type: 'buff',
                                buffName: 'Crit Power Up',
                                stacks: 3,
                                duration: 1,
                                parsedEffects: {},
                            },
                        } as unknown as Ability,
                    ],
                },
            ],
        });

        const bus = createEventBus();
        const shieldEvents: Extract<CombatEvent, { type: 'shield-applied' }>[] = [];
        const buffEvents: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
        bus.on('shield-applied', (e) => {
            if (e.type === 'shield-applied') shieldEvents.push(e);
        });
        bus.on('buff-applied', (e) => {
            if (e.type === 'buff-applied' && e.buffName === 'Crit Power Up') buffEvents.push(e);
        });

        let captured: CombatActor[] = [];
        runCombat(
            baseEngineInput({
                shipSkills: RF_SKILLS(),
                attack: 0,
                numRounds: 2,
                bus,
                __testTapActors: (actors) => {
                    captured = actors;
                },
            })
        );

        // Instrument check: round 2 really was a fully-clipped grant.
        expect(captured.find((a) => a.id === 'attacker')?.shieldPool).toBe(40_000);
        expect(shieldEvents).toHaveLength(2);
        expect(shieldEvents[1].amount).toBe(0);

        // The proc fires on BOTH rounds. PRE-FIX this was 1 — the saturated round was silent.
        expect(buffEvents).toHaveLength(2);
        expect(buffEvents.map((e) => e.round)).toEqual([1, 2]);
    });

    it('reactive path (triggers.ts executor): a saturated reactive grant emits with the clip', () => {
        // Separate emit site from the two cast sites — the reactive executor. A start-of-turn
        // self-shield worth 100% of Max HP saturates on its first tick, so every later round is a
        // fully-clipped grant through THIS site.
        const REACTIVE_SATURATING_SKILLS = (): ShipSkills => ({
            slots: [
                { slot: 'active', abilities: [] },
                {
                    slot: 'passive',
                    abilities: [
                        {
                            id: 'reactive-saturating-shield',
                            type: 'shield',
                            target: 'self',
                            trigger: 'start-of-turn',
                            conditions: [],
                            config: { type: 'shield', pct: 100, basis: 'hp' },
                        },
                    ],
                },
            ],
        });

        const teamActors: TeamActorInput[] = [
            {
                id: 'team1',
                speed: 200,
                selfBuffs: [],
                enemyDebuffs: [],
                chargeCount: 0,
                startCharged: false,
                shipSkills: REACTIVE_SATURATING_SKILLS(),
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    shieldPenetration: 0,
                    hacking: 175,
                    defence: 0,
                    hp: 50_000,
                },
            },
        ];

        const bus = createEventBus();
        const events: Extract<CombatEvent, { type: 'shield-applied' }>[] = [];
        bus.on('shield-applied', (e) => {
            if (e.type === 'shield-applied') events.push(e);
        });

        let captured: CombatActor[] = [];
        runCombat(
            baseEngineInput({
                teamActors: deriveTeamEngineActors(teamActors, undefined),
                attack: 0,
                numRounds: 2,
                bus,
                __testTapActors: (actors) => {
                    captured = actors;
                },
            })
        );

        expect(captured.find((a) => a.id === 'team1')?.shieldPool).toBe(50_000);
        expect(events).toHaveLength(2);
        expect(events[0].amount).toBeCloseTo(50_000, 6);
        expect(events[0].overshield).toBeUndefined();
        expect(events[1].granterId).toBe('team1');
        expect(events[1].recipientIds).toEqual(['team1']);
        expect(events[1].amount).toBe(0);
        expect(events[1].overshield).toBeCloseTo(50_000, 6);
    });

    // ── NOT COVERED, AND MEASURED TO BE UNCOVERABLE: the dead-recipient arm ──────────────
    // `grantShieldToTarget` returns `gross: 0` for a dead victim, and that value is what would
    // keep a grant onto a CORPSE from firing Resonating Fury now that the emit gate reads `gross`.
    // No test here asserts it, because no test CAN: measured 2026-08-28 by mutating the dead arm
    // to report `gross: raw` and running this file — nothing reddened — then by logging every
    // no-op outcome the accumulator receives across `src/utils/combat` + `src/utils/calculators`,
    // which showed zero dead-recipient outcomes from the real engine closure. Two upstream filters
    // get there first:
    //   • the cast paths' `recipientsFor` never selects a dead ship (the alive-target selector gate);
    //   • the reactive executor `continue`s on `recipientHp <= 0` BEFORE its shield branch
    //     (triggers.ts, the Phase-4b KNOWN-LIMITATION-5 skip).
    // The one channel that does reach the dead arm — a damage-taken leech shield onto the corpse a
    // lethal hit just made (leech.test.ts's dead-target case) — is the engine standing-leech site,
    // which deliberately emits no `shield-applied` at all. So `gross: 0` there is a correct
    // defensive value, not a tested one. An earlier draft of this file DID ship a corpse test; it
    // used `hp: 0`, which is NEVER-ALIVE rather than KILLED, so the focus never took a turn and its
    // `expect(events).toHaveLength(0)` was 0 for the wrong reason. Do not re-add it without first
    // re-running the mutation probe above.
});
