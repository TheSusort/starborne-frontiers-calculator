/**
 * Anemone's "When an enemy takes damage from a damage over time effect, this Unit repairs 5% of its
 * max HP" fires once per DoT STACK that ticks (owner ruling R45, 2026-10-05): an enemy carrying 3
 * Corrosion stacks and 1 Inferno gives four repairs at its tick, not one per DoT type. Every DoT
 * stack is its own damage-over-time effect (R26), so each one ticking is its own "takes damage from
 * a damage over time effect".
 *
 * Real parsed kit (buildTraceShip on docs/ship-skills.csv, refit 4): Anemone's passive slot, with
 * an inert active so her turn deals nothing. The enemy's DoTs are seeded as entries holding several
 * stacks — the shape Snakeroot's "2 stacks of Corrosion" leaves — so a count by entry, by DoT type
 * and by stack all give different answers. A Bomb never ticks (it detonates), so it is not part of
 * this rule.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { ShipSkills } from '../../../types/abilities';
import type { Position } from '../../../types/encounters';
import type { ActiveDoTStack, CombatActor } from '../state';

beforeAll(() => {
    if (!csvAvailable() || !shipDataAvailable()) {
        throw new Error(
            'This suite requires docs/ship-skills.csv and docs/ship-data.json (gitignored reference data) — copy them in before running'
        );
    }
});

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];
type TeamActor = NonNullable<CombatEngineInput['teamActors']>[number];

/** Anemone's real passive slot behind an inert active. */
const anemoneKit = (): ShipSkills => {
    const built = buildTraceShip('Anemone');
    if (!built) throw new Error('Anemone missing from reference data');
    const passive = buildShipAbilities(built).slots.find((s) => s.slot === 'passive');
    if (!passive?.abilities.some((a) => a.trigger === 'on-enemy-dot-damage'))
        throw new Error('Anemone passive lost its on-enemy-dot-damage repair');
    return { slots: [{ slot: 'active', abilities: [] }, passive] };
};
const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };

const HP = 1e6;

const entries = (stacks: number[], sourceId: string): ActiveDoTStack[] =>
    stacks.map((s) => ({ stacks: s, tier: 3, remainingRounds: 9, sourceId }));

interface Seed {
    corrosion?: number[];
    inferno?: number[];
}

const enemyAt = (
    id: string,
    position: Position,
    speed: number,
    shipSkills: ShipSkills = NO_SKILLS
): EnemyAttacker => ({
    id,
    stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: HP, speed, security: 0 },
    chargeCount: 9,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills,
});

const teamAt = (id: string, position: Position, speed: number): TeamActor => ({
    id,
    speed,
    chargeCount: 9,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    walk: {
        shipSkills: NO_SKILLS,
        stats: {
            attack: 1000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            defence: 0,
            hp: HP,
            hacking: 0,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 9,
    shipSkills: NO_SKILLS,
    // Two rounds; round 2 is measured, when every DoT's applier has acted (an applier that has
    // not yet acted ticks nothing — `tickDoTs`).
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
    hacking: 0,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    speed: 100,
    ...over,
});

interface Board {
    tag: string;
    anemoneId: string;
    /** The ship whose DoTs tick: an enemy of Anemone, or (negative) her own ally. */
    holderId: string;
    /** Who applied the seeded DoTs (it must have acted for its DoTs to tick). */
    applierId: string;
    input: CombatEngineInput;
}

/** `anemoneFirst`: Anemone acts before the DoT holder (the reverse board lets the holder go first;
 *  the tick lands on the holder's own turn either way). */
const board = (
    side: 'player' | 'enemy',
    holder: 'enemy' | 'ally',
    anemoneFirst: boolean
): Board => {
    const fast = 150;
    const slow = 50;
    const aSpeed = anemoneFirst ? fast : slow;
    const hSpeed = anemoneFirst ? slow : fast;
    if (side === 'player') {
        if (holder === 'enemy')
            return {
                tag: `player Anemone, DoTs on an enemy, ${anemoneFirst ? 'she acts first' : 'enemy acts first'}`,
                anemoneId: 'attacker',
                holderId: 'enemy-a',
                applierId: 'attacker',
                input: base({
                    shipSkills: anemoneKit(),
                    speed: aSpeed,
                    enemyAttackers: [enemyAt('enemy-a', 'M4', hSpeed)],
                }),
            };
        return {
            tag: `player Anemone, DoTs on her ally (negative), ${anemoneFirst ? 'she acts first' : 'ally acts first'}`,
            anemoneId: 'attacker',
            holderId: 'ally',
            applierId: 'enemy-a',
            input: base({
                shipSkills: anemoneKit(),
                speed: aSpeed,
                teamActors: [teamAt('ally', 'M3', hSpeed)],
                enemyAttackers: [enemyAt('enemy-a', 'M4', 200)],
            }),
        };
    }
    if (holder === 'enemy')
        return {
            tag: `enemy Anemone, DoTs on the player focus, ${anemoneFirst ? 'she acts first' : 'focus acts first'}`,
            anemoneId: 'enemy-anemone',
            holderId: 'attacker',
            applierId: 'enemy-anemone',
            input: base({
                speed: hSpeed,
                enemyAttackers: [enemyAt('enemy-anemone', 'M4', aSpeed, anemoneKit())],
            }),
        };
    return {
        tag: `enemy Anemone, DoTs on her ally (negative), ${anemoneFirst ? 'she acts first' : 'ally acts first'}`,
        anemoneId: 'enemy-anemone',
        holderId: 'enemy-ally',
        applierId: 'attacker',
        input: base({
            speed: 200,
            enemyAttackers: [
                enemyAt('enemy-anemone', 'M4', aSpeed, anemoneKit()),
                enemyAt('enemy-ally', 'M3', hSpeed),
            ],
        }),
    };
};

/** Anemone's round-2 repairs and the holder's round-2 DoT ticks, with `seed` on the holder. */
const run = (b: Board, seed: Seed): { repairs: number; ticks: number } => {
    const bus = createEventBus();
    let repairs = 0;
    let ticks = 0;
    bus.on(
        'reactive-heal-performed',
        (e: Extract<CombatEvent, { type: 'reactive-heal-performed' }>) => {
            if (e.casterId === b.anemoneId && e.round === 2) repairs += 1;
        }
    );
    bus.on('dot-ticked', (e: Extract<CombatEvent, { type: 'dot-ticked' }>) => {
        if (e.targetId === b.holderId && e.round === 2) ticks += 1;
    });
    runCombat({
        ...b.input,
        bus,
        __testTapActors: (all: CombatActor[]) => {
            for (const a of all) {
                if (a.id === b.anemoneId) a.currentHp = a.stats.hp * 0.5;
                if (a.id !== b.holderId) continue;
                if (seed.corrosion)
                    a.corrosionEntries.push(...entries(seed.corrosion, b.applierId));
                if (seed.inferno) a.infernoEntries.push(...entries(seed.inferno, b.applierId));
            }
        },
    });
    return { repairs, ticks };
};

beforeEach(() => {
    setupKeyedRng(5);
});

describe("Anemone's DoT-damage repair fires once per ticking DoT stack (R45)", () => {
    for (const side of ['player', 'enemy'] as const) {
        for (const anemoneFirst of [true, false]) {
            const b = board(side, 'enemy', anemoneFirst);
            it(`${b.tag}: 3 Corrosion stacks (one entry) + 1 Inferno → 4 repairs`, () => {
                const m = run(b, { corrosion: [3], inferno: [1] });
                // The instrument: two tick events (one per DoT type) carry the four stacks.
                expect(m.ticks).toBe(2);
                expect(m.repairs).toBe(4);
            });
            it(`${b.tag}: two 2-stack Corrosion entries → 4 repairs`, () => {
                expect(run(b, { corrosion: [2, 2] }).repairs).toBe(4);
            });
            it(`${b.tag}: one 1-stack Corrosion → 1 repair`, () => {
                expect(run(b, { corrosion: [1] }).repairs).toBe(1);
            });
            it(`${b.tag}: no DoT → no repair`, () => {
                expect(run(b, {}).repairs).toBe(0);
            });
        }
        for (const anemoneFirst of [true, false]) {
            const b = board(side, 'ally', anemoneFirst);
            it(`${b.tag}: 3 Corrosion + 1 Inferno ticking on her own side → no repair`, () => {
                const m = run(b, { corrosion: [3], inferno: [1] });
                expect(m.ticks).toBe(2);
                expect(m.repairs).toBe(0);
            });
        }
    }
});
