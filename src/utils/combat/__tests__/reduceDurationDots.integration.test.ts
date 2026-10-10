/**
 * A duration cut on "all active debuffs" shortens damage-over-time effects too (owner ruling
 * 2026-10-04: DoTs are debuffs). Heliodor's "When directly damaged, this Unit reduces the duration
 * of all active debuffs on all allies by 1 turn" and Pestilence's "When this Unit inflicts a debuff,
 * it reduces the duration of all active debuffs on all allies by 1 turn" take a turn off every
 * Corrosion and Inferno entry; one cut to 0 expires as a natural expiry does, without ticking. An
 * unremovable DoT (Acidic Decay) is shortened like any other (R173).
 *
 * Measured against a control board identical but for the passive, so the DoTs' own per-turn
 * decrements cancel out. Real parsed kits (buildTraceShip on docs/ship-skills.csv). Each case runs
 * on both sides.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { ShipSkills, SkillSlot } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import type { ActiveDoTStack, CombatActor } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

beforeEach(() => {
    setupKeyedRng(33);
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

const kit = (ship: string, slots: SkillSlot[]): ShipSkills => {
    const built = buildTraceShip(ship);
    if (!built) throw new Error(`${ship} missing from reference data`);
    const found = buildShipAbilities(built).slots.filter((s) => slots.includes(s.slot));
    if (found.length !== slots.length) throw new Error(`${ship} lacks one of ${slots.join(',')}`);
    return { slots: found };
};
const EMPTY: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };
const HIT: ShipSkills = {
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: 'hit',
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 10 },
                },
            ],
        },
    ],
};

const HP = 1e9;

interface Spec {
    id: string;
    kit: ShipSkills;
    speed: number;
    position: Position;
}

const asEnemy = (s: Spec): EnemyAttacker => ({
    id: s.id,
    stats: {
        attack: 100,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: HP,
        speed: s.speed,
        security: 0,
        hacking: 1e6,
    },
    chargeCount: 9,
    startCharged: false,
    position: s.position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: s.kit,
});
const asTeammate = (s: Spec): TeamActor => ({
    id: s.id,
    speed: s.speed,
    chargeCount: 9,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position: s.position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    walk: {
        shipSkills: s.kit,
        stats: {
            attack: 100,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 1e6,
            defence: 0,
            hp: HP,
            security: 0,
        },
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: true,
    },
});

/** `mine[0]` is the M4 front ship of its side; `theirs` the other side. */
const board = (mine: Spec[], theirs: Spec[], playerMine: boolean): CombatEngineInput => {
    const players = playerMine ? mine : theirs;
    const enemies = playerMine ? theirs : mine;
    const [front, ...rest] = players;
    return {
        enemyAttackers: enemies.map(asEnemy),
        teamActors: rest.map(asTeammate),
        attack: 100,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        chargeCount: 9,
        shipSkills: front.kit,
        numRounds: 2,
        selfBuffs: [],
        enemyDebuffs: [],
        hasChargedSkill: true,
        startCharged: false,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        defence: 0,
        hp: HP,
        hacking: 1e6,
        security: 0,
        mode: 'battle',
        position: front.position,
        target: parseTarget('front'),
        pattern: parsePattern('Pattern-Base'),
        speed: front.speed,
    };
};

interface After {
    corrosion: number[];
    acidic: number[];
    inferno: number[];
    infernoTicks: number;
}

/** Seeds `holderId` with Corrosion (5 turns), an unremovable Acidic Decay (5 turns) and Inferno
 *  (`infernoTurns`), runs, and reads them at the end. */
const run = (input: CombatEngineInput, holderId: string, infernoTurns: number): After => {
    const bus = createEventBus();
    const out: After = { corrosion: [], acidic: [], inferno: [], infernoTicks: 0 };
    bus.on('dot-ticked', (e: Extract<CombatEvent, { type: 'dot-ticked' }>) => {
        if (e.targetId === holderId && e.dotType === 'inferno') out.infernoTicks += 1;
    });
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            const h = all.find((a) => a.id === holderId);
            if (!h) throw new Error(`${holderId} missing`);
            // Applied by a real opponent, so the seeded DoTs tick (an unresolvable applier deals
            // nothing and emits no tick).
            const applier = all.find((a) => a.side !== h.side);
            if (!applier) throw new Error('no opponent');
            const entry = (turns: number, extra: Partial<ActiveDoTStack> = {}): ActiveDoTStack => ({
                stacks: 1,
                tier: 1,
                remainingRounds: turns,
                sourceId: applier.id,
                ...extra,
            });
            h.corrosionEntries.push(
                entry(5),
                entry(5, { family: 'Acidic Decay', unremovable: true })
            );
            h.infernoEntries.push(entry(infernoTurns));
            bus.on('round-ended', () => {
                out.corrosion = h.corrosionEntries
                    .filter((e) => !e.unremovable)
                    .map((e) => e.remainingRounds);
                out.acidic = h.corrosionEntries
                    .filter((e) => e.unremovable)
                    .map((e) => e.remainingRounds);
                out.inferno = h.infernoEntries.map((e) => e.remainingRounds);
            });
        },
    });
    return out;
};

for (const playerMine of [true, false]) {
    const tag = playerMine ? 'player' : 'enemy-side';

    describe(`${tag}: Heliodor's "reduces the duration of all active debuffs" reaches DoTs`, () => {
        // Heliodor acts first each round (her DoTs tick on her turn), then is hit once.
        const heliodor = (k: ShipSkills): Spec => ({
            id: 'heliodor',
            kit: k,
            speed: 200,
            position: 'M4',
        });
        const hitter: Spec = { id: 'hitter', kit: HIT, speed: 100, position: 'M4' };
        const holder = playerMine ? 'attacker' : 'heliodor';
        const passive = (): ShipSkills => ({
            slots: [{ slot: 'active', abilities: [] }, kit('Heliodor', ['passive']).slots[0]],
        });

        it('two hits take two turns off Corrosion and Acidic Decay', () => {
            const control = run(board([heliodor(EMPTY)], [hitter], playerMine), holder, 2);
            const cut = run(board([heliodor(passive())], [hitter], playerMine), holder, 2);
            expect(control.corrosion).toHaveLength(1);
            expect(cut.corrosion).toEqual([control.corrosion[0] - 2]);
            expect(control.acidic).toHaveLength(1);
            expect(cut.acidic).toEqual([control.acidic[0] - 2]);
        });

        // Round 1's tick precedes the hitter's first turn, so it has no applier to deal from and
        // only round 2 ticks — unless the round-1 cut has already expired the Inferno.
        it('a 2-turn Inferno cut to 0 expires without its last tick', () => {
            const control = run(board([heliodor(EMPTY)], [hitter], playerMine), holder, 2);
            const cut = run(board([heliodor(passive())], [hitter], playerMine), holder, 2);
            expect(control.infernoTicks).toBe(1);
            expect(cut.infernoTicks).toBe(0);
            expect(cut.inferno).toEqual([]);
        });
    });

    describe(`${tag}: Pestilence's "when this Unit inflicts a debuff" cut reaches allies' DoTs`, () => {
        // Pestilence casts first (her Corrosion II lands → the cut on all allies), then the ally
        // carrying the DoTs takes its turn and ticks.
        const pestilence = (slots: SkillSlot[]): Spec => ({
            id: 'pestilence',
            kit: kit('Pestilence', slots),
            speed: 200,
            position: 'M4',
        });
        const ally: Spec = { id: 'ally', kit: EMPTY, speed: 100, position: 'M3' };
        const target: Spec = { id: 'target', kit: EMPTY, speed: 10, position: 'M4' };

        it('each landed infliction takes a turn off the ally’s Corrosion and Acidic Decay', () => {
            const control = run(
                board([pestilence(['active']), ally], [target], playerMine),
                'ally',
                1
            );
            const cut = run(
                board([pestilence(['active', 'passive']), ally], [target], playerMine),
                'ally',
                1
            );
            expect(control.corrosion).toHaveLength(1);
            // Two rounds, one landed Corrosion II each.
            expect(cut.corrosion).toEqual([control.corrosion[0] - 2]);
            expect(control.acidic).toHaveLength(1);
            expect(cut.acidic).toEqual([control.acidic[0] - 2]);
        });

        // As for Heliodor: the round-1 tick precedes the applier's first turn and deals nothing.
        it('a 2-turn Inferno cut to 0 expires without its last tick', () => {
            const control = run(
                board([pestilence(['active']), ally], [target], playerMine),
                'ally',
                2
            );
            const cut = run(
                board([pestilence(['active', 'passive']), ally], [target], playerMine),
                'ally',
                2
            );
            expect(control.infernoTicks).toBe(1);
            expect(cut.infernoTicks).toBe(0);
            expect(cut.inferno).toEqual([]);
        });
    });
}
