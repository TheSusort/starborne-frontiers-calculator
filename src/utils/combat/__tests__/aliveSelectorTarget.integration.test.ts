/**
 * #407 — the enemy SELECTORS never name a dead ship.
 *
 * ── THE DEFECT, AS AN IN-FIGHT STORY ──────────────────────────────────────────────────────────
 * The enemy Curator takes a Barrier in round 2 and dies in round 3. In round 4 Rhodium's
 * end-of-round purge fires at "the enemy with the most buffs" — and picked the CORPSE. A dead actor
 * stays in `enemyAttackerActors` / `allPlayerActors` with its statuses intact and takes no turns to
 * tick them down, so a corpse from ANY earlier round remained selectable forever, and the living
 * Barrier-carrying enemy in front of it kept its buff.
 *
 * `mostBuffsAmong` was the only one of the three selector resolvers with no liveness filter;
 * `highestAttackInRoster` and `highestSpeedInRoster` each passed their own — which is why the last
 * two arms below PASS even before the fix, and are the instrument validation for the two that do
 * not.
 *
 * ── WHY THIS FILE HAD TO EXIST ────────────────────────────────────────────────────────────────
 * The whole pre-existing suite — 596 files, 6705 tests, every golden fingerprint — is byte-identical
 * across the fix. Measured: the gate changes a CONSUMED selector answer only 4 times suite-wide,
 * and the on-cast purge loop reaches its `enemy-most-buffs` arm only 24 times at all. (An
 * instrumented count of 1086 dead-winner resolver CALLS is not a count of behaviour changes: the
 * eager `enemyMostBuffsId` is computed once per turn for every caster, purge or not, and nearly all
 * of those values are discarded.) So the suite's silence measures the suite's coverage of this
 * mechanic, not the fix's correctness — and nothing except this file observes the defect at all.
 *
 * ── WHY THE FIXTURE IS SHAPED THIS WAY ────────────────────────────────────────────────────────
 * Three enemies, deliberately all distinct, because two of them collapsing would make the whole
 * file vacuous:
 *
 *   CORPSE  (M4, front, 1 hp, speed 200, TWO self-buffs) — acts BEFORE the caster (speed 100), so
 *           it self-buffs in round 1 and is then killed by the caster's round-1 ACTIVE cast.
 *           Verified below by asserting `destroyedRound === 1`, not assumed.
 *   ANCHOR  (M3, huge hp, speed 5, NO buffs) — becomes the front-most living enemy once the corpse
 *           dies, so it is what the cast anchors on for the rest of the fight.
 *   LIVING  (M1, back, huge hp, speed 150, ONE self-buff) — the correct answer. Never the anchor
 *           (M1 is the back column; column 4 is the FRONT), so "landed on LIVING" cannot be
 *           confused with "fell through to the anchor".
 *
 * A selector-targeted clause can never reach the anchor tail anyway — `resolveDebuffRecipientIds`
 * returns from its selector arm before the positional/`all-enemies`/tail arms — but keeping ANCHOR
 * a third distinct actor means a reader does not have to know that to trust the file.
 *
 * ── WHY THE SELECTOR CLAUSE IS ON THE CHARGED SLOT (a trap this file was caught by) ────────────
 * `destroyedRound` is recorded when the CAST completes, not the instant the damage clause drops the
 * victim to 0. So a selector clause in the SAME cast that killed the victim still sees it as alive,
 * and an earlier draft of this file — damage and selector both on the active slot — measured
 * exactly that: `enemy-highest-attack` and `enemy-highest-speed`, which already filtered the dead,
 * BOTH marked the corpse. That reading was about round 1's not-yet-recorded death, not about
 * corpse selection at all.
 *
 * The fix is to separate the kill from the selection by a ROUND. The caster banks one charge, so
 * its ACTIVE slot (damage only) fires in round 1 and kills the corpse, and its CHARGED slot — which
 * carries the selector clause and nothing else — first fires in round 2, against a corpse whose
 * death is fully recorded. If you ever move the selector clause back onto the active slot, this
 * file goes green for the wrong reason.
 *
 * ── WHAT MAKES IT RED ─────────────────────────────────────────────────────────────────────────
 * Removing the `aliveTargetsOf` gate at `engine.ts`'s `buildTurnArgs` seam. Measured before the fix
 * landed: the two `enemy-most-buffs` arms failed (the mark sat on CORPSE_ID and LIVING_ID's store
 * was empty), while the `highest-attack` and `highest-speed` arms already passed. Two arms red and
 * two green in the same file is what proves the fixture can report BOTH answers.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';
import { DEFAULT_ENEMY_TARGET, type StatusEngine } from '../statusEngine';
import type { CombatActor } from '../state';
import type { Position } from '../../../types/encounters';

/** Front column (4) so the caster's damage clause kills it in round 1. */
const CORPSE_ID = 'e-corpse';
/** The front-most LIVING enemy once the corpse dies — i.e. the cast anchor. Carries no buffs. */
const ANCHOR_ID = 'e-anchor';
/** Back column, never the anchor. The selector's correct answer. */
const LIVING_ID = 'e-living';

const skills = (abilities: Ability[]): ShipSkills => ({ slots: [{ slot: 'active', abilities }] });

/** An enemy's own self-buff, cast from its ACTIVE slot — a passive-slot on-cast self-buff does not
 *  apply in this harness, which is how an earlier probe of this mechanic went vacuous. */
const selfBuff = (buffName: string): Ability => ({
    id: `ab-selfbuff-${buffName}`,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName,
        duration: 9,
        stacks: 1,
        isStackable: false,
        parsedEffects: {},
    },
});

/** Ordered FIRST in the caster's ability list, so the corpse is already dead by the time the
 *  selector clause below resolves — the locked intra-cast clause-order rule. */
const damageClause = (): Ability => ({
    id: 'ab-damage',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

/** `application: 'apply'` skips the landing roll, so a missed inflict can never explain an empty
 *  store. No `parsedEffects`: this file asks WHO the clause lands on, not what it does. */
const selectorDebuff = (target: Ability['target']): Ability => ({
    id: `ab-selector-${target}`,
    type: 'debuff',
    target,
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName: 'Probe Mark',
        duration: 5,
        stacks: 1,
        isStackable: false,
        application: 'apply',
        parsedEffects: {},
    },
});

interface ProbeEnemy {
    id: string;
    position: Position;
    speed: number;
    attack?: number;
    /** Explicit max HP. Left undefined, `withTargetableHp` floors it to MIN_TARGETABLE_MAX_HP. */
    hp?: number;
    abilities?: Ability[];
}

interface Probe {
    /** Per-victim ENEMY store, keyed by victim id — where a landed debuff is written. */
    enemyStores: Record<string, string[]>;
    /** Each enemy's OWN self store: the instrument validation for a buff-count selector. */
    enemySelfStores: Record<string, string[]>;
    /** The non-positional landing bucket. Read it to tell a fizzle apart from a landing on the
     *  turn's bound victim — two different answers that both leave every named store empty. */
    defaultBucket: string[];
    /** Final actor state. The arrays handed to `__testTapActors` are LIVE references mutated by
     *  the run, so reading them AFTER `runCombat` yields end-of-fight state — which is how the
     *  corpse's death is verified rather than assumed. */
    finalById: Record<string, { destroyedRound?: number; currentHp: number; maxHp: number }>;
}

function runProbe(
    activeAbilities: Ability[],
    chargedAbilities: Ability[],
    enemies: ProbeEnemy[]
): Probe {
    let statusEngine: StatusEngine | undefined;
    let liveActors: CombatActor[] = [];
    const input: CombatEngineInput = {
        attack: 1000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        // ONE charge to bank, never pre-charged: the caster's ACTIVE slot fires in round 1 (killing
        // the corpse), and the CHARGED slot — which carries the selector clause — first fires in
        // round 2, by which time the corpse's death is RECORDED. That separation is the whole point;
        // see the header's "why round 2" note.
        chargeCount: 1,
        shipSkills: {
            slots: [
                { slot: 'active', abilities: activeAbilities },
                { slot: 'charged', abilities: chargedAbilities },
            ],
        },
        numRounds: 3,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: true,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: 1_000_000_000,
        // Speed 100: the CORPSE (200) and LIVING (150) both act before the caster and get their
        // self-buffs up in round 1; the ANCHOR (5) never does anything at all.
        speed: 100,
        enemyAttackers: enemies.map((e) => ({
            id: e.id,
            position: e.position,
            stats: {
                attack: e.attack ?? 10,
                crit: 0,
                critDamage: 0,
                speed: e.speed,
                ...(e.hp !== undefined ? { hp: e.hp } : {}),
            },
            chargeCount: 0,
            startCharged: false,
            shipSkills: skills(e.abilities ?? []),
        })),
        __testTapStatusEngine: (e) => {
            statusEngine = e;
        },
        __testTapActors: (actors) => {
            liveActors = actors;
        },
    };

    runCombat(input);

    const storeFor = (victimId: string): string[] =>
        statusEngine!
            .timedAbilityStatuses('enemy', undefined, victimId)
            .map((s) => s.payload.buffName);
    const selfStoreFor = (ownerId: string): string[] =>
        statusEngine!.timedAbilityStatuses('self', ownerId).map((s) => s.payload.buffName);

    return {
        enemyStores: Object.fromEntries(enemies.map((e) => [e.id, storeFor(e.id)])),
        enemySelfStores: Object.fromEntries(enemies.map((e) => [e.id, selfStoreFor(e.id)])),
        defaultBucket: storeFor(DEFAULT_ENEMY_TARGET),
        finalById: Object.fromEntries(
            liveActors.map((a) => [
                a.id,
                {
                    ...(a.destroyedRound !== undefined ? { destroyedRound: a.destroyedRound } : {}),
                    currentHp: a.currentHp,
                    maxHp: a.stats.hp,
                },
            ])
        ),
    };
}

/** CORPSE dies in round 1 carrying two buffs; ANCHOR is the front-most survivor with none;
 *  LIVING sits in the back column with one. All three distinct — see the header. */
const corpseBoard = (): ProbeEnemy[] => [
    {
        id: CORPSE_ID,
        position: 'M4',
        speed: 200,
        hp: 1,
        abilities: [selfBuff('Boon One'), selfBuff('Boon Two')],
    },
    { id: ANCHOR_ID, position: 'M3', speed: 5 },
    { id: LIVING_ID, position: 'M1', speed: 150, abilities: [selfBuff('Boon One')] },
];

describe('#407: a dead ship is never named by an enemy selector', () => {
    it('INSTRUMENT: the corpse really dies in round 1, and really keeps its two buffs', () => {
        // Without this, every assertion below could be explained by "the corpse was alive all
        // along and simply had the most buffs" — which is exactly what the first draft of this
        // fixture measured before positions were pinned. Death is verified, never assumed.
        const probe = runProbe(
            [damageClause()],
            [selectorDebuff('enemy-most-buffs')],
            corpseBoard()
        );
        expect(probe.finalById[CORPSE_ID].destroyedRound).toBe(1);
        expect(probe.finalById[CORPSE_ID].currentHp).toBe(0);
        // Death does not clear an actor's own self statuses — the whole reason a corpse could win
        // a buff-count selection.
        expect(probe.enemySelfStores[CORPSE_ID]).toEqual(['Boon One', 'Boon Two']);
        // And the living alternative is genuinely alive, genuinely buffed, and genuinely NOT the
        // anchor (the anchor took the damage; LIVING never did).
        expect(probe.finalById[LIVING_ID].destroyedRound).toBeUndefined();
        expect(probe.enemySelfStores[LIVING_ID]).toEqual(['Boon One']);
        expect(probe.finalById[LIVING_ID].currentHp).toBe(probe.finalById[LIVING_ID].maxHp);
        expect(probe.finalById[ANCHOR_ID].currentHp).toBeLessThan(probe.finalById[ANCHOR_ID].maxHp);
        expect(probe.enemySelfStores[ANCHOR_ID]).toEqual([]);
    });

    it('enemy-most-buffs picks the LIVING buffed enemy over the more-buffed corpse', () => {
        // In-fight: your attack kills the enemy's most-buffed ship, and the debuff clause in the
        // SAME cast used to land on the ship you had just destroyed instead of the next-most-buffed
        // one still shooting at you.
        const probe = runProbe(
            [damageClause()],
            [selectorDebuff('enemy-most-buffs')],
            corpseBoard()
        );
        expect(probe.enemyStores[LIVING_ID]).toContain('Probe Mark');
        expect(probe.enemyStores[CORPSE_ID]).not.toContain('Probe Mark');
        // Not the anchor either — a selector clause never falls through to the cast anchor.
        expect(probe.enemyStores[ANCHOR_ID]).not.toContain('Probe Mark');
    });

    it('enemy-most-buffs FIZZLES when the only buffed enemy is dead', () => {
        // The 561-of-1086 half of the measurement: with no living buff anywhere there is no
        // victim, so nothing is inflicted, nothing is resisted, and no landing draw is taken. The
        // corpse must NOT be a fall-back, and the non-positional `undefined` sink must stay empty
        // too — a positional caller inflicts nobody (#403 ruling R1).
        const probe = runProbe(
            [damageClause()],
            [selectorDebuff('enemy-most-buffs')],
            [
                {
                    id: CORPSE_ID,
                    position: 'M4',
                    speed: 200,
                    hp: 1,
                    abilities: [selfBuff('Boon One')],
                },
                { id: ANCHOR_ID, position: 'M3', speed: 5 },
                { id: LIVING_ID, position: 'M1', speed: 150 },
            ]
        );
        expect(probe.finalById[CORPSE_ID].destroyedRound).toBe(1);
        expect(probe.enemySelfStores[CORPSE_ID]).toEqual(['Boon One']);
        expect(probe.enemyStores[CORPSE_ID]).not.toContain('Probe Mark');
        expect(probe.enemyStores[ANCHOR_ID]).not.toContain('Probe Mark');
        expect(probe.enemyStores[LIVING_ID]).not.toContain('Probe Mark');
        expect(probe.defaultBucket).not.toContain('Probe Mark');
    });

    it('enemy-highest-attack skips a dead ship that would otherwise win on attack', () => {
        // These two already filtered the dead via their own predicate. The point of pinning them
        // is that moving the check UP to the seam did not lose it.
        const probe = runProbe(
            [damageClause()],
            [selectorDebuff('enemy-highest-attack')],
            [
                { id: CORPSE_ID, position: 'M4', speed: 200, hp: 1, attack: 9000 },
                { id: ANCHOR_ID, position: 'M3', speed: 5, attack: 10 },
                { id: LIVING_ID, position: 'M1', speed: 150, attack: 500 },
            ]
        );
        expect(probe.finalById[CORPSE_ID].destroyedRound).toBe(1);
        expect(probe.enemyStores[LIVING_ID]).toContain('Probe Mark');
        expect(probe.enemyStores[CORPSE_ID]).not.toContain('Probe Mark');
    });

    it('enemy-highest-speed skips a dead ship that would otherwise win on speed', () => {
        const probe = runProbe(
            [damageClause()],
            [selectorDebuff('enemy-highest-speed')],
            [
                { id: CORPSE_ID, position: 'M4', speed: 300, hp: 1 },
                { id: ANCHOR_ID, position: 'M3', speed: 5 },
                { id: LIVING_ID, position: 'M1', speed: 150 },
            ]
        );
        expect(probe.finalById[CORPSE_ID].destroyedRound).toBe(1);
        expect(probe.enemyStores[LIVING_ID]).toContain('Probe Mark');
        expect(probe.enemyStores[CORPSE_ID]).not.toContain('Probe Mark');
    });
});
