/**
 * Protection is STEALABLE — and stealing it moves ONE STACK, not the whole status.
 *
 * Owner rulings 2026-09-03, all three from concrete in-fight examples:
 *
 *  1. Only an ENEMY STEALING them can put Meatshield below his 3 stacks. Redirecting damage does
 *     NOT spend a stack (that rule is LIONHEART's own text — "after taking damage redirected
 *     through Protection, all Protection is removed" — and Meatshield's silence on the subject is
 *     meaningful, not an omission). His charged recovery clause is therefore a mirror-match /
 *     anti-Pallas answer exclusively.
 *  2. A top-up steal moves exactly what the top-up needs, ONE STACK AT A TIME, and the source
 *     keeps the rest: Meatshield at 1 vs an enemy Lionheart holding 10 → Meatshield 3, Lionheart 8.
 *  3. Pallas's generic "steals 1 buff" moves ONE STACK of Protection, and she then really protects
 *     her allies — soaking a share of damage aimed at them exactly as any Protection holder does.
 *     Not Defender-gated, not mere denial.
 *
 * WHY THIS COULD NOT WORK BEFORE — four measured gaps, none of them a missing detector:
 *
 *  (a) Meatshield's Protection is classified `kind: 'aura'` (`duration: 'recurring'`, no
 *      `stackTrigger`), and an aura's reported stack count comes from the STATIC `payload.stacks`.
 *      `auraSelfMaps` is written only at actor construction — `getAuraSelf` is its one writer and
 *      nothing mutates it afterwards, not even `removeSelfBuffByName`. His stacks were a CONSTANT 3
 *      for the whole fight, so his own "if this Unit has less than 3 stacks" gate could never be
 *      true and his stacks could never be taken.
 *  (b) `statusEngine.steal` reads ONLY the TIMED self store (`selfMaps`). An aura-granted or
 *      accumulating Protection is not in it at all.
 *  (c) `Protection` is in `UNREMOVABLE_STATUSES`, which `steal` skips. The game text calls it
 *      "stackable, unremovable AND stealable", so unremovable must mean "a cleanse cannot strip
 *      it", NOT "a steal cannot take it".
 *  (d) `steal` moves whole ENTRIES. Rulings 2 and 3 both need per-STACK movement.
 *
 * THE FIX SHAPE, and why it is a ledger rather than a mutation: a signed per-owner named-stack
 * ledger (`adjustSelfBuffStacks`) folded into `selfBuffStacksForOwner` and clamped at >= 0. That
 * makes an aura-granted count mutable WITHOUT touching aura registration or the static payload —
 * which sidesteps the payload-aliasing hazard entirely (two Meatshields in a mirror match may
 * share one payload object; a delta is per-owner by construction). It also gives a thief that
 * carries no Protection grant of its own somewhere to hold an acquired stack.
 *
 * `selfBuffStacksForOwner` has exactly ONE production caller — the Protection read at
 * `engine.ts`'s `protectorsFor` — so the ledger is observable only through Protection today. That
 * is measured, not assumed: `grep -rn selfBuffStacksForOwner src/ | grep -v __tests__`.
 *
 * Two things verified by construction rather than ruled:
 *  - `hasAnyProtectionGrant` is a BOARD-LEVEL boolean whose own comment already anticipates this
 *    ("Protection can be stolen/transferred onto a ship that carries no grant of its own"), so a
 *    Pallas holding a stolen stack is found by `protectorsFor` with no extra plumbing.
 *  - `clearProtectionOnRedirectIds` is keyed on the ability CARRIER (it scans each runtime's own
 *    slots for `clearAllOnRedirect`), so a Pallas is never in it and her stolen stack survives a
 *    redirect — which is what ruling 1 requires.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { selfBuffStacksForOwner } from '../triggers';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { StatusEngine } from '../statusEngine';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `ps${++idc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const HUGE_HP = 1_000_000_000;

/** Meatshield's shape: "At the start of combat, this Unit gains 3 stacks of Protection." An AURA —
 *  a `buff` config with NO duration + isStackable, which is what that text parses to. */
const protectionAura = (stacks: number): Ability => ({
    id: 'meatshield-protection',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Protection',
        parsedEffects: {},
        stacks,
        isStackable: true,
    },
});

/** Pallas's charged clause: "steals 1 buff from the primary target". Already a shipped ability
 *  type (`buff-steal`, PR10) wired at playerTurn's on-cast loop — nothing new here. */
const genericBuffSteal = (count = 1): Ability =>
    ab({ type: 'buff-steal', target: 'enemy', config: { type: 'buff-steal', count } });

/** A plain timed self-buff, used to pin that a NEWER timed buff still outranks Protection. */
const attackUp = (): Ability =>
    ab({
        type: 'buff',
        target: 'self',
        config: {
            type: 'buff',
            buffName: 'Attack Up',
            parsedEffects: { attack: 30 },
            stacks: 1,
            isStackable: false,
            duration: 99,
        },
    });

const hit = (multiplier = 100): Ability =>
    ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier } });

/** Total damage `id` actually TOOK across the run, post-cascade. */
const incomingOf = (result: ReturnType<typeof runCombat>, id: string): number =>
    result.rounds.reduce((s, r) => s + (r.perActorIncoming?.[id]?.incoming ?? 0), 0);

/**
 * Runs one fight and reports each named actor's Protection stack count at the END, read through
 * the SAME canonical helper `protectorsFor` uses — so the number asserted here is the number the
 * damage-transfer mechanic acts on, not a parallel bookkeeping channel.
 */
const runAndReadStacks = (
    input: CombatEngineInput,
    ids: string[]
): { stacks: Record<string, number>; result: ReturnType<typeof runCombat> } => {
    idc = 0;
    let engine: StatusEngine | undefined;
    const result = runCombat({
        ...input,
        __testTapStatusEngine: (e) => {
            engine = e;
        },
    });
    const stacks: Record<string, number> = {};
    for (const id of ids) stacks[id] = selfBuffStacksForOwner(engine!, id, 'Protection');
    return { stacks, result };
};

// ══════════════════════════════════════════════════════════════════════════════════════════════
// A PLAYER thief (Pallas's shape) steals from an ENEMY Meatshield-shaped aura holder.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** The enemy holds Protection as an aura and does nothing else. `alsoTimed` adds a newer timed
 *  self-buff, to pin the steal's newest-first ordering. */
const auraEnemy = (stacks: number, alsoTimed = false): EnemyAttacker => ({
    id: 'holder',
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HUGE_HP, speed: 300 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    affinity: 'antimatter',
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: {
        slots: [
            { slot: 'passive', abilities: [protectionAura(stacks)] },
            ...(alsoTimed
                ? [{ slot: 'active' as const, abilities: [attackUp()] }]
                : [{ slot: 'active' as const, abilities: [] }]),
        ],
    },
});

const THIEF_BASE = (slots: ShipSkills['slots'], enemies: EnemyAttacker[]): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots },
    // ONE round on purpose: the thief casts every round, so a 2-round fight steals TWICE and the
    // stack assertions below would be reading two transfers rather than one.
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
    hp: HUGE_HP,
    hacking: 100_000,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M1',
    target: parsedTarget('front'),
    pattern: basePattern(),
    enemyAttackers: enemies,
});

describe('a generic "steal 1 buff" takes ONE Protection stack (Pallas, ruling 3)', () => {
    it('CONTROL: with no thief, the aura holder keeps all 3 stacks', () => {
        const { stacks } = runAndReadStacks(
            THIEF_BASE([{ slot: 'active', abilities: [hit()] }], [auraEnemy(3)]),
            ['holder', 'attacker']
        );

        expect(stacks.holder).toBe(3);
        expect(stacks.attacker).toBe(0);
    });

    it('moves exactly one stack: the holder drops to 2 and the thief holds 1', () => {
        // Pre-fix this was 3 / 0 on BOTH counts and for two independent reasons: the aura store is
        // immutable, and `steal` never looked outside the timed store anyway.
        const { stacks } = runAndReadStacks(
            THIEF_BASE(
                [{ slot: 'active', abilities: [genericBuffSteal(1), hit()] }],
                [auraEnemy(3)]
            ),
            ['holder', 'attacker']
        );

        expect(stacks.holder).toBe(2);
        expect(stacks.attacker).toBe(1);
    });

    it('a NEWER timed buff still outranks Protection — existing steal ordering is preserved', () => {
        // `steal` takes the newest-applied stealable buff. Protection is granted at START OF
        // COMBAT, so it is the OLDEST thing the holder carries and must lose that comparison. This
        // is why no existing Pallas/Thresh/Tithonus behaviour moves: Protection is only reached
        // when it is the best candidate available.
        const { stacks } = runAndReadStacks(
            THIEF_BASE(
                [{ slot: 'active', abilities: [genericBuffSteal(1), hit()] }],
                [auraEnemy(3, true)]
            ),
            ['holder', 'attacker']
        );

        expect(stacks.holder).toBe(3);
        expect(stacks.attacker).toBe(0);
    });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Ruling 3's second half: the thief REALLY protects its allies.
// ══════════════════════════════════════════════════════════════════════════════════════════════

const teamActor = (id: string, position: Position, slots: ShipSkills['slots'] = []) =>
    ({
        id,
        speed: 100,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        role: 'ATTACKER',
        walk: {
            shipSkills: { slots },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: HUGE_HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as TeamActorEngineInput;

describe('a stolen stack really redirects: the thief soaks for its own allies (ruling 3)', () => {
    /**
     * The focus is the THIEF at M1. Its ally 'victim' sits at M4 (the player front column) and
     * eats the aggressor's hits. The aggressor is a separate enemy from the aura holder, so the
     * steal and the incoming damage are independent.
     *
     * One stolen stack = a 10% redirect, so the ally keeps 90% and the thief takes 10%.
     */
    const build = (steal: boolean): CombatEngineInput => ({
        ...THIEF_BASE(
            [{ slot: 'active', abilities: steal ? [genericBuffSteal(1)] : [] }],
            [
                auraEnemy(3),
                {
                    id: 'aggressor',
                    stats: {
                        attack: 1000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: HUGE_HP,
                        speed: 1,
                    },
                    chargeCount: 0,
                    startCharged: false,
                    position: 'M3',
                    affinity: 'antimatter',
                    target: parsedTarget('front'),
                    pattern: basePattern(),
                    shipSkills: { slots: [{ slot: 'active', abilities: [hit()] }] },
                },
            ]
        ),
        attack: 0, // the thief deals no damage; it only steals
        teamActors: [teamActor('victim', 'M4')],
        healTargetId: 'victim',
    });

    it('CONTROL: with no steal, the ally takes the whole hit and the thief takes nothing', () => {
        idc = 0;
        const result = runCombat(build(false));

        expect(incomingOf(result, 'victim')).toBeGreaterThan(0);
        expect(incomingOf(result, 'attacker')).toBe(0);
    });

    it('with one stolen stack, the thief soaks a share of the hit aimed at its ally', () => {
        idc = 0;
        const plain = runCombat(build(false));
        const withSteal = runCombat(build(true));

        // ORDER IS PART OF WHAT THIS ASSERTS, and it is not assumed: the thief can only have
        // soaked anything if the steal resolved BEFORE the aggressor's hit. A run where the
        // aggressor (speed 1, the slowest actor on the board) went first would leave the thief at
        // 0 incoming and fail here. So this assertion IS the turn-order proof, not a claim resting
        // on one.
        //
        // The thief now appears in `protectorsFor` despite carrying no Protection grant of its own.
        expect(incomingOf(withSteal, 'attacker')).toBeGreaterThan(0);
        // And the ally's own intake fell by exactly what moved — a redirect reassigns damage, it
        // does not create or destroy any (the conservation identity of #293).
        expect(incomingOf(withSteal, 'victim')).toBeLessThan(incomingOf(plain, 'victim'));
        expect(incomingOf(withSteal, 'victim') + incomingOf(withSteal, 'attacker')).toBeCloseTo(
            incomingOf(plain, 'victim'),
            4
        );
    });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// MEATSHIELD'S TOP-UP CLAUSE (ruling 2): "If this Unit has less than 3 stacks of Protection, it
// steals Protection until this Unit has 3 stacks of Protection."
//
// The caster is given a SHORT aura (1 stack) rather than being drained mid-fight: per ruling 1
// nothing but an enemy steal can lower his count, so a fixture that starts him at 3 could never
// reach the clause at all. Starting short is the same state a Pallas would have left him in.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** The top-up shape: steal `buffName` until the caster holds `upToStacks`. `count` is inert. */
const topUpSteal = (buffName: string, upToStacks: number): Ability =>
    ab({
        type: 'buff-steal',
        target: 'enemy',
        config: { type: 'buff-steal', count: 0, buffName, upToStacks },
    });

describe('a top-up steal takes only the deficit and the source keeps the rest (ruling 2)', () => {
    const build = (casterStacks: number, sourceStacks: number): CombatEngineInput => ({
        ...THIEF_BASE(
            [
                { slot: 'passive', abilities: [protectionAura(casterStacks)] },
                { slot: 'active', abilities: [topUpSteal('Protection', 3)] },
            ],
            [auraEnemy(sourceStacks)]
        ),
        attack: 0,
    });

    it('a caster at 1 stack takes exactly 2 from a 10-stack source, leaving it 8', () => {
        // The owner's own example, verbatim: Meatshield at 1 vs an enemy Lionheart holding 10 ->
        // Meatshield 3, Lionheart 8. NOT "take the whole status" (which would read 10/0) and no
        // surplus above the threshold.
        const { stacks } = runAndReadStacks(build(1, 10), ['attacker', 'holder']);

        expect(stacks.attacker).toBe(3);
        expect(stacks.holder).toBe(8);
    });

    it('a caster already AT the threshold steals nothing - the clause is a no-op', () => {
        // Per ruling 1 this is the normal state of affairs: nothing but an enemy steal puts him
        // below 3, so in a fight without a Protection thief the clause correctly never fires.
        const { stacks } = runAndReadStacks(build(3, 10), ['attacker', 'holder']);

        expect(stacks.attacker).toBe(3);
        expect(stacks.holder).toBe(10);
    });

    it('a source with FEWER stacks than the deficit gives all it has, and no more', () => {
        // Caster at 1 wants 2; the source holds only 1. It ends empty and the caster ends at 2 -
        // short of its threshold, because the board had nothing left to take.
        const { stacks } = runAndReadStacks(build(1, 1), ['attacker', 'holder']);

        expect(stacks.attacker).toBe(2);
        expect(stacks.holder).toBe(0);
    });

    it('a top-up naming a status that is not stack-stealable moves nothing', () => {
        // The parser captures the NAME from the text rather than a whitelist, so a config can
        // legitimately name something the engine cannot move per stack. That resolves to a no-op,
        // never to a wrong steal of some other buff.
        const { stacks } = runAndReadStacks(
            {
                ...THIEF_BASE(
                    [
                        { slot: 'passive', abilities: [protectionAura(1)] },
                        { slot: 'active', abilities: [topUpSteal('Attack Up', 3)] },
                    ],
                    [auraEnemy(10)]
                ),
                attack: 0,
            },
            ['attacker', 'holder']
        );

        expect(stacks.attacker).toBe(1);
        expect(stacks.holder).toBe(10);
    });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Tithonus's fan-out: a stolen STACK is DUPLICATED to every recipient, not split or conserved.
//
// Owner ruled 2026-09-03, asked with this exact example: Tithonus steals from a Meatshield holding
// 3 and grants the stolen buff "to self and all adjacent allies" — Meatshield loses ONE stack and
// Tithonus's side gains ONE EACH. So Protection stacks are deliberately NOT conserved through this
// clause; the ruling is that it behaves exactly like the timed-buff fan-out already does (one entry
// becomes N copies), and the fact that a stack is a countable resource does not change it.
//
// This branch had NO test before — the fixtures above never combine a stack steal with
// `grantAdjacentAllies`, so the arm was unobserved and either answer would have gone green.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('a stolen Protection stack is DUPLICATED to every recipient (owner ruling 2026-09-03)', () => {
    /** Focus at M4 with an ally at M3 — the adjacency pair `buffStealCastPath.test.ts` uses. */
    const adjacentAlly = (): TeamActorEngineInput => teamActor('ally', 'M3');

    it('the source loses ONE stack while the caster AND its adjacent ally each gain one', () => {
        const { stacks } = runAndReadStacks(
            {
                ...THIEF_BASE(
                    [
                        {
                            slot: 'active',
                            abilities: [
                                ab({
                                    type: 'buff-steal',
                                    target: 'enemy',
                                    config: {
                                        type: 'buff-steal',
                                        count: 1,
                                        grantAdjacentAllies: true,
                                    },
                                }),
                            ],
                        },
                    ],
                    [auraEnemy(3)]
                ),
                attack: 0,
                position: 'M4',
                teamActors: [adjacentAlly()],
            },
            ['holder', 'attacker', 'ally']
        );

        // ONE leaves the source...
        expect(stacks.holder).toBe(2);
        // ...and TWO arrive, one per recipient. That asymmetry is the ruling, not a bug: assert it
        // explicitly so a future "fix" that conserves stacks has to argue with the owner's answer
        // rather than with a silent fixture.
        expect(stacks.attacker).toBe(1);
        expect(stacks.ally).toBe(1);
    });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TEAM SYMMETRY for the top-up direction. `buffHolderIdByPosition` closes over the side-relative
// `tb.opposingRoster`, so it SHOULD be symmetric for free — but "symmetric by construction" is the
// same reasoning that produced a false reach claim one PR ago, so it is measured here instead.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('team symmetry: an ENEMY caster tops itself up off a PLAYER holder', () => {
    it('the enemy reaches its threshold and the player ally loses exactly the deficit', () => {
        const { stacks } = runAndReadStacks(
            {
                ...THIEF_BASE(
                    // The focus itself is inert — it is only here because the engine always mints
                    // playerTeam[0]; the PLAYER holder is the team actor below.
                    [{ slot: 'active', abilities: [] }],
                    [
                        {
                            id: 'enemy-topper',
                            stats: {
                                attack: 0,
                                crit: 0,
                                critDamage: 0,
                                defence: 0,
                                hp: HUGE_HP,
                                speed: 300,
                            },
                            chargeCount: 0,
                            startCharged: false,
                            position: 'M4',
                            affinity: 'antimatter',
                            target: parsedTarget('front'),
                            pattern: basePattern(),
                            shipSkills: {
                                slots: [
                                    { slot: 'passive', abilities: [protectionAura(1)] },
                                    {
                                        slot: 'active',
                                        abilities: [topUpSteal('Protection', 3)],
                                    },
                                ],
                            },
                        },
                    ]
                ),
                attack: 0,
                teamActors: [
                    teamActor('player-holder', 'M4', [
                        { slot: 'passive', abilities: [protectionAura(10)] },
                    ]),
                ],
                healTargetId: 'player-holder',
            },
            ['enemy-topper', 'player-holder']
        );

        expect(stacks['enemy-topper']).toBe(3);
        expect(stacks['player-holder']).toBe(8);
    });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// REGRESSION (CodeRabbit, PR #465): a top-up must consume ONLY the named status.
//
// The first cut passed the deficit as the generic `count` to `statusEngine.steal`, which spends
// its budget on TIMED candidates first and hands stacks only the remainder. So a top-up against a
// source that ALSO held a timed buff stole that buff — and moved one fewer Protection stack than
// the clause asked for. Meatshield's text names Protection and nothing else.
//
// Every earlier top-up fixture used a source holding Protection ALONE, so the combination was
// unobserved and either behaviour went green. The named-only path (`stealStacks`) is what fixes it.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('a top-up consumes ONLY the named status, never a timed buff (CodeRabbit #465)', () => {
    /** Reads the TIMED ability statuses an actor holds, to prove the timed buff stayed put. */
    const timedNamesOf = (input: CombatEngineInput, id: string): string[] => {
        idc = 0;
        let engine: StatusEngine | undefined;
        runCombat({
            ...input,
            __testTapStatusEngine: (e) => {
                engine = e;
            },
        });
        return engine!.timedAbilityStatuses('self', id).map((b) => b.active.buffName);
    };

    const build = (): CombatEngineInput => ({
        ...THIEF_BASE(
            [
                { slot: 'passive', abilities: [protectionAura(1)] },
                { slot: 'active', abilities: [topUpSteal('Protection', 3)] },
            ],
            // `alsoTimed` gives the holder an "Attack Up" on its own active slot, so the source
            // carries a timed candidate ALONGSIDE its Protection stacks.
            [auraEnemy(10, true)]
        ),
        attack: 0,
    });

    it('moves the full deficit in Protection and leaves the timed buff on the source', () => {
        const { stacks } = runAndReadStacks(build(), ['attacker', 'holder']);

        // Pre-fix: attacker 2 / holder 9 — one stack short, because the timed "Attack Up" ate half
        // the budget.
        expect(stacks.attacker).toBe(3);
        expect(stacks.holder).toBe(8);
    });

    it("and the caster does NOT pick up the source's timed buff", () => {
        const input = build();

        // Pre-fix the caster held ['Attack Up'] — a buff Meatshield's clause never mentions.
        expect(timedNamesOf(input, 'attacker')).toEqual([]);
        // The source keeps it: a named top-up is not a purge.
        expect(timedNamesOf(input, 'holder')).toEqual(['Attack Up']);
    });
});
