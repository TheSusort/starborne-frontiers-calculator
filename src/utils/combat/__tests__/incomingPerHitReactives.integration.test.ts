/**
 * Multi-hit full-walk attacks, PR6 Tier 1 — INCOMING reactives resolve once per sub-attack.
 *
 * Locked game rule R1: a `hits: N` skill is N consecutive FULL-WALK attacks, each running the
 * whole pipeline including reactive emission to both sides. R2: effects based on INCOMING hits
 * resolve per hit. `emitAttacked` emits one `attacked` per hit per victim and stamps
 * `subAttackIndex` on every one; the `on-attacked` / `on-ally-attacked` listeners in triggers.ts
 * are enqueue-per-event with no once-per-turn collapse.
 *
 * WHY THIS FILE EXISTS: none of that is observable in the corpus. Enforcer is the ONLY ship with
 * `hits > 1`, and she is `Pattern-Base`, so no golden and no fingerprint can see an incoming-side
 * regression under multi-hit. A green `npm test` today proves nothing about this.
 *
 * THESE ARE CHARACTERIZATION TESTS. They are expected to pass on first run. Their value is
 * failing later — if PR8's debuff restructure, or any future change, collapses per-hit incoming
 * cardinality back to per-cast.
 *
 * Enemy-side coverage (the same rule with the attacker on the other team) is in the second
 * describe block: the enemy path is the one that has silently dropped a mechanic twice
 * (#305, #306), so a player-only fixture would be half a test.
 *
 * ADAPTATION NOTE 1 (task-1-brief.md's stated assumption vs. the real event shape): the brief
 * assumed `buff-applied` carried `recipientIds: string[]`. The real payload
 * (src/utils/combat/events.ts) is `{ actorId: string; granterId?: string; buffName: string; ... }`
 * where `actorId` is the single actor that RECEIVED the buff (confirmed by playerTurn.ts's
 * "buff-applied emits ONCE PER RECIPIENT with the recipient's actorId"). `buffGrantsOf` below
 * filters on `e.actorId === recipientId` instead of `(e.recipientIds ?? []).includes(recipientId)`.
 * The quantity pinned (a per-recipient grant COUNT) and every assertion's expected number are
 * unchanged from the brief.
 *
 * ADAPTATION NOTE 2 (measured, not assumed — the brief's Tenacity-gate fixture math was wrong,
 * and chasing it down surfaced a real engine behavior that a first pass mischaracterized as
 * multi-hit-specific; CORRECTED below after a controlling measurement disproved that framing).
 * The brief's comment claims "Each sub-attack deals 5000 x 100% = 5000", but `focusCast` sets
 * `crit: 100, critDamage: 100`, so every hit crits and doubles: the MEASURED per-sub-attack slice
 * is 10,000, not 5,000 (confirmed via `attacked.damage` on a throwaway probe). At the brief's
 * literal `maxHp: 30_000`, three 10,000 slices sum to exactly 30,000 — the victim dies exactly on
 * sub-attack 3 of 3 (the last hit is still processed as lethal), and BOTH gate tests then observe
 * 0 grants regardless of the frac threshold. That is not the frac gate discriminating correctly:
 * the fixture was confounded by a SEPARATE engine behavior — `executeIntent`'s dead-owner gate
 * (triggers.ts ~line 2514, `if (owner.actor.destroyedRound !== undefined &&
 * !intent.eventCtx?.fromOwnDeath) return;`) drops EVERY queued reactive intent for an owner once
 * `destroyedRound` is set, including intents enqueued by EARLIER sub-attacks of the SAME cast
 * that were themselves non-lethal.
 *
 * CORRECTION: an earlier pass through this file framed that as a multi-hit-specific defect (a
 * shared intent queue draining only after the whole cast resolves, so an N-hit cast's earlier,
 * non-lethal hits lose their already-banked grants when a later hit in the same cast kills the
 * owner). That framing does not survive the controlling experiment: a LETHAL SINGLE-HIT cast
 * drops the grant identically. Measured, holding total damage constant at 30,000 against a
 * 30,000-HP victim carrying an ungated on-attacked self-buff:
 *
 *   | case                                      | grants observed |
 *   |--------------------------------------------|-----------------|
 *   | lethal N=1 (multiplier 300, hits 1)         | 0               |
 *   | lethal N=3 (multiplier 100, hits 3)          | 0               |
 *   | survivable N=1                              | 1               |
 *   | survivable N=3                               | 3               |
 *
 * N=1 and N=3 behave IDENTICALLY when lethal. So this is not a multi-hit interaction at all — it
 * is the dead-owner gate behaving the same regardless of hit count: reactive intents drain at end
 * of turn, after the owner is already marked destroyed, whether that owner died from one hit or
 * from the last of several. Because this behavior is N=1-identical, it sits OUTSIDE this PR's
 * scope (the epic's governing invariant is that N=1 must be byte-identical to pre-epic behavior —
 * a bug that reproduces at N=1 was never introduced by the multi-hit work, and fixing it is
 * out of scope for this PR). It is recorded here as a pre-existing, general engine question —
 * whether a dying victim's reactives should bank before the killing blow — not as a multi-hit
 * defect. Anyone revisiting it
 * should treat it as exactly that general question, not as multi-hit follow-up work.
 *
 * This is flagged as a real (corrected) finding, NOT fixed in this task. The two Tenacity gate
 * fixtures below use `maxHp: 50_000` instead of the brief's `30_000` so the victim survives the
 * whole cast and the tests measure the frac gate alone, corroborated by a throwaway probe: at hp
 * 50,000 the SAME 0.25/0.1 thresholds against the measured 10,000 slice give the intended opposite
 * verdicts (0 grants / 3 grants) with no death in the picture. See task-1-report.md's "Fix pass"
 * section for the full correction and the N=1 control measurement.
 *
 * NOTE ON RNG: unlike sibling files in this epic, no test here calls `setRateGateRng` /
 * `setKeyedRng` directly. `src/setupTests.ts` already installs a seeded mulberry32 (both the
 * unkeyed and keyed streams) before every test, and every gate this file exercises is pinned at a
 * trivial rate: `crit: 100` / `critDamage` always crit (rate 1.0, any draw in [0,1) qualifies),
 * `hacking: 100_000` always lands, and none of the abilities below carry a `procChance`. `on-crit`
 * / `on-attacked` / `on-ally-attacked` triggers and `requireIncomingDamageFracOfMaxHp` are all
 * deterministic comparisons once the crit/landing gates are pinned this way — no draw's outcome
 * is left to chance, so the imports would be unused (confirmed: ESLint's no-unused-vars flagged
 * exactly that on the first pass). `resetRateGateRng()` is kept in every `afterEach` per this
 * epic's convention, even though it is a no-op safety net here.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { resetRateGateRng } from '../../calculators/rateAccumulator';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];
type Attacked = Extract<CombatEvent, { type: 'attacked' }>;

const HP = 10_000_000;

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pr6t1-${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const attackSkill = (hits: number, multiplier = 100): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({
            type: 'damage',
            target: 'enemy',
            config: { type: 'damage', multiplier, ...(hits > 1 ? { hits } : {}) },
        }),
    ],
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

/**
 * Reactive Ward's shape: an `on-attacked` self-buff. Stands in for the whole per-hit implant
 * family (Reactive Ward / Second Wind / Adaptive Plating / Smokescreen) — they differ in payload,
 * not in trigger wiring, so one representative pins the cardinality for all of them.
 *
 * `isStackable` with a high `maxStacks` is deliberate: a non-stacking buff would REFRESH on each
 * arrival and report 1 stack whether it fired once or three times, making the test vacuous.
 */
const onAttackedSelfBuff = (buffName: string): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'buff',
            target: 'self',
            trigger: 'on-attacked',
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

/**
 * Tenacity's shape: `on-attacked` gated on the hit exceeding a fraction of the victim's max HP.
 * `requireIncomingDamageFracOfMaxHp` reads `attacked.damage`, which since PR2 is the SUB-ATTACK's
 * slice rather than the victim's cast-wide aggregate. This is the sharpest assertion in the file
 * (see the gate test below).
 */
const onAttackedGatedBuff = (buffName: string, frac: number): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'buff',
            target: 'self',
            trigger: 'on-attacked',
            requireIncomingDamageFracOfMaxHp: frac,
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

/** Cultivator's shape: `on-ally-attacked` routing a payload to the hit ally. */
const onAllyAttackedBuff = (buffName: string): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'buff',
            target: 'ally',
            trigger: 'on-ally-attacked',
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

/** The focus player at M1 fires `slots` at the front enemy (column 4). */
const focusCast = (
    slots: ShipSkills['slots'],
    enemies: EnemyAttacker[],
    pattern: ParsedPattern = basePattern()
): CombatEngineInput => ({
    attack: 5000,
    crit: 100,
    critDamage: 100,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots },
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
    pattern,
    mode: 'battle',
    enemyAttackers: enemies,
});

/** Collects every `attacked` event aimed at one victim. */
const attackedOn = (input: CombatEngineInput, victimId: string): Attacked[] => {
    const bus = createEventBus();
    const out: Attacked[] = [];
    bus.on('attacked', (e: Attacked) => {
        if (e.targetId === victimId) out.push(e);
    });
    runCombat({ ...input, bus });
    return out;
};

/** Counts `buff-applied` events granting `buffName` to `recipientId`. `actorId` is the RECEIVING
 *  actor (see the file-header adaptation note — the brief assumed a `recipientIds` array; the
 *  real event books one recipient per event via `actorId`). */
const buffGrantsOf = (input: CombatEngineInput, buffName: string, recipientId: string): number => {
    const bus = createEventBus();
    let n = 0;
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.buffName === buffName && e.actorId === recipientId) n++;
    });
    runCombat({ ...input, bus });
    return n;
};

describe('PR6 Tier 1 — incoming reactives fire once per sub-attack (player attacker, enemy victim)', () => {
    afterEach(() => resetRateGateRng());

    it('a 3-hit cast delivers exactly 3 `attacked` events to its single victim, each stamped with a distinct subAttackIndex', () => {
        const victim = enemyAt('victim', 'M4');
        const events = attackedOn(focusCast([attackSkill(3)], [victim]), 'victim');
        // CARDINALITY: 3 sub-attacks, one attacked each. Not 1 (per-cast collapse), not 9
        // (hits x victims — the Pattern-Base footprint has exactly one victim).
        expect(events).toHaveLength(3);
        // IDENTITY: distinct indices prove these are three ATTACKS, not one attack reported
        // three times. A per-cast collapse that merely repeated the event would give [0,0,0].
        expect(events.map((e) => e.subAttackIndex)).toEqual([0, 1, 2]);
    });

    it('N=1 is unchanged — exactly 1 `attacked` event, index 0', () => {
        const victim = enemyAt('victim', 'M4');
        const events = attackedOn(focusCast([attackSkill(1)], [victim]), 'victim');
        expect(events).toHaveLength(1);
        expect(events[0].subAttackIndex).toBe(0);
    });

    it('a 3-hit cast grants an on-attacked self-buff 3 times to the victim, not once', () => {
        const victim = enemyAt('victim', 'M4', [onAttackedSelfBuff('Ward')]);
        // ANTI-VACUITY: the buff is STACKABLE, so a per-cast collapse and a per-hit fan-out give
        // different observable results (1 grant vs 3). A refreshing buff would report the same
        // either way.
        expect(buffGrantsOf(focusCast([attackSkill(3)], [victim]), 'Ward', 'victim')).toBe(3);
    });

    it('N=1 grants the same on-attacked self-buff exactly once', () => {
        const victim = enemyAt('victim', 'M4', [onAttackedSelfBuff('Ward')]);
        expect(buffGrantsOf(focusCast([attackSkill(1)], [victim]), 'Ward', 'victim')).toBe(1);
    });

    it("Tenacity's >25%-of-max-HP gate reads the SUB-ATTACK's slice, not the cast aggregate — a cast that clears the bar only in aggregate does NOT fire", () => {
        // MEASURED (see ADAPTATION NOTE 2 at the top of this file): crit:100/critDamage:100 makes
        // every hit crit and double, so each sub-attack deals 10,000, not the brief's assumed
        // 5,000. maxHp 50_000 (survivable — the victim must NOT die mid-cast, or the dead-owner
        // gate drops every reactive grant regardless of the frac threshold, measuring nothing)
        // => one sub-attack is 20%, the 3-hit cast in aggregate is 60%.
        //
        // ANTI-VACUITY, and the whole point of this test: the gate at 0.25 gives OPPOSITE
        // verdicts on the two candidate bases. Slice basis (correct, post-PR2) => 0.20 < 0.25 =>
        // never fires. Cast-aggregate basis (the pre-PR2 bug) => 0.60 > 0.25 => fires 3 times.
        // A fixture where both bases agree would pass under either and measure nothing.
        const victim = {
            ...enemyAt('victim', 'M4', [onAttackedGatedBuff('Tenacity', 0.25)]),
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 50_000, speed: 1 },
        } as EnemyAttacker;
        expect(buffGrantsOf(focusCast([attackSkill(3)], [victim]), 'Tenacity', 'victim')).toBe(0);
    });

    it('the same gate DOES fire, once per sub-attack, when each individual sub-attack clears the bar', () => {
        // Same fixture, bar lowered to 10%: each 10,000 slice is 20% of 50_000 => clears.
        // Pairs with the test above: together they prove the gate is reading a real number that
        // moves with the threshold, not silently returning a constant.
        const victim = {
            ...enemyAt('victim', 'M4', [onAttackedGatedBuff('Tenacity', 0.1)]),
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 50_000, speed: 1 },
        } as EnemyAttacker;
        expect(buffGrantsOf(focusCast([attackSkill(3)], [victim]), 'Tenacity', 'victim')).toBe(3);
    });

    it('a victim killed mid-cast collects exactly the sub-attacks banked before its death, not the full cast', () => {
        // The drop-out story `emitPerVictimAttacked`'s docstring claims: a dead victim has no
        // entry in later sub-attacks' buckets, so its on-hit reactives do not over-fire.
        // HP 15,000 vs a MEASURED 10,000/sub-attack (see ADAPTATION NOTE 2 — the brief assumed
        // 5,000): the victim survives sub-attack 0 (10,000 dealt, 5,000 left) and dies on
        // sub-attack 1 (10,000 more), never reaching sub-attack 2. That pins exactly 2 events —
        // a count NEITHER failure mode produces: a per-cast collapse gives 1, a broken drop-out
        // (one that keeps delivering to a dead victim) gives 3. 6,000 HP (dies on sub-attack 0)
        // could not make this distinction, since both the correct model and a per-cast collapse
        // yield exactly 1 event there.
        const frail = {
            ...enemyAt('frail', 'M4'),
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 15_000, speed: 1 },
        } as EnemyAttacker;
        const events = attackedOn(
            focusCast([attackSkill(3)], [frail, enemyAt('spare', 'M3')]),
            'frail'
        );
        expect(events.map((e) => e.subAttackIndex)).toEqual([0, 1]);
    });
});

/** A player team actor at `position` carrying `slots`, which never attacks. */
const teamVictim = (id: string, position: Position, slots: ShipSkills['slots']): TeamActor => ({
    id,
    speed: 1,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    walk: {
        shipSkills: { slots },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: HP,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

/** An enemy that fires an N-hit cast at the player front. */
const offensiveEnemy = (id: string, position: Position, hits: number): EnemyAttacker => ({
    id,
    stats: { attack: 5000, crit: 100, critDamage: 100, defence: 0, hp: HP, speed: 1000 },
    chargeCount: 0,
    startCharged: false,
    position,
    affinity: 'antimatter',
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [attackSkill(hits)] },
});

const noopActive: ShipSkills['slots'][number] = {
    slot: 'active',
    abilities: [ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 0 } })],
};

/** The player side is inert; the enemy does all the attacking. */
const enemyDrivenBattle = (team: TeamActor[], enemies: EnemyAttacker[]): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [noopActive] },
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
    healTargetId: 'attacker',
    position: 'M1',
    mode: 'battle',
    teamActors: team,
    enemyAttackers: enemies,
});

describe('PR6 Tier 1 — enemy-side symmetry: the SAME rule with the attacker on the other team', () => {
    afterEach(() => resetRateGateRng());

    it("an enemy's 3-hit cast delivers exactly 3 `attacked` events to its player victim, indices 0..2", () => {
        const input = enemyDrivenBattle(
            [teamVictim('ally', 'M4', [])],
            [offensiveEnemy('foe', 'M1', 3)]
        );
        const events = attackedOn(input, 'ally');
        expect(events).toHaveLength(3);
        expect(events.map((e) => e.subAttackIndex)).toEqual([0, 1, 2]);
    });

    it("an enemy's 3-hit cast grants the player victim's on-attacked self-buff 3 times", () => {
        const input = enemyDrivenBattle(
            [teamVictim('ally', 'M4', [onAttackedSelfBuff('Ward')])],
            [offensiveEnemy('foe', 'M1', 3)]
        );
        expect(buffGrantsOf(input, 'Ward', 'ally')).toBe(3);
    });

    it("Cultivator's on-ally-attacked passive fires 3 times when its ally is hit by a 3-hit cast — the design doc's named R1 example", () => {
        const input = enemyDrivenBattle(
            [
                teamVictim('hit-ally', 'M4', []),
                teamVictim('cultivator', 'M3', [onAllyAttackedBuff('Cultivate')]),
            ],
            [offensiveEnemy('foe', 'M1', 3)]
        );
        // Routed to the DAMAGED ally via damagedAllyId, so the recipient is 'hit-ally'.
        expect(buffGrantsOf(input, 'Cultivate', 'hit-ally')).toBe(3);
    });

    it('N=1 enemy cast fires the same on-ally-attacked passive exactly once', () => {
        const input = enemyDrivenBattle(
            [
                teamVictim('hit-ally', 'M4', []),
                teamVictim('cultivator', 'M3', [onAllyAttackedBuff('Cultivate')]),
            ],
            [offensiveEnemy('foe', 'M1', 1)]
        );
        expect(buffGrantsOf(input, 'Cultivate', 'hit-ally')).toBe(1);
    });
});
