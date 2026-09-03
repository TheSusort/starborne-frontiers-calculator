/**
 * A LEECH's basis is what the funnel RECORDED, not the hit we computed.
 *
 * Both leech directions read a per-victim `damage` handed down by `drivePositionalApply`'s
 * `onVictimResolved` seam, and that number is PRE-FUNNEL: it is the hit as thrown, before a
 * Protection cascade moved a chunk to a protector, before an incoming-block proc shaved it, and
 * before a Voron/Orel/Hit-Mitigation transform deferred the whole thing into a DoT. The funnel's
 * own recorded intake is `outcome.incomingBooked`, and the slice a cascade diverted is
 * `outcome.protectionRedirected`.
 *
 * The two directions want DIFFERENT combinations of those, and the difference is not cosmetic:
 *
 *  DEALT (standing leech — Magnolia/Valerian, the Leech gear set). LOCKED game rule
 *  (owner, 2026-08-08): "% of damage dealt" is the FINAL on-screen number, a Protection redirect
 *  COUNTS (the attacker dealt the protector's chunk plus the target's remainder), and a DoT
 *  transform does NOT ("if dot, no heal" — the damage is not dealt now; it re-books per tick on
 *  the DoT path, where the entry's `sourceId` deliberately keeps the leech basis on the victim).
 *  So the basis is `incomingBooked + protectionRedirected`, the same figure
 *  `SubAttackOutcome.deliveredDamage` carries for Bloodthirst (see
 *  `damageDealtBasis.integration.test.ts`, which pins the identical rule for the reactive path).
 *
 *  TAKEN (Malvex/Quixilver shields). RULED by the owner 2026-09-03 and then MEASURED IN GAME the
 *  same day — the same Nosorog hit on the same Malvex, with and without a Meatshield on the team:
 *
 *      Meatshield    shown on Malvex    shield gained    ratio
 *      absent        1115               167              15.0%
 *      present        781               117              15.0%
 *
 *  781 / 1115 = 70.0%: three stacks of Protection took 30%, the number DISPLAYED on Malvex dropped
 *  with it, and the shield tracked the displayed number in both rows. Had the basis been the hit as
 *  thrown, the protected row would have read 167 like the unprotected one. So "damage taken" is the
 *  victim's own post-cascade intake — the basis is `incomingBooked` ALONE, with no
 *  `protectionRedirected` term, and that is exactly where it parts company with the dealt
 *  direction. A transformed slice is likewise not taken yet (unmeasured, but the same reading).
 *
 *  Note what made that pair decisive and either row alone useless: the plain row fixes only the
 *  percentage, because with no protector and no transform the pre-funnel and post-funnel numbers
 *  ARE the same number. The candidates only separate once the funnel actually moves something.
 *
 * MEASURED before this file existed (both directions on the pre-funnel `damage`):
 *
 *   case                                   dealt leech      taken leech
 *   plain hit                              correct          correct
 *   3-stack Protection on the victim       correct*         30% TOO HIGH
 *   hit fully transformed into a DoT       FULL, must be 0  FULL, must be 0
 *
 *   (*) correct only by accident: the pre-funnel hit happens to equal remainder + chunk when the
 *   protector's defence is 0, which is why every fixture here keeps protector defence at 0 — it
 *   makes the dealt-direction assertion an equality, and it means a fix that used `incomingBooked`
 *   alone (dropping the redirect) would REGRESS this row rather than leave it alone. The
 *   Protection rows are what discriminate `incomingBooked` from `incomingBooked +
 *   protectionRedirected`; the transform rows cannot, since `protectionRedirected` is 0 there.
 *
 * Every leech in this file carries `noCrit: true`. A heal-kind leech otherwise draws the owner's
 * heal-crit gate once per victim, which would put an RNG dependency on every amount below.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus } from '../events';
import { Ability, ShipSkills } from '../../../types/abilities';
import type { SelectedGameBuff } from '../../../types/calculator';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `lfb${++idc}`,
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

const LEECH_PCT = 20;
const ATTACK = 5000;
const HUGE_HP = 1_000_000_000;

/** An N-hit damage active. As in `damageDealtBasis.integration.test.ts`, the multiplier is FIXED at
 *  100 alongside `hits`, so one sub-attack of a 3-hit cast delivers what a 1-hit cast delivers. */
const attackSkill = (hits: number): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({
            type: 'damage',
            target: 'enemy',
            config: { type: 'damage', multiplier: 100, ...(hits > 1 ? { hits } : {}) },
        }),
    ],
});

/** Magnolia's shape: a passive-slot SELF heal off damage DEALT — a STANDING leech, so it lands in
 *  `standingLeeches` and procs per footprint victim on the positional firing hit. */
const standingLeechPassive = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'heal',
            target: 'self',
            config: {
                type: 'heal',
                pct: LEECH_PCT,
                basis: 'damage-dealt',
                leechScope: 'all',
                noCrit: true,
            },
        }),
    ],
});

/** Malvex's shape, in its heal flavour: a passive-slot SELF repair off damage TAKEN. The live
 *  corpus entries (Malvex, Quixilver) are SHIELDS, and the shield fork is covered by its own case
 *  below; the heal fork is used for the arithmetic because a repair amount is not clipped by a
 *  pool the way a shield grant is. Both forks scale the SAME `damage * pct` line. */
const takenLeechHealPassive = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'heal',
            target: 'self',
            config: { type: 'heal', pct: LEECH_PCT, basis: 'damage-taken', noCrit: true },
        }),
    ],
});

/** The live corpus flavour of the same passive: Malvex's damage-taken SHIELD. */
const takenLeechShieldPassive = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        ab({
            type: 'shield',
            target: 'self',
            config: { type: 'shield', pct: LEECH_PCT, basis: 'damage-taken' },
        }),
    ],
});

/**
 * Grants SELF `Protection` the PRODUCTION way — an aura (a `buff` config with NO duration +
 * isStackable), the classification a real Meatshield's passive parses to. Copied from
 * `protectionTransfer.integration.test.ts` / `damageDealtBasis.integration.test.ts`.
 */
const protectionAuraPassive = (stacks: number): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        {
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
        },
    ],
});

/** A per-round accumulating 'Protection' self-buff for the FOCUS ship (which cannot carry a
 *  team-actor passive slot). Rate = cap = stacks, so round 1 lands exactly `stacks`. */
const protectionAccum = (stacks: number): SelectedGameBuff => ({
    id: 'prot-1',
    buffName: 'Protection',
    stacks,
    parsedEffects: {},
    isStackable: true,
    maxStacks: stacks,
    stackTrigger: 'per-round',
});

/** Total damage `id` actually TOOK across the run, post-cascade — the per-actor intake bucket. */
const incomingOf = (input: CombatEngineInput, id: string): number => {
    let sum = 0;
    for (const rd of runCombat(input).rounds) sum += rd.perActorIncoming?.[id]?.incoming ?? 0;
    return sum;
};

/**
 * The `reactive-heal-performed` amounts a leech paid `casterId`, in resolution order.
 *
 * `reactive-heal-performed`, NOT `heal-performed`: a leech is not a cast, so it emits the reactive
 * event (see the emit's own comment in `engine.ts`). Subscribing to `heal-performed` would observe
 * an empty array and every assertion below would pass vacuously.
 */
const leechHeals = (input: CombatEngineInput, casterId: string): number[] => {
    const out: number[] = [];
    const bus = createEventBus();
    bus.on('reactive-heal-performed', (e) => {
        if (e.casterId === casterId) out.push(e.amount);
    });
    runCombat({ ...input, bus });
    return out;
};

/** As `leechHeals`, for the shield fork: `shield-applied` amounts keyed on the GRANTER. */
const leechShields = (input: CombatEngineInput, granterId: string): number[] => {
    const out: number[] = [];
    const bus = createEventBus();
    bus.on('shield-applied', (e) => {
        if (e.granterId === granterId) out.push(e.amount);
    });
    runCombat({ ...input, bus });
    return out;
};

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

// ══════════════════════════════════════════════════════════════════════════════════════════════
// DEALT direction — the focus attacks enemies, and its own standing leech pays out.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** A positioned enemy that never fires back. `slots` optionally carries the Protection aura. */
const passiveEnemyAt = (id: string, position: Position, slots: ShipSkills['slots'] = []) =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HUGE_HP, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        affinity: 'antimatter',
        shipSkills: { slots },
    }) as EnemyAttacker;

/**
 * 'anchor' (M4, the front column) self-casts a long `Hit Mitigation` and acts FIRST (speed 999 vs
 * the focus's 1), so the one-shot block is armed before the focus's cast lands and converts that
 * hit wholesale into a self-DoT. Shape copied from `damageDealtBasis.integration.test.ts`.
 */
const mitigatingAnchor = (): EnemyAttacker => ({
    id: 'anchor',
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HUGE_HP, speed: 999 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    affinity: 'antimatter',
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    ab({
                        type: 'buff',
                        target: 'self',
                        config: {
                            type: 'buff',
                            buffName: 'Hit Mitigation',
                            parsedEffects: {},
                            stacks: 1,
                            isStackable: false,
                            duration: 99,
                        },
                    }),
                ],
            },
        ],
    },
});

/**
 * The focus player at M1 fires `slots` at the front column. Crit 0 keeps every number an exact
 * integer. 'covered' (M3) holds Protection under `protectTarget`, so part of every hit on 'anchor'
 * is redirected onto it; its defence is 0, so the chunk re-mitigates at ratio 1 and
 * `chunk + remainder` is EXACTLY the undiverted hit.
 */
const dealtInput = (
    hits: number,
    opts: { protectTarget?: boolean; mitigate?: boolean } = {}
): CombatEngineInput => {
    idc = 0;
    return {
        attack: ATTACK,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [attackSkill(hits), standingLeechPassive()] },
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
        // Slower than the mitigating anchor, so its block is up before the cast.
        speed: 1,
        position: 'M1',
        target: parsedTarget('front'),
        pattern: basePattern(),
        enemyAttackers: [
            opts.mitigate ? mitigatingAnchor() : passiveEnemyAt('anchor', 'M4'),
            passiveEnemyAt('covered', 'M3', opts.protectTarget ? [protectionAuraPassive(3)] : []),
        ],
    };
};

describe('a standing leech pays off the damage the funnel RECORDED (locked rule, dealt side)', () => {
    it('CONTROL: a plain hit pays pct x the hit', () => {
        const heals = leechHeals(dealtInput(1), 'attacker');

        expect(heals).toHaveLength(1);
        expect(heals[0]).toBeCloseTo((ATTACK * LEECH_PCT) / 100, 6);
    });

    it('a Protection redirect does NOT shrink the basis — protector chunk plus target remainder', () => {
        const unprotected = leechHeals(dealtInput(1), 'attacker');
        const withProtector = leechHeals(dealtInput(1, { protectTarget: true }), 'attacker');

        expect(unprotected).toHaveLength(1);
        expect(withProtector).toHaveLength(1);
        // Locked ruling (in-game verified 2026-08-08): the heal counts the damage dealt to the
        // protector AND whatever remainder was left on the original target. Protector defence is 0,
        // so the two shares sum back to exactly the undiverted hit and this is an equality.
        //
        // THIS IS THE ROW THAT DISCRIMINATES the fix from the wrong one: a basis of
        // `incomingBooked` alone would read 0.7x here and this assertion would fail, while every
        // transform assertion below would still pass.
        expect(withProtector[0]).toBeCloseTo(unprotected[0], 4);
    });

    it('...and that redirect is real: the protector took 30%, the target kept 70%', () => {
        // NON-VACUITY GUARD for the row above — without it, an inert cascade would make both sides
        // equal because nothing moved, and the equality would pass trivially.
        const victimAlone = incomingOf(dealtInput(1), 'anchor');
        const protectedInput = dealtInput(1, { protectTarget: true });
        const victimProtected = incomingOf(protectedInput, 'anchor');
        const protector = incomingOf(protectedInput, 'covered');

        expect(victimAlone).toBeCloseTo(ATTACK, 6);
        expect(victimProtected).toBeCloseTo(0.7 * victimAlone, 4);
        expect(protector).toBeCloseTo(0.3 * victimAlone, 4);
        expect(protector).toBeGreaterThan(0);
        expect(victimProtected + protector).toBeCloseTo(victimAlone, 4);
    });

    it('a hit transformed wholesale into a DoT pays NOTHING (locked: "if dot, no heal")', () => {
        // MEASURED pre-fix: this paid the FULL pct x the pre-funnel hit — a leech off damage that
        // never landed. The deferred amount re-books per tick on the DoT path instead, where the
        // entry's `sourceId` is the VICTIM, so it feeds the victim's leech and never the
        // attacker's (`transformedDotAttackerCredit.test.ts` pins that axis).
        //
        // A repair whose gross is 0 opens no combat-log row, so the observable is the ABSENCE of
        // the event, not an `amount: 0`. The control above supplies the "the cast still fired"
        // half that absence alone cannot.
        expect(leechHeals(dealtInput(1, { mitigate: true }), 'attacker')).toHaveLength(0);
    });

    it('only the DIVERTED sub-attack goes silent — its two siblings pay normally', () => {
        // Hit Mitigation is a ONE-SHOT, so exactly sub-attack 0 of a 3-hit cast is transformed.
        // This is what separates "the transformed slice drops out of the basis" from "the leech
        // broke": a fix that zeroed the whole cast would report 0 here.
        const heals = leechHeals(dealtInput(3, { mitigate: true }), 'attacker');
        const control = leechHeals(dealtInput(3), 'attacker');

        expect(control).toHaveLength(3);
        expect(heals).toHaveLength(2);
        expect(heals[0]).toBeGreaterThan(0);
        expect(heals[1]).toBeCloseTo(heals[0], 6);
        expect(sum(heals)).toBeCloseTo((sum(control) * 2) / 3, 6);
    });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TAKEN direction — an enemy attacks a player ally, and THAT ally's own taken leech pays out.
//
// A PLAYER victim is not a requirement, only a convenience: `procLeechesForVictim` fires BOTH
// directions and all three attack sites route through it, so an ENEMY victim's taken leech procs
// too. (`procTakenLeechesPerVictim`'s own docblock still opens "for the POSITIONAL enemy branch
// (enemy→player)" — that predates the seam, and #374's whole point was that each side was running
// only one of its two leeches.) The enemy-victim row is asserted at the end of this block; the
// enemy-attacks-player shape is used for the arithmetic because the focus ship can carry the
// Protection accumulator, which a team actor cannot.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** A walked player team actor: a pure victim stat block carrying `passive` slots. */
const teamActor = (
    id: string,
    position: Position,
    slots: ShipSkills['slots']
): TeamActorEngineInput => ({
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
});

/** A flat enemy attacker at M4 that fires one 100% basic hit at the front player column. */
const aggressor = (): EnemyAttacker => ({
    id: 'aggressor',
    stats: { attack: ATTACK, crit: 0, critDamage: 0, defence: 0, hp: HUGE_HP, speed: 50 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    affinity: 'antimatter',
    target: parsedTarget('front'),
    pattern: basePattern(),
    shipSkills: { slots: [attackSkill(1)] },
});

/**
 * 'victim' (M4, the player front column) carries the taken leech and eats the enemy's hit. The
 * FOCUS ship is the protector under `protectTarget` — it holds Protection via an accumulating
 * self-buff, since a focus ship has no team-actor passive slot. Its defence is 0, so the
 * redirected chunk re-mitigates at ratio 1.
 *
 * The focus sits at M2: the normalization boundary places every actor, and left unplaced it would
 * take M4 and become the direct-hit victim itself.
 */
const takenInput = (
    victimSlots: ShipSkills['slots'],
    opts: { protectTarget?: boolean; mitigate?: boolean } = {}
): CombatEngineInput => {
    idc = 0;
    const slots: ShipSkills['slots'] = opts.mitigate
        ? [
              ...victimSlots,
              {
                  slot: 'active',
                  abilities: [
                      ab({
                          type: 'buff',
                          target: 'self',
                          config: {
                              type: 'buff',
                              buffName: 'Hit Mitigation',
                              parsedEffects: {},
                              stacks: 1,
                              isStackable: false,
                              duration: 99,
                          },
                      }),
                  ],
              },
          ]
        : victimSlots;
    return {
        // The focus deals no offence: it is only the (optional) protector.
        attack: 0,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: { slots: [] },
        numRounds: 1,
        selfBuffs: opts.protectTarget ? [protectionAccum(3)] : [],
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
        healTargetId: 'victim',
        mode: 'healing',
        position: 'M2',
        target: parsedTarget('front'),
        pattern: basePattern(),
        teamActors: [teamActor('victim', 'M4', slots)],
        enemyAttackers: [aggressor()],
    };
};

describe('a damage-TAKEN leech counts what the victim actually took (owner ruling 2026-09-03)', () => {
    it('CONTROL: a plain hit pays pct x the hit', () => {
        const heals = leechHeals(takenInput([takenLeechHealPassive()]), 'victim');

        expect(heals).toHaveLength(1);
        expect(heals[0]).toBeCloseTo((ATTACK * LEECH_PCT) / 100, 6);
    });

    it('a Protection redirect DOES shrink the basis — the protector took that slice, not the victim', () => {
        const alone = leechHeals(takenInput([takenLeechHealPassive()]), 'victim');
        const protectedRun = leechHeals(
            takenInput([takenLeechHealPassive()], { protectTarget: true }),
            'victim'
        );

        expect(alone).toHaveLength(1);
        expect(protectedRun).toHaveLength(1);
        // MEASURED pre-fix: these two were EQUAL — the victim was paid for a slice its protector
        // ate. The 0.7 factor is not a fixture convenience: it is the in-game ratio, from the same
        // Nosorog hit on the same Malvex with and without a Meatshield (1115 -> 167 became
        // 781 -> 117, and 781/1115 = 70.0%). Three stacks here for the same reason.
        //
        // This is the row where the two directions part company: the DEALT basis adds
        // `protectionRedirected` back and stays flat, the TAKEN basis does not and drops to 0.7x.
        expect(protectedRun[0]).toBeCloseTo(0.7 * alone[0], 4);
    });

    it('...and that redirect is real: the focus protector took 30% of the hit', () => {
        // NON-VACUITY GUARD: with an inert cascade the victim would keep the whole hit and the
        // 0.7x assertion above would fail loudly rather than pass — but this pins WHY.
        const protectedInput = takenInput([takenLeechHealPassive()], { protectTarget: true });

        expect(incomingOf(takenInput([takenLeechHealPassive()]), 'victim')).toBeCloseTo(ATTACK, 6);
        expect(incomingOf(protectedInput, 'victim')).toBeCloseTo(0.7 * ATTACK, 4);
        expect(incomingOf(protectedInput, 'attacker')).toBeCloseTo(0.3 * ATTACK, 4);
    });

    it('a hit the victim transformed into its own DoT pays NOTHING', () => {
        // The victim's Hit Mitigation converts the incoming hit wholesale. It took no damage this
        // turn — the amount re-books per tick on the DoT path — so its taken leech has a 0 basis
        // and opens no log row. MEASURED pre-fix: the full pct x the pre-funnel hit.
        expect(
            leechHeals(takenInput([takenLeechHealPassive()], { mitigate: true }), 'victim')
        ).toHaveLength(0);
    });

    it('the live corpus flavour moves with it: Malvex/Quixilver damage-taken SHIELDS', () => {
        // The heal fork above carries the arithmetic; this pins that the SHIELD fork — the only
        // flavour any shipped ship actually has — reads the same basis. Ratios rather than
        // magnitudes, so a pool clip could not make it pass for the wrong reason.
        const alone = leechShields(takenInput([takenLeechShieldPassive()]), 'victim');
        const protectedRun = leechShields(
            takenInput([takenLeechShieldPassive()], { protectTarget: true }),
            'victim'
        );

        expect(alone).toHaveLength(1);
        expect(alone[0]).toBeCloseTo((ATTACK * LEECH_PCT) / 100, 6);
        expect(protectedRun).toHaveLength(1);
        expect(protectedRun[0]).toBeCloseTo(0.7 * alone[0], 4);
        expect(
            leechShields(takenInput([takenLeechShieldPassive()], { mitigate: true }), 'victim')
        ).toHaveLength(0);
    });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// The SECOND standing-leech site: the passive-slot damage instance.
//
// A passive slot can carry its own `damage` ability (Judge: "at the start of the round this Unit
// deals 60% damage to all enemies with less than 50% HP"), and on a positional cast that instance
// is a SECOND direct-damage path into the funnel with its own leech proc — a hand-written call
// rather than the `procLeechesForVictim` seam. It was left on the pre-funnel basis on purpose, to
// match the seam; it had to move when the seam did.
//
// MEASURED: with this site alone reverted to `damage`, the entire suite (640 files / 7,180 tests)
// stayed GREEN. Nothing anywhere observed it. That is what this block exists for — the transform
// run below reports one leech instead of zero the moment the site regresses.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Voron/Orel's STANDING transform: every incoming hit becomes a self-DoT, not just the next one.
 *  A one-shot `Hit Mitigation` cannot be used here — MEASURED at the end of this file: it is spent
 *  on the firing hit and leaves the passive-slot instance landing normally, so a one-shot fixture
 *  observes the instance's basis not at all. */
const transformingAnchor = (): EnemyAttacker => ({
    id: 'anchor',
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HUGE_HP, speed: 1 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    affinity: 'antimatter',
    shipSkills: {
        slots: [
            {
                slot: 'passive',
                abilities: [
                    {
                        id: 'transform',
                        type: 'transform-incoming-to-dot',
                        target: 'self',
                        trigger: 'on-attacked',
                        conditions: [],
                        config: {
                            type: 'transform-incoming-to-dot',
                            turns: 3,
                            condition: 'always',
                        },
                    },
                ],
            },
        ],
    },
});

/** The focus fires one active hit and, from its passive slot, one Judge-shaped damage instance —
 *  two separate direct-damage paths at the same victim, each proccing the standing leech once. */
const passiveInstanceInput = (opts: {
    withInstance: boolean;
    transform?: boolean;
}): CombatEngineInput => {
    idc = 0;
    return {
        ...dealtInput(1),
        shipSkills: {
            slots: [
                attackSkill(1),
                {
                    slot: 'passive',
                    abilities: [
                        ...(opts.withInstance
                            ? [
                                  ab({
                                      type: 'damage',
                                      target: 'enemy',
                                      config: { type: 'damage', multiplier: 60 },
                                  }),
                              ]
                            : []),
                        ab({
                            type: 'heal',
                            target: 'self',
                            config: {
                                type: 'heal',
                                pct: LEECH_PCT,
                                basis: 'damage-dealt',
                                leechScope: 'all',
                                noCrit: true,
                            },
                        }),
                    ],
                },
            ],
        },
        enemyAttackers: [
            opts.transform ? transformingAnchor() : passiveEnemyAt('anchor', 'M4'),
            passiveEnemyAt('covered', 'M3'),
        ],
    };
};

describe('the passive-slot damage instance leeches off the funnel too', () => {
    it('ANTI-VACUITY: the instance really adds a second leech proc of its own', () => {
        // Without this pair, the transform assertion below would be satisfied by a fixture whose
        // passive-slot instance never fired at all, and the site would stay unobserved.
        const withoutInstance = leechHeals(
            passiveInstanceInput({ withInstance: false }),
            'attacker'
        );
        const withInstance = leechHeals(passiveInstanceInput({ withInstance: true }), 'attacker');

        expect(withoutInstance).toHaveLength(1);
        expect(withInstance).toHaveLength(2);
        // 60% multiplier against the same victim, so the instance's own proc is 0.6x the firing
        // hit's — which also pins that the extra proc is the INSTANCE and not a duplicated hit.
        expect(sum(withInstance)).toBeCloseTo(sum(withoutInstance) * 1.6, 6);
    });

    it('pays NOTHING when the victim transforms every hit it takes', () => {
        // Both paths are transformed, so both bases are 0 and neither opens a log row. With the
        // instance's site on the pre-funnel `damage` this reports 1, not 0.
        expect(
            leechHeals(passiveInstanceInput({ withInstance: true, transform: true }), 'attacker')
        ).toHaveLength(0);
    });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Team symmetry for the TAKEN direction, and the ordering fact the block above relies on.
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("team symmetry: an ENEMY victim's taken leech reads the same funnel figure", () => {
    it('fires at all — the taken proc is not enemy-site-only', () => {
        // Disproves the claim `procTakenLeechesPerVictim`'s docblock still makes. The player focus
        // attacks 'anchor', which carries the taken leech: a PLAYER→ENEMY site, and it procs.
        const heals = leechHeals(
            {
                ...dealtInput(1),
                enemyAttackers: [
                    passiveEnemyAt('anchor', 'M4', [takenLeechHealPassive()]),
                    passiveEnemyAt('covered', 'M3'),
                ],
            },
            'anchor'
        );

        expect(heals).toHaveLength(1);
        expect(heals[0]).toBeCloseTo((ATTACK * LEECH_PCT) / 100, 6);
    });

    it('and drops the Protection-redirected slice, exactly as a player victim does', () => {
        // 'covered' holds Protection, so part of every hit on 'anchor' moves to it. Same 0.7x as
        // the player-victim row — the ruling is a game rule, not a side-specific one.
        const alone = leechHeals(
            {
                ...dealtInput(1),
                enemyAttackers: [
                    passiveEnemyAt('anchor', 'M4', [takenLeechHealPassive()]),
                    passiveEnemyAt('covered', 'M3'),
                ],
            },
            'anchor'
        );
        const withProtector = leechHeals(
            {
                ...dealtInput(1),
                enemyAttackers: [
                    passiveEnemyAt('anchor', 'M4', [takenLeechHealPassive()]),
                    passiveEnemyAt('covered', 'M3', [protectionAuraPassive(3)]),
                ],
            },
            'anchor'
        );

        expect(alone).toHaveLength(1);
        expect(withProtector).toHaveLength(1);
        expect(withProtector[0]).toBeCloseTo(0.7 * alone[0], 4);
    });
});

describe('MEASUREMENT: a one-shot block is spent on the firing hit, not the passive instance', () => {
    it("leaves exactly the passive-slot instance's own proc behind", () => {
        // This is why the passive-instance block above needs Voron's STANDING transform rather
        // than a one-shot `Hit Mitigation`. Not reasoned from line order — measured: the single
        // surviving proc is 20% of 60% x 5000 = 600, i.e. the INSTANCE's, with the firing hit's
        // 1000 gone. A one-shot fixture therefore cannot observe the instance's basis at all.
        const heals = leechHeals(
            {
                ...passiveInstanceInput({ withInstance: true }),
                enemyAttackers: [mitigatingAnchor(), passiveEnemyAt('covered', 'M3')],
            },
            'attacker'
        );

        expect(heals).toHaveLength(1);
        expect(heals[0]).toBeCloseTo((ATTACK * 0.6 * LEECH_PCT) / 100, 6);
    });
});
