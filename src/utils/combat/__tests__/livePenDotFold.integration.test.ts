import { describe, expect, it } from 'vitest';
import { simulateDPS } from '../../calculators/dpsSimulator';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { ParsedBuffEffects, SelectedGameBuff, TeamActorInput } from '../../../types/calculator';
import { Ability, ShipSkills } from '../../../types/abilities';

// Defence penetration and DoT-damage modifiers from scheduled self-buffs are read live, per turn,
// from the actor's currently active scheduled buffs — the same list the attack / outgoing-damage
// channels read — rather than from a standing scalar.

const buff = (
    name: string,
    parsedEffects: ParsedBuffEffects,
    extra: Partial<SelectedGameBuff> = {}
): SelectedGameBuff => ({
    id: name,
    buffName: name,
    stacks: 1,
    parsedEffects,
    isStackable: false,
    ...extra,
});

const base = {
    attack: 15000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    activeMultiplier: 100,
    chargedMultiplier: 100,
    chargeCount: 0,
    activeDoTs: [] as never[],
    chargedDoTs: [] as never[],
    enemyDefense: 8000,
    enemyHp: 100_000_000,
    rounds: 4,
    selfBuffs: [] as SelectedGameBuff[],
    enemyDebuffs: [] as SelectedGameBuff[],
};

const infernoBase = {
    ...base,
    enemyDefense: 0,
    activeDoTs: [{ id: 'i', type: 'inferno' as const, tier: 30, stacks: 1, duration: 2 }],
};

const direct = (r: ReturnType<typeof simulateDPS>) => r.rounds.map((x) => x.directDamage);
const inferno = (r: ReturnType<typeof simulateDPS>) => r.rounds.map((x) => x.infernoDamage);

describe('scheduled penetration and DoT modifiers are derived live', () => {
    it('(c) a timed charge-sourced pen buff applies only from the turn the charged skill fires', () => {
        setupKeyedRng(1);
        const input = { ...base, chargeCount: 2, rounds: 4 };
        const timedPen = buff(
            'Defense Penetration Up',
            { defensePenetration: 40 },
            { skillSource: 'charge', skillDuration: 2 }
        );
        const plain = direct(simulateDPS(input));
        const withPen = direct(simulateDPS({ ...input, selfBuffs: [timedPen] }));
        // Rounds 1-2 are actives, the charged skill fires in round 3.
        expect(withPen[0]).toBe(plain[0]);
        expect(withPen[1]).toBe(plain[1]);
        expect(withPen[2]).toBeGreaterThan(plain[2]);
    });

    it('(c) a timed charge-sourced DoT buff applies only from the turn the charged skill fires', () => {
        setupKeyedRng(1);
        const input = { ...infernoBase, chargeCount: 2, rounds: 4 };
        const timedDot = buff(
            'Out. DoT Damage Up',
            { dotDamage: 50 },
            { skillSource: 'charge', skillDuration: 2 }
        );
        const plain = inferno(simulateDPS(input));
        const withDot = inferno(simulateDPS({ ...input, selfBuffs: [timedDot] }));
        expect(withDot[0]).toBe(plain[0]);
        expect(withDot[1]).toBe(plain[1]);
        expect(withDot[2]).toBeGreaterThan(plain[2]);
    });

    it('(d) a team ship always-active pen pick reaches the focus hit', () => {
        setupKeyedRng(1);
        const teamPen: TeamActorInput = {
            id: 't1',
            speed: 140,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [buff('Defense Penetration Up', { defensePenetration: 40 })],
            enemyDebuffs: [],
        };
        const plain = direct(simulateDPS(base));
        const withTeam = direct(simulateDPS({ ...base, teamActors: [teamPen] }));
        expect(withTeam[0]).toBeGreaterThan(plain[0]);
    });

    it('(d) a team ship always-active DoT pick reaches the focus DoT tick', () => {
        setupKeyedRng(1);
        const teamDot: TeamActorInput = {
            id: 't1',
            speed: 140,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [buff('Out. DoT Damage Up', { dotDamage: 50 })],
            enemyDebuffs: [],
        };
        const plain = inferno(simulateDPS(infernoBase));
        const withTeam = inferno(simulateDPS({ ...infernoBase, teamActors: [teamDot] }));
        expect(withTeam[0]).toBeGreaterThan(plain[0]);
    });

    it('(e) an accumulating scheduled pen buff contributes the stacks actually gained', () => {
        setupKeyedRng(1);
        const accum = buff(
            'Defense Penetration Up',
            { defensePenetration: 10 },
            { isStackable: true, maxStacks: 6, stackTrigger: 'per-active' }
        );
        const hits = direct(simulateDPS({ ...base, rounds: 4, selfBuffs: [accum] }));
        // Stacks grow each active cast, so each hit pierces more than the last.
        expect(hits[1]).toBeGreaterThan(hits[0]);
        expect(hits[2]).toBeGreaterThan(hits[1]);
    });

    it('(f) inert buffs leave penetration and DoT damage unchanged', () => {
        setupKeyedRng(1);
        const inert = buff('Inert', {});
        expect(direct(simulateDPS({ ...base, selfBuffs: [inert] }))).toEqual(
            direct(simulateDPS(base))
        );
        expect(inferno(simulateDPS({ ...infernoBase, selfBuffs: [inert] }))).toEqual(
            inferno(simulateDPS(infernoBase))
        );
    });

    describe('walked team actor', () => {
        const dmg = (): Ability => ({
            id: 'd',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100 },
        });
        const dot = (): Ability => ({
            id: 'dot',
            type: 'dot',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'dot', dotType: 'inferno', tier: 30, stacks: 1, duration: 2 },
        });
        const selfBuffAbility = (name: string, parsedEffects: ParsedBuffEffects): Ability => ({
            id: `sb-${name}`,
            type: 'buff',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'buff',
                buffName: name,
                parsedEffects,
                stacks: 1,
                isStackable: false,
                duration: 2,
            },
        });
        const walked = (abilities: Ability[]): TeamActorInput => {
            const shipSkills: ShipSkills = { slots: [{ slot: 'active', abilities }] };
            return {
                id: 'w1',
                speed: 140,
                chargeCount: 0,
                startCharged: false,
                selfBuffs: [],
                enemyDebuffs: [],
                shipSkills,
                stats: {
                    attack: 15000,
                    crit: 0,
                    critDamage: 150,
                    defensePenetration: 0,
                    hacking: 200,
                    defence: 0,
                    hp: 100000,
                },
            };
        };
        const teamDamage = (r: ReturnType<typeof simulateDPS>) =>
            r.rounds.map((x) => x.teamDamage ?? 0);
        // The focus deals nothing of its own here so teamDamage is the walked actor's alone.
        const focusless = { ...base, activeMultiplier: 0, rounds: 3 };

        it('(a) pen granted by its own kit raises its hit against a defended enemy', () => {
            setupKeyedRng(1);
            const without = teamDamage(
                simulateDPS({ ...focusless, teamActors: [walked([dmg()])] })
            );
            const withPen = teamDamage(
                simulateDPS({
                    ...focusless,
                    teamActors: [
                        walked([
                            selfBuffAbility('Defense Penetration Up', { defensePenetration: 40 }),
                            dmg(),
                        ]),
                    ],
                })
            );
            expect(withPen[1]).toBeGreaterThan(without[1]);
        });

        it('(b) DoT modifier granted by its own kit raises its DoT damage', () => {
            setupKeyedRng(1);
            const without = teamDamage(
                simulateDPS({ ...focusless, teamActors: [walked([dot()])] })
            );
            const withDot = teamDamage(
                simulateDPS({
                    ...focusless,
                    teamActors: [
                        walked([selfBuffAbility('Out. DoT Damage Up', { dotDamage: 50 }), dot()]),
                    ],
                })
            );
            expect(withDot[1]).toBeGreaterThan(without[1]);
        });

        it('(f) a walked actor with an inert self buff deals the same damage', () => {
            setupKeyedRng(1);
            const without = teamDamage(
                simulateDPS({ ...focusless, teamActors: [walked([dmg()])] })
            );
            const inert = teamDamage(
                simulateDPS({
                    ...focusless,
                    teamActors: [walked([selfBuffAbility('Inert', {}), dmg()])],
                })
            );
            expect(inert).toEqual(without);
        });
    });
});
