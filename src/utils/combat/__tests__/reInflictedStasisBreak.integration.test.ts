/**
 * reInflictedStasisBreak.integration.test.ts — a Stasis the SAME cast re-inflicts suppresses that
 * cast's ANCHOR Stasis break, and the re-inflict is counted over EVERY sub-attack.
 *
 * THE RULE. A direct hit on a stasised anchor queues a §4.5 Stasis break, which shortens the
 * victim's Stasis by one turn when the victim's own skip branch runs. That break is DISCARDED when
 * the same cast re-inflicted Stasis on the victim: the fresh application wins and keeps its full
 * duration. Covered footprint victims have no same-turn re-apply vector and break unconditionally
 * — this file is about the anchor.
 *
 * THE SUB-ATTACK AXIS. A multi-hit cast is N consecutive FULL-WALK attacks, and every sub-attack
 * re-rolls the debuff clause against its own anchor, so one cast can RESIST the Stasis on
 * sub-attack 0 and LAND it on sub-attack 1. Sub-attacks >= 1 resolve inside the positional drive,
 * so the cast's re-inflict answer is complete only once that drive has returned. Answered before
 * it, the cast sees the resist alone, breaks anyway, and shaves a turn off the Stasis it just
 * applied.
 *
 * HOW THE SHAVE IS OBSERVED. There is no direct reader for "full duration" here; the harness
 * records which rounds a victim ACTED (`ability-performed`). Stasis(2) is short enough that one
 * shaved turn frees the victim a whole round early, so the victim's acting rounds ARE the reader.
 *
 * THE SEED. Landing is a hacking(150) vs security(100) roll — a coin flip — so the fixture pins
 * the RNG. `SEED` is chosen for one exact decision chain: round 1 lands Stasis; round 2 RESISTS on
 * sub-attack 0 and LANDS on sub-attack 1 (the re-inflict the break must yield to); round 3 resists
 * both (no re-inflict, so THAT round's break stands and frees the victim for round 4). The arm
 * asserts the whole chain off the emitted events, so a fixture or RNG change that retargets the
 * seed fails loudly instead of quietly measuring something else.
 *
 * The attacker is deliberately UNGATED — no `stasisBreakExemptWhen`. The shield gate is a separate
 * axis and lives in `shieldGatedStasisExemption.integration.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `ris${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const frontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
/** The proven positional shape: a Line-Range-1 cast from M1 onto the opposing M-row resolves a
 *  positional victim, which is what routes the debuff clause through the per-sub-attack re-roll. */
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

const VICTIM = 'enemy-anchor';
const ROUNDS = 4;
const STASIS_TURNS = 2;
// Landing chance is clamp(hacking - security, 0, 100) / 100 — a coin flip, which is what makes a
// resist-then-land cast reachable at all.
const ATTACKER_HACKING = 150;
const VICTIM_SECURITY = 100;
// Selects the decision chain asserted below: round 1 lands, round 2 resists on sub-attack 0 and
// lands on sub-attack 1, round 3 resists both.
const SEED = 7;

/** A 2-hit active carrying a Stasis clause after its damage clause. */
const attackerKit = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'damage',
                    target: 'enemy',
                    config: { type: 'damage', multiplier: 100, hits: 2 },
                }),
                ab({
                    type: 'debuff',
                    target: 'enemy',
                    config: {
                        type: 'debuff',
                        buffName: 'Stasis',
                        application: 'inflict',
                        duration: STASIS_TURNS,
                        stacks: 1,
                        isStackable: false,
                        parsedEffects: {},
                    },
                }),
            ],
        },
    ],
});

/** Survives the whole run and carries a plain attack, so it emits `ability-performed` on any round
 *  its Stasis lets it act. Slower than the attacker, so the attacker's cast always precedes it. */
const victim = (): EnemyAttacker => ({
    id: VICTIM,
    stats: {
        attack: 1,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 1_000_000_000,
        speed: 1,
        security: VICTIM_SECURITY,
        hacking: 0,
    },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    target: frontTarget(),
    pattern: basePattern(),
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({
                        type: 'damage',
                        target: 'enemy',
                        config: { type: 'damage', multiplier: 100 },
                    }),
                ],
            },
        ],
    },
});

const input = (): CombatEngineInput => ({
    attack: 200,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: attackerKit(),
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
    hacking: ATTACKER_HACKING,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M1',
    speed: 100,
    target: frontTarget(),
    pattern: lineRange1Pattern(),
    teamActors: [],
    enemyAttackers: [victim()],
});

interface Run {
    /** The victim's Stasis landing decisions as `r<round>:<outcome>`, in sub-attack order within a
     *  round. `(roll)` marks a resist the hacking-vs-security gate actually DREW, as opposed to a
     *  Block-Debuff or affinity auto-resist. */
    decisions: string[];
    /** The rounds in which the victim acted. */
    acted: number[];
}

const run = (): Run => {
    setupKeyedRng(SEED);
    const bus = createEventBus();
    const performed: Extract<CombatEvent, { type: 'ability-performed' }>[] = [];
    const decisions: string[] = [];
    bus.on('ability-performed', (e) => performed.push(e));
    bus.on('debuff-applied', (e) => {
        if (e.targetId === VICTIM && e.buffName === 'Stasis') decisions.push(`r${e.round}:applied`);
    });
    bus.on('debuff-resisted', (e) => {
        if (e.targetId === VICTIM && e.buffName === 'Stasis')
            decisions.push(`r${e.round}:resisted${e.viaLandingRoll ? '(roll)' : ''}`);
    });
    runCombat({ ...input(), bus });
    return {
        decisions,
        acted: performed.filter((e) => e.actorId === VICTIM).map((e) => e.round),
    };
};

describe('a Stasis re-inflicted on a LATER sub-attack still suppresses the anchor break', () => {
    it('keeps the fresh Stasis at full duration, so the victim acts in round 4', () => {
        const r = run();

        // The precondition, measured rather than assumed: round 2 resists the Stasis on sub-attack
        // 0 and lands it on sub-attack 1. Land-then-resist would produce the reverse order here.
        expect(r.decisions).toEqual([
            'r1:applied',
            'r1:applied',
            'r2:resisted(roll)',
            'r2:applied',
            'r3:resisted(roll)',
            'r3:resisted(roll)',
            'r4:resisted(roll)',
            'r4:resisted(roll)',
        ]);

        // Round 2's cast hits a stasised anchor and re-inflicts Stasis(2) on its second sub-attack,
        // so round 2's break is discarded and the fresh Stasis runs its full length. Round 3's cast
        // lands nothing, so THAT round's break stands: the victim's Stasis clears at the end of
        // round 3 and it acts in round 4 — and only round 4. Counting round 2's re-inflict before
        // the drive has run misses the sub-attack-1 landing, shaves the fresh Stasis, and the
        // victim also acts in round 3.
        expect(r.acted).toEqual([4]);
    });
});
