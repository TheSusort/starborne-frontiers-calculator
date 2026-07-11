/**
 * Lionheart Protection — clear-on-redirect ENGINE integration (Task 4, consumer of Task 1's
 * `hasAnyProtectionGrant` precompute + Task 3's `clearAllOnRedirect` buff-config field).
 *
 * Lionheart R4 grants itself 10 stacks of Protection at the top of every round (a real
 * ABILITY-SOURCED ACCUMULATING status: `type:'buff'`, `stackTrigger:'per-round'`,
 * `isStackable:true`, `maxStacks:10` — registered via `registerActorAbilityStatuses` into
 * `accumSelfMaps`, read via `selfBuffStacksForOwner`'s 3-source fold). At 10 stacks (100%
 * redirect fraction, 10%/stack), Lionheart intercepts the FIRST ally hit each round in full —
 * then, per its kit text ("all Protection is removed" after a redirect), the WHOLE pool is
 * cleared (not just decremented), so a SECOND hit the same round is NOT redirected. The next
 * round's `beginRound` top-of-round tick re-accumulates 0 -> min(0+10,10) = 10, so the redirect
 * resumes.
 *
 * This mirrors protectionTransfer.integration.test.ts's "PRODUCTION PATH" aura-protector test,
 * but the protector's Protection is the real accumulating-ability shape (not the static aura
 * helper `protectionAuraPassive`), and TWO enemies fire at the SAME adjacent ally in round 1 so
 * both the redirect and its one-shot consumption are exercised within a single round.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import type { Ability, ShipSkills } from '../../../types/abilities';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

/** A flat enemy attacker (no shipSkills -> engine synthesizes a single 100% basic hit). */
const manualEnemy = (id: string, attack: number): EnemyAttacker => ({
    id,
    stats: { attack, crit: 0, critDamage: 0, speed: 50 },
    chargeCount: 0,
    startCharged: false,
});

/** A walked player team actor (a pure victim/protector stat block, role ATTACKER so it is a
 *  valid victim). Optional `passive` slots carry an ability (e.g. Lionheart's Protection grant).
 */
const teamActor = (
    id: string,
    defence: number,
    passive?: ShipSkills['slots'],
    speed = 100
): TeamActorEngineInput => ({
    id,
    speed,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    role: 'ATTACKER',
    walk: {
        shipSkills: { slots: passive ?? [] },
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

/** Lionheart R4's round-start Protection grant, as the parser really emits it: a per-round
 *  ACCUMULATING buff (rate = stacks = 10, capped at maxStacks = 10) whose config carries
 *  `clearAllOnRedirect: true` — the field Task 3 threaded onto the buff-config type and this
 *  task's engine consumer (`clearProtectionOnRedirectIds`) scans for. */
const lionheartProtectionPassive = (): ShipSkills['slots'][number] => {
    const ability: Ability = {
        id: 'lionheart-protection',
        type: 'buff',
        target: 'self',
        trigger: 'on-cast',
        conditions: [],
        config: {
            type: 'buff',
            buffName: 'Protection',
            parsedEffects: {},
            stacks: 10,
            isStackable: true,
            maxStacks: 10,
            stackTrigger: 'per-round',
            clearAllOnRedirect: true,
        },
    };
    return { slot: 'passive', abilities: [ability] };
};

const ENEMY_ATTACK = 1000;
const LIONHEART_DEFENCE = 300;

const BASE_INPUT: CombatEngineInput = {
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] }, // the focus deals no offence itself; it is only a bystander.
    enemyDefense: 0,
    enemyHp: 1_000_000_000,
    numRounds: 2,
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
    healTargetId: 'ally-1', // both manual enemies fire at this single shared victim.
    teamActors: [
        teamActor('ally-1', 0), // the direct-hit victim (no Protection of its own).
        teamActor('lionheart', LIONHEART_DEFENCE, [lionheartProtectionPassive()]), // the protector.
    ],
    enemyAttackers: [manualEnemy('enemy-A', ENEMY_ATTACK), manualEnemy('enemy-B', ENEMY_ATTACK)],
};

describe('Lionheart Protection — clear-on-redirect (integration)', () => {
    it('redirects the FIRST ally-hit each round, then clears — the SECOND hit is NOT redirected; refresh-to-10 re-grants the redirect next round', () => {
        const res = runCombat(BASE_INPUT);

        const lionheartR1 = res.rounds[0]?.perActorIncoming?.['lionheart']?.incoming ?? 0;
        const allyR1 = res.rounds[0]?.perActorIncoming?.['ally-1']?.incoming ?? 0;
        const lionheartR2 = res.rounds[1]?.perActorIncoming?.['lionheart']?.incoming ?? 0;

        // Round 1, hit 1 (enemy-A): 10 stacks = 100% redirect fraction -> Lionheart takes the
        // WHOLE hit (re-mitigated on its own defence); the ally takes nothing from this hit.
        expect(lionheartR1).toBeGreaterThan(0);
        // Round 1, hit 2 (enemy-B): Protection was cleared after hit 1 -> NOT redirected -> the
        // ally takes this hit directly. If the clear loop did not reach the ability-sourced
        // accumulating Protection, this hit would ALSO redirect and allyR1 would be 0.
        expect(allyR1).toBeGreaterThan(0);
        // Round 2: beginRound's top-of-round tick re-accumulates 0 -> 10 (refresh-to-10) ->
        // the redirect resumes on round 2's first hit.
        expect(lionheartR2).toBeGreaterThan(0);
    });
});
