import { describe, it, expect, vi, afterEach } from 'vitest';
import { normaliseGearFields, type StoredGearPiece } from '../normaliseGearFields';
import { getEquipmentSlotLabel } from '../../../constants/gearTypes';

const stored = (overrides: Record<string, unknown> = {}): StoredGearPiece => ({
    id: 'gear-1',
    slot: 'weapon',
    level: 16,
    stars: 6,
    rarity: 'legendary',
    mainStat: { name: 'attack', value: 100, type: 'flat' },
    subStats: [],
    setBonus: 'ATTACK',
    ...overrides,
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('normaliseGearFields (#569)', () => {
    it('lowercases a legacy mixed-case rarity', () => {
        expect(normaliseGearFields(stored({ rarity: 'Epic' })).rarity).toBe('epic');
    });

    it("falls back to 'common' for an unreadable rarity, keeping the piece", () => {
        const result = normaliseGearFields(stored({ rarity: 42 }));
        expect(result.rarity).toBe('common');
        expect(result.id).toBe('gear-1');
    });

    it('keeps an unrecognised slot verbatim and warns, naming the piece and the value', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = normaliseGearFields(stored({ slot: 'antenna' }));
        expect(result.slot).toBe('antenna');
        expect(warn).toHaveBeenCalledTimes(1);
        expect(warn.mock.calls[0][0]).toContain('gear-1');
        expect(warn.mock.calls[0][0]).toContain('antenna');
    });

    it('keeps an unrecognised set verbatim without warning', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = normaliseGearFields(stored({ setBonus: 'RETIRED_SET' }));
        expect(result.setBonus).toBe('RETIRED_SET');
        expect(warn).not.toHaveBeenCalled();
    });

    it('turns a non-string set into null and a non-string slot into an empty string', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        const result = normaliseGearFields(stored({ setBonus: 7, slot: undefined }));
        expect(result.setBonus).toBeNull();
        expect(result.slot).toBe('');
    });

    it('leaves a valid piece unchanged and is idempotent', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const once = normaliseGearFields(stored({ slot: 'implant_major', setBonus: null }));
        expect(once).toEqual(stored({ slot: 'implant_major', setBonus: null }));
        expect(normaliseGearFields(once)).toEqual(once);
        expect(warn).not.toHaveBeenCalled();
    });
});

describe('getEquipmentSlotLabel', () => {
    it('labels both slot spaces and falls back to the raw id for an unrecognised slot', () => {
        expect(getEquipmentSlotLabel('sensor')).toBe('Sensors');
        expect(getEquipmentSlotLabel('implant_major')).toBe('Major');
        expect(getEquipmentSlotLabel('antenna')).toBe('antenna');
    });
});
