/**
 * Owner-vs-target stat gates (`stat-vs-target`) read LIVE stats on both sides: Speed Up/Down and
 * Crit Power Up/Down count for the acting unit AND for the unit it is compared against.
 *
 *  - Bayah's charged Stasis: "If this Unit has more Crit Power than the enemy".
 *  - Chakara's charge gain: "If all damaged enemies have more Speed than this Unit".
 *
 * Every case is a two-arm fixture whose arms differ ONLY in the payload of one marker cast (a real
 * stat debuff/buff vs. an inert marker carrying no effects), so a flip is attributable to the
 * live stat alone. The base stats are chosen so the BASE comparison and the LIVE comparison
 * disagree. The ENEMY-side cases run the same kits from the enemy roster.
 *
 * The kits are the production parser's output for the catalogue wording of each skill.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedBuffEffects } from '../../../types/calculator';
import type { Ship } from '../../../types/ship';
import { bareEnemy } from '../__testutils__/bareRosterFixture';

const BAYAH_CHARGE =
    'This Unit deals <unit-damage>150% damage</unit-damage> plus an additional amount equal to <unit-damage>30%</unit-damage> of its Defense and inflicts <unit-skill>Crit Rate Down II</unit-skill> for 2 turns. If this Unit has more Crit Power than the target, it inflicts <unit-skill>Stasis</unit-skill> for 1 turn.';
const CHAKARA_ACTIVE =
    'This Unit deals <unit-damage>180% damage</unit-damage> with additional damage equal to <unit-damage>80%</unit-damage> of its Defense. If all damaged enemies have more Speed than this Unit, it <unit-aid>adds 1 charge</unit-aid> to its Charged Skill.';

const parsedSlot = (slot: 'active' | 'charged', ship: Partial<Ship>): Ability[] => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const built = buildShipAbilities({ ...({} as any), refits: [{}, {}, {}, {}], ...ship } as Ship);
    const found = built.slots.find((s) => s.slot === slot);
    if (!found) throw new Error(`no ${slot} slot built`);
    return found.abilities;
};
const bayahCharged = () =>
    parsedSlot('charged', { chargeSkillText: BAYAH_CHARGE, chargeSkillCharge: 2 });
const chakaraActive = () => parsedSlot('active', { activeSkillText: CHAKARA_ACTIVE });

const MARKER = 'Inert Marker';

/** A debuff/buff cast whose payload is the only thing that differs between arms. */
const marker = (
    target: 'enemy' | 'self',
    buffName: string,
    parsedEffects: ParsedBuffEffects
): Ability => ({
    id: `marker-${target}`,
    type: target === 'enemy' ? 'debuff' : 'buff',
    target,
    trigger: 'on-cast',
    conditions: [],
    config:
        target === 'enemy'
            ? {
                  type: 'debuff',
                  buffName,
                  parsedEffects,
                  stacks: 1,
                  isStackable: false,
                  duration: 20,
                  application: 'apply',
              }
            : {
                  type: 'buff',
                  buffName,
                  parsedEffects,
                  stacks: 1,
                  isStackable: false,
                  duration: 20,
              },
});

const collect = (input: CombatEngineInput): CombatEvent[] => {
    const events: CombatEvent[] = [];
    const bus = createEventBus();
    bus.on('control-applied', (e) => events.push(e));
    bus.on('charge-changed', (e) => events.push(e));
    runCombat({ ...input, bus });
    return events;
};

const stasisBy = (events: CombatEvent[], casterId: string) =>
    events.filter(
        (e) => e.type === 'control-applied' && e.casterId === casterId && e.effect === 'stasis'
    );
const grantsBy = (events: CombatEvent[], actorId: string) =>
    events.filter(
        (e) => e.type === 'charge-changed' && e.actorId === actorId && e.reason === 'manip'
    );

const BASE_INPUT = {
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    numRounds: 4,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000,
    speed: 100,
} satisfies Omit<CombatEngineInput, 'enemyAttackers'>;

const base = (
    over: Pick<CombatEngineInput, 'enemyAttackers'> & Partial<CombatEngineInput>
): CombatEngineInput => ({
    ...BASE_INPUT,
    ...over,
});

describe('Bayah crit-power gate counts the enemy-applied Crit Power Down', () => {
    // Bayah 100 crit power vs an enemy of base 150: the BASE comparison fails. Crit Power Down
    // (-100) puts the enemy at 50: the LIVE comparison passes.
    const player = (withDebuff: boolean): CombatEngineInput =>
        base({
            critDamage: 100,
            chargeCount: 2,
            hasChargedSkill: true,
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            withDebuff
                                ? marker('enemy', 'Crit Power Down III', { critDamage: -100 })
                                : marker('enemy', MARKER, {}),
                        ],
                    },
                    { slot: 'charged', abilities: bayahCharged() },
                ],
            },
            enemyAttackers: bareEnemy({ stats: { hp: 1_000_000, critDamage: 150 } }),
        });

    it('player-side Bayah: Stasis lands only with the debuff on the enemy', () => {
        expect(stasisBy(collect(player(true)), 'attacker').length).toBeGreaterThan(0);
        expect(stasisBy(collect(player(false)), 'attacker')).toHaveLength(0);
    });

    it('enemy-side Bayah: a player-applied Crit Power Down on the focus flips the same gate', () => {
        // The focus (player) carries 150 crit power; enemy Bayah has 100. The enemy's own active
        // inflicts Crit Power Down on the focus, so the focus is at 50 on the charged turn.
        const input = (withDebuff: boolean): CombatEngineInput =>
            base({
                critDamage: 150,
                speed: 200,
                healTargetId: 'attacker',
                mode: 'healing',
                enemyAttackers: [
                    {
                        id: 'e1',
                        stats: {
                            attack: 1000,
                            crit: 0,
                            critDamage: 100,
                            speed: 40,
                            hp: 1_000_000,
                            defence: 0,
                        },
                        chargeCount: 2,
                        startCharged: false,
                        shipSkills: {
                            slots: [
                                {
                                    slot: 'active',
                                    abilities: [
                                        withDebuff
                                            ? marker('enemy', 'Crit Power Down III', {
                                                  critDamage: -100,
                                              })
                                            : marker('enemy', MARKER, {}),
                                    ],
                                },
                                { slot: 'charged', abilities: bayahCharged() },
                            ],
                        },
                    },
                ],
            });
        expect(stasisBy(collect(input(true)), 'e1').length).toBeGreaterThan(0);
        expect(stasisBy(collect(input(false)), 'e1')).toHaveLength(0);
    });
});

describe("Bayah's own crit power in the gate counts an enemy-applied Crit Power Down", () => {
    it('a Crit Power Down inflicted on Bayah removes her Stasis', () => {
        // Bayah 200 vs enemy base 150 (gate met). The enemy's active inflicts Crit Power Down
        // (-100) on her, leaving her at 100 on the charged turn.
        const input = (withDebuff: boolean): CombatEngineInput =>
            base({
                critDamage: 200,
                chargeCount: 2,
                hasChargedSkill: true,
                healTargetId: 'attacker',
                mode: 'healing',
                shipSkills: { slots: [{ slot: 'charged', abilities: bayahCharged() }] },
                enemyAttackers: [
                    {
                        id: 'e1',
                        stats: {
                            attack: 1000,
                            crit: 0,
                            critDamage: 150,
                            speed: 40,
                            hp: 1_000_000,
                            defence: 0,
                        },
                        chargeCount: 0,
                        startCharged: false,
                        shipSkills: {
                            slots: [
                                {
                                    slot: 'active',
                                    abilities: [
                                        withDebuff
                                            ? marker('enemy', 'Crit Power Down III', {
                                                  critDamage: -100,
                                              })
                                            : marker('enemy', MARKER, {}),
                                    ],
                                },
                            ],
                        },
                    },
                ],
            });
        expect(stasisBy(collect(input(false)), 'attacker').length).toBeGreaterThan(0);
        expect(stasisBy(collect(input(true)), 'attacker')).toHaveLength(0);
    });
});

describe('Chakara speed gate counts Speed Up/Down on both ships', () => {
    const chakaraKit = (extra: Ability[]): ShipSkills => ({
        slots: [{ slot: 'active', abilities: [...extra, ...chakaraActive()] }],
    });

    it('player-side: Speed Down on the enemy drops it below Chakara, so no charge is added', () => {
        // Chakara 50, enemy base 70 (gate met); Speed Down III (-50%) leaves the enemy at 35.
        const input = (withDebuff: boolean): CombatEngineInput =>
            base({
                speed: 50,
                chargeCount: 9,
                hasChargedSkill: true,
                shipSkills: chakaraKit([
                    withDebuff
                        ? marker('enemy', 'Speed Down III', { speed: -50 })
                        : marker('enemy', MARKER, {}),
                ]),
                enemyAttackers: bareEnemy({ stats: { hp: 1_000_000, speed: 70 } }),
            });
        const control = grantsBy(collect(input(false)), 'attacker');
        const debuffed = grantsBy(collect(input(true)), 'attacker');
        expect(control.length).toBeGreaterThan(0);
        expect(debuffed.length).toBeLessThan(control.length);
    });

    it('player-side: Speed Up on Chakara herself lifts her above the enemy, so no charge is added', () => {
        // Chakara 50 vs enemy 70 (gate met); Speed Up III (+50%) puts her at 75.
        const input = (withBuff: boolean): CombatEngineInput =>
            base({
                speed: 50,
                chargeCount: 9,
                hasChargedSkill: true,
                shipSkills: chakaraKit([
                    withBuff
                        ? marker('self', 'Speed Up III', { speed: 50 })
                        : marker('self', MARKER, {}),
                ]),
                enemyAttackers: bareEnemy({ stats: { hp: 1_000_000, speed: 70 } }),
            });
        const control = grantsBy(collect(input(false)), 'attacker');
        const buffed = grantsBy(collect(input(true)), 'attacker');
        expect(control.length).toBeGreaterThan(0);
        expect(buffed.length).toBeLessThan(control.length);
    });

    it('enemy-side Chakara: a Speed Down it inflicts on the focus flips the same gate', () => {
        // Enemy Chakara 40, focus base 60 (gate met); Speed Down III (-50%) leaves the focus at 30.
        const input = (withDebuff: boolean): CombatEngineInput =>
            base({
                speed: 60,
                healTargetId: 'attacker',
                mode: 'healing',
                enemyAttackers: [
                    {
                        id: 'e1',
                        stats: {
                            attack: 1000,
                            crit: 0,
                            critDamage: 0,
                            speed: 40,
                            hp: 1_000_000,
                            defence: 0,
                        },
                        chargeCount: 9,
                        startCharged: false,
                        // A charged slot is what makes the enemy a charge-banking unit.
                        shipSkills: {
                            slots: [
                                ...chakaraKit([
                                    withDebuff
                                        ? marker('enemy', 'Speed Down III', { speed: -50 })
                                        : marker('enemy', MARKER, {}),
                                ]).slots,
                                {
                                    slot: 'charged',
                                    abilities: [
                                        {
                                            id: 'charged-hit',
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
                    },
                ],
            });
        const control = grantsBy(collect(input(false)), 'e1');
        const debuffed = grantsBy(collect(input(true)), 'e1');
        expect(control.length).toBeGreaterThan(0);
        expect(debuffed.length).toBeLessThan(control.length);
    });
    it("enemy-side Chakara: the focus's scheduled Speed Up counts against the enemy's gate", () => {
        // Enemy Chakara 100, focus base 80 (gate unmet); a manually picked Speed Up III (+60%)
        // lifts the focus to 128, above Chakara, so the gate is met and charges are added.
        const input = (withBuff: boolean): CombatEngineInput =>
            base({
                speed: 80,
                healTargetId: 'attacker',
                mode: 'healing',
                selfBuffs: withBuff
                    ? [
                          {
                              id: 'speed-up',
                              buffName: 'Speed Up III',
                              stacks: 1,
                              parsedEffects: { speed: 60 },
                              isStackable: false,
                          },
                      ]
                    : [],
                enemyAttackers: [
                    {
                        id: 'e1',
                        stats: {
                            attack: 1000,
                            crit: 0,
                            critDamage: 0,
                            speed: 100,
                            hp: 1_000_000,
                            defence: 0,
                        },
                        chargeCount: 9,
                        startCharged: false,
                        shipSkills: {
                            slots: [
                                { slot: 'active', abilities: chakaraActive() },
                                {
                                    slot: 'charged',
                                    abilities: [
                                        {
                                            id: 'charged-hit',
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
                    },
                ],
            });
        const unbuffed = grantsBy(collect(input(false)), 'e1');
        const buffed = grantsBy(collect(input(true)), 'e1');
        expect(unbuffed).toHaveLength(0);
        expect(buffed.length).toBeGreaterThan(0);
    });
});
