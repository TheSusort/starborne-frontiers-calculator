/**
 * Owner rulings R109 and R112: DoTs, Bombs and Echoing Burst accumulators are debuffs in every
 * sense, so every DEBUFF-duration extension reaches all three — Lev's crit "all hit enemies have
 * their debuffs extended" and Asphyxiator's inflicted-scope extension over what the cast just
 * applied. A Bomb or Echoing Burst is not a damage-over-time effect, so a DoT-duration extension
 * (Provider's "all damage over time debuffs are extended", an inflicted-scope `extend-dot`)
 * reaches Corrosion, Inferno and generic DoTs alone. Unremovable Acidic Decay is extended too:
 * unremovable is not frozen.
 *
 * Harness: one direct `runPlayerTurn` cast with hand-built runtimes (the `extendStatusCastPath`
 * shape). The turn's loose DoT containers are the bound victim's OWN arrays, exactly as the
 * engine passes them, so every assertion reads the victim actor.
 */
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs, RateGate } from '../playerTurn';
import { createActor, CombatActor, ActiveDoTStack } from '../state';
import { createStatusEngine, StatusEngine, RegisteredAbilityStatus } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate, setupKeyedRng } from '../../calculators/rateAccumulator';
import { Ability, ShipSkills } from '../../../types/abilities';
import { AffinityName, Ship } from '../../../types/ship';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';

const ATTACKER_AFFINITY: AffinityName = 'thermal';

const baseStats = () => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    shieldPenetration: 0,
    defence: 0,
    hp: 20_000,
    speed: 100,
});

function makeRuntime(
    actorId: string,
    skills: ShipSkills,
    opts: { side?: 'player' | 'enemy'; chargedCritGate?: RateGate } = {}
): PlayerActorRuntime {
    const { side = 'player', chargedCritGate = () => false } = opts;
    const actor = createActor({
        id: actorId,
        side,
        kind: 'attacker',
        stats: baseStats(),
        chargeCount: 1,
        startCharged: true,
    });
    return {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: [],
        hasChargedSkill: true,
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        defence: 0,
        hp: 20_000,
        healModifier: 0,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinityDisadvantage: false,
        attackerAffinity: ATTACKER_AFFINITY,
        activeCritGate: () => false,
        chargedCritGate,
        activeHealCritGate: () => false,
        chargedHealCritGate: () => false,
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
}

const dot = (over: Partial<ActiveDoTStack> = {}): ActiveDoTStack => ({
    stacks: 1,
    tier: 1,
    remainingRounds: 1,
    sourceId: 'earlier-caster',
    ...over,
});

/** A victim carrying one of each debuff kind, every duration seeded at a known value. */
function makeLoadedVictim(
    id: string,
    side: 'player' | 'enemy',
    statusEngine: StatusEngine,
    affinity?: AffinityName
): CombatActor {
    const v = createActor({
        id,
        side,
        kind: 'enemy',
        stats: { ...baseStats(), attack: 0, hp: 1_000_000 },
    });
    if (affinity) v.affinity = affinity;
    v.corrosionEntries.push(dot({ stacks: 2 }));
    v.infernoEntries.push(dot());
    // Acidic Decay is a Corrosion entry re-tagged by Belladonna's conversion.
    v.corrosionEntries.push(dot({ remainingRounds: 2, family: 'Acidic Decay', unremovable: true }));
    v.pendingBombs.push({
        countdown: 1,
        damagePerStack: 10,
        stacks: 1,
        tier: 1,
        sourceId: 'earlier-caster',
        affinityMult: 1,
        detonationDamageModifier: 0,
        splashModifier: 0,
    });
    v.pendingAccumulators.push({
        roundsRemaining: 1,
        pct: 50,
        accumulated: 0,
        sourceId: 'earlier-caster',
    });
    const defenseDown: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
        kind: 'timed',
        side: 'enemy',
        sourceSlot: 'active',
        conditions: [],
        duration: 1,
        payload: { buffName: 'Defense Down II', stacks: 1, parsedEffects: { defense: -10 } },
    };
    statusEngine.applyTimedAbilityStatus(1, defenseDown, undefined, id);
    return v;
}

function makeArgs(
    runtime: PlayerActorRuntime,
    victim: CombatActor,
    statusEngine: StatusEngine
): PlayerTurnArgs {
    return {
        runtime,
        enemy: victim,
        statusEngine,
        corrosionEntries: victim.corrosionEntries,
        infernoEntries: victim.infernoEntries,
        genericDoTEntries: victim.genericDoTEntries,
        pendingBombs: victim.pendingBombs,
        pendingAccumulators: victim.pendingAccumulators,
        enemyDefense: 0,
        enemyHp: victim.currentHp,
        enemyType: undefined,
        bus: createEventBus(),
        round: 1,
        targetId: victim.id,
        aoeVictimIds: [victim.id],
        opposingVictimById: new Map([[victim.id, victim]]),
    };
}

const durations = (statusEngine: StatusEngine, v: CombatActor) => ({
    defenseDown: statusEngine
        .timedAbilityStatuses('enemy', undefined, v.id)
        .find((s) => s.payload.buffName === 'Defense Down II')?.active.turnsRemaining,
    corrosion: v.corrosionEntries[0]?.remainingRounds,
    inferno: v.infernoEntries[0]?.remainingRounds,
    acidicDecay: v.corrosionEntries.find((e) => e.family === 'Acidic Decay')?.remainingRounds,
    bomb: v.pendingBombs[0]?.countdown,
    accumulator: v.pendingAccumulators[0]?.roundsRemaining,
});

const UNMOVED = {
    defenseDown: 1,
    corrosion: 1,
    inferno: 1,
    acidicDecay: 2,
    bomb: 1,
    accumulator: 1,
};
const EXTENDED_BY_ONE = {
    defenseDown: 2,
    corrosion: 2,
    inferno: 2,
    acidicDecay: 3,
    bomb: 2,
    accumulator: 2,
};

const levSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'charged',
            abilities: [
                {
                    id: 'lev-extend',
                    type: 'extend-status',
                    target: 'all-enemies',
                    trigger: 'on-cast',
                    conditions: [{ subject: 'self-crit', derivable: true }],
                    config: { type: 'extend-status', statusKind: 'debuff', turns: 1 },
                },
            ],
        },
    ],
});

function castLev(opts: {
    casterSide: 'player' | 'enemy';
    crit: boolean;
    victimAffinity?: AffinityName;
}) {
    const victimSide = opts.casterSide === 'player' ? 'enemy' : 'player';
    const runtime = makeRuntime('lev', levSkills(), {
        side: opts.casterSide,
        chargedCritGate: () => opts.crit,
    });
    const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
    statusEngine.beginRound(1);
    const victim = makeLoadedVictim('victim', victimSide, statusEngine, opts.victimAffinity);
    runPlayerTurn(makeArgs(runtime, victim, statusEngine));
    return durations(statusEngine, victim);
}

beforeEach(() => setupKeyedRng(109));

describe("R109: Lev's crit debuff extension reaches every DoT, Bomb and accumulator", () => {
    it('a crit extends the timed debuff, Corrosion, Inferno, Acidic Decay, Bomb and Echoing Burst', () => {
        expect(castLev({ casterSide: 'player', crit: true })).toEqual(EXTENDED_BY_ONE);
    });

    it('no crit: nothing moves', () => {
        expect(castLev({ casterSide: 'player', crit: false })).toEqual(UNMOVED);
    });

    it('an enemy with affinity advantage over Lev keeps every duration', () => {
        // Thermal Lev is at affinity disadvantage against an electric enemy.
        expect(castLev({ casterSide: 'player', crit: true, victimAffinity: 'electric' })).toEqual(
            UNMOVED
        );
    });

    it('is team-symmetric: an enemy-side Lev extends a player ship the same way', () => {
        expect(castLev({ casterSide: 'enemy', crit: true })).toEqual(EXTENDED_BY_ONE);
    });
});

describe("R112: Provider's DoT extension reaches every DoT but no Bomb or Echoing Burst", () => {
    const providerExtend: Ability = {
        id: 'provider-extend-dot',
        type: 'extend-dot',
        target: 'all-enemies',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'extend-dot', turns: 1, scope: 'active' },
    };

    for (const casterSide of ['player', 'enemy'] as const) {
        it(`${casterSide}-side: "all damage over time debuffs are extended by 1 turn" grows Corrosion, Inferno and Acidic Decay; the Bomb and Echoing Burst keep theirs`, () => {
            const runtime = makeRuntime(
                'provider',
                { slots: [{ slot: 'charged', abilities: [providerExtend] }] },
                { side: casterSide }
            );
            const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
            statusEngine.beginRound(1);
            const victimSide = casterSide === 'player' ? 'enemy' : 'player';
            const victim = makeLoadedVictim('victim', victimSide, statusEngine);
            runPlayerTurn(makeArgs(runtime, victim, statusEngine));
            expect(durations(statusEngine, victim)).toEqual({
                ...UNMOVED,
                corrosion: 2,
                inferno: 2,
                acidicDecay: 3,
            });
        });
    }
});

describe("R109: Lev's extension reaches a covered enemy's DoTs, not only the aimed one's", () => {
    it('both struck enemies have their Bomb and Acidic Decay extended on a crit', () => {
        const runtime = makeRuntime('lev', levSkills(), { chargedCritGate: () => true });
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        const aimed = makeLoadedVictim('aimed', 'enemy', statusEngine);
        const covered = makeLoadedVictim('covered', 'enemy', statusEngine);
        runPlayerTurn({
            ...makeArgs(runtime, aimed, statusEngine),
            aoeVictimIds: [aimed.id, covered.id],
            opposingVictimById: new Map([
                [aimed.id, aimed],
                [covered.id, covered],
            ]),
        });
        expect(durations(statusEngine, aimed)).toEqual(EXTENDED_BY_ONE);
        expect(durations(statusEngine, covered)).toEqual(EXTENDED_BY_ONE);
    });
});

/**
 * Inflicted scope: the cast applies a Corrosion (2 turns), a Bomb (countdown 2) and an Echoing
 * Burst (2 rounds) on top of the victim's standing load. Each extension grows only what this cast
 * applied: Asphyxiator's debuff extension grows all three, a DoT extension the Corrosion alone.
 */
describe('R109/R112: inflicted-scope extensions over what the cast applied', () => {
    const corrosionClause: Ability = {
        id: 'cast-corrosion',
        type: 'dot',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'dot', dotType: 'corrosion', tier: 6, stacks: 1, duration: 2 },
    };
    const bombClause: Ability = {
        id: 'cast-bomb',
        type: 'dot',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'dot', dotType: 'bomb', tier: 100, stacks: 1, duration: 2 },
    };
    const echoClause: Ability = {
        id: 'cast-echo',
        type: 'accumulate-detonate',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'accumulate-detonate', turns: 2, pct: 50 },
    };
    const familylessExtend: Ability = {
        id: 'familyless-extend',
        type: 'extend-dot',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'extend-dot', turns: 1, scope: 'inflicted' },
    };
    const asphyxiatorExtend: Ability = {
        id: 'asphyxiator-extend',
        type: 'extend-status',
        target: 'all-enemies',
        trigger: 'on-cast',
        conditions: [{ subject: 'self-crit', derivable: true }],
        config: { type: 'extend-status', statusKind: 'debuff', turns: 1, scope: 'inflicted' },
    };

    const castWith = (extend: Ability, casterSide: 'player' | 'enemy') => {
        const runtime = makeRuntime(
            'caster',
            {
                slots: [
                    {
                        slot: 'charged',
                        abilities: [corrosionClause, bombClause, echoClause, extend],
                    },
                ],
            },
            { side: casterSide, chargedCritGate: () => true }
        );
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        const victimSide = casterSide === 'player' ? 'enemy' : 'player';
        const victim = makeLoadedVictim('victim', victimSide, statusEngine);
        runPlayerTurn(makeArgs(runtime, victim, statusEngine));
        return victim;
    };

    const freshLanded = (v: CombatActor) => {
        // Instrument: the cast landed its Corrosion, Bomb and Echoing Burst.
        expect(v.corrosionEntries).toHaveLength(3);
        expect(v.pendingBombs).toHaveLength(2);
        expect(v.pendingAccumulators).toHaveLength(2);
        // The standing DoTs are not this cast's.
        expect(v.corrosionEntries[1].remainingRounds).toBe(2);
        expect(v.corrosionEntries[0].remainingRounds).toBe(1);
    };

    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side Asphyxiator extend-status: the fresh Corrosion, Bomb and Echoing Burst grow, the standing ones do not`, () => {
            const v = castWith(asphyxiatorExtend, side);
            freshLanded(v);
            expect(v.corrosionEntries[2].remainingRounds).toBe(3);
            expect(v.pendingBombs.map((b) => b.countdown)).toEqual([1, 3]);
            expect(v.pendingAccumulators.map((a) => a.roundsRemaining)).toEqual([1, 3]);
        });

        it(`${side}-side family-less inflicted extend-dot: the fresh Corrosion grows; the fresh Bomb and Echoing Burst do not`, () => {
            const v = castWith(familylessExtend, side);
            freshLanded(v);
            expect(v.corrosionEntries[2].remainingRounds).toBe(3);
            expect(v.pendingBombs.map((b) => b.countdown)).toEqual([1, 2]);
            expect(v.pendingAccumulators.map((a) => a.roundsRemaining)).toEqual([1, 2]);
        });
    }
});

/** A full-refit Ship carrying a docs/ship-skills.csv record's texts. */
function shipFromCsv(name: string): Ship {
    const rec = loadShipSkillRecords().find((r) => r.name.toUpperCase() === name.toUpperCase());
    if (!rec) throw new Error(`docs/ship-skills.csv: no record for "${name}"`);
    return {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({} as any),
        refits: [{}, {}, {}, {}],
        activeSkillText: rec.active,
        chargeSkillText: rec.charge,
        chargeSkillCharge: rec.chargeCharge,
        firstPassiveSkillText: rec.passives[0],
        secondPassiveSkillText: rec.passives[1],
        thirdPassiveSkillText: rec.passives[2],
    } as Ship;
}

/**
 * Wisteria: "extends the newly inflicted Corrosion by 1 turn with the extension chance equal to
 * this Unit's crit power." The text names Corrosion, so a crit cast that lands Corrosion AND
 * Inferno II extends the Corrosion alone. The extend-dot is the one the parser builds from her
 * refit-active passive.
 */
describe("Wisteria's crit extension grows only the Corrosion it just inflicted", () => {
    beforeAll(() => {
        if (!csvAvailable()) {
            throw new Error(
                'This suite requires docs/ship-skills.csv (gitignored reference data) — copy it in before running'
            );
        }
    });
    it('a crit landing Corrosion and Inferno II, extension roll passing: Corrosion +1, Inferno II stays 2', () => {
        const parsed = buildShipAbilities(shipFromCsv('Wisteria'))
            .slots.flatMap((s) => s.abilities)
            .find((a) => a.config.type === 'extend-dot');
        if (!parsed) throw new Error('Wisteria has no parsed extend-dot');
        const corrosion: Ability = {
            id: 'w-corrosion',
            type: 'dot',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'dot', dotType: 'corrosion', tier: 6, stacks: 1, duration: 3 },
        };
        const inferno: Ability = {
            id: 'w-inferno',
            type: 'dot',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'dot', dotType: 'inferno', tier: 30, stacks: 1, duration: 2 },
        };
        const runtime = makeRuntime(
            'wisteria',
            { slots: [{ slot: 'charged', abilities: [corrosion, inferno, parsed] }] },
            { chargedCritGate: () => true }
        );
        runtime.critDamage = 100;
        runtime.extendChanceGate = () => true;
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        const victim = createActor({
            id: 'victim',
            side: 'enemy',
            kind: 'enemy',
            stats: { ...baseStats(), attack: 0, hp: 1_000_000 },
        });
        runPlayerTurn(makeArgs(runtime, victim, statusEngine));
        // Instrument: both DoTs landed this cast.
        expect(victim.corrosionEntries).toHaveLength(1);
        expect(victim.infernoEntries).toHaveLength(1);
        expect(victim.corrosionEntries[0].remainingRounds).toBe(4);
        expect(victim.infernoEntries[0].remainingRounds).toBe(2);
    });
});
