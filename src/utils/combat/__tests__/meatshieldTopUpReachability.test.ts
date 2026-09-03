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
 *   with NO bound victim, resolving its own source through `firstEnemyWithBuffId`.
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
function meatshieldVsThief({ charged }: { charged: boolean }): CombatEngineInput {
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
        enemyAttackers: [
            {
                id: 'thief',
                stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HUGE_HP, speed: 300 },
                chargeCount: 0,
                startCharged: false,
                position: 'M4',
                affinity: 'antimatter',
                target: enemyFacing(),
                pattern: basePattern(),
                shipSkills: { slots: [{ slot: 'active', abilities: [genericBuffSteal()] }] },
            },
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
