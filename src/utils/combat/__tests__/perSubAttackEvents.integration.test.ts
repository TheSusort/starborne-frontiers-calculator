/**
 * Multi-hit full-walk attacks, PR2 Task 3 — one `ability-performed` per SUB-ATTACK.
 *
 * A multi-hit skill is N consecutive full-walk attacks (locked game rule), so a positional cast
 * emits N `ability-performed` events instead of one aggregate, each IMMEDIATELY followed by that
 * sub-attack's own `attacked` events.
 *
 * What this file pins, and why each assertion is load-bearing:
 *
 *  1. CARDINALITY — `hits: 3` gives 3 events, `hits: 1` gives exactly 1. The N=1 case is the
 *     cheapest correctness check in the epic: every corpus ship except Enforcer is single-hit, so
 *     any movement there means the change is wrong.
 *  2. INTERLEAVING — at least one `attacked` sits between consecutive events. buildCombatLog's
 *     `attacked` handler fills whichever attack row was created MOST RECENTLY; emitting all N
 *     events first would leave rows 1..N-1 target-less and `finalizeMissEntry` would silently
 *     splice them out as phantom rows. The log-row assertion below is the end-to-end proof.
 *  3. DAMAGE BASIS — Σ of the N events' `damage` equals the one number the single aggregate event
 *     carried (the cast's pre-funnel `directDamage`). The basis is deliberately unchanged; only
 *     the cardinality moved.
 *  4. CRIT ACCOUNTING — Σ of the N events' `critHits` equals the old cast-wide `critPairs`. Using
 *     `critPairs` on every event instead would make `on-crit` count the whole cast N times over.
 *
 *  5-6. THE `attacked` PAYLOAD CHANGE (mandatory extra coverage). Dropping the cast-wide flatten
 *     changes each `attacked` event's `damage` from the victim's cast aggregate to that
 *     sub-attack's slice. No existing corpus test can see it — Enforcer, the only multi-hit ship,
 *     is `Pattern-Base`, so its log amount comes from the ability's own damage, not from
 *     `attacked.damage`. Two real consumers read that field and are pinned here:
 *       • Tenacity's "> 25% of max HP in ONE hit" gate (`emitAttacked.ts` → `triggers.ts`'s
 *         `requireIncomingDamageFracOfMaxHp`), which now correctly sees one sub-attack's damage.
 *       • The combat log's NON-PRIMARY (splash) target `amount`, which takes `attacked.damage`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setRateGateRng, setKeyedRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type AbilityPerformed = Extract<CombatEvent, { type: 'ability-performed' }>;
type Attacked = Extract<CombatEvent, { type: 'attacked' }>;

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `psa${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

/** A damage active whose folded multiplier is re-split across `hits` sub-attacks. */
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

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
/** Single-cell footprint: the anchor only. */
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });
/** Whole-roster footprint: every occupied cell is struck by each sub-attack. */
const allPattern = (): ParsedPattern => ({ raw: 'all', shape: 'all', range: 'all', modifiers: {} });

/** A positioned enemy that never fires back. */
const passiveEnemyAt = (id: string, position: Position, hp = 1_000_000_000) =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        affinity: 'antimatter',
        shipSkills: { slots: [] },
    }) as NonNullable<CombatEngineInput['enemyAttackers']>[number];

/**
 * The focus player at M1 fires a `hits`-hit positional cast. `crit: 100` with a neutral-affinity
 * roster makes every (sub-attack, victim) pair crit, so `critHits` is fully exercised.
 */
const focusCast = (hits: number, pattern: ParsedPattern, crit = 100): CombatEngineInput => ({
    attack: 5000,
    crit,
    critDamage: 100,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [attackSkill(hits)] },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
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
    hp: 1_000_000_000,
    healTargetId: 'attacker',
    position: 'M1',
    target: parsedTarget('front'),
    pattern,
    enemyAttackers: [passiveEnemyAt('anchor', 'M4'), passiveEnemyAt('covered', 'M3')],
});

/** Captures the ORDERED event stream (both types) so interleaving is observable. */
const runStream = (input: CombatEngineInput): CombatEvent[] => {
    const bus = createEventBus();
    const stream: CombatEvent[] = [];
    bus.on('ability-performed', (e) => stream.push(e as CombatEvent));
    bus.on('attacked', (e) => stream.push(e as CombatEvent));
    runCombat({ ...input, bus });
    return stream;
};

const perfOf = (stream: CombatEvent[], actorId: string): AbilityPerformed[] =>
    stream.filter(
        (e): e is AbilityPerformed => e.type === 'ability-performed' && e.actorId === actorId
    );

describe('per-sub-attack ability-performed — cardinality and payload', () => {
    afterEach(() => resetRateGateRng());

    const alwaysCrit = () => {
        // Per-victim crit gates carry `${victimId}:active-crit` stream keys, so the keyed provider
        // must be set too or the covered victim bypasses the constant draw.
        setRateGateRng(() => 0);
        setKeyedRng(() => 0);
    };

    it('a hits:3 positional cast emits THREE ability-performed events', () => {
        idc = 0;
        alwaysCrit();
        expect(perfOf(runStream(focusCast(3, basePattern())), 'attacker')).toHaveLength(3);
    });

    it('a hits:1 positional cast emits EXACTLY ONE — the N=1 invariant', () => {
        idc = 0;
        alwaysCrit();
        // Every corpus ship except Enforcer lands here. If this ever reads anything but 1, the
        // whole golden corpus moves.
        expect(perfOf(runStream(focusCast(1, basePattern())), 'attacker')).toHaveLength(1);
    });

    it('each event is IMMEDIATELY followed by its own sub-attack’s attacked events', () => {
        idc = 0;
        alwaysCrit();
        const stream = runStream(focusCast(3, basePattern())).filter(
            (e) =>
                (e.type === 'ability-performed' && e.actorId === 'attacker') ||
                (e.type === 'attacked' && e.attackerId === 'attacker')
        );
        // Shape: performed, attacked, performed, attacked, performed, attacked.
        const kinds = stream.map((e) => (e.type === 'ability-performed' ? 'P' : 'a'));
        expect(kinds.join('')).toBe('PaPaPa');
        // Stated as the invariant rather than the literal shape: NO two events are adjacent.
        for (let i = 1; i < kinds.length; i++) {
            if (kinds[i] === 'P') expect(kinds[i - 1]).toBe('a');
        }
    });

    it('Σ of the three events’ damage equals the cast total the single event carried', () => {
        idc = 0;
        alwaysCrit();
        // MEASURED, not assumed: `multiplier: 100, hits: 3` is three FULL 100% hits (the folded
        // multiplier is 300, re-split three ways), so a 3-hit cast deals 3× a 1-hit cast — NOT the
        // same total split three ways. The plan's suggested "capture the total from a
        // hits:1-equivalent run" would have pinned the wrong number.
        const stream = runStream(focusCast(3, basePattern()));
        const triple = perfOf(stream, 'attacker');
        expect(triple).toHaveLength(3);

        // Independent reference for the cast total: the `attacked` events' own damage, which is
        // the post-funnel booked intake. With no shield/barrier/transfer in this fixture the two
        // bases coincide, so Σ of the events must reproduce it exactly.
        const booked = stream
            .filter((e): e is Attacked => e.type === 'attacked' && e.attackerId === 'attacker')
            .reduce((s, e) => s + (e.damage ?? 0), 0);
        expect(booked).toBeGreaterThan(0);
        expect(triple.reduce((s, e) => s + (e.damage ?? 0), 0)).toBeCloseTo(booked, 6);

        // Split EVENLY, not front-loaded — and one sub-attack of a 3-hit cast reports exactly what
        // a 1-hit cast's single aggregate event reports.
        const single = perfOf(runStream(focusCast(1, basePattern())), 'attacker');
        for (const e of triple) expect(e.damage).toBeCloseTo(single[0].damage!, 6);
    });

    it('Σ of the events’ critHits equals the cast-wide critPairs it replaced', () => {
        idc = 0;
        alwaysCrit();
        // 3 sub-attacks × 2 footprint victims, all critting → the pre-PR2 single event carried
        // critPairs = 6. Each per-sub-attack event must carry 2, never 6.
        const triple = perfOf(runStream(focusCast(3, allPattern())), 'attacker');
        expect(triple).toHaveLength(3);
        for (const e of triple) {
            expect(e.didCrit).toBe(true);
            expect(e.critHits).toBe(2);
            expect([...(e.critVictimIds ?? [])].sort()).toEqual(['anchor', 'covered']);
        }
        expect(triple.reduce((s, e) => s + (e.critHits ?? 0), 0)).toBe(6);
    });

    it('a non-critting hits:3 cast still emits three events, each with critHits omitted', () => {
        idc = 0;
        setRateGateRng(() => 0.9);
        setKeyedRng(() => 0.9);
        const triple = perfOf(runStream(focusCast(3, basePattern(), 0)), 'attacker');
        expect(triple).toHaveLength(3);
        for (const e of triple) {
            expect(e.didCrit).toBe(false);
            expect(e.critHits).toBeUndefined();
        }
    });
});

/**
 * THE FUNNEL-DIVERSION CASE — a sub-attack that struck victims but BOOKED NOTHING.
 *
 * `SubAttackOutcome.damage` is the POST-funnel `incomingBooked` sum, so it is legitimately 0 for a
 * sub-attack whose whole hit the funnel diverted: a Protection cascade moving it onto an ally, or
 * a one-shot transform deferring it into a DoT. Under the locked rule that is still a real
 * attack — it resolved an anchor, expanded a footprint and rolled — so it MUST emit its own
 * `ability-performed`.
 *
 * The plan originally prescribed gating on `victimIds.length === 0 || damage === 0`, which gets
 * this wrong TWICE over: the diverted sub-attack vanishes, AND the survivors are re-inflated,
 * because the per-event damage is `dap.damage / emitting.length` — drop one of three and the other
 * two each report half the cast instead of a third. The gate tests the footprint alone.
 *
 * `Hit Mitigation` is the vehicle because it is a genuine ONE-SHOT (`hitMitigation.ts`): it blocks
 * the NEXT direct hit and is consumed, so exactly sub-attack 0 is diverted and 1-2 land normally —
 * the asymmetry that makes the inflation visible.
 */
describe('a sub-attack whose damage is fully diverted still emits its own event', () => {
    afterEach(() => resetRateGateRng());

    /** An enemy that self-casts a long `Hit Mitigation` from its ACTIVE slot and acts first, so
     *  the one-shot block is armed before the focus attacker's cast. Deals nothing itself. */
    const blockingEnemyAt = (id: string, position: Position) =>
        ({
            id,
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 999 },
            chargeCount: 0,
            startCharged: false,
            position,
            affinity: 'antimatter',
            target: parsedTarget('front'),
            pattern: basePattern(),
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [
                            ab({
                                type: 'buff',
                                target: 'self',
                                config: {
                                    type: 'buff',
                                    buffName: 'Hit Mitigation',
                                    parsedEffects: {},
                                    stacks: 1,
                                    isStackable: false,
                                    duration: 99, // never expires inside the fixture
                                },
                            }),
                            ab({ type: 'damage', config: { type: 'damage', multiplier: 0 } }),
                        ],
                    },
                ],
            },
        }) as NonNullable<CombatEngineInput['enemyAttackers']>[number];

    const run = (blocked: boolean) => {
        idc = 0;
        setRateGateRng(() => 0.9);
        setKeyedRng(() => 0.9);
        const bus = createEventBus();
        const perf: AbilityPerformed[] = [];
        const attacked: Attacked[] = [];
        bus.on('ability-performed', (e) => {
            if (e.actorId === 'attacker') perf.push(e);
        });
        bus.on('attacked', (e) => {
            if (e.attackerId === 'attacker') attacked.push(e);
        });
        runCombat({
            ...focusCast(3, basePattern(), 0),
            speed: 1, // slower than the enemy, so the block is up before the cast
            enemyAttackers: [
                blocked ? blockingEnemyAt('anchor', 'M4') : passiveEnemyAt('anchor', 'M4'),
            ],
            bus,
        });
        return { perf, attacked };
    };

    it('emits all THREE events and leaves the surviving shares uninflated', () => {
        const blockedRun = run(true);
        const control = run(false);

        // Fixture self-check: the block really did swallow sub-attack 0 and nothing else. A
        // fully-transformed hit suppresses its `attacked` signal (it dealt no direct damage), so
        // the blocked run shows 2 where the control shows 3. Without this the test could pass
        // vacuously against a fixture where Hit Mitigation never fired.
        expect(control.attacked).toHaveLength(3);
        expect(blockedRun.attacked).toHaveLength(2);

        // THE cardinality claim: a diverted sub-attack is still an attack.
        expect(blockedRun.perf).toHaveLength(3);

        // THE inflation claim: every event carries the same share as the unblocked control — one
        // third of the cast. Under the rejected `damage === 0` gate this run would have produced
        // TWO events each carrying HALF the cast, i.e. 1.5× these numbers.
        const share = control.perf[0].damage!;
        expect(share).toBeGreaterThan(0);
        for (const e of blockedRun.perf) expect(e.damage).toBeCloseTo(share, 6);
        expect(blockedRun.perf.reduce((s, e) => s + (e.damage ?? 0), 0)).toBeCloseTo(3 * share, 6);
    });
});

/**
 * MANDATORY EXTRA COVERAGE 1 — Tenacity's "> 25% of max HP" gate.
 *
 * The gate reads `attacked.damage`. Before PR2 every per-hit `attacked` of a multi-hit cast
 * carried the victim's CAST-WIDE aggregate, so a 3-hit attack whose individual hits were each
 * well under the threshold still tripped it (three times over). Now each event carries its own
 * sub-attack's slice, so the gate measures what it says it measures: one hit.
 *
 * Self-calibrating: the first run measures the actual per-sub-attack slice, and the two graded
 * runs pick a max HP relative to it. `3·slice < maxHp < 4·slice` is the window where the victim
 * survives the cast AND one slice clears 25% of its max HP.
 */
describe('attacked payload — Tenacity’s >25%-of-max-HP gate sees ONE sub-attack', () => {
    afterEach(() => resetRateGateRng());

    /** The real TENACITY shape (buildEquipmentAbilities): on-attacked, frac-gated, no proc roll. */
    const tenacityLike = (): Ability => ({
        id: 'tenacity-like',
        type: 'buff',
        target: 'self',
        trigger: 'on-attacked',
        conditions: [],
        config: {
            type: 'buff',
            buffName: 'Buff Protection',
            duration: 2,
            stacks: 1,
            isStackable: false,
            parsedEffects: {},
        },
        requireIncomingDamageFracOfMaxHp: 0.25,
    });

    /** A player victim at M3 carrying the frac-gated reactive, with a chosen max HP. */
    const victim = (hp: number): NonNullable<CombatEngineInput['teamActors']>[number] =>
        ({
            id: 'victim',
            speed: 1,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            position: 'M3' as Position,
            affinity: 'antimatter',
            walk: {
                shipSkills: { slots: [{ slot: 'passive', abilities: [tenacityLike()] }] },
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 0,
                    defence: 0,
                    hp,
                },
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        }) as NonNullable<CombatEngineInput['teamActors']>[number];

    /** A 3-hit ENEMY attacker at M4 pointed at the player victim (enemy→player positional path). */
    const enemyMultiHit = () =>
        ({
            id: 'enemy-mh',
            stats: {
                attack: 5000,
                crit: 0,
                critDamage: 100,
                defence: 0,
                hp: 1_000_000_000,
                speed: 200,
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M4' as Position,
            affinity: 'antimatter',
            target: parsedTarget('front'),
            pattern: basePattern(),
            shipSkills: { slots: [attackSkill(3)] },
        }) as NonNullable<CombatEngineInput['enemyAttackers']>[number];

    const runVictim = (hp: number) => {
        const bus = createEventBus();
        const attacked: Attacked[] = [];
        const protections: CombatEvent[] = [];
        // Ordered enemy-side stream: the enemy path is the only one that splits emission across
        // `deferEmission` / `emitDeferred`, so its interleaving needs its own lock.
        const stream: CombatEvent[] = [];
        bus.on('ability-performed', (e) => {
            if (e.actorId === 'enemy-mh') stream.push(e as CombatEvent);
        });
        bus.on('attacked', (e) => {
            if (e.attackerId === 'enemy-mh') stream.push(e as CombatEvent);
            if (e.targetId === 'victim') attacked.push(e);
        });
        bus.on('buff-applied', (e) => {
            if (e.buffName === 'Buff Protection') protections.push(e as CombatEvent);
        });
        runCombat({
            // The focus player sits at M1 and does nothing meaningful; the enemy is the attacker.
            attack: 0,
            crit: 0,
            critDamage: 100,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [attackSkill(1)] },
            enemyDefense: 0,
            enemyHp: 1_000_000_000,
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
            hp: 1_000_000_000,
            healTargetId: 'victim',
            position: 'M1',
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [victim(hp)],
            enemyAttackers: [enemyMultiHit()],
            bus,
        });
        return { attacked, protections: protections.length, stream };
    };

    it('each attacked carries its SUB-ATTACK’s damage, not the cast aggregate', () => {
        idc = 0;
        setRateGateRng(() => 0.9);
        setKeyedRng(() => 0.9);
        const { attacked } = runVictim(1_000_000_000);
        // Three sub-attacks, one victim → three `attacked`, each with an equal third of the cast.
        expect(attacked).toHaveLength(3);
        const slices = attacked.map((e) => e.damage!);
        for (const s of slices) expect(s).toBeGreaterThan(0);
        for (const s of slices) expect(s).toBeCloseTo(slices[0], 6);
        // Pre-PR2 every one of these carried the cast total (3× this). That over-reporting is what
        // the two graded runs below discriminate.
    });

    it('does NOT fire when only the CAST total clears 25% — one sub-attack does not', () => {
        idc = 0;
        setRateGateRng(() => 0.9);
        setKeyedRng(() => 0.9);
        const slice = runVictim(1_000_000_000).attacked[0].damage!;
        // maxHp = 8·slice → 25% of it is 2·slice. One sub-attack (1·slice) is under; the cast
        // total (3·slice) is over. Pre-PR2 this fired three times; it must now fire zero.
        expect(runVictim(8 * slice).protections).toBe(0);
    });

    it('DOES fire when a single sub-attack clears 25% on its own', () => {
        idc = 0;
        setRateGateRng(() => 0.9);
        setKeyedRng(() => 0.9);
        const slice = runVictim(1_000_000_000).attacked[0].damage!;
        // maxHp = 3.5·slice → 25% of it is 0.875·slice, under one sub-attack, and the victim still
        // outlives the 3·slice cast. The gate is genuinely satisfiable on the new basis.
        expect(runVictim(3.5 * slice).protections).toBeGreaterThan(0);
    });

    /**
     * THE ENEMY-PATH INTERLEAVING LOCK.
     *
     * `deferEmission` / `emitDeferred` is PR2's only asymmetric plumbing: the enemy site keeps a
     * LEADING `ability-performed` where the single aggregate emit has always sat and runs the rest
     * of the sequence after its own inline damage-taken-leech tail (SP-U U5). Everything else in
     * this file drives the PLAYER path, which runs the whole sequence in one place, so the enemy
     * split is otherwise covered only by inference.
     *
     * This repo's history is that the enemy path rots silently and specifically (#305 enemy
     * support ships never spent their charges, #306 enemy ships dropped their whole passive slot),
     * so the shape is pinned literally for PR3-PR6 to inherit.
     */
    it('the ENEMY path interleaves too: P a P a P a for a hits:3 enemy cast', () => {
        idc = 0;
        setRateGateRng(() => 0.9);
        setKeyedRng(() => 0.9);
        const { stream } = runVictim(1_000_000_000);
        const kinds = stream.map((e) => (e.type === 'ability-performed' ? 'P' : 'a'));
        expect(kinds.join('')).toBe('PaPaPa');
        // Stated as the invariant too: an event is never followed directly by another event, which
        // is what would leave rows 1..N-1 target-less for finalizeMissEntry to splice out.
        for (let i = 1; i < kinds.length; i++) {
            if (kinds[i] === 'P') expect(kinds[i - 1]).toBe('a');
        }
    });
});

/**
 * MANDATORY EXTRA COVERAGE 2 — the combat log's NON-PRIMARY target amount.
 *
 * `buildCombatLog`'s `attacked` handler takes the primary target's amount from the ability's own
 * damage but a SPLASH victim's amount straight from `attacked.damage`. With a multi-hit AoE that
 * field is now the sub-attack's slice, so each of the N rows reports one sub-attack — the rows sum
 * to the cast rather than each claiming the whole of it.
 *
 * This also proves the INTERLEAVING end-to-end: three rows survive only because each event's own
 * `attacked` arrived before the next event opened a new row. All-events-first would have left rows
 * 1 and 2 target-less and `finalizeMissEntry` would have spliced them out.
 */
describe('combat log — one attack row per sub-attack, splash amount per sub-attack', () => {
    afterEach(() => resetRateGateRng());

    const LOG_ROSTER = [
        { actorId: 'attacker', name: 'Attacker', side: 'player' as const },
        { actorId: 'anchor', name: 'Anchor', side: 'enemy' as const },
        { actorId: 'covered', name: 'Covered', side: 'enemy' as const },
    ];

    const runLog = (hits: number) => {
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        for (const t of [
            'round-started',
            'turn-started',
            'skill-fired',
            'ability-performed',
            'attacked',
            'hp-changed',
            'turn-ended',
            'round-ended',
        ] as const) {
            bus.on(t, (e) => events.push(e as CombatEvent));
        }
        runCombat({ ...focusCast(hits, allPattern()), bus });
        return events;
    };

    it('a hits:3 AoE produces THREE attack rows, each tagged with the skill', async () => {
        idc = 0;
        setRateGateRng(() => 0);
        setKeyedRng(() => 0);
        const { buildCombatLog } = await import('../log/buildCombatLog');
        const events = runLog(3);
        const log = buildCombatLog(events, LOG_ROSTER, new Map());
        const turn = log[0].turns.find((t) => t.actorId === 'attacker')!;
        const rows = turn.entries.filter((e) => e.kind === 'attack' && e.actorId === 'attacker');

        // THE phantom-row check: three rows survived finalizeMissEntry because each carries its
        // own targets.
        expect(rows).toHaveLength(3);
        for (const row of rows) {
            expect(row.targets.map((t) => t.targetId).sort()).toEqual(['anchor', 'covered']);
            // Task 1's sticky tag: rows 2 and 3 are the same named skill, not bare.
            expect(row.slot).toBe(rows[0].slot);
            expect(row.skillName).toBe(rows[0].skillName);
        }

        // The splash victim's amount comes from `attacked.damage` — one sub-attack's slice, so the
        // three rows are equal and sum to the cast rather than each reporting the whole cast.
        const splash = rows.map(
            (row) => row.targets.find((t) => t.targetId === 'covered')!.amount!
        );
        for (const a of splash) expect(a).toBeCloseTo(splash[0], 6);

        // Cross-check against the single-hit control: ONE row, whose splash amount equals ONE of
        // the three above — a sub-attack is a whole attack, so each row reports a full hit rather
        // than the cast-wide aggregate the pre-PR2 single row carried (which was 3× this).
        const singleEvents = runLog(1);
        const singleLog = buildCombatLog(singleEvents, LOG_ROSTER, new Map());
        const singleRows = singleLog[0].turns
            .find((t) => t.actorId === 'attacker')!
            .entries.filter((e) => e.kind === 'attack' && e.actorId === 'attacker');
        expect(singleRows).toHaveLength(1);
        const singleSplash = singleRows[0].targets.find((t) => t.targetId === 'covered')!.amount!;
        for (const a of splash) expect(a).toBeCloseTo(singleSplash, 6);
        // The three rows together report the whole cast, which is 3× a single-hit cast.
        expect(splash.reduce((s, a) => s + a, 0)).toBeCloseTo(3 * singleSplash, 6);
    });
});

/**
 * TASK 4 — the three OUTGOING reactive triggers, measured against the new cardinality.
 *
 * Task 3 changed emission; this block pins what the listeners actually do with it. Each rider is
 * a hand-built stand-in for the real equipment ability of the same shape (the corpus versions are
 * gear/implant-sourced and drag their own proc rolls in):
 *
 *  • `on-deal-damage` → Burner's Inferno rider. Fires once per `ability-performed` that dealt
 *    damage (`triggers.ts`'s `(e.damage ?? 0) <= 0` guard), so N sub-attacks = N applications.
 *  • `on-crit`        → Bloodthirst's damage-dealt self-repair. Enqueues `critHits` times per
 *    event and scales off THAT event's `damage`. This is the headline bug PR2 fixes: pre-PR2 the
 *    single aggregate event carried the WHOLE cast's damage, so all three fires healed off the
 *    full total. The amount, not just the count, is pinned below.
 *  • `on-ally-crit`   → Howler/Sentinel's ally-routed grant. ONE enqueue per critting
 *    `ability-performed`, which now means one per critting SUB-ATTACK while an AoE footprint
 *    stays ONE attack however many victims crit.
 *
 * GUARD SCOPE (verified, not assumed). `oncePerAttackGuardKey` keys only `target: 'self'` riders
 * on `PER_HIT_REACTIVE_TRIGGERS`, and `on-ally-crit` is no longer in that set — self-routed riders
 * (Hermes's charge + Everliving Regeneration) therefore fan out per sub-attack exactly like the
 * ally- and enemy-routed ones, which is the approved decision. The AoE collapse does not depend on
 * the guard at all: it comes from the listener enqueuing at most once per `ability-performed`.
 * Both halves are locked from the other side by `hermesOncePerAttack.integration.test.ts`. The
 * guard itself is untouched and still load-bearing for `on-attacked` / `on-ally-attacked`.
 */

/** A keyed RNG walking a fixed draw sequence per stream key; unlisted keys always draw `fallback`. */
const sequencedKeyedRng = (seqByKey: Record<string, number[]>, fallback = 0.9) => {
    const cursor = new Map<string, number>();
    return (key: string): number => {
        const seq = seqByKey[key];
        if (!seq) return fallback;
        const i = cursor.get(key) ?? 0;
        cursor.set(key, i + 1);
        return seq[Math.min(i, seq.length - 1)];
    };
};

describe('outgoing reactive triggers — per-sub-attack fan-out', () => {
    afterEach(() => resetRateGateRng());

    /** Burner: "applies Inferno" off the wearer's own damage. */
    const burnerLike = (): Ability =>
        ab({
            type: 'dot',
            target: 'enemy',
            trigger: 'on-deal-damage',
            config: { type: 'dot', dotType: 'inferno', tier: 15, stacks: 1, duration: 2 },
        });

    /** Bloodthirst: "repair itself for N% of the damage dealt" on a crit. No procChance so every
     *  enqueue lands — the fixture measures fan-out and amount, not the proc roll. */
    const bloodthirstLike = (): Ability =>
        ab({
            type: 'heal',
            target: 'self',
            trigger: 'on-crit',
            config: { type: 'heal', pct: 20, basis: 'damage-dealt' },
        });

    /** Howler/Sentinel shape: an ALLY-routed grant on on-ally-crit (never self, so ungated). */
    const allyCritRider = (): Ability =>
        ab({
            type: 'buff',
            target: 'ally',
            trigger: 'on-ally-crit',
            config: {
                type: 'buff',
                buffName: 'Blast',
                duration: 2,
                stacks: 1,
                isStackable: false,
                parsedEffects: {},
            },
        });

    /** A do-nothing same-side ally at M3 carrying `abilities` as its passive slot. */
    const observer = (abilities: Ability[]): NonNullable<CombatEngineInput['teamActors']>[number] =>
        ({
            id: 'observer',
            speed: 1,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            position: 'M3' as Position,
            affinity: 'antimatter',
            walk: {
                shipSkills: { slots: [{ slot: 'passive', abilities }] },
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 0,
                    defence: 0,
                    hp: 1_000_000_000,
                },
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        }) as NonNullable<CombatEngineInput['teamActors']>[number];

    /** The focus cast with `riders` bolted on as its own passive slot. */
    const focusWithRiders = (
        hits: number,
        pattern: ParsedPattern,
        riders: Ability[],
        crit = 100
    ): CombatEngineInput => {
        const base = focusCast(hits, pattern, crit);
        return {
            ...base,
            speed: 500, // act before the observer, whose own turn does nothing
            shipSkills: { slots: [attackSkill(hits), { slot: 'passive', abilities: riders }] },
        };
    };

    // -- 1. on-deal-damage ---------------------------------------------------------------

    it('on-deal-damage fires once per SUB-ATTACK: a hits:3 Burner lands three Infernos', () => {
        idc = 0;
        // Every gate open: the reactive DoT still has to clear the wearer's debuff-landing gate.
        setRateGateRng(() => 0);
        setKeyedRng(() => 0);

        const run = (hits: number) => {
            const bus = createEventBus();
            const infernos: Extract<CombatEvent, { type: 'dot-applied' }>[] = [];
            bus.on('dot-applied', (e) => {
                if (e.sourceId === 'attacker' && e.dotType === 'inferno') infernos.push(e);
            });
            runCombat({ ...focusWithRiders(hits, basePattern(), [burnerLike()]), bus });
            return infernos;
        };

        // Pre-PR2 the whole cast collapsed into ONE ability-performed, so the rider fired once
        // however many hits landed. Three sub-attacks are three attacks and apply three stacks.
        expect(run(3)).toHaveLength(3);
        // N=1 control: the single-hit path is untouched.
        expect(run(1)).toHaveLength(1);
    });

    // -- 2. on-crit (the headline bug) ---------------------------------------------------

    it('on-crit fires per critting sub-attack and scales off THAT sub-attack’s damage', () => {
        idc = 0;
        setRateGateRng(() => 0);
        setKeyedRng(() => 0);

        const bus = createEventBus();
        const perf: AbilityPerformed[] = [];
        const heals: Extract<CombatEvent, { type: 'reactive-heal-performed' }>[] = [];
        bus.on('ability-performed', (e) => {
            if (e.actorId === 'attacker') perf.push(e);
        });
        // A reactive heal deliberately emits NO heal-performed (chain guard); this is its event,
        // and its `amount` is the RAW repair, so the focus's full HP cannot clip the measurement.
        bus.on('reactive-heal-performed', (e) => {
            if (e.casterId === 'attacker') heals.push(e);
        });
        runCombat({ ...focusWithRiders(3, basePattern(), [bloodthirstLike()]), bus });

        // Three critting sub-attacks (one victim each → critHits 1) → three enqueues.
        expect(perf).toHaveLength(3);
        for (const e of perf) expect(e.critHits).toBe(1);
        expect(heals).toHaveLength(3);

        // THE amount assertion. Each fire repairs 20% of ITS OWN sub-attack's damage.
        const slice = perf[0].damage!;
        expect(slice).toBeGreaterThan(0);
        for (const h of heals) expect(h.amount).toBeCloseTo(0.2 * slice, 6);

        // Stated as the bug it fixes: pre-PR2 the one aggregate event carried the cast total, so
        // all three fires healed off 3× this. Σ heals must equal 20% of the CAST, not 60%.
        const castTotal = perf.reduce((s, e) => s + (e.damage ?? 0), 0);
        expect(castTotal).toBeCloseTo(3 * slice, 6);
        expect(heals.reduce((s, h) => s + h.amount, 0)).toBeCloseTo(0.2 * castTotal, 6);
        for (const h of heals) expect(h.amount).toBeLessThan(0.2 * castTotal);
    });

    // -- 3. on-ally-crit, per critting sub-attack ----------------------------------------

    it('on-ally-crit fires once per CRITTING sub-attack: 2 of 3 crit → two grants', () => {
        idc = 0;
        // crit 50 → rate 0.5. Draws 0.1/0.1/0.9 on the attacker's own crit sub-stream make
        // sub-attacks 0 and 1 crit and sub-attack 2 whiff the roll. Every other stream draws 0.9,
        // which clears the (rate 1.0) debuff-landing gate and fires nothing else.
        setRateGateRng(() => 0.9);
        setKeyedRng(sequencedKeyedRng({ 'attacker:active-crit': [0.1, 0.1, 0.9] }));

        const bus = createEventBus();
        const perf: AbilityPerformed[] = [];
        const grants: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
        bus.on('ability-performed', (e) => {
            if (e.actorId === 'attacker') perf.push(e);
        });
        bus.on('buff-applied', (e) => {
            if (e.buffName === 'Blast') grants.push(e);
        });
        runCombat({
            ...focusCast(3, basePattern(), 50),
            speed: 500,
            teamActors: [observer([allyCritRider()])],
            bus,
        });

        // Fixture self-check: the crit pattern really is crit / crit / no-crit.
        expect(perf).toHaveLength(3);
        expect(perf.map((e) => e.didCrit)).toEqual([true, true, false]);

        // The approved decision: an ally critting on 2 of 3 sub-attacks fires the rider TWICE.
        expect(grants).toHaveLength(2);
        for (const g of grants) expect(g.actorId).toBe('attacker'); // ally-routed onto the critter
    });

    // -- 4. …but an AoE footprint is still ONE attack ------------------------------------

    it('a single-hit 3-victim AoE that crits TWO victims still fires on-ally-crit ONCE', () => {
        idc = 0;
        setRateGateRng(() => 0.9);
        // One crit draw per footprint victim: two crit, the third does not.
        setKeyedRng(sequencedKeyedRng({ 'attacker:active-crit': [0.1, 0.1, 0.9] }));

        const bus = createEventBus();
        const perf: AbilityPerformed[] = [];
        const grants: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
        bus.on('ability-performed', (e) => {
            if (e.actorId === 'attacker') perf.push(e);
        });
        bus.on('buff-applied', (e) => {
            if (e.buffName === 'Blast') grants.push(e);
        });
        runCombat({
            ...focusCast(1, allPattern(), 50),
            speed: 500,
            teamActors: [observer([allyCritRider()])],
            enemyAttackers: [
                passiveEnemyAt('anchor', 'M4'),
                passiveEnemyAt('covered', 'M3'),
                passiveEnemyAt('third', 'M2'),
            ],
            bus,
        });

        // Fixture self-check: ONE attack, TWO critting victims — the (hit, victim) collapse is
        // what is under test, so the fixture must actually have multiple critting pairs.
        expect(perf).toHaveLength(1);
        expect(perf[0].critHits).toBe(2);

        // The distinction that must survive PR2: per SUB-ATTACK, not per critting pair.
        expect(grants).toHaveLength(1);
    });
});
