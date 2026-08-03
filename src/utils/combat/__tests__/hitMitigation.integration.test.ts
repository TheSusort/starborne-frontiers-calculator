/**
 * `Hit Mitigation` blocks the next direct hit and spreads it over the HOLDER as a 3-round
 * self-DoT. Oleander grants it to all allies for 3 turns; it built as a name-only buff (empty
 * parsedEffects) so nothing read it.
 *
 * Name-keyed rather than a parsedEffects entry: a one-shot block has no honest standing value,
 * so routing it through an incoming channel would leak permanent damage immunity into
 * effective-HP and the DPS aggregate — the same reasoning that made Exposed name-keyed.
 *
 * Harness mirrors transformIncomingToDot.test.ts: the victim's speed is far higher than the
 * attacker's so its own turn-start DoT tick runs BEFORE that round's incoming hit, keeping
 * "0 immediate damage this hit" and "the tick lands next turn" cleanly separated.
 *
 * The status is self-cast from the victim's ACTIVE slot, not its passive slot: a passive-slot
 * `on-cast` self-buff does not reliably apply in this engine, whereas the active-slot pattern is
 * verified working by transformIncomingToDot.test.ts's `tauntSelfBuff`.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, type CombatEngineInput } from '../engine';
import { createEventBus, type CombatEvent } from '../events';
import type { Ability } from '../../../types/abilities';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';
import type { Position } from '../../../types/encounters';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const DIRECT_HIT = 5000; // attack 5000 × 100% × 1 hit vs defence 0.
const HP = 10_000_000; // large enough nothing ever dies; small enough pct math stays precise.
const ROUNDS = 3; // Hit Mitigation's DoT spread, per its buff description.

const hitMitigationSelfBuff = (): Ability => ({
    id: 'hit-mitigation',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Hit Mitigation',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 99, // long enough that expiry never confounds one-shot consumption
    },
});

const parsedTarget = (selection: ParsedTarget['selection']): ParsedTarget => ({
    raw: selection,
    side: 'enemy',
    selection,
});
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

const noopDamage = (): Ability => ({
    id: 'noop-dmg',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 0 },
});

let atkCounter = 0;
const basicAttack = (): Ability => ({
    id: `basic-${++atkCounter}`,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100 },
});

/** The Hit Mitigation holder: fast (acts first, so the buff is up), never deals real damage. */
const holderTeamActor = (id: string, position: Position): TeamActor =>
    ({
        id,
        speed: 1000,
        chargeCount: 0,
        startCharged: false,
        selfBuffs: [],
        enemyDebuffs: [],
        position,
        walk: {
            shipSkills: {
                slots: [{ slot: 'active', abilities: [hitMitigationSelfBuff(), noopDamage()] }],
            },
            stats: {
                attack: 0,
                crit: 0,
                critDamage: 0,
                defensePenetration: 0,
                hacking: 0,
                defence: 0,
                hp: HP,
            },
            selfDotModifier: 0,
            defensePenetrationBuff: 0,
            affinityDamageModifier: 0,
            affinityCritCap: 100,
            affinityCritPenalty: 0,
            hasChargedSkill: false,
        },
    }) as TeamActor;

const offensiveEnemy = (id: string, position: Position): EnemyAttacker =>
    ({
        id,
        stats: { attack: DIRECT_HIT, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1 },
        chargeCount: 0,
        startCharged: false,
        position,
        target: parsedTarget('front'),
        pattern: basePattern(),
        shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack()] }] },
    }) as EnemyAttacker;

const BASE_PLAYER_SIDE = (overrides: Partial<CombatEngineInput>): CombatEngineInput => ({
    attack: 0,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [noopDamage()] }] },
    enemyDefense: 0,
    enemyHp: HP,
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
    hp: HP,
    healTargetId: 'attacker',
    ...overrides,
});

/** Collects hp-changed and generic dot-ticked events for one target. */
function collectFor(input: CombatEngineInput, targetId: string) {
    const bus = createEventBus();
    const hpChanges: { round: number; oldPct: number; newPct: number }[] = [];
    const genericTicks: { round: number; damage: number }[] = [];
    bus.on('hp-changed', (e: Extract<CombatEvent, { type: 'hp-changed' }>) => {
        if (e.targetId === targetId)
            hpChanges.push({ round: e.round, oldPct: e.oldPct, newPct: e.newPct });
    });
    bus.on('dot-ticked', (e: Extract<CombatEvent, { type: 'dot-ticked' }>) => {
        if (e.targetId === targetId && e.dotType === 'generic')
            genericTicks.push({ round: e.round, damage: e.damage });
    });
    const result = runCombat({ ...input, bus });
    return { hpChanges, genericTicks, result };
}

/** battleSimulator's `incomingHpThisRound` derivation, verbatim, for one round/target. */
function simHpLossFor(
    result: ReturnType<typeof runCombat>,
    round: number,
    targetId: string
): number {
    const entry = result.rounds.find((r) => r.round === round)!;
    const taken = entry.perTargetDamage?.[targetId] ?? 0;
    const inc = entry.perActorIncoming?.[targetId];
    return inc ? Math.max(0, inc.incoming - inc.shieldAbsorbed - inc.barrierAbsorbed) : taken;
}

describe('Hit Mitigation blocks the next direct hit and spreads it as a self-DoT', () => {
    it('the blocked hit drains no HP immediately — the sim HP derivation nets to 0 that round', () => {
        const input = BASE_PLAYER_SIDE({
            numRounds: 1,
            teamActors: [holderTeamActor('holder', 'M4')],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
        });
        const { result } = collectFor(input, 'holder');
        expect(simHpLossFor(result, 1, 'holder')).toBe(0); // pre-fix: DIRECT_HIT
    });

    it('creates a generic self-DoT ticking at DIRECT_HIT / 3', () => {
        const input = BASE_PLAYER_SIDE({
            numRounds: 2,
            teamActors: [holderTeamActor('holder', 'M4')],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1')],
        });
        const { genericTicks } = collectFor(input, 'holder');
        expect(genericTicks.length).toBeGreaterThanOrEqual(1);
        expect(genericTicks[0].damage).toBeCloseTo(DIRECT_HIT / ROUNDS, 6);
    });

    it('is ONE-SHOT — a second attacker in the same round lands at full strength', () => {
        // Two attackers, both hitting the holder. Exactly one hit is blocked, so total HP lost
        // must equal the generic-tick damage PLUS one unblocked DIRECT_HIT.
        const input = BASE_PLAYER_SIDE({
            numRounds: 1,
            teamActors: [holderTeamActor('holder', 'M4')],
            enemyAttackers: [offensiveEnemy('enemy-1', 'M1'), offensiveEnemy('enemy-2', 'M2')],
        });
        const { hpChanges, genericTicks } = collectFor(input, 'holder');
        const totalHpLost = hpChanges.reduce(
            (sum, c) => sum + ((c.oldPct - c.newPct) / 100) * HP,
            0
        );
        const totalTicks = genericTicks.reduce((sum, t) => sum + t.damage, 0);
        expect(totalHpLost - totalTicks).toBeCloseTo(DIRECT_HIT, 4);
    });

    it('is team-symmetric — an enemy holder blocks a player hit identically', () => {
        // Holder on the ENEMY side, hit by the player focus attacker. Same invariant as case 1;
        // amounts are NOT compared across sides (RNG is keyed by ownerId).
        const enemyHolder = (): EnemyAttacker =>
            ({
                id: 'holder',
                stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 1000 },
                chargeCount: 0,
                startCharged: false,
                position: 'M4' as Position,
                target: parsedTarget('front'),
                pattern: basePattern(),
                shipSkills: {
                    slots: [{ slot: 'active', abilities: [hitMitigationSelfBuff(), noopDamage()] }],
                },
            }) as EnemyAttacker;

        const input = BASE_PLAYER_SIDE({
            numRounds: 1,
            attack: DIRECT_HIT, // the player focus now deals the hit
            shipSkills: { slots: [{ slot: 'active', abilities: [basicAttack()] }] },
            speed: 1,
            position: 'M4',
            target: parsedTarget('front'),
            pattern: basePattern(),
            enemyAttackers: [enemyHolder()],
        });
        const { result } = collectFor(input, 'holder');
        expect(simHpLossFor(result, 1, 'holder')).toBe(0);
    });
});
