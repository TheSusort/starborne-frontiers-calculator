/**
 * #435 acceptance — Chimei's over-repair redirect fires off her START-OF-ROUND PASSIVE repair,
 * and both on-repair implants fire off a repair performed from a live trigger.
 *
 * THE DEFECT THIS PINS (#434's measurement). Over three rounds only Chimei's ACTIVE 9% repair
 * reached `heal-performed`; her R2 `start-of-round` 10% repair emitted `reactive-heal-performed`,
 * which the `on-own-repair-to-ally` trigger did not listen to. So the redirect — and Font of
 * Power, and Abundant Renewal — saw her cast repairs only, and were inert for every repair she
 * performed from a passive.
 *
 * ⚠️ WHAT MAKES THIS FILE A MEASUREMENT AND NOT A GREEN TICK. The redirect ALSO fires off her
 * active cast (correct per R1/R4 — a full-HP ally still redirects), and that path worked before
 * this epic. A fixture where the active over-repairs therefore passes with the fix REVERTED and
 * measures nothing. Two independent devices keep this file honest:
 *
 *   1. The AoE (`AOE_HIT`, 16,000/round) lands on EVERY player actor before Chimei's turn and
 *      exceeds her active's 9,000 repair, so the active over-repairs nobody in any round and the
 *      redirect has no cast-side source at all. `it('never fires off a cast repair ...')` asserts
 *      that directly: every redirect event in the run must be un-stamped by `duringTurnOf`, which
 *      is the tripwire if a later edit perturbs the HP trajectory.
 *   2. Every ruling assertion is scoped to the START-OF-ROUND WINDOW — the events of a round that
 *      precede that round's first `turn-started`. Nothing in that window can have come from a
 *      cast: no actor has acted yet. This scoping is load-bearing for the Font of Power case in
 *      particular, since Font procs off ANY repair to an ally and so still fires from her cast
 *      during her own turn even with the fix reverted.
 *
 * REVERT PROBE (2026-08-30). Commenting out the `bus.on('reactive-heal-performed', ...)`
 * subscription in triggers.ts's `case 'on-own-repair-to-ally':` reddens all nine cases below:
 * zero redirect events anywhere in the run (the active's `heal-performed` still enqueues, but
 * with no ally over-repair Task 3's zero-sum guard resolves nobody), and no shield / no Power
 * Infused Nanobots in any start-of-round window.
 *
 * OWNER RULINGS ASSERTED (2026-08-30) — do not re-derive from the code:
 *   R1  a repair on an ally already at FULL HP still redirects the whole wasted amount;
 *       "damaged" is not a gate.
 *   R2  the redirect's own excess is lost (no cascade) EXCEPT that Abundant Renewal still
 *       converts it to a shield.
 *   R3  the recipient is plain lowest current HP%, measured AFTER the repair, INCLUDING the ally
 *       just over-repaired. Caster excluded.
 *   R4  ONE redirect per repair, sized by the SUM of everything that repair over-repaired.
 *   R-A a repair is a repair: Font of Power and Abundant Renewal fire off PASSIVE/reactive
 *       repairs, not only casts.
 *   R-B when the redirect over-repairs, both implants observe it; only a SECOND redirect is
 *       forbidden.
 *
 * ⏸ OPEN GAME RULING — whether the redirect scales with heal modifiers is UNDECIDED (the repo
 * owner is asking the developers). Every sizing assertion here is therefore RELATIONAL —
 * "the redirect equals the over-repair the engine observed", never a hard-coded figure — and the
 * fixture carries NO heal modifier on either side: `healModifier` is left at its 0 default, no
 * Repair Up/Down is seeded, and neither implant touches repair magnitude (Font of Power grants
 * flat attack, Abundant Renewal grants a shield). Chimei's own `Attack Up III` /
 * `Out. Detonation Damage Up III` are the only buffs in play and neither scales a repair.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';
import { csvAvailable, loadShipSkillRecords } from '../../../../scripts/lib/shipSkillCsv';
import { setRateGateRng, setKeyedRng } from '../../calculators/rateAccumulator';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import type { Ability } from '../../../types/abilities';
import type { ShipTypeName } from '../../../constants/shipTypes';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

function requireReferenceData(): void {
    if (!csvAvailable()) {
        throw new Error(
            'docs/ship-skills.csv is missing from this worktree (gitignored reference data) — ' +
                "this test resolves Chimei's real skill text from it."
        );
    }
}

/** Chimei is the focus actor; the engine ids her 'attacker'. */
const CHIMEI_ID = 'attacker';
/** The Stealthed ally the start-of-round passive repairs — and over-repairs. */
const TOPPED_ID = 'topped';
/** A second Stealthed ally, present only in the R4 fixture. */
const TOPPED2_ID = 'topped2';
/** The un-Stealthed ally the passive never reaches: the redirect's recipient. */
const LOW_ID = 'low';

const NANOBOTS = 'Power Infused Nanobots';

// Chimei's max HP. Her passive repairs 10% of it (10,000) and her active 9% (9,000).
const CHIMEI_MAX_HP = 100_000;
const ALLY_MAX_HP = 40_000;
/**
 * Per-round AoE damage on every player actor, from an enemy fast enough to act before Chimei.
 *
 * > 9,000 by construction: after this hit no ally can absorb Chimei's active repair fully, so the
 * ACTIVE over-repairs nobody and every redirect in the run is passive-driven. That is what makes
 * the revert probe redden — see the header. 16,000 rather than 10,000 because the R2/R-B fixture's
 * Abundant Renewal shields absorb part of the hit, and the margin has to survive that.
 */
const AOE_HIT = 16_000;

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const noopActive = (): Ability => ({
    id: 'noop',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
});

const gearPiece = (over: Partial<GearPiece>): GearPiece => ({
    id: 'piece',
    slot: 'weapon',
    level: 16,
    stars: 6,
    rarity: 'legendary',
    mainStat: null,
    subStats: [],
    setBonus: null,
    ...over,
});

/** The two on-repair implants, at legendary. Neither modifies repair MAGNITUDE — see the open
 *  ruling in the header. */
const PIECES: Record<string, GearPiece> = {
    font: gearPiece({ id: 'font', slot: 'implant_major', setBonus: 'FONT_OF_POWER' }),
    renewal: gearPiece({ id: 'renewal', slot: 'implant_minor', setBonus: 'ABUNDANT_RENEWAL' }),
};

interface ChimeiKit {
    skills: CombatEngineInput['shipSkills'];
    /** `Ability.id` of the R2 start-of-round 10% repair (the LIVE-TRIGGER repair under test). */
    passiveRepairId: string;
    /** `Ability.id` of the R2 over-repair redirect. */
    redirectId: string;
}

/**
 * Chimei's REAL kit off `docs/ship-skills.csv`, optionally wearing both on-repair implants.
 *
 * The two ability ids are read off THIS build. `nextId()` runs off a never-reset module counter
 * (see the `sourceAbilityId` warning on the event), so an id is a function of how many kits were
 * built before it in the process — hard-coding one would make the file order-dependent.
 */
function chimeiKit(opts: { implants?: boolean } = {}): ChimeiKit {
    const rec = loadShipSkillRecords().find((r) => r.name.toUpperCase() === 'CHIMEI');
    if (!rec) throw new Error('docs/ship-skills.csv: no record for "Chimei"');
    const skills = buildShipAbilitiesWithEquipment(
        {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...({} as any),
            // 4 refits → the R2 passive is the refit-active one, which is the text carrying both
            // the Stealth-gated start-of-round repair and the redirect clause.
            refits: [{}, {}, {}, {}],
            equipment: {},
            implants: opts.implants ? { implant_major: 'font', implant_minor: 'renewal' } : {},
            activeSkillText: rec.active,
            chargeSkillText: rec.charge,
            chargeSkillCharge: rec.chargeCharge,
            firstPassiveSkillText: rec.passives[0],
            secondPassiveSkillText: rec.passives[1],
            thirdPassiveSkillText: rec.passives[2],
        } as Ship,
        (id) => PIECES[id]
    );
    const passives = skills.slots.find((s) => s.slot === 'passive')?.abilities ?? [];
    const passiveRepair = passives.find(
        (a) => a.config.type === 'heal' && a.trigger === 'start-of-round'
    );
    const redirect = passives.find(
        (a) => a.config.type === 'heal' && a.target === 'lowest-hp-ally'
    );
    if (!passiveRepair || !redirect) {
        throw new Error(
            "Chimei's parsed kit is missing the start-of-round repair or the over-repair redirect " +
                '— the fixture cannot measure what it exists to measure.'
        );
    }
    return { skills, passiveRepairId: passiveRepair.id, redirectId: redirect.id };
}

/** A permanent self-Stealth on the ally's OWN status store — the axis Chimei's `hasStatus:
 *  'Stealth'` recipient filter reads. Seeded rather than waited for: her end-of-round grant only
 *  reaches allies below 40% HP, which this fixture's allies never are. Without it the passive
 *  repair reaches NOBODY and every case here is vacuous. (Not via `TeamActorInput.selfBuffs` —
 *  those are keyed to the ATTACKER's turns and would put the Stealth on Chimei; see the sibling
 *  fixture `chimeiRecipientFilter.integration.test.ts`.) */
const stealthAura = (ownerId: string): Ability => ({
    id: `${ownerId}-stealth-aura`,
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Stealth',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 'recurring',
    },
});

/** A same-side ally that only ever RECEIVES. Speed 1 — it acts after Chimei, so it never
 *  perturbs the state the start-of-round drain reads. */
const ally = (opts: {
    id: string;
    position: Position;
    stealthed?: boolean;
}): TeamActorEngineInput =>
    ({
        id: opts.id,
        speed: 1,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position: opts.position,
        role: 'ATTACKER' as ShipTypeName,
        target: parsedTarget('front'),
        pattern: basePattern(),
        walk: {
            shipSkills: {
                slots: [
                    { slot: 'active', abilities: [noopActive()] },
                    ...(opts.stealthed
                        ? [{ slot: 'passive' as const, abilities: [stealthAura(opts.id)] }]
                        : []),
                ],
            },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: ALLY_MAX_HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as unknown as TeamActorEngineInput;

/** The one enemy: a genuine board-wide AoE (`shape: 'all'`, not `basePattern()`, which would
 *  resolve to a single victim) fast enough to act before Chimei every round. */
const aoeEnemy = (hit: number = AOE_HIT): CombatEngineInput['enemyAttackers'][number] => ({
    id: 'aoe',
    stats: { attack: hit, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 1000 },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    target: parsedTarget('all'),
    pattern: { raw: 'all', shape: 'all', range: 'all', modifiers: {} },
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'aoe-hit',
                        type: 'damage',
                        target: 'enemy',
                        trigger: 'on-cast',
                        conditions: [],
                        config: { type: 'damage', multiplier: 100 },
                    },
                ],
            },
        ],
    },
});

interface Fight {
    /** Every captured event, in emission order. */
    events: CombatEvent[];
    kit: ChimeiKit;
}

/**
 * Run the fixture and capture the ordered event stream.
 *
 * POSITIONAL by construction: Chimei sits at M3, her allies at M4/M2/M1 and the enemy at M4
 * (column 4 is the FRONT). `adjacentAllyIds` falls back to the whole living side when positions
 * are absent, and a non-positional fixture cannot distinguish recipient routing at all.
 *
 * `mode: 'healing'` + `perRecipientHealApply: true` are what populate `perTarget[].overheal` on
 * `reactive-heal-performed`; outside healing mode `applyHealToTarget` never runs and the clipped
 * excess this whole epic scales from is simply absent.
 */
function runFight(opts: {
    allies: TeamActorEngineInput[];
    implants?: boolean;
    rounds?: number;
    /** The cast-arm fixture lowers this so nobody is badly hurt when Chimei casts — see that
     *  describe block. Every other case in this file relies on the 16,000 default. */
    aoeHit?: number;
    /** Put a permanent Stealth on CHIMEI, so her Stealth-gated start-of-round repair reaches
     *  HER — the caster-only-repair fixture. Same self-targeted aura the allies use, appended to
     *  her own passive slot so the status lands in her own store. */
    stealthChimei?: boolean;
}): Fight {
    const kit = chimeiKit({ implants: opts.implants });
    const skills = opts.stealthChimei
        ? {
              ...kit.skills,
              slots: kit.skills.slots.map((slot) =>
                  slot.slot === 'passive'
                      ? { ...slot, abilities: [...slot.abilities, stealthAura(CHIMEI_ID)] }
                      : slot
              ),
          }
        : kit.skills;
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    const captured: CombatEvent['type'][] = [
        'turn-started',
        'heal-performed',
        'reactive-heal-performed',
        'shield-applied',
        'buff-applied',
    ];
    for (const type of captured) bus.on(type, (e) => events.push(e));
    runCombat({
        attack: 10_000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        shipSkills: skills,
        numRounds: opts.rounds ?? 2,
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
        hp: CHIMEI_MAX_HP,
        healTargetId: CHIMEI_ID,
        mode: 'healing',
        perRecipientHealApply: true,
        position: 'M3',
        target: parsedTarget('front'),
        pattern: basePattern(),
        speed: 100,
        teamActors: opts.allies,
        enemyAttackers: [aoeEnemy(opts.aoeHit)],
        bus,
    } as unknown as CombatEngineInput);
    return { events, kit };
}

/**
 * The START-OF-ROUND WINDOW of round `round`: that round's events up to its first `turn-started`.
 *
 * Nothing in this window can have come from a cast — no actor has taken a turn yet — so it is the
 * one slice of the stream in which a repair, a redirect, a shield or a proc can ONLY have come
 * from the start-of-round passive chain.
 */
function startOfRoundWindow(events: CombatEvent[], round: number): CombatEvent[] {
    const inRound = events.filter((e) => 'round' in e && e.round === round);
    const firstTurn = inRound.findIndex((e) => e.type === 'turn-started');
    return firstTurn === -1 ? inRound : inRound.slice(0, firstTurn);
}

type ReactiveHeal = Extract<CombatEvent, { type: 'reactive-heal-performed' }>;
type ShieldApplied = Extract<CombatEvent, { type: 'shield-applied' }>;
type BuffApplied = Extract<CombatEvent, { type: 'buff-applied' }>;

/** Repairs Chimei performed with the named ability. */
const repairsBy = (events: CombatEvent[], abilityId: string): ReactiveHeal[] =>
    events.filter(
        (e): e is ReactiveHeal =>
            e.type === 'reactive-heal-performed' &&
            e.casterId === CHIMEI_ID &&
            e.sourceAbilityId === abilityId
    );

const shields = (events: CombatEvent[]): ShieldApplied[] =>
    events.filter((e): e is ShieldApplied => e.type === 'shield-applied');

const nanobotRecipients = (events: CombatEvent[]): string[] =>
    events
        .filter((e): e is BuffApplied => e.type === 'buff-applied' && e.buffName === NANOBOTS)
        .map((e) => e.actorId);

/** Summed clipped excess of a repair across EVERY recipient, Chimei included — what R4 says the
 *  redirect is sized from (owner ruling 2026-08-31), read off the engine's own event rather than
 *  recomputed. In the Stealth-gated fixtures below she is never a recipient of her own passive, so
 *  this equalled the ally-only sum before the ruling too; the caster-only fixture at the bottom of
 *  the file is where the difference is measured. */
const totalOverheal = (e: ReactiveHeal): number =>
    e.perTarget.reduce((sum, pt) => sum + (pt.overheal ?? 0), 0);

/** One Stealthed ally (over-repaired by the passive) and one un-Stealthed ally (the redirect's
 *  recipient). The Stealthed one is at the FRONT. */
const ONE_STEALTHED = (): TeamActorEngineInput[] => [
    ally({ id: TOPPED_ID, position: 'M4', stealthed: true }),
    ally({ id: LOW_ID, position: 'M1' }),
];

describe('#435 acceptance — the redirect fires off Chimei’s start-of-round passive repair', () => {
    beforeAll(requireReferenceData);

    // The headline case, and the reason this file exists: before #434/#435 the start-of-round
    // repair emitted an event nothing on `on-own-repair-to-ally` listened to, so this window was
    // empty of redirects no matter how much the passive wasted.
    it('redirects the over-repair from her start-of-round passive repair', () => {
        const { events, kit } = runFight({ allies: ONE_STEALTHED() });

        const redirects = events.filter(
            (e): e is ReactiveHeal =>
                e.type === 'reactive-heal-performed' &&
                e.casterId === CHIMEI_ID &&
                e.sourceAbilityId === kit.redirectId
        );
        expect(redirects.length).toBeGreaterThan(0);

        // …and they are in the start-of-round window, i.e. driven by the passive repair.
        for (const round of [1, 2]) {
            const window = startOfRoundWindow(events, round);
            expect(repairsBy(window, kit.passiveRepairId)).toHaveLength(1);
            expect(repairsBy(window, kit.redirectId)).toHaveLength(1);
        }
    });

    // THE TRIPWIRE. The redirect firing off her ACTIVE cast is real behaviour that predates this
    // epic; a fixture in which it happens would pass with the fix reverted. `duringTurnOf` is
    // stamped on any reaction resolved inside an actor's turn and absent on the start-of-round
    // drain, so this asserts the fixture isolates the passive — and fails loudly if a later edit
    // to the HP trajectory lets the active start over-repairing.
    it('never fires off a cast repair in this fixture (non-vacuity tripwire)', () => {
        const { events, kit } = runFight({ allies: ONE_STEALTHED() });

        const redirects = repairsBy(events, kit.redirectId);
        // A "no redirect came from a cast" assertion is vacuously true when NO redirect fired at
        // all — which is precisely the reverted state. State the premise so this case reddens
        // with the rest of the file rather than certifying an empty stream.
        expect(redirects.length).toBeGreaterThan(0);
        for (const redirect of redirects) {
            expect(redirect.duringTurnOf).toBeUndefined();
        }
        // The other half: the active repairs every round and wastes nothing on anyone.
        const casts = events.filter((e) => e.type === 'heal-performed');
        expect(casts.length).toBeGreaterThan(0);
        for (const cast of casts) {
            expect(cast.type === 'heal-performed' && (cast.overheal ?? 0)).toBe(0);
        }
    });

    // R1 — "damaged" is not a gate. In round 1 every ally is at FULL HP, so the passive's 10,000
    // is wasted in its entirety, and the whole of it is redirected. Relational on purpose: the
    // redirect equals the over-repair the engine observed, never a hard-coded figure (see the open
    // heal-modifier ruling in the header).
    it('R1 — a FULL-HP ally still redirects the whole wasted amount', () => {
        const { events, kit } = runFight({ allies: ONE_STEALTHED() });
        const window = startOfRoundWindow(events, 1);

        const [repair] = repairsBy(window, kit.passiveRepairId);
        const [redirect] = repairsBy(window, kit.redirectId);
        expect(repair.perTarget).toEqual([
            // Nothing consumed: the recipient was already full. The repair still happened.
            { targetId: TOPPED_ID, amount: repair.amount, overheal: repair.amount },
        ]);
        expect(redirect.amount).toBe(totalOverheal(repair));
    });

    // R3, first half — the just-over-repaired ally is ELIGIBLE. Round 1: both allies sit at 100%
    // after the repair, and the engine picks the one it just over-repaired. Were the redirect's
    // source excluded from candidacy this would route to `low` instead, so the assertion
    // discriminates rather than merely recording a tie-break.
    it('R3 — the ally just over-repaired is eligible to receive the redirect', () => {
        const { events, kit } = runFight({ allies: ONE_STEALTHED() });
        const window = startOfRoundWindow(events, 1);

        const [redirect] = repairsBy(window, kit.redirectId);
        expect(redirect.perTarget.map((pt) => pt.targetId)).toEqual([TOPPED_ID]);
    });

    // R3, second half — the recipient is measured AFTER the repair. By round 2 the AoE has hurt
    // both allies; the passive tops `topped` back to 100% and the redirect goes to `low`, which is
    // now the lowest. Read before the repair, `topped` and `low` are equally hurt and the
    // source-order tie-break would have kept it on `topped` — so this is the discriminating arm.
    it('R3 — the recipient is the POST-repair lowest current HP% ally', () => {
        const { events, kit } = runFight({ allies: ONE_STEALTHED() });
        const window = startOfRoundWindow(events, 2);

        const [repair] = repairsBy(window, kit.passiveRepairId);
        const [redirect] = repairsBy(window, kit.redirectId);
        // The repair landed on `topped` and took it to full…
        expect(repair.perTarget.map((pt) => pt.targetId)).toEqual([TOPPED_ID]);
        expect(totalOverheal(repair)).toBeGreaterThan(0);
        // …so the lowest ally, measured after it, is the one the passive never reached.
        expect(redirect.perTarget.map((pt) => pt.targetId)).toEqual([LOW_ID]);
        expect(redirect.amount).toBe(totalOverheal(repair));
    });

    // R4 — an AoE over-repair produces ONE redirect sized by the SUM, not one per ally. Both
    // Stealthed allies are over-repaired by the same repair; the count assertion is the "not one
    // per ally" arm and the sum assertion is the sizing arm. Neither alone is enough: one redirect
    // of the wrong size and two redirects of the right size are both wrong.
    it('R4 — an AoE over-repair produces ONE redirect sized by the SUM', () => {
        const { events, kit } = runFight({
            allies: [
                ally({ id: TOPPED_ID, position: 'M4', stealthed: true }),
                ally({ id: TOPPED2_ID, position: 'M2', stealthed: true }),
                ally({ id: LOW_ID, position: 'M1' }),
            ],
        });
        const window = startOfRoundWindow(events, 2);

        const [repair] = repairsBy(window, kit.passiveRepairId);
        // One repair, two over-repaired allies.
        expect(repair.perTarget.map((pt) => pt.targetId).sort()).toEqual(
            [TOPPED_ID, TOPPED2_ID].sort()
        );
        expect(repair.perTarget.every((pt) => (pt.overheal ?? 0) > 0)).toBe(true);

        const redirects = repairsBy(window, kit.redirectId);
        expect(redirects).toHaveLength(1);
        expect(redirects[0].perTarget).toHaveLength(1);
        expect(redirects[0].amount).toBe(totalOverheal(repair));
    });
});

/**
 * R2 / R-A / R-B — the same passive repair, with Chimei wearing both on-repair implants.
 *
 * RNG. The suite bootstrap (`src/setupTests.ts`) already installs `setupKeyedTestRng(seed)` before
 * every test, which is the seeding the fixtures above run under. Font of Power is a 16% proc, so
 * these cases additionally FORCE both streams to 0 — an always-fire override, not an un-seeding
 * (the forbidden call is `resetRateGateRng()`, which restores `Math.random`). This mirrors the
 * `Font of Power` case in `equipmentAbilities.integration.test.ts`. Nothing else in the fixture
 * has a proc gate, and every crit rate is 0 (`rng() < 0` is false), so forcing changes only what
 * it is meant to.
 *
 * Round 2 is the round to read: the shields Abundant Renewal grants in round 1 absorb part of the
 * AoE, and by round 2 the passive over-repairs `topped` while the redirect over-repairs `low` —
 * two DIFFERENT recipients with two DIFFERENT amounts, which is what makes each implant's output
 * attributable to the repair that produced it.
 */
describe('#435 acceptance — Font of Power and Abundant Renewal off a PASSIVE repair', () => {
    beforeAll(requireReferenceData);

    function implantFight(): Fight {
        setRateGateRng(() => 0);
        setKeyedRng(() => 0);
        return runFight({ allies: ONE_STEALTHED(), implants: true });
    }

    // R-A — the gap Task 2's unit tests could not close: no fixture in the corpus paired a
    // reactive/passive healer with Font of Power, so the ruling that a passive repair procs it was
    // proven nowhere at integration level. The grant here lands in the start-of-round window, off
    // a repair no cast produced. (Font also procs off her active cast during her own turn — which
    // is exactly why this is scoped to the window.)
    it('R-A — Font of Power procs off a repair performed from a live trigger', () => {
        const { events } = implantFight();
        const window = startOfRoundWindow(events, 2);

        expect(nanobotRecipients(window)).toContain(TOPPED_ID);
    });

    // R-A, the other implant. Abundant Renewal converts the clipped excess of a repair into a
    // shield; here the repair is the start-of-round passive, and the shield is sized from the
    // excess the engine reported for it.
    it('R-A — Abundant Renewal shields the overflow of a repair performed from a live trigger', () => {
        const { events, kit } = implantFight();
        const window = startOfRoundWindow(events, 2);

        const [repair] = repairsBy(window, kit.passiveRepairId);
        expect(totalOverheal(repair)).toBeGreaterThan(0);
        const onTopped = shields(window).filter((s) => s.recipientIds.includes(TOPPED_ID));
        expect(onTopped).toHaveLength(1);
        expect(onTopped[0].amount).toBeGreaterThan(0);
    });

    // R2 + R-B, BOTH arms. When the redirect itself over-repairs: Abundant Renewal still converts
    // that excess to a shield and Font of Power still rolls (R-B — both implants observe it), but
    // there is NO second redirect (R2 — the redirect's own excess is otherwise lost). A one-armed
    // version of this passes under a missing guard: assert the implants fired AND that the
    // redirect count is exactly one.
    it('R2 + R-B — the redirect’s own over-repair is shielded and procs, but never redirects again', () => {
        const { events, kit } = implantFight();
        const window = startOfRoundWindow(events, 2);

        const [repair] = repairsBy(window, kit.passiveRepairId);
        const redirects = repairsBy(window, kit.redirectId);

        // ARM 0 — the premise: the passive repair reached ONLY the Stealthed ally, and exactly one
        // redirect fired and DID over-repair. Pinning the repair's recipient here is what makes
        // ARM 2's attribution self-contained: `low` can only have got its Nanobots off the
        // redirect if the repair never touched it. Without this whole arm the two below are
        // vacuous.
        expect(repair.perTarget.map((pt) => pt.targetId)).toEqual([TOPPED_ID]);
        expect(redirects).toHaveLength(1);
        const [redirect] = redirects;
        expect(redirect.perTarget.map((pt) => pt.targetId)).toEqual([LOW_ID]);
        const redirectExcess = totalOverheal(redirect);
        expect(redirectExcess).toBeGreaterThan(0);

        // ARM 1 (R2) — Abundant Renewal converted the redirect's OWN excess to a shield, on the
        // redirect's recipient. Attributable because the passive's shield went to `topped` and
        // this one to `low`. Sized RELATIONALLY: the implant applied the same rate to both
        // excesses (shieldLow / redirectExcess === shieldTopped / repairExcess), asserted by
        // cross-multiplication so no percentage is baked in.
        const onLow = shields(window).filter((s) => s.recipientIds.includes(LOW_ID));
        expect(onLow).toHaveLength(1);
        const onTopped = shields(window).filter((s) => s.recipientIds.includes(TOPPED_ID));
        expect(onTopped).toHaveLength(1);
        expect(onLow[0].amount).toBeGreaterThan(0);
        expect(onLow[0].amount * totalOverheal(repair)).toBe(onTopped[0].amount * redirectExcess);

        // ARM 2 (R-B) — Font of Power rolled its proc off the redirect too: the redirect's
        // recipient carries the grant, which only the redirect could have delivered (the passive
        // repair never reached `low`).
        expect(nanobotRecipients(window)).toContain(LOW_ID);

        // ARM 3 (R2, the negative) — and no cascade. `redirects` is already length 1 above; state
        // it against the whole window so a second redirect from ANY source would fail here too.
        expect(
            window.filter(
                (e) => e.type === 'reactive-heal-performed' && e.sourceAbilityId === kit.redirectId
            )
        ).toHaveLength(1);
    });
});

/**
 * #442 — the CAST arm, and the ruling that inverts 94515b6e.
 *
 * OWNER RULING 2026-08-31: "Chimei's overheal redirect is fed by all heal targets, himself
 * included." Her active is `repairs 9% of its Max HP to all allies`, and `target: 'all-allies'`
 * hands the caster its own side WITH ITSELF IN IT (playerTurn.ts) — so her own wasted share is
 * part of the sum R4 sizes the redirect from. 94515b6e read the clause's "damaged ally" wording
 * the other way and filtered her entry out; this fixture is what would have caught that.
 *
 * WHAT MAKES IT A MEASUREMENT. The assertion is DIFFERENTIAL, not absolute: the redirect must
 * equal ally-waste + Chimei's-own-waste, and must NOT equal ally-waste alone — which is exactly
 * the number the pre-#442 code produced. Both quantities are asserted non-zero first, so the
 * comparison cannot pass by both being 0. Undo the listener's self-inclusive aggregate and the
 * `not.toBe` arm reddens.
 *
 * FIXTURE. Nobody is Stealthed, so the start-of-round passive repairs NOBODY and cannot
 * contribute a redirect — every redirect here comes from the cast (asserted). The AoE is dropped
 * to 200 so that when Chimei casts, she and both allies are only lightly damaged and her 9,000
 * repair wastes on all three.
 *
 * Heal modifiers stay neutral (no Repair Up, no implants, `healModifier` 0) — the open
 * heal-modifier ruling must not be smuggled in as a decided answer.
 */
describe('#442 — the caster’s own over-repair feeds the redirect', () => {
    beforeAll(requireReferenceData);

    type HealPerformed = Extract<CombatEvent, { type: 'heal-performed' }>;

    /** Two plain allies, neither Stealthed: the passive repair reaches nobody. */
    const NO_STEALTH = (): TeamActorEngineInput[] => [
        ally({ id: TOPPED_ID, position: 'M4' }),
        ally({ id: LOW_ID, position: 'M1' }),
    ];

    const wasteOn = (e: HealPerformed, id: string): number =>
        (e.perTarget ?? [])
            .filter((pt) => pt.targetId === id)
            .reduce((sum, pt) => sum + (pt.overheal ?? 0), 0);
    const allyWaste = (e: HealPerformed): number =>
        (e.perTarget ?? [])
            .filter((pt) => pt.targetId !== CHIMEI_ID)
            .reduce((sum, pt) => sum + (pt.overheal ?? 0), 0);

    function castFight() {
        const { events, kit } = runFight({ allies: NO_STEALTH(), aoeHit: 200 });
        const casts = events.filter(
            (e): e is HealPerformed => e.type === 'heal-performed' && e.casterId === CHIMEI_ID
        );
        // The passive contributes nothing here — no Stealthed ally — so every redirect in the run
        // is cast-driven. Without this the sizing assertion could be reading a passive redirect.
        expect(repairsBy(events, kit.passiveRepairId)).toHaveLength(0);
        expect(casts.length).toBeGreaterThan(0);
        return { events, kit, cast: casts[0] };
    }

    it('the active reaches Chimei herself and wastes repair on her', () => {
        const { cast } = castFight();
        expect((cast.perTarget ?? []).map((pt) => pt.targetId)).toContain(CHIMEI_ID);
        expect(wasteOn(cast, CHIMEI_ID)).toBeGreaterThan(0);
    });

    it('sizes the redirect from ALL heal targets, the caster included', () => {
        const { events, kit, cast } = castFight();

        const self = wasteOn(cast, CHIMEI_ID);
        const allies = allyWaste(cast);
        // Non-emptiness premises: with either at 0 the two candidate answers coincide and the
        // discriminating assertion below would be vacuous.
        expect(self).toBeGreaterThan(0);
        expect(allies).toBeGreaterThan(0);

        const redirects = repairsBy(events, kit.redirectId).filter((r) => r.round === cast.round);
        expect(redirects).toHaveLength(1);
        expect(redirects[0].amount).toBe(allies + self);
        // The pre-#442 answer, stated explicitly so a regression cannot pass by coincidence.
        expect(redirects[0].amount).not.toBe(allies);
    });

    it('still never lands the redirect on Chimei herself (R3)', () => {
        const { events, kit, cast } = castFight();
        const redirects = repairsBy(events, kit.redirectId).filter((r) => r.round === cast.round);
        expect(redirects).toHaveLength(1);
        expect(redirects[0].perTarget.map((pt) => pt.targetId)).not.toContain(CHIMEI_ID);
    });
});

/**
 * A repair that reaches ONLY the caster still redirects.
 *
 * OWNER RULING 2026-08-31, asked as: *Chimei's start-of-round passive reaches only herself (she is
 * the only Stealthed ship) and over-repairs — does the redirect fire?* Answer: it should. Before
 * this, the listener refused to enqueue anything on `on-own-repair-to-ally` unless the repair had
 * at least one NON-SELF recipient, so this repair produced no redirect at all.
 *
 * The gate did not simply go away — it became shape-scoped. An `overheal`-BASIS reaction is sized
 * by what a repair WASTED, so a caster-only repair qualifies; everything else on the trigger still
 * needs a non-self recipient, because Font of Power grants to `repairedAllyIds` and an empty list
 * makes that branch fall through to the whole living side.
 *
 * FIXTURE. Chimei carries the Stealth aura and the two allies do not, so her Stealth-gated
 * start-of-round repair reaches exactly one recipient: herself. Round 1's start-of-round window is
 * read, where every actor is still at FULL HP — so the repair wastes all of itself, and the window
 * predates any turn, so nothing in it can have come from a cast.
 *
 * Heal modifiers stay neutral, as everywhere in this file — the open heal-modifier ruling is not
 * decided here.
 */
describe('a repair that reaches ONLY the caster still redirects', () => {
    beforeAll(requireReferenceData);

    const CASTER_ONLY = () => ({
        allies: [ally({ id: TOPPED_ID, position: 'M4' }), ally({ id: LOW_ID, position: 'M1' })],
        stealthChimei: true,
    });

    it('the start-of-round passive reaches Chimei and nobody else', () => {
        const { events, kit } = runFight(CASTER_ONLY());
        const window = startOfRoundWindow(events, 1);

        const repairs = repairsBy(window, kit.passiveRepairId);
        expect(repairs).toHaveLength(1);
        expect(repairs[0].perTarget.map((pt) => pt.targetId)).toEqual([CHIMEI_ID]);
        // Round 1: she is at full HP, so the whole repair is wasted. Without this the sizing
        // assertion below could be comparing two zeroes.
        expect(repairs[0].perTarget[0].overheal ?? 0).toBeGreaterThan(0);
    });

    it('redirects that waste to an ally', () => {
        const { events, kit } = runFight(CASTER_ONLY());
        const window = startOfRoundWindow(events, 1);

        const [repair] = repairsBy(window, kit.passiveRepairId);
        const redirects = repairsBy(window, kit.redirectId);
        expect(redirects).toHaveLength(1);
        expect(redirects[0].amount).toBe(repair.perTarget[0].overheal);
        // R3 still holds: she is the source of the waste, never the recipient of the redirect.
        const recipients = redirects[0].perTarget.map((pt) => pt.targetId);
        expect(recipients).toHaveLength(1);
        expect(recipients).not.toContain(CHIMEI_ID);
    });

    // The other half of the 2026-08-31 rulings, end to end: a ship that over-repairs ITSELF earns
    // Abundant Renewal's shield. Before the ruling the listener filtered the caster out of the
    // per-recipient map, so this repair — which wasted on nobody BUT her — shielded no one at all.
    //
    // RNG: both streams forced to 0 so Font of Power's 16% proc always fires, mirroring the
    // implant fixture above. Seeding, not un-seeding (`resetRateGateRng` is the forbidden call).
    //
    // ⚠️ PROBE NOTE — this case needs the FULL pre-ruling state to redden, not half of it.
    // Re-filtering the caster out of the per-recipient map ALONE leaves it green: with the map
    // empty the executor falls back to the aggregate + `healing.targetId`, and this fixture's heal
    // target IS Chimei, so the shield lands on her by the other road. Only filtering the caster out
    // of the aggregate as well — the state 94515b6e actually shipped — reddens it (measured
    // 2026-08-31, along with the two cases above).
    it('Abundant Renewal shields the CASTER off its own wasted repair', () => {
        setRateGateRng(() => 0);
        setKeyedRng(() => 0);
        const { events, kit } = runFight({ ...CASTER_ONLY(), implants: true });
        const window = startOfRoundWindow(events, 1);

        const [repair] = repairsBy(window, kit.passiveRepairId);
        expect(repair.perTarget.map((pt) => pt.targetId)).toEqual([CHIMEI_ID]);
        const selfWaste = totalOverheal(repair);
        expect(selfWaste).toBeGreaterThan(0);

        const onChimei = shields(window).filter((sh) => sh.recipientIds.includes(CHIMEI_ID));
        expect(onChimei).toHaveLength(1);
        expect(onChimei[0].amount).toBeGreaterThan(0);

        // Sized RELATIONALLY against the redirect's own excess, which the same implant shielded at
        // the same rate — so no percentage is baked in and the open heal-modifier ruling stays out
        // of the fixture.
        const [redirect] = repairsBy(window, kit.redirectId);
        const redirectExcess = totalOverheal(redirect);
        expect(redirectExcess).toBeGreaterThan(0);
        const recipientId = redirect.perTarget[0].targetId;
        const onRecipient = shields(window).filter((sh) => sh.recipientIds.includes(recipientId));
        expect(onRecipient).toHaveLength(1);
        expect(onChimei[0].amount * redirectExcess).toBe(onRecipient[0].amount * selfWaste);
    });

    // #444, owner ruling 2026-08-31: "font of power procs on all heals, including self heals."
    // The listener-level test pins the grant LIST; this pins that the grant actually LANDS. The
    // buff branch runs its recipients through `footprintFilteredRecipients`, so a self-inclusive
    // list is not by itself proof — if the owner's own support footprint excluded the owner, the
    // caster would be dropped between the list and the buff and the ruling would never ship.
    //
    // The repair here reaches nobody but Chimei, so the grant cannot have come from an ally
    // recipient, and the start-of-round window predates every turn, so it cannot have come from
    // her cast either.
    it('Font of Power procs on the CASTER off a repair that reached only her', () => {
        setRateGateRng(() => 0);
        setKeyedRng(() => 0);
        const { events, kit } = runFight({ ...CASTER_ONLY(), implants: true });
        const window = startOfRoundWindow(events, 1);

        const [repair] = repairsBy(window, kit.passiveRepairId);
        expect(repair.perTarget.map((pt) => pt.targetId)).toEqual([CHIMEI_ID]);
        expect(nanobotRecipients(window)).toContain(CHIMEI_ID);
    });
});
