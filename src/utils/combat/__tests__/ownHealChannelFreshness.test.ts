/**
 * A REPAIR READS ITS RECIPIENT'S OWN INC. REPAIR UP AS IT STANDS AT THE MOMENT OF THE REPAIR.
 *
 * The real case: Meatshield's active grants him `Inc. Repair Up III` (+75%) for 2 turns, and a
 * timed status ticks at its holder's own Post-Turn — after the turn that ticks it to zero has
 * already run. So the Up can be gone while a slower ally's repair is still to come that round.
 * That repair must land without the +75%.
 *
 * The fight, built so the Up runs out on a turn Meatshield does not re-grant it:
 *   - rounds 1-3: Meatshield casts his active (re-granting the Up each time);
 *   - round 4:    a faster enemy's charged skill puts him in Stasis, so he skips the turn (his
 *                 statuses still tick: 2 → 1);
 *   - round 5:    his charge is full, so he casts his CHARGED skill, which grants no Up; his
 *                 Post-Turn ticks the Up 1 → 0 and it is gone;
 *   - every round a slower ally ("the repairer") repairs every ally for 1% of their max HP.
 * Round 5's repair on Meatshield is the claim: plain, not raised. Round 4's is the liveness
 * control: the Up is still standing there, so the same instrument reads it raised.
 *
 * Meatshield's kit is the production one (`docs/ship-skills.csv` through `buildShipAbilities`);
 * the reference data is gitignored, so its absence THROWS rather than skipping. Both sides of the
 * board are driven, with the same three roles mirrored.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat, type CombatEngineInput, type TeamActorEngineInput } from '../engine';
import { createEventBus } from '../events';
import type { StatusEngine } from '../statusEngine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import {
    parsePattern,
    parseShipTargeting,
    parseTarget,
    type SkillTargeting,
} from '../../targetingParser';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';

type EnemyAttackerInput = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const UP_III = 'Inc. Repair Up III';
const MAX_HP = 1_000_000;
const REPAIR_PCT = 1;
const PLAIN = MAX_HP * (REPAIR_PCT / 100);
/** +75% incoming repair — `src/constants/buffs.ts`'s value for this status name. */
const RAISED = PLAIN * 1.75;

const realMeatshield = (): {
    skills: ShipSkills;
    targeting: { active: SkillTargeting; charged: SkillTargeting };
} => {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing — copy the gitignored reference data into this ' +
                'worktree. These cases read the REAL Meatshield kit and cannot run without it.'
        );
    }
    const ship = buildTraceShip('Meatshield');
    if (!ship) throw new Error('Meatshield is missing from the reference data in this worktree');
    const { active, charged } = parseShipTargeting(ship);
    if (!active || !charged) {
        throw new Error('Meatshield has no parsed active/charged targeting in this worktree');
    }
    return { skills: buildShipAbilities(ship), targeting: { active, charged } };
};

const repairAllAllies: Ability = {
    id: 'repair-all',
    type: 'heal',
    target: 'all-allies',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'heal', pct: REPAIR_PCT, basis: 'target-hp', noCrit: true },
};

const stasisOneTurn: Ability = {
    id: 'jailer-stasis',
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Stasis',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 1,
        application: 'apply',
    },
};

/** The jailer: inert active, Stasis on its charged skill — which, at charge 3, first fires in
 *  round 4. */
const jailerSkills = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        { slot: 'charged', abilities: [stasisOneTurn] },
    ],
});

interface Profile {
    /** The repairer's raw repair on Meatshield, per round (index 0 = round 1). */
    repairOnMeatshield: number[];
    /** Whether Meatshield's Up was standing in his own store at the moment of that repair. */
    upStanding: boolean[];
    /** The slot Meatshield cast each round, or `none` for a skipped turn. */
    meatshieldSlots: string[];
}

function runFight(side: 'player' | 'enemy'): Profile {
    const { skills, targeting } = realMeatshield();
    const meatshieldId = side === 'player' ? 'attacker' : 'meatshield';
    const bus = createEventBus();
    let statusEngine: StatusEngine | undefined;
    const repairOnMeatshield: number[] = [];
    const upStanding: boolean[] = [];
    const slotsByRound = new Map<number, string>();
    bus.on('skill-fired', (e) => {
        if (e.actorId === meatshieldId) slotsByRound.set(e.round, e.slot);
    });
    bus.on('heal-performed', (e) => {
        if (e.casterId !== 'repairer') return;
        const entry = (e.perTarget ?? []).find((t) => t.targetId === meatshieldId);
        if (!entry) return;
        repairOnMeatshield[e.round - 1] = entry.amount;
        upStanding[e.round - 1] = statusEngine!
            .timedAbilityStatuses('self', meatshieldId)
            .some((s) => s.payload.buffName === UP_III);
    });

    const common = {
        numRounds: 5,
        selfBuffs: [],
        enemyDebuffs: [],
        defensePenetration: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        crit: 0,
        critDamage: 0,
        defence: 0,
        attack: 0,
        hacking: 100_000,
        mode: 'healing' as const,
        perRecipientHealApply: true,
        bus,
        __testTapStatusEngine: (e: StatusEngine) => {
            statusEngine = e;
        },
    };

    const repairerWalk = {
        shipSkills: { slots: [{ slot: 'active' as const, abilities: [repairAllAllies] }] },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: MAX_HP,
        },
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    };

    const front = parseTarget('front');
    const base = parsePattern('Pattern-Base');

    if (side === 'player') {
        const repairer: TeamActorEngineInput = {
            id: 'repairer',
            speed: 100,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            position: 'M1',
            target: front,
            pattern: base,
            walk: repairerWalk,
        };
        const jailer: EnemyAttackerInput = {
            id: 'jailer',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: MAX_HP, speed: 500 },
            chargeCount: 3,
            startCharged: false,
            position: 'M1',
            target: front,
            pattern: base,
            chargedTarget: front,
            chargedPattern: base,
            shipSkills: jailerSkills(),
        };
        runCombat({
            ...common,
            hp: MAX_HP,
            speed: 300,
            chargeCount: 3,
            hasChargedSkill: true,
            startCharged: false,
            shipSkills: skills,
            position: 'M4',
            target: targeting.active.target,
            pattern: targeting.active.pattern,
            chargedTarget: targeting.charged.target,
            chargedPattern: targeting.charged.pattern,
            healTargetId: 'attacker',
            teamActors: [repairer],
            enemyAttackers: [jailer],
        });
    } else {
        const meatshield: EnemyAttackerInput = {
            id: meatshieldId,
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: MAX_HP, speed: 300 },
            chargeCount: 3,
            startCharged: false,
            position: 'M4',
            target: targeting.active.target,
            pattern: targeting.active.pattern,
            chargedTarget: targeting.charged.target,
            chargedPattern: targeting.charged.pattern,
            shipSkills: skills,
        };
        const repairer: EnemyAttackerInput = {
            id: 'repairer',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: MAX_HP, speed: 100 },
            chargeCount: 0,
            startCharged: false,
            position: 'M1',
            target: front,
            pattern: base,
            shipSkills: repairerWalk.shipSkills,
        };
        runCombat({
            ...common,
            hp: MAX_HP,
            speed: 500,
            chargeCount: 3,
            hasChargedSkill: true,
            startCharged: false,
            shipSkills: jailerSkills(),
            position: 'M1',
            target: front,
            pattern: base,
            chargedTarget: front,
            chargedPattern: base,
            healTargetId: 'attacker',
            teamActors: [],
            enemyAttackers: [meatshield, repairer],
        });
    }

    return {
        repairOnMeatshield,
        upStanding,
        meatshieldSlots: [1, 2, 3, 4, 5].map((r) => slotsByRound.get(r) ?? 'none'),
    };
}

describe("a repair reads Meatshield's Inc. Repair Up as it stands at the moment of the repair", () => {
    beforeAll(() => {
        realMeatshield();
    });

    for (const side of ['player', 'enemy'] as const) {
        it(`${side}-side Meatshield: a repair after his Up ran out is not raised by it`, () => {
            const fight = runFight(side);

            // The turn script the scenario depends on, read off the fight rather than assumed.
            expect(fight.meatshieldSlots).toEqual([
                'active',
                'active',
                'active',
                'none',
                'charged',
            ]);
            // The Up stands at round 4's repair and is gone by round 5's.
            expect(fight.upStanding.slice(3, 5)).toEqual([true, false]);

            // LIVENESS: while it stands, the same repair is raised by it.
            expect(fight.repairOnMeatshield[3]).toBeCloseTo(RAISED, 6);
            // THE CLAIM: once it has run out, the repair is plain.
            expect(fight.repairOnMeatshield[4]).toBeCloseTo(PLAIN, 6);
        });
    }
});
