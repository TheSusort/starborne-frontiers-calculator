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

// ---------------------------------------------------------------------------
// Regression guard: implemented effect names must equal exactly this set.
// Update deliberately when new effects are added.
// ---------------------------------------------------------------------------

describe('equipmentCoverage — implemented effects registry', () => {
    it('exactly { LEECH + HARDENED (gear sets), MARTYRDOM + ARCANE_SIEGE + HYPERION_GAZE + INTRUSION + NEBULA_NULLIFIER + NOURISHMENT + SYNAPTIC_RESONANCE + VOIDSHADE + VORTEX_VEIL + WARPSTRIKE + ALACRITY + AMBUSH + BATTLECRY + BLOODTHIRST + BULWARK + DOOMSAYER + EXUBERANCE + FIREWALL + FONT_OF_POWER + FORTIFYING_SHROUD + GIANT_SLAYER + INSIDIOUSNESS + IRONCLAD + LAST_WISH + LOCKDOWN + MENACE + SECOND_WIND + SHADOWGUARD + SPEARHEAD + TENACITY + VIVACIOUS_REPAIR (implants) } are currently implemented', () => {
        // Gear sets with an ability builder
        const implementedSets = Object.keys(GEAR_SETS).filter(
            (key) => gearSetAbilityCount(key) > 0
        );
        expect(implementedSets).toEqual(['LEECH', 'HARDENED']);

        // Implants with an ability builder (check each implant with a rarity that exists)
        const implementedImplants = Object.keys(IMPLANTS).filter((key) => {
            const variants = IMPLANTS[key].variants;
            // Try the first available rarity for each implant.
            return variants.some((v) => implantAbilityCount(key, v.rarity) > 0);
        });
        expect(implementedImplants).toEqual([
            'MARTYRDOM',
            'ARCANE_SIEGE',
            'HYPERION_GAZE',
            'INTRUSION',
            'NEBULA_NULLIFIER',
            'NOURISHMENT',
            'SYNAPTIC_RESONANCE',
            'VOIDSHADE',
            'VORTEX_VEIL',
            'WARPSTRIKE',
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
            'LAST_WISH',
            'LOCKDOWN',
            'MENACE',
            'SECOND_WIND',
            'SHADOWGUARD',
            'SPEARHEAD',
            'TENACITY',
            'VIVACIOUS_REPAIR',
        ]);
    });
});

// ---------------------------------------------------------------------------
// Gear-set coverage: one assertion per set
// ---------------------------------------------------------------------------

const IMPLEMENTED_SETS = new Set(['LEECH', 'HARDENED']);

describe('equipmentCoverage — gear sets', () => {
    it('LEECH produces exactly 1 ability (the standing leech)', () => {
        expect(gearSetAbilityCount('LEECH')).toBe(1);
    });

    it('HARDENED produces exactly 1 ability (incoming-reduction)', () => {
        expect(gearSetAbilityCount('HARDENED')).toBe(1);
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
    const implementedImplants = new Set([
        'FIREWALL',
        'LOCKDOWN',
        'TENACITY',
        'BLOODTHIRST',
        'INTRUSION',
        'ARCANE_SIEGE',
        'WARPSTRIKE',
        'VOIDSHADE',
        'NEBULA_NULLIFIER',
        'HYPERION_GAZE',
        'VORTEX_VEIL',
        'IRONCLAD',
        'SHADOWGUARD',
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
        'ALACRITY',
        'AMBUSH',
        'SPEARHEAD',
        'FONT_OF_POWER',
        'FORTIFYING_SHROUD',
        'BULWARK',
        'DOOMSAYER',
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

    it('WARPSTRIKE produces 1 ability per rarity (outgoingDamage modifier gated on self-debuff)', () => {
        const variants = IMPLANTS['WARPSTRIKE'].variants;
        for (const v of variants) {
            expect(implantAbilityCount('WARPSTRIKE', v.rarity)).toBe(1);
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
