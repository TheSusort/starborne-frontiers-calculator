/**
 * Multi-hit full-walk attacks — debuff ARRIVAL cardinality.
 *
 * R1: each sub-attack runs the full pipeline including the debuff landing roll, so a 3-hit cast
 * carrying a direct debuff clause applies THREE stacks. PR8 made that true; before it, the landing
 * was drawn once per cast in runPlayerTurn and flushed once after all N sub-attacks.
 *
 * The two N=1 assertions and the two zero-controls below are the regression fence: N=1 arrival is
 * unchanged by PR8 (a single sub-attack keeps the cast-time draw and the historical flush point),
 * and the controls prove the counts are driven by the clause rather than by a stray event or a
 * hard-coded counter.
 *
 * DEVIATIONS FROM task-4-brief.md, corrected per the task's own instructions before writing a
 * single assertion:
 *
 * 1. DAMAGE ARITHMETIC. As in every sibling Tier file: `focusCast` sets `crit: 100,
 *    critDamage: 100`, so every hit crits and doubles. Not load-bearing for this file's
 *    assertions (none of them threshold on HP), but the victim's HP is still sized comfortably
 *    above 3 x 10,000 so no mid-cast death confounds the count (Tier 1's ADAPTATION NOTE 2 trap).
 *
 * 2. `buff-applied` carries `actorId` (the recipient), not `recipientIds` — matching Tier 1's
 *    `buffGrantsOf`, copied verbatim below rather than imported (this epic's established
 *    convention: fixtures and helpers are copied per file, never shared).
 *
 * 3. ANTI-VACUITY (constraint: would a `toBe(1)` also pass if the debuff clause silently never
 *    fired at all, or if the counting apparatus were simply broken?). Two controls guard this,
 *    beyond the brief's own three assertions:
 *      - a "no debuff clause" control on the SAME 3-hit cast shape proves the count is 0 when the
 *        clause is absent — so the pinned "1" is not a stray unrelated event or a hard-coded
 *        constant;
 *      - the on-debuffed reactive test's own "no debuff clause" control proves the same for the
 *        downstream Firewall-style reactive.
 *    Both controls read exactly 0, which a broken-but-coincidentally-nonzero counter could not
 *    produce, ruling out the failure mode the constraint warns about.
 *
 * CORPUS MEASUREMENT (2026-08-09, throwaway scan of docs/ship-skills.csv via buildShipAbilities,
 * refitLevel 4, deleted after capture — see task-4-report.md for the full transcript):
 *
 *   TOTAL SHIPS SCANNED: 147
 *   HITS>1 SHIPS (active/charged, parseHitCount): ["Enforcer"]
 *   SHIPS WITH ANY DIRECT (active/charged) debuff-inflict clause: 49
 *   INTERSECTION (hits>1 AND direct debuff inflict): [] (EMPTY)
 *
 * Enforcer is confirmed the ONLY corpus row with `hits > 1` (matching the earlier task's
 * finding), and her Defense Shred is a PASSIVE `on-crit` reactive debuff (already per-sub-attack
 * since PR2 — pinned in `subAttackProcGates.integration.test.ts`), not a direct active/charged
 * `inflict` clause, so she does not land in the intersection. The measured intersection is EMPTY,
 * confirming the expectation: PR8's once-per-cast-to-per-sub-attack fix is CORPUS-INERT today —
 * no shipped ship currently exhibits the defect this file pins. This finding is the expected one;
 * report the measurement anyway per the task's instructions, since PR8 needs it as its own record.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resetRateGateRng } from '../../calculators/rateAccumulator';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const HP = 10_000_000;

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pr6t3-${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

/** A plain N-hit damage active, no debuff clause — the "clause absent" control fixture. */
const attackSkill = (hits: number): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({
            type: 'damage',
            target: 'enemy',
            config: { type: 'damage', multiplier: 100, ...(hits > 1 ? { hits } : {}) },
        }),
    ],
});

/** A direct debuff clause on the ACTIVE slot alongside the N-hit damage — the shape PR8 makes
 *  per-sub-attack. */
const activeWithDebuffClause = (hits: number): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({
            type: 'damage',
            target: 'enemy',
            config: { type: 'damage', multiplier: 100, ...(hits > 1 ? { hits } : {}) },
        }),
        ab({
            type: 'debuff',
            target: 'enemy',
            config: {
                type: 'debuff',
                buffName: 'Corrode',
                parsedEffects: { defense: -2 },
                stacks: 1,
                isStackable: true,
                maxStacks: 20,
                duration: 3,
                application: 'inflict',
            },
        }),
    ],
});

/** Reactive Ward-style `on-debuffed` self-buff (the reactive that Firewall/Lockdown-style
 *  effects downstream of debuff arrival ride). Stackable + high maxStacks so a per-sub-attack
 *  fan-out and a per-cast collapse are distinguishable by count, not masked by a refresh. */
const onDebuffedSelfBuff = (buffName: string): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'buff',
            target: 'self',
            trigger: 'on-debuffed',
            config: {
                type: 'buff',
                buffName,
                parsedEffects: { attack: 1 },
                stacks: 1,
                isStackable: true,
                maxStacks: 20,
                duration: 99,
            },
        }),
    ],
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

/** A positioned enemy carrying `slots`, which never attacks unless given an active. */
const enemyAt = (id: string, position: Position, slots: ShipSkills['slots'] = []) =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        affinity: 'antimatter',
        shipSkills: { slots },
    }) as EnemyAttacker;

/** The focus player at M1 fires `slots` at the front enemy (column 4). `hacking` is high so
 *  the debuff landing roll never resists and confounds the count. */
const focusCast = (slots: ShipSkills['slots'], enemies: EnemyAttacker[]): CombatEngineInput => ({
    attack: 5000,
    crit: 100,
    critDamage: 100,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots },
    enemyDefense: 0,
    enemyHp: HP,
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
    affinity: 'antimatter',
    defence: 0,
    hp: HP,
    hacking: 100_000,
    healTargetId: 'attacker',
    position: 'M1',
    target: parsedTarget('front'),
    pattern: basePattern(),
    positionalTeamBattle: true,
    enemyAttackers: enemies,
});

/** Counts `debuff-applied` events naming `buffName` on `targetId`. */
const debuffApplications = (
    input: CombatEngineInput,
    buffName: string,
    targetId: string
): number => {
    const bus = createEventBus();
    let n = 0;
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.buffName === buffName && e.targetId === targetId) n++;
    });
    runCombat({ ...input, bus });
    return n;
};

/** Counts `buff-applied` events granting `buffName` to `recipientId` via `actorId` (the
 *  receiving actor — see DEVIATION 2 above). */
const buffGrantsOf = (input: CombatEngineInput, buffName: string, recipientId: string): number => {
    const bus = createEventBus();
    let n = 0;
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.buffName === buffName && e.actorId === recipientId) n++;
    });
    runCombat({ ...input, bus });
    return n;
};

describe('multi-hit full-walk attacks — debuff arrival is once per SUB-ATTACK (R1)', () => {
    afterEach(() => resetRateGateRng());

    it('control: with NO debuff clause at all, a 3-hit cast produces zero debuff-applied events — proves the count below is driven by the clause, not a stray unrelated event or a hard-coded counter', () => {
        const victim = enemyAt('victim', 'M4');
        const n = debuffApplications(focusCast([attackSkill(3)], [victim]), 'Corrode', 'victim');
        expect(n).toBe(0);
    });

    it('a 3-hit cast with a direct debuff clause applies the debuff ONCE PER SUB-ATTACK (R1)', () => {
        const victim = enemyAt('victim', 'M4');
        const n = debuffApplications(
            focusCast([activeWithDebuffClause(3)], [victim]),
            'Corrode',
            'victim'
        );
        expect(n).toBe(3);
    });

    it('N=1 applies the debuff once — this assertion is CORRECT today and must NOT move in PR8', () => {
        const victim = enemyAt('victim', 'M4');
        const n = debuffApplications(
            focusCast([activeWithDebuffClause(1)], [victim]),
            'Corrode',
            'victim'
        );
        expect(n).toBe(1);
    });

    it('control: with NO debuff clause at all, the on-debuffed reactive never fires — proves the count below is driven by an actual debuff-applied event, not a stray grant', () => {
        const victim = enemyAt('victim', 'M4', [onDebuffedSelfBuff('Firewall')]);
        const n = buffGrantsOf(focusCast([attackSkill(3)], [victim]), 'Firewall', 'victim');
        expect(n).toBe(0);
    });

    it('an on-debuffed reactive on the victim therefore fires once per sub-attack', () => {
        const victim = enemyAt('victim', 'M4', [onDebuffedSelfBuff('Firewall')]);
        const n = buffGrantsOf(
            focusCast([activeWithDebuffClause(3)], [victim]),
            'Firewall',
            'victim'
        );
        expect(n).toBe(3);
    });

    it('N=1 on-debuffed reactive fires exactly once — this assertion is CORRECT today and must NOT move in PR8', () => {
        const victim = enemyAt('victim', 'M4', [onDebuffedSelfBuff('Firewall')]);
        const n = buffGrantsOf(
            focusCast([activeWithDebuffClause(1)], [victim]),
            'Firewall',
            'victim'
        );
        expect(n).toBe(1);
    });
});
