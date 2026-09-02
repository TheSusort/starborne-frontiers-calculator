import { describe, it, expect } from 'vitest';
import {
    simulateDPS,
    DPSSimulationInput,
    SYNTHESIZED_DPS_ENEMY_ID,
} from '../../calculators/dpsSimulator';
import { TeamActorInput, CombatStatBlock } from '../../../types/calculator';
import { Ability, ShipSkills } from '../../../types/abilities';
import { createEventBus, CombatEvent } from '../events';

// Task 1 — Thresh-style extra-action / speed-expiry integration test.
//
// Scenario: actor F (base speed 100) starts with a passive-slot Speed Up (+50%, duration 1)
// seeded at round-1 start via seedPassiveTimedStatuses. With the buff live, F's effective
// speed = 150 > G (120), so F acts FIRST. F's active skill also grants a same-round extra
// action (oncePerRound, endOfRound: false). After F's first turn the post-turn
// decrementPlayer drops the Speed Up duration from 1 to 0 and it expires. F's effective
// speed is now 100. The extra-action pending is 1 for F; G still has pending 1.
// selectNextBySpeed picks G first (120 > 100), then F's extra action last.
// Expected turn order (round 1): [F, G, F]  NOT  [F, F, G].
//
// Task 2 — non-speed-buff guard.
// The lowestSpeedAlly.test.ts already validates that an Attack Up (non-speed buff) applied
// via the selection loop correctly doubles damage — see the "lowest-speed-ally live gate"
// suite. This file adds a lightweight orthogonal check via buff-applied event.

const minStats = (overrides: Partial<CombatStatBlock> = {}): CombatStatBlock => ({
    attack: 15000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    hacking: 250,
    defence: 0,
    hp: 0,
    ...overrides,
});

const damageAbility = (multiplier: number, id = 'dmg'): Ability => ({
    id,
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier },
});

// Passive-slot Speed Up (+50%, duration 1). Seeded by seedPassiveTimedStatuses at round 1
// start BEFORE any turn fires. decrementPlayer runs in F's own post-turn: 1-1 = 0, expired.
const passiveSpeedUp = (): Ability => ({
    id: 'f-speed-up',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Speed Up',
        parsedEffects: { speed: 50 },
        stacks: 1,
        isStackable: false,
        duration: 1,
    },
});

// On-cast extra-action grant for F. oncePerRound: true so it fires at most once per round.
// endOfRound: false means normal speed-positioned pool (not the end-of-round pool).
const extraActionGrant = (): Ability => ({
    id: 'f-extra',
    type: 'extra-action',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'extra-action', oncePerRound: true, endOfRound: false },
});

// F's skill: passive Speed Up (duration 1) + active damage + active extra-action grant.
// The passive slot is seeded once at round-1 start; the active abilities fire on F's turn.
const fSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'passive',
            abilities: [passiveSpeedUp()],
        },
        {
            slot: 'active',
            abilities: [damageAbility(100, 'f-dmg'), extraActionGrant()],
        },
    ],
});

// G's skill: simple active damage only. Speed 120, no buffs.
const gSkills = (): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [damageAbility(100, 'g-dmg')],
        },
    ],
});

const gActor = (): TeamActorInput => ({
    id: 'g',
    speed: 120, // faster than F's BASE speed (100) but slower than F's BUFFED speed (150)
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    shipSkills: gSkills(),
    stats: minStats(),
});

const baseInput = (overrides: Partial<DPSSimulationInput> = {}): DPSSimulationInput => ({
    attack: 15000,
    crit: 0,
    critDamage: 150,
    defensePenetration: 0,
    chargeCount: 0,
    enemyDefense: 0,
    enemyHp: 100_000_000,
    rounds: 1,
    speed: 100, // F's base speed
    selfBuffs: [],
    enemyDebuffs: [],
    shipSkills: fSkills(),
    hacking: 250,
    enemySecurity: 100,
    teamActors: [gActor()],
    ...overrides,
});

/**
 * Per-round PLAYER turn order from turn-started events (drops the opposing actor).
 *
 * A scalar-only `simulateDPS` run now fights a REAL, positioned enemy
 * (`SYNTHESIZED_DPS_ENEMY_ID`); the vestigial dummy `enemy` no longer takes a turn — and since
 * SP-4c-2c not on any run at all (`turnOrderActors` drops it unconditionally; the
 * `dummyEnemyIsVestigial` gate is deleted). The id to drop moved from `'enemy'` to `'enemy-1'`. The
 * player orders asserted below are unchanged: the synthesized enemy keeps the dummy's default
 * speed (50), below both F (100/150) and G (120), and carries `attack: 0` with no `shipSkills`.
 */
const playerTurnOrder = (events: CombatEvent[]): string[][] => {
    const byRound = new Map<number, string[]>();
    for (const e of events) {
        if (e.type !== 'turn-started') continue;
        if (e.actorId === SYNTHESIZED_DPS_ENEMY_ID) continue;
        const list = byRound.get(e.round) ?? [];
        list.push(e.actorId);
        byRound.set(e.round, list);
    }
    return [...byRound.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list);
};

describe('dynamic-speed extra-action: speed-buff expiry after first turn reorders extra action', () => {
    it('F acts first (Speed Up active), extra action selected AFTER G once Speed Up expires — order [F, G, F]', () => {
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('turn-started', (e) => events.push(e));

        simulateDPS(baseInput({ bus }));

        const order = playerTurnOrder(events);
        expect(order.length).toBe(1);

        // Round 1:
        //   selection tick 1: F has Speed Up (effective 150) vs G (120) — F acts first.
        //   F's turn: fires active, grants extra action (+1 pending for F). Post-turn:
        //     decrementPlayer(F) — Speed Up turnsRemaining 1 to 0 — expired. F now at base 100.
        //   selection tick 2: G pending=1 (speed 120) vs F extra pending=1 (speed 100 now) — G acts.
        //   selection tick 3: F extra pending=1 (speed 100) — only F left — F's extra turn.
        expect(order[0]).toEqual(['attacker', 'g', 'attacker']);
    });

    it('WITHOUT the passive Speed Up F acts after G — confirms the buff drove the reordering', () => {
        // Control: remove F's passive Speed Up so F (base 100) is always slower than G (120).
        const noSpeedUpSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [damageAbility(100, 'f-dmg'), extraActionGrant()],
                },
            ],
        };
        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('turn-started', (e) => events.push(e));

        simulateDPS(baseInput({ bus, shipSkills: noSpeedUpSkills }));

        const order = playerTurnOrder(events);
        expect(order.length).toBe(1);

        // Without the Speed Up: G (120) > F (100) — G acts first. F acts, grants extra, still
        // speed 100. F's extra is picked next (no one else left) — order [G, F, F].
        expect(order[0]).toEqual(['g', 'attacker', 'attacker']);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2 — non-speed-buff guard (Attack Up still applies through selection loop)
// ─────────────────────────────────────────────────────────────────────────────
// The lowestSpeedAlly.test.ts suite already covers this comprehensively: it proves
// that an Attack Up (+100%) applied via the start-of-round reactive path (same selection
// loop) doubles directDamage from 10000 to 20000. Duplicating that assertion here would
// add no new coverage; the existing suite is the canonical guard for this property.
//
// A lightweight orthogonal check: an on-cast Attack Up from a team actor (G) is emitted
// via buff-applied — proving the selection loop does not strip or skip non-speed buffs.
describe('dynamic-speed: non-speed buff (Attack Up) applies correctly through selection loop', () => {
    it("G's on-cast Attack Up is observed (buff-applied event) without affecting turn order", () => {
        const attackUpSkills: ShipSkills = {
            slots: [
                {
                    slot: 'active',
                    abilities: [
                        damageAbility(100, 'g-dmg'),
                        {
                            id: 'g-atk-up',
                            type: 'buff',
                            target: 'self',
                            trigger: 'on-cast',
                            conditions: [],
                            config: {
                                type: 'buff',
                                buffName: 'Attack Up',
                                parsedEffects: { attack: 100 },
                                stacks: 1,
                                isStackable: false,
                                duration: 3,
                            },
                        } satisfies Ability,
                    ],
                },
            ],
        };

        // Two-round run: G (speed 120) acts before attacker F (speed 100, no speed buff).
        const input: DPSSimulationInput = {
            attack: 10000,
            crit: 0,
            critDamage: 150,
            defensePenetration: 0,
            chargeCount: 0,
            enemyDefense: 0,
            enemyHp: 100_000_000,
            rounds: 2,
            speed: 100,
            selfBuffs: [],
            enemyDebuffs: [],
            shipSkills: {
                slots: [
                    {
                        slot: 'active',
                        abilities: [damageAbility(100, 'f-dmg')],
                    },
                ],
            },
            hacking: 250,
            enemySecurity: 100,
            teamActors: [
                {
                    ...gActor(),
                    speed: 120,
                    shipSkills: attackUpSkills,
                    stats: minStats({ attack: 10000 }),
                },
            ],
        };

        const bus = createEventBus();
        const events: CombatEvent[] = [];
        bus.on('turn-started', (e) => events.push(e));
        bus.on('buff-applied', (e) => events.push(e));
        simulateDPS({ ...input, bus });

        // Turn order each round: G then F (G is faster, no speed buffs involved).
        const order = playerTurnOrder(events);
        expect(order[0]).toEqual(['g', 'attacker']);
        expect(order[1]).toEqual(['g', 'attacker']);

        // G applies Attack Up on its own turn (on-cast, target: self). The buff is a
        // non-speed buff — the selection loop must not strip or ignore it. Confirm by
        // checking the event bus: at least one buff-applied for G's Attack Up.
        const buffApplied = events.filter(
            (e) => e.type === 'buff-applied' && e.actorId === 'g' && e.buffName === 'Attack Up'
        );
        expect(buffApplied.length).toBeGreaterThanOrEqual(1);
    });
});
