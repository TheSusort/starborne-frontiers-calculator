/**
 * PR-G — combat-integration tests for Howler's on-ally-crit cleanse + Blast grant.
 *
 * Howler (2nd/refit passive, docs/ship-skills.csv verbatim): "This Unit cleanses 1 debuff from
 * an ally and grants them 1 stack of Blast when that ally crits an enemy." — the cleanse AND the
 * Blast grant both ride the on-ally-crit reactive trigger, routed to the CRIT-ING ally via
 * eventCtx.damagedAllyId (the same routing lane on-ally-debuffed/on-ally-purged already use).
 *
 * Both owner abilities are extracted through the REAL production path (`buildShipAbilities`) fed
 * verbatim skill text from `docs/ship-skills.csv` — never a hand-built ability array.
 *
 * Non-vacuity: reverting the PR-G src changes (skillTextParser.ts's broadened ALLY_CRIT_HIT_RE,
 * buildShipAbilities.ts's cleanse builder detectAllyCritTrigger wiring, and triggers.ts's
 * damagedAllyId stamp on the on-ally-crit listener) turns every "fires"/"lands on the crit-er"
 * assertion in this file red (verified manually — see the PR-G report for the revert/restore
 * transcript).
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { Ship } from '../../../types/ship';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { StatusEngine } from '../statusEngine';
import { dealtEntries } from '../__testutils__/perTargetDealt';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

function ship(over: Partial<Ship>): Ship {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { ...({} as any), refits: [{}, {}], ...over } as Ship;
}

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const allPattern = (): ParsedPattern => ({ raw: 'all', shape: 'all', range: 'all', modifiers: {} });
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const hit = (): Ability => ({
    id: 'hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

// =============================================================================
// Howler — "This Unit cleanses 1 debuff from an ally and grants them 1 stack of Blast when
// that ally crits an enemy." (docs/ship-skills.csv, verbatim refit-active 2nd passive).
// =============================================================================

const HOWLER_P2 =
    'This Unit <unit-aid>cleanses 1</unit-aid> debuff from an ally when that ally crits an enemy.';
const HOWLER_P3_REFIT =
    'This Unit <unit-aid>cleanses 1</unit-aid> debuff from an ally and grants them 1 stack of <unit-skill>Blast</unit-skill> when that ally crits an enemy.';

/** Extracts Howler's ally-crit reactive abilities through the REAL parser/builder. */
function howlerAllyCritAbilities(): Ability[] {
    return (
        buildShipAbilities(
            ship({ firstPassiveSkillText: HOWLER_P2, secondPassiveSkillText: HOWLER_P3_REFIT })
        ).slots.find((s) => s.slot === 'passive')?.abilities ?? []
    );
}

function howlerCleanse(): Ability {
    const c = howlerAllyCritAbilities().find((a) => a.type === 'cleanse');
    if (!c) throw new Error('mutation guard: Howler on-ally-crit cleanse not found');
    return c;
}

function howlerBlastGrant(): Ability {
    const b = howlerAllyCritAbilities().find((a) => a.type === 'buff');
    if (!b) throw new Error('mutation guard: Howler on-ally-crit Blast grant not found');
    return b;
}

describe('Howler ally-crit abilities — extracted shape (mutation guard)', () => {
    it('cleanse rides on-ally-crit, targeting the ally', () => {
        const c = howlerCleanse();
        expect(c.trigger).toBe('on-ally-crit');
        expect(c.target).toBe('ally');
        expect(c.config).toMatchObject({ type: 'cleanse', count: 1 });
    });

    it('Blast grant rides on-ally-crit, targeting the ally', () => {
        const b = howlerBlastGrant();
        expect(b.trigger).toBe('on-ally-crit');
        expect(b.target).toBe('ally');
        expect(b.config).toMatchObject({ type: 'buff', buffName: 'Blast' });
    });
});

// =============================================================================
// Engine integration — a positional 3-actor same-side roster (a crit-ing ally, a non-critting
// ally, and Howler itself) all take an AoE debuff from an opposing all-enemies debuffer. Only the
// CRIT-ING ally's debuff should be cleansed and only it should receive Blast — proven against a
// DELIBERATELY WRONG fallback (healTargetId points at the non-critting ally) so a false-positive
// "it just landed on the heal-target fallback" can't slip through.
// =============================================================================

const noopActive = (): Ability => ({
    id: 'noop',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
});

const howlerObserver = (position: Position): TeamActorEngineInput => ({
    id: 'howler',
    speed: 1, // acts last — the crit + debuffs must already have happened
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    walk: {
        shipSkills: {
            slots: [
                { slot: 'active', abilities: [noopActive()] },
                { slot: 'passive', abilities: [howlerCleanse(), howlerBlastGrant()] },
            ],
        },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: 20_000,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

/** A same-side ally that crits (or not) an enemy on its own turn. */
const critAlly = (id: string, position: Position, critPct: number): TeamActorEngineInput => ({
    id,
    speed: 300,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    walk: {
        shipSkills: { slots: [{ slot: 'active', abilities: [hit()] }] },
        stats: {
            attack: 1000,
            crit: critPct,
            critDamage: 100,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: 20_000,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

/** An opposing AoE debuffer: an 'all-enemies'-target Def Down that lands on EVERY same-side
 *  actor on the other team (the focus + every positioned team actor). */
const debuffAoE = (id: string, position: Position): EnemyAttacker => ({
    id,
    stats: { attack: 1, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1000 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parsedTarget('front'),
    pattern: allPattern(),
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'aoe-debuff',
                        type: 'debuff',
                        target: 'all-enemies',
                        trigger: 'on-cast',
                        conditions: [],
                        config: {
                            type: 'debuff',
                            buffName: 'Def Down',
                            parsedEffects: {},
                            stacks: 1,
                            isStackable: false,
                            application: 'apply',
                            duration: 5,
                        },
                    },
                ],
            },
        ],
    },
});

function runAndCollect(input: CombatEngineInput) {
    const bus = createEventBus();
    const debuffsApplied: Extract<CombatEvent, { type: 'debuff-applied' }>[] = [];
    const buffsApplied: Extract<CombatEvent, { type: 'buff-applied' }>[] = [];
    bus.on('debuff-applied', (e) => debuffsApplied.push(e));
    bus.on('buff-applied', (e) => buffsApplied.push(e));
    let engine: StatusEngine | undefined;
    const result = runCombat({
        ...input,
        bus,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
    });
    return { result, debuffsApplied, buffsApplied, engine: engine! };
}

describe('Howler (player-side) — cleanse + Blast land on the crit-ing ally, not the heal-target fallback', () => {
    // 'attacker' (the crit-100 focus) crits; 'ally-b' (crit 0) never crits. healTargetId is
    // DELIBERATELY 'ally-b' — if the cleanse/buff ever fell back to the heal target instead of
    // reading eventCtx.damagedAllyId, this setup would catch it landing on the WRONG actor.
    const BASE = (): CombatEngineInput => ({
        attack: 1000,
        crit: 100,
        critDamage: 100,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [{ slot: 'active', abilities: [hit()] }] },
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
        speed: 500,
        healTargetId: 'ally-b', // deliberately the NON-critting ally (the fallback trap)
        mode: 'healing',
        position: 'M1',
        target: parsedTarget('front'),
        pattern: basePattern(),
        teamActors: [howlerObserver('M3'), critAlly('ally-b', 'M2', 0)],
        enemyAttackers: [debuffAoE('enemy-deb', 'M4')],
    });

    it('the crit-ing ally (attacker) is cleansed; the non-critting ally (ally-b, the fallback) keeps its debuff', () => {
        const { engine } = runAndCollect(BASE());
        expect(
            engine
                .timedAbilityStatuses('enemy', undefined, 'attacker')
                .map((s) => s.active.buffName)
        ).toEqual([]);
        expect(
            engine.timedAbilityStatuses('enemy', undefined, 'ally-b').map((s) => s.active.buffName)
        ).toEqual(['Def Down']);
    });

    it('Blast lands ONLY on the crit-ing ally (attacker), never on ally-b or Howler itself', () => {
        const { buffsApplied } = runAndCollect(BASE());
        const blast = buffsApplied.filter((b) => b.buffName === 'Blast');
        expect(blast).toHaveLength(1);
        expect(blast[0].actorId).toBe('attacker');
    });

    it('no ally crits (crit 0 everywhere) → the cleanse never fires', () => {
        const noCritInput: CombatEngineInput = {
            ...BASE(),
            crit: 0,
            teamActors: [howlerObserver('M3'), critAlly('ally-b', 'M2', 0)],
        };
        const { result, buffsApplied } = runAndCollect(noCritInput);
        expect(
            (result.healing?.rounds ?? []).reduce(
                (sum, rd) => sum + (rd.perActor.get('howler')?.cleanseCount ?? 0),
                0
            )
        ).toBe(0);
        expect(buffsApplied.some((b) => b.buffName === 'Blast')).toBe(false);
    });
});

describe('Howler (enemy-side) — team symmetry: an enemy Howler reacts to its OWN crit-ing ally', () => {
    it('cleanses the crit-ing ENEMY ally and grants it Blast, never touching a player-side actor', () => {
        const enemyHowler: EnemyAttacker = {
            id: 'enemy-howler',
            stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
            chargeCount: 0,
            startCharged: false,
            position: 'M3',
            target: parsedTarget('front'),
            pattern: basePattern(),
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [noopActive()] },
                    { slot: 'passive', abilities: [howlerCleanse(), howlerBlastGrant()] },
                ],
            },
        };

        const enemyCritAlly: EnemyAttacker = {
            id: 'enemy-critter',
            stats: {
                attack: 1000,
                crit: 100,
                critDamage: 100,
                defence: 0,
                hp: 1_000_000_000,
                speed: 300,
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M2',
            target: parsedTarget('front'),
            pattern: basePattern(),
            shipSkills: { slots: [{ slot: 'active', abilities: [hit()] }] },
        };

        // A player-side AoE debuffer whose 'all-enemies' target reaches every enemy-side actor
        // (the mirror of debuffAoE above, cast from the other direction).
        const playerDebuffSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        {
                            id: 'aoe-debuff',
                            type: 'debuff',
                            target: 'all-enemies',
                            trigger: 'on-cast',
                            conditions: [],
                            config: {
                                type: 'debuff',
                                buffName: 'Def Down',
                                parsedEffects: {},
                                stacks: 1,
                                isStackable: false,
                                application: 'apply',
                                duration: 5,
                            },
                        },
                    ],
                },
            ],
        };

        const playerAlly: TeamActorEngineInput = {
            id: 'player-ally',
            speed: 1,
            chargeCount: 0,
            startCharged: false,
            selfBuffs: [],
            enemyDebuffs: [],
            position: 'M2',
            target: parsedTarget('front'),
            pattern: basePattern(),
            walk: {
                shipSkills: { slots: [{ slot: 'active', abilities: [noopActive()] }] },
                stats: {
                    attack: 0,
                    crit: 0,
                    critDamage: 0,
                    defensePenetration: 0,
                    hacking: 0,
                    defence: 0,
                    hp: 20_000,
                },
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                hasChargedSkill: false,
            },
        };

        const input: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: playerDebuffSkills,
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
            speed: 1000, // the player debuffs first, waking the enemy reactives the same round
            healTargetId: 'attacker',
            mode: 'healing',
            position: 'M1',
            target: parsedTarget('front'),
            pattern: allPattern(),
            teamActors: [playerAlly],
            enemyAttackers: [enemyHowler, enemyCritAlly],
        };

        const { engine, buffsApplied } = runAndCollect(input);
        // The crit-ing enemy ally is cleansed …
        expect(
            engine
                .timedAbilityStatuses('enemy', undefined, 'enemy-critter')
                .map((s) => s.active.buffName)
        ).toEqual([]);
        // … and receives Blast — EXACTLY one grant, and it is NOT the player-side ally: an enemy
        // Howler's reaction never crosses the side boundary onto a player-side actor.
        const blast = buffsApplied.filter((b) => b.buffName === 'Blast');
        expect(blast).toHaveLength(1);
        expect(blast[0].actorId).toBe('enemy-critter');
    });
});

// =============================================================================
// Sentinel (#2 reaction-only-on-turn fix) — a reaction-only unit whose passive damage AND heal
// fire ONLY "when an ally critically hits an enemy". Both must ride on-ally-crit: the damage
// lands on the CRIT-VICTIM enemy ("that enemy"), the heal on the CRIT-ING ally ("the ally").
// On Sentinel's OWN turn nothing should fire (the reported leak was an on-turn heal).
//
//   R0 (unrefit):   "…this Unit deals 40% damage to that enemy. This attack cannot crit."
//   R2 (refit-active): "…repairs the ally for 5% of Max HP AND deals 60% damage to that enemy…"
// (docs/ship-skills.csv, verbatim.)
// =============================================================================

const SENTINEL_R0 =
    'When an ally critically hits an enemy, this Unit deals <unit-damage>40% damage</unit-damage> to that enemy.<br />This attack cannot critically hit.';
const SENTINEL_R2 =
    "When an ally critically hits an enemy, this Unit <unit-damage>repairs the ally for 5%</unit-damage> of this Unit's Max HP and deals <unit-damage>60% damage</unit-damage> to that enemy.<br />This attack cannot critically hit.";

/** Sentinel's refit-resolved passive abilities through the REAL parser/builder. */
function sentinelPassiveAbilities(refits: number): Ability[] {
    return (
        buildShipAbilities(
            ship({
                refits: Array.from({ length: refits }, () => ({})) as Ship['refits'],
                firstPassiveSkillText: SENTINEL_R0,
                secondPassiveSkillText: SENTINEL_R2,
            })
        ).slots.find((s) => s.slot === 'passive')?.abilities ?? []
    );
}

describe('Sentinel ally-crit abilities — extracted shape (mutation guard)', () => {
    it('R0 passive damage rides on-ally-crit, targeting the enemy, cannot crit', () => {
        const dmg = sentinelPassiveAbilities(0).find((a) => a.type === 'damage');
        if (!dmg) throw new Error('mutation guard: Sentinel R0 on-ally-crit damage not found');
        expect(dmg.trigger).toBe('on-ally-crit');
        expect(dmg.target).toBe('enemy');
        expect(dmg.config).toMatchObject({ type: 'damage', multiplier: 40, noCrit: true });
    });

    it('R2 passive heal rides on-ally-crit, targeting the ally', () => {
        const heal = sentinelPassiveAbilities(2).find((a) => a.type === 'heal');
        if (!heal) throw new Error('mutation guard: Sentinel R2 on-ally-crit heal not found');
        expect(heal.trigger).toBe('on-ally-crit');
        expect(heal.target).toBe('ally');
        expect(heal.config).toMatchObject({ type: 'heal', pct: 5 });
    });

    it('R2 passive damage rides on-ally-crit, targeting the enemy, cannot crit', () => {
        const dmg = sentinelPassiveAbilities(2).find((a) => a.type === 'damage');
        if (!dmg) throw new Error('mutation guard: Sentinel R2 on-ally-crit damage not found');
        expect(dmg.trigger).toBe('on-ally-crit');
        expect(dmg.target).toBe('enemy');
        expect(dmg.config).toMatchObject({ type: 'damage', multiplier: 60, noCrit: true });
    });
});

/** A Sentinel observer (team actor): R2 passive (heal + damage), real attack/HP so its reactive
 *  damage credits and its 5%-Max-HP repair is non-zero. Acts LAST so ally crits precede it. */
const sentinelObserver = (position: Position): TeamActorEngineInput => ({
    id: 'sentinel',
    speed: 1,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parsedTarget('front'),
    pattern: basePattern(),
    walk: {
        shipSkills: {
            slots: [
                { slot: 'active', abilities: [noopActive()] },
                { slot: 'passive', abilities: sentinelPassiveAbilities(2) },
            ],
        },
        stats: {
            attack: 1000,
            crit: 0,
            critDamage: 100,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: 20_000,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

function runSentinel(input: CombatEngineInput) {
    const bus = createEventBus();
    const credits: { sourceId: string; amount: number }[] = [];
    const reactiveDamage: Extract<CombatEvent, { type: 'reactive-damage-performed' }>[] = [];
    const reactiveHeals: Extract<CombatEvent, { type: 'reactive-heal-performed' }>[] = [];
    bus.on('reactive-damage-performed', (e) => reactiveDamage.push(e));
    bus.on('reactive-heal-performed', (e) => reactiveHeals.push(e));
    const result = runCombat({
        ...input,
        bus,
        __testTapCreditDamage: (sourceId, _channel, amount) => credits.push({ sourceId, amount }),
    });
    // Against a real, positioned opposing roster a reactive proc reduces the victim's real HP and
    // books its intake per-victim (creditDealt → RoundData.perTargetDealt) instead of onto the
    // credit-only `credits` channel above — see engine.ts's applyReactiveDamage gate. Both are
    // returned so each assertion can name the channel it means.
    return {
        result,
        credits,
        dealt: dealtEntries(result.rounds),
        reactiveDamage,
        reactiveHeals,
    };
}

/** Total reactive repair the healing accounting credited to `ownerId` across all rounds. A
 *  reactive heal credits `directHeal` to its OWNER (it emits no heal-performed — chain guard),
 *  so this is the observable for "Sentinel's on-ally-crit repair fired". */
const totalDirectHeal = (result: ReturnType<typeof runCombat>, ownerId: string): number =>
    (result.healing?.rounds ?? []).reduce(
        (sum, rd) => sum + (rd.perActor.get(ownerId)?.directHeal ?? 0),
        0
    );

describe('Sentinel (player-side) — reactive heal + damage fire on ally crit, never on its own turn', () => {
    // Focus 'attacker' (crit 100) crits every hit; 'ally-b' (crit 0) never crits. healTargetId is
    // DELIBERATELY 'ally-b' (the fallback trap) — if the heal ever fell back to the on-cast heal
    // target instead of the crit-ing ally, this catches it landing on the WRONG actor.
    const BASE = (): CombatEngineInput => ({
        attack: 1000,
        crit: 100,
        critDamage: 100,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [{ slot: 'active', abilities: [hit()] }] },
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
        speed: 500,
        healTargetId: 'ally-b', // deliberately the NON-critting ally (the fallback trap)
        mode: 'healing',
        position: 'M1',
        target: parsedTarget('front'),
        pattern: basePattern(),
        teamActors: [sentinelObserver('M3'), critAlly('ally-b', 'M2', 0)],
        enemyAttackers: [debuffAoE('enemy-x', 'M4')],
    });

    it('fires its repair reactively when an ally crits (directHeal credited to Sentinel)', () => {
        const { result } = runSentinel(BASE());
        expect(totalDirectHeal(result, 'sentinel')).toBeGreaterThan(0);
    });

    it('deals reactive damage (credited to Sentinel) when an ally crits', () => {
        const { credits, dealt } = runSentinel(BASE());
        // Booked against the real positioned enemy, attributed to Sentinel — not on the credit-only
        // channel, which stays empty for it (the two are mutually exclusive per proc).
        expect(dealt.some((d) => d.sourceId === 'sentinel' && d.amount > 0)).toBe(true);
        expect(credits.some((c) => c.sourceId === 'sentinel' && c.amount > 0)).toBe(false);
    });

    it('emits log-only reactive damage + heal events, stamped to the crit-ing ally turn', () => {
        const { reactiveDamage, reactiveHeals } = runSentinel(BASE());
        // Reactive DAMAGE surfaced for the log: owner=sentinel, amount>0, nested under the
        // crit-ing ally's turn (duringTurnOf === 'attacker'). NEVER re-emits ability-performed.
        const dmg = reactiveDamage.filter((e) => e.sourceId === 'sentinel');
        expect(dmg.length).toBeGreaterThan(0);
        expect(dmg.every((e) => e.amount > 0 && e.duringTurnOf === 'attacker')).toBe(true);
        // Reactive HEAL surfaced for the log: caster=sentinel, same stamp, and the repair lands
        // on the CRIT-ing ally (attacker) — NOT the healTargetId fallback (ally-b). This proves
        // the damagedAllyId routing via the perTarget recipient, catching the wrong-target trap.
        const heal = reactiveHeals.filter((e) => e.casterId === 'sentinel');
        expect(heal.length).toBeGreaterThan(0);
        expect(heal.every((e) => e.duringTurnOf === 'attacker')).toBe(true);
        const healRecipients = heal.flatMap((e) => e.perTarget.map((t) => t.targetId));
        expect(healRecipients).toContain('attacker');
        expect(healRecipients).not.toContain('ally-b');
    });

    it('does NOT heal or deal damage on its own turn when no ally crits (the on-turn leak)', () => {
        const noCrit: CombatEngineInput = {
            ...BASE(),
            crit: 0,
            teamActors: [sentinelObserver('M3'), critAlly('ally-b', 'M2', 0)],
        };
        const { result, credits, dealt } = runSentinel(noCrit);
        expect(totalDirectHeal(result, 'sentinel')).toBe(0);
        // Neither channel — the leak would show up on the per-victim one now that a positioned proc
        // books there, so asserting only the credit-only channel would be vacuous.
        expect(dealt.some((d) => d.sourceId === 'sentinel' && d.amount > 0)).toBe(false);
        expect(credits.some((c) => c.sourceId === 'sentinel' && c.amount > 0)).toBe(false);
    });
});

describe('Sentinel (enemy-side) — team symmetry: an enemy Sentinel reacts to its OWN crit-ing ally', () => {
    it('heals the crit-ing ENEMY ally and credits reactive damage, never touching a player actor', () => {
        const enemySentinel: EnemyAttacker = {
            id: 'enemy-sentinel',
            stats: { attack: 1000, crit: 0, critDamage: 100, defence: 0, hp: 20_000, speed: 1 },
            chargeCount: 0,
            startCharged: false,
            position: 'M3',
            target: parsedTarget('front'),
            pattern: basePattern(),
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [noopActive()] },
                    { slot: 'passive', abilities: sentinelPassiveAbilities(2) },
                ],
            },
        };

        const enemyCritAlly: EnemyAttacker = {
            id: 'enemy-critter',
            stats: {
                attack: 1000,
                crit: 100,
                critDamage: 100,
                defence: 0,
                hp: 1_000_000_000,
                speed: 300,
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M2',
            target: parsedTarget('front'),
            pattern: basePattern(),
            shipSkills: { slots: [{ slot: 'active', abilities: [hit()] }] },
        };

        const input: CombatEngineInput = {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 0,
            shipSkills: { slots: [{ slot: 'active', abilities: [noopActive()] }] },
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
            speed: 1000,
            healTargetId: 'attacker',
            mode: 'healing',
            position: 'M1',
            target: parsedTarget('front'),
            pattern: basePattern(),
            teamActors: [],
            enemyAttackers: [enemySentinel, enemyCritAlly],
        };

        const { result, credits, dealt, reactiveHeals } = runSentinel(input);
        // The enemy Sentinel's repair fires (directHeal credited) and its reactive damage books
        // per-victim — both keyed to the ENEMY owner, never a player-side actor. Same channel as the
        // player-side case above, which is the team-symmetry claim.
        expect(totalDirectHeal(result, 'enemy-sentinel')).toBeGreaterThan(0);
        expect(dealt.some((d) => d.sourceId === 'enemy-sentinel' && d.amount > 0)).toBe(true);
        expect(credits.some((c) => c.sourceId === 'enemy-sentinel' && c.amount > 0)).toBe(false);
        // Team symmetry at the recipient level: the reactive repair lands on the crit-ing ENEMY
        // ally (enemy-critter), never crossing onto a player-side actor.
        const heal = reactiveHeals.filter((e) => e.casterId === 'enemy-sentinel');
        expect(heal.length).toBeGreaterThan(0);
        const healRecipients = heal.flatMap((e) => e.perTarget.map((t) => t.targetId));
        expect(healRecipients).toContain('enemy-critter');
        expect(healRecipients).not.toContain('attacker');
    });
});
