import { describe, expect, it } from 'vitest';
import { bountyPortraitUrl, shipPortraitUrl, shipSmallPortraitUrl } from '../shipPortrait';

describe('ship portrait urls', () => {
    it('the small portrait is the pilot _Portrait image, the big one stays _BigPortrait', () => {
        expect(shipSmallPortraitUrl('nova_key')).toContain('nova_key_Portrait.jpg');
        expect(shipPortraitUrl('nova_key')).toContain('nova_key_BigPortrait.jpg');
    });

    it('has none without an image key', () => {
        expect(shipSmallPortraitUrl(undefined)).toBeNull();
        expect(shipSmallPortraitUrl('')).toBeNull();
        expect(bountyPortraitUrl(undefined)).toBeNull();
    });

    it('a bounty portrait is the uploaded art scaled down, in an automatic format', () => {
        const url = bountyPortraitUrl('Mamma_Maglienza');
        expect(url).toContain('Mamma_Maglienza');
        expect(url).toMatch(/w_160/);
        expect(url).toMatch(/f_auto/);
    });
});
