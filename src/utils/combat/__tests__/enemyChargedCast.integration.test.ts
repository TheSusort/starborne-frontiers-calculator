/**
 * on-enemy-charged-cast trigger.
 *
 * Opposing-scoped mirror of on-charged-cast: fires when an ENEMY (opposing-side) actor casts
 * its CHARGED skill (a `skill-fired` event with slot:'charged'). The listener captures the
 * casting enemy's id into eventCtx.counterTargetId so downstream purge/debuff executors route
 * the reaction onto THAT enemy with zero executor changes.
 *
 * These are focused listener-level unit tests: a bare event bus + registerReactiveListeners,
 * mirroring the established pattern in triggers.test.ts (the death-trigger listener tests).
 * The owner 'A' is a player actor; 'enemy' is opposing per the isOpposing predicate.
 */

import { describe, it, expect } from 'vitest';
import { registerReactiveListeners, Intent, ReactiveAbility } from '../triggers';
import { createEventBus, type CombatEvent } from '../events';
import { runCombat, type CombatEngineInput } from '../engine';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ability } from '../../../types/abilities';
import type { Ship } from '../../../types/ship';
import type { StatusEngine } from '../statusEngine';

// A minimal reactive ability carrying the on-enemy-charged-cast trigger. A purge fixture is the
// canonical downstream consumer (Curator), but the trigger plumbing under test is type-agnostic.
const enemyChargedCastAbility = (): Ability => ({
    id: 'd-enemy-charged-cast',
    type: 'purge',
    target: 'enemy',
    trigger: 'on-enemy-charged-cast',
    conditions: [],
    config: { type: 'purge', count: 1 },
});

// Wire up the bus, register owner 'A' (player) with isOpposing matching 'enemy', emit a
// skill-fired event with the given actorId + slot, and return the collected intents.
function emitSkillFired(actorId: string, slot: 'active' | 'charged'): Intent[] {
    const bus = createEventBus();
    const intents: Intent[] = [];
    const ra: ReactiveAbility = { ability: enemyChargedCastAbility(), sourceSlot: 'passive' };
    registerReactiveListeners({
        bus,
        perOwner: [{ ownerId: 'A', reactiveAbilities: [ra] }],
        enqueue: (i) => intents.push(i),
        isOpposing: (id) => id === 'enemy',
    });
    bus.emit({ type: 'skill-fired', actorId, slot, round: 1 });
    return intents;
}

describe('on-enemy-charged-cast (opposing-scoped charged-cast reaction)', () => {
    it('fires when an OPPOSING actor casts its CHARGED skill, routing counterTargetId = caster', () => {
        const intents = emitSkillFired('enemy', 'charged');
        expect(intents).toHaveLength(1);
        expect(intents[0].ownerId).toBe('A');
        expect(intents[0].ability.trigger).toBe('on-enemy-charged-cast');
        // Reuses eventCtx.counterTargetId to point at the casting enemy (zero executor change).
        expect(intents[0].eventCtx?.counterTargetId).toBe('enemy');
    });

    it('does NOT fire for a same-side (owner/ally) charged cast', () => {
        // 'A' is the owner (player side), not opposing → no enqueue.
        expect(emitSkillFired('A', 'charged')).toHaveLength(0);
    });

    it('does NOT fire for an opposing ACTIVE (non-charged) cast', () => {
        // Opposing actor, but slot:'active' → the charged-slot guard rejects it.
        expect(emitSkillFired('enemy', 'active')).toHaveLength(0);
    });
});

// ════════════════════════════════════════════════════════════════════════════════════
// Phase 4 Task 7 — ENGINE integration goldens (full runCombat).
//
// The listener tests above prove the trigger ENQUEUES correctly. These exercise the whole
// parse→build→engine pipeline: a player FOCUS reacts to a real enemy CHARGED cast and the
// downstream purge / Block-Buff / damage+shield executors actually fire. Every test is a
// gate-flip — a control proving the observed effect is caused by the reaction (no enemy
// charged cast → no reaction).
//
// ─── Real-data reaction abilities (Curator / FrontLine) ───────────────────────────────
// VERBATIM passive skill text from docs/ship-skills.csv. We run it through the production
// `buildShipAbilities(ship)` (the same path simulateBattle feeds the engine), so the parse
// and the on-enemy-charged-cast ability shapes are the REAL ones — NOT hand-written copies.
//
// DOCUMENTED DEVIATION: `buildShipAbilities` ALSO emits generic-auto-fill `on-cast` siblings
// from FrontLine's clauses (the start-of-combat 25% shield + a 30% on-cast damage). Those
// `on-cast` siblings fire on the reacting ship's OWN turn regardless of any enemy charged cast —
// they would pollute the gate-flip controls (e.g. FrontLine would gain a shield with NO enemy
// charged cast). So we take the real built passive slot and KEEP ONLY the `on-enemy-charged-cast`
// abilities for the engine run. This isolates the reaction under test while still locking in the
// genuine real-corpus parse (the abilities themselves are the production output, asserted
// shape-for-shape).
//
// NOTE: Curator's duplicate on-cast Block-Buff sibling — which previously fired on Curator's own
// turn regardless of any enemy charged cast — is now suppressed at the source (buildShipAbilities
// enemyDebuffs auto-fill skips a debuff name already claimed by parseEnemyChargedCastReaction;
// regression-locked in buildShipAbilities.test.ts). The KEEP-ONLY filter below is thus a no-op for
// Curator today and remains only for FrontLine's damage/shield siblings above.

const CURATOR_R0_TEXT =
    'This Unit has 20% Shield Penetration. <br /><br />\nWhen an enemy uses their charged skill, this unit <unit-aid>purges 1 buffs</unit-aid> from that enemy.';
const CURATOR_R4_TEXT =
    'This Unit has 20% Shield Penetration. <br /><br />\nWhen an enemy uses their charged skill, this unit <unit-aid>purges 2 buffs</unit-aid> from that enemy, and inflicts <unit-skill>Block Buff</unit-skill> for 2 turns.';
const FRONTLINE_R2_TEXT =
    'This ship has 20% Shield Penetration.<br />While Shielded, it gains 2500 additional Defense.<br />This Unit gains <unit-damage>Shield equal to 25%</unit-damage> of its Max HP at the start of combat.<br /><br />When an enemy uses their Charged skill, it deals <unit-damage>80%</unit-damage> and gains a Shield equal to <unit-damage>30%</unit-damage> of the damage dealt, once per round.';

const makeShip = (over: Partial<Ship>): Ship => ({
    id: 'reactor',
    name: 'Reactor',
    rarity: 'legendary',
    faction: 'AURELIAN_SOVEREIGNTY',
    type: 'DEFENDER',
    baseStats: {} as Ship['baseStats'],
    equipment: {},
    implants: {},
    refits: [],
    ...over,
});

/** Build the reaction ship's passive abilities from REAL text via buildShipAbilities, then keep
 *  ONLY the on-enemy-charged-cast ones (drop the auto-fill on-cast siblings — see deviation note). */
const reactionAbilitiesFromText = (passiveText: string, refitCount: number): Ability[] => {
    // Set the refit-tier passive field that getShipSkillRows will select, with enough refits.
    const over: Partial<Ship> =
        refitCount >= 4
            ? { thirdPassiveSkillText: passiveText }
            : refitCount >= 2
              ? { secondPassiveSkillText: passiveText }
              : { firstPassiveSkillText: passiveText };
    const ship = makeShip({
        ...over,
        refits: Array.from({ length: refitCount }, () => ({})) as unknown as Ship['refits'],
    });
    const built = buildShipAbilities(ship);
    const passive = built.slots.find((s) => s.slot === 'passive');
    if (!passive) throw new Error('no passive slot built from text');
    const reactions = passive.abilities.filter((a) => a.trigger === 'on-enemy-charged-cast');
    if (reactions.length === 0) throw new Error('no on-enemy-charged-cast abilities parsed');
    return reactions;
};

// Resolve the three real reaction ability sets ONCE (parse is pure).
const CURATOR_R0 = reactionAbilitiesFromText(CURATOR_R0_TEXT, 0); // purge 1
const CURATOR_R4 = reactionAbilitiesFromText(CURATOR_R4_TEXT, 4); // purge 2 + Block Buff(2)
const FRONTLINE_R2 = reactionAbilitiesFromText(FRONTLINE_R2_TEXT, 2); // damage 80% + shield (30% of dealt damage)

// ─── Enemy fixtures ───────────────────────────────────────────────────────────────────
type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const enemyDamage = (multiplier: number, id: string): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

const enemySelfBuff = (name: string, id: string): Ability => ({
    id,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: name,
        parsedEffects: { attack: 10 },
        stacks: 1,
        isStackable: false,
        duration: 99,
    },
});

/** An enemy that, when it fires its CHARGED skill, ALSO self-buffs (so a buff is present for the
 *  Curator reaction to purge). It carries the SAME self-buff on its ACTIVE slot, so the control
 *  (active-only enemy, no charged cast) STILL gains the buff — isolating "charged cast happened"
 *  as the only difference between the runs. Seeded charges == chargeCount via startCharged → it
 *  fires CHARGED on turn 1; chargeCount 1 + the charged-damage slot → hasChargedSkill true. */
const buffingChargedEnemy = (opts: {
    id: string;
    startCharged: boolean;
    chargeCount: number;
    speed?: number;
    buffName?: string;
}): EnemyAttacker => {
    const buff = enemySelfBuff(opts.buffName ?? 'Attack Up', `${opts.id}-buff`);
    return {
        id: opts.id,
        stats: { attack: 1000, crit: 0, critDamage: 0, speed: opts.speed ?? 40 },
        chargeCount: opts.chargeCount,
        startCharged: opts.startCharged,
        shipSkills: {
            slots: [
                {
                    slot: 'active',
                    abilities: [enemyDamage(50, `${opts.id}-a`), { ...buff, id: `${opts.id}-ba` }],
                },
                {
                    slot: 'charged',
                    abilities: [enemyDamage(400, `${opts.id}-c`), { ...buff, id: `${opts.id}-bc` }],
                },
            ],
        },
    };
};

// ─── Player focus (the REACTING ship) ───────────────────────────────────────────────────
// The focus is the heal target (id 'attacker') so its reactive shield/heal credits are
// observable via result.healing, and so the enemy roster is unlocked (runCombat requires
// healTargetId when enemyAttackers are present). Huge HP → it survives the whole run. Its own
// active is a tiny basic attack; the under-test reaction abilities ride the passive slot.
const buildFocusInput = (opts: {
    reactionAbilities: Ability[];
    enemies: EnemyAttacker[];
    numRounds: number;
    focusAttack?: number;
    focusSpeed?: number;
}): CombatEngineInput => ({
    attack: opts.focusAttack ?? 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: {
        slots: [
            { slot: 'active', abilities: [enemyDamage(10, 'p-a')] },
            { slot: 'passive', abilities: opts.reactionAbilities },
        ],
    },
    numRounds: opts.numRounds,
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
    // Focus FAST (acts before the enemies) so by the time an enemy charged-casts, the focus has a
    // last-turn ctx populated (effectiveAttack) for the reactive shield/damage fold.
    speed: opts.focusSpeed ?? 200,
    healTargetId: 'attacker',
    mode: 'healing',
    enemyAttackers: opts.enemies,
});

// Tap helpers.
const runTapStatus = (input: CombatEngineInput): StatusEngine => {
    let engine: StatusEngine | undefined;
    runCombat({ ...input, __testTapStatusEngine: (e) => (engine = e) });
    if (!engine) throw new Error('status engine not tapped');
    return engine;
};
const runTapEvents = (input: CombatEngineInput): CombatEvent[] => {
    const events: CombatEvent[] = [];
    const bus = createEventBus();
    bus.on('purge-performed', (e) => events.push(e));
    runCombat({ ...input, bus });
    return events;
};
const enemyBuffNames = (engine: StatusEngine, enemyId: string): string[] =>
    engine.timedAbilityStatuses('self', enemyId).map((b) => b.active.buffName);
const enemyDebuffNames = (engine: StatusEngine, enemyId: string): string[] =>
    engine.timedAbilityStatuses('enemy', undefined, enemyId).map((b) => b.active.buffName);
const totalShield = (r: ReturnType<typeof runCombat>): number =>
    (r.healing?.rounds ?? []).reduce(
        (sum, rd) => sum + (rd.perActor.get('attacker')?.shield ?? 0),
        0
    );
/**
 * The FOCUS's cumulative direct damage — the reactive 80% credit folds into directDamage.
 *
 * SP-4c-2a (B1): `buffingChargedEnemy` carries no `stats.hp`, so the targetable-HP floor
 * (normalizeRoster.ts) now raises it to MIN_TARGETABLE_MAX_HP and the run is positional — the
 * scalar `directDamage` credit is suppressed in favour of the per-victim map. Sum the per-victim
 * channel only (across every victim the focus dealt to that round) — NO scalar fallback. This
 * file's only enemy fixture is `buffingChargedEnemy`, so every run here is positional; a fallback
 * would be dead and would only mask a future regression (the deleted non-positional shape
 * returning) by silently reading a stale 0 instead of failing loudly. Matches the stricter,
 * fallback-free shape in `enemyTeamRouting.test.ts`'s `playerDealt`.
 */
const focusCumulativeDamage = (r: ReturnType<typeof runCombat>): number =>
    r.rounds.reduce((sum, rd) => {
        const perVictim = rd.perTargetDealt?.['attacker'];
        const dealt = perVictim ? Object.values(perVictim).reduce((s, v) => s + v, 0) : 0;
        return sum + dealt;
    }, 0);

// ─── 1. Curator purge-on-enemy-charged ──────────────────────────────────────────────────

describe('Curator purge-on-enemy-charged (engine integration)', () => {
    it('an enemy CHARGED cast → Curator purges a buff from THAT enemy; an active-only enemy is untouched', () => {
        // REACTION run: the enemy fires CHARGED on turn 1 (startCharged, chargeCount 1) — which also
        // self-buffs (Attack Up) — emitting skill-fired slot:'charged'. Curator (R0, purge 1) reacts,
        // routing the purge onto that enemy (counterTargetId) → its Attack Up is removed.
        const reactionEngine = runTapStatus(
            buildFocusInput({
                reactionAbilities: CURATOR_R0,
                enemies: [buffingChargedEnemy({ id: 'e1', startCharged: true, chargeCount: 1 })],
                numRounds: 1,
            })
        );
        expect(enemyBuffNames(reactionEngine, 'e1')).not.toContain('Attack Up'); // purged

        // CONTROL: SAME enemy but it NEVER charged-casts (startCharged false, chargeCount 99 → it
        // only ever fires its ACTIVE, which ALSO applies Attack Up). No charged cast → Curator does
        // NOT react → the enemy keeps its Attack Up. This is the gate-flip: the ONLY difference is
        // whether a charged cast occurred.
        const controlEngine = runTapStatus(
            buildFocusInput({
                reactionAbilities: CURATOR_R0,
                enemies: [buffingChargedEnemy({ id: 'e1', startCharged: false, chargeCount: 99 })],
                numRounds: 1,
            })
        );
        expect(enemyBuffNames(controlEngine, 'e1')).toContain('Attack Up'); // not purged
    });

    it('emits a purge-performed event (casterId=Curator focus, targetId=the casting enemy) only on a charged cast', () => {
        const reactionEvents = runTapEvents(
            buildFocusInput({
                reactionAbilities: CURATOR_R0,
                enemies: [buffingChargedEnemy({ id: 'e1', startCharged: true, chargeCount: 1 })],
                numRounds: 1,
            })
        );
        const purges = reactionEvents.filter((e) => e.type === 'purge-performed');
        expect(purges).toHaveLength(1);
        expect(purges[0].type === 'purge-performed' && purges[0].casterId).toBe('attacker');
        expect(purges[0].type === 'purge-performed' && purges[0].targetId).toBe('e1');

        // Control: no charged cast → no purge-performed at all.
        const controlEvents = runTapEvents(
            buildFocusInput({
                reactionAbilities: CURATOR_R0,
                enemies: [buffingChargedEnemy({ id: 'e1', startCharged: false, chargeCount: 99 })],
                numRounds: 1,
            })
        );
        expect(controlEvents.filter((e) => e.type === 'purge-performed')).toHaveLength(0);
    });
});

// ─── 2. Curator Block-Buff-on-enemy-charged (R4) + behavioral block ──────────────────────

describe('Curator R4 Block-Buff-on-enemy-charged (engine integration)', () => {
    it('R4 inflicts Block Buff on the casting enemy (present immediately after the round-1 charged cast)', () => {
        // R4 = purge 2 + inflict Block Buff (2 turns) on the casting enemy. The enemy charged-casts
        // on round 1 → Block Buff lands on it (in the enemy's per-target debuff store). Asserted at
        // numRounds 1 — the duration-2 Block Buff decrements at the enemy's post-turns and is fully
        // expired by the END of round 2, so its PRESENCE is read at round 1 (the behavioral block
        // below verifies it is still IN EFFECT during round 2).
        const r1Engine = runTapStatus(
            buildFocusInput({
                reactionAbilities: CURATOR_R4,
                enemies: [buffingChargedEnemy({ id: 'e1', startCharged: true, chargeCount: 1 })],
                numRounds: 1,
            })
        );
        expect(enemyDebuffNames(r1Engine, 'e1')).toContain('Block Buff');

        // CONTROL: Curator R0 (purge only, NO Block Buff) → no Block Buff on the enemy after round 1.
        const r1Control = runTapStatus(
            buildFocusInput({
                reactionAbilities: CURATOR_R0,
                enemies: [buffingChargedEnemy({ id: 'e1', startCharged: true, chargeCount: 1 })],
                numRounds: 1,
            })
        );
        expect(enemyDebuffNames(r1Control, 'e1')).not.toContain('Block Buff');
    });

    it('the Block Buff BEHAVIORALLY suppresses the casting enemy’s next self-buff (gate-flip vs R0)', () => {
        // Enemy: startCharged, chargeCount 1 → round-1 CHARGED cast (also self-buffs Attack Up, which
        // R4 purges), banks to 0. Round 2 (charges 0 < 1) → ACTIVE cast → it TRIES to re-apply Attack
        // Up. Under R4 it carries Block Buff (still in effect during round 2) → the firing-skill seam
        // (playerTurn.ts) silently drops the self-buff → after round 2 the enemy has NO Attack Up.
        const blocked = runTapStatus(
            buildFocusInput({
                reactionAbilities: CURATOR_R4,
                enemies: [buffingChargedEnemy({ id: 'e1', startCharged: true, chargeCount: 1 })],
                numRounds: 2,
            })
        );
        expect(enemyBuffNames(blocked, 'e1')).not.toContain('Attack Up'); // round-2 self-buff blocked

        // CONTROL: Curator R0 (purge only, NO Block Buff). The enemy charged-casts round 1 (Attack Up
        // purged), then round-2 ACTIVE RE-applies Attack Up — nothing suppresses it → Attack Up
        // present. The gate-flip: R4's Block Buff is the ONLY thing that suppresses the round-2 self-buff.
        const unblocked = runTapStatus(
            buildFocusInput({
                reactionAbilities: CURATOR_R0,
                enemies: [buffingChargedEnemy({ id: 'e1', startCharged: true, chargeCount: 1 })],
                numRounds: 2,
            })
        );
        expect(enemyBuffNames(unblocked, 'e1')).toContain('Attack Up'); // round-2 self-buff landed
    });
});

// ─── 3. FrontLine damage + shield-on-enemy-charged ───────────────────────────────────────

describe('FrontLine damage+shield-on-enemy-charged (engine integration)', () => {
    it('an enemy charged cast → FrontLine gains a NON-ZERO shield; absent without the charged cast', () => {
        const reaction = runCombat(
            buildFocusInput({
                reactionAbilities: FRONTLINE_R2,
                enemies: [buffingChargedEnemy({ id: 'e1', startCharged: true, chargeCount: 1 })],
                numRounds: 1,
            })
        );
        expect(totalShield(reaction)).toBeGreaterThan(0);

        // CONTROL: no charged cast (active-only enemy) → the reaction never fires → no shield.
        // (The auto-fill start-of-combat shield is FILTERED OUT — only the on-enemy-charged-cast
        // shield is present — so this control is a clean zero.)
        const control = runCombat(
            buildFocusInput({
                reactionAbilities: FRONTLINE_R2,
                enemies: [buffingChargedEnemy({ id: 'e1', startCharged: false, chargeCount: 99 })],
                numRounds: 1,
            })
        );
        expect(totalShield(control)).toBe(0);

        // FrontLine ALSO credits reactive DAMAGE (80%): the focus's cumulative direct damage is
        // strictly higher WITH the charged cast than the active-only control (whose focus only ever
        // deals its own 10% basic). The 80% reactive proc is the entire difference.
        expect(focusCumulativeDamage(reaction)).toBeGreaterThan(focusCumulativeDamage(control));
    });

    it('the shield magnitude tracks the ACTUAL dealt damage (shrinks under enemy defense; basis damage-dealt)', () => {
        // The reactive shield is 30% of FrontLine's OWN 80% reactive hit, which is defense-mitigated.
        // A high-defense charging enemy mitigates that hit → a SMALLER shield. The old flat
        // attack×24% model ignored the victim's defense entirely, so it would grant an EQUAL shield
        // in both runs — this assertion discriminates the fix from the old approximation.
        const lowDef = runCombat(
            buildFocusInput({
                reactionAbilities: FRONTLINE_R2,
                enemies: [buffingChargedEnemy({ id: 'e1', startCharged: true, chargeCount: 1 })],
                numRounds: 1,
            })
        );
        const highDef = runCombat(
            buildFocusInput({
                reactionAbilities: FRONTLINE_R2,
                enemies: [
                    {
                        ...buffingChargedEnemy({ id: 'e1', startCharged: true, chargeCount: 1 }),
                        stats: {
                            attack: 1000,
                            crit: 0,
                            critDamage: 0,
                            speed: 40,
                            defence: 100000,
                        },
                    },
                ],
                numRounds: 1,
            })
        );
        expect(totalShield(lowDef)).toBeGreaterThan(0);
        expect(totalShield(highDef)).toBeGreaterThan(0);
        // Dealt-amount basis: mitigation shrinks the shield. (Old attack-basis model → equal.)
        expect(totalShield(highDef)).toBeLessThan(totalShield(lowDef));
    });
});

// ─── 4. Once-per-round limiting ──────────────────────────────────────────────────────────

describe('FrontLine once-per-round limiting (engine integration)', () => {
    it('TWO enemies charged-cast in the SAME round → FrontLine shields only ONCE that round; reacts again next round', () => {
        // Two enemies BOTH seeded to charged-cast on round 1 (startCharged, chargeCount 1). The
        // FrontLine reaction is oncePerRound → only the FIRST enemy's charged cast credits a shield
        // in round 1. We compare the per-round shield grant of a TWO-charged-enemy run against a
        // ONE-charged-enemy run: round 1 shield must be EQUAL (the 2nd cast is gated out), not double.
        const twoEnemies = runCombat(
            buildFocusInput({
                reactionAbilities: FRONTLINE_R2,
                enemies: [
                    buffingChargedEnemy({
                        id: 'e1',
                        startCharged: true,
                        chargeCount: 1,
                        speed: 60,
                    }),
                    buffingChargedEnemy({
                        id: 'e2',
                        startCharged: true,
                        chargeCount: 1,
                        speed: 50,
                    }),
                ],
                numRounds: 1,
            })
        );
        const oneEnemy = runCombat(
            buildFocusInput({
                reactionAbilities: FRONTLINE_R2,
                enemies: [
                    buffingChargedEnemy({
                        id: 'e1',
                        startCharged: true,
                        chargeCount: 1,
                        speed: 60,
                    }),
                ],
                numRounds: 1,
            })
        );
        const round1ShieldTwo = twoEnemies.healing!.rounds[0].perActor.get('attacker')?.shield ?? 0;
        const round1ShieldOne = oneEnemy.healing!.rounds[0].perActor.get('attacker')?.shield ?? 0;
        expect(round1ShieldOne).toBeGreaterThan(0);
        // oncePerRound: the 2nd same-round charged cast does NOT add a second shield grant.
        expect(round1ShieldTwo).toBe(round1ShieldOne);

        // CONTROL proving the gate is per-ROUND (not per-combat): across TWO rounds with a single
        // enemy that charged-casts EACH round (chargeCount 1 → round 1 charged, then it re-banks +1
        // each turn so it charged-casts again on alternating rounds), FrontLine shields on more than
        // one round → the once-per-round gate RESETS each round.
        const twoRounds = runCombat(
            buildFocusInput({
                reactionAbilities: FRONTLINE_R2,
                enemies: [buffingChargedEnemy({ id: 'e1', startCharged: true, chargeCount: 1 })],
                numRounds: 3,
            })
        );
        const shieldRounds = (twoRounds.healing?.rounds ?? []).filter(
            (rd) => (rd.perActor.get('attacker')?.shield ?? 0) > 0
        ).length;
        expect(shieldRounds).toBeGreaterThan(1); // reacted on more than one round → gate resets per round
    });
});
