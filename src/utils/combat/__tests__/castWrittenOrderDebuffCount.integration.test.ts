/**
 * A debuff-count gate written AFTER a same-skill infliction counts what that infliction landed
 * (owner ruling R29, 2026-10-04 — the written-order rule). Crocus's active: "deals 150% damage and
 * inflicts Corrosion II for 2 turns. If an enemy has 3 or more debuffs, this Unit inflicts Stasis
 * for 2 turns on that enemy." B carried 2 debuffs → the cast's Corrosion II lands on B → 3 → B gets
 * Stasis. Per struck enemy, on that enemy's own count; a Corrosion that was RESISTED adds nothing.
 *
 * The same rule reaches the other count gates written after a same-skill infliction:
 *  - Asphyxiator's charged: "inflicts Inc. DoT Damage Up III …, deals 215% damage, and inflicts
 *    Inferno III … If the targeted enemy … have 3 or more debuffs, it inflicts Stasis" — both the
 *    named debuff and the Inferno count;
 *  - Anemone's charged: "inflicts Corrosion III … If the primary target has 3 or more damage over
 *    time effects, this Unit gains Taunt" — her Corrosion counts.
 *
 * The contrast (owner ruling R15): Bayah's PASSIVE "When this Unit deals damage to an enemy that
 * has 2 or more debuffs" reacts to the damage, so only debuffs from before the cast count there.
 *
 * Real parsed kits (buildTraceShip on docs/ship-skills.csv). Each case runs on both sides: a player
 * caster against enemy A (and B, C on a Cone cast), and an enemy caster against the player focus
 * (and its allies).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { setupKeyedRng } from '../../calculators/rateAccumulator';
import { buildTraceShip } from '../../../../scripts/lib/traceShipFactory';
import { csvAvailable } from '../../../../scripts/lib/shipSkillCsv';
import { shipDataAvailable } from '../../../../scripts/lib/shipDataSnapshot';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { parsePattern, parseTarget, type ParsedPattern } from '../../targetingParser';
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
    setupKeyedRng(29);
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
const NO_SKILLS: ShipSkills = { slots: [{ slot: 'active', abilities: [] }] };

const HP = 1e9;
const SINGLE = (): ParsedPattern => parsePattern('Pattern-Base');
const CONE = (): ParsedPattern => parsePattern('Pattern-Cone-Range-1');

const base = (over: Partial<CombatEngineInput>): CombatEngineInput => ({
    enemyAttackers: [],
    attack: 1000,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: NO_SKILLS,
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
    hp: HP,
    hacking: 1e6,
    security: 0,
    mode: 'battle',
    position: 'M4',
    target: parseTarget('front'),
    pattern: SINGLE(),
    speed: 100,
    ...over,
});

const harmlessEnemy = (id: string, position: Position): EnemyAttacker => ({
    id,
    stats: { attack: 0, crit: 0, critDamage: 0, defence: 0, hp: HP, speed: 10, security: 0 },
    chargeCount: 0,
    startCharged: false,
    position,
    target: parseTarget('front'),
    pattern: SINGLE(),
    shipSkills: NO_SKILLS,
});
const harmlessAlly = (id: string, position: Position): TeamActor => ({
    id,
    speed: 10,
    chargeCount: 0,
    startCharged: false,
    selfBuffs: [],
    enemyDebuffs: [],
    position,
    target: parseTarget('front'),
    pattern: SINGLE(),
    walk: {
        shipSkills: NO_SKILLS,
        stats: {
            attack: 0,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 0,
            defence: 0,
            hp: HP,
            security: 0,
        },
        selfDotModifier: 0,
        defensePenetrationBuff: 0,
        affinityDamageModifier: 0,
        affinityCritCap: 100,
        affinityCritPenalty: 0,
        hasChargedSkill: false,
    },
});

interface Cast {
    kit: ShipSkills;
    charged: boolean;
    pattern?: ParsedPattern;
    hacking?: number;
}

/** The enemies a cast can strike, aimed first: A at M4, then B at M3 and C at T3 (a Cone cast
 *  from M4 strikes all three). */
interface Side {
    tag: string;
    casterId: string;
    struck: [string, string, string];
    input: (c: Cast) => CombatEngineInput;
}

const PLAYER: Side = {
    tag: 'player',
    casterId: 'attacker',
    struck: ['enemy-a', 'enemy-b', 'enemy-c'],
    input: ({ kit: k, charged, pattern, hacking }) =>
        base({
            shipSkills: k,
            hacking: hacking ?? 1e6,
            pattern: pattern ?? SINGLE(),
            hasChargedSkill: true,
            chargeCount: charged ? 1 : 9,
            startCharged: charged,
            enemyAttackers: [
                harmlessEnemy('enemy-a', 'M4'),
                harmlessEnemy('enemy-b', 'M3'),
                harmlessEnemy('enemy-c', 'T3'),
            ],
        }),
};

const ENEMY: Side = {
    tag: 'enemy-side',
    casterId: 'enemy-caster',
    struck: ['attacker', 'ally-b', 'ally-c'],
    input: ({ kit: k, charged, pattern, hacking }) =>
        base({
            attack: 0,
            hacking: 0,
            speed: 10,
            teamActors: [harmlessAlly('ally-b', 'M3'), harmlessAlly('ally-c', 'T3')],
            enemyAttackers: [
                {
                    id: 'enemy-caster',
                    stats: {
                        attack: 1000,
                        crit: 0,
                        critDamage: 0,
                        defence: 0,
                        hp: HP,
                        speed: 100,
                        security: 0,
                        hacking: hacking ?? 1e6,
                    },
                    chargeCount: charged ? 1 : 9,
                    startCharged: charged,
                    position: 'M4',
                    target: parseTarget('front'),
                    pattern: pattern ?? SINGLE(),
                    shipSkills: k,
                },
            ],
        }),
};

interface Measured {
    /** `buffName → target ids` of the caster's round-1 `debuff-applied`. */
    debuffs: Record<string, string[]>;
    /** `buffName → target ids` of the caster's round-1 `debuff-resisted`. */
    resisted: Record<string, string[]>;
    /** Target ids of the caster's round-1 Stasis `control-applied`. */
    stasisControls: string[];
    /** The caster's round-1 Taunt `control-applied` on itself. */
    tauntControls: number;
    /** `buff-applied` names on the caster in round 1. */
    buffs: string[];
}

/** Runs one round with `seeds[i]` Corrosion stacks (one entry each) on the i-th struck enemy. */
const measure = (side: Side, cast: Cast, seeds: number[][]): Measured => {
    const bus = createEventBus();
    const caster = side.casterId;
    const m: Measured = {
        debuffs: {},
        resisted: {},
        stasisControls: [],
        tauntControls: 0,
        buffs: [],
    };
    bus.on('debuff-applied', (e: Extract<CombatEvent, { type: 'debuff-applied' }>) => {
        if (e.sourceId === caster && e.round === 1) (m.debuffs[e.buffName] ??= []).push(e.targetId);
    });
    bus.on('debuff-resisted', (e: Extract<CombatEvent, { type: 'debuff-resisted' }>) => {
        if (e.sourceId === caster && e.round === 1)
            (m.resisted[e.buffName] ??= []).push(e.targetId);
    });
    bus.on('control-applied', (e: Extract<CombatEvent, { type: 'control-applied' }>) => {
        if (e.casterId === caster && e.round === 1 && e.effect === 'stasis')
            m.stasisControls.push(e.targetId);
        if (e.casterId === caster && e.round === 1 && e.effect === 'taunt' && e.targetId === caster)
            m.tauntControls += 1;
    });
    bus.on('buff-applied', (e: Extract<CombatEvent, { type: 'buff-applied' }>) => {
        if (e.actorId === caster && e.round === 1) m.buffs.push(e.buffName);
    });
    runCombat({
        ...side.input(cast),
        bus,
        __testTapActors: (all: CombatActor[]) => {
            side.struck.forEach((id, i) => {
                const a = all.find((x) => x.id === id);
                if (!a) throw new Error(`${id} missing`);
                const seeded: ActiveDoTStack[] = (seeds[i] ?? []).map((s) => ({
                    stacks: s,
                    tier: 1,
                    remainingRounds: 9,
                    sourceId: 'seed',
                }));
                a.corrosionEntries.push(...seeded);
            });
        },
    });
    return m;
};

const crocus = (over: Partial<Cast> = {}): Cast => ({
    kit: kit('Crocus', ['active']),
    charged: false,
    ...over,
});

for (const side of [PLAYER, ENEMY]) {
    const [A, B, C] = side.struck;

    describe(`${side.tag}: Crocus — the cast's own Corrosion counts toward "3 or more debuffs"`, () => {
        it('aimed enemy at 2 debuffs + this Corrosion II → Stasis', () => {
            const m = measure(side, crocus(), [[2]]);
            expect(m.debuffs['Stasis']).toEqual([A]);
            expect(m.stasisControls).toEqual([A]);
        });
        it('the 2 debuffs as two 1-stack entries count the same → Stasis', () => {
            const m = measure(side, crocus(), [[1, 1]]);
            expect(m.debuffs['Stasis']).toEqual([A]);
        });
        it('negative: aimed enemy at 1 debuff + this Corrosion II = 2 → no Stasis', () => {
            const m = measure(side, crocus(), [[1]]);
            expect(m.debuffs['Stasis']).toBeUndefined();
            expect(m.stasisControls).toEqual([]);
        });
        it('the Corrosion resisted → stays at 2: the gate stays shut (no Stasis, no Stasis resist)', () => {
            const m = measure(side, crocus({ hacking: 0 }), [[2]]);
            // The Corrosion was cast and resisted on A …
            expect(Object.keys(m.resisted).some((n) => n.startsWith('Corrosion'))).toBe(true);
            // … so A stays at 2 and Stasis is never attempted: at hacking 0 an attempt would have
            // been resisted, so no Stasis resist proves the gate shut.
            expect(m.debuffs['Stasis']).toBeUndefined();
            expect(m.resisted['Stasis']).toBeUndefined();
        });
        it('on a Cone cast, each struck enemy on its own count: C at 2 → Stasis on C alone', () => {
            const m = measure(side, crocus({ pattern: CONE() }), [[], [1], [2]]);
            expect(m.debuffs['Stasis']).toEqual([C]);
            expect(m.stasisControls).toEqual([C]);
            expect(m.debuffs['Stasis']).not.toContain(A);
            expect(m.debuffs['Stasis']).not.toContain(B);
        });
    });

    describe(`${side.tag}: Asphyxiator — the named debuff and the Inferno written before both count`, () => {
        const asphyxiator = (): Cast => ({ kit: kit('Asphyxiator', ['charged']), charged: true });
        it('aimed enemy at 1 debuff + Inc. DoT Damage Up III + Inferno III = 3 → Stasis', () => {
            const m = measure(side, asphyxiator(), [[1]]);
            expect(m.debuffs['Inc. DoT Damage Up III']).toEqual([A]);
            expect(m.debuffs['Stasis']).toEqual([A]);
        });
        it('negative: aimed enemy at 0 debuffs → 2 → no Stasis', () => {
            const m = measure(side, asphyxiator(), [[]]);
            expect(m.debuffs['Inc. DoT Damage Up III']).toEqual([A]);
            expect(m.debuffs['Stasis']).toBeUndefined();
        });
    });

    describe(`${side.tag}: Anemone — her Corrosion III counts toward "3 or more damage over time effects"`, () => {
        const anemone = (): Cast => ({ kit: kit('Anemone', ['charged']), charged: true });
        it('aimed enemy at 2 DoT stacks + Corrosion III → Taunt', () => {
            const m = measure(side, anemone(), [[2]]);
            expect(m.buffs).toContain('Taunt');
            expect(m.tauntControls).toBe(1);
        });
        it('negative: aimed enemy at 1 DoT stack + Corrosion III = 2 → no Taunt', () => {
            const m = measure(side, anemone(), [[1]]);
            expect(m.buffs).not.toContain('Taunt');
            expect(m.tauntControls).toBe(0);
        });
        it('the Corrosion III resisted → stays at 2: no Taunt', () => {
            const m = measure(side, { ...anemone(), hacking: 0 }, [[2]]);
            expect(m.buffs).not.toContain('Taunt');
            expect(m.tauntControls).toBe(0);
        });
    });

    describe(`${side.tag}: Bayah (R15, unchanged) — her passive counts only debuffs from before the cast`, () => {
        const bayah = (): Cast => ({ kit: kit('Bayah', ['active', 'passive']), charged: false });
        it('aimed enemy at 0: her active lands 2 debuffs, yet no Speed Down II', () => {
            const m = measure(side, bayah(), [[]]);
            expect(m.debuffs['Attack Down II']).toEqual([A]);
            expect(m.debuffs['Crit Power Down II']).toEqual([A]);
            expect(m.debuffs['Speed Down II']).toBeUndefined();
        });
    });
}
