/**
 * MEATSHIELD'S TOP-UP STEAL MUST BE REACHABLE FROM HIS REAL KIT.
 *
 * Meatshield is the only ship carrying a top-up buff-steal ("If this Unit has less than 3 stacks
 * of Protection, it steals Protection until this Unit has 3 stacks of Protection"), and the whole
 * clause hangs on a chain that no authored fixture can exercise:
 *
 *   his targeting is `self` → his casts resolve `{ side: 'ally', selection: 'self' }` →
 *   `resolvePositionalTarget` returns `null` for an ally-side target → `selectTurnTarget` hands
 *   back `tgt: undefined` → `buildTurnArgs` omits `targetId`. So the clause must run on a turn
 *   with NO bound victim, resolving its own source through `buffHolderIdByPosition`.
 *
 * `protectionSteal.integration.test.ts` hand-authors the config onto a fixture whose targeting
 * resolves an enemy, which covers the transfer rules and NOTHING of the chain above.
 *
 * These cases therefore build the kit the way production does — `buildTraceShip` +
 * `buildShipAbilities` + `parseShipTargeting` over `docs/ship-skills.csv` / `docs/ship-data.json` —
 * and author only the THIEF. Authoring the thief is fine and deliberate: the axis under test is
 * Meatshield's own self-targeted cast reaching a steal, not the thief's targeting.
 *
 * Both directions are covered (the engine's team-symmetry rule): a PLAYER Meatshield robbed by an
 * enemy thief, and an ENEMY-side Meatshield robbed by the player. One `buildTurnArgs` feeds all
 * three turn sites, so the fix is symmetric by construction — these pin it.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { selfBuffStacksForOwner } from '../triggers';
import type { StatusEngine } from '../statusEngine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern, SkillTargeting } from '../../targetingParser';
import { parseShipTargeting } from '../../targetingParser';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const HUGE_HP = 1_000_000_000;

/** The real Meatshield: skill text from `docs/ship-skills.csv`, targeting from the ship snapshot,
 *  abilities from the production parser. NOTHING about his kit is authored here.
 *
 *  THROWS rather than falling back if the real targeting is not the ally-side one these cases are
 *  about. A default like `?? enemyFacing()` would quietly convert him into an enemy-facing caster,
 *  `targetId` would bind, and every case below would pass through the target-holds-it arm without
 *  ever exercising the no-victim fallback — green, and observing nothing. */
const realMeatshield = (): {
    skills: ShipSkills;
    targeting: { active: SkillTargeting; charged: SkillTargeting };
} => {
    const ship = buildTraceShip('Meatshield');
    if (!ship) throw new Error('Meatshield is missing from the reference data in this worktree');
    const { active, charged } = parseShipTargeting(ship);
    if (!active || !charged) {
        throw new Error('Meatshield has no parsed active/charged targeting in this worktree');
    }
    if (charged.target.side !== 'ally' || charged.target.selection !== 'self') {
        throw new Error(
            `Meatshield's charged targeting is ${charged.target.side}/${charged.target.selection}, ` +
                'not ally/self — these cases test the no-victim path and no longer apply'
        );
    }
    return { skills: buildShipAbilities(ship), targeting: { active, charged } };
};

/** Pallas's shape — "steals 1 buff from the primary target" — authored, because the thief is the
 *  fixture and not the subject. Placed on the ACTIVE slot so it fires on turn one. */
const genericBuffSteal = (): Ability => ({
    id: 'thief-steal',
    type: 'buff-steal',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'buff-steal', count: 1 },
});

const enemyFacing = (selection: ParsedTarget['selection'] = 'front'): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

/** Meatshield's own grant shape — "gains 3 stacks of Protection" — as an aura, authored onto a
 *  BYSTANDER so a fight can hold more than one Protection holder. */
const protectionAura = (stacks: number): Ability => ({
    id: 'bystander-protection',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'buff', buffName: 'Protection', parsedEffects: {}, stacks, isStackable: true },
});

/** A holder that does nothing but stand on a cell carrying Protection. Slowest on the board so it
 *  never acts between the theft and the top-up. */
const bystanderHolder = (id: string, position: Position, stacks = 3): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HUGE_HP, speed: 1 },
    chargeCount: 0,
    startCharged: false,
    position,
    affinity: 'antimatter',
    target: enemyFacing(),
    pattern: basePattern(),
    shipSkills: { slots: [{ slot: 'passive', abilities: [protectionAura(stacks)] }] },
});

/** Run and read every named actor's Protection through the canonical aggregator — the same number
 *  `protectorsFor` acts on, not a parallel bookkeeping channel. */
const runAndReadStacks = (input: CombatEngineInput, ids: string[]): Record<string, number> => {
    let engine: StatusEngine | undefined;
    runCombat({
        ...input,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
    });
    const stacks: Record<string, number> = {};
    for (const id of ids) stacks[id] = selfBuffStacksForOwner(engine!, id, 'Protection');
    return stacks;
};

describe.skipIf(!csvAvailable())("Meatshield's top-up steal is reachable from his real kit", () => {
    it('PRECONDITION: the real kit really carries the top-up config on a SELF-targeted cast', () => {
        const { skills, targeting } = realMeatshield();
        const topUps = skills.slots.flatMap((s) =>
            s.abilities.filter(
                (a) => a.config.type === 'buff-steal' && a.config.buffName !== undefined
            )
        );

        expect(topUps).toHaveLength(1);
        expect(topUps[0].config).toMatchObject({
            type: 'buff-steal',
            buffName: 'Protection',
            upToStacks: 3,
        });
        // The reachability premise, read from the real targeting rather than assumed: his charged
        // cast points at HIMSELF, so no opposing actor is ever bound as `targetId`.
        expect(targeting.charged.target.side).toBe('ally');
        expect(targeting.charged.target.selection).toBe('self');
    });

    it('CONTROL: an enemy thief really does take one of his stacks (the instrument works)', () => {
        // Meatshield WITHOUT his charged skill: the theft lands and nothing tops it back up.
        const stacks = runAndReadStacks(meatshieldVsThief({ charged: false }), [
            'attacker',
            'thief',
        ]);

        expect(stacks.attacker).toBe(2);
        expect(stacks.thief).toBe(1);
    });

    it('PLAYER side: his charged cast steals the stack back even though it targets himself', () => {
        const stacks = runAndReadStacks(meatshieldVsThief({ charged: true }), [
            'attacker',
            'thief',
        ]);

        expect(stacks.attacker).toBe(3);
        expect(stacks.thief).toBe(0);
    });

    it('ENEMY side: an enemy-roster Meatshield tops himself back up identically', () => {
        const stacks = runAndReadStacks(thiefVsEnemyMeatshield(), ['attacker', 'meatshield']);

        expect(stacks.meatshield).toBe(3);
        expect(stacks.attacker).toBe(0);
    });
});

/** The focus IS the real Meatshield; the enemy is an authored thief that outspeeds him, so within
 *  the single round the theft happens BEFORE his cast. */
function meatshieldVsThief({
    charged,
    thiefPosition = 'M4',
    alsoHolding = [],
}: {
    charged: boolean;
    thiefPosition?: Position;
    alsoHolding?: EnemyAttacker[];
}): CombatEngineInput {
    const { skills, targeting } = realMeatshield();
    return {
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 3,
        shipSkills: skills,
        numRounds: 1,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: charged,
        startCharged: charged,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: HUGE_HP,
        hacking: 100_000,
        speed: 100,
        healTargetId: 'attacker',
        mode: 'healing',
        position: 'M1',
        target: targeting.active.target,
        pattern: targeting.active.pattern,
        chargedTarget: targeting.charged.target,
        chargedPattern: targeting.charged.pattern,
        // The thief is FIRST in roster order on purpose: every position case below puts the
        // position-preferred holder LATER in this array, so a selector that scanned roster order
        // would answer `thief` and the assertions would read differently.
        enemyAttackers: [
            {
                id: 'thief',
                stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HUGE_HP, speed: 300 },
                chargeCount: 0,
                startCharged: false,
                position: thiefPosition,
                affinity: 'antimatter',
                target: enemyFacing(),
                pattern: basePattern(),
                shipSkills: { slots: [{ slot: 'active', abilities: [genericBuffSteal()] }] },
            },
            ...alsoHolding,
        ],
    };
}

/** The mirror: the real Meatshield sits on the ENEMY roster and the authored thief is the focus. */
function thiefVsEnemyMeatshield(): CombatEngineInput {
    const { skills, targeting } = realMeatshield();
    return {
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [{ slot: 'active', abilities: [genericBuffSteal()] }] },
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
        hp: HUGE_HP,
        hacking: 100_000,
        speed: 300,
        healTargetId: 'attacker',
        mode: 'healing',
        position: 'M1',
        target: enemyFacing(),
        pattern: basePattern(),
        enemyAttackers: [
            {
                id: 'meatshield',
                stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HUGE_HP, speed: 100 },
                chargeCount: 3,
                startCharged: true,
                position: 'M4',
                affinity: 'antimatter',
                target: targeting.active.target,
                pattern: targeting.active.pattern,
                chargedTarget: targeting.charged.target,
                chargedPattern: targeting.charged.pattern,
                shipSkills: skills,
            },
        ],
    };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// WHICH holder gets robbed when several enemies carry the status: BOARD POSITION decides, never
// roster order. Position is the game's tiebreak wherever one is needed — the same rule the speed
// order uses — so the resolver reads `positionTurnRank` (read its doc in `state.ts` for the
// ordering). The whole deficit comes from that ONE ship; it is never split across holders.
//
// Every case here puts the position-preferred holder SECOND in the roster, behind a thief that
// also holds a stack. A resolver that scanned roster order would rob the thief in all of them, so
// these cases fail if the position reduce is replaced by a `.find()`.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('a top-up robs the holder that ranks first by BOARD POSITION', () => {
    /** Both live holders after the thief's opener: the thief (one stolen stack) and the bystander
     *  (three of its own). Meatshield's deficit is 1, so exactly one stack moves — and WHICH ship
     *  loses it is the whole assertion. */
    const runTwoHolders = (
        thiefPosition: Position,
        bystanderPosition: Position
    ): Record<string, number> =>
        runAndReadStacks(
            meatshieldVsThief({
                charged: true,
                thiefPosition,
                alsoHolding: [bystanderHolder('bystander', bystanderPosition)],
            }),
            ['attacker', 'thief', 'bystander']
        );

    it('the whole TOP row outranks the whole MID row: T1 beats M1', () => {
        const stacks = runTwoHolders('M1', 'T1');

        expect(stacks.attacker).toBe(3);
        expect(stacks.bystander).toBe(2);
        expect(stacks.thief).toBe(1);
    });

    it('row beats column: a TOP-4 holder outranks a MID-1 holder', () => {
        const stacks = runTwoHolders('M1', 'T4');

        expect(stacks.attacker).toBe(3);
        expect(stacks.bystander).toBe(2);
        expect(stacks.thief).toBe(1);
    });

    it('within one row the lowest column wins: T1 beats T2', () => {
        const stacks = runTwoHolders('T2', 'T1');

        expect(stacks.attacker).toBe(3);
        expect(stacks.bystander).toBe(2);
        expect(stacks.thief).toBe(1);
    });

    it('and it really can land on the thief — when HE is the better-placed holder', () => {
        // The mirror of the first case, so the assertion is not just "always the bystander". Here
        // roster order and position agree, which is exactly why it proves nothing on its own.
        const stacks = runTwoHolders('T1', 'M1');

        expect(stacks.attacker).toBe(3);
        expect(stacks.thief).toBe(0);
        expect(stacks.bystander).toBe(3);
    });

    it('TEAM SYMMETRY: an enemy-side Meatshield picks its source by position too', () => {
        const stacks = runAndReadStacks(enemyMeatshieldVsTwoPlayerHolders(), [
            'attacker',
            'ally-holder',
            'meatshield',
        ]);

        expect(stacks.meatshield).toBe(3);
        // The player-side ally at T1 outranks the focus thief at M1, so IT pays — even though the
        // focus is first in the player roster by construction (`playerTeam[0]`).
        expect(stacks['ally-holder']).toBe(2);
        expect(stacks.attacker).toBe(1);
    });
});

/** The mirror board: Meatshield on the ENEMY roster, and TWO player-side holders — the focus thief
 *  (one stolen stack, at M1) and a better-placed ally at T1. The focus is unavoidably first in the
 *  player roster, so the ally can only be chosen by position. */
function enemyMeatshieldVsTwoPlayerHolders(): CombatEngineInput {
    const allyHolder: TeamActor = {
        id: 'ally-holder',
        speed: 1,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        role: 'ATTACKER',
        position: 'T1',
        walk: {
            shipSkills: { slots: [{ slot: 'passive', abilities: [protectionAura(3)] }] },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: HUGE_HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    };
    return {
        ...thiefVsEnemyMeatshield(),
        teamActors: [allyHolder],
    };
}
