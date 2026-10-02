/**
 * Insidiousness ("When debuffing an enemy, there is a 21% chance to deal 100% damage." at
 * legendary) rolls per SKILL CAST (user + Solid Clouds dev, 2026-10-02):
 *  - ONE roll for everything the cast inflicts itself, however many debuffs and however many hits;
 *  - ONE extra roll for each reaction firing that inflicts during that cast (Warden's passive
 *    Out. Damage Down II off her charged Corrosion II; Ripper's catalogue Inferno II);
 *  - at most ONE successful roll per cast.
 * A reaction that inflicts OUTSIDE the carrier's cast (here: Warden's Corrosion I when an enemy
 * hits her, and the Out. Damage Down II it sets off) gets its own roll and its own cap — the
 * unconfirmed default (see `perCastProcKeys` in triggers.ts).
 *
 * Instrument: `scriptProcs` scripts the carrier's `${owner}:proc` sub-stream — the only proc
 * ability on these boards is Insidiousness (real legendary ability, 21%) — and COUNTS its draws,
 * so a roll that was never taken is visible, not just a hit that did not land. A draw of 0.99
 * fails the 21% roll and 0 passes it; every other keyed gate draws 0, so every debuff lands and
 * nothing crits (crit 0).
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
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import type { Position } from '../../../types/encounters';

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

/** The real legendary Insidiousness ability (21%, 100%). */
const insidiousness = (): Ability => {
    const pieceId = 'insid-piece';
    const piece = { id: pieceId, rarity: 'legendary', setBonus: 'INSIDIOUSNESS' };
    const built = buildEquipmentAbilities(
        { implants: { implant_major: pieceId }, equipment: {} } as unknown as Ship,
        (g) => (g === pieceId ? (piece as unknown as GearPiece) : undefined)
    );
    const a = built.find((x) => x.trigger === 'on-debuff-inflicted');
    if (!a) throw new Error('Insidiousness ability missing');
    return a;
};

const debuffConfig = (buffName: string) => ({
    type: 'debuff' as const,
    buffName,
    parsedEffects: {},
    stacks: 1,
    isStackable: false,
    application: 'inflict' as const,
    duration: 2,
});
const castDebuff = (buffName: string): Ability => ({
    id: `cast-${buffName}`,
    type: 'debuff',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: debuffConfig(buffName),
});
const hit = (hits = 1): Ability => ({
    id: 'plain-hit',
    type: 'damage',
    target: 'enemy',
    trigger: 'on-cast',
    conditions: [],
    config: { type: 'damage', multiplier: 100, hits },
});

const frontTarget = (): ParsedTarget => ({ raw: 'front', side: 'enemy', selection: 'front' });
const basePattern = (): ParsedPattern => ({ raw: 'base', shape: 'base', range: 0, modifiers: {} });

/** An enemy whose active is `active` (none by default: it never debuffs or hits anyone). */
const inert = (id: string, security = 0, active: Ability[] = []): EnemyAttacker => ({
    id,
    stats: { attack: 1000, crit: 0, critDamage: 0, defence: 0, hp: 1e12, speed: 1, security },
    chargeCount: 0,
    startCharged: false,
    position: 'M4',
    shipSkills: { slots: [{ slot: 'active', abilities: active }] },
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
    selfDotModifier: 0,
    defensePenetrationBuff: 0,
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
    );
const debuffLandings = (events: CombatEvent[], sourceId: string, buffName: string) =>
    events.filter(
        (e) => e.type === 'debuff-applied' && e.sourceId === sourceId && e.buffName === buffName
    ).length;

beforeEach(() => {
    setupKeyedRng(5);
});

describe('Insidiousness — the implant declares the per-cast roll', () => {
    it('legendary: reactive damage on on-debuff-inflicted, 21%, 100%, procScope per-cast', () => {
        expect(insidiousness()).toMatchObject({
            type: 'damage',
            trigger: 'on-debuff-inflicted',
            procChance: 0.21,
            procScope: 'per-cast',
            config: { type: 'damage', multiplier: 100, hits: 1 },
        });
    });
});

// ---------------------------------------------------------------------------------------------
// Warden's charged (OLD text, verbatim from docs/ship-skills.csv): her Corrosion II sets off her
// R2 passive's Out. Damage Down II — the dev's own example. Two rolls, at most one hit.
// ---------------------------------------------------------------------------------------------
const WARDEN_ACTIVE =
    'This Unit deals <unit-damage>165% damage</unit-damage> and applies <unit-skill>Provoke</unit-skill> for 1 turn.';
const WARDEN_CHARGED =
    'This Unit deals <unit-damage>200% damage</unit-damage> and inflicts <unit-skill>Corrosion II</unit-skill> for 3 turns.';
const WARDEN_PASSIVE_R2 =
    'When directly damaged, this Unit inflicts <unit-skill>Corrosion I</unit-skill> for 2 turns on that enemy and repairs itself 3% of its Max HP.<br /><br />Additionally, when this Unit inflicts a Debuff, it inflicts <unit-skill>Out. Damage Down II</unit-skill> for 1 turn.';
const OUT_DD = 'Out. Damage Down II';

/** Warden's parsed kit plus Insidiousness; `withReaction: false` strips her on-debuff-inflicted
 *  reaction (the control for "the second roll comes from the reaction"). */
const wardenSkills = (withReaction = true): ShipSkills => {
    const built = buildShipAbilities({
        refits: [{}, {}],
        activeSkillText: WARDEN_ACTIVE,
        chargeSkillText: WARDEN_CHARGED,
        chargeSkillCharge: 2,
        secondPassiveSkillText: WARDEN_PASSIVE_R2,
    } as unknown as Ship);
    return {
        slots: built.slots.map((s) =>
            s.slot === 'passive'
                ? {
                      ...s,
                      abilities: [
                          ...s.abilities.filter(
                              (a) => withReaction || a.trigger !== 'on-debuff-inflicted'
                          ),
                          insidiousness(),
                      ],
                  }
                : s
        ),
    };
};

describe('Insidiousness — Warden’s charged: one roll for the cast, one for her reaction', () => {
    /** Round 1: she opens with her charged skill on the inert foe. */
    const board = (withReaction = true) =>
        BASE({
            shipSkills: wardenSkills(withReaction),
            chargeCount: 2,
            hasChargedSkill: true,
            startCharged: true,
        });

    it('premise: the charged lands Corrosion II, which sets off Out. Damage Down II', () => {
        scriptProcs('attacker', []);
        const events = run(board());
        expect(
            events.filter(
                (e) => e.type === 'dot-applied' && e.sourceId === 'attacker' && !e.reactive
            )
        ).toHaveLength(1);
        expect(debuffLandings(events, 'attacker', OUT_DD)).toBe(1);
    });

    it('cast roll fails, reaction roll passes → exactly one hit, two rolls', () => {
        const draws = scriptProcs('attacker', [FAIL, PASS]);
        const events = run(board());
        expect(procHits(events, 'attacker', 'foe')).toHaveLength(1);
        expect(draws()).toBe(2);
    });

    it('both rolls would pass → still one hit; the cap stops the second draw', () => {
        const draws = scriptProcs('attacker', [PASS, PASS]);
        const events = run(board());
        expect(procHits(events, 'attacker', 'foe')).toHaveLength(1);
        expect(draws()).toBe(1);
    });

    it('both rolls fail → no hit, two rolls', () => {
        const draws = scriptProcs('attacker', [FAIL, FAIL]);
        const events = run(board());
        expect(procHits(events, 'attacker', 'foe')).toHaveLength(0);
        expect(draws()).toBe(2);
    });

    it('control: without her reaction the cast gets its one roll only', () => {
        const draws = scriptProcs('attacker', [FAIL, PASS]);
        const events = run(board(false));
        expect(debuffLandings(events, 'attacker', OUT_DD)).toBe(0);
        expect(procHits(events, 'attacker', 'foe')).toHaveLength(0);
        expect(draws()).toBe(1);
    });

    it('enemy side: an enemy Warden’s charged on the player gets the same two rolls, one hit', () => {
        const enemyWarden = (withReaction = true): EnemyAttacker => ({
            id: 'warden-enemy',
            stats: {
                attack: 100,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1e12,
                speed: 200,
                hacking: 200,
            },
            chargeCount: 2,
            startCharged: true,
            position: 'M4',
            target: frontTarget(),
            pattern: basePattern(),
            shipSkills: wardenSkills(withReaction),
        });
        const enemyBoard = (withReaction = true) =>
            BASE({
                attack: 0,
                speed: 1,
                security: 0,
                enemyAttackers: [enemyWarden(withReaction)],
            });

        let draws = scriptProcs('warden-enemy', [FAIL, PASS]);
        let events = run(enemyBoard());
        expect(debuffLandings(events, 'warden-enemy', OUT_DD)).toBe(1);
        expect(procHits(events, 'warden-enemy', 'attacker')).toHaveLength(1);
        expect(draws()).toBe(2);

        draws = scriptProcs('warden-enemy', [PASS, PASS]);
        events = run(enemyBoard());
        expect(procHits(events, 'warden-enemy', 'attacker')).toHaveLength(1);
        expect(draws()).toBe(1);

        draws = scriptProcs('warden-enemy', [FAIL, PASS]);
        events = run(enemyBoard(false));
        expect(procHits(events, 'warden-enemy', 'attacker')).toHaveLength(0);
        expect(draws()).toBe(1);
    });
});

// ---------------------------------------------------------------------------------------------
// The cast's own inflictions: one roll however many hits or debuffs; no landing, no roll.
// ---------------------------------------------------------------------------------------------
describe('Insidiousness — the cast’s own inflictions share one roll', () => {
    const kit = (active: Ability[]): ShipSkills => ({
        slots: [
            { slot: 'active', abilities: active },
            { slot: 'passive', abilities: [insidiousness()] },
        ],
    });

    it('a 2-hit cast that debuffs on each hit rolls once', () => {
        const draws = scriptProcs('attacker', [FAIL, PASS]);
        const events = run(BASE({ shipSkills: kit([hit(2), castDebuff('Seed Down')]) }));
        // Premise: the debuff landed on each of the two hits.
        expect(debuffLandings(events, 'attacker', 'Seed Down')).toBe(2);
        expect(draws()).toBe(1);
        expect(procHits(events, 'attacker', 'foe')).toHaveLength(0);
    });

    it('a 2-hit cast whose one roll passes hits the enemy once', () => {
        const draws = scriptProcs('attacker', [PASS, PASS]);
        const events = run(BASE({ shipSkills: kit([hit(2), castDebuff('Seed Down')]) }));
        expect(debuffLandings(events, 'attacker', 'Seed Down')).toBe(2);
        expect(draws()).toBe(1);
        expect(procHits(events, 'attacker', 'foe')).toHaveLength(1);
    });

    it('a cast landing three debuffs rolls once', () => {
        const active = [
            hit(),
            castDebuff('Seed Down'),
            castDebuff('Root Down'),
            castDebuff('Leaf Down'),
        ];
        let draws = scriptProcs('attacker', [FAIL, PASS, PASS]);
        let events = run(BASE({ shipSkills: kit(active) }));
        expect(
            ['Seed Down', 'Root Down', 'Leaf Down'].map((n) =>
                debuffLandings(events, 'attacker', n)
            )
        ).toEqual([1, 1, 1]);
        expect(draws()).toBe(1);
        expect(procHits(events, 'attacker', 'foe')).toHaveLength(0);

        draws = scriptProcs('attacker', [PASS, PASS, PASS]);
        events = run(BASE({ shipSkills: kit(active) }));
        expect(draws()).toBe(1);
        expect(procHits(events, 'attacker', 'foe')).toHaveLength(1);
    });

    it('a cast landing nothing does not roll; the same cast landing its debuff does', () => {
        const active = [hit(), castDebuff('Seed Down')];
        // The foe's security dwarfs the carrier's hacking: the debuff is resisted.
        let draws = scriptProcs('attacker', [PASS]);
        let events = run(BASE({ shipSkills: kit(active), enemyAttackers: [inert('foe', 1e9)] }));
        expect(debuffLandings(events, 'attacker', 'Seed Down')).toBe(0);
        expect(draws()).toBe(0);
        expect(procHits(events, 'attacker', 'foe')).toHaveLength(0);

        draws = scriptProcs('attacker', [PASS]);
        events = run(BASE({ shipSkills: kit(active) }));
        expect(debuffLandings(events, 'attacker', 'Seed Down')).toBe(1);
        expect(draws()).toBe(1);
        expect(procHits(events, 'attacker', 'foe')).toHaveLength(1);
    });

    it('enemy side: an enemy carrier’s 2-hit debuffing cast rolls once', () => {
        const carrier: EnemyAttacker = {
            id: 'carrier',
            stats: {
                attack: 100,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1e12,
                speed: 200,
                hacking: 200,
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M4',
            target: frontTarget(),
            pattern: basePattern(),
            shipSkills: kit([hit(2), castDebuff('Seed Down')]),
        };
        const draws = scriptProcs('carrier', [FAIL, PASS]);
        const events = run(BASE({ attack: 0, speed: 1, security: 0, enemyAttackers: [carrier] }));
        expect(debuffLandings(events, 'carrier', 'Seed Down')).toBe(2);
        expect(draws()).toBe(1);
        expect(procHits(events, 'carrier', 'attacker')).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------------------------
// Ripper (catalogue R0, verbatim from docs/ship-skills.catalogue.csv): his active's Inc. Repair
// Down II sets off his reactive Inferno II — a second roll on that cast (the DoT arm).
// ---------------------------------------------------------------------------------------------
describe('Insidiousness — Ripper’s catalogue reactive Inferno II is a second roll', () => {
    const RIPPER_ACTIVE =
        'This Unit deals <unit-damage>165% damage</unit-damage> and inflicts <unit-skill>Inc. Repair Down II</unit-skill> for 1 turn.';
    const RIPPER_PASSIVE_R0 =
        'When this Unit inflicts a <unit-aid>debuff</unit-aid> with its active or charged skills, it also inflicts <unit-skill>Inferno II</unit-skill> for 2 turns.';
    const ripperSkills = (withInferno = true): ShipSkills => {
        const built = buildShipAbilities({
            refits: [],
            activeSkillText: RIPPER_ACTIVE,
            firstPassiveSkillText: RIPPER_PASSIVE_R0,
        } as unknown as Ship);
        const active = built.slots.find((s) => s.slot === 'active');
        const passive = built.slots.find((s) => s.slot === 'passive');
        if (!active || !passive) throw new Error('Ripper slots missing');
        const own = passive.abilities.filter((a) => withInferno || a.config.type !== 'dot');
        return { slots: [active, { slot: 'passive', abilities: [...own, insidiousness()] }] };
    };
    const infernos = (events: CombatEvent[], sourceId: string) =>
        events.filter(
            (e) => e.type === 'dot-applied' && e.sourceId === sourceId && e.dotType === 'inferno'
        ).length;

    it('player side: cast roll fails, Inferno roll passes → one hit; without the reaction, none', () => {
        let draws = scriptProcs('attacker', [FAIL, PASS]);
        let events = run(BASE({ shipSkills: ripperSkills() }));
        expect(infernos(events, 'attacker')).toBe(1);
        expect(procHits(events, 'attacker', 'foe')).toHaveLength(1);
        expect(draws()).toBe(2);

        draws = scriptProcs('attacker', [FAIL, PASS]);
        events = run(BASE({ shipSkills: ripperSkills(false) }));
        expect(infernos(events, 'attacker')).toBe(0);
        expect(procHits(events, 'attacker', 'foe')).toHaveLength(0);
        expect(draws()).toBe(1);
    });

    it('enemy side: an enemy Ripper gets the same second roll', () => {
        const enemyRipper = (withInferno = true): EnemyAttacker => ({
            id: 'ripper-enemy',
            stats: {
                attack: 100,
                crit: 0,
                critDamage: 0,
                defence: 0,
                hp: 1e12,
                speed: 200,
                hacking: 200,
            },
            chargeCount: 0,
            startCharged: false,
            position: 'M4',
            shipSkills: ripperSkills(withInferno),
        });
        const enemyBoard = (withInferno = true) =>
            BASE({ attack: 0, speed: 1, security: 0, enemyAttackers: [enemyRipper(withInferno)] });

        let draws = scriptProcs('ripper-enemy', [FAIL, PASS]);
        let events = run(enemyBoard());
        expect(infernos(events, 'ripper-enemy')).toBe(1);
        expect(procHits(events, 'ripper-enemy', 'attacker')).toHaveLength(1);
        expect(draws()).toBe(2);

        draws = scriptProcs('ripper-enemy', [FAIL, PASS]);
        events = run(enemyBoard(false));
        expect(procHits(events, 'ripper-enemy', 'attacker')).toHaveLength(0);
        expect(draws()).toBe(1);
    });
});

// ---------------------------------------------------------------------------------------------
// Outside the carrier's cast (UNCONFIRMED default): each reaction firing that inflicts is its own
// roll with its own cap. An enemy hits Warden: her Corrosion I on it (on-attacked) and the Out.
// Damage Down II that sets off are two firings during the ENEMY's turn → up to two hits.
// ---------------------------------------------------------------------------------------------
describe('Insidiousness — reactions outside the carrier’s cast (unconfirmed default)', () => {
    /** Hits during `turnOf`'s turn. */
    const hitsDuring = (events: CombatEvent[], sourceId: string, turnOf: string) =>
        events.filter(
            (e) =>
                e.type === 'reactive-damage-performed' &&
                e.sourceId === sourceId &&
                e.duringTurnOf === turnOf
        ).length;

    it('player Warden hit by an enemy: Corrosion I and its Out. Damage Down II roll and hit separately', () => {
        // Her own turn (Provoke, an applied debuff Insidiousness also counts) takes the first draw.
        const draws = scriptProcs('attacker', [FAIL, PASS, PASS]);
        const events = run(
            BASE({ shipSkills: wardenSkills(), enemyAttackers: [inert('hitter', 0, [hit()])] })
        );
        expect(debuffLandings(events, 'attacker', OUT_DD)).toBe(1);
        expect(hitsDuring(events, 'attacker', 'attacker')).toBe(0);
        expect(hitsDuring(events, 'attacker', 'hitter')).toBe(2);
        expect(draws()).toBe(3);
    });

    it('control: the same board with her reaction stripped hits once in the enemy’s turn', () => {
        const draws = scriptProcs('attacker', [FAIL, PASS, PASS]);
        const events = run(
            BASE({ shipSkills: wardenSkills(false), enemyAttackers: [inert('hitter', 0, [hit()])] })
        );
        expect(hitsDuring(events, 'attacker', 'hitter')).toBe(1);
        expect(draws()).toBe(2);
    });
});

// ---------------------------------------------------------------------------------------------
// One reaction firing is one roll, however many enemies it lands on: an on-crit "inflict X on
// that enemy" reaction to an AoE that crits both enemies lands X on each, from ONE firing.
// ---------------------------------------------------------------------------------------------
describe('Insidiousness — one reaction firing landing on two enemies is one roll', () => {
    const allPattern = (): ParsedPattern => ({
        raw: 'all',
        shape: 'all',
        range: 'all',
        modifiers: {},
    });
    const critReaction = (): Ability => ({
        id: 'crit-reaction',
        type: 'debuff',
        target: 'enemy',
        trigger: 'on-crit',
        conditions: [],
        config: debuffConfig('Crit Down'),
    });
    const kit = (): ShipSkills => ({
        slots: [
            { slot: 'active', abilities: [hit()] },
            { slot: 'passive', abilities: [critReaction(), insidiousness()] },
        ],
    });
    const twoFoes = () => [inert('foe-a'), { ...inert('foe-b'), position: 'M3' as const }];

    it('player side: one roll; when it passes both enemies are hit once', () => {
        const board = () =>
            BASE({
                crit: 100,
                pattern: allPattern(),
                shipSkills: kit(),
                enemyAttackers: twoFoes(),
            });
        let draws = scriptProcs('attacker', [PASS, PASS]);
        let events = run(board());
        expect(debuffLandings(events, 'attacker', 'Crit Down')).toBe(2);
        expect(procHits(events, 'attacker', 'foe-a')).toHaveLength(1);
        expect(procHits(events, 'attacker', 'foe-b')).toHaveLength(1);
        expect(draws()).toBe(1);

        draws = scriptProcs('attacker', [FAIL, PASS]);
        events = run(board());
        expect(debuffLandings(events, 'attacker', 'Crit Down')).toBe(2);
        expect(procHits(events, 'attacker', 'foe-a')).toHaveLength(0);
        expect(procHits(events, 'attacker', 'foe-b')).toHaveLength(0);
        expect(draws()).toBe(1);
    });
});

// ---------------------------------------------------------------------------------------------
// The shipped battle simulator (simulateBattle, positional) reaches the same rule: catalogue
// Ripper's active (Inc. Repair Down II) and his reactive Inferno II are two rolls, one hit.
// ---------------------------------------------------------------------------------------------
describe('Insidiousness — the battle simulator: one roll for the cast, one for the reaction', () => {
    const IMPLANT_ID = 'insid-legendary';
    const getGearPiece = (id: string): GearPiece | undefined =>
        id === IMPLANT_ID
            ? {
                  id: IMPLANT_ID,
                  slot: 'implant_major',
                  level: 16,
                  stars: 6,
                  rarity: 'legendary',
                  mainStat: null,
                  subStats: [],
                  setBonus: 'INSIDIOUSNESS',
              }
            : undefined;
    const ship = (over: Partial<Ship>): Ship =>
        ({
            rarity: 'legendary',
            faction: 'AURELIAN_SOVEREIGNTY',
            type: 'DEBUFFER',
            baseStats: {} as Ship['baseStats'],
            equipment: {},
            implants: {},
            refits: [],
            affinity: 'antimatter',
            chargeSkillCharge: 0,
            activeTarget: 'front',
            activePattern: 'Pattern-Base',
            ...over,
        }) as Ship;
    const place = (s: Ship, position: Position, speed: number): BattlePlacement => ({
        ship: s,
        position,
        statOverrides: {
            attack: 5_000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            hacking: 200,
            security: 0,
            defence: 0,
            hp: 1_000_000_000,
            speed,
        },
    });
    const ripper = (withReaction: boolean) =>
        ship({
            id: 'ripper',
            name: 'Ripper',
            implants: { implant_major: IMPLANT_ID },
            activeSkillText:
                'This Unit deals <unit-damage>165% damage</unit-damage> and inflicts <unit-skill>Inc. Repair Down II</unit-skill> for 1 turn.',
            ...(withReaction
                ? {
                      firstPassiveSkillText:
                          'When this Unit inflicts a <unit-aid>debuff</unit-aid> with its active or charged skills, it also inflicts <unit-skill>Inferno II</unit-skill> for 2 turns.',
                  }
                : {}),
        });
    const foe = () =>
        ship({
            id: 'foe',
            name: 'foe',
            type: 'ATTACKER',
            activeSkillText: 'This Unit deals <unit-damage>0% damage</unit-damage> to one enemy.',
        });
    const battle = (withReaction: boolean) =>
        simulateBattle(
            {
                playerTeam: [place(ripper(withReaction), 'M4', 100)],
                enemyTeam: [place(foe(), 'M4', 1)],
                rounds: 1,
            },
            getGearPiece
        );
    /** Reactive `attack` rows the carrier dealt (Insidiousness is its only reactive damage). */
    const procRows = (result: ReturnType<typeof simulateBattle>) => {
        const carrierId = result.roster.find((r) => r.side === 'player')!.actorId;
        let n = 0;
        for (const round of result.combatLog)
            for (const turn of round.turns)
                for (const entry of turn.entries)
                    for (const re of entry.reactions)
                        if (re.kind === 'attack' && re.actorId === carrierId) n++;
        return n;
    };

    it('cast roll fails, Inferno roll passes → one hit, two draws; both pass → one hit, one draw', () => {
        let draws = scriptProcs('attacker', [FAIL, PASS]);
        expect(procRows(battle(true))).toBe(1);
        expect(draws()).toBe(2);

        draws = scriptProcs('attacker', [PASS, PASS]);
        expect(procRows(battle(true))).toBe(1);
        expect(draws()).toBe(1);
    });

    it('control: without his reaction the cast gets its one roll only', () => {
        const draws = scriptProcs('attacker', [FAIL, PASS]);
        expect(procRows(battle(false))).toBe(0);
        expect(draws()).toBe(1);
    });
});
