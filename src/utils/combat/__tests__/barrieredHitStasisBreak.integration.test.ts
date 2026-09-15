/**
 * §4.5 — a hit nullified by Barrier does not reduce Stasis.
 *
 * LOCKED RULING (owner, 2026-09-15), the two halves that decide this file:
 *  - A hit the victim's SHIELD absorbed DID land. Stasis is reduced.
 *  - A hit BARRIER nullified never arrived. Stasis is NOT reduced.
 * So the §4.5 mark cannot be "did a damage ability fire" (what it used to be) nor "did the
 * victim's HP move" (a shield-absorbed hit moves none) — it is "did the hit land", and
 * `outcome.barriered` is the engine's only answer to that question.
 *
 * WHERE THE RULE LIVES. `onVictimPreImpact` reads the break gate at impact (the locked at-impact
 * rule: a victim's own reflect must not un-exempt the hit that triggered it) and stashes the
 * answer; `onVictimResolved` commits it only when the hit was not barriered. Both hooks are in
 * `drivePositionalTurnApply` (engine.ts).
 *
 * WHY THERE IS NO NON-POSITIONAL ARM. `resolveAnchorStasisBreak`'s `?? <cast-time set>` operand,
 * fed by playerTurn's `onHitBreakStasis`, is unreachable through `runCombat`:
 * `normalizeCombatRoster` fills an absent pattern with `DEFAULT_BASE_PATTERN` (see
 * `dpsEnemyPlacement.ts`, which documents the fill), so a damage cast with a resolved victim
 * always drives positionally. No fixture can measure a non-positional barriered hit.
 *
 * INSTRUMENT. Three arms per case, each of which must read differently or the fixture is blind:
 *  - NO BARRIER  — the victim is hit, HP falls, Stasis is reduced, it acts early.
 *  - BARRIER     — the victim is hit, HP does NOT move, Stasis is untouched, it acts on the same
 *                  rounds as the INERT arm.
 *  - INERT       — the same attacker with `doesntBreakStasis`: no mark is ever recorded. This is
 *                  the schedule a victim keeps when nothing breaks its Stasis.
 * The HP row is the Barrier-liveness witness: without it, a Barrier that silently stopped applying
 * would make the BARRIER arm agree with INERT for the wrong reason.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type Selection = ParsedTarget['selection'];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `bhsb${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const parsedTarget = (selection: Selection): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

/** An always-active self-Barrier on the passive slot: full damage immunity for the whole run
 *  (no `duration` — the always-active form), so every hit of every round is nullified. The HP
 *  witness in each describe below is what proves it stayed up. */
const alwaysBarrierPassive = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'buff',
            target: 'self',
            config: {
                type: 'buff',
                buffName: 'Barrier',
                stacks: 1,
                isStackable: false,
                parsedEffects: {},
            },
        }),
    ],
});

const stasisInflictAttack = (turns: number): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
        ab({
            type: 'debuff',
            target: 'enemy',
            config: {
                type: 'debuff',
                buffName: 'Stasis',
                application: 'inflict',
                duration: turns,
                stacks: 1,
                isStackable: false,
                parsedEffects: {},
            },
        }),
    ],
});

// Stasis(6) decays 1/turn naturally and 2/turn when a landing hit also breaks it. ROUNDS must
// outlast the UNBROKEN schedule, or an empty acting list would mean "not yet" rather than "never"
// and the BARRIER arm would read as a pass for the wrong reason.
const STASIS_LONG = 6;
const ROUNDS = 8;

/** Fast player stasis-bot (hp 1 — the culler one-shots it in round 1, so Stasis lands exactly
 *  once and is never refreshed). Geometry lifted from `perFootprintStasisBreak`. */
const playerStasisBot = (
    id: string,
    position: 'M4' | 'M3',
    selection: Selection
): TeamActorEngineInput => ({
    id,
    speed: 1000,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parsedTarget(selection),
    pattern: basePattern(),
    walk: {
        shipSkills: { slots: [stasisInflictAttack(STASIS_LONG)] },
        stats: {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 200,
            defence: 0,
            hp: 1,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
        healModifier: 0,
    },
});

/** A stasis victim that can emit `ability-performed` the moment it is free to act. */
const enemyVictim = (id: string, position: 'M4' | 'M3', barrier: boolean): EnemyAttacker => ({
    id,
    stats: {
        attack: 1,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1_000_000,
        speed: 1,
        security: 0,
        hacking: 0,
    },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: {
        slots: barrier
            ? [basicAttack(), { slot: 'charged', abilities: [] }, alwaysBarrierPassive()]
            : [basicAttack()],
    },
});

/** Enemy culler (T-row): its row-scan reaches the player M-row first and its Line-Range-1 AoE
 *  one-shots the stasis-bots in round 1. The SUT sits at the rear column M1, outside that AoE. */
const enemyCuller = (): EnemyAttacker => ({
    id: 'culler',
    stats: {
        attack: 1_000_000,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 500,
        security: 0,
        hacking: 0,
    },
    chargeCount: 0,
    startCharged: false,
    position: 'T1',
    target: parsedTarget('front'),
    pattern: lineRange1Pattern(),
    shipSkills: { slots: [basicAttack()] },
});

interface Case {
    doesntBreakStasis: boolean;
    pattern: ParsedPattern;
    victims: EnemyAttacker[];
    bots: TeamActorEngineInput[];
}

const build = (c: Case): CombatEngineInput => ({
    attack: 100_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttack()] },
    numRounds: ROUNDS,
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
    hp: 1_000_000_000,
    hacking: 0,
    doesntBreakStasis: c.doesntBreakStasis,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M1',
    speed: 100,
    target: parsedTarget('front'),
    pattern: c.pattern,
    teamActors: c.bots,
    enemyAttackers: [...c.victims, enemyCuller()],
});

const run = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const performed: Extract<CombatEvent, { type: 'ability-performed' }>[] = [];
    const hp: Extract<CombatEvent, { type: 'hp-changed' }>[] = [];
    bus.on('ability-performed', (e) => performed.push(e));
    bus.on('hp-changed', (e) => hp.push(e));
    runCombat({ ...input, bus });
    return {
        actsOn: (id: string) => performed.filter((e) => e.actorId === id).map((e) => e.round),
        lowestHpPct: (id: string) => {
            const own = hp.filter((e) => e.targetId === id);
            return own.length === 0 ? 100 : Math.min(...own.map((e) => e.newPct));
        },
    };
};

describe('a Barriered hit does not reduce Stasis (anchor)', () => {
    const anchorCase = (barrier: boolean, doesntBreakStasis: boolean) =>
        build({
            doesntBreakStasis,
            pattern: basePattern(),
            victims: [enemyVictim('victim', 'M4', barrier)],
            bots: [playerStasisBot('pbot', 'M4', 'front')],
        });

    const noBarrier = () => run(anchorCase(false, false));
    const barriered = () => run(anchorCase(true, false));
    const inert = () => run(anchorCase(false, true));

    it('Barrier is live: the barriered victim takes no damage all run', () => {
        // The liveness witness. Without it, a Barrier that silently stopped applying would make
        // the assertions below pass for the wrong reason.
        expect(noBarrier().lowestHpPct('victim')).toBeLessThan(100);
        expect(barriered().lowestHpPct('victim')).toBe(100);
    });

    it('the break is live: an unbarriered victim is freed earlier than an unbreakable one', () => {
        // The other half of the instrument — proves the acting schedule responds to the break at
        // all, so "BARRIER matches INERT" below is a real reading rather than a constant.
        const hit = noBarrier().actsOn('victim');
        const never = inert().actsOn('victim');
        expect(hit.length).toBeGreaterThan(0);
        expect(never.length).toBeGreaterThan(0);
        expect(hit[0]).toBeLessThan(never[0]);
    });

    it('a barriered victim keeps the schedule of a victim nothing ever hit', () => {
        expect(barriered().actsOn('victim')).toEqual(inert().actsOn('victim'));
    });

    it('and does NOT keep the schedule of a victim whose hits landed', () => {
        expect(barriered().actsOn('victim')).not.toEqual(noBarrier().actsOn('victim'));
    });
});

describe('a Barriered hit does not reduce Stasis (covered footprint victim)', () => {
    // The anchor and the covered victim are marked from the SAME hook but committed into two
    // different sets, so a fix that lands on one path only passes the anchor block above and
    // fails here. Barrier sits on the COVERED victim; the anchor is unbarriered throughout.
    const coveredCase = (coveredBarrier: boolean, doesntBreakStasis: boolean) =>
        build({
            doesntBreakStasis,
            pattern: lineRange1Pattern(),
            victims: [
                enemyVictim('anchor-victim', 'M4', false),
                enemyVictim('covered-victim', 'M3', coveredBarrier),
            ],
            bots: [
                playerStasisBot('pbot-front', 'M4', 'front'),
                playerStasisBot('pbot-back', 'M3', 'back'),
            ],
        });

    it('Barrier is live on the covered victim only', () => {
        const r = run(coveredCase(true, false));
        expect(r.lowestHpPct('covered-victim')).toBe(100);
        expect(r.lowestHpPct('anchor-victim')).toBeLessThan(100);
    });

    it('the covered victim keeps the schedule of a victim nothing ever hit', () => {
        expect(run(coveredCase(true, false)).actsOn('covered-victim')).toEqual(
            run(coveredCase(true, true)).actsOn('covered-victim')
        );
    });

    it('while the unbarriered anchor of that same cast is still freed early', () => {
        const hit = run(coveredCase(true, false)).actsOn('anchor-victim');
        const never = run(coveredCase(true, true)).actsOn('anchor-victim');
        expect(hit.length).toBeGreaterThan(0);
        expect(hit[0]).toBeLessThan(never[0]);
    });

    it('an unbarriered covered victim IS freed early', () => {
        // Non-vacuity for the covered path: the same board with the Barrier removed must move.
        const hit = run(coveredCase(false, false)).actsOn('covered-victim');
        const never = run(coveredCase(false, true)).actsOn('covered-victim');
        expect(hit.length).toBeGreaterThan(0);
        expect(hit[0]).toBeLessThan(never[0]);
    });
});
