/**
 * A Protection redirect prices each ship's part of the hit with that ship's OWN incoming
 * reductions (owner-measured 2026-10-14, Ripper vs Warden protected by a 3-stack Meatshield):
 *  - the TARGET keeps (1 − frac) of the hit with its own defence and its own reductions;
 *  - the PROTECTOR's chunk is frac × the pre-defence hit (target's affinity carried) × the
 *    protector's defence × the protector's own incoming composition — never the target's.
 * Evidence: Makoli's Inc. Damage Down II on BOTH ships left the target/protector split unchanged
 * (8,971 / 3,744 vs 5,748 / 2,394 → 2.396 vs 2.401), so the protector's share took its own ×0.7;
 * Anemone's "takes 25% less" passive cut Anemone's part but Meatshield's ticks stayed at 498.
 *
 * Every case compares two runs of one board, so the defence curve cancels out of the ratio.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import { checkInvariants } from '../audit/invariants';
import { buildAuditTrail, type BattleResult } from '../../calculators/battleSimulator';
import type { SelectedGameBuff } from '../../../types/calculator';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type Slot = ShipSkills['slots'][number];

const ATTACK = 1000;
const PROTECTOR_DEFENCE = 300;
const TARGET_DEFENCE = 200;

let idc = 0;
const passive = (config: Ability['config']): Slot => ({
    slot: 'passive',
    abilities: [
        {
            id: `own-reductions-${++idc}`,
            type: config.type as Ability['type'],
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config,
        },
    ],
});

/** Protection granted the production way: an aura self-buff. */
const protectionAura = (stacks: number): Slot =>
    passive({
        type: 'buff',
        buffName: 'Protection',
        parsedEffects: {},
        stacks,
        isStackable: true,
    });

/** An always-on Inc. Damage Down (default −30%, the II tier) on its holder. */
const incDamageDownAura = (pct = -30): Slot =>
    passive({
        type: 'buff',
        buffName: 'Inc. Damage Down II',
        parsedEffects: { incomingDamage: pct },
        stacks: 1,
        isStackable: true,
    });

/** A self-only passive "takes 25% less direct damage" (Anemone's shape, condition always). */
const directReductionPassive = (pct: number): Slot =>
    passive({
        type: 'incoming-reduction',
        scope: 'direct',
        condition: 'always',
        pct,
        critFamily: false,
    });

const incomingBy = (input: CombatEngineInput): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const rd of runCombat(input).rounds) {
        for (const [id, b] of Object.entries(rd.perActorIncoming ?? {})) {
            out[id] = (out[id] ?? 0) + (b?.incoming ?? 0);
        }
    }
    return out;
};

// ── Player-side board: an enemy hits ally `target`; ally `protector` holds 3 Protection. ──────

const teamActor = (id: string, defence: number, slots: Slot[]): TeamActorEngineInput => ({
    id,
    speed: 100,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    role: 'ATTACKER',
    walk: {
        shipSkills: { slots },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence,
            hp: 1_000_000_000,
        },
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const playerBoard = (opts: { target?: Slot[]; protector?: Slot[] }): CombatEngineInput => ({
    enemyAttackers: [
        {
            id: 'enemy-1',
            stats: { attack: ATTACK, crit: 0, critDamage: 0, speed: 50 },
            chargeCount: 0,
            startCharged: false,
        },
    ],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    numRounds: 1,
    selfBuffs: [] as SelectedGameBuff[],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000_000,
    healTargetId: 'target',
    mode: 'healing',
    // The focus stays a bystander in the middle row; the enemy's `front` pick is `target`.
    position: 'M2',
    teamActors: [
        { ...teamActor('target', TARGET_DEFENCE, opts.target ?? []), position: 'M4' },
        {
            ...teamActor('protector', PROTECTOR_DEFENCE, [
                protectionAura(3),
                ...(opts.protector ?? []),
            ]),
            position: 'B2',
        },
    ],
});

// ── Enemy-side board: the focus hits enemy `e-target`; enemy `e-protector` holds 3 Protection. ─

const parsedTargetFront: ParsedTarget = { raw: 'front', side: 'enemy', selection: 'front' };
const basePattern: ParsedPattern = { raw: 'base', shape: 'base', range: 0, modifiers: {} };

const enemyShip = (
    id: string,
    defence: number,
    slots: Slot[],
    position?: EnemyAttacker['position']
): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence, hp: 1_000_000_000, speed: 1 },
    chargeCount: 0,
    startCharged: false,
    ...(position ? { position } : {}),
    shipSkills: { slots },
});

const enemyBoard = (opts: { target?: Slot[]; protector?: Slot[] }): CombatEngineInput => ({
    attack: ATTACK,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'own-reductions-basic',
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 100 },
                    },
                ],
            },
        ],
    },
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1_000_000_000,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: parsedTargetFront,
    pattern: basePattern,
    enemyAttackers: [
        enemyShip('e-target', TARGET_DEFENCE, opts.target ?? [], 'M4'),
        enemyShip('e-protector', PROTECTOR_DEFENCE, [protectionAura(3), ...(opts.protector ?? [])]),
    ],
});

const sides = [
    { side: 'player-side protector', board: playerBoard, target: 'target', protector: 'protector' },
    {
        side: 'enemy-side protector',
        board: enemyBoard,
        target: 'e-target',
        protector: 'e-protector',
    },
] as const;

describe.each(sides)('Protection: each ship prices its own part ($side)', (s) => {
    const base = incomingBy(s.board({}));

    it('the fixture redirects: both ships take damage', () => {
        expect(base[s.target]).toBeGreaterThan(0);
        expect(base[s.protector]).toBeGreaterThan(0);
    });

    it('a target-only damage-reduction passive leaves the protector’s chunk unchanged', () => {
        const run = incomingBy(s.board({ target: [directReductionPassive(25)] }));
        expect(run[s.target]).toBeCloseTo(base[s.target] * 0.75, 6);
        expect(run[s.protector]).toBeCloseTo(base[s.protector], 6);
    });

    it('a target-only Inc. Damage Down II leaves the protector’s chunk unchanged', () => {
        const run = incomingBy(s.board({ target: [incDamageDownAura()] }));
        expect(run[s.target]).toBeCloseTo(base[s.target] * 0.7, 6);
        expect(run[s.protector]).toBeCloseTo(base[s.protector], 6);
    });

    it('the protector’s own Inc. Damage Down II cuts its chunk ×0.7; the target is unchanged', () => {
        const run = incomingBy(s.board({ protector: [incDamageDownAura()] }));
        expect(run[s.target]).toBeCloseTo(base[s.target], 6);
        expect(run[s.protector]).toBeCloseTo(base[s.protector] * 0.7, 6);
    });

    it('the protector’s own damage-reduction passive cuts its chunk', () => {
        const run = incomingBy(s.board({ protector: [directReductionPassive(25)] }));
        expect(run[s.target]).toBeCloseTo(base[s.target], 6);
        expect(run[s.protector]).toBeCloseTo(base[s.protector] * 0.75, 6);
    });

    it('Inc. Damage Down II on BOTH keeps the target/protector split (the in-game check)', () => {
        const run = incomingBy(
            s.board({ target: [incDamageDownAura()], protector: [incDamageDownAura()] })
        );
        expect(run[s.target] / run[s.protector]).toBeCloseTo(base[s.target] / base[s.protector], 6);
    });
});

/** One run's incoming totals and its `hit-incoming-factor` rows, as the audit trail reads them. */
const auditedRun = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('hit-incoming-factor', (e) => events.push(e));
    const incoming: Record<string, number> = {};
    for (const rd of runCombat({ ...input, bus }).rounds) {
        for (const [id, b] of Object.entries(rd.perActorIncoming ?? {})) {
            incoming[id] = (incoming[id] ?? 0) + (b?.incoming ?? 0);
        }
    }
    const result: BattleResult = {
        rounds: [],
        outcome: { winner: 'enemy', lastRound: input.numRounds },
        roster: [],
        combatLog: [],
        audit: buildAuditTrail(events),
    };
    return { incoming, result };
};

describe.each(sides)(
    'Protection: the protector chunk is audited against the 70% cap ($side)',
    (s) => {
        const base = auditedRun(s.board({}));
        // −60 Inc. Damage Down × a 40% passive is 0.24, which floors to 0.30.
        const capped = auditedRun(
            s.board({ protector: [incDamageDownAura(-60), directReductionPassive(40)] })
        );
        const protectorRows = (r: ReturnType<typeof auditedRun>) =>
            r.result.audit!.hitIncomingFactors.filter((h) => h.victimId === s.protector);

        it('an unreduced protector chunk has a factor row at 1', () => {
            const rows = protectorRows(base);
            expect(rows.length).toBeGreaterThan(0);
            for (const h of rows) {
                expect(h.factor).toBe(1);
                expect(h.block).toBe('none');
            }
        });

        it('a protector past the cap is priced at 0.30, its rows say so, and the gate holds', () => {
            expect(capped.incoming[s.protector]).toBeCloseTo(base.incoming[s.protector] * 0.3, 6);
            const rows = protectorRows(capped);
            expect(rows.length).toBeGreaterThan(0);
            for (const h of rows) expect(h.factor).toBeCloseTo(0.3, 12);
            expect(checkInvariants(capped.result)).toEqual([]);
        });
    }
);
