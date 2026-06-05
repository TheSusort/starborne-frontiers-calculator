import { describe, it, expect } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../../calculators/dpsSimulator';
import { SelectedGameBuff, TeamActorInput } from '../../../types/calculator';
import { Ability, ShipSkills } from '../../../types/abilities';
import { createEventBus, CombatEvent } from '../events';

// --- Fixture builders -------------------------------------------------------
// Hand-built ShipSkills mirroring the dpsSimulator.test.ts style.

const damageAbility = (multiplier: number, id = 'dmg'): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

const damageSkills = (multiplier: number): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [damageAbility(multiplier)] }],
});

const debuffAbility = (
    buffName: string,
    duration: number,
    parsedEffects: Record<string, number>,
    id = 'db'
): Ability => ({
    id,
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName,
        parsedEffects,
        stacks: 1,
        isStackable: false,
        application: 'inflict',
        duration,
    },
});

const dotAbility = (
    dotType: 'corrosion' | 'inferno' | 'bomb',
    tier: number,
    stacks: number,
    duration: number,
    id = 'dot'
): Ability => ({
    id,
    type: 'dot',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'dot', dotType, tier, stacks, duration },
});

const selfBuffAbility = (
    buffName: string,
    duration: number,
    parsedEffects: Record<string, number>,
    id = 'sb'
): Ability => ({
    id,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'buff', buffName, parsedEffects, stacks: 1, isStackable: false, duration },
});

/** zero-effect: exercises the walk path without changing damage math */
const neutralSelfBuff = (buffName: string, duration: number, id = 'sb'): Ability =>
    selfBuffAbility(buffName, duration, { attack: 0 }, id);

const teamStats = (overrides: Partial<NonNullable<TeamActorInput['stats']>> = {}) => ({
    attack: 15000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    hacking: 250,
    defence: 0,
    hp: 0,
    ...overrides,
});

const walkedTeam = (
    shipSkills: ShipSkills,
    overrides: Partial<TeamActorInput> = {}
): TeamActorInput => ({
    id: 't1',
    speed: 140, // faster than the attacker (100) → acts first each round
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    shipSkills,
    stats: teamStats(),
    ...overrides,
});

// Attacker base: a plain damage attacker, crit 0 (deterministic), large HP pool so the
// enemy never dies and damage scaling stays linear.
const baseInput = (overrides: Partial<DPSSimulationInput> = {}): DPSSimulationInput => ({
    attack: 15000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 0,
    enemyHp: 100_000_000,
    rounds: 6,
    selfBuffs: [],
    enemyDebuffs: [],
    shipSkills: damageSkills(100),
    hacking: 250,
    enemySecurity: 100,
    ...overrides,
});

describe('walked team actors (Task 4)', () => {
    // 1. Team debuff walks → attacker damage higher; debuff-applied carries team sourceId.
    it('a walked team enemy-debuff (Defense Down) raises attacker damage and emits the team sourceId', () => {
        const bus = createEventBus();
        const applied: Extract<CombatEvent, { type: 'debuff-applied' }>[] = [];
        bus.on('debuff-applied', (e) => {
            if (e.buffName === 'Defense Down') applied.push(e);
        });
        const team = walkedTeam(
            {
                slots: [
                    {
                        slot: 'active',
                        abilities: [debuffAbility('Defense Down', 3, { defense: -20 })],
                    },
                ],
            },
            { id: 'tdebuff' }
        );
        const withTeam = simulateDPS(baseInput({ enemyDefense: 20000, teamActors: [team], bus }));
        const withoutTeam = simulateDPS(baseInput({ enemyDefense: 20000 }));

        // Team acts first (speed 140) → the debuff is live before the attacker's hit,
        // lowering effective defense → higher direct damage.
        expect(withTeam.rounds[0].directDamage).toBeGreaterThan(withoutTeam.rounds[0].directDamage);
        // debuff-applied carries the team actor's id as sourceId.
        expect(applied.length).toBeGreaterThan(0);
        expect(applied.every((e) => e.sourceId === 'tdebuff')).toBe(true);
    });

    // 2. Team damage reduces HP; excluded from focus totals.
    it('team damage populates teamDamage every round and leaves attacker totals unchanged', () => {
        const team = walkedTeam(damageSkills(80), { id: 'tdmg' });
        const withTeam = simulateDPS(baseInput({ teamActors: [team] }));
        // Same config but the team has NO damage ability (still walks, just no damage).
        const noDmgTeam = walkedTeam(
            { slots: [{ slot: 'active', abilities: [] }] },
            { id: 'tdmg' }
        );
        const withoutDmg = simulateDPS(baseInput({ teamActors: [noDmgTeam] }));

        expect(withTeam.rounds.every((r) => (r.teamDamage ?? 0) > 0)).toBe(true);
        // Attacker focus totals identical with vs without the team's damage ability.
        expect(withTeam.summary.totalDamage).toBe(withoutDmg.summary.totalDamage);
        expect(withTeam.rounds.map((r) => r.totalRoundDamage)).toEqual(
            withoutDmg.rounds.map((r) => r.totalRoundDamage)
        );
        // teamTotalDamage present and positive.
        expect(withTeam.summary.teamTotalDamage).toBeGreaterThan(0);
    });

    // 3. HP-threshold gate flips earlier with a damaging team ship.
    it('an HP-threshold (below 50%) gate switches on earlier with a damaging team ship', () => {
        // Attacker: base damage + an execute that gates on enemy below 50% HP.
        const execSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        damageAbility(100, 'base'),
                        {
                            id: 'exec',
                            type: 'additional-damage',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [
                                {
                                    subject: 'hp-threshold',
                                    derivable: true,
                                    hpComparator: 'below',
                                    hpPercent: 50,
                                },
                            ],
                            config: { type: 'additional-damage', stat: 'hp', pct: 10 },
                        },
                    ],
                },
            ],
        };
        const cfg = {
            attack: 10000,
            crit: 0,
            critDamage: 0,
            chargeCount: 0,
            enemyDefense: 0,
            enemyHp: 60000,
            rounds: 8,
            hp: 50000,
            shipSkills: execSkills,
        } as const;

        const team = walkedTeam(damageSkills(100), {
            id: 'texec',
            stats: teamStats({ attack: 10000 }),
        });
        const withTeam = simulateDPS(baseInput({ ...cfg, teamActors: [team] }));
        const withoutTeam = simulateDPS(baseInput({ ...cfg }));

        const flipRound = (rounds: { directDamage: number }[]): number =>
            rounds.findIndex((r, i) => i > 0 && r.directDamage > rounds[0].directDamage);
        expect(flipRound(withTeam.rounds)).toBeGreaterThanOrEqual(0);
        expect(flipRound(withTeam.rounds)).toBeLessThan(flipRound(withoutTeam.rounds));
    });

    // 4. Team inferno scales with the TEAM ship's attack — attributed to teamDamage, not the row.
    it('team inferno ticks scale with the team attack and land in teamDamage, not infernoDamage', () => {
        // Team attack distinct from the attacker's. Team applies inferno on its turn (round 1);
        // it ticks on the enemy turn each round. No attacker DoTs → row infernoDamage stays 0.
        const teamAttack = 22000;
        const tier = 6;
        const stacks = 2;
        const team = walkedTeam(
            { slots: [{ slot: 'active', abilities: [dotAbility('inferno', tier, stacks, 4)] }] },
            { id: 'tinf', stats: teamStats({ attack: teamAttack }) }
        );
        const result = simulateDPS(baseInput({ teamActors: [team], rounds: 3 }));

        // Attacker has no DoTs → the row inferno field is always 0.
        expect(result.rounds.every((r) => r.infernoDamage === 0)).toBe(true);

        // Expected round-1 inferno tick from the team's attack (no buffs → effectiveAttack =
        // team attack, dotMult = 1, neutral affinity → affinityMult = 1). The team applies a
        // fresh inferno entry each of its turns, so by round 2 two entries tick — assert the
        // exact single-application value on round 1, where there is exactly one entry.
        const expectedTick = stacks * (tier / 100) * teamAttack * 1 * 1;
        // Team applies on round 1 (speed 140, before attacker) → ticks on the enemy turn r1.
        // No team damage ability → team direct is 0, so round-1 teamDamage == the inferno tick.
        expect(result.rounds[0].teamDamage ?? 0).toBeCloseTo(expectedTick, 0);
        // Round 2: two inferno entries are ticking (applied on turns 1 and 2), no team direct.
        // teamDamage must be exactly 2 × the single-entry tick from round 1.
        expect(result.rounds[1].teamDamage ?? 0).toBeCloseTo(2 * expectedTick, 0);
    });

    // 5. HP-delta complement: totalRoundDamage + teamDamage reconciles with the enemy HP decline.
    it('totalRoundDamage + teamDamage reconciles with the enemy HP decline each round', () => {
        const enemyHp = 5_000_000;
        const team = walkedTeam(damageSkills(120), {
            id: 'tdelta',
            stats: teamStats({ attack: 18000 }),
        });
        const result = simulateDPS(baseInput({ teamActors: [team], enemyHp, rounds: 8 }));
        // Cumulative (focus + team) reconstructed from the per-round deltas, compared to the
        // NEXT round's entering enemyHpPct. enemyHpPct is rounded to an int → ±1% tolerance.
        let cumulative = 0;
        for (let i = 0; i < result.rounds.length - 1; i++) {
            cumulative += result.rounds[i].totalRoundDamage + (result.rounds[i].teamDamage ?? 0);
            const expectedPct = Math.max(0, 100 * (1 - cumulative / enemyHp));
            // enemyHpPct is rounded to an int; the per-round sums round each channel → ±1.5%.
            expect(Math.abs(result.rounds[i + 1].enemyHpPct - expectedPct)).toBeLessThanOrEqual(
                1.5
            );
        }
    });

    // 6. Echoing Burst gathers team direct.
    it('an Echoing Burst gathers team direct damage, making the burst larger', () => {
        // Attacker carries an accumulate-detonate (Echoing Burst): gathers 2 rounds, detonates
        // 100% of the accumulated direct. With a damaging team ship the accumulated total is
        // larger → bigger detonation.
        const burstSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        damageAbility(100, 'base'),
                        {
                            id: 'eb',
                            type: 'accumulate-detonate',
                            target: 'enemy',
                            trigger: 'on-cast',
                            conditions: [],
                            config: { type: 'accumulate-detonate', turns: 2, pct: 100 },
                        },
                    ],
                },
            ],
        };
        const team = walkedTeam(damageSkills(100), {
            id: 'teb',
            stats: teamStats({ attack: 15000 }),
        });
        const withTeam = simulateDPS(
            baseInput({ shipSkills: burstSkills, teamActors: [team], rounds: 4 })
        );
        const withoutTeam = simulateDPS(baseInput({ shipSkills: burstSkills, rounds: 4 }));

        const burst = (rounds: { detonationDamage: number }[]): number =>
            Math.max(...rounds.map((r) => r.detonationDamage));
        expect(burst(withTeam.rounds)).toBeGreaterThan(burst(withoutTeam.rounds));
    });

    // 7. No-double-count: walked team + manual picker extras apply each exactly once.
    it('a walked team ship with manual selfBuffs extras applies each exactly once', () => {
        const manualBuff: SelectedGameBuff = {
            id: 'mb1',
            buffName: 'Manual Attack Up',
            stacks: 1,
            isStackable: false,
            parsedEffects: { attack: 20 },
            skillSource: 'active',
            skillDuration: 2,
        };
        // Team walks a self-buff ability AND carries a manual selfBuffs extra (granted to the
        // attacker). The manual buff must fold exactly once into the attacker's totals.
        const team = walkedTeam(
            {
                slots: [
                    {
                        slot: 'active',
                        abilities: [neutralSelfBuff('Walked Self Up', 2)],
                    },
                ],
            },
            { id: 'tnd', selfBuffs: [manualBuff] }
        );
        const withTeam = simulateDPS(baseInput({ teamActors: [team], rounds: 3 }));
        // Round 2: the manual buff is live (team speed 140 applies it round 1). Direct damage
        // must be exactly attack × 1.2 of the no-buff baseline (single 20% application).
        const baseline = simulateDPS(baseInput({ rounds: 3 }));
        expect(withTeam.rounds[1].directDamage).toBeCloseTo(
            baseline.rounds[1].directDamage * 1.2,
            -1
        );
        // The manual buff appears exactly once in the attacker's active list.
        const count = withTeam.rounds[1].activeSelfBuffs.filter(
            (b) => b.buffName === 'Manual Attack Up'
        ).length;
        expect(count).toBe(1);
    });

    // 8. Per-actor condition ctx: a team ship's gated ability reads ITS OWN buffs.
    it("a team gated damage ability reads its own self-buffs, not the attacker's", () => {
        const buffName = 'Focus Mark';
        // Team damage gated on self-buff `Focus Mark` present.
        const gatedTeamDamage: Ability = {
            id: 'tg',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [{ subject: 'self-buff', derivable: true, buffName }],
            config: { type: 'damage', multiplier: 100 },
        };

        // (a) Only the ATTACKER has Focus Mark (via its own self-buff ability). The team gate
        // reads the team's OWN buffs (which lack it) → team damage 0 → teamDamage 0.
        const attackerWithBuff: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [damageAbility(100, 'ad'), neutralSelfBuff(buffName, 3, 'afm')],
                },
            ],
        };
        const teamGatedOnly = walkedTeam(
            { slots: [{ slot: 'active', abilities: [gatedTeamDamage] }] },
            { id: 'tgate', stats: teamStats({ attack: 15000 }) }
        );
        const aRes = simulateDPS(
            baseInput({ shipSkills: attackerWithBuff, teamActors: [teamGatedOnly], rounds: 3 })
        );
        expect(aRes.rounds.every((r) => (r.teamDamage ?? 0) === 0)).toBe(true);

        // (b) The team grants ITSELF Focus Mark (self-targeted buff ability in its own kit,
        // applied before its damage in the same cast). The gate PASSES → team damage > 0.
        const teamSelfGrantThenDamage = walkedTeam(
            {
                slots: [
                    {
                        slot: 'active',
                        abilities: [neutralSelfBuff(buffName, 3, 'tfm'), gatedTeamDamage],
                    },
                ],
            },
            { id: 'tgate', stats: teamStats({ attack: 15000 }) }
        );
        const bRes = simulateDPS(baseInput({ teamActors: [teamSelfGrantThenDamage], rounds: 3 }));
        expect(bRes.rounds.every((r) => (r.teamDamage ?? 0) > 0)).toBe(true);
    });

    // 9. Determinism: two identical walked-team runs are JSON-equal.
    it('two identical walked-team runs produce JSON.stringify-equal results', () => {
        const mk = () =>
            simulateDPS(
                baseInput({
                    teamActors: [
                        walkedTeam(
                            {
                                slots: [
                                    {
                                        slot: 'active',
                                        abilities: [
                                            damageAbility(80, 'da'),
                                            dotAbility('inferno', 6, 1, 3, 'di'),
                                            debuffAbility('Def Down', 2, { defense: -10 }, 'dd'),
                                        ],
                                    },
                                ],
                            },
                            { id: 'tdet' }
                        ),
                    ],
                    rounds: 6,
                })
            );
        expect(JSON.stringify(mk())).toBe(JSON.stringify(mk()));
    });

    // 10. Legacy parity: a team actor WITHOUT shipSkills → teamDamage undefined.
    it('a legacy team actor (no shipSkills) reports teamDamage undefined every round', () => {
        const legacyBuff: SelectedGameBuff = {
            id: 'lb1',
            buffName: 'Legacy Up',
            stacks: 1,
            isStackable: false,
            parsedEffects: { attack: 20 },
            skillSource: 'active',
            skillDuration: 2,
        };
        const legacyTeam: TeamActorInput = {
            id: 'tlegacy',
            speed: 140,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [legacyBuff],
            enemyDebuffs: [],
        };
        const withLegacy = simulateDPS(baseInput({ teamActors: [legacyTeam], rounds: 4 }));
        expect(withLegacy.rounds.every((r) => r.teamDamage === undefined)).toBe(true);
        expect(withLegacy.summary.teamTotalDamage).toBeUndefined();
    });
});
