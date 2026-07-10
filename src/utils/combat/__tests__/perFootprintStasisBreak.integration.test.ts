/**
 * perFootprintStasisBreak.integration.test.ts — PR7 Task 5: per-footprint Stasis-break.
 *
 * BEFORE this task an on-hit Stasis-break fired ONLY for the PRIMARY anchor victim (tgt.id) of a
 * positional/AoE cast. Covered footprint victims that were ALSO stasised stayed locked — they took
 * the firing damage but their Stasis was never broken, so they kept skipping turns.
 *
 * This task adds a covered-victim Stasis-break at all THREE positional cast-sites (focus,
 * walked-team, enemy). For every hit footprint victim that was stasised at hit time (and only when
 * the attacker does NOT have doesntBreakStasis), a DEFERRED break is recorded via stasisBreakPending
 * — the same deferral the anchor uses — so the victim's own skip branch reduces the Stasis and it
 * eventually resumes acting. Covered victims have NO same-turn re-apply vector (the turn's debuffs
 * only ever target the anchor), so their break fires UNCONDITIONALLY (no re-apply guard).
 *
 * Harness mirrors perVictimAttacked.integration.test.ts (positioned actors, Line-Range-1 AoE) +
 * stasis.test.ts (Stasis applied once by fast stasis-bots that are then killed; break observed via
 * the victim acting again — emitting ability-performed — on a round it would otherwise still skip).
 *
 * OBSERVATION MODEL. A stasised actor skips its turn (no ability-performed). We seed Stasis(4) on
 * two victims in round 1 via two fast stasis-bots, then kill those bots that same round (a culler)
 * so the Stasis is NEVER re-applied. A direct hit REDUCES Stasis by one turn (not a full removal),
 * so a victim HIT every round loses 2 turns/round (deferred break −1 + natural Post-Turn −1) and
 * clears by the end of round 2 → acts from round 3; a victim NOT hit loses only −1/round and still
 * has Stasis left at the end of the 4-round run → never acts. A player/enemy AoE breaker (WITHOUT
 * doesntBreakStasis) hits BOTH the anchor and the covered victim every round. The anchor break
 * already worked (it acts from round 3). The NEW behaviour: the COVERED victim also breaks and acts
 * (FAILS pre-change — it never acted).
 *
 * GRID. Positions are the T/M/B × col-1..4 board. Targeting scans by ROW (the acting actor's row
 * first, then descend, wrapping bottom→top), then column within the first occupied row. We isolate
 * roles by row/column so single-target front/back and the AoE anchor land deterministically:
 *   - The two VICTIMS occupy the OPPOSING M-row (front col M4 + one behind M3) so the AoE
 *     Line-Range-1 anchored on the front victim covers the one behind it.
 *   - The BREAKER sits in its OWN M-row but at the REAR column (M1) so its row-scan reaches the
 *     opposing M-row FIRST (it anchors the opposing front victim) — yet the culler's `front` AoE,
 *     which anchors the firing side's front M-column, never reaches the rear-column breaker.
 *   - The two STASIS-BOTS sit in the firing side's M-row front columns (M4/M3) and target the
 *     opposing M-row (front / back) — landing Stasis on anchor + covered. They are killed by the
 *     culler in round 1 so Stasis is applied exactly once.
 *   - The CULLER sits in the T-row of the OPPOSING side; its row-scan reaches the firing side's
 *     M-row (the two stasis-bots at M4/M3) and AoE-kills both in round 1. It is never picked by the
 *     bots' front/back (different row) so `back` lands on the covered victim, not the culler.
 *   - The focus/heal-target sits in the B-row, out of every selection path.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type Selection = ParsedTarget['selection'];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `pfs${++idc}`,
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

// AoE pattern: origin + one covered cell one step toward back. Anchored on the front victim it
// covers the cell behind it — both are HIT by the firing damage.
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

// A single-hit 100% damage active (no status).
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

// A combined damage + Stasis-inflict active (hacking:200 vs security:0 → always lands).
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

const collectAbilityPerformed = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const performed: Extract<CombatEvent, { type: 'ability-performed' }>[] = [];
    bus.on('ability-performed', (e) => performed.push(e));
    const result = runCombat({ ...input, bus });
    return { result, performed };
};

const firedRounds = (
    performed: Extract<CombatEvent, { type: 'ability-performed' }>[],
    actorId: string
): number[] => performed.filter((e) => e.actorId === actorId).map((e) => e.round);

// Stasis(4) + numRounds:4 is the reduce-by-one observation window. A footprint victim HIT every
// round loses 2 turns/round (the deferred break's −1 plus the natural Post-Turn −1), so it clears
// by the end of round 2 and acts from round 3. A victim NOT hit loses only the natural −1/round, so
// Stasis(4) still has 1 turn left at the end of round 4 → it never acts inside the run. That gap is
// what distinguishes a footprint-covered (hit) victim from an uncovered (unhit) one.
const STASIS_LONG = 4;
const ROUNDS = 4;

// ---------------------------------------------------------------------------------------------
// (1) PLAYER → ENEMY footprint break  (focus site).
// ---------------------------------------------------------------------------------------------
//
// Enemy victims in the M-row: anchor at M4 (front), covered at M3 (one behind, inside Line-Range-1).
// Two PLAYER stasis-bots (player M-row front cols) seed Stasis(20) on the two enemies in round 1,
// then an enemy culler (enemy T-row) AoE-kills both bots → Stasis is applied exactly once. The focus
// breaker sits at the player M-row REAR column (M1) so its row-scan reaches the enemy M-row first
// (anchoring enemy front M4, covering M3) while the culler's front-anchored AoE never reaches it.
// WITHOUT doesntBreakStasis it hits BOTH enemies every round and breaks them.

// A PLAYER stasis-bot (team actor): fast, hp 1 (culler one-shots it), hacking 200.
const playerStasisBot = (id: string, position: Position, sel: Selection): TeamActorEngineInput =>
    ({
        id,
        speed: 1000,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parsedTarget(sel),
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
    }) as TeamActorEngineInput;

// A high-HP enemy victim with a basicAttack so it CAN emit ability-performed once freed.
const enemyVictim = (id: string, position: Position): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 1,
            security: 0,
            hacking: 0,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [basicAttack()] },
    }) as EnemyAttacker;

// An enemy culler (T-row): scans the player M-row first, AoE-kills both player stasis-bots in round 1.
// Speed 500 — acts AFTER the bots (so Stasis lands) but before the breaker.
const enemyCuller = (): EnemyAttacker =>
    ({
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
    }) as EnemyAttacker;

const PLAYER_BASE = (pattern: ParsedPattern, doesntBreakStasis: boolean): CombatEngineInput => ({
    attack: 5_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttack()] },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
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
    doesntBreakStasis,
    healTargetId: 'attacker',
    // Breaker (focus) sits at the player M-row REAR column (M1) so its row-scan reaches the enemy
    // M-row FIRST (anchoring enemy front M4, covering M3) while the culler's front-anchored AoE never
    // reaches it. Fires `front` with the supplied pattern → anchor M4, covered M3.
    position: 'M1',
    speed: 100,
    target: parsedTarget('front'),
    pattern,
    teamActors: [playerStasisBot('pbot-f', 'M4', 'front'), playerStasisBot('pbot-b', 'M3', 'back')],
    enemyAttackers: [
        enemyVictim('enemy-anchor', 'M4'),
        enemyVictim('enemy-covered', 'M3'),
        enemyCuller(),
    ],
});

describe('PR7 Task 5 — per-footprint Stasis-break: player → enemy (focus site)', () => {
    it('an AoE hit breaks Stasis on BOTH the anchor AND the covered enemy (covered fails pre-change)', () => {
        const { performed } = collectAbilityPerformed(PLAYER_BASE(lineRange1Pattern(), false));

        const anchorFired = firedRounds(performed, 'enemy-anchor');
        const coveredFired = firedRounds(performed, 'enemy-covered');

        // The anchor breaks and acts (the pre-existing behaviour). Stasis(20) ≫ 4 rounds → it could
        // only have acted because its Stasis was broken.
        expect(anchorFired.length).toBeGreaterThan(0);
        // The covered enemy ALSO breaks and acts — the NEW behaviour (FAILS pre-change: covered never
        // acted because only the anchor's Stasis was ever broken).
        expect(coveredFired.length).toBeGreaterThan(0);
    });

    it('NON-VACUOUS control: a single-target (base) pattern breaks the anchor only, never the covered enemy', () => {
        const { performed } = collectAbilityPerformed(PLAYER_BASE(basePattern(), false));

        // A base footprint hits only the anchor → only the anchor breaks. The covered enemy is never
        // hit → its Stasis(20) is never broken → it never acts. Proves the rounds-1 covered break is
        // genuinely footprint-driven, not a never-stasised victim.
        expect(firedRounds(performed, 'enemy-anchor').length).toBeGreaterThan(0);
        expect(firedRounds(performed, 'enemy-covered')).toHaveLength(0);
    });
});

describe('PR7 Task 5 — per-footprint Stasis-break: doesntBreakStasis control', () => {
    it('an attacker WITH doesntBreakStasis breaks NEITHER the anchor NOR the covered enemy', () => {
        const { performed } = collectAbilityPerformed(PLAYER_BASE(lineRange1Pattern(), true));

        // doesntBreakStasis → no break at all (anchor or covered) → both stay locked under Stasis(20).
        expect(firedRounds(performed, 'enemy-anchor')).toHaveLength(0);
        expect(firedRounds(performed, 'enemy-covered')).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------------------------
// (3) ENEMY → PLAYER footprint break  (enemy site, symmetry).
// ---------------------------------------------------------------------------------------------
//
// Mirror of (1) with the sides flipped. Player victims in the M-row (anchor M4, covered M3). Two
// ENEMY stasis-bots (M-row) seed Stasis(20) on the two players in round 1; a player culler (T-row)
// kills both enemy bots that round → Stasis applied once. An enemy AoE breaker (B-row, WITHOUT
// doesntBreakStasis) fires `front` Line-Range-1 → hits both players every round and breaks them.

const playerVictim = (id: string, position: Position): TeamActorEngineInput =>
    ({
        id,
        speed: 1,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        walk: {
            shipSkills: { slots: [basicAttack()] },
            stats: {
                attack: 1,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: 1_000_000_000,
                security: 0,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
            healModifier: 0,
        },
    }) as TeamActorEngineInput;

// A player culler (team actor, T-row): scans the enemy M-row first, AoE-kills both enemy stasis-bots
// in round 1. Speed 500 — after the bots, before the breaker.
const playerCuller = (): TeamActorEngineInput =>
    ({
        id: 'culler',
        speed: 500,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position: 'T1',
        target: parsedTarget('front'),
        pattern: lineRange1Pattern(),
        walk: {
            shipSkills: { slots: [basicAttack()] },
            stats: {
                attack: 1_000_000,
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
            healModifier: 0,
        },
    }) as TeamActorEngineInput;

// An enemy stasis-bot (M-row): fast, hp 1 (culler one-shots it), hacking 200, targets the player M-row.
const enemyStasisBot = (id: string, position: Position, sel: Selection): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 1,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1,
            speed: 1000,
            security: 0,
            hacking: 200,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget(sel),
        pattern: basePattern(),
        shipSkills: { slots: [stasisInflictAttack(STASIS_LONG)] },
    }) as EnemyAttacker;

// The enemy AoE breaker: sits at the enemy M-row REAR column (M1) so its row-scan reaches the player
// M-row first (anchor M4, covered M3) while the culler's front-anchored AoE never reaches it.
const enemyBreaker = (pattern: ParsedPattern): EnemyAttacker =>
    ({
        id: 'enemy-breaker',
        stats: {
            attack: 5_000,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 100,
            security: 0,
            hacking: 0,
        },
        chargeCount: 0,
        startCharged: false,
        position: 'M1',
        target: parsedTarget('front'),
        pattern,
        shipSkills: { slots: [basicAttack()] },
    }) as EnemyAttacker;

const ENEMY_BASE = (pattern: ParsedPattern): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
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
    // Focus is parked far back as the heal target only (B-row, no offense).
    speed: 1,
    healTargetId: 'attacker',
    position: 'B1',
    target: parsedTarget('front'),
    pattern: basePattern(),
    teamActors: [playerVictim('pl-anchor', 'M4'), playerVictim('pl-covered', 'M3'), playerCuller()],
    enemyAttackers: [
        enemyStasisBot('ebot-f', 'M4', 'front'),
        enemyStasisBot('ebot-b', 'M3', 'back'),
        enemyBreaker(pattern),
    ],
});

describe('PR7 Task 5 — per-footprint Stasis-break: enemy → player (symmetry)', () => {
    it('an enemy AoE hit breaks Stasis on BOTH stasised player victims (covered fails pre-change)', () => {
        const { performed } = collectAbilityPerformed(ENEMY_BASE(lineRange1Pattern()));

        const anchorFired = firedRounds(performed, 'pl-anchor');
        const coveredFired = firedRounds(performed, 'pl-covered');

        // The anchor breaks and acts (pre-existing). The covered player ALSO breaks (NEW; FAILS
        // pre-change). Team-symmetric with the player→enemy case.
        expect(anchorFired.length).toBeGreaterThan(0);
        expect(coveredFired.length).toBeGreaterThan(0);
    });

    it('NON-VACUOUS control: a single-target (base) pattern breaks the anchor only, never the covered player', () => {
        const { performed } = collectAbilityPerformed(ENEMY_BASE(basePattern()));
        expect(firedRounds(performed, 'pl-anchor').length).toBeGreaterThan(0);
        expect(firedRounds(performed, 'pl-covered')).toHaveLength(0);
    });
});
