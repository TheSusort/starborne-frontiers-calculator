/**
 * SP-4e Task 1 — containment for the new `'lowest-hp-ally'` target variant.
 *
 * The variant is a SINGLE-recipient selector: the living same-side ally with the lowest
 * currentHp/maxHp, caster EXCLUDED. Nothing in the parser emits it yet (Task 3 flips that), so
 * this suite is written from the DEFECT rather than from a shipped kit: every consumer that
 * merely *filters* a roster would fan a single-recipient selector out to every ally, and the
 * skill editor makes such an ability constructible today.
 *
 * Two levels are pinned:
 *   1. `resolveSupportRecipients` — the shared helper every support caller funnels through;
 *   2. the on-cast `extend-status` BUFF path in `runPlayerTurn`, the one live caller that hands
 *      the helper an unresolved whole-roster `base`.
 */
import { describe, expect, it } from 'vitest';
import { resolveSupportRecipients } from '../supportRecipients';
import { runPlayerTurn, PlayerActorRuntime } from '../playerTurn';
import { createActor, CombatActor } from '../state';
import { createStatusEngine, StatusEngine, RegisteredAbilityStatus } from '../statusEngine';
import { createEventBus, CombatEvent } from '../events';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { Ability, ShipSkills } from '../../../types/abilities';
import { AffinityName } from '../../../types/ship';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { parsePattern } from '../../targetingParser';
import type { ParsedTarget } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import { bareEnemy, bareInput, attackingEnemy } from '../__testutils__/bareRosterFixture';

describe("SP-4e 'lowest-hp-ally' containment", () => {
    // resolveSupportRecipients only FILTERS its baseRecipients — it has no live HP, so it cannot
    // resolve this selector itself. The routing rule is that each caller resolves it via
    // `lowestHpAllyRecipients` and uses that result DIRECTLY, never routing it back through
    // resolveSupportRecipients. Reaching this branch at all is therefore a caller bug, and a
    // multi-id base is the shape that used to silently fan a single-recipient target out to
    // everyone (`slice(0, 1)` used to "protect" against this by picking the first id) — pin that
    // it now throws instead. Deleting the guard would make this multi-id call fall through to the
    // generic footprint filter and silently return `['p2', 'p3']` (both ids are in the footprint),
    // so this test fails loudly (no throw) if the guard is removed.
    it('throws rather than silently clamping a multi-id unresolved base', () => {
        expect(() =>
            resolveSupportRecipients({
                target: 'lowest-hp-ally',
                casterId: 'p1',
                baseRecipients: ['p2', 'p3'],
                footprintAllyIds: ['p1', 'p2', 'p3'],
            })
        ).toThrow(/lowest-hp-ally/);
    });

    // A length-1 base is NOT a safe passthrough case either: an unresolved lone-caster roster is
    // also length 1 (`[casterId]`), so a clamp/passthrough keyed on length alone would silently
    // reproduce the self-target bug the reviewer demonstrated (caller routing reverted, lone
    // caster, `slice(0, 1)` selects the caster's own id). This must throw too.
    it('throws on a single-id base — length alone cannot prove it was pre-resolved', () => {
        expect(() =>
            resolveSupportRecipients({
                target: 'lowest-hp-ally',
                casterId: 'p1',
                baseRecipients: ['p1'],
                footprintAllyIds: ['p1', 'p2'],
            })
        ).toThrow(/lowest-hp-ally/);
    });
});

// ---------------------------------------------------------------------------
// The live fan-out caller: the on-cast `extend-status` buff branch, which passes
// `supportRecipients(ab.target, allyRoster, …)` — the whole same-side roster.
// Harness mirrors extendStatusCastPath.test.ts.
// ---------------------------------------------------------------------------
const ATTACKER_AFFINITY: AffinityName = 'thermal';

const baseStats = () => ({
    attack: 5000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    shieldPenetration: 0,
    defence: 0,
    hp: 20_000,
    speed: 100,
});

const lowestHpAllyExtendBuff = (turns = 1): Ability => ({
    id: 'lowest-hp-ally-extend',
    type: 'extend-status',
    target: 'lowest-hp-ally',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'extend-status', statusKind: 'buff', turns },
});

const passiveExtendSkills = (): ShipSkills => ({
    slots: [
        { slot: 'active', abilities: [] },
        { slot: 'passive', abilities: [lowestHpAllyExtendBuff(1)] },
    ],
});

function makeRuntime(actorId: string, skills: ShipSkills): PlayerActorRuntime {
    const actor = createActor({
        id: actorId,
        side: 'player',
        kind: 'attacker',
        stats: baseStats(),
        chargeCount: 0,
        startCharged: false,
    });

    return {
        actor,
        focus: true,
        castSkills: skills,
        reactiveAbilities: [],
        timedSelfBySlot: [],
        timedEnemyBySlot: [],
        hasChargedSkill: false,
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        defence: 0,
        hp: 20_000,
        healModifier: 0,
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        affinityDisadvantage: false,
        attackerAffinity: ATTACKER_AFFINITY,
        activeCritGate: () => false,
        chargedCritGate: () => false,
        activeHealCritGate: () => false,
        chargedHealCritGate: () => false,
        debuffLandingGate: makeRateGate(),
        extendChanceGate: makeRateGate(),
        landsTimedEnemyApplication: () => true,
        selfBuffLookup: new Map(),
        enemyDebuffLookup: new Map(),
    };
}

function makeAlly(id: string, currentHp: number): CombatActor {
    const ally = createActor({ id, side: 'player', kind: 'team', stats: baseStats() });
    ally.currentHp = currentHp;
    return ally;
}

/** Seeds a timed 'Attack Up' self-buff on `ownerId`'s selfMaps entry. */
function seedSelfBuff(statusEngine: StatusEngine, ownerId: string, duration: number): void {
    const status: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
        kind: 'timed',
        side: 'self',
        sourceSlot: 'active',
        conditions: [],
        duration,
        payload: { buffName: 'Attack Up', stacks: 1, parsedEffects: { attack: 10 } },
    };
    statusEngine.applyTimedAbilityStatus(1, status, ownerId);
}

const selfBuffTurns = (statusEngine: StatusEngine, ownerId: string): number | undefined =>
    statusEngine
        .timedAbilityStatuses('self', ownerId)
        .find((s) => s.payload.buffName === 'Attack Up')?.active.turnsRemaining as
        number | undefined;

describe("SP-4e 'lowest-hp-ally' on the on-cast buff-extend path", () => {
    it('extends ONLY the lowest-HP living ally, not the whole roster', () => {
        const runtime = makeRuntime('caster', passiveExtendSkills());
        // The caster is the most wounded actor on its side — it must still be EXCLUDED
        // ("the OTHER ally"), so the selector picks the wounded ally, not the caster.
        runtime.actor.currentHp = 1_000;
        const wounded = makeAlly('wounded', 4_000);
        const healthy = makeAlly('healthy', 20_000);
        const enemy = createActor({
            id: 'enemy1',
            side: 'enemy',
            kind: 'enemy',
            stats: { ...baseStats(), attack: 0, hp: 1_000_000 },
        });

        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        seedSelfBuff(statusEngine, runtime.actor.id, 2);
        seedSelfBuff(statusEngine, wounded.id, 2);
        seedSelfBuff(statusEngine, healthy.id, 2);

        runPlayerTurn({
            runtime,
            enemy,
            statusEngine,
            corrosionEntries: [],
            infernoEntries: [],
            genericDoTEntries: [],
            pendingBombs: [],
            pendingAccumulators: [],
            enemyDefense: 0,
            enemyHp: enemy.currentHp,
            enemyType: undefined,
            bus: createEventBus(),
            round: 1,
            targetId: enemy.id,
            sameSideLiving: [runtime.actor, wounded, healthy],
        });

        expect(selfBuffTurns(statusEngine, wounded.id)).toBe(3);
        expect(selfBuffTurns(statusEngine, healthy.id)).toBe(2);
        expect(selfBuffTurns(statusEngine, runtime.actor.id)).toBe(2);
    });

    it('extends nobody when the caster is the only living ally', () => {
        const runtime = makeRuntime('lone-caster', passiveExtendSkills());
        const enemy = createActor({
            id: 'enemy1',
            side: 'enemy',
            kind: 'enemy',
            stats: { ...baseStats(), attack: 0, hp: 1_000_000 },
        });

        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        seedSelfBuff(statusEngine, runtime.actor.id, 2);

        runPlayerTurn({
            runtime,
            enemy,
            statusEngine,
            corrosionEntries: [],
            infernoEntries: [],
            genericDoTEntries: [],
            pendingBombs: [],
            pendingAccumulators: [],
            enemyDefense: 0,
            enemyHp: enemy.currentHp,
            enemyType: undefined,
            bus: createEventBus(),
            round: 1,
            targetId: enemy.id,
            sameSideLiving: [runtime.actor],
        });

        expect(selfBuffTurns(statusEngine, runtime.actor.id)).toBe(2);
    });
});

// ---------------------------------------------------------------------------
// SP-4e Task 2 — the three live `'ally'`-resolution sites, driven through REAL engine runs.
//
// Fixture shape lifted from healingPerRecipientApply.test.ts (a direct-engine healing run with
// WALKED team allies). Every ability here is HAND-BUILT, not parsed: the parser does not emit
// 'lowest-hp-ally' until Task 3, so these suites are written from the DEFECT.
//
// Assertions are on the RECIPIENT axis (`healing.rounds[].perRecipient`) plus the recipient's own
// live `currentHp` — never a summed total, which looks plausible while per-recipient accounting is
// absent (spec §5.1 rule 5).
// ---------------------------------------------------------------------------
const FOCUS_ID = 'attacker';
const LOW_HP_ALLY_ID = 'ally-low-hp';
const HIGH_HP_ANCHOR_ID = 'ally-high-hp-is-the-heal-anchor';
const ENEMY_HEALER_ID = 'enemy-healer';
const ENEMY_LOW_HP_ID = 'enemy-low-hp';
const ENEMY_HIGH_HP_ID = 'enemy-high-hp';

const allyParsedTarget = (): ParsedTarget => ({ raw: 'allies', side: 'ally', selection: 'all' });

/** A hand-built ability, NOT a parsed one: the parser does not emit this variant until Task 3. */
const lowestHpAllyHeal = (pct: number, trigger: Ability['trigger'] = 'on-cast'): Ability => ({
    id: 'ab-lowest',
    type: 'heal',
    config: { type: 'heal', pct, basis: 'hp' },
    target: 'lowest-hp-ally',
    trigger,
    conditions: [],
});

// ⚠️ A DIRECT-ENGINE test MUST supply the `walk` bundle itself: normalizeTeamActorsToWalked
// synthesizes NEUTRAL_WALK_STATS with **hp: 1** for a team actor arriving without one, silently
// discarding a bare `stats.hp` (healingPerRecipientApply.test.ts).
const walkedAlly = (id: string, position: Position, hp: number): TeamActorEngineInput => ({
    id,
    speed: 10,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    walk: {
        shipSkills: { slots: [] },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 200,
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
});

const castSlots = (abilities: Ability[]): ShipSkills => ({
    slots: [{ slot: 'active', abilities }],
});
const passiveSlots = (abilities: Ability[]): ShipSkills => ({
    slots: [{ slot: 'passive', abilities }],
});

/** Focus healer at M1, two walked allies on-footprint, heal ANCHOR = the HIGHER-HP ally. */
const HEAL_BASE = (): CombatEngineInput => ({
    // Every run needs a real opponent. The focus has `attack: 0` and casts only heals,
    // so the inert 500k-HP default never dies and the run shape is unchanged.
    enemyAttackers: bareEnemy(),
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: castSlots([lowestHpAllyHeal(10)]),
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
    hp: 50_000,
    speed: 300,
    // The configured heal anchor is the HIGHER-HP ally, so "routed to the anchor" and "routed to
    // the lowest-HP ally" predict DIFFERENT recipients — the whole discriminating power here.
    healTargetId: HIGH_HP_ANCHOR_ID,
    mode: 'healing',
    perRecipientHealApply: true,
    position: 'M1',
    target: allyParsedTarget(),
    // Line-Support-Range-3 @ M1 covers {M1, M2, M3, M4} (resolvePattern.test.ts), so BOTH
    // allies are on-footprint and only the ROUTING rule can distinguish them.
    pattern: parsePattern('Pattern-Line-Support-Range-3'),
    teamActors: [
        walkedAlly(HIGH_HP_ANCHOR_ID, 'M2', 50_000),
        walkedAlly(LOW_HP_ALLY_ID, 'M3', 50_000),
    ],
});

/** 80% for the anchor, 30% for the other — distinct FRACTIONS, no tie, both with headroom. */
const setAllyHp = (actors: CombatActor[]): void => {
    for (const a of actors) {
        if (a.id === HIGH_HP_ANCHOR_ID) a.currentHp = 40_000;
        if (a.id === LOW_HP_ALLY_ID) a.currentHp = 15_000;
    }
};

type EnemyAttackerInput = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const enemyShip = (
    id: string,
    position: Position,
    skills: ShipSkills | undefined
): EnemyAttackerInput => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 50_000, speed: 100 },
    chargeCount: 0,
    startCharged: false,
    position,
    ...(skills ? { shipSkills: skills } : {}),
});

/** Locked symmetry rule: the ENEMY mirror of HEAL_BASE — the healer is an enemy, and the selector
 *  resolves over the ENEMY roster (the caster's OWN side). The player focus carries no support at
 *  all, so nothing on the player side can produce the observed HP movement. */
const ENEMY_HEAL_BASE = (skills: ShipSkills): CombatEngineInput => ({
    ...HEAL_BASE(),
    shipSkills: { slots: [] },
    healTargetId: FOCUS_ID,
    teamActors: [],
    enemyAttackers: [
        enemyShip(ENEMY_HEALER_ID, 'M4', skills),
        enemyShip(ENEMY_LOW_HP_ID, 'M3', undefined),
        enemyShip(ENEMY_HIGH_HP_ID, 'M2', undefined),
    ],
});

/** 30% / 80% on the enemy side, mirroring setAllyHp. */
const setEnemyAllyHp = (actors: CombatActor[]): void => {
    for (const a of actors) {
        if (a.id === ENEMY_LOW_HP_ID) a.currentHp = 15_000;
        if (a.id === ENEMY_HIGH_HP_ID) a.currentHp = 40_000;
    }
};

describe("SP-4e site A: the on-cast heal route ('recipientsFor')", () => {
    it('player caster: the 30% ally is the SOLE recipient, not the 80% anchor', () => {
        let low: CombatActor | undefined;
        let anchor: CombatActor | undefined;
        let caster: CombatActor | undefined;
        const result = runCombat({
            ...HEAL_BASE(),
            __testTapActors: (actors) => {
                setAllyHp(actors);
                low = actors.find((a) => a.id === LOW_HP_ALLY_ID);
                anchor = actors.find((a) => a.id === HIGH_HP_ANCHOR_ID);
                caster = actors.find((a) => a.id === FOCUS_ID);
            },
        });
        const round = result.healing!.rounds[0];
        // Recipient axis: exactly one landing, on the lowest-FRACTION ally.
        expect(round.perRecipient.get(LOW_HP_ALLY_ID)?.effectiveHeal ?? 0).toBeGreaterThan(0);
        expect(round.perRecipient.get(HIGH_HP_ANCHOR_ID)?.effectiveHeal ?? 0).toBe(0);
        expect(round.perRecipient.get(FOCUS_ID)?.effectiveHeal ?? 0).toBe(0);
        // …and the HP actually moved there, nowhere else. 10% of the caster's 50,000 hp basis.
        expect(low!.currentHp).toBe(20_000);
        expect(anchor!.currentHp).toBe(40_000);
        expect(caster!.currentHp).toBe(50_000);
    });

    it('ENEMY caster: the mirror resolves over the ENEMY roster (locked symmetry)', () => {
        let low: CombatActor | undefined;
        let high: CombatActor | undefined;
        let healer: CombatActor | undefined;
        runCombat({
            ...ENEMY_HEAL_BASE(castSlots([lowestHpAllyHeal(10)])),
            __testTapActors: (actors) => {
                setEnemyAllyHp(actors);
                low = actors.find((a) => a.id === ENEMY_LOW_HP_ID);
                high = actors.find((a) => a.id === ENEMY_HIGH_HP_ID);
                healer = actors.find((a) => a.id === ENEMY_HEALER_ID);
            },
        });
        expect(low!.currentHp).toBe(20_000);
        expect(high!.currentHp).toBe(40_000);
        // The caster is EXCLUDED even though it is at full HP — no self-heal, no self-overheal.
        expect(healer!.currentHp).toBe(50_000);
    });

    it('the worst-HP ally OFF the support footprint is STILL the recipient', () => {
        let low: CombatActor | undefined;
        let onFootprint: CombatActor | undefined;
        const result = runCombat({
            ...HEAL_BASE(),
            // Line-Support-Range-1 @ M3 covers exactly {M3, M4} (resolvePattern.test.ts).
            position: 'M3',
            pattern: parsePattern('Pattern-Line-Support-Range-1'),
            // The 80% ally is ON the footprint (M4); the 30% ally is OFF it (M1). A named selector
            // is NEVER narrowed by the footprint (spec §1.2), so the M1 ally still wins.
            teamActors: [
                walkedAlly(HIGH_HP_ANCHOR_ID, 'M4', 50_000),
                walkedAlly(LOW_HP_ALLY_ID, 'M1', 50_000),
            ],
            __testTapActors: (actors) => {
                setAllyHp(actors);
                low = actors.find((a) => a.id === LOW_HP_ALLY_ID);
                onFootprint = actors.find((a) => a.id === HIGH_HP_ANCHOR_ID);
            },
        });
        const round = result.healing!.rounds[0];
        expect(round.perRecipient.get(LOW_HP_ALLY_ID)?.effectiveHeal ?? 0).toBeGreaterThan(0);
        expect(low!.currentHp).toBe(20_000);
        // Anti-vacuity: the on-footprint ally is identical in every way except its cell and its HP
        // fraction, and it receives nothing — so the selector, not the footprint, chose.
        expect(onFootprint!.currentHp).toBe(40_000);
    });

    it('caster is the only living ally: NO recipient at all, and no self-heal', () => {
        let caster: CombatActor | undefined;
        const result = runCombat({
            ...HEAL_BASE(),
            healTargetId: FOCUS_ID,
            teamActors: [],
            __testTapActors: (actors) => {
                const focus = actors.find((a) => a.id === FOCUS_ID);
                // Damaged, so a self-heal WOULD be observable (anti-vacuity).
                if (focus) focus.currentHp = 25_000;
                caster = focus;
            },
        });
        // "the OTHER ally" with nobody else alive means NOBODY — never the caster.
        expect(caster!.currentHp).toBe(25_000);
        expect(result.healing!.rounds[0].perRecipient.size).toBe(0);
    });
});

describe('SP-4e site B: the reactive heal route (reactiveRecipients + the pool gate)', () => {
    it('player owner: routes to the worst-HP ally AND actually restores its HP', () => {
        let low: CombatActor | undefined;
        let anchor: CombatActor | undefined;
        const result = runCombat({
            ...HEAL_BASE(),
            // A passive-slot heal on a LIVE trigger is a reactive: it drains through
            // reactiveRecipients, not recipientsFor.
            shipSkills: passiveSlots([lowestHpAllyHeal(10, 'start-of-round')]),
            __testTapActors: (actors) => {
                setAllyHp(actors);
                low = actors.find((a) => a.id === LOW_HP_ALLY_ID);
                anchor = actors.find((a) => a.id === HIGH_HP_ANCHOR_ID);
            },
        });
        const round = result.healing!.rounds[0];
        // (1) ROUTING: the recipient is the worst-HP ally, not the heal anchor.
        expect(round.perRecipient.get(LOW_HP_ALLY_ID)?.directHeal ?? 0).toBeGreaterThan(0);
        expect(round.perRecipient.get(HIGH_HP_ANCHOR_ID)?.directHeal ?? 0).toBe(0);
        // (2) THE POOL GATE: `effectiveHeal` — not merely `directHeal` — is non-zero, i.e. the
        // ally's HP really rose. A gross-only test passes while the heal does nothing.
        expect(round.perRecipient.get(LOW_HP_ALLY_ID)?.effectiveHeal ?? 0).toBeGreaterThan(0);
        expect(low!.currentHp).toBe(20_000);
        expect(anchor!.currentHp).toBe(40_000);
    });

    it('ENEMY owner: the same reactive mirror over the ENEMY roster', () => {
        let low: CombatActor | undefined;
        let high: CombatActor | undefined;
        let healer: CombatActor | undefined;
        runCombat({
            ...ENEMY_HEAL_BASE(passiveSlots([lowestHpAllyHeal(10, 'start-of-round')])),
            __testTapActors: (actors) => {
                setEnemyAllyHp(actors);
                low = actors.find((a) => a.id === ENEMY_LOW_HP_ID);
                high = actors.find((a) => a.id === ENEMY_HIGH_HP_ID);
                healer = actors.find((a) => a.id === ENEMY_HEALER_ID);
            },
        });
        expect(low!.currentHp).toBe(20_000);
        expect(high!.currentHp).toBe(40_000);
        expect(healer!.currentHp).toBe(50_000);
    });
});

describe('SP-4e site C: the standing-leech arms (engine)', () => {
    // A passive-slot heal on `basis: 'damage-dealt'` is a STANDING LEECH (engine.ts's
    // `standingLeeches` scan), not a reactive — it procs off the owner's own damage credits.
    const leechHeal = (pct: number): Ability => ({
        id: 'ab-leech-lowest',
        type: 'heal',
        target: 'lowest-hp-ally',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'heal', pct, basis: 'damage-dealt', leechScope: 'all', noCrit: true },
    });
    const damageAb = (): Ability => ({
        id: 'ab-hit',
        type: 'damage',
        target: 'enemy',
        trigger: 'on-cast',
        conditions: [],
        config: { type: 'damage', multiplier: 100 },
    });
    const enemyTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });

    // Step 10 predicted ZERO churn for this site, and the full suite delivered it: the arm is
    // additive (every other target leaves `selectorRecipientId` undefined and takes the unchanged
    // anchor path). Zero churn is not zero coverage though — no fixture anywhere builds a
    // standing leech on this target, so without the cases below the arm would be advertised and
    // never executed. These are that coverage.
    //
    // Both cases exercise `procStandingLeechesPerVictim`, which since #374 is the only standing-leech
    // proc there is. There used to be a sibling arm in an aggregate `procStandingLeeches`; it was
    // measured UNREACHABLE and then deleted. The cause was structural, and it is worth keeping here
    // because it also explains why no "non-positional" fixture would ever have covered it:
    // `normalizeCombatRoster` assigns every actor a position, so `positional` is true whenever there
    // is a victim to damage, and the aggregate proc's only feed sat inside `if (!positional)`. A
    // fixture that merely omits `position` is re-placed by the normalizer and lands HERE instead —
    // a test that passes without building the case its name claims.
    it('a standing leech on the selector repairs the worst-HP ally, not the anchor', () => {
        let low: CombatActor | undefined;
        let anchor: CombatActor | undefined;
        runCombat({
            ...HEAL_BASE(),
            attack: 10_000,
            target: enemyTarget(),
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [damageAb()] },
                    { slot: 'passive', abilities: [leechHeal(20)] },
                ],
            },
            __testTapActors: (actors) => {
                setAllyHp(actors);
                low = actors.find((a) => a.id === LOW_HP_ALLY_ID);
                anchor = actors.find((a) => a.id === HIGH_HP_ANCHOR_ID);
            },
        });
        // The cast deals 10,000 (attack 10k, enemy defence 0, ×1.0); the leech repairs 20% = 2,000
        // to the SELECTED ally. Anti-vacuity: a non-zero, exactly-predicted movement.
        expect(low!.currentHp).toBe(17_000);
        expect(anchor!.currentHp).toBe(40_000);
    });

    it('ENEMY owner: the mirror repairs its own worst-HP ally (locked symmetry)', () => {
        let low: CombatActor | undefined;
        let high: CombatActor | undefined;
        let healer: CombatActor | undefined;
        runCombat({
            ...ENEMY_HEAL_BASE({
                slots: [
                    { slot: 'active', abilities: [damageAb()] },
                    { slot: 'passive', abilities: [leechHeal(20)] },
                ],
            }),
            // The enemy leech owner needs real attack for its damage credit to be non-zero, and a
            // player-side victim that survives it.
            hp: 10_000_000,
            enemyAttackers: [
                {
                    id: ENEMY_HEALER_ID,
                    stats: {
                        attack: 10_000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: 50_000,
                        speed: 100,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M4',
                    shipSkills: {
                        slots: [
                            { slot: 'active', abilities: [damageAb()] },
                            { slot: 'passive', abilities: [leechHeal(20)] },
                        ],
                    },
                },
                enemyShip(ENEMY_LOW_HP_ID, 'M3', undefined),
                enemyShip(ENEMY_HIGH_HP_ID, 'M2', undefined),
            ],
            __testTapActors: (actors) => {
                setEnemyAllyHp(actors);
                low = actors.find((a) => a.id === ENEMY_LOW_HP_ID);
                high = actors.find((a) => a.id === ENEMY_HIGH_HP_ID);
                healer = actors.find((a) => a.id === ENEMY_HEALER_ID);
            },
        });
        expect(low!.currentHp).toBeGreaterThan(15_000);
        expect(high!.currentHp).toBe(40_000);
        // The owner is EXCLUDED: it is at full HP and gains nothing (no self-leech).
        expect(healer!.currentHp).toBe(50_000);
    });
});

// ---------------------------------------------------------------------------
// SP-4e review fix (FIX 1) — the `castPathCheatDeath` carve-out FENCE in engine.ts.
//
// A single-`ally` Cheat-Death-family grant with NO heal anchor (`healTargetId` undefined —
// DPS/battle mode, no heal target configured) falls back to `[ownerId]`: a sane stand-in for
// "the heal anchor" when there is none. `'lowest-hp-ally'` names "the OTHER ally" instead, and
// the owner is the one answer that selector forbids — so with no anchor to narrow to, the fence
// resolves it to `[]` (nobody), NOT `[ownerId]`. This is a real behaviour fork with zero prior
// coverage: reverting the fence to the un-armed `[healTargetId ?? ownerId]` would silently let a
// `'lowest-hp-ally'` grant self-target again.
//
// Harness: `mode: 'battle'`, no `healTargetId`, a single actor (the owner IS the only living
// player-side actor, so there is no "other ally" to route to regardless). The owner's ACTIVE slot
// carries an unconditional Cheat-Death grant; a faster owner casts it before a lethal enemy hit
// lands. `cheat-death-activated` firing (and the owner surviving) proves the grant self-targeted;
// its absence (and the owner being destroyed) proves the fence held.
// ---------------------------------------------------------------------------
describe("SP-4e review fix — the Cheat-Death carve-out fence ('lowest-hp-ally' vs 'ally', no anchor)", () => {
    const cheatDeathGrant = (target: 'ally' | 'lowest-hp-ally'): Ability => ({
        id: `cd-fence-${target}`,
        type: 'buff',
        target,
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'buff',
            buffName: 'Cheat Death',
            stacks: 1,
            parsedEffects: {},
            isStackable: false,
            duration: 'recurring',
        },
    });

    const grantSkills = (target: 'ally' | 'lowest-hp-ally'): ShipSkills => ({
        slots: [{ slot: 'active', abilities: [cheatDeathGrant(target)] }],
    });

    /** Owner casts an active-slot Cheat-Death grant, no `healTargetId`, `mode: 'battle'`. The
     *  owner is faster than the lethal enemy, so the grant lands (or doesn't) BEFORE the hit. */
    const runFenceCase = (target: 'ally' | 'lowest-hp-ally') => {
        const bus = createEventBus();
        const cheated: Extract<CombatEvent, { type: 'cheat-death-activated' }>[] = [];
        const destroyedIds: string[] = [];
        bus.on('cheat-death-activated', (e) => cheated.push(e));
        bus.on('ship-destroyed', (e) => destroyedIds.push(e.actorId));
        runCombat({
            ...bareInput(),
            attack: 0, // the owner does no damage of its own — only grants the buff
            shipSkills: grantSkills(target),
            mode: 'battle',
            // NO healTargetId — the exact no-anchor shape the fence is scoped to.
            hp: 5_000,
            speed: 300, // owner acts before the enemy (speed 100)
            numRounds: 1,
            enemyAttackers: attackingEnemy({ stats: { speed: 100 } }), // 10,000 dmg → lethal vs 5,000 hp
            bus,
        });
        return { cheated, destroyedIds };
    };

    it("target 'lowest-hp-ally', no anchor: fence holds — no self-grant, owner destroyed", () => {
        const { cheated, destroyedIds } = runFenceCase('lowest-hp-ally');
        expect(cheated).toHaveLength(0);
        expect(destroyedIds).toContain('attacker');
    });

    it("target 'ally', no anchor: UNCHANGED fallback — owner self-grants and survives", () => {
        const { cheated, destroyedIds } = runFenceCase('ally');
        expect(cheated).toHaveLength(1);
        expect(cheated[0]).toMatchObject({ actorId: 'attacker' });
        expect(destroyedIds).not.toContain('attacker');
    });
});

// ---------------------------------------------------------------------------
// SP-4e Task 4 — a PLAIN `'ally'` heal routes to the caster's TARGET PATTERN.
//
// The pre-4e `recipientsFor` decided a single-`'ally'` recipient from the RUN MODE, not from the
// ability: an enemy caster (and a `teamBattle` player caster) got `lowestHpAllyId(...) ?? actor.id`,
// and everyone else got `[healing.targetId]` — the healing calculator's chosen anchor. Task 3 gave
// the three ships whose TEXT names a worst-HP ally the `'lowest-hp-ally'` selector, so those arms
// no longer carry any real kit. Task 4 deletes them, and the user-confirmed rule for what is left
// is: an unspecified single ally means "the ship's target pattern" — the caster's own-side roster
// narrowed by its support footprint, on BOTH sides.
//
// Discriminating shape (both cases): the heal ANCHOR / the worst-HP ally sits OFF the footprint and
// a healthier ally sits ON it. The deleted arms both route to the OFF-footprint id, which the
// footprint intersection then drops entirely — so the old rule heals NOBODY here while the new rule
// heals the on-footprint ally. Non-zero, exactly-predicted movement either way, so neither case can
// pass vacuously.
// ---------------------------------------------------------------------------
const ON_FOOTPRINT_ID = 'ally-on-footprint';
const OFF_FOOTPRINT_ID = 'ally-off-footprint-is-the-heal-anchor';
const ENEMY_ON_FOOTPRINT_ID = 'enemy-ally-on-footprint';
const ENEMY_OFF_FOOTPRINT_ID = 'enemy-ally-off-footprint-and-worst-hp';

/** A plain single-`'ally'` heal: no worst-HP wording in its text, so no selector. */
const plainAllyHeal = (pct: number): Ability => ({
    id: 'ab-plain-ally',
    type: 'heal',
    config: { type: 'heal', pct, basis: 'hp' },
    target: 'ally',
    trigger: 'on-cast',
    conditions: [],
});

describe("SP-4e Task 4: a plain 'ally' heal routes over the caster's support footprint", () => {
    it('player caster: heals the ON-footprint ally, NOT the off-footprint heal anchor', () => {
        let onFootprint: CombatActor | undefined;
        let offFootprint: CombatActor | undefined;
        let caster: CombatActor | undefined;
        const result = runCombat({
            ...HEAL_BASE(),
            // Line-Support-Range-1 @ M3 covers exactly {M3, M4} (resolvePattern.test.ts).
            position: 'M3',
            pattern: parsePattern('Pattern-Line-Support-Range-1'),
            shipSkills: castSlots([plainAllyHeal(10)]),
            // The heal anchor is the OFF-footprint ally: the deleted `[healing.targetId]` arm
            // routes here, and the footprint intersection then drops it → nobody healed.
            healTargetId: OFF_FOOTPRINT_ID,
            teamActors: [
                walkedAlly(ON_FOOTPRINT_ID, 'M4', 50_000),
                walkedAlly(OFF_FOOTPRINT_ID, 'M1', 50_000),
            ],
            __testTapActors: (actors) => {
                for (const a of actors) {
                    if (a.id === ON_FOOTPRINT_ID || a.id === OFF_FOOTPRINT_ID) a.currentHp = 25_000;
                    if (a.id === FOCUS_ID) a.currentHp = 25_000;
                }
                onFootprint = actors.find((a) => a.id === ON_FOOTPRINT_ID);
                offFootprint = actors.find((a) => a.id === OFF_FOOTPRINT_ID);
                caster = actors.find((a) => a.id === FOCUS_ID);
            },
        });
        const round = result.healing!.rounds[0];
        // 10% of the caster's 50,000 hp basis = 5,000 onto every footprint-covered ally.
        expect(round.perRecipient.get(ON_FOOTPRINT_ID)?.effectiveHeal ?? 0).toBeGreaterThan(0);
        expect(onFootprint!.currentHp).toBe(30_000);
        // The caster stands on its own footprint (M3), so the pattern covers it too.
        expect(caster!.currentHp).toBe(30_000);
        // Anti-vacuity: the off-footprint ally is identical except its cell, and IS the configured
        // anchor — the id the deleted arm would have routed to. It receives nothing.
        expect(round.perRecipient.get(OFF_FOOTPRINT_ID)?.effectiveHeal ?? 0).toBe(0);
        expect(offFootprint!.currentHp).toBe(25_000);
    });

    it('ENEMY caster: the same footprint rule over the ENEMY roster (locked symmetry)', () => {
        let onFootprint: CombatActor | undefined;
        let offFootprint: CombatActor | undefined;
        let healer: CombatActor | undefined;
        runCombat({
            ...ENEMY_HEAL_BASE(castSlots([plainAllyHeal(10)])),
            enemyAttackers: [
                {
                    ...enemyShip(ENEMY_HEALER_ID, 'M3', castSlots([plainAllyHeal(10)])),
                    pattern: parsePattern('Pattern-Line-Support-Range-1'),
                },
                enemyShip(ENEMY_ON_FOOTPRINT_ID, 'M4', undefined),
                enemyShip(ENEMY_OFF_FOOTPRINT_ID, 'M1', undefined),
            ],
            __testTapActors: (actors) => {
                for (const a of actors) {
                    if (a.id === ENEMY_ON_FOOTPRINT_ID) a.currentHp = 40_000;
                    // The WORST-HP enemy ally, and OFF the footprint: the id the deleted
                    // `isEnemyCaster` arm routed to.
                    if (a.id === ENEMY_OFF_FOOTPRINT_ID) a.currentHp = 15_000;
                    if (a.id === ENEMY_HEALER_ID) a.currentHp = 25_000;
                }
                onFootprint = actors.find((a) => a.id === ENEMY_ON_FOOTPRINT_ID);
                offFootprint = actors.find((a) => a.id === ENEMY_OFF_FOOTPRINT_ID);
                healer = actors.find((a) => a.id === ENEMY_HEALER_ID);
            },
        });
        // 10% of the healer's 50,000 hp basis = 5,000 onto every footprint-covered enemy ally.
        expect(onFootprint!.currentHp).toBe(45_000);
        expect(healer!.currentHp).toBe(30_000);
        expect(offFootprint!.currentHp).toBe(15_000);
    });
});
