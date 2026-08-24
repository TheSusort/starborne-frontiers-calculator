/**
 * boostGearSet.integration.test.ts
 *
 * End-to-end integration tests for the BOOST gear set (4-piece): every TIMED, SELF-SIDE buff
 * the wearer APPLIES lasts +1 turn (caster-side). Enemy debuffs and non-finite buffs are excluded.
 *
 * These tests route through the REAL registry path — NOT a hand-rolled BOOST ability:
 *   - ships are built with 4 real BOOST gear pieces (`setBonus:'BOOST'`) + a `getGearPiece` lookup,
 *   - `buildShipAbilitiesWithEquipment(ship, getGearPiece)` merges GEAR_SET_ABILITIES.BOOST into the
 *     passive slot (`config:{ type:'buff-duration-extension', turns:1 }`),
 *   - the engine (`buildBuffDurationExtensionByOwner` → `buffDurationExtensionFor`) feeds the
 *     status engine, which adds +1 to the wearer's self-side timed buffs.
 * A broken wiring anywhere on that chain (registry → engine → status-engine seam) fails these tests.
 *
 * For every with-vs-without comparison the SAME ship/scenario is built twice, differing ONLY by
 * whether 4 BOOST pieces are equipped, so the delta is unambiguously Boost.
 *
 * Test A (sim) and Test C/D (DPS) both run the SAME combat loop (`runCombat`): the battle simulator
 * and the DPS simulator are two adapters over it. `simulateBattle` is used where a board-positioned
 * self-buff window is the cleanest read; `simulateDPS` is used where the engine's per-round
 * `activeEnemyDebuffs` expiry window or a damage total is the cleanest read.
 */
import { describe, it, expect } from 'vitest';
import { simulateBattle, BattlePlacement } from '../../calculators/battleSimulator';
import { simulateDPS } from '../../calculators/dpsSimulator';
import { buildShipAbilitiesWithEquipment } from '../../abilities/buildShipAbilitiesWithEquipment';
import { Ship, AffinityName } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { GEAR_SETS } from '../../../constants/gearSets';
import type { Position } from '../../../types/encounters';

// ---------------------------------------------------------------------------
// Harness helpers (mirrored from reflectGearSet.integration.test.ts)
// ---------------------------------------------------------------------------

function makePiece(over: Partial<GearPiece>): GearPiece {
    return {
        id: 'piece-1',
        slot: 'weapon',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: null,
        subStats: [],
        setBonus: null,
        ...over,
    };
}

/** BOOST pieces equipping the wearer with `minPieces` (4) of the set across distinct slots. */
const BOOST_SLOTS = ['weapon', 'hull', 'sensor', 'engine', 'shield', 'computer'] as const;
function boostPieces(): GearPiece[] {
    const minPieces = GEAR_SETS['BOOST']?.minPieces ?? 4;
    const out: GearPiece[] = [];
    for (let i = 0; i < minPieces; i++) {
        out.push(
            makePiece({
                id: `BOOST-${i}`,
                slot: BOOST_SLOTS[i % BOOST_SLOTS.length],
                setBonus: 'BOOST',
            })
        );
    }
    return out;
}

/** id→GearPiece lookup for every piece used across the placements. */
function getGearPieceFor(pieces: GearPiece[]): (id: string) => GearPiece | undefined {
    const map: Record<string, GearPiece> = {};
    for (const p of pieces) map[p.id] = p;
    return (id) => map[id];
}

/**
 * A ship whose ACTIVE skill is a plain 100% direct hit and whose CHARGED skill ALSO grants a
 * self-buff. With a low chargeCount the charged skill fires periodically (not every turn), so the
 * granted buff has DOWNTIME between applications — the window where Boost's +1 turn is observable.
 */
function makeShip(
    id: string,
    affinity: AffinityName,
    pieces: GearPiece[],
    opts: { activeText: string; chargedText: string; chargeCount: number }
): Ship {
    const equipment: Record<string, string> = {};
    for (const p of pieces) equipment[p.slot] = p.id;
    return {
        id,
        name: id,
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'ATTACKER',
        baseStats: {} as Ship['baseStats'],
        equipment: equipment,
        implants: {},
        refits: [],
        affinity,
        activeSkillText: opts.activeText,
        chargeSkillText: opts.chargedText,
        chargeSkillCharge: opts.chargeCount,
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    } as Partial<Ship> as Ship;
}

const place = (
    ship: Ship,
    position: Position,
    overrides: Partial<BattlePlacement['statOverrides']> = {}
): BattlePlacement => ({
    ship,
    position,
    statOverrides: {
        attack: 5000,
        crit: 0,
        critDamage: 0,
        defensePenetration: 0,
        hacking: 200,
        defence: 0,
        hp: 1_000_000,
        ...overrides,
    },
});

const PLAIN_HIT = 'This Unit deals <unit-damage>100% damage</unit-damage>.';

/** Whether the focus player wearer (reserved id 'attacker') has `buffName` active in a round. */
function wearerHasBuff(
    result: ReturnType<typeof simulateBattle>,
    round: number,
    buffName: string
): boolean {
    const r = result.rounds.find((x) => x.round === round);
    if (!r) return false;
    const s = r.ships.find((sh) => sh.actorId === 'attacker');
    return !!s && s.activeBuffs.includes(buffName);
}

/**
 * Build the wearer's full ShipSkills through the REAL registry: equip `pieces`, route through
 * buildShipAbilitiesWithEquipment so the BOOST passive (when ≥4 pieces) lands in the passive slot.
 */
function registrySkills(
    pieces: GearPiece[],
    opts: { activeText: string; chargedText: string; chargeCount: number }
) {
    const ship = makeShip('attacker', 'thermal', pieces, opts);
    return buildShipAbilitiesWithEquipment(ship, getGearPieceFor(pieces));
}

// ---------------------------------------------------------------------------
// Test A — self-buff extended (combat sim)
// ---------------------------------------------------------------------------

describe('BOOST gear set — self-buff extended (combat sim)', () => {
    it('(A) the wearer self-buff stays active one round LONGER with 4 BOOST pieces', () => {
        // Wearer's CHARGED skill grants itself Attack Up III for 2 turns. chargeCount 2 → the
        // charged skill fires on round 3 (banks charge on rounds 1-2). The granted buff is applied
        // ONCE there and then left to decay — no re-application on the in-between active rounds, so
        // the +1 turn is directly observable.
        //
        // A self-buff applied during the carrier's OWN turn gets a one-turn reprieve (it lasts
        // through one additional of the carrier's turns), which lifts BOTH baselines by +1:
        //   Base duration 2 → present rounds 3 AND 4 (reprieved tail), expires round 4.
        //   With Boost: duration 2 + 1 = 3 → present rounds 3, 4 AND 5 (Boost tail + reprieve).
        // Round 5 is the unambiguous delta (an active round — the buff is NOT re-applied there,
        // so its presence is purely the Boost-extended tail). BOOST still yields exactly ONE more
        // round than non-Boost; the reprieve moved both windows but preserved the +1 from BOOST.
        const chargedText =
            'This Unit deals <unit-damage>100% damage</unit-damage> and gains <unit-skill>Attack Up III</unit-skill> for 2 turns.';
        const opts = { activeText: PLAIN_HIT, chargedText, chargeCount: 2 };

        const pieces = boostPieces();
        const withBoost = simulateBattle(
            {
                playerTeam: [place(makeShip('wearer', 'thermal', pieces, opts), 'M4')],
                enemyTeam: [
                    place(
                        makeShip('foe', 'antimatter', [], {
                            activeText: PLAIN_HIT,
                            chargedText: PLAIN_HIT,
                            chargeCount: 99,
                        }),
                        'M4'
                    ),
                ],
                rounds: 8,
            },
            getGearPieceFor(pieces)
        );

        // Control: identical scenario, NO BOOST pieces (empty lookup → no set ability built).
        const noBoost = simulateBattle(
            {
                playerTeam: [place(makeShip('wearer', 'thermal', [], opts), 'M4')],
                enemyTeam: [
                    place(
                        makeShip('foe', 'antimatter', [], {
                            activeText: PLAIN_HIT,
                            chargedText: PLAIN_HIT,
                            chargeCount: 99,
                        }),
                        'M4'
                    ),
                ],
                rounds: 8,
            },
            getGearPieceFor([])
        );

        // Round 3 (the application round): the buff lands in BOTH runs — proves the buff exists.
        expect(wearerHasBuff(withBoost, 3, 'Attack Up III')).toBe(true);
        expect(wearerHasBuff(noBoost, 3, 'Attack Up III')).toBe(true);

        // Round 4 (the reprieved tail): present in BOTH runs now — the own-turn reprieve lifts
        // both baselines by one round, so round 4 no longer distinguishes Boost from non-Boost.
        expect(wearerHasBuff(withBoost, 4, 'Attack Up III')).toBe(true);
        expect(wearerHasBuff(noBoost, 4, 'Attack Up III')).toBe(true);

        // Round 5 (the Boost-extended tail): present ONLY with Boost. This is the unambiguous +1
        // turn from BOOST. Non-vacuous: the without-Boost branch is FALSE here, so the assertion
        // would fail if Boost did nothing.
        expect(wearerHasBuff(withBoost, 5, 'Attack Up III')).toBe(true);
        expect(wearerHasBuff(noBoost, 5, 'Attack Up III')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Test B — registry shape (mutation guard)
// ---------------------------------------------------------------------------

describe('BOOST gear set — registry shape (mutation guard)', () => {
    it('(B) a 4-BOOST ship yields a passive buff-duration-extension ability via the real registry', () => {
        // Proves the test's gear actually routes through the real registry → engine wiring. If the
        // registry entry is removed/altered, this fails and every comparison below loses its basis.
        const pieces = boostPieces();
        const skills = registrySkills(pieces, {
            activeText: PLAIN_HIT,
            chargedText: PLAIN_HIT,
            chargeCount: 2,
        });
        const passive = skills.slots.find((s) => s.slot === 'passive');
        expect(passive).toBeDefined();
        const boostAbility = passive!.abilities.find((a) => a.id === 'equip-set-BOOST');
        expect(boostAbility).toBeDefined();
        expect(boostAbility!.config).toEqual({ type: 'buff-duration-extension', turns: 1 });

        // Control: a ship with NO BOOST pieces yields no such ability (the +1 has no source).
        const noBoostSkills = registrySkills([], {
            activeText: PLAIN_HIT,
            chargedText: PLAIN_HIT,
            chargeCount: 2,
        });
        const noBoostPassive = noBoostSkills.slots.find((s) => s.slot === 'passive');
        const noBoostAbility = noBoostPassive?.abilities.find((a) => a.id === 'equip-set-BOOST');
        expect(noBoostAbility).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Test C — enemy debuff NOT extended (DPS path)
// ---------------------------------------------------------------------------

describe('BOOST gear set — enemy debuff NOT extended', () => {
    it('(C) a timed debuff the BOOST wearer inflicts on an enemy keeps the SAME duration', () => {
        // Enemy debuffs land enemy-side and are explicitly excluded from Boost. The wearer's CHARGED
        // skill inflicts Attack Down II for 2 turns on the enemy; startCharged + a huge chargeCount
        // fires it ONCE (round 1) and never again, so the debuff window is observable as it decays.
        //
        // simulateDPS surfaces a proper enemy-debuff expiry window via `activeEnemyDebuffs` (the
        // battle simulator's activeDebuffs is infliction-only and never clears, so it cannot show a
        // duration). Routed through the REAL registry shipSkills.
        const chargedText =
            'This Unit deals <unit-damage>100% damage</unit-damage> and inflicts <unit-skill>Attack Down II</unit-skill> for 2 turns.';
        const opts = { activeText: PLAIN_HIT, chargedText, chargeCount: 99 };

        const base = {
            attack: 5000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 99,
            enemyDefense: 0,
            enemyHp: 1_000_000_000_000,
            rounds: 6,
            selfBuffs: [],
            enemyDebuffs: [],
            startCharged: true,
        };

        const withBoost = simulateDPS({ ...base, shipSkills: registrySkills(boostPieces(), opts) });
        const noBoost = simulateDPS({ ...base, shipSkills: registrySkills([], opts) });

        const debuffActive = (
            res: ReturnType<typeof simulateDPS>,
            round: number,
            name: string
        ): boolean => {
            const r = res.rounds.find((x) => x.round === round);
            return !!r && r.activeEnemyDebuffs.some((b) => b.buffName === name);
        };

        // Pre-condition: the debuff actually landed (round 1) in BOTH runs — non-trivial scenario.
        expect(debuffActive(withBoost, 1, 'Attack Down II')).toBe(true);
        expect(debuffActive(noBoost, 1, 'Attack Down II')).toBe(true);

        // The debuff window is IDENTICAL with and without Boost: present rounds 1-2, gone round 3.
        // Boost does NOT add the +1 it would add to a self-side buff (enemy debuffs are excluded).
        for (const round of [1, 2, 3, 4]) {
            expect(debuffActive(withBoost, round, 'Attack Down II')).toBe(
                debuffActive(noBoost, round, 'Attack Down II')
            );
        }
        // Explicit boundary: gone by round 3 in BOTH runs (no second-turn extension from Boost).
        expect(debuffActive(withBoost, 3, 'Attack Down II')).toBe(false);
        expect(debuffActive(noBoost, 3, 'Attack Down II')).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Test D — DPS higher with Boost (DPS path)
// ---------------------------------------------------------------------------

describe('BOOST gear set — DPS higher with extended self-buff', () => {
    it('(D) a self-buffing attacker deals strictly MORE direct damage with 4 BOOST pieces', () => {
        // Fixture: the CHARGED skill grants Attack Up III (a damage-relevant attack buff) for 2
        // turns; startCharged + a huge chargeCount fires it ONCE (round 1) so the buff DECAYS rather
        // than being refreshed every turn — without decay, uptime would be 100% with or without
        // Boost and the +1 turn would be invisible. With 8 rounds the extra (3rd) turn of the buff
        // lands well inside the horizon, so the extended uptime translates into more direct damage.
        // (Affinity is neutral-to-self in the DPS path; the only difference between runs is Boost.)
        const chargedText =
            'This Unit deals <unit-damage>100% damage</unit-damage> and gains <unit-skill>Attack Up III</unit-skill> for 2 turns.';
        const opts = { activeText: PLAIN_HIT, chargedText, chargeCount: 99 };

        const base = {
            attack: 5000,
            crit: 0,
            critDamage: 0,
            defensePenetration: 0,
            chargeCount: 99,
            enemyDefense: 0,
            enemyHp: 1_000_000_000_000,
            rounds: 8,
            selfBuffs: [],
            enemyDebuffs: [],
            startCharged: true,
        };

        const withBoost = simulateDPS({ ...base, shipSkills: registrySkills(boostPieces(), opts) });
        const noBoost = simulateDPS({ ...base, shipSkills: registrySkills([], opts) });

        // Both runs deal real direct damage (non-trivial fixture).
        expect(noBoost.summary.totalDirectDamage).toBeGreaterThan(0);
        // Strictly greater WITH Boost: the extended Attack Up III adds one more buffed turn of
        // direct damage. Non-vacuous: with == without would fail this assertion.
        expect(withBoost.summary.totalDirectDamage).toBeGreaterThan(
            noBoost.summary.totalDirectDamage
        );
    });
});
