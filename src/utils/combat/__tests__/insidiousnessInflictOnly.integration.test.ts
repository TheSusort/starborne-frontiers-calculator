/**
 * Insidiousness ("When debuffing an enemy, there is a 21% chance to deal 100% damage." at
 * legendary) rolls ONLY on debuffs that are INFLICTED, never on ones that are APPLIED (user rule,
 * 2026-10-02) — the same apply-vs-inflict split the debuff-inflicted trigger family reads
 * (`Ability.triggerApplicationFilter`, `passesApplicationFilter` in triggers.ts). The verb is the
 * one the source's own text states:
 *  - a skill clause "applies Provoke / Concentrate Fire / Disable" → no roll;
 *  - "inflicts X" → rolls, under the per-cast rule pinned in
 *    insidiousnessPerCastRoll.integration.test.ts;
 *  - the Burner gear set's "Applies Inferno 1 for 2 turns." → no roll.
 *
 * Instrument: `scriptProcs` scripts the carrier's `${owner}:proc` sub-stream — the only proc
 * ability on these boards is Insidiousness (real legendary ability, 21%) — and COUNTS its draws,
 * so a roll that was never taken is visible, not just a hit that did not land. A draw of 0.99
 * fails the 21% roll and 0 passes it; every other keyed gate draws 0, so every rolled landing
 * succeeds and nothing crits (crit 0). Every negative below sits next to a positive on the same
 * board, so the instrument is shown to see a roll when there is one.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { runCombat, CombatEngineInput } from '../engine';
import { createEventBus, CombatEvent } from '../events';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import { buildShipAbilities } from '../../abilities/buildShipAbilities';
import { setupKeyedRng, setKeyedRng } from '../../calculators/rateAccumulator';
import type { Ability, ShipSkills } from '../../../types/abilities';
import type { GearPiece } from '../../../types/gear';
import type { Ship } from '../../../types/ship';
import type { ParsedTarget, ParsedPattern } from '../../targetingParser';

type EnemyAttacker = NonNullable<CombatEngineInput['enemyAttackers']>[number];

const FAIL = 0.99;
const PASS = 0;

/** Scripts `owner`'s proc sub-stream with `draws` (then FAIL), every other keyed gate draws 0. */
function scriptProcs(owner: string, draws: number[]): () => number {
    const queue = [...draws];
    let taken = 0;
    setKeyedRng((key) => {
        if (key !== `${owner}:proc`) return 0;
        taken++;
        return queue.shift() ?? FAIL;
    });
    return () => taken;
}

/** The real equipment abilities: legendary Insidiousness, plus 4-piece Burner when asked. */
const equipment = (burner = false): Ability[] => {
    const pieces: Record<string, GearPiece> = {
        insid: { id: 'insid', rarity: 'legendary', setBonus: 'INSIDIOUSNESS' } as GearPiece,
    };
    const gear: Record<string, string> = {};
    if (burner) {
        (['weapon', 'hull', 'generator', 'sensor'] as const).forEach((slot, i) => {
            const id = `burn-${i}`;
            gear[slot] = id;
            pieces[id] = { id, slot, rarity: 'legendary', setBonus: 'BURNER' } as GearPiece;
        });
    }
    const built = buildEquipmentAbilities(
        { implants: { implant_major: 'insid' }, equipment: gear } as unknown as Ship,
        (id) => pieces[id]
    );
    if (!built.some((a) => a.trigger === 'on-debuff-inflicted'))
        throw new Error('Insidiousness ability missing');
    if (burner && !built.some((a) => a.config.type === 'dot'))
        throw new Error('Burner ability missing');
    return built;
};
const insidiousness = (): Ability => {
    const a = equipment().find((x) => x.trigger === 'on-debuff-inflicted');
    if (!a) throw new Error('Insidiousness ability missing');
    return a;
};

const castDebuff = (buffName: string, application: 'inflict' | 'apply'): Ability => ({
    id: `cast-${buffName}`,
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: {
        type: 'debuff',
        buffName,
        parsedEffects: {},
        stacks: 1,
        isStackable: false,
        application,
        duration: 2,
    },
});
const hit = (): Ability => ({
    id: 'plain-hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100, hits: 1 },
});

const frontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

/** An enemy that never acts against anyone. */
const inert = (id: string, security = 0): EnemyAttacker => ({
    id,
    stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: 1e12, speed: 1, security },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
});

/** An enemy-side carrier with `skills` that acts first and targets the player. */
const enemyCarrier = (skills: ShipSkills, charged = false): EnemyAttacker => ({
    id: 'carrier',
    stats: { attack: 100, crit: 0, critDamage: 0, defence: 0, hp: 1e12, speed: 200, hacking: 200 },
    chargeCount: charged ? 2 : 0,
    startCharged: charged,
    position: 'M4',
    target: frontTarget(),
    pattern: basePattern(),
    shipSkills: skills,
});

const BASE = (over: Partial<CombatEngineInput> = {}): CombatEngineInput => ({
    enemyAttackers: [inert('foe')],
    attack: 100,
    crit: 0,
    critDamage: 0,
    defensePenetration: 0,
    chargeCount: 0,
    shipSkills: { slots: [{ slot: 'active', abilities: [] }] },
    numRounds: 1,
    selfBuffs: [],
    enemyDebuffs: [],
    hasChargedSkill: false,
    startCharged: false,
    affinityDamageModifier: 0,
    affinityCritCap: 100,
    affinityCritPenalty: 0,
    defence: 0,
    hp: 1e12,
    hacking: 200,
    speed: 100,
    healTargetId: 'attacker',
    mode: 'healing',
    position: 'M4',
    target: frontTarget(),
    pattern: basePattern(),
    ...over,
});
/** The player is an inert target for an enemy carrier (`security` decides its resists). */
const enemyBoard = (carrier: EnemyAttacker, security = 0) =>
    BASE({ attack: 0, speed: 1, security, enemyAttackers: [carrier] });

const run = (input: CombatEngineInput) => {
    const bus = createEventBus();
    const events: CombatEvent[] = [];
    for (const type of ['debuff-applied', 'dot-applied', 'reactive-damage-performed'] as const)
        bus.on(type, (e) => events.push(e as CombatEvent));
    runCombat({ ...input, bus });
    return events;
};

/** Insidiousness hits `sourceId` dealt `targetId` (the only reactive damage on these boards). */
const procHits = (events: CombatEvent[], sourceId: string, targetId: string) =>
    events.filter(
        (e) =>
            e.type === 'reactive-damage-performed' &&
            e.sourceId === sourceId &&
            e.targetId === targetId
    ).length;
const debuffLandings = (events: CombatEvent[], sourceId: string, buffName: string) =>
    events.filter(
        (e) => e.type === 'debuff-applied' && e.sourceId === sourceId && e.buffName === buffName
    );
const infernoLandings = (events: CombatEvent[], sourceId: string) =>
    events.filter(
        (e) => e.type === 'dot-applied' && e.sourceId === sourceId && e.dotType === 'inferno'
    );

beforeEach(() => {
    setupKeyedRng(5);
});

describe('Insidiousness — the implant reacts to inflicted debuffs only', () => {
    it('legendary: on-debuff-inflicted with the inflict filter', () => {
        expect(insidiousness()).toMatchObject({
            type: 'damage',
            trigger: 'on-debuff-inflicted',
            triggerApplicationFilter: 'inflict',
            procChance: 0.21,
            procScope: 'per-debuff',
        });
    });

    it('Burner carries the verb its text states: its Inferno is applied', () => {
        const burner = equipment(true).find((a) => a.config.type === 'dot');
        expect(burner?.config).toMatchObject({
            type: 'dot',
            dotType: 'inferno',
            application: 'apply',
        });
    });
});

// ---------------------------------------------------------------------------------------------
// (1)/(2): a cast that only APPLIES a debuff never rolls; the same cast INFLICTING it rolls once.
// ---------------------------------------------------------------------------------------------
describe('Insidiousness — a cast that only applies a debuff does not roll', () => {
    const kit = (application: 'inflict' | 'apply'): ShipSkills => ({
        slots: [
            { slot: 'active', abilities: [hit(), castDebuff('Provoke', application)] },
            { slot: 'passive', abilities: [insidiousness()] },
        ],
    });

    it('player side: applied Provoke lands, no roll; inflicted, one roll and one hit', () => {
        let draws = scriptProcs('attacker', [PASS]);
        let events = run(BASE({ shipSkills: kit('apply') }));
        expect(debuffLandings(events, 'attacker', 'Provoke')).toHaveLength(1);
        expect(draws()).toBe(0);
        expect(procHits(events, 'attacker', 'foe')).toBe(0);

        draws = scriptProcs('attacker', [PASS]);
        events = run(BASE({ shipSkills: kit('inflict') }));
        expect(debuffLandings(events, 'attacker', 'Provoke')).toHaveLength(1);
        expect(draws()).toBe(1);
        expect(procHits(events, 'attacker', 'foe')).toBe(1);
    });

    it('enemy side: the same — applied, no roll; inflicted, one roll and one hit', () => {
        let draws = scriptProcs('carrier', [PASS]);
        let events = run(enemyBoard(enemyCarrier(kit('apply'))));
        expect(debuffLandings(events, 'carrier', 'Provoke')).toHaveLength(1);
        expect(draws()).toBe(0);
        expect(procHits(events, 'carrier', 'attacker')).toBe(0);

        draws = scriptProcs('carrier', [PASS]);
        events = run(enemyBoard(enemyCarrier(kit('inflict'))));
        expect(debuffLandings(events, 'carrier', 'Provoke')).toHaveLength(1);
        expect(draws()).toBe(1);
        expect(procHits(events, 'carrier', 'attacker')).toBe(1);
    });
});

// ---------------------------------------------------------------------------------------------
// (5) Warden, verbatim in BOTH corpora: her active "applies Provoke" (no roll); her charged
// "inflicts Corrosion II" and her R2 passive "inflicts Out. Damage Down II" (a roll each).
// ---------------------------------------------------------------------------------------------
const WARDEN_ACTIVE =
    'This Unit deals <unit-damage>165% damage</unit-damage> and applies <unit-skill>Provoke</unit-skill> for 1 turn.';
const WARDEN_CHARGED =
    'This Unit deals <unit-damage>200% damage</unit-damage> and inflicts <unit-skill>Corrosion II</unit-skill> for 3 turns.';
const WARDEN_PASSIVE_R2 = {
    old: 'When directly damaged, this Unit inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns on that enemy and repairs itself 3% of its Max HP.<br /><br />Additionally, when this Unit inflicts a Debuff, it inflicts <unit-skill>Out. Damage Down II</unit-skill> for 1 turn.',
    catalogue:
        'When directly damaged, this Unit inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns to the enemy and this Unit <unit-damage>repairs 3%</unit-damage> of its max HP.<br /><br />When this Unit inflicts a <unit-aid>debuff</unit-aid>, it also inflicts <unit-skill>Out. Damage Down II</unit-skill> for 1 turn.',
};
const OUT_DD = 'Out. Damage Down II';

const wardenSkills = (corpus: 'old' | 'catalogue', extra: Ability[]): ShipSkills => {
    const built = buildShipAbilities({
        refits: [{}, {}],
        activeSkillText: WARDEN_ACTIVE,
        chargeSkillText: WARDEN_CHARGED,
        chargeSkillCharge: 2,
        secondPassiveSkillText: WARDEN_PASSIVE_R2[corpus],
    } as unknown as Ship);
    return {
        slots: built.slots.map((s) =>
            s.slot === 'passive' ? { ...s, abilities: [...s.abilities, ...extra] } : s
        ),
    };
};

describe.each(['old', 'catalogue'] as const)(
    'Insidiousness — real Warden kit (%s text)',
    (corpus) => {
        /** Round 1 only: `charged` opens with her charged skill, otherwise her active. */
        const board = (charged: boolean, extra = [insidiousness()]) =>
            BASE({
                shipSkills: wardenSkills(corpus, extra),
                chargeCount: 2,
                hasChargedSkill: true,
                startCharged: charged,
            });

        it('player side: her active applies Provoke → no roll; her charged → two rolls', () => {
            let draws = scriptProcs('attacker', [PASS]);
            let events = run(board(false));
            expect(debuffLandings(events, 'attacker', 'Provoke')).toHaveLength(1);
            expect(draws()).toBe(0);
            expect(procHits(events, 'attacker', 'foe')).toBe(0);

            draws = scriptProcs('attacker', [FAIL, PASS]);
            events = run(board(true));
            expect(debuffLandings(events, 'attacker', OUT_DD)).toHaveLength(1);
            expect(draws()).toBe(2);
            expect(procHits(events, 'attacker', 'foe')).toBe(1);
        });

        it('enemy side: an enemy Warden — the same', () => {
            let draws = scriptProcs('carrier', [PASS]);
            let events = run(enemyBoard(enemyCarrier(wardenSkills(corpus, [insidiousness()]))));
            expect(debuffLandings(events, 'carrier', 'Provoke')).toHaveLength(1);
            expect(draws()).toBe(0);
            expect(procHits(events, 'carrier', 'attacker')).toBe(0);

            draws = scriptProcs('carrier', [FAIL, PASS]);
            events = run(enemyBoard(enemyCarrier(wardenSkills(corpus, [insidiousness()]), true)));
            expect(debuffLandings(events, 'carrier', OUT_DD)).toHaveLength(1);
            expect(draws()).toBe(2);
            expect(procHits(events, 'carrier', 'attacker')).toBe(1);
        });

        // #593's rule read on Burner: her clause "when this Unit inflicts a Debuff" does not see
        // Burner's APPLIED Inferno, so the active (applied Provoke + applied Inferno) sets off no
        // Out. Damage Down II, while the charged's inflicted Corrosion II still does.
        it('Burner’s applied Inferno does not set off her "inflicts a Debuff" reaction', () => {
            scriptProcs('attacker', []);
            let events = run(board(false, equipment(true)));
            expect(infernoLandings(events, 'attacker')).toHaveLength(1);
            expect(debuffLandings(events, 'attacker', OUT_DD)).toHaveLength(0);

            events = run(board(true, equipment(true)));
            expect(infernoLandings(events, 'attacker')).toHaveLength(1);
            expect(debuffLandings(events, 'attacker', OUT_DD)).toHaveLength(1);

            events = run(enemyBoard(enemyCarrier(wardenSkills(corpus, equipment(true)))));
            expect(infernoLandings(events, 'carrier')).toHaveLength(1);
            expect(debuffLandings(events, 'carrier', OUT_DD)).toHaveLength(0);
        });
    }
);

// ---------------------------------------------------------------------------------------------
// (3) A cast that applies one debuff and inflicts another rolls for the inflicted one only —
// Yuyan's active, identical in both corpora: "applies Concentrate Fire … and inflicts Defense
// Down II". With the Defense Down II resisted, the applied Concentrate Fire alone lands: no roll.
// ---------------------------------------------------------------------------------------------
describe('Insidiousness — Yuyan’s active: only the inflicted Defense Down II rolls', () => {
    const YUYAN_ACTIVE =
        'This Unit deals <unit-damage>170% damage</unit-damage>, applies <unit-skill>Concentrate Fire</unit-skill> for 1 turn, and inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns.';
    const yuyanSkills = (): ShipSkills => {
        const built = buildShipAbilities({
            refits: [],
            activeSkillText: YUYAN_ACTIVE,
        } as unknown as Ship);
        const active = built.slots.find((s) => s.slot === 'active');
        if (!active) throw new Error('Yuyan active missing');
        return { slots: [active, { slot: 'passive', abilities: [insidiousness()] }] };
    };

    it('player side: both land → one roll; Defense Down II resisted → no roll', () => {
        let draws = scriptProcs('attacker', [PASS]);
        let events = run(BASE({ shipSkills: yuyanSkills() }));
        expect(debuffLandings(events, 'attacker', 'Concentrate Fire')).toHaveLength(1);
        expect(debuffLandings(events, 'attacker', 'Defense Down II')).toHaveLength(1);
        expect(draws()).toBe(1);
        expect(procHits(events, 'attacker', 'foe')).toBe(1);

        draws = scriptProcs('attacker', [PASS]);
        events = run(BASE({ shipSkills: yuyanSkills(), enemyAttackers: [inert('foe', 1e9)] }));
        expect(debuffLandings(events, 'attacker', 'Concentrate Fire')).toHaveLength(1);
        expect(debuffLandings(events, 'attacker', 'Defense Down II')).toHaveLength(0);
        expect(draws()).toBe(0);
        expect(procHits(events, 'attacker', 'foe')).toBe(0);
    });

    it('enemy side: the same', () => {
        let draws = scriptProcs('carrier', [PASS]);
        let events = run(enemyBoard(enemyCarrier(yuyanSkills())));
        expect(debuffLandings(events, 'carrier', 'Concentrate Fire')).toHaveLength(1);
        expect(debuffLandings(events, 'carrier', 'Defense Down II')).toHaveLength(1);
        expect(draws()).toBe(1);
        expect(procHits(events, 'carrier', 'attacker')).toBe(1);

        draws = scriptProcs('carrier', [PASS]);
        events = run(enemyBoard(enemyCarrier(yuyanSkills()), 1e9));
        expect(debuffLandings(events, 'carrier', 'Concentrate Fire')).toHaveLength(1);
        expect(debuffLandings(events, 'carrier', 'Defense Down II')).toHaveLength(0);
        expect(draws()).toBe(0);
        expect(procHits(events, 'carrier', 'attacker')).toBe(0);
    });
});

// ---------------------------------------------------------------------------------------------
// (4) 4-piece Burner: its applied Inferno adds no roll to a cast.
// ---------------------------------------------------------------------------------------------
describe('Insidiousness — Burner’s applied Inferno adds no roll', () => {
    const kit = (application: 'inflict' | 'apply'): ShipSkills => ({
        slots: [
            { slot: 'active', abilities: [hit(), castDebuff('Seed Down', application)] },
            { slot: 'passive', abilities: equipment(true) },
        ],
    });

    it('premise: Burner lands its Inferno, stamped as applied, alongside the cast’s debuff', () => {
        scriptProcs('attacker', []);
        const events = run(BASE({ shipSkills: kit('inflict') }));
        expect(debuffLandings(events, 'attacker', 'Seed Down')).toHaveLength(1);
        const infernos = infernoLandings(events, 'attacker');
        expect(infernos).toHaveLength(1);
        expect(infernos[0]).toMatchObject({ application: 'apply', reactive: true });
    });

    it('player side, inflicting active: one roll — failing it means no hit', () => {
        let draws = scriptProcs('attacker', [FAIL, PASS]);
        let events = run(BASE({ shipSkills: kit('inflict') }));
        expect(infernoLandings(events, 'attacker')).toHaveLength(1);
        expect(draws()).toBe(1);
        expect(procHits(events, 'attacker', 'foe')).toBe(0);

        draws = scriptProcs('attacker', [PASS]);
        events = run(BASE({ shipSkills: kit('inflict') }));
        expect(draws()).toBe(1);
        expect(procHits(events, 'attacker', 'foe')).toBe(1);
    });

    it('player side, applying active: Burner and the cast both apply → no roll', () => {
        const draws = scriptProcs('attacker', [PASS, PASS]);
        const events = run(BASE({ shipSkills: kit('apply') }));
        expect(debuffLandings(events, 'attacker', 'Seed Down')).toHaveLength(1);
        expect(infernoLandings(events, 'attacker')).toHaveLength(1);
        expect(draws()).toBe(0);
        expect(procHits(events, 'attacker', 'foe')).toBe(0);
    });

    it('enemy side: the same — one roll for the inflicting cast, none for the applying one', () => {
        let draws = scriptProcs('carrier', [FAIL, PASS]);
        let events = run(enemyBoard(enemyCarrier(kit('inflict'))));
        expect(infernoLandings(events, 'carrier')).toHaveLength(1);
        expect(draws()).toBe(1);
        expect(procHits(events, 'carrier', 'attacker')).toBe(0);

        draws = scriptProcs('carrier', [PASS]);
        events = run(enemyBoard(enemyCarrier(kit('inflict'))));
        expect(draws()).toBe(1);
        expect(procHits(events, 'carrier', 'attacker')).toBe(1);

        draws = scriptProcs('carrier', [PASS, PASS]);
        events = run(enemyBoard(enemyCarrier(kit('apply'))));
        expect(infernoLandings(events, 'carrier')).toHaveLength(1);
        expect(draws()).toBe(0);
        expect(procHits(events, 'carrier', 'attacker')).toBe(0);
    });
});
