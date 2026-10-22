/**
 * Non-kit combat inputs census: every gear set and implant that ACTS in combat (a proc, a
 * reaction, a conditional damage term — not a flat stat) fires in a real `simulateBattle` fight,
 * on BOTH sides of the board, with the magnitude its game text names.
 *
 * Each row is one board with the wearer named `W`. It runs four times: wearer on the player side
 * and on the enemy side (`mirrorBoard`), each WITH the gear and as a CONTROL arm rebuilt from
 * scratch without any gear piece. The row's `check` reads the same log signal from both arms, so
 * every assertion is its own mutation check: an effect that stops reaching the fight makes the
 * two arms equal and the row fails.
 *
 * Every roll succeeds (`runForcedBattle`), so a proc fires at its first opportunity and its size
 * is read off that occurrence; the proc CHANCE is pinned against the game text by
 * `nonKitInputsTextNumbers.test.ts`, not by these fights.
 *
 * The ledger that cites these rows is `docs/non-kit-inputs-ledger.md` (gitignored, local).
 */
import { describe, expect, it } from 'vitest';
import {
    entriesOf,
    grossTo,
    hitAmounts,
    mirrorBoard,
    runForcedBattle,
    type BoardRun,
    type BoardSpec,
    type UnitSpec,
} from '../__testutils__/equipmentBoard';
import { buildEquipmentAbilities } from '../../abilities/buildEquipmentAbilities';
import { buildTeam } from '../../simulator/buildTeam';
import { GEAR_SETS } from '../../../constants/gearSets';
import { IMPLANTS } from '../../../constants/implants';
import type { GearPiece } from '../../../types/gear';
import type { Ship } from '../../../types/ship';
import type { EngineeringStat } from '../../../types/stats';
import type { SquadLeaderSelection } from '../preFight';
import { calculateDamageReduction } from '../../autogear/statResolution';

// ---------------------------------------------------------------------------------------------
// Kits
// ---------------------------------------------------------------------------------------------

/** A turn that deals no damage and touches nobody else. */
const IDLE: Partial<UnitSpec> = {
    active: 'This Unit gains <unit-skill>Attack Up I</unit-skill> for 1 turn.',
    target: 'self',
    pattern: 'Pattern-Base-Support',
};
const INFLICT_DEFENSE_DOWN: Partial<UnitSpec> = {
    active: 'This Unit inflicts <unit-skill>Defense Down II</unit-skill> for 2 turns.',
    stats: { hacking: 1000 },
};
const INFLICT_DISABLE: Partial<UnitSpec> = {
    active: 'This Unit inflicts <unit-skill>Disable</unit-skill> for 2 turns.',
    stats: { hacking: 1000 },
};
const INFLICT_INFERNO: Partial<UnitSpec> = {
    active: 'This Unit inflicts <unit-skill>Inferno III</unit-skill> for 3 turns.',
    stats: { hacking: 1000 },
};
/** Hermes: repairs itself and the allies around it. */
const REPAIR_AROUND: Partial<UnitSpec> = {
    active: 'This Unit <unit-damage>repairs 27%</unit-damage> of its max HP.',
    target: 'allies',
    pattern: 'Pattern-Circle-Support-Range-1',
};
/** Mender: repairs allies in its line, never itself. */
const REPAIR_OTHERS: Partial<UnitSpec> = {
    active: 'This Unit <unit-damage>repairs 35%</unit-damage> of its max HP.',
    target: 'other-allies',
    pattern: 'Pattern-Line-Support-Not-Self-Range-2',
};
const SHIELD_AROUND: Partial<UnitSpec> = {
    active: 'This Unit grants a <unit-damage>shield equal to 21%</unit-damage> of its max HP.',
    target: 'allies',
    pattern: 'Pattern-Circle-Support-Range-1',
};

const unit = (name: string, position: UnitSpec['position'], ...parts: Partial<UnitSpec>[]) =>
    Object.assign({ name, position }, ...parts, {
        stats: Object.assign({}, ...parts.map((p) => p.stats ?? {})),
    }) as UnitSpec;

// ---------------------------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------------------------

interface Row {
    /** The `GEAR_SETS` / `IMPLANTS` key. */
    key: string;
    /** The board with the wearer `W` on the player side. */
    board: BoardSpec;
    /** The control arm's board, run WITH its gear. Absent → the same board with every gear piece
     *  removed. Set when the effect is gated on other gear the control must keep. */
    control?: BoardSpec;
    /** Reads both arms and asserts; must fail when the two arms carry the same log. */
    check: (withGear: BoardRun, control: BoardRun) => void;
}

/** Signal present with the gear, absent without it. */
const fires =
    (signal: (r: BoardRun) => number) =>
    (w: BoardRun, c: BoardRun): void => {
        expect(signal(c)).toBe(0);
        expect(signal(w)).toBeGreaterThan(0);
    };

/** Signal scales by exactly `factor` against the control arm (both non-zero). */
const scales =
    (signal: (r: BoardRun) => number, factor: number, digits = 3) =>
    (w: BoardRun, c: BoardRun): void => {
        const base = signal(c);
        expect(base).toBeGreaterThan(0);
        expect(signal(w) / base).toBeCloseTo(factor, digits);
    };

const firstHit = (actor: string, target: string) => (r: BoardRun) =>
    hitAmounts(r, actor, target)[0] ?? 0;
const sumHits = (actor: string, target: string) => (r: BoardRun) =>
    hitAmounts(r, actor, target).reduce((a, b) => a + b, 0);
/** HP damage `name` took over the fight (the per-round `damageTaken` rates summed). */
const damageTakenBy = (r: BoardRun, name: string): number =>
    r.result.rounds.reduce(
        (sum, round) => sum + (round.ships.find((s) => s.actorId === r.id(name))?.damageTaken ?? 0),
        0
    );
const buffCount = (note: string, target: string) => (r: BoardRun) =>
    entriesOf(r, 'buff', { note, target }).length;
const debuffCount = (note: string, target: string) => (r: BoardRun) =>
    entriesOf(r, 'debuff', { note, target }).length;

// ---------------------------------------------------------------------------------------------
// Gear sets
// ---------------------------------------------------------------------------------------------

const GEAR_SET_ROWS: Row[] = [
    {
        // "Leech 15% from damage dealt"
        key: 'LEECH',
        board: {
            player: [unit('W', 'M4', { set: { name: 'LEECH', pieces: 2 } })],
            enemy: [unit('O', 'M4')],
        },
        check: (w, c) => {
            expect(grossTo(c, 'heal', { actor: 'W', target: 'W' })).toBe(0);
            expect(
                grossTo(w, 'heal', { actor: 'W', target: 'W' }) / sumHits('W', 'O')(w)
            ).toBeCloseTo(0.15, 6);
        },
    },
    {
        // "Reduces critical damage taken by 5%"
        key: 'HARDENED',
        board: {
            player: [unit('W', 'M4', { set: { name: 'HARDENED', pieces: 2 } }, IDLE)],
            enemy: [unit('O', 'M4', { stats: { crit: 100, critDamage: 100 } })],
        },
        check: scales(firstHit('O', 'W'), 0.95),
    },
    {
        // "2 turns stealth"
        key: 'CLOAKING',
        board: {
            player: [unit('W', 'M4', { set: { name: 'CLOAKING', pieces: 2 } })],
            enemy: [unit('O', 'M4')],
        },
        check: (w, c) => {
            fires(buffCount('Stealth', 'W'))(w, c);
            // Granted at the start of combat, once.
            const grants = entriesOf(w, 'buff', { note: 'Stealth', target: 'W' });
            expect(grants).toHaveLength(1);
            expect(w.result.combatLog[0].startOfRound).toContain(grants[0]);
        },
    },
    {
        // "10% extra DoT damage"
        key: 'DECIMATION',
        board: {
            player: [unit('W', 'M4', { set: { name: 'DECIMATION', pieces: 2 } }, INFLICT_INFERNO)],
            enemy: [unit('O', 'M4', IDLE)],
        },
        check: scales((r) => grossTo(r, 'dot-ticked', { target: 'O' }), 1.1),
    },
    {
        // "Applies Inferno 1 for 2 turns."
        key: 'BURNER',
        board: {
            player: [unit('W', 'M4', { set: { name: 'BURNER', pieces: 4 } })],
            enemy: [unit('O', 'M4', IDLE)],
        },
        check: (w, c) => {
            fires(
                (r) =>
                    entriesOf(r, 'dot-applied', { actor: 'W', target: 'O', note: 'inferno I' })
                        .length
            )(w, c);
            // Inferno 1 ticks 15% of the applier's attack per stack.
            expect(entriesOf(w, 'dot-ticked', { target: 'O' })[0].targets[0].amount).toBeCloseTo(
                150,
                6
            );
        },
    },
    {
        // "Reflect 7% of the damage of each hit taken"
        key: 'REFLECT',
        board: {
            player: [unit('W', 'M4', { set: { name: 'REFLECT', pieces: 2 } }, IDLE)],
            enemy: [unit('O', 'M4')],
        },
        check: (w, c) => {
            expect(sumHits('W', 'O')(c)).toBe(0);
            expect(firstHit('W', 'O')(w)).toBeCloseTo(0.07 * firstHit('O', 'W')(w), 6);
        },
    },
    {
        // "Increase damage by +25% * lost HP%": at half HP, +12.5%.
        key: 'REVENGE',
        board: {
            player: [unit('W', 'M4', { set: { name: 'REVENGE', pieces: 2 }, startHpFrac: 0.5 })],
            enemy: [unit('O', 'M4', IDLE)],
            rounds: 1,
        },
        check: scales(firstHit('W', 'O'), 1.125),
    },
    {
        // "Generate 4% shield each turn"
        key: 'SHIELD',
        board: {
            player: [unit('W', 'M4', { set: { name: 'SHIELD', pieces: 2 } }, IDLE)],
            enemy: [unit('O', 'M4')],
        },
        check: (w, c) => {
            fires((r) => entriesOf(r, 'shield', { actor: 'W', target: 'W' }).length)(w, c);
            // One per own turn, 4% of max HP each.
            const grants = entriesOf(w, 'shield', { actor: 'W', target: 'W' });
            expect(grants).toHaveLength(3);
            expect(grants[0].targets[0].amount).toBeCloseTo(40_000, 6);
        },
    },
    {
        // "All buffs last an extra turn": W's 1-turn grant on A now outlives A's next turn, so
        // the re-grant refreshes it before it can expire.
        key: 'BOOST',
        board: {
            player: [
                unit(
                    'W',
                    'M3',
                    { set: { name: 'BOOST', pieces: 4 }, stats: { speed: 200 } },
                    {
                        active: 'This Unit grants <unit-skill>Crit Power Up III</unit-skill> for 1 turn.',
                        target: 'allies',
                        pattern: 'Pattern-Circle-Support-Range-1',
                    }
                ),
                unit('A', 'M4'),
            ],
            enemy: [unit('O', 'M4', IDLE)],
        },
        check: (w, c) => {
            const expiries = (r: BoardRun) =>
                r.entries.filter((e) => e.kind === 'buff-expired' && e.actorId === r.id('A'))
                    .length;
            expect(expiries(c)).toBe(3);
            expect(expiries(w)).toBe(0);
        },
    },
];

// ---------------------------------------------------------------------------------------------
// Implants
// ---------------------------------------------------------------------------------------------

type Rarity = NonNullable<UnitSpec['implant']>['rarity'];
const imp = (name: string, rarity: Rarity, slot = 'implant_major'): Partial<UnitSpec> => ({
    implant: { name, rarity, slot },
});

const IMPLANT_ROWS: Row[] = [
    {
        // Legendary: "Applies Disable for 2 turns on the enemy that killed this Unit."
        key: 'MARTYRDOM',
        board: {
            player: [
                unit('W', 'M4', imp('MARTYRDOM', 'legendary', 'implant_ultimate'), IDLE, {
                    stats: { hp: 1000 },
                }),
            ],
            enemy: [unit('O', 'M4', { stats: { attack: 100_000 } })],
        },
        check: fires(debuffCount('Disable', 'O')),
    },
    {
        // Legendary: "a shield equal to 30% of the overrepaired amount on the target".
        key: 'ABUNDANT_RENEWAL',
        board: {
            player: [
                unit(
                    'W',
                    'M3',
                    imp('ABUNDANT_RENEWAL', 'legendary', 'implant_ultimate'),
                    REPAIR_OTHERS
                ),
                unit('A', 'M4', IDLE),
            ],
            enemy: [unit('O', 'M4', IDLE)],
            rounds: 1,
        },
        check: (w, c) => {
            fires((r) => entriesOf(r, 'shield', { target: 'A' }).length)(w, c);
            const heal = entriesOf(w, 'heal', { actor: 'W', target: 'A' })[0].targets[0];
            expect(grossTo(w, 'shield', { target: 'A' })).toBeCloseTo(
                0.3 * (heal.overheal ?? 0),
                6
            );
        },
    },
    {
        // Legendary: "+20% outgoing direct damage while shielded" (shield from the Shield set).
        key: 'ARCANE_SIEGE',
        board: {
            player: [
                unit('W', 'M4', imp('ARCANE_SIEGE', 'legendary', 'implant_ultimate'), {
                    set: { name: 'SHIELD', pieces: 2 },
                }),
            ],
            enemy: [unit('O', 'M4', IDLE)],
            rounds: 1,
        },
        // The control keeps the Shield set (the gate) and drops only the implant.
        control: {
            player: [unit('W', 'M4', { set: { name: 'SHIELD', pieces: 2 } })],
            enemy: [unit('O', 'M4', IDLE)],
            rounds: 1,
        },
        check: scales(firstHit('W', 'O'), 1.2),
    },
    {
        // Legendary: "Every other turn, adds 1 charge to the Unit's Charged skill."
        key: 'CHRONO_REAVER',
        board: {
            player: [
                unit('W', 'M4', imp('CHRONO_REAVER', 'legendary', 'implant_ultimate'), {
                    charged: 'This Unit deals <unit-damage>300% damage</unit-damage>.',
                    chargeCount: 9,
                }),
            ],
            enemy: [unit('O', 'M4', IDLE)],
            rounds: 4,
        },
        check: (w, c) => {
            const bonusRounds = (r: BoardRun) =>
                r.result.combatLog
                    .filter((round) =>
                        entriesOf(r, 'charge-changed', { actor: 'W', note: 'charge' }).some(
                            (e) =>
                                (e.note ?? '').includes('manip') &&
                                round.turns.some(
                                    (t) => t.entries.includes(e) || hasNested(t.entries, e)
                                )
                        )
                    )
                    .map((round) => round.round);
            expect(bonusRounds(c)).toEqual([]);
            expect(bonusRounds(w)).toEqual([2, 4]);
        },
    },
    {
        // Legendary: "Decreases Damage by 35% when critically hit by an enemy that has stealth."
        key: 'HYPERION_GAZE',
        board: {
            player: [unit('W', 'M4', imp('HYPERION_GAZE', 'legendary', 'implant_ultimate'), IDLE)],
            enemy: [
                unit('O', 'M4', {
                    set: { name: 'CLOAKING', pieces: 2 },
                    stats: { crit: 100, critDamage: 100 },
                }),
            ],
            rounds: 1,
        },
        control: {
            player: [unit('W', 'M4', IDLE)],
            enemy: [
                unit('O', 'M4', {
                    set: { name: 'CLOAKING', pieces: 2 },
                    stats: { crit: 100, critDamage: 100 },
                }),
            ],
            rounds: 1,
        },
        check: scales(firstHit('O', 'W'), 0.65),
    },
    {
        // Legendary: "+5% damage for each debuff on the target". A seeds one Defense Down on O
        // (defence 0, so the debuff itself changes nothing).
        key: 'INTRUSION',
        board: {
            player: [
                unit('W', 'M4', imp('INTRUSION', 'legendary', 'implant_ultimate')),
                unit('A', 'M3', INFLICT_DEFENSE_DOWN, { stats: { speed: 200 } }),
            ],
            enemy: [unit('O', 'M4', IDLE)],
            rounds: 1,
        },
        check: scales(firstHit('W', 'O'), 1.05),
    },
    {
        // Legendary: "When direct damage would cause HP to drop below 30%, gain a Shield equal to
        // 12000 plus 100% of this unit's Attack stat (capped at max HP). Once per battle."
        key: 'LIFELINE',
        board: {
            // W acts after the hit on both sides, so its attack is the unbuffed 1000.
            player: [
                unit('W', 'M4', imp('LIFELINE', 'legendary', 'implant_ultimate'), IDLE, {
                    stats: { hp: 20_000, speed: 50 },
                }),
            ],
            enemy: [unit('O', 'M4', { stats: { attack: 15_000 } })],
            rounds: 1,
        },
        check: (w, c) => {
            fires((r) => entriesOf(r, 'shield', { target: 'W' }).length)(w, c);
            expect(entriesOf(w, 'shield', { target: 'W' })).toHaveLength(1);
            expect(grossTo(w, 'shield', { target: 'W' })).toBeCloseTo(13_000, 6);
        },
    },
    {
        // Legendary: "Decrease damage by 35% when directly damaged while under Stasis or Disable."
        key: 'NEBULA_NULLIFIER',
        board: {
            player: [unit('W', 'M4', imp('NEBULA_NULLIFIER', 'legendary', 'implant_ultimate'))],
            enemy: [
                unit('O', 'M4', INFLICT_DISABLE, { stats: { speed: 300 } }),
                unit('O2', 'M3', { stats: { speed: 200 } }),
            ],
            rounds: 1,
        },
        check: scales(firstHit('O2', 'W'), 0.65),
    },
    {
        // Legendary: "Increases repair by 30% when targeting an ally with lower HP".
        key: 'NOURISHMENT',
        board: {
            player: [
                unit('W', 'M3', imp('NOURISHMENT', 'legendary', 'implant_ultimate'), REPAIR_OTHERS),
                unit('A', 'M4', IDLE, { startHpFrac: 0.5 }),
            ],
            enemy: [unit('O', 'M4', IDLE)],
            rounds: 1,
        },
        check: scales((r) => grossTo(r, 'heal', { actor: 'W', target: 'A' }), 1.3),
    },
    {
        // Legendary: "Gains Speed Up 3 for 1 turn when an enemy gets directly repaired. Increases
        // the critDamage of the next crit by 10%." H (enemy healer) acts first.
        key: 'SYNAPTIC_RESONANCE',
        board: {
            player: [
                unit('W', 'M4', imp('SYNAPTIC_RESONANCE', 'legendary', 'implant_ultimate'), {
                    stats: { crit: 100, critDamage: 50 },
                }),
            ],
            enemy: [
                unit('O', 'M4', IDLE),
                unit('H', 'M3', REPAIR_AROUND, { stats: { speed: 300 } }),
            ],
            rounds: 1,
        },
        check: (w, c) => {
            fires(buffCount('Speed Up III', 'W'))(w, c);
            // 150% → 160% crit power on the next crit.
            expect(firstHit('W', 'O')(w) / firstHit('W', 'O')(c)).toBeCloseTo(1600 / 1500, 6);
        },
    },
    {
        // Epic: "Deals 8% more detonation damage and bombs additionally deal 16% more splash".
        key: 'VOIDFIRE_CATALYST',
        board: {
            player: [
                unit('W', 'M4', imp('VOIDFIRE_CATALYST', 'epic', 'implant_ultimate'), {
                    active: 'This Unit inflicts <unit-skill>Bomb III</unit-skill> for 3 turns.',
                    stats: { hacking: 1000 },
                }),
            ],
            enemy: [unit('O', 'M4', IDLE)],
            // A bomb counts down on its holder's turns: five rounds detonate one on either side.
            rounds: 5,
        },
        check: scales((r) => grossTo(r, 'bomb', { actor: 'W', target: 'O' }), 1.08),
    },
    {
        // Legendary: "Decreases Damage Received by 20% When Directly Damaged While Stealth is
        // Active." Stealth from the Cloaking set, which the control keeps.
        key: 'VOIDSHADE',
        board: {
            player: [
                unit(
                    'W',
                    'M4',
                    imp('VOIDSHADE', 'legendary', 'implant_ultimate'),
                    { set: { name: 'CLOAKING', pieces: 2 } },
                    IDLE
                ),
            ],
            enemy: [unit('O', 'M4')],
            rounds: 1,
        },
        control: {
            player: [unit('W', 'M4', { set: { name: 'CLOAKING', pieces: 2 } }, IDLE)],
            enemy: [unit('O', 'M4')],
            rounds: 1,
        },
        check: scales(firstHit('O', 'W'), 0.8),
    },
    {
        // Legendary: "Reduces damage taken from Inferno or Corrosion by 30%."
        key: 'VORTEX_VEIL',
        board: {
            player: [unit('W', 'M4', imp('VORTEX_VEIL', 'legendary', 'implant_ultimate'), IDLE)],
            enemy: [unit('O', 'M4', INFLICT_INFERNO)],
            rounds: 2,
        },
        check: scales((r) => grossTo(r, 'dot-ticked', { target: 'W' }), 0.7),
    },
    {
        // Legendary: "Increases damage by 5% when directly damaging an enemy while debuffed".
        key: 'WARPSTRIKE',
        board: {
            player: [unit('W', 'M4', imp('WARPSTRIKE', 'legendary', 'implant_ultimate'))],
            enemy: [unit('O', 'M4', INFLICT_DEFENSE_DOWN, { stats: { speed: 300 } })],
            rounds: 1,
        },
        check: scales(firstHit('W', 'O'), 1.05),
    },
    {
        // Legendary: "When directly damaged, 19% chance to gain a shield equal to 42% of the
        // damage taken, limited to once per round."
        key: 'ADAPTIVE_PLATING',
        board: {
            player: [unit('W', 'M4', imp('ADAPTIVE_PLATING', 'legendary'), IDLE)],
            enemy: [unit('O', 'M4'), unit('O2', 'M3')],
            rounds: 2,
        },
        check: (w, c) => {
            fires((r) => entriesOf(r, 'shield', { target: 'W' }).length)(w, c);
            // Two hits a round, one shield a round.
            const grants = entriesOf(w, 'shield', { target: 'W' });
            expect(grants).toHaveLength(2);
            expect(grants[0].targets[0].amount).toBeCloseTo(420, 6);
        },
    },
    {
        // Legendary: "At the end of the round, if not hit, 20% chance to gain Speed Up 3 for 2
        // turns".
        key: 'ALACRITY',
        board: {
            player: [unit('W', 'M4', imp('ALACRITY', 'legendary'))],
            enemy: [unit('O', 'M4', IDLE)],
            rounds: 1,
        },
        check: (w, c) => {
            fires(buffCount('Speed Up III', 'W'))(w, c);
            const grant = entriesOf(w, 'buff', { note: 'Speed Up III', target: 'W' })[0];
            expect(
                w.result.combatLog[0].endOfRound.some((e) => e === grant || hasNested([e], grant))
            ).toBe(true);
        },
    },
    {
        // Legendary: "At the start of a round, if this unit has Stealth, 16% chance to gain Crit
        // Power Up 3 for 1 turn." Stealth from the Cloaking set, which the control keeps.
        key: 'AMBUSH',
        board: {
            player: [
                unit('W', 'M4', imp('AMBUSH', 'legendary'), {
                    set: { name: 'CLOAKING', pieces: 2 },
                }),
            ],
            enemy: [unit('O', 'M4', IDLE)],
            rounds: 1,
        },
        control: {
            player: [unit('W', 'M4', { set: { name: 'CLOAKING', pieces: 2 } })],
            enemy: [unit('O', 'M4', IDLE)],
            rounds: 1,
        },
        check: fires(buffCount('Crit Power Up III', 'W')),
    },
    {
        // Legendary: "Upon death, grants all allies Inc. Damage Down 2 for 3 turns."
        key: 'BATTLECRY',
        board: {
            player: [
                unit('W', 'M4', imp('BATTLECRY', 'legendary'), IDLE, { stats: { hp: 1000 } }),
                unit('A', 'M3', IDLE),
            ],
            enemy: [unit('O', 'M4', { stats: { attack: 100_000 } })],
            rounds: 1,
        },
        check: fires(buffCount('Inc. Damage Down II', 'A')),
    },
    {
        // Legendary: "On a critical hit, 20% chance to repair itself for 20% of the damage dealt"
        key: 'BLOODTHIRST',
        board: {
            player: [unit('W', 'M4', imp('BLOODTHIRST', 'legendary'), { stats: { crit: 100 } })],
            enemy: [unit('O', 'M4', IDLE)],
            rounds: 1,
        },
        check: (w, c) => {
            expect(grossTo(c, 'heal', { actor: 'W', target: 'W' })).toBe(0);
            expect(
                grossTo(w, 'heal', { actor: 'W', target: 'W' }) / firstHit('W', 'O')(w)
            ).toBeCloseTo(0.2, 6);
        },
    },
    {
        // Legendary: "16% chance, when an adjacent ally is directly damaged, to apply Provoke to
        // that enemy for 1 turn. Once per round."
        key: 'BULWARK',
        board: {
            player: [unit('W', 'M3', imp('BULWARK', 'legendary'), IDLE), unit('A', 'M4', IDLE)],
            enemy: [unit('O', 'M4')],
            rounds: 1,
        },
        check: fires(debuffCount('Provoke', 'O')),
    },
    {
        // Legendary: "At the end of the round, if this unit was the first to activate, 16% chance
        // to apply Concentrate Fire to the enemy with highest attack for 1 turn."
        key: 'DOOMSAYER',
        board: {
            player: [
                unit('W', 'M4', imp('DOOMSAYER', 'legendary'), IDLE, { stats: { speed: 300 } }),
            ],
            enemy: [
                unit('O', 'M4', IDLE, { stats: { attack: 500 } }),
                unit('O2', 'M3', IDLE, { stats: { attack: 2000 } }),
            ],
            rounds: 1,
        },
        check: (w, c) => {
            fires(debuffCount('Concentrate Fire', 'O2'))(w, c);
            expect(debuffCount('Concentrate Fire', 'O')(w)).toBe(0);
        },
    },
    {
        // Legendary: "When repaired, 30% chance to increase that repair by 15%"
        key: 'EXUBERANCE',
        board: {
            player: [
                unit('W', 'M4', imp('EXUBERANCE', 'legendary'), IDLE),
                unit('H', 'M3', REPAIR_OTHERS),
            ],
            enemy: [unit('O', 'M4', IDLE)],
            rounds: 1,
        },
        check: scales((r) => grossTo(r, 'heal', { actor: 'H', target: 'W' }), 1.15),
    },
    {
        // Legendary: "When debuffed, 15% chance to gain Block Debuff for 1 turn"
        key: 'FIREWALL',
        board: {
            player: [unit('W', 'M4', imp('FIREWALL', 'legendary'), IDLE)],
            enemy: [unit('O', 'M4', INFLICT_DEFENSE_DOWN)],
            rounds: 1,
        },
        check: fires(buffCount('Block Debuff', 'W')),
    },
    {
        // Legendary: "When applying repair to another ally, 16% chance to grant Power Infused
        // Nanobots for 1 turn."
        key: 'FONT_OF_POWER',
        board: {
            player: [
                unit('W', 'M3', imp('FONT_OF_POWER', 'legendary'), REPAIR_OTHERS),
                unit('A', 'M4', IDLE),
            ],
            enemy: [unit('O', 'M4', IDLE)],
            rounds: 1,
        },
        check: fires(buffCount('Power Infused Nanobots', 'A')),
    },
    {
        // Legendary: "Every turn, 32% chance to grant all adjacent allies Defense Up 1 for 1 turn"
        key: 'FORTIFYING_SHROUD',
        board: {
            player: [
                unit('W', 'M3', imp('FORTIFYING_SHROUD', 'legendary'), IDLE),
                unit('A', 'M4', IDLE),
                unit('F', 'M1', IDLE),
            ],
            enemy: [unit('O', 'M4', IDLE)],
            rounds: 1,
        },
        check: (w, c) => {
            fires(buffCount('Defense Up I', 'A'))(w, c);
            expect(buffCount('Defense Up I', 'F')(w)).toBe(0);
        },
    },
    {
        // Legendary: "When directly damaging an enemy with a higher attack, 20% chance to increase
        // that damage by 50%"
        key: 'GIANT_SLAYER',
        board: {
            player: [unit('W', 'M4', imp('GIANT_SLAYER', 'legendary'))],
            enemy: [unit('O', 'M4', IDLE, { stats: { attack: 2000 } })],
            rounds: 1,
        },
        check: scales(firstHit('W', 'O'), 1.5),
    },
    {
        // Legendary: "When debuffing an enemy, 21% chance to deal 100% damage."
        key: 'INSIDIOUSNESS',
        board: {
            player: [unit('W', 'M4', imp('INSIDIOUSNESS', 'legendary'), INFLICT_DEFENSE_DOWN)],
            enemy: [unit('O', 'M4', IDLE)],
            rounds: 1,
        },
        check: (w, c) => {
            fires(sumHits('W', 'O'))(w, c);
            expect(firstHit('W', 'O')(w)).toBeCloseTo(1000, 6);
        },
    },
    {
        // Legendary: "When directly damaged for the second and subsequent times in a round, 20%
        // chance to block 50% of the damage"
        key: 'IRONCLAD',
        board: {
            player: [unit('W', 'M4', imp('IRONCLAD', 'legendary'), IDLE)],
            enemy: [
                unit('O', 'M4', { stats: { speed: 300 } }),
                unit('O2', 'M3', { stats: { speed: 200 } }),
            ],
            rounds: 1,
        },
        // The block reaches HP but not the log's hit row, which keeps the thrown amount (ledger:
        // IRONCLAD / SHADOWGUARD), so this reads HP actually lost: 1000 + 50% of 1000.
        check: (w, c) => {
            expect(damageTakenBy(c, 'W')).toBeCloseTo(2000, 6);
            expect(damageTakenBy(w, 'W')).toBeCloseTo(1500, 6);
        },
    },
    {
        // Legendary: "When this unit becomes the last one standing, 32% chance to gain Barrier
        // and Block Debuff for 1 turn"
        key: 'LAST_STAND',
        board: {
            player: [
                unit('W', 'M3', imp('LAST_STAND', 'legendary'), IDLE),
                unit('A', 'M4', IDLE, { stats: { hp: 1000 } }),
            ],
            enemy: [unit('O', 'M4', { stats: { attack: 100_000 } })],
            rounds: 1,
        },
        check: (w, c) => {
            fires(buffCount('Barrier', 'W'))(w, c);
            expect(buffCount('Block Debuff', 'W')(w)).toBeGreaterThan(0);
        },
    },
    {
        // Legendary: "Upon death, repairs 32% of all allies' max HP."
        key: 'LAST_WISH',
        board: {
            player: [
                unit('W', 'M4', imp('LAST_WISH', 'legendary'), IDLE, { stats: { hp: 1000 } }),
                unit('A', 'M3', IDLE, { startHpFrac: 0.5 }),
            ],
            enemy: [unit('O', 'M4', { stats: { attack: 100_000 } })],
            rounds: 1,
        },
        check: (w, c) => {
            fires((r) => grossTo(r, 'heal', { actor: 'W', target: 'A' }))(w, c);
            expect(grossTo(w, 'heal', { actor: 'W', target: 'A' })).toBeCloseTo(320_000, 6);
        },
    },
    {
        // Legendary: "When resisting a debuff, 16% chance to grant Buff Protection to all allies
        // for 1 turn."
        key: 'LOCKDOWN',
        board: {
            player: [
                unit('W', 'M4', imp('LOCKDOWN', 'legendary'), IDLE, {
                    stats: { security: 10_000 },
                }),
                unit('A', 'M3', IDLE),
            ],
            enemy: [unit('O', 'M4', { active: INFLICT_DEFENSE_DOWN.active })],
            rounds: 1,
        },
        check: (w, c) => {
            expect(entriesOf(w, 'debuff-resisted', { target: 'W' }).length).toBeGreaterThan(0);
            fires(buffCount('Buff Protection', 'A'))(w, c);
        },
    },
    {
        // Legendary: "When critically damaging an enemy, 12% chance to increase that damage by 45%"
        key: 'MENACE',
        board: {
            player: [
                unit('W', 'M4', imp('MENACE', 'legendary'), {
                    stats: { crit: 100, critDamage: 50 },
                }),
            ],
            enemy: [unit('O', 'M4', IDLE)],
            rounds: 1,
        },
        check: scales(firstHit('W', 'O'), 1.45),
    },
    {
        // Legendary: "When directly damaged, 16% chance to cleanse 1 debuff". O debuffs W, then
        // O2 hits W.
        key: 'REACTIVE_WARD',
        board: {
            player: [unit('W', 'M4', imp('REACTIVE_WARD', 'legendary'), IDLE)],
            enemy: [
                unit('O', 'M4', INFLICT_DEFENSE_DOWN, { stats: { speed: 300 } }),
                unit('O2', 'M3', { stats: { speed: 200 } }),
            ],
            rounds: 1,
        },
        check: fires((r) => entriesOf(r, 'cleanse', { target: 'W' }).length),
    },
    {
        // Legendary: "When applying a shield, 16% chance to grant Crit Power Up 3 for 1 turn"
        key: 'RESONATING_FURY',
        board: {
            player: [
                unit('W', 'M3', imp('RESONATING_FURY', 'legendary'), SHIELD_AROUND),
                unit('A', 'M4'),
            ],
            enemy: [unit('O', 'M4', IDLE)],
            rounds: 1,
        },
        check: fires(buffCount('Crit Power Up III', 'A')),
    },
    {
        // Legendary: "Upon receiving critical direct damage, 16% chance to repair 10% of this
        // Unit's Max HP"
        key: 'SECOND_WIND',
        board: {
            player: [unit('W', 'M4', imp('SECOND_WIND', 'legendary'), IDLE)],
            enemy: [unit('O', 'M4', { stats: { crit: 100 } })],
            rounds: 1,
        },
        check: (w, c) => {
            fires((r) => grossTo(r, 'heal', { target: 'W' }))(w, c);
            expect(grossTo(w, 'heal', { target: 'W' })).toBeCloseTo(100_000, 6);
        },
    },
    {
        // Legendary: "When directly damaged while in stealth, 16% chance to block the damage,
        // limited to once per round". Stealth from the Cloaking set, which the control keeps.
        key: 'SHADOWGUARD',
        board: {
            player: [
                unit(
                    'W',
                    'M4',
                    imp('SHADOWGUARD', 'legendary'),
                    { set: { name: 'CLOAKING', pieces: 2 } },
                    IDLE
                ),
            ],
            enemy: [
                unit('O', 'M4', { stats: { speed: 300 } }),
                unit('O2', 'M3', { stats: { speed: 200 } }),
            ],
            rounds: 1,
        },
        control: {
            player: [unit('W', 'M4', { set: { name: 'CLOAKING', pieces: 2 } }, IDLE)],
            enemy: [
                unit('O', 'M4', { stats: { speed: 300 } }),
                unit('O2', 'M3', { stats: { speed: 200 } }),
            ],
            rounds: 1,
        },
        // HP actually lost (see IRONCLAD): the first hit is blocked whole, the second lands in full
        // (once per round).
        check: (w, c) => {
            expect(damageTakenBy(c, 'W')).toBeCloseTo(2000, 6);
            expect(damageTakenBy(w, 'W')).toBeCloseTo(1000, 6);
        },
    },
    {
        // Legendary: "When directly damaged, 16% chance to gain Stealth for 1 turn."
        key: 'SMOKESCREEN',
        board: {
            player: [unit('W', 'M4', imp('SMOKESCREEN', 'legendary'), IDLE)],
            enemy: [unit('O', 'M4')],
            rounds: 1,
        },
        check: fires(buffCount('Stealth', 'W')),
    },
    {
        // Legendary: "After using the charged skill, 32% chance to grant all allies Attack Up 1
        // for 1 turn."
        key: 'SPEARHEAD',
        board: {
            player: [
                unit('W', 'M4', imp('SPEARHEAD', 'legendary'), {
                    charged: 'This Unit deals <unit-damage>200% damage</unit-damage>.',
                    chargeCount: 1,
                }),
                unit('A', 'M3', {
                    active: 'This Unit deals <unit-damage>100% damage</unit-damage>.',
                }),
            ],
            enemy: [unit('O', 'M4', IDLE)],
            rounds: 3,
        },
        check: fires(buffCount('Attack Up I', 'A')),
    },
    {
        // Legendary: "Upon directly receiving damage exceeding 25% of max HP, 16% chance to grant
        // Buff Protection to all allies for 2 turns."
        key: 'TENACITY',
        board: {
            player: [unit('W', 'M4', imp('TENACITY', 'legendary'), IDLE), unit('A', 'M3', IDLE)],
            enemy: [unit('O', 'M4', { stats: { attack: 300_000 } })],
            rounds: 1,
        },
        control: {
            player: [unit('W', 'M4', IDLE), unit('A', 'M3', IDLE)],
            enemy: [unit('O', 'M4', { stats: { attack: 300_000 } })],
            rounds: 1,
        },
        check: fires(buffCount('Buff Protection', 'A')),
    },
    {
        // Legendary: "When repairing an ally with less than 25% HP, 32% chance to double the
        // amount of repair"
        key: 'VIVACIOUS_REPAIR',
        board: {
            player: [
                unit('W', 'M3', imp('VIVACIOUS_REPAIR', 'legendary'), REPAIR_OTHERS),
                unit('A', 'M4', IDLE, { startHpFrac: 0.1 }),
            ],
            enemy: [unit('O', 'M4', IDLE)],
            rounds: 1,
        },
        check: scales((r) => grossTo(r, 'heal', { actor: 'W', target: 'A' }), 2),
    },
];

/** Whether `needle` sits anywhere under `entries` (nested reactions included). */
function hasNested(entries: BoardRun['entries'], needle: BoardRun['entries'][number]): boolean {
    return entries.some((e) => e === needle || hasNested(e.reactions, needle));
}

// ---------------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------------

describe.each([
    ['gear set', GEAR_SET_ROWS],
    ['implant', IMPLANT_ROWS],
] as const)('non-kit census: %s', (_label, rows) => {
    for (const row of rows) {
        for (const side of ['player', 'enemy'] as const) {
            it(`${row.key} fires for a ${side}-side wearer`, () => {
                const orient = (b: BoardSpec) => (side === 'player' ? b : mirrorBoard(b));
                const control = row.control
                    ? runForcedBattle(orient(row.control), true)
                    : runForcedBattle(orient(row.board), false);
                row.check(runForcedBattle(orient(row.board), true), control);
            });
        }
    }
});

// ---------------------------------------------------------------------------------------------
// Coverage tripwire: every set / implant the real builder turns into an ability has a row
// ---------------------------------------------------------------------------------------------

describe('non-kit census: coverage', () => {
    const buildsAbilities = (setBonus: string, rarity: GearPiece['rarity'], asImplant: boolean) => {
        const pieces: Record<string, GearPiece> = {};
        const equipment: Ship['equipment'] = {};
        const implants: Ship['implants'] = {};
        if (asImplant) {
            pieces.i = { id: 'i', setBonus, rarity } as GearPiece;
            implants.implant_major = 'i';
        } else {
            (['weapon', 'hull', 'generator', 'sensor'] as const).forEach((slot, n) => {
                pieces[`g${n}`] = { id: `g${n}`, setBonus, rarity: 'legendary', slot } as GearPiece;
                equipment[slot] = `g${n}`;
            });
        }
        const ship = { id: 's', equipment, implants } as Ship;
        return buildEquipmentAbilities(ship, (id) => pieces[id]).length > 0;
    };

    it('every combat-acting gear set has a census row', () => {
        const acting = Object.keys(GEAR_SETS).filter((k) => buildsAbilities(k, 'legendary', false));
        expect(acting.sort()).toEqual(GEAR_SET_ROWS.map((r) => r.key).sort());
    });

    it('every combat-acting implant has a census row', () => {
        const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary'] as const;
        const acting = Object.keys(IMPLANTS).filter((k) =>
            rarities.some((r) => buildsAbilities(k, r, true))
        );
        expect(acting.sort()).toEqual(IMPLANT_ROWS.map((r) => r.key).sort());
    });
});

// ---------------------------------------------------------------------------------------------
// Stat-path inputs: engineering, refits (ascension), stat-only sets and implants, Code Guard,
// Cipher Link. None of these acts in the fight; they reach it as the `statOverrides` block the
// simulator page builds (`buildTeam` → `shipFinalStats` → `combatStatsFromShip`).
// ---------------------------------------------------------------------------------------------

describe('non-kit census: stat-path inputs reach the engine input', () => {
    const BASE = {
        hp: 10_000,
        attack: 1000,
        defence: 1000,
        hacking: 100,
        security: 100,
        crit: 10,
        critDamage: 50,
        speed: 100,
    };
    const baseShip = (over: Partial<Ship> = {}): Ship => ({
        id: 'stat-ship',
        name: 'StatShip',
        rarity: 'legendary',
        faction: 'MPL',
        type: 'ATTACKER',
        baseStats: { ...BASE },
        equipment: {},
        implants: {},
        refits: [],
        ...over,
    });

    const statsOf = (
        ship: Ship,
        pieces: Record<string, GearPiece> = {},
        engineering?: EngineeringStat
    ) => {
        const stats = buildTeam(
            { M4: { ship } },
            {
                getGearPiece: (id) => pieces[id],
                getEngineeringStatsForShipType: (t) =>
                    engineering?.shipType === t ? engineering : undefined,
            }
        )[0].statOverrides;
        if (!stats) throw new Error('buildTeam produced no statOverrides');
        return stats;
    };

    const piece = (over: Record<string, unknown>): GearPiece =>
        ({ subStats: [], mainStat: null, rarity: 'legendary', ...over }) as unknown as GearPiece;

    it('engineering: +10% attack on the ship type reaches the attack the engine reads', () => {
        const eng: EngineeringStat = {
            shipType: 'ATTACKER',
            stats: [{ name: 'attack', value: 10, type: 'percentage' }],
        };
        expect(statsOf(baseShip()).attack).toBe(1000);
        expect(statsOf(baseShip(), {}, eng).attack).toBe(1100);
    });

    it('refit (ascension) stats: +500 flat HP reaches the HP the engine reads', () => {
        const refits = [
            { id: 'r', stats: [{ name: 'hp', value: 500, type: 'flat' }] },
        ] as Ship['refits'];
        expect(statsOf(baseShip({ refits })).hp).toBe(10_500);
    });

    it('a stat-only set (Attack, 2 pieces) adds 15% attack', () => {
        const pieces = {
            a: piece({ id: 'a', slot: 'weapon', setBonus: 'ATTACK' }),
            b: piece({ id: 'b', slot: 'hull', setBonus: 'ATTACK' }),
        };
        expect(statsOf(baseShip({ equipment: { weapon: 'a', hull: 'b' } }), pieces).attack).toBe(
            1150
        );
    });

    it("a stat-only implant's stats come from the PIECE's subStats", () => {
        const pieces = {
            i: piece({
                id: 'i',
                setBonus: 'STRIKE',
                subStats: [{ name: 'attack', value: 200, type: 'flat' }],
            }),
        };
        expect(statsOf(baseShip({ implants: { implant_minor_sigma: 'i' } }), pieces).attack).toBe(
            1200
        );
    });

    it.each([
        ['CODE_GUARD', 'common', 'security', 20],
        ['CODE_GUARD', 'uncommon', 'security', 25],
        ['CODE_GUARD', 'rare', 'security', 30],
        ['CODE_GUARD', 'epic', 'security', 35],
        ['CODE_GUARD', 'legendary', 'security', 40],
        ['CIPHER_LINK', 'common', 'hacking', 20],
        ['CIPHER_LINK', 'uncommon', 'hacking', 25],
        ['CIPHER_LINK', 'rare', 'hacking', 31],
        ['CIPHER_LINK', 'epic', 'hacking', 37],
        ['CIPHER_LINK', 'legendary', 'hacking', 45],
    ] as const)(
        '%s %s raises %s by the text percentage of the other stat',
        (key, rarity, stat, pct) => {
            const desc = IMPLANTS[key].variants.find((v) => v.rarity === rarity)?.description ?? '';
            expect(desc).toContain(`${pct}%`);
            const pieces = { u: piece({ id: 'u', setBonus: key, rarity }) };
            const ship = baseShip({
                baseStats: { ...BASE, hacking: 300, security: 200 },
                implants: { implant_ultimate: 'u' },
            });
            const other = stat === 'security' ? 300 : 200;
            const own = stat === 'security' ? 200 : 300;
            expect(statsOf(ship, pieces)[stat]).toBe(Math.round(own + (other * pct) / 100));
        }
    );
});

// ---------------------------------------------------------------------------------------------
// Squad leaders: one fight per pre-fight channel, both sides, stage N against stage N-1 of the
// same leader so the only difference is that stage's line. The lines whose MODEL does not match
// their text are pinned twice: a row holding today's number, and an `it.fails` holding the
// text's number (it passes while the engine diverges and fails once it is fixed). The row is
// what keeps the `it.fails` from passing on a broken board.
// ---------------------------------------------------------------------------------------------

const leader = (
    faction: SquadLeaderSelection['faction'],
    name: string,
    stage: 1 | 2 | 3
): SquadLeaderSelection => ({ faction, name, stage });

interface LeaderRow {
    line: string;
    board: BoardSpec;
    control: BoardSpec;
    check: (withLine: BoardRun, control: BoardRun) => void;
}

const withLeader = (b: BoardSpec, sel?: SquadLeaderSelection): BoardSpec => ({
    ...b,
    playerSquadLeader: sel,
});

/** The same board at two leader stages (or `undefined` for no leader). */
const stagePair = (
    b: BoardSpec,
    faction: SquadLeaderSelection['faction'],
    name: string,
    stage: 1 | 2 | 3,
    controlStage: 1 | 2 | 3 | undefined
): Pick<LeaderRow, 'board' | 'control'> => ({
    board: withLeader(b, leader(faction, name, stage)),
    control: withLeader(b, controlStage ? leader(faction, name, controlStage) : undefined),
});

const solo = (w: Partial<UnitSpec>, o: Partial<UnitSpec>): BoardSpec => ({
    player: [unit('W', 'M4', w)],
    enemy: [unit('O', 'M4', o)],
    rounds: 1,
});

const LEGION_TRIO: BoardSpec = {
    player: [
        unit('W', 'M4', { faction: 'FRONTIER_LEGION' }),
        unit('A', 'M3', IDLE, { faction: 'FRONTIER_LEGION' }),
        unit('B', 'M2', IDLE, { faction: 'FRONTIER_LEGION' }),
    ],
    enemy: [unit('O', 'M4', IDLE)],
    rounds: 1,
};

/** The trio again, but a faster enemy one-shots Legion ally A before W's first turn. */
const LEGION_TRIO_ONE_DIES: BoardSpec = {
    player: [
        unit('W', 'M3', { faction: 'FRONTIER_LEGION' }),
        unit('A', 'M4', IDLE, { faction: 'FRONTIER_LEGION', stats: { hp: 100 } }),
        unit('B', 'M2', IDLE, { faction: 'FRONTIER_LEGION' }),
    ],
    enemy: [unit('O', 'M4', { stats: { speed: 200 } })],
    rounds: 1,
};

const LIEUTENANT_DEFPEN = stagePair(
    solo({ faction: 'FRONTIER_LEGION' }, { ...IDLE, stats: { defence: 5000 } }),
    'FRONTIER_LEGION',
    'Lieutenant',
    2,
    1
);

const INFLICT_TWO_DEBUFFS: Partial<UnitSpec> = {
    active: 'This Unit inflicts <unit-skill>Defense Down II</unit-skill> and <unit-skill>Attack Down II</unit-skill> for 2 turns.',
    stats: { hacking: 1000 },
};

const MEDUSA_REPAIR = stagePair(
    {
        player: [unit('W', 'M4', INFLICT_DEFENSE_DOWN, { faction: 'GELECEK', startHpFrac: 0.5 })],
        enemy: [unit('O', 'M4', IDLE)],
        rounds: 1,
    },
    'GELECEK',
    'Medusa',
    3,
    2
);

/** W's stat sheet at its first turn (the turn's `statsSnapshot`). */
const firstTurnStats = (r: BoardRun, name: string) =>
    r.result.combatLog.flatMap((round) => round.turns).find((t) => t.actorId === r.id(name))
        ?.statsSnapshot;

const LEADER_ROWS: LeaderRow[] = [
    {
        line: 'Xaoc Viper II: +7.5% Outgoing direct damage',
        ...stagePair(solo({ faction: 'XAOC' }, IDLE), 'XAOC', 'Viper', 2, 1),
        check: scales(firstHit('W', 'O'), 1.075),
    },
    {
        line: 'MPL Midas II: -7.5% incoming direct damage',
        ...stagePair(solo({ ...IDLE, faction: 'MPL' }, {}), 'MPL', 'Midas', 2, 1),
        check: scales(firstHit('O', 'W'), 0.925),
    },
    {
        line: 'Terran Architect II: -15% incoming crit damage',
        ...stagePair(
            solo({ ...IDLE, faction: 'TERRAN_COMBINE' }, { stats: { crit: 100, critDamage: 100 } }),
            'TERRAN_COMBINE',
            'Architect',
            2,
            1
        ),
        check: scales(firstHit('O', 'W'), 0.85),
    },
    {
        line: 'Atlas Negotiator II: start combat shielded for 25% of max HP',
        ...stagePair(
            solo({ ...IDLE, faction: 'ATLAS_SYNDICATE' }, {}),
            'ATLAS_SYNDICATE',
            'Negotiator',
            2,
            1
        ),
        // The hit lands on the shield, not HP.
        check: (w, c) => {
            const firstTarget = (r: BoardRun) =>
                entriesOf(r, 'attack', { actor: 'O' })[0].targets.find(
                    (t) => t.targetId === r.id('W')
                );
            expect(firstTarget(c)?.shieldWasHit).toBeFalsy();
            expect(firstTarget(c)?.resultingHpPct).toBeLessThan(100);
            expect(firstTarget(w)?.shieldWasHit).toBe(true);
            expect(firstTarget(w)?.resultingHpPct).toBe(100);
        },
    },
    {
        line: 'Everliving Malachi II: +15% Outgoing repair',
        ...stagePair(
            {
                player: [
                    unit('W', 'M3', REPAIR_OTHERS, { faction: 'EVERLIVING' }),
                    unit('A', 'M4', IDLE),
                ],
                enemy: [unit('O', 'M4', IDLE)],
                rounds: 1,
            },
            'EVERLIVING',
            'Malachi',
            2,
            1
        ),
        check: scales((r) => grossTo(r, 'heal', { actor: 'W', target: 'A' }), 1.15),
    },
    {
        line: 'Legion Colonel III: enemy units lose 15% attack',
        ...stagePair(
            solo({ ...IDLE, faction: 'FRONTIER_LEGION' }, {}),
            'FRONTIER_LEGION',
            'Colonel',
            3,
            2
        ),
        check: scales(firstHit('O', 'W'), 0.85),
    },
    {
        // A percentage-only leader line adds as points, like gear (owner ruling 2026-10-22): a
        // 50% crit-power ship under Negotiator I (+10% attack, +10% crit power) crits for
        // 1100 × 160%.
        line: 'Atlas Negotiator I: +10% Crit Power adds 10 points',
        ...stagePair(
            solo({ faction: 'ATLAS_SYNDICATE', stats: { crit: 100, critDamage: 50 } }, IDLE),
            'ATLAS_SYNDICATE',
            'Negotiator',
            1,
            undefined
        ),
        check: (w, c) => {
            expect(firstHit('W', 'O')(c)).toBeCloseTo(1500, 6);
            expect(firstHit('W', 'O')(w)).toBeCloseTo(1100 * 1.6, 6);
        },
    },
    {
        // "+5% attack for each other alive Legion ally": three Legion ships each get
        // 8% + 2 × 5% = 18% attack.
        line: 'Legion Lieutenant III: +5% attack per other alive Legion ally',
        ...stagePair(LEGION_TRIO, 'FRONTIER_LEGION', 'Lieutenant', 3, 2),
        check: (w, c) =>
            expect(firstHit('W', 'O')(w) / firstHit('W', 'O')(c)).toBeCloseTo(1.18 / 1.08, 6),
    },
    {
        // The count is live: once ally A is destroyed, W has one other Legion ally left and hits
        // with 8% + 5% = 13%.
        line: 'Legion Lieutenant III: the bonus drops when a Legion ally dies',
        ...stagePair(LEGION_TRIO_ONE_DIES, 'FRONTIER_LEGION', 'Lieutenant', 3, 2),
        check: (w, c) => {
            // A dies before W's hit lands, in both arms.
            for (const r of [w, c]) {
                const death = r.entries.findIndex(
                    (e) =>
                        e.kind === 'death' &&
                        (e.actorId === r.id('A') || e.targets.some((t) => t.targetId === r.id('A')))
                );
                const hit = r.entries.indexOf(entriesOf(r, 'attack', { actor: 'W' })[0]);
                expect(death).toBeGreaterThanOrEqual(0);
                expect(death).toBeLessThan(hit);
            }
            expect(firstHit('W', 'O')(w) / firstHit('W', 'O')(c)).toBeCloseTo(1.13 / 1.08, 6);
        },
    },
    {
        // A lone Legion ship has no other Legion ally: stage III adds nothing.
        line: 'Legion Lieutenant III: no bonus without another Legion ally',
        ...stagePair(
            solo({ faction: 'FRONTIER_LEGION' }, IDLE),
            'FRONTIER_LEGION',
            'Lieutenant',
            3,
            2
        ),
        check: scales(firstHit('W', 'O'), 1, 6),
    },
    {
        // Colonel II: 10% + 2 × 7.5% = 25% with two other Legion allies, against Colonel I's 10%.
        line: 'Legion Colonel II: +7.5% attack per other alive Legion ally',
        ...stagePair(LEGION_TRIO, 'FRONTIER_LEGION', 'Colonel', 2, 1),
        check: scales(firstHit('W', 'O'), 1.25 / 1.1, 6),
    },
    {
        // "+8% Defense Penetration" adds 8 points: a ship with none hits a 5,000-defence enemy
        // as if it had 4,600 defence.
        line: 'Legion Lieutenant II: +8% Defense Penetration on a 0-pen ship',
        ...LIEUTENANT_DEFPEN,
        check: scales(
            firstHit('W', 'O'),
            (1 - calculateDamageReduction(5000 * 0.92) / 100) /
                (1 - calculateDamageReduction(5000) / 100),
            6
        ),
    },
    {
        // "Repairs 5% HP after inflicting a debuff on an enemy": a Gelecek ship at half HP that
        // inflicts Defense Down II repairs 5% of its 1,080,000 max HP (Medusa II's +8% HP).
        line: 'Gelecek Medusa III: repairs 5% HP after inflicting a debuff',
        ...MEDUSA_REPAIR,
        check: (w, c) => {
            expect(debuffCount('Defense Down II', 'O')(w)).toBeGreaterThan(0);
            expect(grossTo(c, 'heal', { target: 'W' })).toBe(0);
            expect(entriesOf(w, 'heal', { actor: 'W', target: 'W' })).toHaveLength(1);
            expect(grossTo(w, 'heal', { actor: 'W', target: 'W' })).toBeCloseTo(54_000, 6);
        },
    },
    {
        // One repair per skill cast that lands a debuff, however many it lands: two casts that
        // each land Defense Down II and Attack Down II repair twice, not four times.
        line: 'Gelecek Medusa III: one repair per debuffing cast',
        ...stagePair(
            {
                player: [
                    unit('W', 'M4', INFLICT_TWO_DEBUFFS, { faction: 'GELECEK', startHpFrac: 0.5 }),
                ],
                enemy: [unit('O', 'M4', IDLE)],
                rounds: 2,
            },
            'GELECEK',
            'Medusa',
            3,
            2
        ),
        check: (w, c) => {
            expect(debuffCount('Attack Down II', 'O')(w)).toBe(2);
            expect(debuffCount('Defense Down II', 'O')(w)).toBe(2);
            expect(grossTo(c, 'heal', { target: 'W' })).toBe(0);
            expect(entriesOf(w, 'heal', { actor: 'W', target: 'W' })).toHaveLength(2);
            expect(grossTo(w, 'heal', { actor: 'W', target: 'W' })).toBeCloseTo(108_000, 6);
        },
    },
    {
        // Cerberus II: 7.5% of a 1,100,000 max HP (Cerberus I's +10% HP).
        line: 'Gelecek Cerberus II: repairs 7.5% HP after inflicting a debuff',
        ...stagePair(MEDUSA_REPAIR.board, 'GELECEK', 'Cerberus', 2, 1),
        check: (w, c) => {
            expect(grossTo(c, 'heal', { target: 'W' })).toBe(0);
            expect(grossTo(w, 'heal', { actor: 'W', target: 'W' })).toBeCloseTo(82_500, 6);
        },
    },
    {
        // "Gain security equal to 0.8% of defense": a Binderburg ship with 10,000 defence, raised
        // to 10,800 by Pollinator II, gains 86.4 security.
        line: 'Binderburg Pollinator III: security equal to 0.8% of defence',
        ...stagePair(
            solo({ ...IDLE, faction: 'BINDERBURG', stats: { defence: 10_000 } }, IDLE),
            'BINDERBURG',
            'Pollinator',
            3,
            2
        ),
        check: (w, c) => {
            expect(firstTurnStats(c, 'W')?.defence).toBeCloseTo(10_800, 6);
            expect(firstTurnStats(w, 'W')?.defence).toBeCloseTo(10_800, 6);
            expect(
                (firstTurnStats(w, 'W')?.security ?? 0) - (firstTurnStats(c, 'W')?.security ?? 0)
            ).toBeCloseTo(86.4, 6);
        },
    },
    {
        // Swarmcaller II: 1.2% of 11,000 defence (Swarmcaller I's +10%) = 132 security.
        line: 'Binderburg Swarmcaller II: security equal to 1.2% of defence',
        ...stagePair(
            solo({ ...IDLE, faction: 'BINDERBURG', stats: { defence: 10_000 } }, IDLE),
            'BINDERBURG',
            'Swarmcaller',
            2,
            1
        ),
        check: (w, c) =>
            expect(
                (firstTurnStats(w, 'W')?.security ?? 0) - (firstTurnStats(c, 'W')?.security ?? 0)
            ).toBeCloseTo(132, 6),
    },
    {
        // "+10% outgoing crit damage while in Stealth": a Tianchao ship that starts the fight
        // Stealthed (Cloaking) crits 10% harder.
        line: 'Tianchao Cipher III: +10% crit damage while in Stealth',
        ...stagePair(
            solo(
                {
                    faction: 'TIANCHAO',
                    stats: { crit: 100, critDamage: 50 },
                    set: { name: 'CLOAKING', pieces: 2 },
                },
                IDLE
            ),
            'TIANCHAO',
            'Cipher',
            3,
            2
        ),
        check: (w, c) => {
            expect(buffCount('Stealth', 'W')(w)).toBe(1);
            expect(firstHit('W', 'O')(w) / firstHit('W', 'O')(c)).toBeCloseTo(1.1, 6);
        },
    },
    {
        // Without Stealth the line does nothing.
        line: 'Tianchao Cipher III: no bonus outside Stealth',
        ...stagePair(
            solo({ faction: 'TIANCHAO', stats: { crit: 100, critDamage: 50 } }, IDLE),
            'TIANCHAO',
            'Cipher',
            3,
            2
        ),
        check: scales(firstHit('W', 'O'), 1, 6),
    },
    {
        // Serpent II: +15%.
        line: 'Tianchao Serpent II: +15% crit damage while in Stealth',
        ...stagePair(
            solo(
                {
                    faction: 'TIANCHAO',
                    stats: { crit: 100, critDamage: 50 },
                    set: { name: 'CLOAKING', pieces: 2 },
                },
                IDLE
            ),
            'TIANCHAO',
            'Serpent',
            2,
            1
        ),
        check: scales(firstHit('W', 'O'), 1.15, 6),
    },
];

describe('non-kit census: squad leaders', () => {
    for (const row of LEADER_ROWS) {
        for (const side of ['player', 'enemy'] as const) {
            it(`${row.line} — ${side}-side leader`, () => {
                const orient = (b: BoardSpec) => (side === 'player' ? b : mirrorBoard(b));
                row.check(
                    runForcedBattle(orient(row.board), true),
                    runForcedBattle(orient(row.control), true)
                );
            });
        }
    }
});
