/**
 * perVictimAttacked.integration.test.ts — PR7 Task 2: per-victim `attacked` emission at the
 * FOCUS player→enemy positional site.
 *
 * BEFORE this task the player→enemy positional firing emitted ONE `attacked` event for the
 * PRIMARY anchor victim only (focusEnemyHit / tgt.id). Covered footprint victims took damage
 * silently — their on-attacked reactives never woke, and no `attacked` event ever named them.
 *
 * This task replaces the focus-only accumulation with a per-EVERY-victim signal map and emits one
 * `attacked` per victim via `emitPerVictimAttacked` (isPrimaryTarget only on the anchor). So a
 * COVERED enemy now receives an `attacked` event (it did not before).
 *
 * Harness mirrors enemySideAttacked.integration.test.ts / perVictimLeech.test.ts: a player FOCUS
 * attacker positioned at M4 firing `front` with an AoE Line-Range-1 pattern (so the footprint
 * expands), anchoring the front enemy (M4) and covering the enemy behind it (M3). We capture the
 * `attacked` events off the bus and assert the covered enemy id appears (it did NOT before), the
 * anchor carries isPrimaryTarget:true, and the covered one does not. A single-target (base)
 * pattern is the non-vacuous control: the covered enemy then gets NO `attacked` event.
 *
 * Crit 0 keeps everything deterministic.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatStatBlock } from '../../../types/calculator';

type AttackedEvent = Extract<CombatEvent, { type: 'attacked' }>;

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// AoE pattern: origin + one covered cell one step toward back (Pattern-Line-Range-1). Anchored at
// the FRONT enemy (M4) it covers the cell behind (M3) — both are HIT by the firing damage.
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

// Origin-only (single-target) footprint — the non-vacuous control: only the anchor is hit.
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// A no-passive single-hit basic-attack active slot (multiplier 100% = 1x, 1 hit).
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'pva-basic',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100 },
        },
    ],
});

// A positioned, finite-HP enemy with zero offense (a stationary, damageable target). Huge HP so
// the firing hit never kills it (kept alive → it can be resolved as a victim).
const enemyAt = (id: string, position: Position): EnemyAttacker =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots: [] } as ShipSkills,
    }) as EnemyAttacker;

/**
 * A positional battle where the PLAYER FOCUS ('attacker') fires at the enemy roster. Focus at M4,
 * fires `front` with the supplied pattern + a 100% damage active. Two enemies: the anchor at M4
 * (front) and a covered enemy at M3 (one step behind — inside the Line-Range-1 footprint).
 */
const BASE = (pattern: ParsedPattern): CombatEngineInput => ({
    attack: 5_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttack()] },
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
    defence: 0,
    hp: 1_000_000_000,
    speed: 200,
    healTargetId: 'attacker',
    position: 'M4',
    target: parsedTarget('front'),
    pattern,
    enemyAttackers: [enemyAt('enemy-anchor', 'M4'), enemyAt('enemy-covered', 'M3')],
});

/** Run a battle capturing every `attacked` event off the bus. */
const collectAttacked = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const attacked: Extract<CombatEvent, { type: 'attacked' }>[] = [];
    bus.on('attacked', (e) => attacked.push(e));
    const result = runCombat({ ...input, bus });
    return { result, attacked };
};

describe('PR7 Task 2 — per-victim attacked at the focus player→enemy site', () => {
    it('a COVERED enemy now receives an attacked event (it did not before)', () => {
        const { attacked } = collectAttacked(BASE(lineRange1Pattern()));
        const anchorEvents = attacked.filter((e) => e.targetId === 'enemy-anchor');
        const coveredEvents = attacked.filter((e) => e.targetId === 'enemy-covered');
        // The fix: the covered footprint victim now appears as an attacked target.
        expect(coveredEvents.length).toBeGreaterThan(0);
        // The anchor still gets its event too.
        expect(anchorEvents.length).toBeGreaterThan(0);
    });

    it('only the ANCHOR carries isPrimaryTarget; the covered victim does not', () => {
        const { attacked } = collectAttacked(BASE(lineRange1Pattern()));
        const anchorEvents = attacked.filter((e) => e.targetId === 'enemy-anchor');
        const coveredEvents = attacked.filter((e) => e.targetId === 'enemy-covered');
        expect(anchorEvents.length).toBeGreaterThan(0);
        expect(coveredEvents.length).toBeGreaterThan(0);
        for (const e of anchorEvents) expect(e.isPrimaryTarget).toBe(true);
        for (const e of coveredEvents) expect(e.isPrimaryTarget).not.toBe(true);
    });

    it('NON-VACUOUS control: a single-target (base) pattern emits NO attacked for the covered enemy', () => {
        const { attacked } = collectAttacked(BASE(basePattern()));
        // The anchor (primary target) still gets its event.
        expect(attacked.filter((e) => e.targetId === 'enemy-anchor').length).toBeGreaterThan(0);
        // The covered enemy is outside a single-target footprint → never attacked.
        expect(attacked.filter((e) => e.targetId === 'enemy-covered').length).toBe(0);
    });
});

// ---------------------------------------------------------------------------------------------
// PR7 Task 3 — the WALKED-TEAM player→enemy site (identical transformation applied at the second
// player→enemy positional cast-site, where the acting attacker is a non-focus team actor walked
// onto the board). The focus player ('attacker') is parked OUT of the footprint (M1, zero offense,
// empty slot) so the ONLY damage source is the walked-team ally. Mirror of the focus tests above.
// ---------------------------------------------------------------------------------------------

const teamStats = (): CombatStatBlock => ({
    attack: 5_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    defence: 0,
    hp: 1_000_000_000,
    hacking: 0,
});

// The acting WALKED-TEAM ally: positioned at M4, fires `front` with the supplied pattern + a 100%
// damage active. Anchors the front enemy (M4), covering the enemy at M3 under a Line-Range-1 pattern.
const teamAttacker = (pattern: ParsedPattern): TeamActorEngineInput =>
    ({
        id: 'team-attacker',
        speed: 100,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position: 'M4',
        target: parsedTarget('front'),
        pattern,
        walk: {
            shipSkills: { slots: [basicAttack()] },
            stats: teamStats(),
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
            healModifier: 0,
        },
    }) as TeamActorEngineInput;

// The focus player ('attacker') is zero-offense, empty slot, parked at M1 (out of the footprint) so
// only the walked-team ally deals damage. Two enemies: the anchor at M4 and a covered enemy at M3.
const TEAM_BASE = (pattern: ParsedPattern): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
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
    defence: 0,
    hp: 1_000_000_000,
    healTargetId: 'attacker',
    position: 'M1',
    target: parsedTarget('front'),
    pattern: basePattern(),
    teamActors: [teamAttacker(pattern)],
    enemyAttackers: [enemyAt('enemy-anchor', 'M4'), enemyAt('enemy-covered', 'M3')],
});

describe('PR7 Task 3 — per-victim attacked at the WALKED-TEAM player→enemy site', () => {
    it('a COVERED enemy receives an attacked event NAMING the walked-team actor (it did not before)', () => {
        const { attacked } = collectAttacked(TEAM_BASE(lineRange1Pattern()));
        const coveredEvents = attacked.filter((e) => e.targetId === 'enemy-covered');
        const anchorEvents = attacked.filter((e) => e.targetId === 'enemy-anchor');
        // The fix: the covered footprint victim now appears, attributed to the walked-team actor.
        expect(coveredEvents.length).toBeGreaterThan(0);
        for (const e of coveredEvents) expect(e.attackerId).toBe('team-attacker');
        // The anchor still gets its event too, also attributed to the walked-team actor.
        expect(anchorEvents.length).toBeGreaterThan(0);
        for (const e of anchorEvents) expect(e.attackerId).toBe('team-attacker');
    });

    it('only the ANCHOR carries isPrimaryTarget; the covered victim does not', () => {
        const { attacked } = collectAttacked(TEAM_BASE(lineRange1Pattern()));
        const anchorEvents = attacked.filter((e) => e.targetId === 'enemy-anchor');
        const coveredEvents = attacked.filter((e) => e.targetId === 'enemy-covered');
        expect(anchorEvents.length).toBeGreaterThan(0);
        expect(coveredEvents.length).toBeGreaterThan(0);
        for (const e of anchorEvents) expect(e.isPrimaryTarget).toBe(true);
        for (const e of coveredEvents) expect(e.isPrimaryTarget).not.toBe(true);
    });

    it('NON-VACUOUS control: a single-target (base) pattern emits NO attacked for the covered enemy', () => {
        const { attacked } = collectAttacked(TEAM_BASE(basePattern()));
        // The anchor (primary target) still gets its event from the walked-team actor.
        const anchorEvents = attacked.filter((e) => e.targetId === 'enemy-anchor');
        expect(anchorEvents.length).toBeGreaterThan(0);
        for (const e of anchorEvents) expect(e.attackerId).toBe('team-attacker');
        // The covered enemy is outside a single-target footprint → never attacked.
        expect(attacked.filter((e) => e.targetId === 'enemy-covered').length).toBe(0);
    });
});

// ---------------------------------------------------------------------------------------------
// PR7 Task 4 — the ENEMY→player site. The same per-victim transformation applied at the enemy
// positional cast-site, where a positioned ENEMY AoE attacker fires at the player roster. BEFORE
// this task the enemy positional firing emitted ONE `attacked` event for the FOCUS player victim
// only (positionalShield*/tgt.id capture). Covered player footprint victims took damage silently
// → their on-attacked reactives never woke, and no `attacked` event ever named them.
//
// This task accumulates a per-EVERY-victim signal map inside the enemy positional onVictimResolved
// hook and emits one `attacked` per victim via `emitPerVictimAttacked` (isPrimaryTarget only on the
// anchor) — positional-aware, so the NON-positional path keeps its legacy single emit byte-for-byte.
//
// Harness mirrors perVictimEnemyDetonation.integration.test.ts: the focus player ('attacker') is
// parked OUT of the footprint (M1, zero offense, empty slot) so the ONLY damage source is the enemy
// attacker; two player team victims occupy M4 (anchor) and M3 (covered, inside Line-Range-1).
// ---------------------------------------------------------------------------------------------

const victimStats = (hp: number): CombatStatBlock => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    defence: 0,
    hp,
    hacking: 0,
});

// A positioned, zero-offense PLAYER team victim (walked so it has real stats/position). Empty active
// slot → it deals nothing; it is purely a damageable target.
const playerVictim = (id: string, position: Position, hp: number): TeamActorEngineInput =>
    ({
        id,
        speed: 1,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        walk: {
            shipSkills: { slots: [] } as ShipSkills,
            stats: victimStats(hp),
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
            healModifier: 0,
        },
    }) as TeamActorEngineInput;

// A positioned ENEMY attacker that fires `front` with the supplied pattern + a 100% damage active.
// attack kept small so the firing hit marks the high-HP victims without killing them.
const enemyAttackerAt = (id: string, position: Position, pattern: ParsedPattern): EnemyAttacker =>
    ({
        id,
        stats: { attack: 5_000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 100 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern,
        shipSkills: { slots: [basicAttack()] },
    }) as EnemyAttacker;

// A positional battle where a POSITIONED ENEMY ('enemy-aoe') fires at the player roster. The focus
// player ('attacker') is parked OUT of the footprint (M1, zero offense, empty slot) so the only
// damage source is the enemy. Two player victims: anchor at M4 (front) + covered at M3.
const ENEMY_BASE = (pattern: ParsedPattern): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
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
    defence: 0,
    hp: 1_000_000_000,
    healTargetId: 'attacker',
    position: 'M1',
    target: parsedTarget('front'),
    pattern: basePattern(),
    teamActors: [
        playerVictim('pl-front', 'M4', 1_000_000_000),
        playerVictim('pl-mid', 'M3', 1_000_000_000),
    ],
    enemyAttackers: [enemyAttackerAt('enemy-aoe', 'M4', pattern)],
});

describe('PR7 Task 4 — per-victim attacked at the ENEMY→player site', () => {
    it('a COVERED player now receives an attacked event NAMING the enemy actor (it did not before)', () => {
        const { attacked } = collectAttacked(ENEMY_BASE(lineRange1Pattern()));
        const anchorEvents = attacked.filter((e) => e.targetId === 'pl-front');
        const coveredEvents = attacked.filter((e) => e.targetId === 'pl-mid');
        // The fix: the covered footprint victim now appears as an attacked target.
        expect(coveredEvents.length).toBeGreaterThan(0);
        // The anchor still gets its event too.
        expect(anchorEvents.length).toBeGreaterThan(0);
        // Both are attributed to the enemy attacker.
        for (const e of [...anchorEvents, ...coveredEvents]) expect(e.attackerId).toBe('enemy-aoe');
    });

    it('only the ANCHOR carries isPrimaryTarget; the covered victim does not', () => {
        const { attacked } = collectAttacked(ENEMY_BASE(lineRange1Pattern()));
        const anchorEvents = attacked.filter((e) => e.targetId === 'pl-front');
        const coveredEvents = attacked.filter((e) => e.targetId === 'pl-mid');
        expect(anchorEvents.length).toBeGreaterThan(0);
        expect(coveredEvents.length).toBeGreaterThan(0);
        for (const e of anchorEvents) expect(e.isPrimaryTarget).toBe(true);
        for (const e of coveredEvents) expect(e.isPrimaryTarget).not.toBe(true);
    });

    it('NON-VACUOUS control: a single-target (base) pattern emits NO attacked for the covered player', () => {
        const { attacked } = collectAttacked(ENEMY_BASE(basePattern()));
        // The anchor (primary target) still gets its event from the enemy attacker.
        const anchorEvents = attacked.filter((e) => e.targetId === 'pl-front');
        expect(anchorEvents.length).toBeGreaterThan(0);
        for (const e of anchorEvents) expect(e.attackerId).toBe('enemy-aoe');
        // The covered player is outside a single-target footprint → never attacked.
        expect(attacked.filter((e) => e.targetId === 'pl-mid').length).toBe(0);
    });
});

// ---------------------------------------------------------------------------------------------
// PR7 Task 4 — E5-SYMMETRY pin. The defining team-symmetry assertion: the SAME AoE attacker, with
// the SAME footprint geometry (Line-Range-1 at M4 anchoring the front victim + covering M3), must
// emit BYTE-IDENTICAL per-victim `attacked` events whether it acts on the PLAYER side (focus
// attacker → enemy victims) or the ENEMY side (enemy attacker → player victims). Same number of
// events, same per-victim damage / crit / shieldWasHit / isPrimaryTarget signals — modulo the
// attacker/target ids being the mirrored ones. A ship behaves identically on either side.
// ---------------------------------------------------------------------------------------------

describe('PR7 Task 4 — ENEMY→player per-victim attacked is E5-symmetric with the player→enemy site', () => {
    it('the SAME AoE footprint emits byte-identical per-victim attacked events on either side', () => {
        // PLAYER side (focus attacker fires at two enemy victims, anchor=enemy-anchor / covered=enemy-covered).
        const { attacked: playerAttacked } = collectAttacked(BASE(lineRange1Pattern()));
        // ENEMY side (enemy attacker fires at two player victims, anchor=pl-front / covered=pl-mid).
        const { attacked: enemyAttacked } = collectAttacked(ENEMY_BASE(lineRange1Pattern()));

        // Group each side's events by the victim ROLE (anchor vs covered) so we compare like-for-like
        // regardless of Map-insertion order. Each role-bucket carries the per-event signals stripped
        // of the (mirrored) attacker/target ids.
        type Sig = {
            isPrimaryTarget: boolean;
            damage: number | undefined;
            shieldWasHit: boolean | undefined;
            didCrit: boolean | undefined;
        };
        const sigOf = (e: AttackedEvent): Sig => ({
            isPrimaryTarget: e.isPrimaryTarget === true,
            damage: e.damage,
            shieldWasHit: e.shieldWasHit,
            didCrit: e.didCrit,
        });
        const sortSig = (a: Sig, b: Sig) => (a.damage ?? 0) - (b.damage ?? 0);
        const bucket = (
            events: AttackedEvent[],
            anchorId: string,
            coveredId: string
        ): { anchor: Sig[]; covered: Sig[] } => ({
            anchor: events
                .filter((e) => e.targetId === anchorId)
                .map(sigOf)
                .sort(sortSig),
            covered: events
                .filter((e) => e.targetId === coveredId)
                .map(sigOf)
                .sort(sortSig),
        });

        const playerBuckets = bucket(playerAttacked, 'enemy-anchor', 'enemy-covered');
        const enemyBuckets = bucket(enemyAttacked, 'pl-front', 'pl-mid');

        // Non-vacuous: both sides actually produced per-victim events for BOTH roles.
        expect(playerBuckets.anchor.length).toBeGreaterThan(0);
        expect(playerBuckets.covered.length).toBeGreaterThan(0);

        // Byte-identical signals, per role, across the side flip.
        expect(enemyBuckets.anchor).toEqual(playerBuckets.anchor);
        expect(enemyBuckets.covered).toEqual(playerBuckets.covered);

        // And the total event counts match (no extra/missing events on either side).
        expect(enemyAttacked.length).toBe(playerAttacked.length);
    });
});

// ---------------------------------------------------------------------------------------------
// PR7 CodeRabbit fix — per-victim hitOutcomes. emitPerVictimAttacked previously replayed the
// attack-wide hitOutcomes for EVERY victim. But a victim killed on an earlier hit drops out of
// later hits (positionalApply re-resolves the LIVE roster each hit), so a victim hit fewer times
// than the attack's hit count was OVER-emitted `attacked` (over-firing its on-hit reactives).
// The fix tracks each victim's OWN hitOutcomes. This integration test exercises a multi-hit AoE
// where a COVERED victim dies on hit 1 → it emits exactly ONE `attacked`, while the surviving
// anchor emits one per hit.
// ---------------------------------------------------------------------------------------------

// A 3-hit basic-attack active slot (multiplier 100% = 1x, 3 hits).
const multiHitAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'pva-multi',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100, hits: 3 },
        },
    ],
});

// A 3-hit enemy AoE attacker. attack high enough that one hit overkills the (low-HP) covered
// victim while the (huge-HP) anchor survives all three.
const multiHitEnemyAt = (id: string, position: Position, pattern: ParsedPattern): EnemyAttacker =>
    ({
        id,
        stats: {
            attack: 100_000,
            crit: 0,
            critDamage: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed: 100,
        },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern,
        shipSkills: { slots: [multiHitAttack()] },
    }) as EnemyAttacker;

describe('PR7 CodeRabbit fix — per-victim hitOutcomes (drop-out victim under-emits)', () => {
    it('a covered victim killed on hit 1 emits exactly ONE attacked; the surviving anchor emits one per hit', () => {
        const input: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [] },
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
            defence: 0,
            hp: 1_000_000_000,
            healTargetId: 'attacker',
            position: 'M1',
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [
                // Anchor (M4): huge HP → survives all 3 hits → 3 attacked events.
                playerVictim('pl-front', 'M4', 1_000_000_000),
                // Covered (M3): tiny HP → dies on hit 1 → 1 attacked event (NOT 3).
                playerVictim('pl-mid', 'M3', 1_000),
            ],
            enemyAttackers: [multiHitEnemyAt('enemy-aoe', 'M4', lineRange1Pattern())],
        };
        const { attacked } = collectAttacked(input);
        const anchorEvents = attacked.filter((e) => e.targetId === 'pl-front');
        const coveredEvents = attacked.filter((e) => e.targetId === 'pl-mid');
        // The anchor survives all hits → one event per hit (3).
        expect(anchorEvents.length).toBe(3);
        // The drop-out victim is hit only once before dying → exactly one event (the fix; pre-fix = 3).
        expect(coveredEvents.length).toBe(1);
    });
});
