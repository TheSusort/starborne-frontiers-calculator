/**
 * Detonation / burst booking reconciliation (#355 Group B1).
 *
 * `applyVictimDamage` returns `incomingBooked` — the net it ACTUALLY recorded into the victim's
 * `.incoming` bucket, after every step of the funnel that can shrink a hit before it is recorded:
 * an incoming-block proc, a Protection cascade diverting a chunk to a protector, and a
 * Voron/Orel-style transform deferring the hit into a DoT. #293 swept every DIRECT-DAMAGE caller
 * onto that return so the display identity
 *
 *     Σ perTargetDealt  ==  Σ perTargetDamage  ==  Σ perActorIncoming[].incoming
 *
 * holds by construction: those three channels are booked by DIFFERENT code (the first two by the
 * CALLER, the third by the funnel), so any caller that books the amount it PASSED IN rather than
 * the amount the funnel RECORDED double-counts whatever the funnel moved or dropped.
 *
 * The bomb / accumulator / detonation booking sites were left unswept. Four of them book their own
 * pre-funnel amount into `roundPerTargetDamage` + `creditDealt` (+ `perActorDetonation`, and at the
 * timed-burst sites a standing leech payout):
 *
 *   1. `applyPerVictimDetonation`  — bomb portion            (engine.ts, `bombPortion: result.bomb`)
 *   2. `applyPerVictimDetonation`  — inferno/corrosion bypass (`byDirectDamage: false`)
 *   3. `forceDetonateBombOnVictim` — a countdown-reduce forcing a burst (Lingshe)
 *   4. `applyPositionedTimedBurst` — `processBombs` / `processAccumulators` creditDetonation
 *
 * #355 predicted "only the proc-block path can diverge, so the expected outcome is a tripwire, not
 * a fix". That premise is WRONG for the three `byDirectDamage: true` sites. A bomb burst arrives
 * stamped `byDirectDamage: true` with the whole amount in `bombPortion`, and only the two
 * CONSUMABLE steps (Hit Mitigation, Shield Converter) carry a `bombPortion === 0` guard. The
 * incoming-block step, the Protection cascade, and the standing Voron/Orel transform have no such
 * guard, so all three fire on a burst and all three diverge. Protection in particular is live
 * corpus kit (Meatshield / Lionheart), which makes this a real double-count, not a tripwire.
 *
 * Site 2 (`byDirectDamage: false`) IS the predicted tripwire: every divergence step in the funnel
 * is gated on `byDirectDamage`, so `incomingBooked === total` there by construction. The DoT-batch
 * case below pins that and fails the day one of those gates loosens.
 *
 * INSTRUMENT VALIDITY. Each divergence case is paired with a control run that removes ONLY the
 * divergence source (no protector / no block ability) and asserts the identity HOLDS there. Without
 * that pair a broken reader — reading a channel the burst never writes, or a fixture whose bomb
 * never bursts — would report a clean identity and read as a pass. The burst is additionally
 * asserted to have LANDED (a non-zero `bomb-detonated` for the expected victim) so a fixture that
 * silently fails to seed or burst cannot pass vacuously.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { ActiveDoTStack, CombatActor, PendingAccumulator, PendingBomb } from '../state';
import type { Position } from '../../../types/encounters';

const BOMB_DAMAGE = 1000; // stacks × damagePerStack, neutral affinity/detonation mults
const PROTECTOR_DEFENCE = 300; // < the victim's 0 defence, so the redirected chunk is amplified
const PROT_STACKS = 3; // 10%/stack → 30% of the burst redirected

/** A pre-seeded TIMED bomb that bursts on the carrier's OWN next turn (countdown 1). */
const timedBomb = (sourceId: string): PendingBomb => ({
    countdown: 1,
    damagePerStack: BOMB_DAMAGE,
    stacks: 1,
    tier: 100,
    sourceId,
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
});

/** A player team actor. `slots` carries whatever kit the actor should have (a Protection aura, an
 *  incoming-block aura). HP is huge so nothing dies and no death-splash confuses the channels. */
const teamActor = (
    id: string,
    defence: number,
    slots: ShipSkills['slots'] = []
): TeamActorEngineInput => ({
    id,
    speed: 100,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    role: 'ATTACKER',
    walk: {
        shipSkills: { slots },
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence,
            hp: 1_000_000_000,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

/** Aura-granted Protection (the real Meatshield shape — `selfBuffStacksForOwner` sees it, unlike
 *  `snapshot().activeSelfBuffs`, which only surfaces scheduled 'attacker'-owned buffs). */
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
        } as Ability,
    ],
});

/** A self-aura incoming-block that ALWAYS procs and blocks 100%. */
const fullBlockAuraPassive = (): ShipSkills['slots'][number] => ({
    slot: 'passive',
    abilities: [
        {
            id: 'full-block-self-aura',
            type: 'incoming-block',
            target: 'self',
            trigger: 'on-cast',
            conditions: [],
            config: {
                type: 'incoming-block',
                condition: 'always',
                procChance: 1,
                blockPct: 1.0,
                oncePerRound: false,
            },
        } as Ability,
    ],
});

/** An inert positioned enemy: high HP, no offence, so it never touches the player channels. It
 *  exists only because a run needs an opposing roster. */
const inertEnemy = () =>
    ({
        id: 'enemy-1',
        stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position: 'M1',
        target: { raw: 'front', side: 'enemy', selection: 'front' } as ParsedTarget,
        pattern: { raw: 'base', shape: 'base', range: 0, modifiers: {} } as ParsedPattern,
        shipSkills: { slots: [] } as ShipSkills,
    }) as unknown as NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** The focus deals no damage — the bomb burst is the ONLY thing writing the player channels, so
 *  the identity below reads the burst and nothing else. */
const BASE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [inertEnemy()],
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
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
    healModifier: 0,
    healTargetId: 'victim-1',
    mode: 'battle',
    position: 'M2',
    ...overrides,
});

/** Roster: `victim-1` at M4 carries the bomb; `helper-1` at M1 carries `helperSlots`. The bomb is
 *  seeded straight onto the victim actor, which is how every timed-detonation suite stages one. */
const fixture = (helperSlots: ShipSkills['slots'], helperDefence = 0): CombatEngineInput =>
    BASE({
        teamActors: [
            { ...teamActor('victim-1', 0), position: 'M4' },
            { ...teamActor('helper-1', helperDefence, helperSlots), position: 'M1' },
        ],
        __testTapActors: (actors: CombatActor[]) => {
            actors.find((a) => a.id === 'victim-1')?.pendingBombs.push(timedBomb('enemy-1'));
        },
    });

/** The three channels for round 1 plus the burst evidence, summed across every actor. */
const channels = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const bursts: CombatEvent[] = [];
    bus.on('bomb-detonated', (e) => bursts.push(e as CombatEvent));
    const r1 = runCombat({ ...input, bus }).rounds[0];
    const taken = r1.perTargetDamage ?? {};
    const incoming = r1.perActorIncoming ?? {};
    const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);
    // Every actor's dealt map, not just one attacker's: a redirected chunk is credited to the
    // original `cause.killerId`, and reading a single hard-coded attacker row would silently miss a
    // chunk booked under a different id.
    const dealtSum = Object.values(r1.perTargetDealt ?? {}).reduce(
        (s, byVictim) => s + sum(byVictim),
        0
    );
    return {
        taken,
        incoming,
        bursts,
        takenSum: sum(taken),
        dealtSum,
        incomingSum: sum(
            Object.fromEntries(Object.entries(incoming).map(([k, v]) => [k, v.incoming]))
        ),
    };
};

describe('timed bomb burst booking reconciles with what the funnel recorded', () => {
    it('CONTROL: with no protector and no block, the burst books identically on all three channels', () => {
        const c = channels(fixture([]));

        // The burst LANDED — without this the identity below could hold vacuously on an empty board.
        expect(c.bursts).toHaveLength(1);
        expect(c.bursts[0]).toMatchObject({ victimId: 'victim-1', damage: BOMB_DAMAGE });

        expect(c.takenSum).toBeCloseTo(BOMB_DAMAGE, 6);
        expect(c.dealtSum).toBeCloseTo(c.incomingSum, 6);
        expect(c.takenSum).toBeCloseTo(c.incomingSum, 6);
    });

    it('books only the non-redirected remainder on the victim when an ally holds Protection', () => {
        const c = channels(fixture([protectionAuraPassive(PROT_STACKS)], PROTECTOR_DEFENCE));

        // Still one real burst of the full amount — Protection moves intake between rows, it does
        // not change what the bomb was worth.
        expect(c.bursts).toHaveLength(1);
        expect(c.bursts[0]).toMatchObject({ victimId: 'victim-1', damage: BOMB_DAMAGE });

        // The protector genuinely took a chunk: the divergence source is armed, not inert.
        expect(c.incoming['helper-1']?.incoming ?? 0).toBeGreaterThan(0);

        // The victim's row must read what the funnel recorded for the victim, not the pre-cascade
        // burst. Pre-fix this read the full BOMB_DAMAGE with the chunk ALSO on the protector's row.
        expect(c.taken['victim-1']).toBeCloseTo(c.incoming['victim-1'].incoming, 6);
        expect(c.taken['helper-1']).toBeCloseTo(c.incoming['helper-1'].incoming, 6);
        expect(c.dealtSum).toBeCloseTo(c.incomingSum, 6);
        expect(c.takenSum).toBeCloseTo(c.incomingSum, 6);
    });

    it('books nothing on the victim when its own incoming-block fully blocks the burst', () => {
        const c = channels(
            BASE({
                teamActors: [
                    { ...teamActor('victim-1', 0, [fullBlockAuraPassive()]), position: 'M4' },
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    actors
                        .find((a) => a.id === 'victim-1')
                        ?.pendingBombs.push(timedBomb('enemy-1'));
                },
            })
        );

        // The burst still fires and still announces its full pre-block value in the log.
        expect(c.bursts).toHaveLength(1);
        expect(c.bursts[0]).toMatchObject({ victimId: 'victim-1', damage: BOMB_DAMAGE });

        // A 100% block means the funnel recorded zero intake, so both caller-booked channels must
        // read zero too. Pre-fix both read the full BOMB_DAMAGE against a 0 `.incoming`.
        expect(c.incoming['victim-1']?.incoming ?? 0).toBeCloseTo(0, 6);
        expect(c.takenSum).toBeCloseTo(0, 6);
        expect(c.dealtSum).toBeCloseTo(0, 6);
    });
});

// ───────────────────────────────────────────────────────────────────────────────────────
// `applyPerVictimDetonation` — the skill-triggered detonate cast, the two sites #355 names.
//
// Staged on the ENEMY side (a positional player detonate cast, its victims the positioned
// enemies), because that is the only shape that reaches this loop. `protectorsFor` is
// side-agnostic, so an enemy holding an aura Protection protects its enemy allies exactly as a
// player one does.
// ───────────────────────────────────────────────────────────────────────────────────────

const FOCUS_ATTACK = 100; // tiny firing hit — marks victims "hit" without killing anything

let dbrIdc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `dbr${++dbrIdc}`,
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

/** A basic attack plus a detonate of the given kind — the shape that drives the per-victim
 *  detonation recipe in positional mode. */
const detonateSlot = (dotType: 'bomb' | 'inferno' | 'corrosion'): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } }),
        ab({ type: 'detonate-dot', config: { type: 'detonate-dot', dotType, powerPct: 100 } }),
    ],
});

/** A positioned enemy victim. `slots` lets one of them carry the Protection aura. */
const enemyAt = (id: string, position: Position, defence = 0, slots: ShipSkills['slots'] = []) =>
    ({
        id,
        stats: { attack: 0, crit: 0, critDamage: 0, defence, hp: 1_000_000_000, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        shipSkills: { slots } as ShipSkills,
    }) as unknown as NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** A pre-seeded bomb the detonate cast consumes (countdown never reaches 0 on its own). */
const detonatableBomb = (): PendingBomb => ({
    countdown: 5,
    damagePerStack: BOMB_DAMAGE,
    stacks: 1,
    tier: 100,
    sourceId: 'attacker',
    affinityMult: 1,
    detonationDamageModifier: 0,
    splashModifier: 0,
});

/** A pre-seeded corrosion entry the corrosion-detonate consumes. Its exact payout is a function of
 *  the victim's HP, so the tests read the amount off the `dot-detonated` event rather than
 *  duplicating the formula. */
const corrosionEntry = (): ActiveDoTStack => ({
    stacks: 1,
    tier: 100,
    remainingRounds: 2,
    sourceId: 'attacker',
});

/** Focus at M4 fires a Line-Range-1 detonate at `front`: origin M4 (full hit) + covered M3 (half).
 *  `enemy-front` (M4) is the CARRIER; `enemy-mid` (M3) is the PROTECTOR. */
const detonateFixture = (
    dotType: 'bomb' | 'corrosion',
    seed: (victim: CombatActor) => void
): CombatEngineInput => ({
    attack: FOCUS_ATTACK,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [detonateSlot(dotType)] },
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
    healModifier: 0,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: { raw: 'front', side: 'enemy', selection: 'front' } as ParsedTarget,
    pattern: { raw: 'line-range-1', shape: 'line', range: 1, modifiers: {} } as ParsedPattern,
    enemyAttackers: [
        enemyAt('enemy-front', 'M4'),
        enemyAt('enemy-mid', 'M3', PROTECTOR_DEFENCE, [protectionAuraPassive(PROT_STACKS)]),
    ],
    __testTapActors: (actors: CombatActor[]) => {
        const carrier = actors.find((a) => a.id === 'enemy-front');
        if (carrier) seed(carrier);
    },
});

/** Round-1 channels plus the detonation events, for a detonate-cast run. */
const detonateChannels = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const bombEvents: CombatEvent[] = [];
    const dotEvents: CombatEvent[] = [];
    bus.on('bomb-detonated', (e) => bombEvents.push(e as CombatEvent));
    bus.on('dot-detonated', (e) => dotEvents.push(e as CombatEvent));
    const r1 = runCombat({ ...input, bus }).rounds[0];
    const taken = r1.perTargetDamage ?? {};
    const incoming = r1.perActorIncoming ?? {};
    const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);
    const dealtSum = Object.values(r1.perTargetDealt ?? {}).reduce(
        (s, byVictim) => s + sum(byVictim),
        0
    );
    return {
        taken,
        incoming,
        bombEvents,
        dotEvents,
        detonation: r1.perActorDetonation ?? {},
        takenSum: sum(taken),
        dealtSum,
        incomingSum: sum(
            Object.fromEntries(Object.entries(incoming).map(([k, v]) => [k, v.incoming]))
        ),
    };
};

describe('skill-triggered per-victim detonation booking (applyPerVictimDetonation)', () => {
    it('books the BOMB portion post-cascade when an enemy ally holds Protection', () => {
        dbrIdc = 0;
        const c = detonateChannels(
            detonateFixture('bomb', (v) => v.pendingBombs.push(detonatableBomb()))
        );

        // The detonation happened, for the full pre-funnel amount, on the carrier.
        expect(c.bombEvents).toHaveLength(1);
        expect(c.bombEvents[0]).toMatchObject({
            victimId: 'enemy-front',
            damage: BOMB_DAMAGE,
        });
        // The protector is armed: it took intake that is NOT its own covered firing hit.
        expect(c.incoming['enemy-mid'].incoming).toBeGreaterThan(0.5 * FOCUS_ATTACK);

        // Every caller-booked row equals what the funnel recorded for that actor, and the whole
        // board reconciles. Pre-fix the carrier's row carried the full burst while the redirected
        // slice ALSO sat on the protector's row.
        expect(c.taken['enemy-front']).toBeCloseTo(c.incoming['enemy-front'].incoming, 6);
        expect(c.taken['enemy-mid']).toBeCloseTo(c.incoming['enemy-mid'].incoming, 6);
        expect(c.dealtSum).toBeCloseTo(c.incomingSum, 6);
        expect(c.takenSum).toBeCloseTo(c.incomingSum, 6);

        // The detonation tally stays on the same basis as `perTargetDealt` — the DPS page derives
        // `direct = dealt - detonation - dots`, so the two folds must not drift. The redirected
        // slice IS detonation damage the caster delivered, so it counts here even though it landed
        // on the protector's row.
        //
        // Pinned as a DIFFERENTIAL against an otherwise-identical run with no bomb seeded, not
        // against BOMB_DAMAGE. The tally is what the burst DELIVERED, and a redirected chunk is
        // re-mitigated on the PROTECTOR's defence, so the delivered total is legitimately below the
        // pre-funnel 1000 (here ~977: the victim keeps 70% unmitigated and the protector's 30%
        // shrinks on its own 300 defence). Re-deriving that factor in the test would just duplicate
        // `protectionCascade`; the differential measures it instead.
        const firingOnly = detonateChannels(detonateFixture('bomb', () => {}));
        expect(firingOnly.bombEvents).toHaveLength(0); // control really has no burst
        expect(c.detonation['attacker']).toBeCloseTo(c.incomingSum - firingOnly.incomingSum, 6);
        // And it is a real, large share of the burst — not a rounding sliver that would let a
        // tally stuck near zero pass the differential above.
        expect(c.detonation['attacker']).toBeGreaterThan(0.9 * BOMB_DAMAGE);
        expect(c.detonation['attacker']).toBeLessThan(BOMB_DAMAGE);
    });

    it('TRIPWIRE: the inferno/corrosion bypass never redirects, so the victim books it whole', () => {
        dbrIdc = 0;
        const c = detonateChannels(
            detonateFixture('corrosion', (v) => v.corrosionEntries.push(corrosionEntry()))
        );

        // The bypass fired. Its amount is read off the event rather than re-deriving the corrosion
        // payout formula here.
        expect(c.dotEvents).toHaveLength(1);
        const bypass = (c.dotEvents[0] as { damage: number }).damage;
        expect(bypass).toBeGreaterThan(0);

        // THE TRIPWIRE. The bypass apply passes `byDirectDamage: false`, and every step of the
        // funnel that can move or shrink a hit — incoming-block, the Protection cascade, both
        // transforms — is gated on `byDirectDamage`. So the bypass reaches the victim's own row
        // UNSPLIT even with a live protector standing right next to it.
        //
        // The protector IS live and IS redirecting: the carrier's FIRING hit keeps only 70% of
        // FOCUS_ATTACK, which is the 1 - 0.1 × PROT_STACKS remainder. That factor is what makes
        // this a real tripwire rather than a fixture with no protector in it — if a future change
        // let the cascade see a DoT-typed apply, the bypass would split and this sum would drop.
        const firingRemainder = (1 - 0.1 * PROT_STACKS) * FOCUS_ATTACK;
        expect(c.taken['enemy-front']).toBeCloseTo(firingRemainder + bypass, 6);
        expect(c.taken['enemy-front']).toBeCloseTo(c.incoming['enemy-front'].incoming, 6);

        expect(c.dealtSum).toBeCloseTo(c.incomingSum, 6);
        expect(c.takenSum).toBeCloseTo(c.incomingSum, 6);
        expect(c.detonation['attacker']).toBeCloseTo(bypass, 6);
    });
});

// ───────────────────────────────────────────────────────────────────────────────────────
// The two remaining sites of the same class: the ACCUMULATOR burst (`processAccumulators`'s
// creditDetonation) and the FORCED burst (`forceDetonateBombOnVictim`, Lingshe's countdown-reduce
// driving a bomb to 0). Both book by hand exactly like the bomb-burst site, so both need their own
// end-to-end case — a shared accessor being correct does not prove each caller reaches it.
// ───────────────────────────────────────────────────────────────────────────────────────

const ACC_POOL = 10_000;
const ACC_PCT = 10; // burst = (accumulated + gatheredDirect) × pct/100 = 1000, since the focus
// deals no damage and `gatheredDirect` reads the OPPOSING (enemy) side, which is inert here.

const timedAccumulator = (): PendingAccumulator => ({
    accumulated: ACC_POOL,
    pct: ACC_PCT,
    roundsRemaining: 1, // bursts on the carrier's own turn, this round
    sourceId: 'enemy-1',
});

describe('accumulator burst booking (processAccumulators creditDetonation)', () => {
    it('books the post-cascade remainder on the victim when an ally holds Protection', () => {
        const run = (withProtector: boolean) => {
            const bus = createEventBus();
            const bursts: CombatEvent[] = [];
            bus.on('accumulator-detonated', (e) => bursts.push(e as CombatEvent));
            const r1 = runCombat({
                ...BASE({
                    teamActors: [
                        { ...teamActor('victim-1', 0), position: 'M4' },
                        {
                            ...teamActor(
                                'helper-1',
                                withProtector ? PROTECTOR_DEFENCE : 0,
                                withProtector ? [protectionAuraPassive(PROT_STACKS)] : []
                            ),
                            position: 'M1',
                        },
                    ],
                    __testTapActors: (actors: CombatActor[]) => {
                        actors
                            .find((a) => a.id === 'victim-1')
                            ?.pendingAccumulators.push(timedAccumulator());
                    },
                }),
                bus,
            }).rounds[0];
            const taken = r1.perTargetDamage ?? {};
            const incoming = r1.perActorIncoming ?? {};
            const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);
            return {
                bursts,
                taken,
                incoming,
                takenSum: sum(taken),
                dealtSum: Object.values(r1.perTargetDealt ?? {}).reduce(
                    (s, byVictim) => s + sum(byVictim),
                    0
                ),
                incomingSum: sum(
                    Object.fromEntries(Object.entries(incoming).map(([k, v]) => [k, v.incoming]))
                ),
                detonation: r1.perActorDetonation ?? {},
            };
        };

        // CONTROL: no protector → nothing to diverge, all three channels agree, and the burst is
        // the only damage in the run so its value is readable outright.
        const ctl = run(false);
        expect(ctl.bursts).toHaveLength(1);
        const BURST = (ctl.bursts[0] as { damage: number }).damage;
        expect(BURST).toBeCloseTo((ACC_POOL * ACC_PCT) / 100, 6);
        expect(ctl.takenSum).toBeCloseTo(BURST, 6);
        expect(ctl.dealtSum).toBeCloseTo(ctl.incomingSum, 6);

        // WITH a protector: same burst, but the victim's row must read only what it kept.
        const c = run(true);
        expect(c.bursts).toHaveLength(1);
        expect(c.bursts[0]).toMatchObject({ victimId: 'victim-1', damage: BURST });
        expect(c.incoming['helper-1'].incoming).toBeGreaterThan(0); // divergence source armed
        expect(c.taken['victim-1']).toBeCloseTo(c.incoming['victim-1'].incoming, 6);
        expect(c.taken['victim-1']).toBeLessThan(BURST); // a chunk really left the victim's row
        expect(c.dealtSum).toBeCloseTo(c.incomingSum, 6);
        expect(c.takenSum).toBeCloseTo(c.incomingSum, 6);
        // The tally is what the burst DELIVERED across both rows (below the pre-funnel BURST
        // because the redirected chunk re-mitigates on the protector's own defence).
        expect(c.detonation['enemy-1']).toBeCloseTo(c.incomingSum, 6);
        expect(c.detonation['enemy-1']).toBeLessThan(BURST);
    });
});

/** Lingshe's charged skill: reduce every enemy bomb by 1 turn; one reduced to 0 detonates. This is
 *  the ONLY route to `forceDetonateBombOnVictim`. */
const countdownReduceCharged = (): ShipSkills['slots'][number] => ({
    slot: 'charged',
    abilities: [
        ab({
            type: 'bomb-countdown-reduce',
            target: 'all-enemies',
            config: { type: 'bomb-countdown-reduce', turns: 1 },
        }),
    ],
});

describe('forced bomb detonation booking (forceDetonateBombOnVictim)', () => {
    it('books the post-cascade remainder when the forced victim has a Protection-holding ally', () => {
        dbrIdc = 0;
        const run = (withProtector: boolean) => {
            const bus = createEventBus();
            const bursts: CombatEvent[] = [];
            bus.on('bomb-detonated', (e) => bursts.push(e as CombatEvent));
            const r1 = runCombat({
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                chargeCount: 1,
                startCharged: true,
                hasChargedSkill: true,
                shipSkills: { slots: [countdownReduceCharged()] },
                numRounds: 1,
                selfBuffs: [],
                enemyDebuffs: [],
                selfDotModifier: 0,
                defensePenetrationBuff: 0,
                affinityDamageModifier: 0,
                affinityCritCap: 100,
                affinityCritPenalty: 0,
                defence: 0,
                hp: 1_000_000_000,
                healModifier: 0,
                healTargetId: 'attacker',
                mode: 'healing',
                position: 'M4',
                target: { raw: 'front', side: 'enemy', selection: 'front' } as ParsedTarget,
                pattern: {
                    raw: 'base',
                    shape: 'base',
                    range: 0,
                    modifiers: {},
                } as ParsedPattern,
                enemyAttackers: [
                    enemyAt('enemy-front', 'M4'),
                    withProtector
                        ? enemyAt('enemy-mid', 'M3', PROTECTOR_DEFENCE, [
                              protectionAuraPassive(PROT_STACKS),
                          ])
                        : enemyAt('enemy-mid', 'M3'),
                ],
                __testTapActors: (actors: CombatActor[]) => {
                    // countdown 1 → the reduce drives it to 0 → forced burst.
                    actors
                        .find((a) => a.id === 'enemy-front')
                        ?.pendingBombs.push({ ...detonatableBomb(), countdown: 1 });
                },
                bus,
            }).rounds[0];
            const taken = r1.perTargetDamage ?? {};
            const incoming = r1.perActorIncoming ?? {};
            const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);
            return {
                bursts,
                taken,
                incoming,
                takenSum: sum(taken),
                dealtSum: Object.values(r1.perTargetDealt ?? {}).reduce(
                    (s, byVictim) => s + sum(byVictim),
                    0
                ),
                incomingSum: sum(
                    Object.fromEntries(Object.entries(incoming).map(([k, v]) => [k, v.incoming]))
                ),
            };
        };

        // CONTROL: the forced burst fires and books identically on all three channels.
        const ctl = run(false);
        expect(ctl.bursts).toHaveLength(1);
        expect(ctl.bursts[0]).toMatchObject({ victimId: 'enemy-front', damage: BOMB_DAMAGE });
        expect(ctl.takenSum).toBeCloseTo(BOMB_DAMAGE, 6);
        expect(ctl.dealtSum).toBeCloseTo(ctl.incomingSum, 6);

        // WITH a protector: the victim keeps only the remainder, and the board reconciles.
        const c = run(true);
        expect(c.bursts).toHaveLength(1);
        expect(c.incoming['enemy-mid'].incoming).toBeGreaterThan(0); // divergence source armed
        expect(c.taken['enemy-front']).toBeCloseTo(c.incoming['enemy-front'].incoming, 6);
        expect(c.taken['enemy-front']).toBeLessThan(BOMB_DAMAGE);
        expect(c.dealtSum).toBeCloseTo(c.incomingSum, 6);
        expect(c.takenSum).toBeCloseTo(c.incomingSum, 6);
    });
});
