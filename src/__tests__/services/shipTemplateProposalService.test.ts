import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    addShipTemplate,
    updateShipTemplate,
    NewShipTemplateData,
} from '../../services/shipTemplateProposalService';
import { supabase } from '../../config/supabase';

vi.mock('../../config/supabase', () => ({
    supabase: {
        from: vi.fn(),
    },
}));

const TEMPLATE: NewShipTemplateData = {
    name: 'Probe Ship',
    affinity: 'chemical',
    rarity: 'rare',
    faction: 'Atlas Syndicate',
    type: 'Attacker',
    hp: 1,
    attack: 2,
    defence: 3,
    hacking: 4,
    security: 5,
    critRate: 6,
    critDamage: 7,
    speed: 8,
    hpRegen: 0,
    shield: 0,
    shieldPenetration: 0,
    defensePenetration: 0,
    imageKey: '',
    activeSkillText: '',
    chargeSkillText: '',
    chargeSkillCharge: 0,
    firstPassiveSkillText: '',
    secondPassiveSkillText: '',
    thirdPassiveSkillText: '',
    activeTarget: 'front',
    activePattern: 'Pattern-Cone-Range-2',
    chargedTarget: 'all',
    chargedPattern: 'Pattern-All',
    definitionId: '',
};

const mockInsert = () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ insert });
    return insert;
};

const mockUpdate = () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    (supabase.from as ReturnType<typeof vi.fn>).mockReturnValue({ update });
    return update;
};

/** Both write paths enumerate their columns by hand, so a field added to
 *  NewShipTemplateData reaches the database only if it is listed at BOTH sites. These
 *  tests are the tripwire for that: `tsc` cannot catch a missing column because
 *  AdminPanel passes a structural superset into these functions. */
describe('ship template targeting columns', () => {
    beforeEach(() => vi.clearAllMocks());

    it('addShipTemplate writes all four targeting columns', async () => {
        const insert = mockInsert();

        await addShipTemplate(TEMPLATE);

        expect(insert).toHaveBeenCalledWith(
            expect.objectContaining({
                active_target: 'front',
                active_pattern: 'Pattern-Cone-Range-2',
                charged_target: 'all',
                charged_pattern: 'Pattern-All',
            })
        );
    });

    it('updateShipTemplate writes all four targeting columns', async () => {
        const update = mockUpdate();

        await updateShipTemplate('PROBE_SHIP', TEMPLATE);

        expect(update).toHaveBeenCalledWith(
            expect.objectContaining({
                active_target: 'front',
                active_pattern: 'Pattern-Cone-Range-2',
                charged_target: 'all',
                charged_pattern: 'Pattern-All',
            })
        );
    });

    // An empty charged column is not a missing value: parseShipTargeting reads it as
    // "this axis is the same as active". Persisting '' instead of null would make the
    // column truthy-but-unparseable on read.
    it.each([
        ['addShipTemplate', mockInsert, (data: NewShipTemplateData) => addShipTemplate(data)],
        [
            'updateShipTemplate',
            mockUpdate,
            (data: NewShipTemplateData) => updateShipTemplate('PROBE_SHIP', data),
        ],
    ] as const)('%s persists empty targeting fields as null', async (_name, mock, call) => {
        const write = mock();

        await call({
            ...TEMPLATE,
            activeTarget: '',
            activePattern: '',
            chargedTarget: '',
            chargedPattern: '',
        });

        expect(write).toHaveBeenCalledWith(
            expect.objectContaining({
                active_target: null,
                active_pattern: null,
                charged_target: null,
                charged_pattern: null,
            })
        );
    });

    // The form's own emptiness test is `.trim()`-based, so it never blocks a blank
    // pattern. A blank that reached the column would throw in `parsePattern` and, on a
    // charged column, would defeat the "same as active" fallback by being truthy.
    it.each([
        ['addShipTemplate', mockInsert, (data: NewShipTemplateData) => addShipTemplate(data)],
        [
            'updateShipTemplate',
            mockUpdate,
            (data: NewShipTemplateData) => updateShipTemplate('PROBE_SHIP', data),
        ],
    ] as const)('%s persists whitespace-only targeting fields as null', async (_n, mock, call) => {
        const write = mock();

        await call({
            ...TEMPLATE,
            activeTarget: '   ',
            activePattern: '\t',
            chargedTarget: ' ',
            chargedPattern: '  \n ',
        });

        expect(write).toHaveBeenCalledWith(
            expect.objectContaining({
                active_target: null,
                active_pattern: null,
                charged_target: null,
                charged_pattern: null,
            })
        );
    });

    it('preserves a pattern that merely has surrounding whitespace', async () => {
        const insert = mockInsert();

        await addShipTemplate({ ...TEMPLATE, activePattern: ' Pattern-Cone-Range-2 ' });

        expect(insert).toHaveBeenCalledWith(
            expect.objectContaining({ active_pattern: ' Pattern-Cone-Range-2 ' })
        );
    });
});
