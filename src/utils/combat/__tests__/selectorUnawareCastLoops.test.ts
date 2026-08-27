/**
 * #407 (from #403 review Finding 7) — the three on-cast loops that had NO selector arm.
 *
 * `playerTurn.ts` has FIVE on-cast loops that ask "which enemies does this clause land on". Two
 * already answered it properly: the debuff-clause path (via `resolveDebuffRecipientIds`) and the
 * purge loop (which resolves `enemy-most-buffs` and keeps an anchor fall-back by #403 ruling R4).
 * The other three resolved recipients with a bare
 *
 *     ab.target === 'all-enemies' && aoeVictimIds ? aoeVictimIds : [targetId]
 *
 * and had no selector arm at all — so a selector target on any of them silently landed on whichever
 * enemy the cast's pattern happened to anchor on:
 *
 *   • `bomb-countdown-reduce` (reduceEnemyBombs — Lingshe's countdown reduce + force detonate)
 *   • the standalone `shield-strip` loop (APEX / Laika / Malvex)
 *   • the `extend-status` DEBUFF branch (Sokol / Lev)
 *
 * ── REACHABILITY: CORPUS-UNREACHABLE, MEASURED ────────────────────────────────────────────────
 * Sweeping all 1140 abilities `buildShipAbilities` derives from `docs/ship-skills.csv`, the ONLY
 * selector-targeted abilities in the corpus are:
 *
 *     Chakara/passive2  damage  enemy-highest-speed   Rhodium/passive1  purge   enemy-most-buffs
 *     Lodolite/charged  purge   enemy-most-buffs      Rhodium/passive2  purge   enemy-most-buffs
 *     Selenite/passive2 debuff  enemy-highest-attack  Rhodium/passive2  damage  enemy-most-buffs
 *
 * `purge`, `damage`, `debuff` — and nothing else. No corpus ship emits `bomb-countdown-reduce`,
 * `shield-strip` or `extend-status` with a selector target, which is why #403 scoped these out and
 * why every case below is HAND-AUTHORED. It also means no golden should move for this change: if
 * one does, the fix reached something the census said it could not, and that is a finding, not a
 * rebaseline.
 *
 * The same widening also fixes `adjacent-enemies` / `target-and-adjacent-enemies` at these three
 * sites, which were collapsing to the anchor for exactly the same reason.
 *
 * Harness: direct `runPlayerTurn` calls with hand-built runtime/args, mirroring
 * `extendStatusCastPath.test.ts` — one isolated cast, full control over the `selectorEnemyIdFor`
 * delegate the engine normally supplies from `buildTurnArgs`.
 */
import { describe, expect, it } from 'vitest';
import { runPlayerTurn, PlayerActorRuntime, PlayerTurnArgs } from '../playerTurn';
import { createActor, CombatActor } from '../state';
import { createStatusEngine, StatusEngine, RegisteredAbilityStatus } from '../statusEngine';
import { createEventBus } from '../events';
import { makeRateGate } from '../../calculators/rateAccumulator';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { EnemySelectorKind } from '../../abilities/abilityTargetSide';
import { AffinityName } from '../../../types/ship';

const ATTACKER_AFFINITY: AffinityName = 'thermal';

/** The cast's ANCHOR — what all three loops used to hit regardless of the selector. */
const ANCHOR_ID = 'e-anchor';
/** The actor the selector delegate names. Never the anchor, so the two answers come apart. */
const SELECTED_ID = 'e-selected';

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

const skills = (abilities: Ability[]): ShipSkills => ({
    slots: [{ slot: 'active', abilities }],
});

function makeRuntime(castSkills: ShipSkills): PlayerActorRuntime {
    const actor = createActor({
        id: 'caster',
        side: 'player',
        kind: 'attacker',
        stats: baseStats(),
        chargeCount: 0,
        startCharged: false,
    });
    return {
        actor,
        focus: true,
        castSkills,
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

function makeVictim(id: string): CombatActor {
    return createActor({
        id,
        side: 'enemy',
        kind: 'enemy',
        stats: { ...baseStats(), attack: 0, hp: 1_000_000 },
    });
}

/**
 * Args for a POSITIONAL cast against a two-enemy board, with a selector delegate that always
 * resolves to `SELECTED_ID`. `deferAbilityPerformedToEngine` is what makes `positionalLanding` true,
 * which is the mode every one of these loops runs in during a real battle.
 */
function makeArgs(
    runtime: PlayerActorRuntime,
    anchor: CombatActor,
    selected: CombatActor,
    statusEngine: StatusEngine,
    overrides: Partial<PlayerTurnArgs> = {}
): PlayerTurnArgs {
    return {
        runtime,
        enemy: anchor,
        statusEngine,
        corrosionEntries: [],
        infernoEntries: [],
        genericDoTEntries: [],
        pendingBombs: [],
        pendingAccumulators: [],
        enemyDefense: 0,
        enemyHp: anchor.currentHp,
        enemyType: undefined,
        bus: createEventBus(),
        round: 1,
        targetId: anchor.id,
        deferAbilityPerformedToEngine: true,
        opposingVictimById: new Map([
            [anchor.id, anchor],
            [selected.id, selected],
        ]),
        selectorEnemyIdFor: (_kind: EnemySelectorKind) => selected.id,
        ...overrides,
    };
}

/** Seeds a 'Defense Down' timed debuff on `victimId`'s enemyMaps entry, so `extend-status` has
 *  something to lengthen and the assertion can read a DURATION rather than a presence. */
function seedEnemyDebuff(statusEngine: StatusEngine, victimId: string, duration: number): void {
    const status: Extract<RegisteredAbilityStatus, { kind: 'timed' }> = {
        kind: 'timed',
        side: 'enemy',
        sourceSlot: 'active',
        conditions: [],
        duration,
        payload: { buffName: 'Defense Down', stacks: 1, parsedEffects: { defense: -5 } },
    };
    // 3rd param (recipientId) is IGNORED for enemy-side statuses; the victim id is the 4th.
    statusEngine.applyTimedAbilityStatus(1, status, undefined, victimId);
}

/** Remaining turns of the seeded 'Defense Down' on `victimId`. NOTE the field: the live value is
 *  `active.turnsRemaining`, not the registration's `duration` — reading `duration` yields
 *  `undefined` and makes the assertion vacuous. */
const turnsLeftOn = (
    statusEngine: StatusEngine,
    victimId: string
): number | 'recurring' | 'permanent' | undefined =>
    statusEngine
        .timedAbilityStatuses('enemy', undefined, victimId)
        .find((s) => s.payload.buffName === 'Defense Down')?.active.turnsRemaining;

describe('#407: the three selector-unaware on-cast loops now resolve selectors', () => {
    it('bomb-countdown-reduce reduces the SELECTED enemy bomb, not the anchor', () => {
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        const anchor = makeVictim(ANCHOR_ID);
        const selected = makeVictim(SELECTED_ID);
        // A live bomb on EACH victim, identical but for the owner — so the assertion reads which
        // one was touched, not whether anything happened at all.
        const bomb = () => ({
            countdown: 3,
            damagePerStack: 1000,
            stacks: 1,
            tier: 3,
            sourceId: 'seeder',
            affinityMult: 1,
            detonationDamageModifier: 0,
            splashModifier: 0,
        });
        anchor.pendingBombs = [bomb()];
        selected.pendingBombs = [bomb()];

        const runtime = makeRuntime(
            skills([
                {
                    id: 'ab-bomb-reduce',
                    type: 'bomb-countdown-reduce',
                    target: 'enemy-highest-attack',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'bomb-countdown-reduce', turns: 1 },
                },
            ])
        );
        runPlayerTurn(makeArgs(runtime, anchor, selected, statusEngine));

        expect(selected.pendingBombs[0].countdown).toBe(2);
        // The anchor's bomb is untouched — pre-#407 this was the one that ticked down.
        expect(anchor.pendingBombs[0].countdown).toBe(3);
    });

    it('shield-strip strips the SELECTED enemy shield, not the anchor', () => {
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        const anchor = makeVictim(ANCHOR_ID);
        const selected = makeVictim(SELECTED_ID);
        anchor.shieldPool = 1000;
        selected.shieldPool = 1000;

        const runtime = makeRuntime(
            skills([
                {
                    id: 'ab-shield-strip',
                    type: 'shield-strip',
                    target: 'enemy-most-buffs',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'shield-strip', pct: 50 },
                },
            ])
        );
        runPlayerTurn(makeArgs(runtime, anchor, selected, statusEngine));

        expect(selected.shieldPool).toBe(500);
        expect(anchor.shieldPool).toBe(1000);
    });

    it("extend-status extends the SELECTED enemy's debuffs, not the anchor's", () => {
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        const anchor = makeVictim(ANCHOR_ID);
        const selected = makeVictim(SELECTED_ID);
        seedEnemyDebuff(statusEngine, anchor.id, 2);
        seedEnemyDebuff(statusEngine, selected.id, 2);

        const runtime = makeRuntime(
            skills([
                {
                    id: 'ab-extend',
                    type: 'extend-status',
                    target: 'enemy-highest-speed',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'extend-status', statusKind: 'debuff', turns: 2 },
                },
            ])
        );
        runPlayerTurn(makeArgs(runtime, anchor, selected, statusEngine));

        expect(turnsLeftOn(statusEngine, selected.id)).toBe(4);
        expect(turnsLeftOn(statusEngine, anchor.id)).toBe(2);
    });

    it('INSTRUMENT: a plain target:enemy clause still lands on the anchor', () => {
        // Without this, every assertion above could be explained by the loops now ALWAYS using the
        // selector delegate — which would be a different, worse bug. The delegate is supplied here
        // exactly as above and must be ignored, because `enemy` is not a selector target.
        const statusEngine = createStatusEngine({ selfBuffs: [], enemyDebuffs: [] });
        statusEngine.beginRound(1);
        const anchor = makeVictim(ANCHOR_ID);
        const selected = makeVictim(SELECTED_ID);
        anchor.shieldPool = 1000;
        selected.shieldPool = 1000;

        const runtime = makeRuntime(
            skills([
                {
                    id: 'ab-shield-strip-plain',
                    type: 'shield-strip',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'shield-strip', pct: 50 },
                },
            ])
        );
        runPlayerTurn(makeArgs(runtime, anchor, selected, statusEngine));

        expect(anchor.shieldPool).toBe(500);
        expect(selected.shieldPool).toBe(1000);
    });
});
