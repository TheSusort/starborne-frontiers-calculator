import { describe, it, expect } from 'vitest';
import { buildEquipmentAbilities } from '../buildEquipmentAbilities';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { Ability } from '../../../types/abilities';
import { GEAR_SETS } from '../../../constants/gearSets';

/** Build a minimal Ship for test purposes. */
function makeShip(over: Partial<Ship>): Ship {
    return {
        id: 'test-ship',
        name: 'Test Ship',
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

/** Build a minimal GearPiece for test purposes. */
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
    } as GearPiece;
}

/** Factory that returns a getGearPiece function backed by the given id→GearPiece map. */
function makeGetGearPiece(map: Record<string, GearPiece>): (id: string) => GearPiece | undefined {
    return (id) => map[id];
}

// ---------------------------------------------------------------------------
// Case 1: Leech set active (≥2 pieces)
// ---------------------------------------------------------------------------
describe('buildEquipmentAbilities — Leech set', () => {
    it('emits the Leech ability when ≥2 LEECH pieces are equipped', () => {
        const pieceA = makePiece({ id: 'leech-1', setBonus: 'LEECH' });
        const pieceB = makePiece({ id: 'leech-2', slot: 'hull', setBonus: 'LEECH' });
        const ship = makeShip({
            equipment: { weapon: 'leech-1', hull: 'leech-2' },
        });
        const getGearPiece = makeGetGearPiece({ 'leech-1': pieceA, 'leech-2': pieceB });

        const abilities = buildEquipmentAbilities(ship, getGearPiece);

        expect(abilities).toHaveLength(1);
        const [ab] = abilities;
        expect(ab.id).toBe('equip-set-LEECH');
        expect(ab.type).toBe('heal');
        expect(ab.target).toBe('self');
        expect(ab.trigger).toBe('on-cast');
        expect(ab.config).toEqual({
            type: 'heal',
            pct: 15,
            basis: 'damage-dealt',
            leechScope: 'all',
            noCrit: true,
        });
    });

    // Case 2: Leech set inactive (1 piece)
    it('emits nothing when only 1 LEECH piece is equipped', () => {
        const pieceA = makePiece({ id: 'leech-1', setBonus: 'LEECH' });
        const ship = makeShip({
            equipment: { weapon: 'leech-1' },
        });
        const getGearPiece = makeGetGearPiece({ 'leech-1': pieceA });

        const abilities = buildEquipmentAbilities(ship, getGearPiece);

        expect(abilities).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Case 3: Bloodthirst implant (legendary)
// ---------------------------------------------------------------------------
describe('buildEquipmentAbilities — Bloodthirst implant', () => {
    it('emits on-crit heal with procChance 0.20 and pct 20 for legendary Bloodthirst', () => {
        const implantPiece = makePiece({
            id: 'bt-implant',
            slot: 'implant_major',
            rarity: 'legendary',
            setBonus: 'BLOODTHIRST',
        });
        const ship = makeShip({
            implants: { implant_major: 'bt-implant' },
        });
        const getGearPiece = makeGetGearPiece({ 'bt-implant': implantPiece });

        const abilities = buildEquipmentAbilities(ship, getGearPiece);

        expect(abilities.length).toBeGreaterThanOrEqual(1);
        const ab = abilities.find((a) => a.trigger === 'on-crit');
        expect(ab).toBeDefined();
        expect(ab!.procChance).toBeCloseTo(0.2);
        expect(ab!.config.type).toBe('heal');
        if (ab!.config.type === 'heal') {
            expect(ab!.config.pct).toBe(20);
        }
    });
});

// ---------------------------------------------------------------------------
// Case 4: Missing piece — no entry in map
// ---------------------------------------------------------------------------
describe('buildEquipmentAbilities — missing piece', () => {
    it('skips gracefully when an implant id has no entry in the map', () => {
        const ship = makeShip({
            implants: { implant_major: 'nonexistent-id' },
        });
        const getGearPiece = makeGetGearPiece({});

        const abilities = buildEquipmentAbilities(ship, getGearPiece);
        expect(abilities).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Case 5: Stat-only implant (e.g. STRIKE minor with no description)
// ---------------------------------------------------------------------------
describe('buildEquipmentAbilities — stat-only implant', () => {
    it('emits nothing for a stat-only implant with no description', () => {
        const implantPiece = makePiece({
            id: 'strike-implant',
            slot: 'implant_minor_sigma',
            rarity: 'legendary',
            setBonus: 'STRIKE',
        });
        const ship = makeShip({
            implants: { implant_minor_sigma: 'strike-implant' },
        });
        const getGearPiece = makeGetGearPiece({ 'strike-implant': implantPiece });

        const abilities = buildEquipmentAbilities(ship, getGearPiece);

        expect(abilities).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Case 6: Unknown implant key — not in IMPLANTS registry
// ---------------------------------------------------------------------------
describe('buildEquipmentAbilities — unknown implant key', () => {
    it('skips gracefully when the implant setBonus key is unknown (not in IMPLANTS)', () => {
        // The piece has a setBonus that doesn't exist in IMPLANTS at all, so it is
        // skipped before any description is read — this is an unknown-key guard, not a
        // parse failure.
        const implantPiece = makePiece({
            id: 'fake-implant',
            slot: 'implant_major',
            rarity: 'legendary',
            setBonus: 'FAKE_NONEXISTENT_IMPLANT' as never,
        });
        const ship = makeShip({
            implants: { implant_major: 'fake-implant' },
        });
        const getGearPiece = makeGetGearPiece({ 'fake-implant': implantPiece });

        const abilities = buildEquipmentAbilities(ship, getGearPiece);
        expect(abilities).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Helpers for implant-only tests
// ---------------------------------------------------------------------------

/** Build a ship with a single implant piece in implant_major and call buildEquipmentAbilities. */
function buildForImplant(name: string, rarity: GearPiece['rarity']): Ability[] {
    const implantKey = name;
    const id = `${implantKey}-piece`;
    const pieceMap: Record<string, GearPiece> = {
        [id]: makePiece({ id, slot: 'implant_major', rarity, setBonus: implantKey }),
    };
    return buildEquipmentAbilities(
        makeShip({ implants: { implant_major: id } }),
        (g) => pieceMap[g]
    );
}

/** Build a ship with enough pieces of a gear set (≥ its minPieces) and return the abilities. */
function buildForGearSet(setKey: string): Ability[] {
    const minPieces = GEAR_SETS[setKey]?.minPieces ?? 2;
    const slots = ['weapon', 'hull', 'sensor', 'engine'] as const;
    const equipment: Record<string, string> = {};
    const pieceMap: Record<string, GearPiece> = {};
    for (let i = 0; i < minPieces; i++) {
        const id = `${setKey}-${i}`;
        equipment[slots[i % slots.length]] = id;
        pieceMap[id] = makePiece({ id, slot: slots[i % slots.length], setBonus: setKey });
    }
    return buildEquipmentAbilities(makeShip({ equipment }), (g) => pieceMap[g]);
}

// ---------------------------------------------------------------------------
// Case 7: Intrusion implant
// ---------------------------------------------------------------------------
describe('Intrusion implant', () => {
    it('emits a passive outgoingDamage modifier scaling per enemy debuff (legendary = 5/debuff)', () => {
        const abilities = buildForImplant('INTRUSION', 'legendary');
        expect(abilities).toHaveLength(1);
        const a = abilities[0];
        expect(a.type).toBe('modifier');
        expect(a.trigger).toBe('on-cast');
        expect(a.config).toMatchObject({ type: 'modifier', channel: 'outgoingDamage', value: 0 });
        expect(a.scaling).toEqual({ conditionIndex: 0, perUnit: 5 });
        expect(a.conditions).toEqual([{ subject: 'enemy-debuff', derivable: true }]);
    });
    it('bakes the uncommon per-debuff value (2)', () => {
        expect(buildForImplant('INTRUSION', 'uncommon')[0].scaling).toEqual({
            conditionIndex: 0,
            perUnit: 2,
        });
    });
});

// ---------------------------------------------------------------------------
// Case 8: Arcane Siege implant
// ---------------------------------------------------------------------------
describe('Arcane Siege implant', () => {
    it('emits a flat outgoingDamage modifier gated on self-shield (epic = 15)', () => {
        const a = buildForImplant('ARCANE_SIEGE', 'epic')[0];
        expect(a.config).toMatchObject({ type: 'modifier', channel: 'outgoingDamage', value: 15 });
        expect(a.scaling).toBeUndefined();
        expect(a.conditions).toEqual([{ subject: 'self-shield', derivable: true }]);
    });
});

// ---------------------------------------------------------------------------
// Case 9: Warpstrike implant
// ---------------------------------------------------------------------------
describe('Warpstrike implant', () => {
    it('emits a flat outgoingDamage modifier gated on >=1 self-debuff (legendary = 5)', () => {
        const a = buildForImplant('WARPSTRIKE', 'legendary')[0];
        expect(a.config).toMatchObject({ type: 'modifier', channel: 'outgoingDamage', value: 5 });
        expect(a.scaling).toBeUndefined();
        expect(a.conditions).toEqual([
            { subject: 'self-debuff', derivable: true, countComparator: 'gte', countThreshold: 1 },
        ]);
    });
});

// ---------------------------------------------------------------------------
// D-PR3: incoming-reduction implants
// ---------------------------------------------------------------------------
describe('D-PR3 incoming-reduction implants', () => {
    it('Voidshade (legendary) → self-stealth direct reduction 20, non-crit-family', () => {
        expect(buildForImplant('VOIDSHADE', 'legendary')[0].config).toMatchObject({
            type: 'incoming-reduction',
            scope: 'direct',
            condition: 'self-stealth',
            pct: 20,
            critFamily: false,
        });
    });
    it('Nebula Nullifier (epic) → self-stasis direct reduction 28', () => {
        expect(buildForImplant('NEBULA_NULLIFIER', 'epic')[0].config).toMatchObject({
            type: 'incoming-reduction',
            condition: 'self-stasis',
            pct: 28,
            critFamily: false,
        });
    });
    it('Hyperion Gaze (legendary) → crit-by-stealthed reduction 35, crit-family', () => {
        expect(buildForImplant('HYPERION_GAZE', 'legendary')[0].config).toMatchObject({
            type: 'incoming-reduction',
            condition: 'incoming-crit-by-stealthed',
            pct: 35,
            critFamily: true,
        });
    });
    it('Vortex Veil (legendary) → dot-scope reduction 30', () => {
        expect(buildForImplant('VORTEX_VEIL', 'legendary')[0].config).toMatchObject({
            type: 'incoming-reduction',
            scope: 'dot',
            condition: 'dot-inferno-corrosion',
            pct: 30,
            critFamily: false,
        });
    });
});

// ---------------------------------------------------------------------------
// D-PR3: incoming-block implants
// ---------------------------------------------------------------------------
describe('D-PR3 incoming-block implants', () => {
    it('Ironclad (legendary) → nth-hit-2plus block, chance 0.20 / blockPct 0.50, not once-per-round', () => {
        expect(buildForImplant('IRONCLAD', 'legendary')[0].config).toMatchObject({
            type: 'incoming-block',
            condition: 'nth-hit-2plus',
            procChance: 0.2,
            blockPct: 0.5,
            oncePerRound: false,
        });
    });
    it('Ironclad has no uncommon variant → no ability', () => {
        expect(buildForImplant('IRONCLAD', 'uncommon')).toEqual([]);
    });
    it('Shadowguard (legendary) → self-stealth full block, chance 0.16 / blockPct 1, once-per-round', () => {
        expect(buildForImplant('SHADOWGUARD', 'legendary')[0].config).toMatchObject({
            type: 'incoming-block',
            condition: 'self-stealth',
            procChance: 0.16,
            blockPct: 1,
            oncePerRound: true,
        });
    });
});

// ---------------------------------------------------------------------------
// D-PR3: Hardened gear set
// ---------------------------------------------------------------------------
describe('Hardened gear set', () => {
    it('emits a crit-family direct reduction of 5', () => {
        expect(buildForGearSet('HARDENED')[0].config).toMatchObject({
            type: 'incoming-reduction',
            scope: 'direct',
            condition: 'incoming-crit',
            pct: 5,
            critFamily: true,
        });
    });
});

// ---------------------------------------------------------------------------
// D-PR4: Menace implant (outgoing-amplification, amplify-on-crit)
// ---------------------------------------------------------------------------
describe('Menace implant', () => {
    it('emits an outgoing-amplification with condition amplify-on-crit, ampPct 35, procChance ≈ 0.11 for epic', () => {
        const abilities = buildForImplant('MENACE', 'epic');
        expect(abilities).toHaveLength(1);
        const ab = abilities[0];
        expect(ab.type).toBe('outgoing-amplification');
        expect(ab.target).toBe('self');
        expect(ab.autoFilled).toBe(true);
        if (ab.config.type === 'outgoing-amplification') {
            expect(ab.config.condition).toBe('amplify-on-crit');
            expect(ab.config.ampPct).toBe(35);
            expect(ab.config.procChance).toBeCloseTo(0.11);
        } else {
            throw new Error('Expected outgoing-amplification config');
        }
    });

    it('emits correct values for common (ampPct 20, procChance ≈ 0.08)', () => {
        const ab = buildForImplant('MENACE', 'common')[0];
        if (ab.config.type === 'outgoing-amplification') {
            expect(ab.config.ampPct).toBe(20);
            expect(ab.config.procChance).toBeCloseTo(0.08);
        } else {
            throw new Error('Expected outgoing-amplification config');
        }
    });

    it('emits correct values for legendary (ampPct 45, procChance ≈ 0.12)', () => {
        const ab = buildForImplant('MENACE', 'legendary')[0];
        if (ab.config.type === 'outgoing-amplification') {
            expect(ab.config.ampPct).toBe(45);
            expect(ab.config.procChance).toBeCloseTo(0.12);
        } else {
            throw new Error('Expected outgoing-amplification config');
        }
    });
});

// ---------------------------------------------------------------------------
// D-PR4: Giant Slayer implant (outgoing-amplification, amplify-vs-higher-attack)
// ---------------------------------------------------------------------------
describe('Giant Slayer implant', () => {
    it('emits an outgoing-amplification with condition amplify-vs-higher-attack, ampPct 50, procChance ≈ 0.20 for legendary', () => {
        const abilities = buildForImplant('GIANT_SLAYER', 'legendary');
        expect(abilities).toHaveLength(1);
        const ab = abilities[0];
        expect(ab.type).toBe('outgoing-amplification');
        expect(ab.target).toBe('self');
        expect(ab.autoFilled).toBe(true);
        if (ab.config.type === 'outgoing-amplification') {
            expect(ab.config.condition).toBe('amplify-vs-higher-attack');
            expect(ab.config.ampPct).toBe(50);
            expect(ab.config.procChance).toBeCloseTo(0.20);
        } else {
            throw new Error('Expected outgoing-amplification config');
        }
    });

    it('has no common variant → no ability', () => {
        expect(buildForImplant('GIANT_SLAYER', 'common')).toEqual([]);
    });

    it('emits correct procChance for uncommon (≈ 0.12)', () => {
        const ab = buildForImplant('GIANT_SLAYER', 'uncommon')[0];
        if (ab.config.type === 'outgoing-amplification') {
            expect(ab.config.ampPct).toBe(50);
            expect(ab.config.procChance).toBeCloseTo(0.12);
        } else {
            throw new Error('Expected outgoing-amplification config');
        }
    });
});
