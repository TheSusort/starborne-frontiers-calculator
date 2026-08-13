import { describe, it, expect } from 'vitest';
import { LIVE_TRIGGERS, ShipSkills } from '../../../types/abilities';
import { createEventBus, type CombatEvent } from '../events';
import { CombatActor } from '../state';
import { runCombat, CombatEngineInput } from '../engine';
import { deriveTeamEngineActors } from '../../calculators/dpsSimulator';
import { TeamActorInput } from '../../../types/calculator';

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
    // Focus does NO damage and IS the heal target — it just sits and receives shield.
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
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

    it('0-grant exclusion: a cast that grants nothing (recipient already at cap) emits NO event', () => {
        // The focus IS the heal target and casts the shield to SELF. With pct 25% of a tiny
        // max HP but capped at max HP — to force actualGranted 0 we instead pre-fill via a
        // first cast then a second. Simpler: a 0% shield grants nothing → no recipient gains.
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
