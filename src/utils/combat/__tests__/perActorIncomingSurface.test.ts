/**
 * perActorIncomingSurface.test.ts — PR7 Task 6: surface the per-round `perActorIncoming` map on
 * the DPS `RoundData`.
 *
 * The engine already maintains a fresh per-round `perActorIncoming: Map<id, ActorIntake>` where
 * each positional victim's incoming/shieldAbsorbed/barrierAbsorbed lands in its OWN bucket. Until
 * this task that map was surfaced only on the healing-rounds output, NOT on the DPS RoundData. This
 * task mirrors the `perActorShield`/`perActorDetonation` "set-only-when-non-empty" pattern so legacy
 * rounds (no per-victim intake) keep RoundData.perActorIncoming === undefined → goldens byte-identical.
 *
 * Harness mirrors perVictimAttacked.integration.test.ts ENEMY_BASE: the focus player ('attacker')
 * is parked OUT of the footprint (M1, zero offense, empty slot) so the ONLY damage source is a
 * positioned enemy AoE attacker; two player team victims occupy M4 (anchor) and M3 (covered, inside
 * Line-Range-1). The enemy AoE hits BOTH → both per-actor incoming buckets are populated.
 *
 * Crit 0 keeps everything deterministic.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput, TeamActorEngineInput } from '../engine';
import { ShipSkills } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';
import type { CombatStatBlock } from '../../../types/calculator';
import { bareEnemy, BARE_ENEMY_ID } from '../__testutils__/bareRosterFixture';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});

// AoE pattern: origin + one covered cell one step toward back (Pattern-Line-Range-1).
const lineRange1Pattern = (): ParsedPattern => ({
    raw: 'line-range-1',
    shape: 'line',
    range: 1,
    modifiers: {},
});

// Origin-only (single-target) footprint — the non-positional control source pattern.
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

// A no-passive single-hit basic-attack active slot (multiplier 100% = 1x, 1 hit).
const basicAttack = (): ShipSkills['slots'][number] => ({
    slot: 'active',
    abilities: [
        {
            id: 'pais-basic',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 100 },
        },
    ],
});

const victimStats = (hp: number): CombatStatBlock => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    defence: 0,
    hp,
    hacking: 0,
});

// A positioned, zero-offense PLAYER team victim (walked so it has real stats/position). Empty active
// slot → it deals nothing; it is purely a damageable target.
const playerVictim = (id: string, position: Position, hp: number): TeamActorEngineInput =>
    ({
        id,
        speed: 1,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        walk: {
            shipSkills: { slots: [] } as ShipSkills,
            stats: victimStats(hp),
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
            healModifier: 0,
        },
    }) as TeamActorEngineInput;

// A positioned ENEMY attacker that fires `front` with the supplied pattern + a 100% damage active.
const enemyAttackerAt = (id: string, position: Position, pattern: ParsedPattern): EnemyAttacker =>
    ({
        id,
        stats: { attack: 5_000, crit: 0, critDamage: 0, defence: 0, hp: 1_000_000_000, speed: 100 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern,
        shipSkills: { slots: [basicAttack()] },
    }) as EnemyAttacker;

// A positional battle where a POSITIONED ENEMY ('enemy-aoe') fires at the player roster. The focus
// player ('attacker') is parked OUT of the footprint (M1, zero offense, empty slot) so the only
// damage source is the enemy. Two player victims: anchor at M4 (front) + covered at M3.
const ENEMY_BASE = (pattern: ParsedPattern): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [] },
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
    hp: 1_000_000_000,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M1',
    target: parsedTarget('front'),
    pattern: basePattern(),
    teamActors: [
        playerVictim('pl-front', 'M4', 1_000_000_000),
        playerVictim('pl-mid', 'M3', 1_000_000_000),
    ],
    enemyAttackers: [enemyAttackerAt('enemy-aoe', 'M4', pattern)],
});

// A minimal single-opponent battle: a focus attacker hitting ONE real enemy, no positions given
// on the player side and no teamActors. SP-U U5: the enemy takes the round's dealt damage through
// the shared per-victim funnel, so it records its OWN intake into the per-actor map.
//
// SP-4b-2b: this used to pass NO enemy roster at all, which made the singular vestigial `enemy`
// the target (`dpsEnemyTarget`) and the bucket key `'enemy'`. An empty roster is now a validation
// error, and with any roster present the sink is bypassed entirely — measured: the sink records NO
// per-actor intake at all. (That measurement was taken against the 0-max-HP "pressure source" shape
// as well as a normal roster; SP-4c-2a has since retired that shape — `withTargetableHp` in
// normalizeRoster.ts floors every enemy attacker's max HP — so it is not even constructible now,
// which only narrows the ways the sink could be reached.) SP-4c-2d then deleted the sink actor
// outright, so there is no longer anything to bypass. The U5 property has MOVED to the real
// opponent rather than vanished, and the bucket key moves with it (M1). The pinned 5000 is
// unchanged.
const NON_POSITIONAL: CombatEngineInput = {
    enemyAttackers: bareEnemy({ stats: { hp: 1_000_000_000 } }),
    attack: 5_000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [basicAttack()] },
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
    hp: 1_000_000_000,
    speed: 200,
};

describe('PR7 Task 6 — perActorIncoming surfaced on RoundData', () => {
    it('a positional AoE round carries perActorIncoming with a covered victim entry (incoming > 0)', () => {
        const result = runCombat(ENEMY_BASE(lineRange1Pattern()));
        const round = result.rounds[0];
        expect(round.perActorIncoming).toBeDefined();
        // The COVERED victim (M3, inside the Line-Range-1 footprint) carries its own intake bucket.
        const covered = round.perActorIncoming?.['pl-mid'];
        expect(covered).toBeDefined();
        expect(covered?.incoming).toBeGreaterThan(0);
        expect(typeof covered?.shieldAbsorbed).toBe('number');
        expect(typeof covered?.barrierAbsorbed).toBe('number');
        // The anchor victim (M4) also took the firing hit → its own bucket.
        expect(round.perActorIncoming?.['pl-front']?.incoming).toBeGreaterThan(0);
    });

    it("a single-opponent DPS round records the real enemy target's own intake (SP-U U5)", () => {
        const result = runCombat(NON_POSITIONAL);
        const round = result.rounds[0];
        // The DPS enemy is a real, destructible target: this round's 5000 direct damage lands
        // through the shared funnel → the enemy carries its own per-victim intake bucket.
        expect(round.perActorIncoming).toBeDefined();
        expect(round.perActorIncoming?.[BARE_ENEMY_ID]?.incoming).toBe(5000);
        expect(round.perActorIncoming?.[BARE_ENEMY_ID]?.shieldAbsorbed).toBe(0);
        expect(round.perActorIncoming?.[BARE_ENEMY_ID]?.barrierAbsorbed).toBe(0);
        // The vestigial sink took nothing — the intake really is booked against the real actor
        // and not double-booked on both.
        expect(round.perActorIncoming?.enemy).toBeUndefined();
    });
});
