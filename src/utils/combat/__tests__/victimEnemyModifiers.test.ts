/**
 * B1 Task 2 — `victimEnemyModifiers(victimId)` per-victim enemy-debuff reader (unwired).
 *
 * WHY NEITHER (a) NOR (b) AS ORIGINALLY DESCRIBED:
 *   The task spec offers two strategies to test the reader before Task 3 wires
 *   per-victim routing for player→enemy SCHEDULED writes:
 *
 *   (a) Enemy→player ability debuffs: `buildTurnArgs` threads `targetId: tgt.id` for
 *       `a.side === 'enemy'` (engine.ts ~line 2552), so applyTimedAbilityStatus routes
 *       the debuff to the player victim's per-actor store. HOWEVER: ability-applied timed
 *       entries carry a `payload` field, and `statusEngine.snapshot().activeEnemyDebuffs`
 *       filters `!s.payload` (line ~774 in statusEngine.ts). So approach (a) ability debuffs
 *       ARE stored under the player victim's id, but are EXCLUDED from the snapshot read
 *       that victimEnemyModifiers uses. Approach (a) cannot produce a non-zero result with
 *       the spec'd snapshot-based reader.
 *
 *   (b) "Directly seed via test seam": no public seam exists to inject a non-payload entry
 *       into a specific victim's store — upsertBuff (called by sourceFired) always writes
 *       to DEFAULT_ENEMY_TARGET ('__enemy__'), and all per-victim seeding (applyTimedAbilityStatus)
 *       attaches a payload.
 *
 * CHOSEN APPROACH — test per-victim STORE ISOLATION via the default sentinel:
 *   Player-side scheduled enemy debuffs (CombatEngineInput.enemyDebuffs) go through
 *   sourceFired → upsertBuff → DEFAULT_ENEMY_TARGET ('__enemy__'). These are non-payload
 *   scheduled entries and ARE included in snapshot().activeEnemyDebuffs keyed by that id.
 *
 *   victimEnemyModifiers('__enemy__') reads that store → correct non-zero result.
 *   victimEnemyModifiers('any-other-id') reads an empty store → {0, 0}.
 *
 *   This proves EXACTLY what Task 2 can prove: the helper correctly keys off victimId
 *   (returns the debuff value for the right id, zero for any other id), and correctly
 *   chains snapshot → expandEnemyDebuffs → toEnemyModifiers. Task 3's test will prove
 *   that PLAYER-APPLIED debuffs route to named victim ids instead of '__enemy__'.
 *
 * NOTE on ownerId=undefined:
 *   `snapshot(undefined, victimId)` passes undefined as ownerId, which defaults to 'attacker'
 *   in the statusEngine. This is IRRELEVANT for the enemy-debuff read — activeEnemyDebuffs
 *   keys solely off enemyTargetId. The ownerId default is harmless and a future reader
 *   should NOT think it is load-bearing for the enemy-debuff side of the read.
 */
import { describe, it, expect } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import type { SelectedGameBuff } from '../../../types/calculator';

// A timed scheduled Defense Down: fires on 'active' turns, duration 3.
// skillSource='active' + skillDuration=3 → timed entry (not always-active/accumulating).
// Goes to DEFAULT_ENEMY_TARGET ('__enemy__') via sourceFired → upsertBuff.
// Non-payload so it appears in snapshot().activeEnemyDebuffs.
const defenseDown: SelectedGameBuff = {
    id: 'vem-dd',
    buffName: 'Defense Down',
    stacks: 1,
    parsedEffects: { defense: -30 },
    isStackable: false,
    skillSource: 'active',
    skillDuration: 3,
};

// Minimal focus attacker that fires its active slot (so sourceFired fires 'active').
const BASE_INPUT = (overrides: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: {
        slots: [
            {
                slot: 'active',
                abilities: [
                    {
                        id: 'vem-dmg',
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
    enemyDefense: 0,
    enemyHp: 10_000_000,
    numRounds: 1,
    selfBuffs: [],
    // Seed the Defense Down scheduled debuff — fires when active slot is cast.
    enemyDebuffs: [defenseDown],
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 10_000_000,
    ...overrides,
});

describe('B1 Task 2 — victimEnemyModifiers per-victim reader', () => {
    it('returns the Defense Down modifier for the default sentinel and zero for any other id', () => {
        let captured:
            | ((victimId: string) => {
                  enemyDefenseModifier: number;
                  incomingDamageModifier: number;
              })
            | undefined;

        runCombat(
            BASE_INPUT({
                __testTapVictimEnemyModifiers: (fn) => {
                    captured = fn;
                },
            })
        );

        // The tap must have fired — if not, the field/tap call is absent.
        expect(captured).toBeDefined();

        // DEFAULT_ENEMY_TARGET ('__enemy__') holds the scheduled Defense Down (defense: -30).
        // sourceFired → upsertBuff → enemyMaps.get('__enemy__') → non-payload entry
        // → snapshot(undefined, '__enemy__').activeEnemyDebuffs contains it
        // → expandEnemyDebuffs resolves it via enemyDebuffLookup
        // → toEnemyModifiers folds {defense: -30} → enemyDefenseModifier: -30.
        //
        // NOTE: ownerId=undefined is irrelevant here — activeEnemyDebuffs keys only off
        // enemyTargetId='__enemy__'. The ownerId default ('attacker') is harmless.
        expect(captured!('__enemy__')).toEqual({
            enemyDefenseModifier: -30,
            incomingDamageModifier: 0,
        });

        // Any other id has an EMPTY per-victim store → both modifiers are 0.
        // This proves victimEnemyModifiers isolates per-victim: a non-'__enemy__' id
        // does NOT bleed in the default-sentinel's debuffs.
        expect(captured!('front-enemy')).toEqual({
            enemyDefenseModifier: 0,
            incomingDamageModifier: 0,
        });
        expect(captured!('back-enemy')).toEqual({
            enemyDefenseModifier: 0,
            incomingDamageModifier: 0,
        });
    });
});
