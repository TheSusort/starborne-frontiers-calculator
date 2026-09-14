/**
 * shieldGatedStasisExemption.integration.test.ts — Zenith's §4.5 exemption is GATED, and the gate
 * is answered against the attacker's LIVE shield pool.
 *
 * Zenith's refit-active passive reads "When this Unit has a shield its attacks do not reduce
 * Stasis". That is Akula/Tygr's mechanic (the struck enemy keeps its Stasis with its full remaining
 * duration) behind a condition, so it cannot ride `doesntBreakStasis` — a static boolean would
 * exempt Zenith on a board where it holds no shield at all.
 *
 * THE PER-HIT AXIS. On a positional cast the gate is answered once per (hit × victim), AT IMPACT,
 * for the anchor and the covered footprint alike: both marks are made at `onVictimPreImpact`,
 * which runs once per SUB-ATTACK per victim, before that victim's own hit resolves. The fixture
 * below turns that into an observable twice over. For the covered victim, the anchor wears Reflect
 * thorns sized so ONE sub-attack's bounce-back leaves the attacker's pool alive and TWO drain it,
 * and the cast breaks the covered victim's Stasis at `hits: 2` and not at `hits: 1`. For the
 * anchor, thorns three times that size empty the pool in a single bounce, and the anchor's own
 * Stasis then breaks at `hits: 2` and not at `hits: 1`. In each pair the ONLY difference between
 * the two runs is the hit count, so the exemption demonstrably lapses PART-WAY THROUGH one cast.
 *
 * THE AT-IMPACT DISCRIMINATOR. Reading the gate before impact also means a victim's OWN thorns
 * can never un-exempt the hit that triggered them: the pool is read as it stood when the hit
 * landed, not after that hit's own reflect bounce drained it. `coveredReflectPct` gives the
 * covered victim its own thorns sized to empty the pool in a single bounce, proving that case;
 * the `hits: 1` half of the anchor pair proves it on the anchor side.
 *
 * HARNESS. Board layout, stasis-bot/culler staging and the reduce-by-one observation model are
 * lifted from `perFootprintStasisBreak.integration.test.ts` — read its header for the grid
 * reasoning. Stasis(6) over 4 rounds: a victim whose Stasis is broken every round it is hit resumes
 * acting inside the run; a victim never broken never acts.
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
    id: `sgs${++idc}`,
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
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
    ],
});

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

/** The shape `buildShipAbilities` gives Zenith's gate — see `buildShipAbilities.test.ts`. */
const SELF_SHIELD_GATE: Ability['conditions'] = [{ subject: 'self-shield', derivable: true }];

// Stasis(6) over 4 rounds: the natural post-turn decrement alone can never free a victim inside
// the run, so ANY round in which a victim acts is a round its Stasis was broken by a hit.
const STASIS_LONG = 6;
const ROUNDS = 4;

// The attacker's kit: an N-hit AoE active plus Zenith's round-start self shield (50% of attack).
// ATTACK 200 ⇒ a 100-point pool each round; the anchor's 1% thorns off a 5_000-point hit bounce
// back ~50, so one sub-attack leaves the pool alive and two drain it.
const ATTACK = 200;
const attackerKit = (hits: number): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                ab({
                    type: 'damage',
                    target: 'enemy',
                    config: { type: 'damage', multiplier: 2_500, hits },
                }),
            ],
        },
        {
            slot: 'passive',
            abilities: [
                ab({
                    type: 'shield',
                    target: 'self',
                    trigger: 'start-of-round',
                    config: { type: 'shield', pct: 50, basis: 'attack' },
                }),
            ],
        },
    ],
});

const playerStasisBot = (id: string, position: Position, sel: Selection): TeamActorEngineInput => ({
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
});

/** A high-HP enemy victim with a basicAttack so it CAN emit ability-performed once freed.
 *  `reflectPct` is the mid-cast shield-strip vector: thorns resolve INSIDE applyVictimDamage,
 *  i.e. inside the positional hit loop. Reflect is not anchor-gated (`damage-reflection` here
 *  never sets `requirePrimaryTarget`), so any victim given this can bounce damage back. */
const enemyVictim = (id: string, position: Position, reflectPct?: number): EnemyAttacker => ({
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
    shipSkills: {
        slots: [
            basicAttack(),
            ...(reflectPct === undefined
                ? []
                : [
                      {
                          slot: 'passive' as const,
                          abilities: [
                              // The engine keys on `config.type`, not the placeholder top-level
                              // type — same shape as `hitMitigation.integration.test.ts`.
                              ab({
                                  type: 'modifier',
                                  target: 'self',
                                  config: { type: 'damage-reflection', pct: reflectPct },
                              }),
                          ],
                      },
                  ]),
        ],
    },
});

const enemyCuller = (): EnemyAttacker => ({
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
});

interface Arm {
    hits: number;
    /** Thorns % on the ANCHOR victim. 0 ⇒ nothing drains the attacker's pool mid-cast. */
    reflectPct: number;
    /** Thorns % on the COVERED victim. 0/omitted ⇒ the covered victim carries no thorns of its
     *  own, so only the anchor's bounce (if any) can drain the pool before it is hit. */
    coveredReflectPct?: number;
    /** Omit the gate to get an attacker with no exemption at all (the break-fires control). */
    gated?: boolean;
}

const input = ({
    hits,
    reflectPct,
    coveredReflectPct = 0,
    gated = true,
}: Arm): CombatEngineInput => ({
    attack: ATTACK,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: attackerKit(hits),
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
    ...(gated ? { stasisBreakExemptWhen: SELF_SHIELD_GATE } : {}),
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M1',
    speed: 100,
    target: parsedTarget('front'),
    pattern: lineRange1Pattern(),
    teamActors: [playerStasisBot('pbot-f', 'M4', 'front'), playerStasisBot('pbot-b', 'M3', 'back')],
    enemyAttackers: [
        enemyVictim('enemy-anchor', 'M4', reflectPct > 0 ? reflectPct : undefined),
        enemyVictim('enemy-covered', 'M3', coveredReflectPct > 0 ? coveredReflectPct : undefined),
        enemyCuller(),
    ],
});

interface Run {
    anchorFired: number[];
    coveredFired: number[];
    /** The attacker's shield pool at the END of each round. */
    attackerPool: number[];
}

const run = (arm: Arm): Run => {
    const bus = createEventBus();
    const performed: Extract<CombatEvent, { type: 'ability-performed' }>[] = [];
    bus.on('ability-performed', (e) => performed.push(e));
    const result = runCombat({ ...input(arm), bus });
    const rounds = (id: string): number[] =>
        performed.filter((e) => e.actorId === id).map((e) => e.round);
    return {
        anchorFired: rounds('enemy-anchor'),
        coveredFired: rounds('enemy-covered'),
        attackerPool: result.rounds.map((r) => r.perActorShield?.attacker?.pool ?? 0),
    };
};

describe('shield-gated Stasis exemption — the gate is read, not assumed', () => {
    it('(activation) a shielded gated attacker breaks NOTHING: anchor and covered stay stasised', () => {
        const r = run({ hits: 1, reflectPct: 0 });
        expect(r.anchorFired).toHaveLength(0);
        expect(r.coveredFired).toHaveLength(0);
    });

    it('(control) the SAME attacker without the gate breaks both — the fixture can go red', () => {
        // Byte-identical fixture; the ONLY difference is that `stasisBreakExemptWhen` is absent.
        const r = run({ hits: 1, reflectPct: 0, gated: false });
        expect(r.anchorFired.length).toBeGreaterThan(0);
        expect(r.coveredFired.length).toBeGreaterThan(0);
    });
});

describe('shield-gated Stasis exemption — answered per HIT inside one cast', () => {
    // A 2x2 over {hit count} x {thorns}: neither alone breaks the covered victim, and the
    // combination does. So the break is caused by the pool running out PART-WAY THROUGH the cast,
    // not by the extra hit and not by the thorns.
    it('hits:1 + thorns — one bounce leaves the pool alive, so the covered victim stays exempt', () => {
        expect(run({ hits: 1, reflectPct: 1 }).coveredFired).toHaveLength(0);
    });

    it('hits:2, NO thorns — nothing drains the pool mid-cast, so a second hit changes nothing', () => {
        expect(run({ hits: 2, reflectPct: 0 }).coveredFired).toHaveLength(0);
    });

    it('hits:2 + thorns — the first hit drains the pool, so the SECOND hit breaks the covered victim', () => {
        const r = run({ hits: 2, reflectPct: 1 });
        expect(r.coveredFired.length).toBeGreaterThan(0);
        // The pool really was emptied inside the cast. It is re-granted at every round start
        // (`granted` is 100 in every round of every arm), so a zero at round 1's end is a
        // mid-cast drain, not next round's carryover.
        expect(r.attackerPool[0]).toBe(0);
        // The anchor is shielded at BOTH impacts here — the pool is 100 at the first and 50 at
        // the second, because one bounce does not empty it. It stays exempt for the right reason:
        // every hit that landed on it connected while the pool was up.
        expect(r.anchorFired).toHaveLength(0);
    });

    // AT IMPACT: the covered victim's own thorns empty the pool as a consequence of the very
    // hit that landed on it. That hit connected while the pool was still up, so it does NOT
    // break that victim's Stasis — a hit is never un-exempted by damage it caused itself.
    // Reading the gate after the victim resolved sees the drained pool and breaks it.
    it('a victim whose OWN thorns drain the pool is still exempt for that hit', () => {
        const r = run({ hits: 1, reflectPct: 0, coveredReflectPct: 10 });
        expect(r.coveredFired).toHaveLength(0);
        // The bounce really did empty the pool — otherwise the arm asserts nothing.
        expect(r.attackerPool[0]).toBe(0);
    });

    // THE LIFT: thorns big enough to empty the pool in ONE bounce. Sub-attack 0's anchor hit
    // connects with the pool full (exempt) and empties it; sub-attack 1's anchor hit connects
    // with the pool at zero, so THAT hit breaks the anchor's Stasis. The `hits: 2 + thorns` arm
    // two above cannot show this — its thorns survive one bounce, so its anchor is shielded at
    // both impacts.
    it('hits:2 + draining thorns — the SECOND hit breaks the ANCHOR', () => {
        const r = run({ hits: 2, reflectPct: 3 });
        expect(r.anchorFired.length).toBeGreaterThan(0);
        expect(r.attackerPool[0]).toBe(0);
    });

    // Its partner, and the reason the arm above is not just "more hits break more things":
    // the SAME draining thorns over ONE hit leave the anchor exempt, because the only hit that
    // landed on it connected while the pool was up. The pair is a two-point measurement — hit
    // count is the only variable, and it moves the answer.
    it('hits:1 + draining thorns — the anchor stays exempt, its own bounce does not count', () => {
        const r = run({ hits: 1, reflectPct: 3 });
        expect(r.anchorFired).toHaveLength(0);
        expect(r.attackerPool[0]).toBe(0);
    });
});

// ---------------------------------------------------------------------------------------------
// TEAM SYMMETRY — the same gate on an ENEMY-side carrier (enemy cast site).
//
// Mirror of the player fixture with the sides flipped, lifted from
// `perFootprintStasisBreak.integration.test.ts`'s section (3). The enemy breaker's pool comes
// from `preFight.startingShieldPctOfHp` and, by default, nothing on the board damages it, so the
// pool is a clean single axis: >0 ⇒ exempt, 0 ⇒ breaks. `playerVictim`'s optional `reflectPct`
// adds a drain vector for the lift arm below: same `damage-reflection` passive shape `enemyVictim`
// uses, just carried by a team actor instead of an enemy attacker (the ability is read off
// `incomingAbilitiesOf`, which is side-agnostic).
// ---------------------------------------------------------------------------------------------

const playerVictim = (
    id: string,
    position: Position,
    reflectPct?: number
): TeamActorEngineInput => ({
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
        shipSkills: {
            slots: [
                basicAttack(),
                ...(reflectPct === undefined
                    ? []
                    : [
                          {
                              slot: 'passive' as const,
                              abilities: [
                                  ab({
                                      type: 'modifier',
                                      target: 'self',
                                      config: { type: 'damage-reflection', pct: reflectPct },
                                  }),
                              ],
                          },
                      ]),
            ],
        },
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
});

const playerCuller = (): TeamActorEngineInput => ({
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
});

const enemyStasisBot = (id: string, position: Position, sel: Selection): EnemyAttacker => ({
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
});

// The breaker's pool is `hp(1_000_000_000) * startingShieldPctOfHp / 100` (createActor's seeding
// formula) with no round-start re-grant. POOL_PCT sizes a 1,000-point pool; against the breaker's
// ATTACK(5,000) * multiplier(2,500%) = 125,000-point hit, DRAIN_PCT reflects back ~1,250 — enough
// to empty that pool in the ONE bounce sub-hit 0 causes.
const POOL_PCT = 0.0001;
const DRAIN_PCT = 1;

// `hits` parameterises the firing active so a reflect vector can drain the pool mid-cast — same
// multi-hit shape as the player fixture's `attackerKit`.
const enemyGatedBreaker = (startingShieldPctOfHp: number, hits: number): EnemyAttacker => ({
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
    pattern: lineRange1Pattern(),
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({
                        type: 'damage',
                        target: 'enemy',
                        config: { type: 'damage', multiplier: 2_500, hits },
                    }),
                ],
            },
        ],
    },
    stasisBreakExemptWhen: SELF_SHIELD_GATE,
    preFight: {
        outgoingDamage: 0,
        incomingDamage: 0,
        outgoingCritDamage: 0,
        incomingCritDamage: 0,
        outgoingHeal: 0,
        incomingHeal: 0,
        startingShieldPctOfHp,
    },
});

interface EnemySideRunArgs {
    startingShieldPctOfHp: number;
    /** Sub-hits on the breaker's firing active. Defaults to 1 (single-hit, drain-free arms). */
    hits?: number;
    /** Thorns % on the player anchor victim — the enemy-side drain vector. */
    reflectPct?: number;
}

interface EnemySideRun {
    anchor: number[];
    covered: number[];
    /** The breaker's shield pool at the END of each round. */
    breakerPool: number[];
}

const enemySideRun = ({
    startingShieldPctOfHp,
    hits = 1,
    reflectPct,
}: EnemySideRunArgs): EnemySideRun => {
    const bus = createEventBus();
    const performed: Extract<CombatEvent, { type: 'ability-performed' }>[] = [];
    bus.on('ability-performed', (e) => performed.push(e));
    const result = runCombat({
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [] },
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
        speed: 1,
        healTargetId: 'attacker',
        mode: 'healing',
        position: 'B1',
        target: parsedTarget('front'),
        pattern: basePattern(),
        bus,
        teamActors: [
            playerVictim('pl-anchor', 'M4', reflectPct),
            playerVictim('pl-covered', 'M3'),
            playerCuller(),
        ],
        enemyAttackers: [
            enemyStasisBot('ebot-f', 'M4', 'front'),
            enemyStasisBot('ebot-b', 'M3', 'back'),
            enemyGatedBreaker(startingShieldPctOfHp, hits),
        ],
    });
    const rounds = (id: string): number[] =>
        performed.filter((e) => e.actorId === id).map((e) => e.round);
    return {
        anchor: rounds('pl-anchor'),
        covered: rounds('pl-covered'),
        breakerPool: result.rounds.map((r) => r.perActorShield?.['enemy-breaker']?.pool ?? 0),
    };
};

describe('shield-gated Stasis exemption — team symmetry (enemy carrier)', () => {
    it('a SHIELDED enemy carrier breaks neither player victim', () => {
        const r = enemySideRun({ startingShieldPctOfHp: 1 });
        expect(r.anchor).toHaveLength(0);
        expect(r.covered).toHaveLength(0);
    });

    it('the SAME enemy carrier with an empty pool breaks both', () => {
        const r = enemySideRun({ startingShieldPctOfHp: 0 });
        expect(r.anchor.length).toBeGreaterThan(0);
        expect(r.covered.length).toBeGreaterThan(0);
    });

    // THE LIFT, ENEMY SIDE: the breaker's pool comes from a one-time pre-fight seed with no
    // round-start re-grant, so thorns sized to empty it in ONE bounce turn that seed into a
    // mid-cast drain. Sub-hit 0 connects while the pool is up (exempt) and empties it; sub-hit 1
    // connects with the pool at zero and breaks the anchor's Stasis — the enemy-carrier twin of
    // the player fixture's 'hits:2 + draining thorns' arm.
    it('the lift is symmetric: an enemy carrier whose pool drains mid-cast breaks its ANCHOR', () => {
        const r = enemySideRun({ startingShieldPctOfHp: POOL_PCT, hits: 2, reflectPct: DRAIN_PCT });
        expect(r.breakerPool[0]).toBe(0);
        expect(r.anchor.length).toBeGreaterThan(0);
    });
});
