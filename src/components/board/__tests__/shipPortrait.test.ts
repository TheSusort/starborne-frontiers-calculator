import { describe, expect, it } from 'vitest';
import { shipPortraitUrl, shipSmallPortraitUrl } from '../shipPortrait';

describe('ship portrait urls', () => {
    it('the small portrait is the pilot _Portrait image, the big one stays _BigPortrait', () => {
        expect(shipSmallPortraitUrl('nova_key')).toContain('nova_key_Portrait.jpg');
        expect(shipPortraitUrl('nova_key')).toContain('nova_key_BigPortrait.jpg');
    });

    it('has none without an image key', () => {
        expect(shipSmallPortraitUrl(undefined)).toBeNull();
        expect(shipSmallPortraitUrl('')).toBeNull();
    });
});
