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
// `all-allies` to exercise the application half.

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
