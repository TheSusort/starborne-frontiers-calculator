/**
 * Per-victim crit — end-to-end battle integration (per-victim crit, Task 3).
 *
 * Proves the FULL wiring: playerTurn builds a `rollVictimCrit(victimAffinity)` closure that
 * rolls the attacker's crit gate at THAT victim's affinity-capped rate, and the engine threads
 * it through `drivePositionalApply` into `applyPositionalDamage` so a COVERED AoE victim the
 * attacker is at an affinity DISADVANTAGE against crits less often than the ANCHOR.
 *
 * Fixture: one player AoE attacker (affinity CHEMICAL, base crit 100) fires
 * Pattern-Line-Range-1 targeting `front` — anchoring the front-most enemy (M4) and covering M3.
 *   - ANCHOR enemy (M4): affinity ANTIMATTER → NEUTRAL vs chemical → critCap 100, penalty 0 →
 *     effective crit rate = min(100, 100-0)/100 = 1.0 → ALWAYS crits.
 *   - COVERED enemy (M3): affinity THERMAL → thermal beats chemical → attacker DISADVANTAGED →
 *     critCap 75, penalty 25 → effective crit rate = min(75, 100-25)/100 = 0.75 → crits only on
 *     a draw < 0.75.
 *
 * A gate fires when `rng() < rate` (see rateAccumulator). With a constant scripted RNG of 0.9:
 *   - anchor rate 1.0 → 0.9 < 1.0 → CRITS.
 *   - covered rate 0.75 → 0.9 < 0.75 is FALSE → does NOT crit.
 *   - any crit:0 gate (rate 0) → never fires regardless.
 * So in the same AoE the anchor crits while the disadvantaged covered victim does not — exactly
 * the per-victim behaviour this task ships. Before wiring, the covered victim shared the anchor's
 * crit (both crit) → this test FAILS on the pre-wiring engine.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setRateGateRng, setKeyedRng, resetRateGateRng } from '../../calculators/rateAccumulator';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Ship, AffinityName } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { CombatLogTarget } from '../log/types';

const makeShip = (
    id: string,
    name: string,
    opts: { activeTarget: string; activePattern: string; affinity: AffinityName }
): Ship => ({
    id,
    name,
    rarity: 'legendary',
    faction: 'TERRAN_COMBINE',
    type: 'Attacker',
    baseStats: {
        hp: 0,
        attack: 0,
        defence: 0,
        hacking: 200,
        security: 100,
        crit: 0,
        critDamage: 0,
        speed: 100,
    },
    equipment: {},
    implants: {},
    refits: [],
    affinity: opts.affinity,
    // Single-hit 100% active damage skill so a real firing hit resolves per victim.
    activeSkillText: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
    chargeSkillCharge: 0,
    activeTarget: opts.activeTarget,
    activePattern: opts.activePattern,
});

const placement = (
    ship: Ship,
    position: Position,
    attack: number,
    hp: number,
    crit: number
): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack,
        crit,
        critDamage: 100,
        defensePenetration: 0,
        hacking: 200,
        defence: 0,
        hp,
    },
});

describe('per-victim crit — end-to-end battle (per-victim crit, Task 3)', () => {
    afterEach(() => resetRateGateRng());

    it('a covered victim the attacker is DISADVANTAGED against does NOT crit while the anchor does', () => {
        // Constant RNG 0.9: anchor (rate 1.0) crits; disadvantaged covered (rate 0.75) does not.
        // Per-victim crit gates carry `${victimId}:active-crit` stream keys (SP-0), so a bare
        // `setRateGateRng` override is bypassed by the keyed test provider — set BOTH so the
        // shared constant draw actually reaches every gate this test depends on.
        setRateGateRng(() => 0.9);
        setKeyedRng(() => 0.9);

        const result = simulateBattle({
            playerTeam: [
                // Player AoE attacker: chemical, base crit 100, fires Line-Range-1 at `front`.
                placement(
                    makeShip('p1', 'AoE Attacker', {
                        activeTarget: 'front',
                        activePattern: 'Pattern-Line-Range-1',
                        affinity: 'chemical',
                    }),
                    'M1',
                    5000,
                    1_000_000_000,
                    100
                ),
            ],
            enemyTeam: [
                // ANCHOR (front-most, M4): antimatter → neutral vs chemical → always crits.
                placement(
                    makeShip('e1', 'Anchor', {
                        activeTarget: 'front',
                        activePattern: 'Pattern-Base',
                        affinity: 'antimatter',
                    }),
                    'M4',
                    0,
                    1_000_000_000,
                    0
                ),
                // COVERED (M3): thermal → attacker chemical is DISADVANTAGED → cap 75, penalty 25.
                placement(
                    makeShip('e2', 'Covered', {
                        activeTarget: 'front',
                        activePattern: 'Pattern-Base',
                        affinity: 'thermal',
                    }),
                    'M3',
                    0,
                    1_000_000_000,
                    0
                ),
            ],
            rounds: 1,
        });

        // The player focus fires the AoE in round 1; grab its attack entry.
        const r1 = result.combatLog.find((r) => r.round === 1)!;
        expect(r1).toBeDefined();
        const attackerTurn = r1.turns.find((t) => t.actorId === 'attacker')!;
        expect(attackerTurn).toBeDefined();
        const attackEntry = attackerTurn.entries.find(
            (e) => e.kind === 'attack' && e.actorId === 'attacker'
        )!;
        expect(attackEntry).toBeDefined();

        const byId = new Map<string, CombatLogTarget>(
            attackEntry.targets.map((t) => [t.targetId, t])
        );
        const anchor = byId.get('e:e1:0');
        const covered = byId.get('e:e2:1');

        // Both AoE cells were struck (footprint genuinely covers both occupied cells).
        expect(anchor).toBeDefined();
        expect(covered).toBeDefined();

        // The heart of the task: same AoE, DIFFERENT crit outcomes per victim.
        // (`attacked` omits didCrit for a non-crit → the covered log target is falsy/undefined.)
        expect(anchor!.didCrit).toBe(true); // neutral anchor at rate 1.0 → crits
        expect(covered!.didCrit).toBeFalsy(); // disadvantaged covered at rate 0.75 → does NOT crit
    });

    it('control: when the covered victim is NEUTRAL too, it crits alongside the anchor (rules out a blanket suppression)', () => {
        // Same RNG 0.9 but the covered victim is ANTIMATTER (neutral, rate 1.0) → it MUST crit.
        // Proves the covered victim did not crit in the first case BECAUSE of its affinity
        // disadvantage, not because covered victims are simply never allowed to crit.
        setRateGateRng(() => 0.9);

        const result = simulateBattle({
            playerTeam: [
                placement(
                    makeShip('p1', 'AoE Attacker', {
                        activeTarget: 'front',
                        activePattern: 'Pattern-Line-Range-1',
                        affinity: 'chemical',
                    }),
                    'M1',
                    5000,
                    1_000_000_000,
                    100
                ),
            ],
            enemyTeam: [
                placement(
                    makeShip('e1', 'Anchor', {
                        activeTarget: 'front',
                        activePattern: 'Pattern-Base',
                        affinity: 'antimatter',
                    }),
                    'M4',
                    0,
                    1_000_000_000,
                    0
                ),
                placement(
                    makeShip('e2', 'Covered', {
                        activeTarget: 'front',
                        activePattern: 'Pattern-Base',
                        affinity: 'antimatter', // neutral this time
                    }),
                    'M3',
                    0,
                    1_000_000_000,
                    0
                ),
            ],
            rounds: 1,
        });

        const r1 = result.combatLog.find((r) => r.round === 1)!;
        const attackerTurn = r1.turns.find((t) => t.actorId === 'attacker')!;
        const attackEntry = attackerTurn.entries.find(
            (e) => e.kind === 'attack' && e.actorId === 'attacker'
        )!;
        const byId = new Map<string, CombatLogTarget>(
            attackEntry.targets.map((t) => [t.targetId, t])
        );
        expect(byId.get('e:e1:0')!.didCrit).toBe(true); // anchor crits
        expect(byId.get('e:e2:1')!.didCrit).toBe(true); // neutral covered ALSO crits
    });
});

/**
 * Task 5 — the ATTACKER's aggregate crit signal (the `ability-performed` event) must reflect the
 * PER-VICTIM outcomes on the sim/positional path:
 *   - didCrit  = anyCrit   (OR across all footprint victims — Lev-style "if crit, hit all enemies")
 *   - critHits = critPairs (count of critting (hit, victim) pairs — a per-victim crit-identity
 *                signal on the payload; post-PR7, Bloodthirst no longer rolls its proc per
 *                critting victim, it enqueues once per positional `ability-performed` event and
 *                scales off that event's `deliveredDamage`)
 *
 * BEFORE Task 5 the event carried ANCHOR-based values (critHits ≤ 1 for a single-hit ability), so
 * a single-hit AoE that crit 2 of its 3 covered victims still reported critHits ≤ 1 — this block
 * FAILS on the pre-Task-5 engine and PASSES once the engine emits from {anyCrit, critPairs}.
 *
 * Uses the raw `runCombat` event stream (not the assembled combat log) because critHits is only
 * carried on the `ability-performed` event, not surfaced on the combat-log attack entry.
 */

let ttIdc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pvc${++ttIdc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

// A single-hit basic attack: multiplier 100% (1x), 1 hit, crit-eligible.
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// Whole-team footprint: every occupied enemy cell is an origin (full-scale) victim of the single
// firing hit — so a 1-hit AoE resolves against all three enemies in one cast.
const allPattern = (): ParsedPattern => ({ raw: 'all', shape: 'all', range: 'all', modifiers: {} });

// A positioned enemy with a chosen affinity, no offence (never fires back — irrelevant here).
const passiveEnemyAt = (id: string, position: Position, affinity: AffinityName) =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        affinity,
        shipSkills: { slots: [] },
    }) as NonNullable<CombatEngineInput['enemyAttackers']>[number];

// Focus attacker (chemical, crit 100) at M1 firing a whole-team AoE. healTargetId unlocks the
// positioned enemy roster; numRounds 1 so the focus fires exactly once.
const aoeBattle = (
    enemyAffinities: {
        anchor: AffinityName;
        coveredA: AffinityName;
        coveredB: AffinityName;
    },
    crit = 100
): CombatEngineInput => ({
    attack: 5000,
    crit,
    critDamage: 100,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttack()] },
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
    affinity: 'chemical',
    defence: 0,
    hp: 1_000_000_000,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M1',
    target: parsedTarget('front'),
    pattern: allPattern(),
    enemyAttackers: [
        passiveEnemyAt('anchor', 'M4', enemyAffinities.anchor),
        passiveEnemyAt('covered-a', 'M3', enemyAffinities.coveredA),
        passiveEnemyAt('covered-b', 'M2', enemyAffinities.coveredB),
    ],
});

const runEvents = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    bus.on('ability-performed', (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    return events;
};

describe('per-victim crit — attacker ability-performed crit signal (Task 5)', () => {
    afterEach(() => resetRateGateRng());

    it('single-hit AoE that crits 2 of 3 victims emits critHits=2 and didCrit=true', () => {
        ttIdc = 0;
        // RNG 0.9. Attacker chemical crit 100 vs each victim:
        //   anchor  antimatter → neutral      → rate 1.0  → CRITS  (anchor hitCrits path)
        //   coveredA antimatter → neutral      → rate 1.0  → CRITS  (rollVictimCrit path)
        //   coveredB thermal    → disadvantage → rate 0.75 → NO CRIT
        // => anyCrit true, critPairs 2.
        // Per-victim crit gates carry `${victimId}:active-crit` stream keys (SP-0), so a bare
        // `setRateGateRng` override is bypassed by the keyed test provider — set BOTH so the
        // shared constant draw actually reaches every gate this test depends on.
        setRateGateRng(() => 0.9);
        setKeyedRng(() => 0.9);
        const events = runEvents(
            aoeBattle({ anchor: 'antimatter', coveredA: 'antimatter', coveredB: 'thermal' })
        );

        const focusPerf = events.filter(
            (e): e is Extract<CombatEvent, { type: 'ability-performed' }> =>
                e.type === 'ability-performed' && e.actorId === 'attacker'
        );
        // One ability-performed per SUB-ATTACK (multi-hit full-walk epic, PR2). This fixture is
        // single-hit — an AoE footprint is ONE attack however many victims it spreads over — so
        // the count stays 1. It is the CARDINALITY of hits, not of victims, that fans this out.
        expect(focusPerf.length).toBe(1);
        const perf = focusPerf[0];

        // The heart of Task 5: the attacker signal reflects the per-victim outcomes.
        expect(perf.didCrit).toBe(true); // anyCrit (2 victims critted)
        expect(perf.critHits).toBe(2); // critPairs (anchor + coveredA critted; coveredB did not)
    });

    it('single-hit AoE where all 3 victims crit emits critHits=3', () => {
        ttIdc = 0;
        // All three neutral (antimatter) → rate 1.0 → all crit → critPairs 3.
        setRateGateRng(() => 0.9);
        const events = runEvents(
            aoeBattle({ anchor: 'antimatter', coveredA: 'antimatter', coveredB: 'antimatter' })
        );
        const perf = events.find(
            (e): e is Extract<CombatEvent, { type: 'ability-performed' }> =>
                e.type === 'ability-performed' && e.actorId === 'attacker'
        )!;
        expect(perf.didCrit).toBe(true);
        expect(perf.critHits).toBe(3);
    });

    it('single-hit AoE where no victim crits emits didCrit=false and no critHits', () => {
        ttIdc = 0;
        // Attacker base crit 0 → every victim's rate is 0 → the gate never fires regardless of
        // RNG or affinity → anyCrit false, critPairs 0.
        setRateGateRng(() => 0.9);
        const events = runEvents(
            aoeBattle({ anchor: 'antimatter', coveredA: 'antimatter', coveredB: 'antimatter' }, 0)
        );
        const perf = events.find(
            (e): e is Extract<CombatEvent, { type: 'ability-performed' }> =>
                e.type === 'ability-performed' && e.actorId === 'attacker'
        )!;
        expect(perf.didCrit).toBe(false); // anyCrit false — no victim critted
        expect(perf.critHits).toBeUndefined(); // critPairs 0 → field omitted
    });

    it('enemy POSITIONAL attack with 0 damage still emits one ability-performed (0-damage fallback path)', () => {
        ttIdc = 0;
        // Force 0 damage: set the enemy attacker's attack to 0. The player victims have enormous
        // HP so even a non-zero attack would not kill them, but attack=0 means the firing hit
        // resolves to 0 damage before the `if (damage > 0)` apply block — enemyCritAgg stays
        // undefined and the 0-damage fallback branch (engine.ts) must emit exactly one
        // ability-performed for the enemy attacker.
        setRateGateRng(() => 0.9);
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('ability-performed', (e) => events.push(e as CombatEvent));
        const teamVictim0 = (
            id: string,
            position: Position,
            affinity: AffinityName
        ): NonNullable<CombatEngineInput['teamActors']>[number] => ({
            id,
            speed: 90,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            position,
            affinity,
            walk: {
                shipSkills: { slots: [] },
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
        });
        runCombat({
            // Focus player fires an all-pattern AoE so a normal round schedules (the enemy
            // acts via its speed). The focus has crit 0 so it does not emit its own crit signal
            // (and attack 0 so no damage, keeping the enemy alive for its own turn).
            attack: 0,
            crit: 0,
            critDamage: 100,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [basicAttack()] },
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
            mode: 'healing',
            position: 'M4',
            target: parsedTarget('front'),
            pattern: allPattern(),
            teamActors: [
                teamVictim0('team-a', 'M3', 'antimatter'),
                teamVictim0('team-b', 'M2', 'antimatter'),
            ],
            enemyAttackers: [
                {
                    id: 'enemy-zero',
                    stats: {
                        attack: 0, // 0 damage → positional apply skipped → 0-damage fallback branch
                        crit: 100,
                        critDamage: 100,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 200, // acts before the player focus
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M4',
                    affinity: 'chemical',
                    target: parsedTarget('front'),
                    pattern: allPattern(),
                    shipSkills: { slots: [basicAttack()] },
                },
            ],
            bus,
        });

        const enemyPerf = events.filter(
            (e): e is Extract<CombatEvent, { type: 'ability-performed' }> =>
                e.type === 'ability-performed' && e.actorId === 'enemy-zero'
        );
        // The 0-damage fallback branch must emit exactly one ability-performed for the enemy: no
        // apply ran, so there are no sub-attacks to fan out over and the cast-wide anchor payload
        // is emitted once (unchanged by PR2).
        expect(enemyPerf.length).toBe(1);
    });

    it('SYMMETRY: an ENEMY-side AoE that crits all 3 player victims emits critHits=3 (not anchor-only 1)', () => {
        ttIdc = 0;
        // A positioned ENEMY (crit 100) fires a whole-team AoE at the PLAYER roster (3 victims).
        // With every victim critting, the enemy's ability-performed reports critPairs = 3 — proving
        // the per-victim crit AGGREGATE is emitted TEAM-SYMMETRICALLY (an enemy attacker's signal is
        // built from its per-victim apply exactly like a player's). Pre-Task-5 this was the anchor-
        // only binary (critHits ≤ 1), so 3 here is the load-bearing assertion. (Per-victim affinity
        // GATING is exercised by the player-side tests above; enemy-attacker affinity resolution is
        // out of Task 5's scope — this test locks the aggregation/emission symmetry.)
        // The focus player fires a whole-team AoE so a normal round schedules; the enemy (speed 200)
        // acts first and its per-victim crit signal is what we assert.
        setRateGateRng(() => 0.9);
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('ability-performed', (e) => events.push(e as CombatEvent));
        const teamVictim = (
            id: string,
            position: Position,
            affinity: AffinityName
        ): NonNullable<CombatEngineInput['teamActors']>[number] => ({
            id,
            speed: 90,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            position,
            affinity,
            walk: {
                shipSkills: { slots: [] },
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
        });
        runCombat({
            // Focus player at M4 (the enemy AoE's anchor): antimatter → neutral vs chemical.
            // It fires a whole-team AoE at the enemy (damage 5000) so a normal round schedules.
            attack: 5000,
            crit: 0,
            critDamage: 100,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [basicAttack()] },
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
            mode: 'healing',
            position: 'M4',
            target: parsedTarget('front'),
            pattern: allPattern(),
            teamActors: [
                teamVictim('team-a', 'M3', 'antimatter'),
                teamVictim('team-b', 'M2', 'antimatter'),
            ],
            enemyAttackers: [
                {
                    id: 'enemy-aoe',
                    stats: {
                        attack: 5000,
                        crit: 100,
                        critDamage: 100,
                        defence: 0,
                        hp: 1_000_000_000,
                        speed: 200,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M4',
                    affinity: 'chemical',
                    target: parsedTarget('front'),
                    pattern: allPattern(),
                    shipSkills: { slots: [basicAttack()] },
                },
            ],
            bus,
        });

        const enemyPerf = events.find(
            (e): e is Extract<CombatEvent, { type: 'ability-performed' }> =>
                e.type === 'ability-performed' && e.actorId === 'enemy-aoe'
        )!;
        expect(enemyPerf).toBeDefined();
        expect(enemyPerf.didCrit).toBe(true); // anyCrit
        expect(enemyPerf.critHits).toBe(3); // critPairs across all 3 player victims (not anchor-only 1)
    });
});
