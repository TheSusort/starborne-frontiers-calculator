import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import { parsePattern } from '../../targetingParser';
import type { ParsedTarget } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor } from '../state';
import { bareEnemy } from '../__testutils__/bareRosterFixture';

// Pattern-Line-Support-Range-1 @ M3 covers exactly {M3, M4} (resolvePattern.test.ts:83-87).
// So: healer at M3, ON-footprint ally at M4, OFF-footprint ally at M1.
// The OFF-footprint ally is deliberately given much lower HP so that lowest-HP routing,
// if it ever leaked in, would heal IT and fail this test.
const FOCUS_ID = 'attacker';
const ON_FOOTPRINT_ID = 'ally-on-pattern';
const OFF_FOOTPRINT_ID = 'ally-off-pattern-low-hp';

let idc = 0;
const ab = (p: Partial<Ability> & Pick<Ability, 'type' | 'config'>): Ability => ({
    id: `sp3a_${++idc}`,
    target: 'ally',
    trigger: 'on-cast',
    conditions: [],
    ...p,
});

const allyTarget = (): ParsedTarget => ({ raw: 'allies', side: 'ally', selection: 'all' });

// ⚠️ CRITICAL MECHANIC — read before touching these fixtures.
// `resolveSupportRecipients` (supportRecipients.ts) FILTERS `baseRecipients` by the support
// footprint; it NEVER expands it. Since SP-4e Task 4, `recipientsFor` (playerTurn.ts) builds that
// base from the ABILITY'S TARGET alone — no run-mode flag is consulted:
//   'lowest-hp-ally'  → resolved DIRECTLY from live HP, footprint-exempt, single recipient
//   'self'            → [actor.id]
//   'ally' / 'all-allies' → own-side ids               ← footprint-narrowed, MULTI-element
// The pre-4e single-`'ally'` arms (`teamBattle ON → [lowestHpAllyId(playerIds)]`, `teamBattle OFF
// → [healing.targetId]`) and the `teamBattle` flag itself are GONE. Nothing in THIS file ever
// routed through them — every ability below targets `'all-allies'`, `'self'` or `'enemy'`, so the
// deletion moved no case here; only this note needed correcting. `perRecipientApply` is the one
// surviving axis and it governs APPLICATION only, which is what this file tests: Fixture A uses
// `all-allies` to exercise it.

/** `all-allies` repair for 10% of the caster's 50000 hp basis → 5000 raw per recipient. */
const allAlliesHeal = (): Ability =>
    ab({ type: 'heal', target: 'all-allies', config: { type: 'heal', pct: 10, basis: 'hp' } });

const healerSkills = (): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [allAlliesHeal()] }],
});

// ⚠️ A DIRECT-ENGINE test MUST supply the `walk` bundle itself.
// `normalizeTeamActorsToWalked` (teamActorWalk.ts:47) synthesizes NEUTRAL_WALK_STATS with
// **hp: 1** for any team actor arriving without one, silently DISCARDING a bare `stats.hp` —
// so a fixture that sets `stats: { hp: 50_000 }` and no `walk` gets a 1-HP ally that dies
// instantly. Only the ADAPTER builds walk bundles (`deriveTeamEngineActors`); `runCombat` does
// not. Established pattern: `healing.test.ts:388-405`.
const teamAlly = (id: string, position: Position, hp: number): TeamActorEngineInput => ({
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

const BASE = (): CombatEngineInput => ({
    // SP-4b-2b: every run needs a real opponent. `attack: 0` + heal-only kit means the inert
    // 500k-HP default survives the whole sim. The fight-wide `enemyDefense`/`enemyHp` scalars
    // this used to keep in step (M6, always inert positionally) were deleted in SP-4d.
    enemyAttackers: bareEnemy(),
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: healerSkills(),
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
    healTargetId: FOCUS_ID,
    mode: 'healing',
    position: 'M3',
    target: allyTarget(),
    pattern: parsePattern('Pattern-Line-Support-Range-1'),
    teamActors: [
        // ON the footprint (M4). Same max HP as the off-footprint ally so the ONLY difference
        // between them is which cell they stand on.
        teamAlly(ON_FOOTPRINT_ID, 'M4', 50_000),
        // OFF the footprint (M1) — the support pattern from M3 covers only {M3, M4}.
        teamAlly(OFF_FOOTPRINT_ID, 'M1', 50_000),
    ],
});

/** Damage both allies to 50% so every heal has headroom (no all-overheal vacuity).
 *
 *  This tap DELIBERATELY DIVERGES from its counterpart in
 *  `healingPerRecipientApply.test.ts` (a copied fixture kept intentionally out of sync — do
 *  NOT "fix" this by re-syncing the two files) by ALSO damaging the FOCUS healer
 *  (`FOCUS_ID`/'attacker'). Without that, the healer casts `all-allies` at full HP, so its own
 *  share of the heal is 100% overheal and its `perRecipient` entry is zero — leaving exactly
 *  ONE non-zero recipient (the on-pattern ally). A sum over a single non-zero term is
 *  invariant to which key holds it, so the "recipient axis sums to source axis" test would
 *  pass even if the whole total were misattributed to the wrong recipient. Damaging the
 *  healer too gives it heal headroom, producing a SECOND non-zero recipient and making the
 *  sum assertion actually exercise addition across recipients. */
const halveAllyHp = (actors: CombatActor[]): void => {
    for (const a of actors) {
        if (a.id === ON_FOOTPRINT_ID || a.id === OFF_FOOTPRINT_ID || a.id === FOCUS_ID) {
            a.currentHp = Math.floor(a.stats.hp / 2);
        }
    }
};

describe('SP-3a: recipient-keyed healing aggregate', () => {
    it('credits effectiveHeal against the RECIPIENT, not only the source', () => {
        idc = 0;
        const result = runCombat({
            ...BASE(),
            perRecipientHealApply: true,
            __testTapActors: halveAllyHp,
        });
        const round = result.healing!.rounds[0];

        // Source axis: the healer is credited (unchanged behaviour).
        expect(round.perActor.get(FOCUS_ID)!.directHeal).toBeGreaterThan(0);

        // Recipient axis: the ON-footprint ally has its OWN entry.
        const onEntry = round.perRecipient.get(ON_FOOTPRINT_ID);
        expect(onEntry).toBeDefined();
        expect(onEntry!.effectiveHeal).toBeGreaterThan(0);

        // The OFF-footprint ally received nothing, so it has no entry (or a zero one).
        expect(round.perRecipient.get(OFF_FOOTPRINT_ID)?.effectiveHeal ?? 0).toBe(0);
    });

    it('the recipient axis sums to the source axis for effectiveHeal', () => {
        idc = 0;
        const result = runCombat({
            ...BASE(),
            perRecipientHealApply: true,
            __testTapActors: halveAllyHp,
        });
        const round = result.healing!.rounds[0];

        const bySource = [...round.perActor.values()].reduce((n, h) => n + h.effectiveHeal, 0);
        const byRecipient = [...round.perRecipient.values()].reduce(
            (n, h) => n + h.effectiveHeal,
            0
        );
        // Anti-vacuity: both sides must be non-zero, or the identity is trivially true.
        expect(bySource).toBeGreaterThan(0);
        expect(byRecipient).toBeCloseTo(bySource, 6);

        // Anti-vacuity (recipient COUNT): a sum is invariant to which key holds the value, so
        // "sum matches" is only a real test of addition if at least TWO recipients contribute a
        // non-zero effectiveHeal. The healer is now damaged (see `halveAllyHp`'s comment above)
        // so its own self-heal share has headroom, giving it a non-zero entry alongside the
        // on-pattern ally's — proving the total is actually built by adding across recipients,
        // not just echoing a single source's value under a single recipient key.
        const focusEntry = round.perRecipient.get(FOCUS_ID);
        const onPatternEntry = round.perRecipient.get(ON_FOOTPRINT_ID);
        expect(focusEntry).toBeDefined();
        expect(focusEntry!.effectiveHeal).toBeGreaterThan(0);
        expect(onPatternEntry).toBeDefined();
        expect(onPatternEntry!.effectiveHeal).toBeGreaterThan(0);
    });

    it('without the flag the recipient map stays EMPTY (additive proof)', () => {
        idc = 0;
        const result = runCombat({ ...BASE(), __testTapActors: halveAllyHp });
        expect(result.healing!.rounds[0].perRecipient.size).toBe(0);
    });
});

// ── Review fix (SP-3b Task 7): the flag-off fence must cover EVERY credit site ─────────────
// `perRecipient` must stay EMPTY when per-recipient application is off — every legacy healing
// golden's byte-identity depends on that emptiness. Six sites credit the axis: the direct
// cast-repair site (already exercised by the `BASE()` fixture above, an `all-allies` heal),
// four via `creditLandedRepair` (engine.ts, one shared early-return gate), and two inline
// gates that CANNOT reach `creditLandedRepair` — it is a `runCombat`-local closure, not an
// export — so they duplicate the gate check themselves: playerTurn.ts's HoT tick
// (`if (healing.perRecipientApply)`, ~:3474) and triggers.ts's reactive executor
// (`if (ctx.healing.perRecipientApply)`, ~:3441). The `BASE()` fixture above is cast-only (one
// `all-allies` heal, no HoT/leech/reactive), so deleting either inline gate — or the shared
// `creditLandedRepair` early return — left the WHOLE suite green. This fixture is deliberately
// NON-positional (no position/target/pattern), mirroring `healing.test.ts`'s BASE: the
// HoT/leech/reactive gates below need no positional resolution, and adding it would entangle
// with the pattern-routing semantics the fixture above already exists to test.
describe('SP-3b Task 7 (review fix): flag-off fence covers HoT + leech + reactive sites', () => {
    const damageAb = (): Ability =>
        ab({ type: 'damage', target: 'enemy', config: { type: 'damage', multiplier: 100 } });

    // Passive-slot standing leech (basis damage-dealt, self) — procs through engine.ts's
    // `procStandingLeeches`, which calls the shared `creditLandedRepair` closure.
    const standingLeechAb = (): Ability =>
        ab({
            type: 'heal',
            target: 'self',
            config: { type: 'heal', pct: 20, basis: 'damage-dealt', leechScope: 'all' },
        });

    // Passive-slot reactive start-of-round self-heal — fires through triggers.ts's reactive
    // executor every round (registerReactiveListeners), independent of the cast path.
    const reactiveHealAb = (): Ability =>
        ab({
            type: 'heal',
            target: 'self',
            trigger: 'start-of-round',
            config: { type: 'heal', pct: 10, basis: 'hp' },
        });

    const HOT_LEECH_REACTIVE_BASE = (): CombatEngineInput => ({
        // SP-4b-2b: this focus DOES deal damage (5000 attack, `damageAb` every round), so it gets
        // the 10M-HP form — the 500k default is not a survival guarantee and a mid-sim death
        // reshapes the run. 0 lives on the roster entry's own `stats.defence` so damage
        // magnitudes stay what they were (the fight-wide `enemyDefense` scalar it used to be kept
        // in step with was deleted in SP-4d).
        enemyAttackers: bareEnemy({ stats: { hp: 10_000_000, defence: 0 } }),
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 0,
        numRounds: 1,
        // A scheduled (no-caster) HoT on the focus/heal target — ticks every turn via
        // playerTurn.ts's `tickHot`, holder === target branch (the gate under review).
        selfBuffs: [
            {
                id: 'sched-hot',
                buffName: 'Repair Over Time I',
                stacks: 1,
                isStackable: false,
                parsedEffects: { hotPct: 10 },
            },
        ],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: false,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 2000,
        hp: 10000,
        healTargetId: FOCUS_ID,
        mode: 'healing',
        shipSkills: {
            slots: [
                { slot: 'active', abilities: [damageAb()] },
                { slot: 'passive', abilities: [standingLeechAb(), reactiveHealAb()] },
            ],
        },
    });

    it('flag off: perRecipient stays EMPTY with a HoT tick + standing leech + reactive heal all firing', () => {
        idc = 0;
        const result = runCombat(HOT_LEECH_REACTIVE_BASE());
        const round = result.healing!.rounds[0];

        // Anti-vacuity: each source actually produced something this round — otherwise an
        // empty map would be trivially true regardless of whether the gates exist at all.
        const focus = round.perActor.get(FOCUS_ID)!;
        expect(focus.hotHeal).toBeGreaterThan(0); // the scheduled HoT ticked
        expect(focus.directHeal).toBeGreaterThan(0); // standing leech + reactive heal both credit directHeal

        expect(round.perRecipient.size).toBe(0);
    });

    it('flag on: the SAME fixture DOES populate perRecipient (positive control)', () => {
        idc = 0;
        const result = runCombat({ ...HOT_LEECH_REACTIVE_BASE(), perRecipientHealApply: true });
        const round = result.healing!.rounds[0];
        expect(round.perRecipient.size).toBeGreaterThan(0);
        expect(round.perRecipient.get(FOCUS_ID)?.hotHeal ?? 0).toBeGreaterThan(0);
    });
});
