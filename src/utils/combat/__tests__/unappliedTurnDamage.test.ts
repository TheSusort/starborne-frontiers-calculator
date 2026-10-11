/**
 * #657 TRIPWIRE — a cast turn the engine does not resolve positionally carries NO damage.
 *
 * Every hit lands per victim through the positional apply. A turn that skips it either has no
 * victim (an ally-targeted cast, or the DPS page's 0-HP focus that no enemy can target) or has no
 * hit at all — and nothing lands its `directDamage`, so that figure must be 0. If a cast shape
 * ever reaches the skipped arm WITH damage, the damage silently vanishes; this file fails first.
 *
 * Measured through `__testTapUnappliedTurnDamage`, which the engine calls for every such turn.
 * The instrument is validated by the stat-scaled-only cast below: before #657 that cast was not
 * positional and the tap reported its full 50,000.
 *
 * The corpus arm runs real kits (docs/ reference data) through the battle simulator and the DPS
 * adapter. It THROWS when the data is missing rather than skipping: a green run with no corpus
 * would measure nothing.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { parsePattern, parseTarget } from '../../targetingParser';
import type { Ability } from '../../../types/abilities';
import { composeBattle, type TaggedShip } from '../audit/compose';
import { tagShip } from '../audit/classes';
import { runSeededBattle } from '../../simulator/seededRuns';
import { simulateDPS } from '../../calculators/dpsSimulator';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { loadShipSkillRecords, csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { loadShipDataByName, shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';

const reports: { actorId: string; damage: number }[] = [];

vi.mock('../engine', async (importOriginal) => {
    const mod = await importOriginal<typeof import('../engine')>();
    return {
        ...mod,
        runCombat: (input: Parameters<typeof mod.runCombat>[0]) =>
            mod.runCombat({
                ...input,
                __testTapUnappliedTurnDamage: (actorId, damage) => {
                    reports.push({ actorId, damage });
                },
            }),
    };
});

// Imported after the mock is declared (vi.mock is hoisted, so this is the wrapped module).
const { runCombat } = await import('../engine');

const nonZero = () => reports.filter((r) => r.damage !== 0 || Number.isNaN(r.damage));

const common = {
    numRounds: 2,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
    defensePenetration: 0,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    chargeCount: 0,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    crit: 0,
    critDamage: 0,
    defence: 0,
    hp: 1_000_000,
    speed: 500,
    position: 'M4' as const,
    hacking: 100_000,
    security: 1_000,
    teamActors: [],
};

const brute = {
    id: 'brute',
    stats: {
        attack: 10_000,
        crit: 0,
        critDamage: 0,
        defence: 0,
        hp: 10_000_000,
        speed: 100,
        hacking: 100_000,
        security: 0,
    },
    chargeCount: 0,
    startCharged: false,
    position: 'M4' as const,
    target: parseTarget('front'),
    pattern: parsePattern('Pattern-Base'),
    shipSkills: { slots: [] },
};

describe('#657 a turn that is not applied positionally carries no damage', () => {
    it('a stat-scaled-only cast is applied (the instrument can fire)', () => {
        reports.length = 0;
        const statScaled: Ability = {
            id: 'sec',
            type: 'additional-damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'additional-damage', stat: 'security', pct: 5000 },
        };
        runCombat({
            ...common,
            attack: 0,
            shipSkills: { slots: [{ slot: 'active', abilities: [statScaled] }] },
            enemyAttackers: [brute],
        });
        expect(nonZero()).toEqual([]);
    });

    it('the DPS mode 0-HP focus: enemies with real attacks report nothing', () => {
        reports.length = 0;
        const smash: Ability = {
            id: 'smash',
            type: 'damage',
            target: 'enemy',
            trigger: 'on-cast',
            conditions: [],
            config: { type: 'damage', multiplier: 300 },
        };
        runCombat({
            ...common,
            hp: 0,
            attack: 0,
            shipSkills: { slots: [] },
            enemyAttackers: [
                { ...brute, shipSkills: { slots: [{ slot: 'active', abilities: [smash] }] } },
            ],
        });
        // The enemy's turns are the unapplied ones here — and they carry nothing.
        expect(reports.some((r) => r.actorId.includes('brute'))).toBe(true);
        expect(nonZero()).toEqual([]);
    });
});

describe('#657 real-kit corpus: no unapplied turn carries damage', () => {
    let tagged: TaggedShip[];

    beforeAll(() => {
        if (!csvAvailable() || !shipDataAvailable())
            throw new Error('docs/ship-skills.csv and docs/ship-data.json are required');
        const namesByUpper = new Map<string, string>();
        for (const r of loadShipSkillRecords()) namesByUpper.set(r.name.toUpperCase(), r.name);
        for (const [upper, data] of loadShipDataByName())
            if (!namesByUpper.has(upper)) namesByUpper.set(upper, data.name);
        tagged = [];
        for (const name of namesByUpper.values()) {
            const ship = buildTraceShip(name);
            if (ship) tagged.push({ ship, classes: tagShip(ship) });
        }
    });

    it('battle simulator, 25 seeded real-kit compositions', () => {
        reports.length = 0;
        for (let seed = 1; seed <= 25; seed++) runSeededBattle(composeBattle(seed, tagged), seed);
        expect(reports.length).toBeGreaterThan(0);
        expect(nonZero()).toEqual([]);
    });

    it('DPS adapter, every real kit as the focus against a default enemy', () => {
        reports.length = 0;
        for (const { ship } of tagged) {
            simulateDPS({
                attack: 10_000,
                crit: 50,
                critDamage: 150,
                defensePenetration: 0,
                chargeCount: 3,
                shipSkills: buildShipAbilities(ship),
                enemyDefense: 5_000,
                enemyHp: 1_000_000,
                rounds: 3,
                selfBuffs: [],
                enemyDebuffs: [],
                name: ship.name,
            });
        }
        expect(reports.length).toBeGreaterThan(0);
        expect(nonZero()).toEqual([]);
    });
});
