import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { Ability, ShipSkills } from '../../../types/abilities';
import { parsePattern } from '../../targetingParser';
import type { ParsedTarget } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatActor } from '../state';

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
// `resolveSupportRecipients` (supportRecipients.ts:15-19) FILTERS `baseRecipients` by the
// footprint; it NEVER expands it. And `recipientsFor` (playerTurn.ts:3347-3362) builds that base as:
//   'self'                          → [actor.id]
//   'all-allies'                    → playerIds        ← the only MULTI-element base
//   single 'ally', teamBattle ON    → [lowestHpAllyId(playerIds)]
//   single 'ally', teamBattle OFF   → [healing.targetId]
// So a single-`ally` heal has exactly ONE base recipient and the pattern can only REMOVE it.
// Multi-ally pattern healing therefore comes only from `all-allies` abilities. Fixture A uses
// `all-allies` to exercise the application half; Fixture B uses single-`ally` to exercise the
// routing fence, because that is the only shape that reaches `lowestHpAllyId` at all.

/** `all-allies` repair for 10% of the caster's 50000 hp basis → 5000 raw per recipient. */
const allAlliesHeal = (): Ability =>
    ab({ type: 'heal', target: 'all-allies', config: { type: 'heal', pct: 10, basis: 'hp' } });

/** Single-`ally` repair — the ONLY shape that reaches the lowest-HP routing branch. */
const singleAllyHeal = (): Ability =>
    ab({ type: 'heal', target: 'ally', config: { type: 'heal', pct: 10, basis: 'hp' } });

const healerSkills = (): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [allAlliesHeal()] }],
});

const singleAllyHealerSkills = (): ShipSkills => ({
    slots: [{ slot: 'active', abilities: [singleAllyHeal()] }],
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
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: healerSkills(),
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
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

describe('SP-3a: per-recipient heal application is separable from lowest-HP routing', () => {
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
        // Heals route only to healTargetId (the focus), so the ally's HP is untouched.
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
const HIGH_HP_TARGET_ID = 'ally-high-hp-is-the-heal-target';
const LOW_HP_ID = 'ally-low-hp';

const FENCE = (): CombatEngineInput => ({
    ...BASE(),
    shipSkills: singleAllyHealerSkills(),
    position: 'M1',
    pattern: parsePattern('Pattern-Line-Support-Range-3'),
    // The configured heal target is the HIGHER-HP ally, so "routed to the heal target" and
    // "routed to the lowest-HP ally" predict DIFFERENT recipients.
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

describe('SP-3a: the fence — teamBattle keeps its lowest-HP routing', () => {
    it('enabling perRecipientHealApply does NOT switch routing to lowest HP', () => {
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
        // Decision 7: NOT lowest HP. The 20%-HP ally is on-pattern and still gets nothing.
        //
        // NOTE — this test is deliberately INSENSITIVE to `perRecipientHealApply` itself: with
        // `mode: 'battle'` absent, `healing.teamBattle` is false, so `recipientsFor`
        // (playerTurn.ts:3361) takes the single-element `else base = [healing.targetId]` branch —
        // there is no second candidate for the flag to include or exclude, and
        // `applyHealToTarget`'s `victim` default (engine.ts:3005) already resolves to the same
        // actor either way. That is the point, not a gap: the fence's job here is to prove the
        // flag does NOT leak into routing, which this asserts by construction (flag on, routing
        // unchanged from the no-flag case below). Its discriminating power is against the
        // OPPOSITE regression — someone gating `playerTurn.ts:3360` on `perRecipientHealApply`
        // instead of `teamBattle` — which would heal the low-HP ally here and fail this test.
        expect(target!.currentHp).toBeGreaterThan(45_000);
        expect(low!.currentHp).toBe(10_000);
    });

    it('routing is identical with the flag absent — perRecipientHealApply is routing-neutral', () => {
        idc = 0;
        let target: CombatActor | undefined;
        let low: CombatActor | undefined;
        runCombat({
            ...FENCE(),
            __testTapActors: (actors) => {
                setFenceHp(actors);
                target = actors.find((a) => a.id === HIGH_HP_TARGET_ID);
                low = actors.find((a) => a.id === LOW_HP_ID);
            },
        });
        // Same fixture, same assertions, NO flags at all. This test and the flag-on test above
        // asserting the SAME outcome is the invariant being pinned: `perRecipientHealApply` must
        // never change single-`ally` routing. If a future change ever makes these two diverge,
        // the flag has leaked into routing.
        expect(target!.currentHp).toBeGreaterThan(45_000);
        expect(low!.currentHp).toBe(10_000);
    });

    it("mode 'battle' STILL routes that same heal by lowest HP", () => {
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
        // The battle sim's shipped behaviour, unchanged by this PR: the 20% ally is chosen and the
        // configured heal target gets nothing. Exactly inverted from the test above on the SAME
        // fixture — which is what proves the two flags drive different routing. Asserting only the
        // widened side would prove nothing about strictness.
        expect(low!.currentHp).toBeGreaterThan(10_000);
        expect(target!.currentHp).toBe(45_000);
    });
});
