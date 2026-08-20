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
//   'ally'            → own-side ids                   ← footprint-narrowed, MULTI-element
//   'all-allies'      → own-side ids                   ← footprint-narrowed, MULTI-element
// The pre-4e pair of single-`'ally'` arms — `teamBattle ON → [lowestHpAllyId(playerIds)]` and
// `teamBattle OFF → [healing.targetId]` — is GONE, and with it the whole `teamBattle` flag. A
// plain single-`'ally'` heal is now a footprint-wide multi-recipient shape exactly like
// `'all-allies'`, and the only single-recipient ally shape left is the text-named selector.
// Fixture A uses `all-allies` to exercise the APPLICATION axis (`perRecipientApply`, the one axis
// that survives); Fixture B contrasts the two ROUTING shapes on one fixture and pins that neither
// of them reads the run mode or the flag.

/** `all-allies` repair for 10% of the caster's 50000 hp basis → 5000 raw per recipient. */
const allAlliesHeal = (): Ability =>
    ab({ type: 'heal', target: 'all-allies', config: { type: 'heal', pct: 10, basis: 'hp' } });

/** Plain single-`'ally'` repair — no worst-HP wording in its text, so no selector. Since SP-4e
 *  Task 4 this routes over the caster's support footprint, exactly like `'all-allies'`. */
const singleAllyHeal = (): Ability =>
    ab({ type: 'heal', target: 'ally', config: { type: 'heal', pct: 10, basis: 'hp' } });

/** The text-named worst-HP selector — the only single-recipient ally shape left after Task 4,
 *  and the shape Pallas/Volk/Valkyrie now carry. Footprint-exempt, caster excluded. */
const lowestHpAllyHeal = (): Ability =>
    ab({
        type: 'heal',
        target: 'lowest-hp-ally',
        config: { type: 'heal', pct: 10, basis: 'hp' },
    });

const healerSkills = (): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [allAlliesHeal()] }],
});

const singleAllyHealerSkills = (): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [singleAllyHeal()] }],
});

const lowestHpAllyHealerSkills = (): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [lowestHpAllyHeal()] }],
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
    // SP-4b-2b: every run needs a real opponent. This fixture's focus has `attack: 0` and casts
    // only heals, so the inert 500k-HP default never dies and the run shape is unchanged.
    // `enemyDefense`/`enemyHp` below describe the vestigial dummy and are INERT positionally (M6);
    // they are left in place because nothing here derives a number from them.
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

/** Damage both allies to 50% so every heal has headroom (no all-overheal vacuity). */
const halveAllyHp = (actors: CombatActor[]): void => {
    for (const a of actors) {
        if (a.id === ON_FOOTPRINT_ID || a.id === OFF_FOOTPRINT_ID) {
            a.currentHp = Math.floor(a.stats.hp / 2);
        }
    }
};

describe('SP-3a: per-recipient heal application is separable from recipient ROUTING', () => {
    it('WITHOUT the flag: an on-footprint ally receives NO real HP (today behaviour)', () => {
        idc = 0;
        let onFootprint: CombatActor | undefined;
        runCombat({
            ...BASE(),
            __testTapActors: (actors) => {
                halveAllyHp(actors);
                onFootprint = actors.find((a) => a.id === ON_FOOTPRINT_ID);
            },
        });
        expect(onFootprint).toBeDefined();
        // Anti-vacuity: the ally really is damaged, so a landed heal WOULD be observable.
        expect(onFootprint!.currentHp).toBeLessThan(onFootprint!.stats.hp);
        // ROUTING already covers this ally (an `all-allies` heal over the caster's footprint);
        // it is the APPLICATION axis that withholds the HP write — with the flag off, only
        // `rid === healing.targetId` (the focus) gets `applyHealToTarget`.
        expect(onFootprint!.currentHp).toBe(25_000);
    });

    it('WITH perRecipientHealApply: the ON-footprint ally gains real HP', () => {
        idc = 0;
        let onFootprint: CombatActor | undefined;
        runCombat({
            ...BASE(),
            perRecipientHealApply: true,
            __testTapActors: (actors) => {
                halveAllyHp(actors);
                onFootprint = actors.find((a) => a.id === ON_FOOTPRINT_ID);
            },
        });
        expect(onFootprint).toBeDefined();
        expect(onFootprint!.currentHp).toBeGreaterThan(25_000);
    });

    it('WITH perRecipientHealApply: the OFF-footprint low-HP ally is NOT healed', () => {
        idc = 0;
        let offFootprint: CombatActor | undefined;
        runCombat({
            ...BASE(),
            perRecipientHealApply: true,
            __testTapActors: (actors) => {
                halveAllyHp(actors);
                offFootprint = actors.find((a) => a.id === OFF_FOOTPRINT_ID);
            },
        });
        expect(offFootprint).toBeDefined();
        // Decision 7: heals follow the PATTERN. This ally is identical to the on-footprint one in
        // every way EXCEPT its cell, so its receiving nothing isolates the pattern as the cause.
        expect(offFootprint!.currentHp).toBe(25_000);
    });
});

// ── Fixture B: the routing fence ────────────────────────────────────────────
// Pattern-Line-Support-Range-3 @ M1 covers {M1, M2, M3, M4} (resolvePattern.test.ts:91-95),
// so BOTH allies are on-footprint and only the ROUTING rule can distinguish them.
//
// SP-4e Task 4 rewrote what this fence guards. It used to guard a two-axis split: routing was
// picked by the `teamBattle` run-mode flag and the fence proved `perRecipientHealApply` did not
// leak into that choice. `teamBattle` is gone, so there is no run-mode routing left to fence
// against — routing now comes from the ABILITY'S TARGET. The fence therefore now proves the two
// remaining things worth proving on this fixture:
//   (1) the two ally routing shapes really are different — the text-named selector picks the ONE
//       worst-HP ally while a plain `'ally'` heal covers the whole footprint; and
//   (2) neither shape reads `perRecipientHealApply` or the run mode.
const HIGH_HP_TARGET_ID = 'ally-high-hp-is-the-heal-target';
const LOW_HP_ID = 'ally-low-hp';

const FENCE = (): CombatEngineInput => ({
    ...BASE(),
    shipSkills: lowestHpAllyHealerSkills(),
    position: 'M1',
    pattern: parsePattern('Pattern-Line-Support-Range-3'),
    // The configured heal target is the HIGHER-HP ally, so "routed to the heal target", "routed
    // to the worst-HP ally" and "routed over the whole footprint" all predict DIFFERENT recipient
    // sets — the discriminating power of every case below.
    healTargetId: HIGH_HP_TARGET_ID,
    mode: 'healing',
    teamActors: [teamAlly(HIGH_HP_TARGET_ID, 'M2', 50_000), teamAlly(LOW_HP_ID, 'M3', 50_000)],
});

/** 90% for the heal target, 20% for the other — distinct FRACTIONS, no tie. */
const setFenceHp = (actors: CombatActor[]): void => {
    for (const a of actors) {
        if (a.id === HIGH_HP_TARGET_ID) a.currentHp = 45_000;
        if (a.id === LOW_HP_ID) a.currentHp = 10_000;
    }
};

describe('SP-4e: the fence — routing comes from the TARGET, not the flag or the run mode', () => {
    it('the selector picks the worst-HP ally, NOT the configured heal anchor', () => {
        idc = 0;
        let target: CombatActor | undefined;
        let low: CombatActor | undefined;
        runCombat({
            ...FENCE(),
            perRecipientHealApply: true,
            __testTapActors: (actors) => {
                setFenceHp(actors);
                target = actors.find((a) => a.id === HIGH_HP_TARGET_ID);
                low = actors.find((a) => a.id === LOW_HP_ID);
            },
        });
        // 10% of the caster's 50,000 hp basis = 5,000, onto the 20%-HP ally and nobody else.
        expect(low!.currentHp).toBe(15_000);
        // Anti-vacuity: the anchor is on-footprint, at 90% (so it has repair headroom), and IS
        // `healTargetId` — the id the deleted `[healing.targetId]` arm routed to. It gets nothing.
        expect(target!.currentHp).toBe(45_000);
    });

    it("mode 'battle' routes that SAME heal identically — routing is mode-independent", () => {
        idc = 0;
        let target: CombatActor | undefined;
        let low: CombatActor | undefined;
        runCombat({
            ...FENCE(),
            mode: 'battle',
            __testTapActors: (actors) => {
                setFenceHp(actors);
                target = actors.find((a) => a.id === HIGH_HP_TARGET_ID);
                low = actors.find((a) => a.id === LOW_HP_ID);
            },
        });
        // Byte-for-byte the case above, on a different run mode and with NO
        // `perRecipientHealApply` of its own (battle mode implies the application axis). Pre-4e
        // these two modes were the whole point of `teamBattle` and produced DIFFERENT recipients
        // on this fixture; now they must agree. Divergence here means a run mode has crept back
        // into recipient choice.
        expect(low!.currentHp).toBe(15_000);
        expect(target!.currentHp).toBe(45_000);
    });

    it('flag OFF: routing is unchanged — the anchor still gets nothing, only the WRITE is withheld', () => {
        idc = 0;
        let target: CombatActor | undefined;
        let low: CombatActor | undefined;
        const result = runCombat({
            ...FENCE(),
            __testTapActors: (actors) => {
                setFenceHp(actors);
                target = actors.find((a) => a.id === HIGH_HP_TARGET_ID);
                low = actors.find((a) => a.id === LOW_HP_ID);
            },
        });
        // Anti-vacuity: the cast DID fire and DID produce a gross repair — `credit` runs above the
        // application gate — so the two zero HP deltas below are the gate's doing, not a dead run.
        expect(result.healing!.rounds[0].perActor.get(FOCUS_ID)!.directHeal).toBeGreaterThan(0);
        // `perRecipientApply` off ⇒ `applyHealToTarget` runs only for `rid === healing.targetId`,
        // and the selector's recipient is not the anchor, so no HP moves anywhere. The
        // discriminating assertion is the ANCHOR's: under the deleted flag-off arm this heal
        // routed to `[healing.targetId]` and therefore DID repair it. Its staying at 45,000 is
        // what proves the anchor is no longer a routing destination.
        expect(target!.currentHp).toBe(45_000);
        expect(low!.currentHp).toBe(10_000);
    });

    it("a plain 'ally' heal on the SAME fixture covers the WHOLE footprint instead", () => {
        idc = 0;
        let target: CombatActor | undefined;
        let low: CombatActor | undefined;
        let caster: CombatActor | undefined;
        runCombat({
            ...FENCE(),
            shipSkills: singleAllyHealerSkills(),
            perRecipientHealApply: true,
            __testTapActors: (actors) => {
                setFenceHp(actors);
                target = actors.find((a) => a.id === HIGH_HP_TARGET_ID);
                low = actors.find((a) => a.id === LOW_HP_ID);
                caster = actors.find((a) => a.id === FOCUS_ID);
            },
        });
        // The Task 4 rule: an unspecified single ally means "the ship's target pattern". Every
        // footprint-covered own-side actor is repaired — including the anchor the selector case
        // above deliberately leaves alone, which is what makes these two cases a real contrast
        // rather than two spellings of one behaviour. The caster is at full HP (all overheal), so
        // assert it did not LOSE any; the two allies carry the observable movement.
        expect(low!.currentHp).toBe(15_000);
        expect(target!.currentHp).toBe(50_000);
        expect(caster!.currentHp).toBe(50_000);
    });
});
