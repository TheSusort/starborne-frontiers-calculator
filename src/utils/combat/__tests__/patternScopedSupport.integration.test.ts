import { describe, it, expect } from 'vitest';
import { parsePattern, parseTarget } from '../../targetingParser';
import { runCombat, type CombatEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import { createEventBus, type CombatEvent } from '../events';

const supportPattern = () => parsePattern('Pattern-Line-Support-Range-1');
const alliesTarget = () => parseTarget('allies');

const allAlliesBuff = (): Ability => ({
    id: 'support-buff',
    type: 'buff',
    target: 'all-allies',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Speed Up I',
        parsedEffects: { speed: 15 },
        stacks: 1,
        isStackable: false,
        duration: 2,
    },
});

const noopAttack = (): Ability => ({
    id: 'noop',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0, hits: 1 },
});

const collectBuffApplied = (events: CombatEvent[]): string[] =>
    events
        .filter(
            (e): e is Extract<CombatEvent, { type: 'buff-applied' }> => e.type === 'buff-applied'
        )
        .map((e) => e.actorId);

const baseEngineInput = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [noopAttack()] }] },
    enemyDefense: 0,
    enemyHp: 1_000_000,
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
    position: 'M1',
    ...overrides,
});

describe('pattern-scoped support (on-cast buffs)', () => {
    it('all-allies buff only lands on allies in the support footprint', () => {
        const events: CombatEvent[] = [];
        const bus = createEventBus();
        bus.on('buff-applied', (e) => events.push(e));

        const input = baseEngineInput({
            target: parseTarget('front'),
            pattern: parsePattern('Pattern-Base'),
            teamActors: [
                {
                    id: 'supporter',
                    speed: 300,
                    chargeCount: 0,
                    startCharged: false,
                    selfBuffs: [],
                    enemyDebuffs: [],
                    position: 'M3',
                    target: alliesTarget(),
                    pattern: supportPattern(),
                    walk: {
                        shipSkills: {
                            slots: [{ slot: 'active', abilities: [allAlliesBuff()] }],
                        } as ShipSkills,
                        stats: {
                            attack: 0,
                            crit: 0,
                            critDamage: 0,
                            defensePenetration: 0,
                            hacking: 0,
                            defence: 0,
                            hp: 50_000,
                        },
                        selfDotModifier: 0,
                        defensePenetrationBuff: 0,
                        affinityDamageModifier: 0,
                        affinityCritCap: 100,
                        affinityCritPenalty: 0,
                        hasChargedSkill: false,
                    },
                },
                {
                    id: 'inpattern',
                    speed: 100,
                    chargeCount: 0,
                    startCharged: false,
                    selfBuffs: [],
                    enemyDebuffs: [],
                    position: 'M4',
                    target: alliesTarget(),
                    pattern: supportPattern(),
                    walk: {
                        shipSkills: { slots: [{ slot: 'active', abilities: [noopAttack()] }] },
                        stats: {
                            attack: 0,
                            crit: 0,
                            critDamage: 0,
                            defensePenetration: 0,
                            hacking: 0,
                            defence: 0,
                            hp: 50_000,
                        },
                        selfDotModifier: 0,
                        defensePenetrationBuff: 0,
                        affinityDamageModifier: 0,
                        affinityCritCap: 100,
                        affinityCritPenalty: 0,
                        hasChargedSkill: false,
                    },
                },
                {
                    id: 'offpattern',
                    speed: 100,
                    chargeCount: 0,
                    startCharged: false,
                    selfBuffs: [],
                    enemyDebuffs: [],
                    position: 'M2',
                    target: alliesTarget(),
                    pattern: supportPattern(),
                    walk: {
                        shipSkills: { slots: [{ slot: 'active', abilities: [noopAttack()] }] },
                        stats: {
                            attack: 0,
                            crit: 0,
                            critDamage: 0,
                            defensePenetration: 0,
                            hacking: 0,
                            defence: 0,
                            hp: 50_000,
                        },
                        selfDotModifier: 0,
                        defensePenetrationBuff: 0,
                        affinityDamageModifier: 0,
                        affinityCritCap: 100,
                        affinityCritPenalty: 0,
                        hasChargedSkill: false,
                    },
                },
            ],
            enemyAttackers: [
                {
                    id: 'e1',
                    stats: {
                        attack: 0,
                        crit: 0,
                        critDamage: 0,
                        speed: 1,
                        defence: 0,
                        hp: 1_000_000,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M4',
                    target: parseTarget('front'),
                    pattern: parsePattern('Pattern-Base'),
                    shipSkills: { slots: [{ slot: 'active', abilities: [noopAttack()] }] },
                },
            ],
            bus,
        });

        runCombat(input);

        const buffRecipients = collectBuffApplied(events);
        expect(buffRecipients).toContain('inpattern');
        expect(buffRecipients).toContain('supporter');
        expect(buffRecipients).not.toContain('offpattern');
        expect(buffRecipients).not.toContain('attacker');
    });

    it('all-allies shield cast only shields allies in the support footprint', () => {
        const events: CombatEvent[] = [];
        const bus = createEventBus();
        bus.on('shield-applied', (e) => events.push(e));

        const allAlliesShield = (): Ability => ({
            id: 'support-shield',
            type: 'shield',
            target: 'all-allies',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'shield', pct: 25, basis: 'hp' },
        });

        runCombat(
            baseEngineInput({
                teamActors: [
                    {
                        id: 'supporter',
                        speed: 300,
                        chargeCount: 0,
                        startCharged: false,
                        selfBuffs: [],
                        enemyDebuffs: [],
                        position: 'M3',
                        target: alliesTarget(),
                        pattern: supportPattern(),
                        walk: {
                            shipSkills: {
                                slots: [{ slot: 'active', abilities: [allAlliesShield()] }],
                            } as ShipSkills,
                            stats: {
                                attack: 0,
                                crit: 0,
                                critDamage: 0,
                                defensePenetration: 0,
                                hacking: 0,
                                defence: 0,
                                hp: 40_000,
                            },
                            selfDotModifier: 0,
                            defensePenetrationBuff: 0,
                            affinityDamageModifier: 0,
                            affinityCritCap: 100,
                            affinityCritPenalty: 0,
                            hasChargedSkill: false,
                        },
                    },
                    {
                        id: 'inpattern',
                        speed: 100,
                        chargeCount: 0,
                        startCharged: false,
                        selfBuffs: [],
                        enemyDebuffs: [],
                        position: 'M4',
                        target: alliesTarget(),
                        pattern: supportPattern(),
                        walk: {
                            shipSkills: { slots: [{ slot: 'active', abilities: [noopAttack()] }] },
                            stats: {
                                attack: 0,
                                crit: 0,
                                critDamage: 0,
                                defensePenetration: 0,
                                hacking: 0,
                                defence: 0,
                                hp: 40_000,
                            },
                            selfDotModifier: 0,
                            defensePenetrationBuff: 0,
                            affinityDamageModifier: 0,
                            affinityCritCap: 100,
                            affinityCritPenalty: 0,
                            hasChargedSkill: false,
                        },
                    },
                    {
                        id: 'offpattern',
                        speed: 100,
                        chargeCount: 0,
                        startCharged: false,
                        selfBuffs: [],
                        enemyDebuffs: [],
                        position: 'M2',
                        target: alliesTarget(),
                        pattern: supportPattern(),
                        walk: {
                            shipSkills: { slots: [{ slot: 'active', abilities: [noopAttack()] }] },
                            stats: {
                                attack: 0,
                                crit: 0,
                                critDamage: 0,
                                defensePenetration: 0,
                                hacking: 0,
                                defence: 0,
                                hp: 40_000,
                            },
                            selfDotModifier: 0,
                            defensePenetrationBuff: 0,
                            affinityDamageModifier: 0,
                            affinityCritCap: 100,
                            affinityCritPenalty: 0,
                            hasChargedSkill: false,
                        },
                    },
                ],
                enemyAttackers: [
                    {
                        id: 'e1',
                        stats: {
                            attack: 0,
                            crit: 0,
                            critDamage: 0,
                            speed: 1,
                            defence: 0,
                            hp: 1_000_000,
                        },
                        chargeCount: 0,
                        startCharged: false,
                        position: 'M4',
                        target: parseTarget('front'),
                        pattern: parsePattern('Pattern-Base'),
                        shipSkills: { slots: [{ slot: 'active', abilities: [noopAttack()] }] },
                    },
                ],
                bus,
            })
        );

        const shieldEvents = events.filter(
            (e): e is Extract<CombatEvent, { type: 'shield-applied' }> =>
                e.type === 'shield-applied'
        );
        expect(shieldEvents.length).toBeGreaterThan(0);
        const recipients = shieldEvents.flatMap((e) => e.recipientIds);
        expect(recipients).toContain('inpattern');
        expect(recipients).toContain('supporter');
        expect(recipients).not.toContain('offpattern');
        expect(recipients).not.toContain('attacker');
    });

    it('start-of-round ally charge grant only bumps allies in the support footprint', () => {
        const events: CombatEvent[] = [];
        const bus = createEventBus();
        bus.on('charge-changed', (e) => events.push(e));

        const chargeGrant = (): Ability => ({
            id: 'sor-grant',
            type: 'charge',
            target: 'all-allies',
            trigger: 'start-of-round',
            conditions: [],
            config: { type: 'charge', amount: 1 },
        });

        runCombat(
            baseEngineInput({
                chargeCount: 3,
                teamActors: [
                    {
                        id: 'supporter',
                        speed: 300,
                        chargeCount: 0,
                        startCharged: false,
                        selfBuffs: [],
                        enemyDebuffs: [],
                        position: 'M3',
                        target: alliesTarget(),
                        pattern: supportPattern(),
                        walk: {
                            shipSkills: {
                                slots: [{ slot: 'passive', abilities: [chargeGrant()] }],
                            } as ShipSkills,
                            stats: {
                                attack: 0,
                                crit: 0,
                                critDamage: 0,
                                defensePenetration: 0,
                                hacking: 0,
                                defence: 0,
                                hp: 50_000,
                            },
                            selfDotModifier: 0,
                            defensePenetrationBuff: 0,
                            affinityDamageModifier: 0,
                            affinityCritCap: 100,
                            affinityCritPenalty: 0,
                            hasChargedSkill: false,
                        },
                    },
                    {
                        id: 'inpattern',
                        speed: 100,
                        chargeCount: 3,
                        startCharged: false,
                        selfBuffs: [],
                        enemyDebuffs: [],
                        position: 'M4',
                        target: alliesTarget(),
                        pattern: supportPattern(),
                        walk: {
                            shipSkills: { slots: [{ slot: 'active', abilities: [noopAttack()] }] },
                            stats: {
                                attack: 0,
                                crit: 0,
                                critDamage: 0,
                                defensePenetration: 0,
                                hacking: 0,
                                defence: 0,
                                hp: 50_000,
                            },
                            selfDotModifier: 0,
                            defensePenetrationBuff: 0,
                            affinityDamageModifier: 0,
                            affinityCritCap: 100,
                            affinityCritPenalty: 0,
                            hasChargedSkill: false,
                        },
                    },
                    {
                        id: 'offpattern',
                        speed: 100,
                        chargeCount: 3,
                        startCharged: false,
                        selfBuffs: [],
                        enemyDebuffs: [],
                        position: 'M2',
                        target: alliesTarget(),
                        pattern: supportPattern(),
                        walk: {
                            shipSkills: { slots: [{ slot: 'active', abilities: [noopAttack()] }] },
                            stats: {
                                attack: 0,
                                crit: 0,
                                critDamage: 0,
                                defensePenetration: 0,
                                hacking: 0,
                                defence: 0,
                                hp: 50_000,
                            },
                            selfDotModifier: 0,
                            defensePenetrationBuff: 0,
                            affinityDamageModifier: 0,
                            affinityCritCap: 100,
                            affinityCritPenalty: 0,
                            hasChargedSkill: false,
                        },
                    },
                ],
                enemyAttackers: [
                    {
                        id: 'e1',
                        stats: {
                            attack: 0,
                            crit: 0,
                            critDamage: 0,
                            speed: 1,
                            defence: 0,
                            hp: 1_000_000,
                        },
                        chargeCount: 0,
                        startCharged: false,
                        position: 'M4',
                        target: parseTarget('front'),
                        pattern: parsePattern('Pattern-Base'),
                        shipSkills: { slots: [{ slot: 'active', abilities: [noopAttack()] }] },
                    },
                ],
                bus,
            })
        );

        const charged = events
            .filter(
                (e): e is Extract<CombatEvent, { type: 'charge-changed' }> =>
                    e.type === 'charge-changed'
            )
            .map((e) => e.actorId);
        expect(charged).toContain('inpattern');
        expect(charged).not.toContain('offpattern');
        expect(charged).not.toContain('attacker');
    });
});
