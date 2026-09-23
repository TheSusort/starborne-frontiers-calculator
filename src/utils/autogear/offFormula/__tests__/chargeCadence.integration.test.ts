import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';
import { chargePeriod } from '../basisDerivation';
import { buildShipAbilities } from '../../../abilities/buildShipAbilities';
import { runCombat, type CombatEngineInput } from '../../../combat/engine';
import { createEventBus, type CombatEvent } from '../../../combat/events';
import { bareEnemy } from '../../../combat/__testutils__/bareRosterFixture';
import { csvAvailable, loadShipSkillRecords } from '../../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../../scripts/lib/shipDataSnapshot';
import type { Ship } from '../../../../types/ship';

interface Datum {
    name: string;
    role: string;
    hp: number;
    attack: number;
    defense: number;
    hacking: number;
    security: number;
    speed: number;
    critRate: number;
    critDamage: number;
}

// Verbatim from offFormulaStats.test.ts / basisDerivation.test.ts — 4 refits so the
// highest-unlocked passive resolves.
const asShip = (rec: ReturnType<typeof loadShipSkillRecords>[number], d: Datum): Ship =>
    ({
        id: rec.name.toLowerCase(),
        name: rec.name,
        type: d.role,
        baseStats: {
            attack: d.attack,
            crit: d.critRate,
            critDamage: d.critDamage,
            hacking: d.hacking,
            security: d.security,
            defence: d.defense,
            hp: d.hp,
            speed: d.speed,
        },
        equipment: {},
        implants: {},
        refits: [0, 1, 2, 3].map((i) => ({ id: `r${i}`, stats: [] })),
        activeSkillText: rec.active,
        chargeSkillText: rec.charge,
        chargeSkillCharge: rec.chargeCharge,
        firstPassiveSkillText: rec.passives[0],
        secondPassiveSkillText: rec.passives[1],
        thirdPassiveSkillText: rec.passives[2],
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
        chargedTarget: 'front',
        chargedPattern: 'Pattern-Base',
    }) as unknown as Ship;

const shipNamed = (name: string): Ship => {
    const data: Datum[] = JSON.parse(readFileSync('docs/ship-data.json', 'utf8'));
    const byName = new Map(data.map((d) => [d.name.toLowerCase(), d]));
    const rec = loadShipSkillRecords().find((r) => r.name.toLowerCase() === name.toLowerCase());
    const d = rec && byName.get(rec.name.toLowerCase());
    if (!rec || !d) throw new Error(`mutation guard: no corpus ship named ${name}`);
    return asShip(rec, d);
};

/** The focus attacker's own actor id under a non-positional, single-enemy `runCombat` input
 *  (matches every other direct-engine fixture in `combat/__tests__/`). */
const FOCUS = 'attacker';

const ROUNDS = 40;

/**
 * Runs `ship` alone against a punching bag that can never kill it (0 attack, 10M HP — the
 * `bareEnemy` fixture every direct-engine test in `combat/__tests__/` uses), for long enough to
 * observe several of Prophet's 9-round cycles, and returns every `charge-changed` event the
 * FOCUS actor emitted.
 *
 * `chargePeriod` treats every own-targeted `charge` ability as unconditional (see `ownChargeGain`'s
 * doc in `basisDerivation.ts`) — it has no static view of an ability's own game CONDITION
 * (Chakara's own-charge rides "if all damaged enemies have more Speed than this Unit"; Hemlock's
 * rides landing a debuff). The fight is built so both
 * kinds of condition hold on every round: the enemy is faster than any corpus ship (satisfies a
 * speed condition) and carries no Security against a focus hacking pinned far above any
 * corpus value (`liveDebuffLandingChance` clamps to 100%, so a debuff-gated charge gain never
 * misses to RNG). Without this the real cadence diverges from the derivation for exactly the
 * ships whose bonus charge rides a condition — Chakara and Hemlock, pinned below.
 *
 * Subscribes to the engine's bus DIRECTLY (`createEventBus` + `runCombat({ ..., bus })`) rather
 * than going through `battleSimulator`/`simulateBattle`, whose event surface carries an allowlist
 * that can silently make a handler dead code.
 */
function runLongFight(ship: Ship): Array<Extract<CombatEvent, { type: 'charge-changed' }>> {
    const stats = ship.baseStats as {
        attack: number;
        crit: number;
        critDamage: number;
        defence: number;
        hp: number;
        hacking: number;
        security: number;
        speed: number;
    };

    const input: CombatEngineInput = {
        attack: stats.attack,
        crit: stats.crit,
        critDamage: stats.critDamage,
        defensePenetration: 0,
        chargeCount: ship.chargeSkillCharge ?? 0,
        shipSkills: buildShipAbilities(ship),
        numRounds: ROUNDS,
        selfBuffs: [],
        enemyDebuffs: [],
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        hasChargedSkill: (ship.chargeSkillCharge ?? 0) > 0,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: stats.defence,
        hp: stats.hp,
        // Pinned far above any corpus ship's security so a debuff-gated charge gain always
        // lands (see the doc comment above) — not the ship's own real hacking.
        hacking: 1000,
        security: stats.security,
        speed: stats.speed,
        enemyAttackers: bareEnemy({ stats: { hp: 10_000_000, security: 0, speed: 999 } }),
    };

    const bus = createEventBus();
    const chargeEvents: Array<Extract<CombatEvent, { type: 'charge-changed' }>> = [];
    bus.on('charge-changed', (e) => {
        if (e.actorId === FOCUS) chargeEvents.push(e);
    });
    runCombat({ ...input, bus });
    return chargeEvents;
}

const roundsWithChargeReset = (
    events: Array<Extract<CombatEvent, { type: 'charge-changed' }>>
): number[] => events.filter((e) => e.reason === 'cast-reset').map((e) => e.round);

const gapsBetween = (rounds: number[]): number[] => rounds.slice(1).map((r, i) => r - rounds[i]);

describe.skipIf(!csvAvailable() || !shipDataAvailable())(
    'chargePeriod pinned against a real fight',
    () => {
        // `chargePeriod` re-implements advanceChargeCadence (combat/state.ts) plus `runPlayerTurn`'s
        // own-charge block (the `action === 'active'` branch that calls `chargeGainFromSkill` with
        // `targetFilter: 'own'`). This asserts the re-implementation against the engine's real cast
        // sequence.
        it.each([
            ['Chakara', 2],
            ['Nuqtu', 3],
            ['Hemlock', 4],
            ['Prophet', 9],
        ])('%s fires its charged skill every %i rounds in a real fight', (name, expected) => {
            const resets = roundsWithChargeReset(runLongFight(shipNamed(name)));
            // NON-VACUITY GATE, not decoration: `[].every(...)` is `true`, so with no bus wired
            // (advanceChargeCadence emits only when `bus && round !== undefined`) this whole test
            // passes while observing nothing. Assert the instrument saw casts BEFORE reading them.
            expect(resets.length).toBeGreaterThanOrEqual(2);
            expect(gapsBetween(resets).every((g) => g === expected)).toBe(true);
            expect(chargePeriod(shipNamed(name))).toBe(expected);
        });
    }
);
