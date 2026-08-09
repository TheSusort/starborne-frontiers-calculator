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
 * where `actorId` is the single actor that RECEIVED the buff (confirmed by playerTurn.ts:1777's
 * "buff-applied emits ONCE PER RECIPIENT with the recipient's actorId"). `buffGrantsOf` below
 * filters on `e.actorId === recipientId` instead of `(e.recipientIds ?? []).includes(recipientId)`.
 * The quantity pinned (a per-recipient grant COUNT) and every assertion's expected number are
 * unchanged from the brief.
 *
 * ADAPTATION NOTE 2 (measured, not assumed — the brief's Tenacity-gate fixture math was wrong,
 * and it was masking a genuine engine finding). The brief's comment claims "Each sub-attack deals
 * 5000 x 100% = 5000", but `focusCast` sets `crit: 100, critDamage: 100`, so every hit crits and
 * doubles: the MEASURED per-sub-attack slice is 10,000, not 5,000 (confirmed via
 * `attacked.damage` on a throwaway probe). At the brief's literal `maxHp: 30_000`, three 10,000
 * slices sum to exactly 30,000 — the victim dies exactly on sub-attack 3 of 3 (the last hit is
 * still processed as lethal), and BOTH gate tests then observe 0 grants regardless of the frac
 * threshold. That is not the frac gate discriminating correctly: it is a SEPARATE, genuine engine
 * behavior — `executeIntent`'s dead-owner gate (triggers.ts ~line 2514,
 * `if (owner.actor.destroyedRound !== undefined && !intent.eventCtx?.fromOwnDeath) return;`) drops
 * EVERY queued reactive intent for an owner once `destroyedRound` is set, including intents
 * enqueued by EARLIER, non-lethal sub-attacks of the SAME cast. A multi-hit cast's N sub-attacks
 * appear to enqueue into one shared intent queue that drains only after the whole cast resolves,
 * so a victim who dies on sub-attack 3 loses the reactive buff grants it should already have
 * banked from sub-attacks 1 and 2. Confirmed in isolation with an UNGATED on-attacked buff at the
 * same HP (0 grants at exactly-lethal HP vs 3 at a survivable HP) — the confound has nothing to do
 * with `requireIncomingDamageFracOfMaxHp` specifically.
 *
 * This is flagged here as a GENUINE FINDING, NOT fixed in this task (per this task's own
 * instructions: a failing characterization test is evidence to record, not a defect to patch
 * silently). The two Tenacity gate fixtures below use `maxHp: 50_000` instead of the brief's
 * `30_000` so the victim survives the whole cast and the tests measure the frac gate alone,
 * corroborated by a throwaway probe: at hp 50,000 the SAME 0.25/0.1 thresholds against the
 * measured 10,000 slice give the intended opposite verdicts (0 grants / 3 grants) with no death
 * in the picture. The dead-owner-gate-vs-multi-hit interaction remains open — see task-1-report.md.
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
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
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
    pattern,
    positionalTeamBattle: true,
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

    it('a victim killed by an early sub-attack collects FEWER attacked events than the cast hit count', () => {
        // The drop-out story `emitPerVictimAttacked`'s docstring claims: a dead victim has no
        // entry in later sub-attacks' buckets, so its on-hit reactives do not over-fire.
        // HP 6000 vs a MEASURED 10,000/sub-attack (see ADAPTATION NOTE 2 — the brief assumed
        // 5,000): dies on sub-attack 1, so at most 1 of the 3 `attacked` events can land. The
        // assertion only pins "fewer than 3, more than 0" (not a specific count), so it holds
        // regardless of the exact sub-attack index the victim dies on.
        const frail = {
            ...enemyAt('frail', 'M4'),
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 6_000, speed: 1 },
        } as EnemyAttacker;
        const events = attackedOn(
            focusCast([attackSkill(3)], [frail, enemyAt('spare', 'M3')]),
            'frail'
        );
        expect(events.length).toBeLessThan(3);
        expect(events.length).toBeGreaterThan(0);
    });
});

/** A player team actor at `position` carrying `slots`, which never attacks. */
const teamVictim = (id: string, position: Position, slots: ShipSkills['slots']): TeamActor =>
    ({
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
    }) as TeamActorEngineInput;

/** An enemy that fires an N-hit cast at the player front. */
const offensiveEnemy = (id: string, position: Position, hits: number): EnemyAttacker =>
    ({
        id,
        stats: { attack: 5000, crit: 100, critDamage: 100, defence: 0, hp: HP, speed: 1000 },
        chargeCount: 0,
        startCharged: false,
        position,
        affinity: 'antimatter',
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [attackSkill(hits)] },
    }) as EnemyAttacker;

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
    healTargetId: 'attacker',
    position: 'M1',
    positionalTeamBattle: true,
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
