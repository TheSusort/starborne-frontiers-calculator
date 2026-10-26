/**
 * A hit an incoming-block proc stops whole (Shadowguard) never reaches the victim's shield: its log
 * row carries no shield-hit marker, the pool is untouched, and Nyxen's "deals X% damage when its
 * shield is directly damaged" does not fire for it.
 *
 * Board: Nyxen (real kit) stands alone on its side and acts first — its active grants it a shield
 * of 15% of its max HP — plus Stealth and a Shadowguard-style full block forced to proc (chance 1;
 * the shipped chances never fire on the deterministic rate gate within one round). Two attackers
 * then hit it for 1,000 each, A1 before A2. Shadowguard is once per round, so A1's hit is blocked
 * and A2's lands on the shield. Without the block both land on the shield. Mounted both ways.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { LOG_EVENT_TYPES } from '../../calculators/battleSimulator';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildCombatLog } from '../log/buildCombatLog';
import type { CombatLogEntry } from '../log/types';
import type { CombatActor } from '../state';
import type { Ability, ShipSkills } from '../../../types/abilities';
import { mirrorBoard, realSlots, ShipSpec } from './__fixtures__/mirrorBoard';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error('This suite requires docs/ship-skills.csv and docs/ship-data.json');
    }
});
beforeEach(() => setupKeyedRng(7));

const stealthSelf: Ability = {
    id: 'nyxen-stealth',
    type: 'buff',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'buff',
        buffName: 'Stealth',
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        duration: 99,
    },
};

const shadowguard: Ability = {
    id: 'nyxen-shadowguard',
    type: 'incoming-block',
    target: 'self',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'incoming-block',
        condition: 'self-stealth',
        procChance: 1,
        blockPct: 1,
        oncePerRound: true,
    },
    autoFilled: true,
};

const hitter = (id: string): ShipSkills => ({
    slots: [
        {
            slot: 'active',
            abilities: [
                {
                    id: `${id}-hit`,
                    type: 'damage',
                    target: 'enemy',
                    trigger: 'on-cast',
                    conditions: [],
                    config: { type: 'damage', multiplier: 100 },
                },
            ],
        },
    ],
});

const run = (side: 'player' | 'enemy', block: boolean) => {
    const [active, passive] = realSlots('Nyxen', ['active', 'passive']);
    const nyxen: ShipSpec = {
        id: 'nyxen',
        position: 'M4',
        speed: 1000,
        attack: 1000,
        hp: 1e9,
        skills: {
            slots: [
                { ...active, abilities: [...active.abilities, stealthSelf] },
                {
                    ...passive,
                    abilities: [...passive.abilities, ...(block ? [shadowguard] : [])],
                },
            ],
        },
    };
    const a1: ShipSpec = {
        id: 'a1',
        position: 'M4',
        speed: 20,
        attack: 1000,
        hp: 1e9,
        skills: hitter('a1'),
    };
    const a2: ShipSpec = {
        id: 'a2',
        position: 'T4',
        speed: 10,
        attack: 1000,
        hp: 1e9,
        skills: hitter('a2'),
    };
    const { input, idOf } = mirrorBoard({ caster: [nyxen], other: [a1, a2], numRounds: 1 }, side);
    const specOf = (id: string) => ['nyxen', 'a1', 'a2'].find((s) => idOf(s) === id) ?? id;
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const t of LOG_EVENT_TYPES) bus.on(t, (e) => events.push(e as CombatEvent));
    const counteredAt: string[] = [];
    bus.on(
        'reactive-damage-performed',
        (e: Extract<CombatEvent, { type: 'reactive-damage-performed' }>) => {
            if (e.sourceId === idOf('nyxen')) counteredAt.push(specOf(e.targetId));
        }
    );
    let shieldGranted = 0;
    bus.on('shield-applied', (e: Extract<CombatEvent, { type: 'shield-applied' }>) => {
        if (e.recipientIds.includes(idOf('nyxen'))) shieldGranted += e.amount;
    });
    let nyxenActor: CombatActor | undefined;
    runCombat({
        ...input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            nyxenActor = all.find((a) => a.id === idOf('nyxen'));
        },
    });
    const roster = ['nyxen', 'a1', 'a2'].map((s) => ({
        actorId: idOf(s),
        side: (s === 'nyxen') === (side === 'player') ? ('player' as const) : ('enemy' as const),
        name: s,
    }));
    const log = buildCombatLog(events, roster, new Map());
    const entries: CombatLogEntry[] = log.flatMap((r) => r.turns.flatMap((t) => t.entries));
    const shieldMarks = (spec: string) =>
        entries
            .filter((e) => e.kind === 'attack' && e.actorId === idOf(spec))
            .flatMap((e) => e.targets)
            .filter((t) => t.targetId === idOf('nyxen'))
            .map((t) => t.shieldWasHit === true);
    return {
        marks: { a1: shieldMarks('a1'), a2: shieldMarks('a2') },
        counteredAt,
        shieldLost: shieldGranted - (nyxenActor?.shieldPool ?? Number.NaN),
        hpLost: 1e9 - (nyxenActor?.currentHp ?? Number.NaN),
    };
};

describe('a fully blocked hit does not reach the shield', () => {
    for (const side of ['player', 'enemy'] as const) {
        describe(`Nyxen on the ${side} side`, () => {
            it('no block: both hits land on the shield and Nyxen answers both', () => {
                const { marks, counteredAt, shieldLost, hpLost } = run(side, false);
                expect(shieldLost).toBeCloseTo(2000, 6);
                expect(hpLost).toBe(0);
                expect(marks).toEqual({ a1: [true], a2: [true] });
                expect(counteredAt).toEqual(['a1', 'a2']);
            });
            it('Shadowguard: the blocked hit leaves the shield alone, unmarked and unanswered', () => {
                const { marks, counteredAt, shieldLost, hpLost } = run(side, true);
                expect(shieldLost).toBeCloseTo(1000, 6);
                expect(hpLost).toBe(0);
                expect(marks).toEqual({ a1: [false], a2: [true] });
                expect(counteredAt).toEqual(['a2']);
            });
        });
    }
});
