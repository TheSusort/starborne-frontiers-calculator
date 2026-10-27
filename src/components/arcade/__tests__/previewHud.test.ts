import { describe, expect, it } from 'vitest';
import {
    previewAlpha,
    previewAlphaFor,
    previewBannerContent,
    previewCardSize,
    spreadLabels,
} from '../previewHud';
import type { Ship } from '../../../types/ship';
import { createGame, PREVIEW_TOTAL_SECONDS } from '../../../utils/arcade/engine';
import { PREVIEW_EASE_SECONDS } from '../../../utils/arcade/constants';

describe('previewAlpha', () => {
    it('is 0 at both ends, 1 through the hold, and climbs with the slow-down', () => {
        expect(previewAlpha(0)).toBe(0);
        expect(previewAlpha(PREVIEW_EASE_SECONDS / 2)).toBeCloseTo(0.5);
        expect(previewAlpha(PREVIEW_EASE_SECONDS + 0.5)).toBe(1);
        expect(previewAlpha(PREVIEW_TOTAL_SECONDS - PREVIEW_EASE_SECONDS / 2)).toBeCloseTo(0.5);
        expect(previewAlpha(PREVIEW_TOTAL_SECONDS)).toBe(0);
    });

    it('applies only to the row being previewed', () => {
        const game = createGame(1);
        game.preview = { checkpointId: 7, elapsed: 1 };
        expect(previewAlphaFor(game, 7)).toBe(1);
        expect(previewAlphaFor(game, 8)).toBe(0);
        game.preview = null;
        expect(previewAlphaFor(game, 7)).toBe(0);
    });
});

describe('spreadLabels', () => {
    it('leaves labels that already clear each other where they are', () => {
        expect(spreadLabels([100, 300], 80, 10, 1000, 8)).toEqual([100, 300]);
    });

    it('pushes overlapping labels apart about their midpoint', () => {
        const [a, b] = spreadLabels([495, 505], 80, 10, 1000, 8);
        expect(b - a).toBe(90);
        expect((a + b) / 2).toBe(500);
    });

    it('keeps the pair on screen, and keeps the gates in order', () => {
        const [a, b] = spreadLabels([20, 25], 80, 10, 1000, 8);
        expect(a - 40).toBeGreaterThanOrEqual(8);
        expect(b - a).toBe(90);
        const [r, l] = spreadLabels([505, 495], 80, 10, 1000, 8);
        expect(r).toBeGreaterThan(l);
    });
});

describe('previewBannerContent', () => {
    const ship = (id: string) => ({ id, name: id.toUpperCase() }) as unknown as Ship;
    const portrait = (s: Ship) => `img/${s.id}`;

    it('names the challenge and stakes, with no allies on a one-ship row', () => {
        const c = { id: 3, challenge: 'tank' as const, stakes: 'win-or-die' as const };
        expect(
            previewBannerContent(c, { kind: 'single', gates: [ship('a'), ship('b')] }, portrait)
        ).toEqual({ checkpointId: 3, text: 'TANK · WIN OR DIE', allies: [] });
    });

    it("lists a team row's two allies", () => {
        const [a, b, c, d, e, f, g, h] = 'abcdefgh'.split('').map(ship);
        const content = previewBannerContent(
            { id: 4, challenge: 'team', stakes: 'power-up' },
            {
                kind: 'team',
                gates: [
                    [a, b, c],
                    [d, e, f],
                ],
                allies: [g, h],
            },
            portrait
        );
        expect(content.text).toBe('3v3 · POWER-UP');
        expect(content.allies).toEqual([
            { name: 'G', portraitUrl: 'img/g' },
            { name: 'H', portraitUrl: 'img/h' },
        ]);
    });
});

describe('previewCardSize', () => {
    const space = { pad: 6, gap: 12, margin: 8 };

    it('fits two three-portrait team cards on a phone-width screen', () => {
        for (const wanted of [44, 80, 160]) {
            const { colW, portrait, width } = previewCardSize(390, 3, wanted, true, space);
            expect(2 * width + space.gap + 2 * space.margin).toBeLessThanOrEqual(390);
            expect(portrait).toBeLessThanOrEqual(colW);
        }
    });

    it('keeps the wanted size when the screen has room', () => {
        const { colW, portrait } = previewCardSize(1400, 3, 44, true, space);
        expect(portrait).toBe(44);
        expect(colW).toBe(60);
        expect(previewCardSize(1400, 1, 64, false, space).colW).toBe(120);
    });
});
