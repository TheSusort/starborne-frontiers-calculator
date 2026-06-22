import { describe, it, expect } from 'vitest';
import { buildEquipmentAbilities } from '../buildEquipmentAbilities';
import { Ship } from '../../../types/ship';
import { GearPiece } from '../../../types/gear';
import { Ability } from '../../../types/abilities';
import { GEAR_SETS } from '../../../constants/gearSets';
import { BUFFS } from '../../../constants/buffs';
import { parseBuffEffects } from '../../calculators/buffParser';

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
            expect(ab.config.procChance).toBeCloseTo(0.2);
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

// ---------------------------------------------------------------------------
// D-PR4: Insidiousness implant (reactive damage on debuff-inflicted)
// ---------------------------------------------------------------------------
describe('Insidiousness implant', () => {
    it('rare → reactive damage with trigger on-debuff-inflicted, multiplier 80, hits 1, procChance ≈ 0.14', () => {
        const abilities = buildForImplant('INSIDIOUSNESS', 'rare');
        expect(abilities).toHaveLength(1);
        const ab = abilities[0];
        expect(ab.type).toBe('damage');
        expect(ab.target).toBe('enemy');
        expect(ab.trigger).toBe('on-debuff-inflicted');
        expect(ab.conditions).toEqual([]);
        expect(ab.procChance).toBeCloseTo(0.14);
        expect(ab.autoFilled).toBe(true);
        if (ab.config.type === 'damage') {
            expect(ab.config.multiplier).toBe(80);
            expect(ab.config.hits).toBe(1);
        } else {
            throw new Error('Expected damage config');
        }
    });

    it('legendary → multiplier 100, procChance ≈ 0.21', () => {
        const ab = buildForImplant('INSIDIOUSNESS', 'legendary')[0];
        expect(ab.trigger).toBe('on-debuff-inflicted');
        expect(ab.procChance).toBeCloseTo(0.21);
        if (ab.config.type === 'damage') {
            expect(ab.config.multiplier).toBe(100);
            expect(ab.config.hits).toBe(1);
        } else {
            throw new Error('Expected damage config');
        }
    });

    it('common → multiplier 60, procChance ≈ 0.10', () => {
        const ab = buildForImplant('INSIDIOUSNESS', 'common')[0];
        expect(ab.procChance).toBeCloseTo(0.1);
        if (ab.config.type === 'damage') {
            expect(ab.config.multiplier).toBe(60);
        } else {
            throw new Error('Expected damage config');
        }
    });

    it('epic → multiplier 90, procChance ≈ 0.17', () => {
        const ab = buildForImplant('INSIDIOUSNESS', 'epic')[0];
        expect(ab.procChance).toBeCloseTo(0.17);
        if (ab.config.type === 'damage') {
            expect(ab.config.multiplier).toBe(90);
        } else {
            throw new Error('Expected damage config');
        }
    });

    it('uncommon → multiplier 70, procChance ≈ 0.12', () => {
        const ab = buildForImplant('INSIDIOUSNESS', 'uncommon')[0];
        expect(ab.procChance).toBeCloseTo(0.12);
        if (ab.config.type === 'damage') {
            expect(ab.config.multiplier).toBe(70);
        } else {
            throw new Error('Expected damage config');
        }
    });
});

// ---------------------------------------------------------------------------
// D-PR5: Nourishment implant (heal-amplification, target-hp-below-self, deterministic)
// ---------------------------------------------------------------------------
describe('Nourishment implant', () => {
    it('epic → heal-amplification, condition target-hp-below-self, ampPct 20, no procChance', () => {
        const abilities = buildForImplant('NOURISHMENT', 'epic');
        expect(abilities).toHaveLength(1);
        const ab = abilities[0];
        expect(ab.type).toBe('heal-amplification');
        expect(ab.target).toBe('self');
        expect(ab.autoFilled).toBe(true);
        expect(ab.procChance).toBeUndefined();
        if (ab.config.type === 'heal-amplification') {
            expect(ab.config.condition).toBe('target-hp-below-self');
            expect(ab.config.ampPct).toBe(20);
            expect(ab.config.procChance).toBeUndefined();
        } else {
            throw new Error('Expected heal-amplification config');
        }
    });

    it('legendary → ampPct 30', () => {
        const ab = buildForImplant('NOURISHMENT', 'legendary')[0];
        if (ab.config.type === 'heal-amplification') {
            expect(ab.config.ampPct).toBe(30);
        } else {
            throw new Error('Expected heal-amplification config');
        }
    });

    it('common → no ability (no common variant)', () => {
        expect(buildForImplant('NOURISHMENT', 'common')).toEqual([]);
    });
});

// D-PR5: Vivacious Repair implant (heal-amplification, target-below-25, probabilistic)
// ---------------------------------------------------------------------------
describe('Vivacious Repair implant', () => {
    it('legendary → heal-amplification, condition target-below-25, ampPct 100, procChance ≈ 0.32', () => {
        const abilities = buildForImplant('VIVACIOUS_REPAIR', 'legendary');
        expect(abilities).toHaveLength(1);
        const ab = abilities[0];
        expect(ab.type).toBe('heal-amplification');
        expect(ab.target).toBe('self');
        expect(ab.autoFilled).toBe(true);
        if (ab.config.type === 'heal-amplification') {
            expect(ab.config.condition).toBe('target-below-25');
            expect(ab.config.ampPct).toBe(100);
            expect(ab.config.procChance).toBeCloseTo(0.32);
        } else {
            throw new Error('Expected heal-amplification config');
        }
    });

    it('rare → procChance ≈ 0.21', () => {
        const ab = buildForImplant('VIVACIOUS_REPAIR', 'rare')[0];
        if (ab.config.type === 'heal-amplification') {
            expect(ab.config.ampPct).toBe(100);
            expect(ab.config.procChance).toBeCloseTo(0.21);
        } else {
            throw new Error('Expected heal-amplification config');
        }
    });

    it('common → no ability (no common variant)', () => {
        expect(buildForImplant('VIVACIOUS_REPAIR', 'common')).toEqual([]);
    });

    it('uncommon → no ability (no uncommon variant)', () => {
        expect(buildForImplant('VIVACIOUS_REPAIR', 'uncommon')).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// D-PR6: Exuberance implant (incoming-heal-amplification, probabilistic)
// ---------------------------------------------------------------------------
describe('Exuberance implant', () => {
    it('epic → incoming-heal-amplification, ampPct 14, procChance ≈ 0.24', () => {
        const abilities = buildForImplant('EXUBERANCE', 'epic');
        expect(abilities).toHaveLength(1);
        const ab = abilities[0];
        expect(ab.type).toBe('incoming-heal-amplification');
        expect(ab.target).toBe('self');
        expect(ab.autoFilled).toBe(true);
        if (ab.config.type === 'incoming-heal-amplification') {
            expect(ab.config.ampPct).toBe(14);
            expect(ab.config.procChance).toBeCloseTo(0.24);
        } else {
            throw new Error('Expected incoming-heal-amplification config');
        }
    });

    it('legendary → ampPct 15, procChance ≈ 0.30', () => {
        const abilities = buildForImplant('EXUBERANCE', 'legendary');
        expect(abilities).toHaveLength(1);
        const ab = abilities[0];
        if (ab.config.type === 'incoming-heal-amplification') {
            expect(ab.config.ampPct).toBe(15);
            expect(ab.config.procChance).toBeCloseTo(0.3);
        } else {
            throw new Error('Expected incoming-heal-amplification config');
        }
    });

    it('common → no ability (no common variant)', () => {
        expect(buildForImplant('EXUBERANCE', 'common')).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// D-PR7: Last Wish (on-death repair all allies)
// ---------------------------------------------------------------------------
describe('Last Wish (on-death repair all allies)', () => {
    it('legendary → heal/all-allies/on-destroyed, basis target-hp, pct 32, noCrit', () => {
        const piece = makePiece({ id: 'lw-1', setBonus: 'LAST_WISH', rarity: 'legendary' });
        const ship = makeShip({ implants: { implant_major: 'lw-1' } });
        const abilities = buildEquipmentAbilities(ship, makeGetGearPiece({ 'lw-1': piece }));
        const a = abilities.find((x) => x.id.startsWith('equip-implant-LAST_WISH'));
        expect(a).toBeDefined();
        expect(a!.trigger).toBe('on-destroyed');
        expect(a!.target).toBe('all-allies');
        expect(a!.config).toMatchObject({
            type: 'heal',
            basis: 'target-hp',
            pct: 32,
            noCrit: true,
        });
    });
    it('uncommon → pct 14', () => {
        const piece = makePiece({ id: 'lw-2', setBonus: 'LAST_WISH', rarity: 'uncommon' });
        const ship = makeShip({ implants: { implant_major: 'lw-2' } });
        const abilities = buildEquipmentAbilities(ship, makeGetGearPiece({ 'lw-2': piece }));
        const a = abilities.find((x) => x.id.startsWith('equip-implant-LAST_WISH'));
        expect(a!.config).toMatchObject({ type: 'heal', pct: 14 });
    });
    it('common → no ability (no common variant)', () => {
        const piece = makePiece({ id: 'lw-3', setBonus: 'LAST_WISH', rarity: 'common' });
        const ship = makeShip({ implants: { implant_major: 'lw-3' } });
        const abilities = buildEquipmentAbilities(ship, makeGetGearPiece({ 'lw-3': piece }));
        expect(abilities.find((x) => x.id.startsWith('equip-implant-LAST_WISH'))).toBeUndefined();
    });
});

// D-PR5: Second Wind implant (reactive self-heal on crit-received)
// ---------------------------------------------------------------------------
describe('Second Wind implant', () => {
    it('epic → reactive heal with trigger on-attacked, triggerCritFilter crit, target self, basis hp, pct 10, procChance ≈ 0.12', () => {
        const abilities = buildForImplant('SECOND_WIND', 'epic');
        expect(abilities).toHaveLength(1);
        const ab = abilities[0];
        expect(ab.trigger).toBe('on-attacked');
        expect(ab.triggerCritFilter).toBe('crit');
        expect(ab.target).toBe('self');
        expect(ab.conditions).toEqual([]);
        expect(ab.autoFilled).toBe(true);
        expect(ab.procChance).toBeCloseTo(0.12);
        expect(ab.config.type).toBe('heal');
        if (ab.config.type === 'heal') {
            expect(ab.config.pct).toBe(10);
            expect(ab.config.basis).toBe('hp');
        } else {
            throw new Error('Expected heal config');
        }
    });

    it('legendary → procChance ≈ 0.16', () => {
        const ab = buildForImplant('SECOND_WIND', 'legendary')[0];
        expect(ab.procChance).toBeCloseTo(0.16);
    });

    it('common → no ability (no common variant)', () => {
        expect(buildForImplant('SECOND_WIND', 'common')).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// D-PR7: Battlecry (on-death Inc. Damage Down to allies — emit-only)
// ---------------------------------------------------------------------------
describe('Battlecry (on-death Inc. Damage Down to allies — emit-only)', () => {
    it('legendary → buff/all-allies/on-destroyed, Inc. Damage Down II, duration 3', () => {
        const piece = makePiece({ id: 'bc-1', setBonus: 'BATTLECRY', rarity: 'legendary' });
        const ship = makeShip({ implants: { implant_major: 'bc-1' } });
        const abilities = buildEquipmentAbilities(ship, makeGetGearPiece({ 'bc-1': piece }));
        const a = abilities.find((x) => x.id.startsWith('equip-implant-BATTLECRY'));
        expect(a).toBeDefined();
        expect(a!.trigger).toBe('on-destroyed');
        expect(a!.target).toBe('all-allies');
        expect(a!.config).toMatchObject({
            type: 'buff',
            buffName: 'Inc. Damage Down II',
            duration: 3,
        });
        expect(
            (a!.config as { parsedEffects: { incomingDamage?: number } }).parsedEffects
                .incomingDamage
        ).toBe(-30);
    });
    it('common → duration 1', () => {
        const piece = makePiece({ id: 'bc-2', setBonus: 'BATTLECRY', rarity: 'common' });
        const ship = makeShip({ implants: { implant_major: 'bc-2' } });
        const abilities = buildEquipmentAbilities(ship, makeGetGearPiece({ 'bc-2': piece }));
        const a = abilities.find((x) => x.id.startsWith('equip-implant-BATTLECRY'));
        expect(a!.config).toMatchObject({ type: 'buff', duration: 1 });
    });
});

// ---------------------------------------------------------------------------
// D-PR7: Martyrdom (on-death Disable the killer — emit-only)
// ---------------------------------------------------------------------------
describe('Martyrdom (on-death Disable the killer — emit-only)', () => {
    it('legendary → debuff/enemy/on-destroyed, Disable, application apply, duration 2', () => {
        const piece = makePiece({ id: 'm-1', setBonus: 'MARTYRDOM', rarity: 'legendary' });
        const ship = makeShip({ implants: { implant_ultimate: 'm-1' } });
        const abilities = buildEquipmentAbilities(ship, makeGetGearPiece({ 'm-1': piece }));
        const a = abilities.find((x) => x.id.startsWith('equip-implant-MARTYRDOM'));
        expect(a).toBeDefined();
        expect(a!.trigger).toBe('on-destroyed');
        expect(a!.target).toBe('enemy');
        expect(a!.config).toMatchObject({
            type: 'debuff',
            buffName: 'Disable',
            application: 'apply',
            duration: 2,
        });
    });
    it('rare → duration 1', () => {
        const piece = makePiece({ id: 'm-2', setBonus: 'MARTYRDOM', rarity: 'rare' });
        const ship = makeShip({ implants: { implant_ultimate: 'm-2' } });
        const abilities = buildEquipmentAbilities(ship, makeGetGearPiece({ 'm-2': piece }));
        const a = abilities.find((x) => x.id.startsWith('equip-implant-MARTYRDOM'));
        expect(a!.config).toMatchObject({ type: 'debuff', duration: 1 });
    });
    it('epic → no ability (only rare + legendary variants exist)', () => {
        const piece = makePiece({ id: 'm-3', setBonus: 'MARTYRDOM', rarity: 'epic' });
        const ship = makeShip({ implants: { implant_ultimate: 'm-3' } });
        const abilities = buildEquipmentAbilities(ship, makeGetGearPiece({ 'm-3': piece }));
        expect(abilities.find((x) => x.id.startsWith('equip-implant-MARTYRDOM'))).toBeUndefined();
    });
});

describe('Power Infused Nanobots buff (D-PR9 — Font of Power, emit-only)', () => {
    it('exists in the buff corpus as a buff', () => {
        const buff = BUFFS.find((b) => b.name === 'Power Infused Nanobots');
        expect(buff).toBeDefined();
        expect(buff!.type).toBe('buff');
    });

    it('parses to no stat effect (emit-only — real effect deferred to D-PR10)', () => {
        const buff = BUFFS.find((b) => b.name === 'Power Infused Nanobots');
        const effects = parseBuffEffects(buff!.name, buff!.description);
        // Emit-only: the description has no leading +/- sign before "attack", so
        // nothing parses → applying the buff is a no-op.
        expect(Object.keys(effects)).toHaveLength(0);
    });
});
