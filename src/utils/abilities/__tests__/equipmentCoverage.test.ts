/**
 * equipmentCoverage.test.ts
 *
 * Documents CURRENT buildEquipmentAbilities coverage across the full IMPLANTS +
 * GEAR_SETS corpus.  The intent is a living regression guard: when new effects are
 * added, this file is updated deliberately so reviewers can see coverage grow.
 *
 * D-PR2 added the outgoing-damage / conditional-damage family
 * (INTRUSION, ARCANE_SIEGE, WARPSTRIKE + LEECH gear set).
 * D-PR3 added the incoming-reduction / block family
 * (VOIDSHADE, NEBULA_NULLIFIER, HYPERION_GAZE, VORTEX_VEIL, IRONCLAD, SHADOWGUARD
 * implants + HARDENED gear set).
 * D-PR4 added outgoing-amplification (MENACE, GIANT_SLAYER, INSIDIOUSNESS).
 * D-PR5 added the reactive-heal family
 * (SECOND_WIND, NOURISHMENT, VIVACIOUS_REPAIR implants).
 * D-PR6 added repair-amplification (EXUBERANCE).
 * D-PR7 added the on-death family (LAST_WISH, BATTLECRY, MARTYRDOM).
 * D-PR8 added reactive self-buffs (SYNAPTIC_RESONANCE, ALACRITY, AMBUSH).
 * D-PR9 added ally-wide / new-trigger buff grants (SPEARHEAD, FONT_OF_POWER).
 * D-PR11 added adjacent-ally buff grant (FORTIFYING_SHROUD).
 * D-PR14 added Provoke/Concentrate Fire debuff grants (BULWARK, DOOMSAYER).
 * Gear-set DoT pair added BURNER (on-cast Inferno) + DECIMATION (dotDamage modifier) gear sets.
 * Reflect/Revenge/Smokescreen PR added the REVENGE gear set (missing-HP outgoingDamage scaling)
 * and the SMOKESCREEN implant (on-attacked reactive Stealth self-buff).
 *
 * Assertions are plain `expect` calls — no snapshot files.
 */

import { describe, it, expect } from 'vitest';
import { buildEquipmentAbilities } from '../buildEquipmentAbilities';
import { GEAR_SETS } from '../../../constants/gearSets';
import { IMPLANTS } from '../../../constants/implants';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';

// ---------------------------------------------------------------------------
// Minimal fixture helpers
// ---------------------------------------------------------------------------

function makeShip(over: Partial<Ship>): Ship {
    return {
        id: 'coverage-ship',
        name: 'Coverage Ship',
        rarity: 'legendary',
        faction: 'AURELIAN_SOVEREIGNTY',
        type: 'ATTACKER',
        baseStats: {} as Ship['baseStats'],
        equipment: {},
        implants: {},
        refits: [],
        ...over,
    } as Ship;
}

function makePiece(over: Partial<GearPiece>): GearPiece {
    return {
        id: 'piece',
        slot: 'weapon',
        level: 16,
        stars: 6,
        rarity: 'legendary',
        mainStat: null,
        subStats: [],
        setBonus: null,
        ...over,
    } as GearPiece;
}

/**
 * Build a minimal ship equipping enough pieces of a gear set (≥ its minPieces)
 * and return the ability count produced by buildEquipmentAbilities.
 */
function gearSetAbilityCount(setKey: string): number {
    const setDef = GEAR_SETS[setKey];
    const minPieces = setDef?.minPieces ?? 2;

    // Gear slot names used in the test — just need enough distinct slots.
    const slots = ['weapon', 'hull', 'sensor', 'engine', 'shield', 'computer'] as const;
    const equipment: Record<string, string> = {};
    const pieceMap: Record<string, GearPiece> = {};

    for (let i = 0; i < minPieces; i++) {
        const id = `${setKey}-piece-${i}`;
        const slot = slots[i % slots.length];
        equipment[slot] = id;
        pieceMap[id] = makePiece({ id, slot, setBonus: setKey });
    }

    const ship = makeShip({ equipment });
    return buildEquipmentAbilities(ship, (id) => pieceMap[id]).length;
}

/**
 * Build a minimal ship equipping one implant piece (at the given rarity) and
 * return the ability count produced by buildEquipmentAbilities.
 */
function implantAbilityCount(implantKey: string, rarity: GearPiece['rarity']): number {
    const id = `${implantKey}-piece`;
    const pieceMap: Record<string, GearPiece> = {
        [id]: makePiece({ id, slot: 'implant_major', rarity, setBonus: implantKey }),
    };
    const ship = makeShip({ implants: { implant_major: id } });
    return buildEquipmentAbilities(ship, (gearId) => pieceMap[gearId]).length;
}

/**
 * Build a minimal ship equipping one implant piece (at the given rarity) and
 * return the built abilities produced by buildEquipmentAbilities (for shape assertions).
 */
function implantAbilities(implantKey: string, rarity: string) {
    const id = `${implantKey}-piece`;
    const pieceMap: Record<string, GearPiece> = {
        [id]: makePiece({ id, slot: 'implant_major', rarity, setBonus: implantKey }),
    };
    const ship = makeShip({ implants: { implant_major: id } });
    return buildEquipmentAbilities(ship, (gearId) => pieceMap[gearId]);
}

// ---------------------------------------------------------------------------
// Regression guard: implemented effect names must equal exactly this set.
// Update deliberately when new effects are added.
// ---------------------------------------------------------------------------

describe('equipmentCoverage — implemented effects registry', () => {
    it('exactly { BURNER + DECIMATION + LEECH + REFLECT + CLOAKING + HARDENED + REVENGE + SHIELD (gear sets), MARTYRDOM + ARCANE_SIEGE + CHRONO_REAVER + HYPERION_GAZE + INTRUSION + LIFELINE + NEBULA_NULLIFIER + NOURISHMENT + SMOKESCREEN + SYNAPTIC_RESONANCE + VOIDFIRE_CATALYST + VOIDSHADE + VORTEX_VEIL + WARPSTRIKE + ALACRITY + AMBUSH + BATTLECRY + BLOODTHIRST + BULWARK + DOOMSAYER + EXUBERANCE + FIREWALL + FONT_OF_POWER + FORTIFYING_SHROUD + GIANT_SLAYER + INSIDIOUSNESS + IRONCLAD + LAST_STAND + LAST_WISH + LOCKDOWN + MENACE + REACTIVE_WARD + SECOND_WIND + SHADOWGUARD + SPEARHEAD + TENACITY + VIVACIOUS_REPAIR (implants) } are currently implemented', () => {
        // Gear sets with an ability builder
        const implementedSets = Object.keys(GEAR_SETS).filter(
            (key) => gearSetAbilityCount(key) > 0
        );
        expect(implementedSets).toEqual([
            'BURNER',
            'DECIMATION',
            'LEECH',
            'REFLECT',
            'REVENGE',
            'SHIELD',
            'CLOAKING',
            'HARDENED',
        ]);

        // Implants with an ability builder (check each implant with a rarity that exists)
        const implementedImplants = Object.keys(IMPLANTS).filter((key) => {
            const variants = IMPLANTS[key].variants;
            // Try the first available rarity for each implant.
            return variants.some((v) => implantAbilityCount(key, v.rarity) > 0);
        });
        expect(implementedImplants).toEqual([
            'MARTYRDOM',
            'ABUNDANT_RENEWAL',
            'ARCANE_SIEGE',
            'CHRONO_REAVER',
            'HYPERION_GAZE',
            'INTRUSION',
            'LIFELINE',
            'NEBULA_NULLIFIER',
            'NOURISHMENT',
            'SYNAPTIC_RESONANCE',
            'VOIDFIRE_CATALYST',
            'VOIDSHADE',
            'VORTEX_VEIL',
            'WARPSTRIKE',
            'ADAPTIVE_PLATING',
            'ALACRITY',
            'AMBUSH',
            'BATTLECRY',
            'BLOODTHIRST',
            'BULWARK',
            'DOOMSAYER',
            'EXUBERANCE',
            'FIREWALL',
            'FONT_OF_POWER',
            'FORTIFYING_SHROUD',
            'GIANT_SLAYER',
            'INSIDIOUSNESS',
            'IRONCLAD',
            'LAST_STAND',
            'LAST_WISH',
            'LOCKDOWN',
            'MENACE',
            'REACTIVE_WARD',
            'RESONATING_FURY',
            'SECOND_WIND',
            'SHADOWGUARD',
            'SMOKESCREEN',
            'SPEARHEAD',
            'TENACITY',
            'VIVACIOUS_REPAIR',
        ]);
    });
});

// ---------------------------------------------------------------------------
// Gear-set coverage: one assertion per set
// ---------------------------------------------------------------------------

const IMPLEMENTED_SETS = new Set([
    'BURNER',
    'DECIMATION',
    'LEECH',
    'REFLECT',
    'REVENGE',
    'CLOAKING',
    'HARDENED',
    'SHIELD',
]);

describe('equipmentCoverage — gear sets', () => {
    it('BURNER produces exactly 1 ability (the on-cast inferno)', () => {
        expect(gearSetAbilityCount('BURNER')).toBe(1);
    });

    it('DECIMATION produces exactly 1 ability (the dotDamage modifier)', () => {
        expect(gearSetAbilityCount('DECIMATION')).toBe(1);
    });

    it('LEECH produces exactly 1 ability (the standing leech)', () => {
        expect(gearSetAbilityCount('LEECH')).toBe(1);
    });

    it('HARDENED produces exactly 1 ability (incoming-reduction)', () => {
        expect(gearSetAbilityCount('HARDENED')).toBe(1);
    });

    it('REFLECT produces exactly 1 ability (the damage-reflection config)', () => {
        expect(gearSetAbilityCount('REFLECT')).toBe(1);
    });

    it('REFLECT produces an ability with id equip-set-REFLECT, config.type damage-reflection, config.pct 10', () => {
        const minPieces = GEAR_SETS['REFLECT']?.minPieces ?? 2;
        const slots = ['weapon', 'hull', 'sensor', 'engine', 'shield', 'computer'] as const;
        const equipment: Record<string, string> = {};
        const pieceMap: Record<string, GearPiece> = {};
        for (let i = 0; i < minPieces; i++) {
            const id = `REFLECT-piece-${i}`;
            const slot = slots[i % slots.length];
            equipment[slot] = id;
            pieceMap[id] = makePiece({ id, slot, setBonus: 'REFLECT' });
        }
        const ship = makeShip({ equipment });
        const abilities = buildEquipmentAbilities(ship, (id) => pieceMap[id]);
        const reflect = abilities.find((a) => a.id === 'equip-set-REFLECT');
        expect(reflect).toBeDefined();
        expect(reflect!.config.type).toBe('damage-reflection');
        // @ts-expect-error damage-reflection config
        expect(reflect!.config.pct).toBe(10);
    });

    it('REVENGE produces 1 ability (outgoingDamage modifier scaling on missing HP)', () => {
        expect(gearSetAbilityCount('REVENGE')).toBe(1);
    });

    it('CLOAKING produces exactly 1 ability (the Stealth grant)', () => {
        expect(gearSetAbilityCount('CLOAKING')).toBe(1);
    });

    it('CLOAKING produces a once-per-combat 2-turn Stealth self-buff on start-of-round', () => {
        const minPieces = GEAR_SETS['CLOAKING']?.minPieces ?? 2;
        const slots = ['weapon', 'hull', 'sensor', 'engine', 'shield', 'computer'] as const;
        const equipment: Record<string, string> = {};
        const pieceMap: Record<string, GearPiece> = {};
        for (let i = 0; i < minPieces; i++) {
            const id = `CLOAKING-piece-${i}`;
            const slot = slots[i % slots.length];
            equipment[slot] = id;
            pieceMap[id] = makePiece({ id, slot, setBonus: 'CLOAKING' });
        }
        const ship = makeShip({ equipment });
        const abilities = buildEquipmentAbilities(ship, (id) => pieceMap[id]);
        const cloak = abilities.find((a) => a.id === 'equip-set-CLOAKING');
        expect(cloak).toBeDefined();
        expect(cloak!.type).toBe('buff');
        expect(cloak!.target).toBe('self');
        expect(cloak!.trigger).toBe('start-of-round');
        expect(cloak!.config.type).toBe('buff');
        // @ts-expect-error buff config
        expect(cloak!.config.buffName).toBe('Stealth');
        // @ts-expect-error buff config
        expect(cloak!.config.duration).toBe(2);
        // @ts-expect-error buff config
        expect(cloak!.config.oncePerCombat).toBe(true);
    });

    it('SHIELD produces exactly 1 ability (the start-of-turn self shield)', () => {
        expect(gearSetAbilityCount('SHIELD')).toBe(1);
    });

    it('SHIELD produces a start-of-turn self shield of 4% caster max HP', () => {
        const minPieces = GEAR_SETS['SHIELD']?.minPieces ?? 2;
        const slots = ['weapon', 'hull', 'sensor', 'engine', 'shield', 'computer'] as const;
        const equipment: Record<string, string> = {};
        const pieceMap: Record<string, GearPiece> = {};
        for (let i = 0; i < minPieces; i++) {
            const id = `SHIELD-piece-${i}`;
            equipment[slots[i % slots.length]] = id;
            pieceMap[id] = makePiece({ id, slot: slots[i % slots.length], setBonus: 'SHIELD' });
        }
        const ship = makeShip({ equipment });
        const abilities = buildEquipmentAbilities(ship, (id) => pieceMap[id]);
        const sh = abilities.find((a) => a.id === 'equip-set-SHIELD');
        expect(sh).toBeDefined();
        expect(sh!.type).toBe('shield');
        expect(sh!.target).toBe('self');
        expect(sh!.trigger).toBe('start-of-turn');
        expect(sh!.config.type).toBe('shield');
        // @ts-expect-error shield config
        expect(sh!.config.pct).toBe(4);
        // @ts-expect-error shield config
        expect(sh!.config.basis).toBe('hp');
    });

    const unimplementedSets = Object.keys(GEAR_SETS).filter((k) => !IMPLEMENTED_SETS.has(k));
    for (const setKey of unimplementedSets) {
        it(`${setKey} produces 0 abilities (not yet implemented)`, () => {
            expect(gearSetAbilityCount(setKey)).toBe(0);
        });
    }
});

// ---------------------------------------------------------------------------
// Implant coverage: one assertion per implant
// ---------------------------------------------------------------------------

describe('equipmentCoverage — implants', () => {
    it('BLOODTHIRST (uncommon) produces >= 1 ability (on-crit heal)', () => {
        expect(implantAbilityCount('BLOODTHIRST', 'uncommon')).toBeGreaterThanOrEqual(1);
    });

    it('BLOODTHIRST (epic) produces >= 1 ability (on-crit heal)', () => {
        expect(implantAbilityCount('BLOODTHIRST', 'epic')).toBeGreaterThanOrEqual(1);
    });

    it('BLOODTHIRST (legendary) produces >= 1 ability (on-crit heal)', () => {
        expect(implantAbilityCount('BLOODTHIRST', 'legendary')).toBeGreaterThanOrEqual(1);
    });

    // D-PR2: INTRUSION, ARCANE_SIEGE, WARPSTRIKE now produce 1 ability each.
    // D-PR3: VOIDSHADE, NEBULA_NULLIFIER, HYPERION_GAZE, VORTEX_VEIL, IRONCLAD, SHADOWGUARD added.
    // D-PR4: MENACE, GIANT_SLAYER, INSIDIOUSNESS added (outgoing-amplification on-crit / vs higher-attack / on-debuff).
    // D-PR5: SECOND_WIND, NOURISHMENT, VIVACIOUS_REPAIR added (reactive-heal family).
    // D-PR6: EXUBERANCE added (repair-amplification on-repair chance).
    // D-PR7: LAST_WISH, BATTLECRY, MARTYRDOM added (on-death repair / buff to allies / disable killer).
    // D-PR8: SYNAPTIC_RESONANCE, ALACRITY, AMBUSH added (reactive self-buff grants).
    // D-PR14: BULWARK, DOOMSAYER added (Provoke / Concentrate Fire debuff grants).
    // D-PR16: FIREWALL added (on-debuffed → self Block Debuff grant).
    // D-PR16: LOCKDOWN added (on-debuff-resisted → all-ally Buff Protection grant).
    // D-PR16: TENACITY added (on-attacked >25%-max-HP → all-ally Buff Protection grant).
    // D-PR16: LAST_STAND added (on-ally-destroyed + last-standing → self Barrier + Block Debuff co-grant).
    // Reactive cleanse PR: REACTIVE_WARD added (reactive cleanse on-attacked, crit-count branch).
    //         WARPSTRIKE gains a second ability (reduce-duration cleanse on-deal-damage).
    // Phase 2-3: CHRONO_REAVER added (end-of-turn periodic self-charge; epic=every 3rd, legendary=every 2nd).
    const implementedImplants = new Set([
        'ABUNDANT_RENEWAL',
        'ADAPTIVE_PLATING',
        'LIFELINE',
        'FIREWALL',
        'LOCKDOWN',
        'TENACITY',
        'LAST_STAND',
        'BLOODTHIRST',
        'INTRUSION',
        'ARCANE_SIEGE',
        'CHRONO_REAVER',
        'WARPSTRIKE',
        'VOIDSHADE',
        'NEBULA_NULLIFIER',
        'HYPERION_GAZE',
        'VORTEX_VEIL',
        'IRONCLAD',
        'SHADOWGUARD',
        'SMOKESCREEN',
        'MENACE',
        'GIANT_SLAYER',
        'INSIDIOUSNESS',
        'SECOND_WIND',
        'NOURISHMENT',
        'VIVACIOUS_REPAIR',
        'EXUBERANCE',
        'LAST_WISH',
        'BATTLECRY',
        'MARTYRDOM',
        'SYNAPTIC_RESONANCE',
        'VOIDFIRE_CATALYST',
        'ALACRITY',
        'AMBUSH',
        'SPEARHEAD',
        'FONT_OF_POWER',
        'FORTIFYING_SHROUD',
        'BULWARK',
        'DOOMSAYER',
        'REACTIVE_WARD',
        'RESONATING_FURY',
    ]);

    it('INTRUSION produces 1 ability per rarity (outgoingDamage modifier with scaling)', () => {
        const variants = IMPLANTS['INTRUSION'].variants;
        for (const v of variants) {
            expect(implantAbilityCount('INTRUSION', v.rarity)).toBe(1);
        }
    });

    it('ARCANE_SIEGE produces 1 ability per rarity (outgoingDamage modifier gated on self-shield)', () => {
        const variants = IMPLANTS['ARCANE_SIEGE'].variants;
        for (const v of variants) {
            expect(implantAbilityCount('ARCANE_SIEGE', v.rarity)).toBe(1);
        }
    });

    // Phase 2-3: periodic self-charge (end-of-turn + every-n-turns gate)
    it('CHRONO_REAVER produces 1 ability for epic + legendary (periodic self-charge); 0 for other rarities', () => {
        // Only epic and legendary variants exist in implants.ts — no common/uncommon/rare.
        expect(implantAbilityCount('CHRONO_REAVER', 'epic')).toBe(1);
        expect(implantAbilityCount('CHRONO_REAVER', 'legendary')).toBe(1);
    });

    it('WARPSTRIKE produces 2 abilities per rarity (outgoingDamage modifier + reduce-duration cleanse, gated on self-debuff)', () => {
        const variants = IMPLANTS['WARPSTRIKE'].variants;
        for (const v of variants) {
            expect(implantAbilityCount('WARPSTRIKE', v.rarity)).toBe(2);
        }
    });

    // D-PR3: incoming-reduction implants — 1 ability per available rarity.
    it('VOIDSHADE produces 1 ability per rarity (incomingDamage reduction while in stealth)', () => {
        const variants = IMPLANTS['VOIDSHADE'].variants;
        for (const v of variants) {
            expect(implantAbilityCount('VOIDSHADE', v.rarity)).toBe(1);
        }
    });

    it('NEBULA_NULLIFIER produces 1 ability per rarity (incomingDamage reduction while Stasis/Disable)', () => {
        const variants = IMPLANTS['NEBULA_NULLIFIER'].variants;
        for (const v of variants) {
            expect(implantAbilityCount('NEBULA_NULLIFIER', v.rarity)).toBe(1);
        }
    });

    it('HYPERION_GAZE produces 1 ability per rarity (incomingDamage reduction when crit-hit by stealthed enemy)', () => {
        const variants = IMPLANTS['HYPERION_GAZE'].variants;
        for (const v of variants) {
            expect(implantAbilityCount('HYPERION_GAZE', v.rarity)).toBe(1);
        }
    });

    it('VORTEX_VEIL produces 1 ability per rarity (incomingDamage reduction from Inferno/Corrosion)', () => {
        const variants = IMPLANTS['VORTEX_VEIL'].variants;
        for (const v of variants) {
            expect(implantAbilityCount('VORTEX_VEIL', v.rarity)).toBe(1);
        }
    });

    it('IRONCLAD produces 1 ability per rarity (block chance on repeated damage; no uncommon)', () => {
        // IRONCLAD has common/rare/epic/legendary — no uncommon variant.
        const variants = IMPLANTS['IRONCLAD'].variants;
        for (const v of variants) {
            expect(implantAbilityCount('IRONCLAD', v.rarity)).toBe(1);
        }
    });

    it('SHADOWGUARD produces 1 ability per rarity (block while in stealth; epic/uncommon/legendary only)', () => {
        // SHADOWGUARD has epic/uncommon/legendary — no common or rare variant.
        const variants = IMPLANTS['SHADOWGUARD'].variants;
        for (const v of variants) {
            expect(implantAbilityCount('SHADOWGUARD', v.rarity)).toBe(1);
        }
    });

    // D-PR4: outgoing-amplification implants
    it('MENACE produces 1 ability per rarity (outgoing-amplification on-crit)', () => {
        // MENACE has common/uncommon/epic/rare/legendary (all 5 rarities).
        const variants = IMPLANTS['MENACE'].variants;
        for (const v of variants) {
            expect(implantAbilityCount('MENACE', v.rarity)).toBe(1);
        }
    });

    it('GIANT_SLAYER produces 1 ability per rarity (outgoing-amplification vs higher-attack enemy; no common variant)', () => {
        // GIANT_SLAYER has uncommon/legendary/rare/epic — no common variant.
        const variants = IMPLANTS['GIANT_SLAYER'].variants;
        for (const v of variants) {
            expect(implantAbilityCount('GIANT_SLAYER', v.rarity)).toBe(1);
        }
    });

    it('INSIDIOUSNESS produces 1 ability per rarity (reactive damage on-debuff)', () => {
        // INSIDIOUSNESS has uncommon/rare/legendary/common/epic (all 5 rarities).
        const variants = IMPLANTS['INSIDIOUSNESS'].variants;
        for (const v of variants) {
            expect(implantAbilityCount('INSIDIOUSNESS', v.rarity)).toBe(1);
        }
    });

    // D-PR5: reactive-heal implants
    it('SECOND_WIND produces 1 ability per rarity (on-crit-hit reactive heal; no common variant)', () => {
        // SECOND_WIND has uncommon/rare/epic/legendary — no common variant.
        expect(implantAbilityCount('SECOND_WIND', 'common')).toBe(0);
        const variants = IMPLANTS['SECOND_WIND'].variants;
        for (const v of variants) {
            expect(implantAbilityCount('SECOND_WIND', v.rarity)).toBe(1);
        }
    });

    it('NOURISHMENT produces 1 ability per rarity (repair amplification vs lower-HP ally; no common variant)', () => {
        // NOURISHMENT has uncommon/rare/epic/legendary — no common variant.
        expect(implantAbilityCount('NOURISHMENT', 'common')).toBe(0);
        const variants = IMPLANTS['NOURISHMENT'].variants;
        for (const v of variants) {
            expect(implantAbilityCount('NOURISHMENT', v.rarity)).toBe(1);
        }
    });

    it('VIVACIOUS_REPAIR produces 1 ability per rarity (double-repair chance vs low-HP ally; rare/epic/legendary only)', () => {
        // VIVACIOUS_REPAIR has rare/epic/legendary — no common or uncommon variant.
        expect(implantAbilityCount('VIVACIOUS_REPAIR', 'common')).toBe(0);
        expect(implantAbilityCount('VIVACIOUS_REPAIR', 'uncommon')).toBe(0);
        const variants = IMPLANTS['VIVACIOUS_REPAIR'].variants;
        for (const v of variants) {
            expect(implantAbilityCount('VIVACIOUS_REPAIR', v.rarity)).toBe(1);
        }
    });

    // D-PR6: repair-amplification implant
    it('EXUBERANCE produces 1 ability per rarity (repair-amplification on-repair chance; no common variant)', () => {
        // EXUBERANCE has uncommon/rare/epic/legendary — no common variant.
        expect(implantAbilityCount('EXUBERANCE', 'common')).toBe(0);
        const variants = IMPLANTS['EXUBERANCE'].variants;
        for (const v of variants) {
            expect(implantAbilityCount('EXUBERANCE', v.rarity)).toBe(1);
        }
    });

    // D-PR7: on-death implants
    it('LAST_WISH produces 1 ability per rarity (repair all allies on death; no common variant)', () => {
        expect(implantAbilityCount('LAST_WISH', 'common')).toBe(0);
        const variants = IMPLANTS['LAST_WISH'].variants;
        for (const v of variants) {
            expect(implantAbilityCount('LAST_WISH', v.rarity)).toBe(1);
        }
    });

    it('BATTLECRY produces 1 ability per rarity (Inc. Damage Down to allies on death; no uncommon variant)', () => {
        expect(implantAbilityCount('BATTLECRY', 'uncommon')).toBe(0);
        const variants = IMPLANTS['BATTLECRY'].variants;
        for (const v of variants) {
            expect(implantAbilityCount('BATTLECRY', v.rarity)).toBe(1);
        }
    });

    it('MARTYRDOM produces 1 ability for rare + legendary (Disable on killer on death; only 2 variants)', () => {
        // Unsupported rarities (no variant) produce nothing — symmetric with the
        // siblings above, guarding against accidental expansion of supported rarities.
        expect(implantAbilityCount('MARTYRDOM', 'common')).toBe(0);
        expect(implantAbilityCount('MARTYRDOM', 'uncommon')).toBe(0);
        expect(implantAbilityCount('MARTYRDOM', 'epic')).toBe(0);
        const variants = IMPLANTS['MARTYRDOM'].variants;
        for (const v of variants) {
            expect(implantAbilityCount('MARTYRDOM', v.rarity)).toBe(1);
        }
    });

    // D-PR8: reactive self-buff implants
    it('SYNAPTIC_RESONANCE produces 1 self Speed Up III buff on-enemy-repaired per rarity (no procChance)', () => {
        for (const v of IMPLANTS['SYNAPTIC_RESONANCE'].variants) {
            expect(implantAbilityCount('SYNAPTIC_RESONANCE', v.rarity)).toBe(1);
        }
    });
    it('AMBUSH produces 1 self Crit Power Up III buff per rarity (start-of-round, self-buff Stealth gate)', () => {
        for (const v of IMPLANTS['AMBUSH'].variants) {
            expect(implantAbilityCount('AMBUSH', v.rarity)).toBe(1);
        }
    });
    it('ALACRITY produces 1 self Speed Up III buff per rarity (end-of-round, not-hit-this-round gate)', () => {
        for (const v of IMPLANTS['ALACRITY'].variants) {
            expect(implantAbilityCount('ALACRITY', v.rarity)).toBe(1);
        }
    });

    // D-PR9: all-allies reactive buff implant
    it('SPEARHEAD produces 1 all-allies Attack Up I buff per rarity (on-charged-cast, procChance)', () => {
        for (const v of IMPLANTS['SPEARHEAD'].variants) {
            expect(implantAbilityCount('SPEARHEAD', v.rarity)).toBe(1);
        }
    });

    it('FONT_OF_POWER produces 1 ally Power Infused Nanobots buff for rare/epic/legendary, 0 otherwise (on-own-repair-to-ally, procChance)', () => {
        const SUPPORTED = new Set(['rare', 'epic', 'legendary']);
        for (const v of IMPLANTS['FONT_OF_POWER'].variants) {
            expect(implantAbilityCount('FONT_OF_POWER', v.rarity)).toBe(
                SUPPORTED.has(v.rarity) ? 1 : 0
            );
        }
    });

    // D-PR11: adjacent-ally buff grant
    it('FORTIFYING_SHROUD produces 1 adjacent-allies Defense Up I buff for uncommon/rare/epic/legendary (start-of-turn, procChance); no common variant', () => {
        expect(implantAbilityCount('FORTIFYING_SHROUD', 'common')).toBe(0);
        const SUPPORTED = new Set(['uncommon', 'rare', 'epic', 'legendary']);
        for (const v of IMPLANTS['FORTIFYING_SHROUD'].variants) {
            expect(implantAbilityCount('FORTIFYING_SHROUD', v.rarity)).toBe(
                SUPPORTED.has(v.rarity) ? 1 : 0
            );
        }
    });

    // D-PR14: Provoke / Concentrate Fire debuff grants
    it('BULWARK produces 1 ability per rarity (on-ally-attacked Provoke debuff, oncePerRound, adjacency-required)', () => {
        for (const v of IMPLANTS['BULWARK'].variants) {
            expect(implantAbilityCount('BULWARK', v.rarity)).toBe(1);
        }
    });

    it('DOOMSAYER produces 1 ability for uncommon/rare/epic/legendary (end-of-round Concentrate Fire debuff, first-activator gate); no common variant', () => {
        expect(implantAbilityCount('DOOMSAYER', 'common')).toBe(0);
        const SUPPORTED = new Set(['uncommon', 'rare', 'epic', 'legendary']);
        for (const v of IMPLANTS['DOOMSAYER'].variants) {
            expect(implantAbilityCount('DOOMSAYER', v.rarity)).toBe(
                SUPPORTED.has(v.rarity) ? 1 : 0
            );
        }
    });

    // D-PR16: WARPSTRIKE shape — two abilities, correct trigger + config each
    it('WARPSTRIKE ability[0] is the outgoingDamage modifier (on-cast, self-debuff condition)', () => {
        const abs = implantAbilities('WARPSTRIKE', 'legendary');
        expect(abs).toHaveLength(2);
        const mod = abs[0];
        expect(mod.type).toBe('modifier');
        expect(mod.trigger).toBe('on-cast');
        expect(mod.config).toMatchObject({ type: 'modifier', channel: 'outgoingDamage' });
        // self-debuff condition must be present
        expect(mod.conditions.some((c) => c.subject === 'self-debuff')).toBe(true);
    });

    it('WARPSTRIKE ability[1] is the reduce-duration cleanse (on-deal-damage, self-debuff condition, durationTurns 1)', () => {
        const abs = implantAbilities('WARPSTRIKE', 'legendary');
        expect(abs).toHaveLength(2);
        const cleanse = abs[1];
        expect(cleanse.type).toBe('cleanse');
        expect(cleanse.trigger).toBe('on-deal-damage');
        expect(cleanse.config).toMatchObject({
            type: 'cleanse',
            mode: 'reduce-duration',
            durationTurns: 1,
        });
        // self-debuff condition must be present
        expect(cleanse.conditions.some((c) => c.subject === 'self-debuff')).toBe(true);
        // deterministic — no procChance
        expect(cleanse.procChance).toBeUndefined();
    });

    it('WARPSTRIKE ids are suffixed with -0 / -1 (multi-ability builder indexing)', () => {
        const abs = implantAbilities('WARPSTRIKE', 'common');
        expect(abs[0].id).toBe('equip-implant-WARPSTRIKE-WARPSTRIKE-piece-0');
        expect(abs[1].id).toBe('equip-implant-WARPSTRIKE-WARPSTRIKE-piece-1');
    });

    // Reactive cleanse PR: REACTIVE_WARD — 1 ability for common/uncommon/epic/legendary; 0 for rare
    it('REACTIVE_WARD produces 1 ability for common/uncommon/epic/legendary, 0 for rare (no rare variant)', () => {
        expect(implantAbilityCount('REACTIVE_WARD', 'common')).toBe(1);
        expect(implantAbilityCount('REACTIVE_WARD', 'uncommon')).toBe(1);
        expect(implantAbilityCount('REACTIVE_WARD', 'rare')).toBe(0);
        expect(implantAbilityCount('REACTIVE_WARD', 'epic')).toBe(1);
        expect(implantAbilityCount('REACTIVE_WARD', 'legendary')).toBe(1);
    });

    it('REACTIVE_WARD ability shape: trigger on-attacked, cleanse mode remove, count 1, critCount 2, correct procChance per rarity', () => {
        const PROC: Record<string, number> = {
            common: 0.05,
            uncommon: 0.07,
            epic: 0.12,
            legendary: 0.16,
        };
        for (const [rarity, expectedPc] of Object.entries(PROC)) {
            const abs = implantAbilities('REACTIVE_WARD', rarity);
            expect(abs).toHaveLength(1);
            const ab = abs[0];
            expect(ab.type).toBe('cleanse');
            expect(ab.trigger).toBe('on-attacked');
            expect(ab.target).toBe('self');
            expect(ab.procChance).toBeCloseTo(expectedPc);
            expect(ab.config).toMatchObject({
                type: 'cleanse',
                count: 1,
                critCount: 2,
                mode: 'remove',
            });
        }
    });

    // H3.4: Abundant Renewal — deterministic overheal→shield to the over-repaired ally.
    it('ABUNDANT_RENEWAL produces 1 ability for epic/legendary, 0 otherwise (no common/uncommon/rare variant)', () => {
        expect(implantAbilityCount('ABUNDANT_RENEWAL', 'common')).toBe(0);
        expect(implantAbilityCount('ABUNDANT_RENEWAL', 'uncommon')).toBe(0);
        expect(implantAbilityCount('ABUNDANT_RENEWAL', 'rare')).toBe(0);
        const SUPPORTED = new Set(['epic', 'legendary']);
        for (const v of IMPLANTS['ABUNDANT_RENEWAL'].variants) {
            expect(implantAbilityCount('ABUNDANT_RENEWAL', v.rarity)).toBe(
                SUPPORTED.has(v.rarity) ? 1 : 0
            );
        }
    });

    it('ABUNDANT_RENEWAL (legendary) shape: on-own-repair-to-ally shield to ally, basis overheal 30%, deterministic', () => {
        const abs = implantAbilities('ABUNDANT_RENEWAL', 'legendary');
        expect(abs).toHaveLength(1);
        const ab = abs[0];
        expect(ab.type).toBe('shield');
        expect(ab.target).toBe('ally');
        expect(ab.trigger).toBe('on-own-repair-to-ally');
        // Deterministic — no proc chance and no once-per-round cap.
        expect(ab.procChance).toBeUndefined();
        expect(ab.oncePerRound).toBeFalsy();
        expect(ab.config).toMatchObject({ type: 'shield', pct: 30, basis: 'overheal' });
    });

    // H3.2: Adaptive Plating — reactive once-per-round shield off the damage taken.
    it('ADAPTIVE_PLATING produces 1 ability for uncommon/epic/legendary, 0 otherwise (no common/rare variant)', () => {
        expect(implantAbilityCount('ADAPTIVE_PLATING', 'common')).toBe(0);
        expect(implantAbilityCount('ADAPTIVE_PLATING', 'rare')).toBe(0);
        const SUPPORTED = new Set(['uncommon', 'epic', 'legendary']);
        for (const v of IMPLANTS['ADAPTIVE_PLATING'].variants) {
            expect(implantAbilityCount('ADAPTIVE_PLATING', v.rarity)).toBe(
                SUPPORTED.has(v.rarity) ? 1 : 0
            );
        }
    });

    it('ADAPTIVE_PLATING (legendary) shape: on-attacked self shield, procChance 0.19, oncePerRound, damage-taken 42%', () => {
        const abs = implantAbilities('ADAPTIVE_PLATING', 'legendary');
        expect(abs).toHaveLength(1);
        const ab = abs[0];
        expect(ab.type).toBe('shield');
        expect(ab.target).toBe('self');
        expect(ab.trigger).toBe('on-attacked');
        expect(ab.procChance).toBeCloseTo(0.19);
        expect(ab.oncePerRound).toBe(true);
        expect(ab.config).toMatchObject({ type: 'shield', pct: 42, basis: 'damage-taken' });
    });

    // H3.8: Resonating Fury — on-shield-applied buff grant to shield recipients.
    it('RESONATING_FURY produces 1 ability per rarity (all 5 rarities present)', () => {
        const variants = IMPLANTS['RESONATING_FURY'].variants;
        // Common/uncommon/rare/epic/legendary all defined.
        expect(variants.map((v) => v.rarity).sort()).toEqual([
            'common',
            'epic',
            'legendary',
            'rare',
            'uncommon',
        ]);
        for (const v of variants) {
            expect(implantAbilityCount('RESONATING_FURY', v.rarity)).toBe(1);
        }
    });

    it('RESONATING_FURY (legendary) shape: on-shield-applied all-allies Crit Power Up III buff, duration 1, procChance 0.16', () => {
        const abs = implantAbilities('RESONATING_FURY', 'legendary');
        expect(abs).toHaveLength(1);
        const ab = abs[0];
        expect(ab.type).toBe('buff');
        // target 'all-allies' routes to eventCtx.shieldRecipientIds via the H3.7 listener.
        expect(ab.target).toBe('all-allies');
        expect(ab.trigger).toBe('on-shield-applied');
        expect(ab.procChance).toBeCloseTo(0.16);
        // No per-round cap — one proc roll per cast.
        expect(ab.oncePerRound).toBeFalsy();
        expect(ab.config).toMatchObject({
            type: 'buff',
            buffName: 'Crit Power Up III',
            duration: 1,
        });
    });

    // SMOKESCREEN: on-attacked self Stealth buff, rare/epic/legendary only (no common/uncommon).
    it('SMOKESCREEN produces 1 ability for rare/epic/legendary, 0 otherwise (on-attacked Stealth self-buff)', () => {
        expect(implantAbilityCount('SMOKESCREEN', 'common')).toBe(0);
        expect(implantAbilityCount('SMOKESCREEN', 'uncommon')).toBe(0);
        for (const v of IMPLANTS['SMOKESCREEN'].variants) {
            expect(implantAbilityCount('SMOKESCREEN', v.rarity)).toBe(1);
        }
    });
    it('SMOKESCREEN (legendary) shape: on-attacked self Stealth 1t, procChance 0.16, plain proc', () => {
        const abs = implantAbilities('SMOKESCREEN', 'legendary');
        expect(abs).toHaveLength(1);
        const ab = abs[0];
        expect(ab.type).toBe('buff');
        expect(ab.target).toBe('self');
        expect(ab.trigger).toBe('on-attacked');
        expect(ab.procChance).toBeCloseTo(0.16);
        expect(ab.oncePerRound).toBeFalsy();
        // @ts-expect-error buff config
        expect(ab.config.buffName).toBe('Stealth');
        // @ts-expect-error buff config
        expect(ab.config.duration).toBe(1);
    });

    // Lifeline: PRE-hit threshold shield (incoming-shield-grant), all five rarities.
    it('LIFELINE produces 1 ability per rarity (incoming-shield-grant, flat by rarity, 100% attack, threshold 30, once per battle)', () => {
        const flat: Record<string, number> = {
            common: 4000,
            uncommon: 6000,
            rare: 8000,
            epic: 10000,
            legendary: 12000,
        };
        for (const v of IMPLANTS['LIFELINE'].variants) {
            expect(implantAbilityCount('LIFELINE', v.rarity)).toBe(1);
            const abs = implantAbilities('LIFELINE', v.rarity);
            expect(abs[0].config).toMatchObject({
                type: 'incoming-shield-grant',
                hpThresholdPct: 30,
                flatAmount: flat[v.rarity],
                attackPct: 100,
                oncePerCombat: true,
            });
        }
    });

    // Task 1.5: Voidfire Catalyst — detonationDamage modifier half.
    // rare/legendary are splash-only → no detonation ability (builder returns undefined).
    it('VOIDFIRE_CATALYST produces 1 ability for common/uncommon/epic (detonationDamage modifier), 0 for rare/legendary (splash-only)', () => {
        expect(implantAbilityCount('VOIDFIRE_CATALYST', 'common')).toBe(1);
        expect(implantAbilityCount('VOIDFIRE_CATALYST', 'uncommon')).toBe(1);
        expect(implantAbilityCount('VOIDFIRE_CATALYST', 'rare')).toBe(0);
        expect(implantAbilityCount('VOIDFIRE_CATALYST', 'epic')).toBe(1);
        expect(implantAbilityCount('VOIDFIRE_CATALYST', 'legendary')).toBe(0);
    });

    const unimplementedImplants = Object.keys(IMPLANTS).filter((k) => !implementedImplants.has(k));
    for (const implantKey of unimplementedImplants) {
        it(`${implantKey} produces 0 abilities (not yet implemented)`, () => {
            const variants = IMPLANTS[implantKey].variants;
            // Check all available rarities — none should produce abilities yet.
            for (const v of variants) {
                expect(implantAbilityCount(implantKey, v.rarity)).toBe(0);
            }
        });
    }
});
