import { describe, it, expect } from 'vitest';
import { simulateDPS, DPSSimulationInput } from '../../calculators/dpsSimulator';
import { SelectedGameBuff, TeamActorInput, CombatStatBlock } from '../../../types/calculator';
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

/** An ally-targeted timed buff (target 'all-allies') — Task 5 routes it to every player actor. */
const allyBuffAbility = (
    buffName: string,
    duration: number,
    parsedEffects: Record<string, number>,
    id = 'ab'
): Ability => ({
    id,
    type: 'buff',
    target: 'all-allies',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'buff', buffName, parsedEffects, stacks: 1, isStackable: false, duration },
});

/** An ally-targeted charge ability (target 'all-allies') — Task 5 bumps every player actor. */
const allyChargeAbility = (amount: number, id = 'ac'): Ability => ({
    id,
    type: 'charge',
    target: 'all-allies',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'charge', amount },
});

const teamStats = (overrides: Partial<CombatStatBlock> = {}) => ({
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

    // 9b. A walked team ship's OWN manual enemy-debuff extra benefits the TEAM's own damage.
    //     The team actor's damage fold expands the SHARED enemy-side scheduled debuffs (the
    //     team's own manual enemyDebuffs list included) through the engine's enemyDebuffLookup.
    //     A walked team runtime must carry the GLOBAL lookup, not an empty map — an empty map
    //     silently zeroes the manual debuff's stat effects on the team's OWN turn.
    it('a walked team ship benefits from its own manual enemy-debuff extra (global enemyDebuffLookup)', () => {
        const manualDefenseDown: SelectedGameBuff = {
            id: 'mdd',
            buffName: 'Defense Down',
            stacks: 1,
            isStackable: false,
            parsedEffects: { defense: -30 },
            skillSource: 'active',
            skillDuration: 5,
        };
        // Enemy has defense so a Defense Down measurably raises the team's direct damage.
        const teamWithDebuff = walkedTeam(damageSkills(100), {
            id: 'tdd',
            selfBuffs: [],
            enemyDebuffs: [manualDefenseDown],
            stats: teamStats({ attack: 15000 }),
        });
        const teamNoDebuff = walkedTeam(damageSkills(100), {
            id: 'tdd',
            selfBuffs: [],
            enemyDebuffs: [],
            stats: teamStats({ attack: 15000 }),
        });
        const withDebuff = simulateDPS(
            baseInput({ enemyDefense: 30000, teamActors: [teamWithDebuff], rounds: 4 })
        );
        const without = simulateDPS(
            baseInput({ enemyDefense: 30000, teamActors: [teamNoDebuff], rounds: 4 })
        );
        // The team's own damage fold sees the manual Defense Down → higher teamDamage every round.
        expect(withDebuff.summary.teamTotalDamage ?? 0).toBeGreaterThan(
            without.summary.teamTotalDamage ?? 0
        );
        expect(withDebuff.rounds[0].teamDamage ?? 0).toBeGreaterThan(
            without.rounds[0].teamDamage ?? 0
        );
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

describe('ally-target routing (Task 5)', () => {
    // 1. A team `all-allies` buff lands on the attacker AND on the team ship itself.
    it('a team all-allies Attack Up buffs both the attacker and the team ship', () => {
        // Team (speed 140, acts first) carries an all-allies Attack Up + its own damage ability.
        // Round 2: the buff (applied round 1) is live for both actors → attacker direct AND team
        // direct are higher than the same setup with a self-only (no-attacker-reach) buff.
        const withAllyBuff = walkedTeam(
            {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            allyBuffAbility('Team Attack Up', 4, { attack: 25 }, 'tab'),
                            damageAbility(100, 'tad'),
                        ],
                    },
                ],
            },
            { id: 'tally', stats: teamStats({ attack: 15000 }) }
        );
        // Control: identical kit but the buff is SELF-only → never reaches the attacker.
        const withSelfBuff = walkedTeam(
            {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            selfBuffAbility('Team Attack Up', 4, { attack: 25 }, 'tsb'),
                            damageAbility(100, 'tad'),
                        ],
                    },
                ],
            },
            { id: 'tally', stats: teamStats({ attack: 15000 }) }
        );

        const ally = simulateDPS(baseInput({ teamActors: [withAllyBuff], rounds: 3 }));
        const selfOnly = simulateDPS(baseInput({ teamActors: [withSelfBuff], rounds: 3 }));

        // Attacker direct (row directDamage): buffed only when the buff reaches the attacker.
        expect(ally.rounds[1].directDamage).toBeGreaterThan(selfOnly.rounds[1].directDamage);
        // Team damage: buffed in BOTH (the team always gets its own buff), but the all-allies
        // variant's team total is at least as large (same buff on the team in both cases) —
        // assert team damage is positive in both as a sanity floor, and the attacker delta is
        // the discriminating signal above.
        expect((ally.rounds[1].teamDamage ?? 0) > 0).toBe(true);
        expect((selfOnly.rounds[1].teamDamage ?? 0) > 0).toBe(true);

        // Family rule sanity: across two more rounds the attacker buff is a single application
        // (no duplication). The buff appears at most once in the attacker's active list.
        const dupCount = ally.rounds[1].activeSelfBuffs.filter(
            (b) => b.buffName === 'Team Attack Up'
        ).length;
        expect(dupCount).toBe(1);
    });

    // 2. A team `self` buff stays on the caster — attacker direct UNCHANGED.
    it('a team self-only buff buffs the team but leaves attacker direct exactly unchanged', () => {
        const teamSelf = walkedTeam(
            {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            selfBuffAbility('Self Attack Up', 4, { attack: 25 }, 'tsb'),
                            damageAbility(100, 'tad'),
                        ],
                    },
                ],
            },
            { id: 'tself', stats: teamStats({ attack: 15000 }) }
        );
        // Same team but with NO self-buff (just damage) — attacker direct should be identical
        // either way, since the self-buff never reaches the attacker.
        const teamNoBuff = walkedTeam(
            { slots: [{ slot: 'active', abilities: [damageAbility(100, 'tad')] }] },
            { id: 'tself', stats: teamStats({ attack: 15000 }) }
        );

        const withSelf = simulateDPS(baseInput({ teamActors: [teamSelf], rounds: 3 }));
        const withNone = simulateDPS(baseInput({ teamActors: [teamNoBuff], rounds: 3 }));

        // Attacker direct EXACTLY equal across all rounds (self-buff confined to the caster).
        expect(withSelf.rounds.map((r) => r.directDamage)).toEqual(
            withNone.rounds.map((r) => r.directDamage)
        );
        // But the team's own damage IS buffed by its self-buff.
        expect(withSelf.summary.teamTotalDamage ?? 0).toBeGreaterThan(
            withNone.summary.teamTotalDamage ?? 0
        );
    });

    // 3. An attacker `all-allies` buff reaches the team ship's gate.
    it("an attacker all-allies buff satisfies a team ship's self-buff gate", () => {
        // Attacker (FASTER here, speed via default 100 but team slowed to 80) carries an
        // all-allies Marker buff; the team has a damage ability gated on self-buff 'Marker'.
        // Attacker acts first → applies Marker to all players → team's gate passes round 1.
        const marker = 'Marker';
        const attackerSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        damageAbility(100, 'abase'),
                        allyBuffAbility(marker, 5, { attack: 0 }, 'amk'),
                    ],
                },
            ],
        };
        const gatedTeamDamage: Ability = {
            id: 'tgd',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [{ subject: 'self-buff', derivable: true, buffName: marker }],
            config: { type: 'damage', multiplier: 100 },
        };
        // Attacker faster (team speed 80 < attacker 100): Marker exists before the team's gate.
        const teamSlow = walkedTeam(
            { slots: [{ slot: 'active', abilities: [gatedTeamDamage] }] },
            { id: 'tmk', speed: 80, stats: teamStats({ attack: 15000 }) }
        );
        const fastAttacker = simulateDPS(
            baseInput({ shipSkills: attackerSkills, teamActors: [teamSlow], rounds: 3 })
        );
        // Team damage flows because the attacker's all-allies buff reached the team.
        expect(fastAttacker.rounds.every((r) => (r.teamDamage ?? 0) > 0)).toBe(true);

        // Reverse timing: team FASTER (140) acts before the attacker → round 1 gate fails
        // (Marker not yet applied), so round-1 teamDamage is 0; from round 2 it flows.
        const teamFast = walkedTeam(
            { slots: [{ slot: 'active', abilities: [gatedTeamDamage] }] },
            { id: 'tmk', speed: 140, stats: teamStats({ attack: 15000 }) }
        );
        const fastTeam = simulateDPS(
            baseInput({ shipSkills: attackerSkills, teamActors: [teamFast], rounds: 3 })
        );
        expect(fastTeam.rounds[0].teamDamage ?? 0).toBe(0);
        expect(fastTeam.rounds[1].teamDamage ?? 0).toBeGreaterThan(0);
    });

    // 4. Ally charge grant accelerates EVERY player actor's charged cadence, capped per actor.
    it('a team all-allies charge granter accelerates both the attacker and a second team ship', () => {
        // Granter: a team ship whose active slot grants +1 charge to all allies each turn.
        // It has chargeCount 0 (never charges itself, skips the grant-to-self overflow).
        const granter = walkedTeam(
            { slots: [{ slot: 'active', abilities: [allyChargeAbility(1, 'gac')] }] },
            { id: 'tgrant', speed: 150, chargeCount: 0 }
        );
        // Second team ship: chargeCount 2, a charged damage ability — its cadence should speed up.
        const charged2: ShipSkills = {
            slots: [
                { slot: 'active', abilities: [damageAbility(50, 'c2a')] },
                { slot: 'charged', abilities: [damageAbility(300, 'c2c')] },
            ],
        };
        const second = walkedTeam(charged2, {
            id: 'tcharged',
            speed: 130,
            chargeCount: 2,
            stats: teamStats({ attack: 15000 }),
        });

        // Attacker: chargeCount 3, a charged damage ability.
        const attackerCharged: ShipSkills = {
            slots: [
                { slot: 'active', abilities: [damageAbility(50, 'aa')] },
                { slot: 'charged', abilities: [damageAbility(400, 'ac')] },
            ],
        };

        const withGranter = simulateDPS(
            baseInput({
                shipSkills: attackerCharged,
                chargeCount: 3,
                teamActors: [granter, second],
                rounds: 8,
            })
        );
        const withoutGranter = simulateDPS(
            baseInput({
                shipSkills: attackerCharged,
                chargeCount: 3,
                teamActors: [
                    // Same second ship, but the granter grants nothing (self-only charge → no reach).
                    walkedTeam(
                        { slots: [{ slot: 'active', abilities: [] }] },
                        { id: 'tgrant', speed: 150, chargeCount: 0 }
                    ),
                    second,
                ],
                rounds: 8,
            })
        );

        // The attacker's first charged round (largest directDamage) arrives EARLIER with the granter.
        const firstChargedRound = (rounds: { directDamage: number }[]): number =>
            rounds.findIndex((r) => r.directDamage > rounds[0].directDamage * 2);
        expect(firstChargedRound(withGranter.rounds)).toBeGreaterThanOrEqual(0);
        expect(firstChargedRound(withGranter.rounds)).toBeLessThan(
            firstChargedRound(withoutGranter.rounds)
        );
        // The second team ship's cadence also accelerates → larger cumulative team damage.
        expect(withGranter.summary.teamTotalDamage ?? 0).toBeGreaterThan(
            withoutGranter.summary.teamTotalDamage ?? 0
        );
    });

    // 5. `buff-applied` emits once per player recipient on an all-allies application.
    it('an all-allies application emits one buff-applied per player recipient', () => {
        const bus = createEventBus();
        const applied: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
        bus.on('buff-applied', (e) => {
            if (e.buffName === 'Broadcast') applied.push(e);
        });
        const team = walkedTeam(
            {
                slots: [
                    {
                        slot: 'active',
                        abilities: [allyBuffAbility('Broadcast', 2, { attack: 0 }, 'bc')],
                    },
                ],
            },
            { id: 'tbroad' }
        );
        // One team + attacker = 2 player recipients → 2 emissions per team application.
        simulateDPS(baseInput({ teamActors: [team], rounds: 1, bus }));
        const recipients = new Set(applied.map((e) => e.actorId));
        expect(recipients).toEqual(new Set(['attacker', 'tbroad']));
        // Round 1: exactly one application by the team → exactly 2 emissions.
        expect(applied.filter((e) => e.round === 1).length).toBe(2);
    });

    // 6. Caster-gated aura folds into the ATTACKER only when the CASTER satisfies the gate.
    it('a team all-allies aura gated on a caster-only buff folds into the attacker via the caster ctx', () => {
        const casterOnly = 'CasterOnly';
        const auraGated: Ability = {
            id: 'aura',
            type: 'buff',
            target: 'all-allies',
            trigger: 'on-cast',
            // duration undefined → classified as aura (recurring). Gated on a self-buff only the
            // caster grants itself.
            conditions: [{ subject: 'self-buff', derivable: true, buffName: casterOnly }],
            config: {
                type: 'buff',
                buffName: 'Aura Attack Up',
                parsedEffects: { attack: 30 },
                stacks: 1,
                isStackable: false,
            },
        };
        // (a) Positive: the team grants ITSELF CasterOnly, then the aura. The aura's gate reads
        // the CASTER's ctx (which has CasterOnly) → folds into the attacker's totals.
        const teamWithGate = walkedTeam(
            {
                slots: [
                    {
                        slot: 'active',
                        abilities: [neutralSelfBuff(casterOnly, 5, 'co'), auraGated],
                    },
                ],
            },
            { id: 'taura', stats: teamStats({ attack: 15000 }) }
        );
        // (b) Negative: same aura but the caster never grants CasterOnly → gate fails → no fold.
        const teamNoGate = walkedTeam(
            { slots: [{ slot: 'active', abilities: [auraGated] }] },
            { id: 'taura', stats: teamStats({ attack: 15000 }) }
        );

        const withGate = simulateDPS(baseInput({ teamActors: [teamWithGate], rounds: 3 }));
        const noGate = simulateDPS(baseInput({ teamActors: [teamNoGate], rounds: 3 }));

        // Attacker direct is buffed in the positive case (aura folds into the attacker) and
        // unbuffed in the negative case.
        expect(withGate.rounds[1].directDamage).toBeGreaterThan(noGate.rounds[1].directDamage);
        // Negative case: attacker direct equals a plain no-aura-team baseline (no fold anywhere).
        const plain = simulateDPS(
            baseInput({
                teamActors: [
                    walkedTeam(
                        { slots: [{ slot: 'active', abilities: [] }] },
                        { id: 'taura', stats: teamStats({ attack: 15000 }) }
                    ),
                ],
                rounds: 3,
            })
        );
        expect(noGate.rounds.map((r) => r.directDamage)).toEqual(
            plain.rounds.map((r) => r.directDamage)
        );
    });
});

// --- Reactive parity (Task 6) ----------------------------------------------
// Reactive (live-trigger) buff/debuff/dot/charge abilities on a WALKED team ship register
// their own listeners keyed to that owner's events; the executor routes the follow-up to
// the owner's runtime (its charges, its landing gates, its sourceId). These tests drive the
// full pipeline through simulateDPS and tap the bus where the sourceId is the load-bearing
// assertion.

/** A reactive charge ability on `self` for a given trigger (banks +amount when its event fires). */
const reactiveChargeAbility = (
    trigger: 'on-debuff-inflicted' | 'on-ally-debuff-inflicted' | 'on-crit',
    amount: number,
    id = 'rc'
): Ability => ({
    id,
    type: 'charge',
    target: 'self',
    trigger,
    conditions: [],
    config: { type: 'charge', amount },
});

describe('reactive parity (Task 6)', () => {
    // 1. Team Hemlock: a walked team ship banks +1 charge on its OWN debuff infliction
    //    (on-debuff-inflicted), accelerating its charged-skill cadence. The charged-slot
    //    all-allies buff is the observable signal (it buffs the attacker's damage when it
    //    fires). With the reactive charge ability the team reaches its charged turn EARLIER.
    it('a team on-debuff-inflicted charge ability accelerates the team charged cadence', () => {
        const teamSkills = (withReactive: boolean): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        debuffAbility('Hemlock Down', 3, { defense: -10 }, 'hd'),
                        ...(withReactive ? [reactiveChargeAbility('on-debuff-inflicted', 1)] : []),
                    ],
                },
                {
                    // Charged slot grants the attacker (all-allies) Attack Up — observable in the
                    // attacker's directDamage once the team reaches a charged turn.
                    slot: 'charged',
                    abilities: [allyBuffAbility('Hemlock Boost', 3, { attack: 40 }, 'hb')],
                },
            ],
        });
        const mk = (withReactive: boolean) =>
            simulateDPS(
                baseInput({
                    teamActors: [
                        walkedTeam(teamSkills(withReactive), {
                            id: 'themlock',
                            speed: 140,
                            chargeCount: 2,
                            stats: teamStats({ attack: 15000 }),
                        }),
                    ],
                    rounds: 6,
                })
            );
        const withReactive = mk(true);
        const control = mk(false);

        // The attacker's directDamage jumps the round AFTER the team fires its charged buff.
        // The first such jump arrives EARLIER with the reactive charge banking each round.
        const firstBuffedRound = (rounds: { directDamage: number }[]): number =>
            rounds.findIndex((r, i) => i > 0 && r.directDamage > rounds[0].directDamage);
        const reactiveFlip = firstBuffedRound(withReactive.rounds);
        const controlFlip = firstBuffedRound(control.rounds);
        expect(reactiveFlip).toBeGreaterThanOrEqual(0);
        expect(controlFlip).toBeGreaterThanOrEqual(0);
        expect(reactiveFlip).toBeLessThan(controlFlip);
    });

    // 2. Team on-crit: a team ship (crit 100 → always crits) carries an on-crit enemy-debuff
    //    (Defense Shred-like). The attacker NEVER crits (crit 0), proving the trigger keys on
    //    the TEAM's crit, not the attacker's. The debuff lands from round 1's team crit and is
    //    active the attacker's NEXT turn (drain semantics) → attacker damage rises from round 2.
    it('a team on-crit enemy-debuff fires on the team crit (not the attacker crit) and raises attacker damage', () => {
        const bus = createEventBus();
        const applied: Extract<CombatEvent, { type: 'debuff-applied' }>[] = [];
        bus.on('debuff-applied', (e) => {
            if (e.buffName === 'Crit Shred') applied.push(e);
        });
        const onCritDebuff: Ability = {
            id: 'ocd',
            type: 'debuff',
            target: 'enemy',
            trigger: 'on-crit',
            conditions: [],
            config: {
                type: 'debuff',
                buffName: 'Crit Shred',
                parsedEffects: { defense: -40 },
                stacks: 1,
                isStackable: false,
                application: 'inflict',
                duration: 5,
            },
        };
        // Team always crits (crit 100); has a damage ability (so it performs a crit) + the
        // on-crit debuff. enemyDefense set so the debuff measurably lowers it.
        const team = (withReactive: boolean) =>
            walkedTeam(
                {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                damageAbility(50, 'tdmg'),
                                ...(withReactive ? [onCritDebuff] : []),
                            ],
                        },
                    ],
                },
                {
                    id: 'tcrit',
                    speed: 140,
                    stats: teamStats({ attack: 15000, crit: 100, hacking: 250 }),
                }
            );
        // Attacker crit 0 (never crits) → if the debuff fired it must be the team's crit.
        const withReactive = simulateDPS(
            baseInput({ enemyDefense: 30000, teamActors: [team(true)], rounds: 4, bus })
        );
        const control = simulateDPS(
            baseInput({ enemyDefense: 30000, teamActors: [team(false)], rounds: 4 })
        );

        // Round 1 team crit applies the debuff; it is active the attacker's next turn → round 2
        // attacker damage rises vs the no-reactive control.
        expect(withReactive.rounds[1].directDamage).toBeGreaterThan(control.rounds[1].directDamage);
        // The debuff-applied carries the TEAM's sourceId.
        expect(applied.length).toBeGreaterThan(0);
        expect(applied.every((e) => e.sourceId === 'tcrit')).toBe(true);
    });

    // 3a. Cross-actor: the ATTACKER inflicts a debuff → a team ship's on-ally-debuff-inflicted
    //     charge ability (+1) fires, accelerating its charged cadence (observable via its
    //     charged all-allies buff reaching the attacker EARLIER).
    it('an attacker debuff infliction fires a team on-ally-debuff-inflicted charge ability', () => {
        const attackerSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        damageAbility(100, 'abase'),
                        debuffAbility('Attacker Mark', 3, { defense: -5 }, 'amk'),
                    ],
                },
            ],
        };
        const teamSkills = (withReactive: boolean): ShipSkills => ({
            slots: [
                {
                    slot: 'active',
                    abilities: withReactive
                        ? [reactiveChargeAbility('on-ally-debuff-inflicted', 1)]
                        : [],
                },
                {
                    slot: 'charged',
                    abilities: [allyBuffAbility('Ally React Boost', 3, { attack: 40 }, 'arb')],
                },
            ],
        });
        const mk = (withReactive: boolean) =>
            simulateDPS(
                baseInput({
                    shipSkills: attackerSkills,
                    teamActors: [
                        walkedTeam(teamSkills(withReactive), {
                            id: 'tallyreact',
                            // SLOWER than the attacker so the attacker's infliction happens first.
                            speed: 80,
                            chargeCount: 2,
                            stats: teamStats({ attack: 15000 }),
                        }),
                    ],
                    rounds: 6,
                })
            );
        const withReactive = mk(true);
        const control = mk(false);

        const firstBuffedRound = (rounds: { directDamage: number }[]): number =>
            rounds.findIndex((r, i) => i > 0 && r.directDamage > rounds[0].directDamage);
        const reactiveFlip = firstBuffedRound(withReactive.rounds);
        const controlFlip = firstBuffedRound(control.rounds);
        expect(reactiveFlip).toBeGreaterThanOrEqual(0);
        expect(reactiveFlip).toBeLessThan(controlFlip);
    });

    // 3b. Reverse: a TEAM infliction → the ATTACKER's on-ally-debuff-inflicted charge ability
    //     fires. Attacker chargeCount 3 + a charged damage ability → its charged round arrives
    //     EARLIER than a control where the team inflicts nothing.
    it('a team debuff infliction fires the attacker on-ally-debuff-inflicted charge ability', () => {
        const attackerSkills: ShipSkills = {
            slots: [
                { slot: 'active', abilities: [damageAbility(50, 'aa')] },
                { slot: 'charged', abilities: [damageAbility(400, 'ac')] },
            ],
        };
        // The reactive charge ability lives on the ATTACKER.
        attackerSkills.slots[0].abilities.push(
            reactiveChargeAbility('on-ally-debuff-inflicted', 1, 'arc')
        );

        const withTeamInflict = walkedTeam(
            {
                slots: [
                    {
                        slot: 'active',
                        abilities: [debuffAbility('Team Mark', 3, { defense: -5 }, 'tmk')],
                    },
                ],
            },
            { id: 'tinflict', speed: 140, stats: teamStats({ attack: 15000 }) }
        );
        // Control: same team but inflicts nothing (no debuff) → attacker's ally listener never fires.
        const noInflict = walkedTeam(
            { slots: [{ slot: 'active', abilities: [] }] },
            { id: 'tinflict', speed: 140, stats: teamStats({ attack: 15000 }) }
        );

        const withReactive = simulateDPS(
            baseInput({
                shipSkills: attackerSkills,
                chargeCount: 3,
                teamActors: [withTeamInflict],
                rounds: 8,
            })
        );
        const control = simulateDPS(
            baseInput({
                shipSkills: attackerSkills,
                chargeCount: 3,
                teamActors: [noInflict],
                rounds: 8,
            })
        );

        // The attacker's first charged round (directDamage > 2× the active hit) arrives earlier
        // when the team's inflictions feed the attacker's ally-charge listener.
        const firstChargedRound = (rounds: { directDamage: number }[]): number =>
            rounds.findIndex((r) => r.directDamage > rounds[0].directDamage * 2);
        expect(firstChargedRound(withReactive.rounds)).toBeGreaterThanOrEqual(0);
        expect(firstChargedRound(withReactive.rounds)).toBeLessThan(
            firstChargedRound(control.rounds)
        );
    });

    // 4. Team DoT feeds the attacker's on-ally-debuff-inflicted listener (dot-applied with the
    //    team sourceId is now subscribed — resolves the Task-4 FUTURE seam). Attacker charge
    //    cadence accelerates vs a control where the team applies no DoT.
    it('a team DoT application fires the attacker on-ally-debuff-inflicted listener (dot-applied seam)', () => {
        const attackerSkills: ShipSkills = {
            slots: [
                { slot: 'active', abilities: [damageAbility(50, 'aa')] },
                { slot: 'charged', abilities: [damageAbility(400, 'ac')] },
            ],
        };
        attackerSkills.slots[0].abilities.push(
            reactiveChargeAbility('on-ally-debuff-inflicted', 1, 'arc')
        );

        const teamDot = walkedTeam(
            { slots: [{ slot: 'active', abilities: [dotAbility('corrosion', 6, 1, 4, 'tdot')] }] },
            { id: 'tdotsrc', speed: 140, stats: teamStats({ attack: 15000, hacking: 250 }) }
        );
        const noDot = walkedTeam(
            { slots: [{ slot: 'active', abilities: [] }] },
            { id: 'tdotsrc', speed: 140, stats: teamStats({ attack: 15000, hacking: 250 }) }
        );

        const withReactive = simulateDPS(
            baseInput({
                shipSkills: attackerSkills,
                chargeCount: 3,
                teamActors: [teamDot],
                rounds: 8,
            })
        );
        const control = simulateDPS(
            baseInput({
                shipSkills: attackerSkills,
                chargeCount: 3,
                teamActors: [noDot],
                rounds: 8,
            })
        );

        const firstChargedRound = (rounds: { directDamage: number }[]): number =>
            rounds.findIndex((r) => r.directDamage > rounds[0].directDamage * 2);
        expect(firstChargedRound(withReactive.rounds)).toBeGreaterThanOrEqual(0);
        expect(firstChargedRound(withReactive.rounds)).toBeLessThan(
            firstChargedRound(control.rounds)
        );
    });

    // 5. start-of-round on a team ship: a team start-of-round self-buff (timed Attack Up) +
    //    damage ability → its teamDamage reflects the buff from round 1 (start-of-round drains
    //    BEFORE any turn this round).
    it('a team start-of-round self-buff is live for the team from round 1', () => {
        const startBuff: Ability = {
            id: 'sob',
            type: 'buff',
            target: 'self',
            trigger: 'start-of-round',
            conditions: [],
            config: {
                type: 'buff',
                buffName: 'Round Start Power',
                parsedEffects: { attack: 30 },
                stacks: 1,
                isStackable: false,
                duration: 1,
            },
        };
        const team = (withBuff: boolean) =>
            walkedTeam(
                {
                    slots: [
                        {
                            slot: 'active',
                            abilities: [
                                damageAbility(100, 'tdmg'),
                                ...(withBuff ? [startBuff] : []),
                            ],
                        },
                    ],
                },
                { id: 'tstart', speed: 140, stats: teamStats({ attack: 15000 }) }
            );
        const withBuff = simulateDPS(baseInput({ teamActors: [team(true)], rounds: 3 }));
        const control = simulateDPS(baseInput({ teamActors: [team(false)], rounds: 3 }));

        // Round 1: start-of-round drains before the team's turn → the team's damage already
        // reflects the buff. teamDamage strictly higher than the no-buff control from round 1.
        expect(withBuff.rounds[0].teamDamage ?? 0).toBeGreaterThan(
            control.rounds[0].teamDamage ?? 0
        );
    });
});
