import { describe, it, expect } from 'vitest';
import { extractShipText, extractArticleText } from '../../utils/extractLoreText';
import { Ship } from '../../types/ship';
import { LoreArticle } from '../../constants/websiteLore';

const makeShip = (overrides: Partial<Ship>): Ship =>
    ({ id: '1', name: 'Test', rarity: 'common', ...overrides }) as Ship;

describe('extractShipText', () => {
    it('returns just the ship name when ship has no bio or quote', () => {
        expect(extractShipText(makeShip({}))).toBe('Test');
    });

    it('includes quote and quoteAuthor', () => {
        const ship = makeShip({ quote: 'I will return', quoteAuthor: 'Vex' });
        expect(extractShipText(ship)).toContain('"I will return" — Vex.');
    });

    it('includes quote without author when quoteAuthor is absent', () => {
        const ship = makeShip({ quote: 'Solo quote' });
        expect(extractShipText(ship)).toContain('"Solo quote".');
    });

    it('includes name and bio when quote is absent', () => {
        const ship = makeShip({ bio: 'Plain bio text' });
        expect(extractShipText(ship)).toBe('Test\n\nPlain bio text');
    });

    it('adds pause period after heading and strips tags from bio', () => {
        const ship = makeShip({ bio: '<h4>Chapter</h4>Text' });
        const result = extractShipText(ship);
        expect(result).not.toContain('<h4>');
        expect(result).toContain('Chapter.');
        expect(result).toContain('Text');
    });

    it('strips bare <br> tags (no attributes)', () => {
        const ship = makeShip({ bio: 'Line one<br>Line two' });
        expect(extractShipText(ship)).not.toContain('<br>');
    });

    it('collapses multiple inline spaces left by tag removal', () => {
        const ship = makeShip({ bio: 'A<h4>B</h4>C' });
        const result = extractShipText(ship);
        // Each line must not contain consecutive spaces
        result.split('\n').forEach((line) => {
            expect(line).not.toMatch(/ {2,}/);
        });
    });

    it('joins quote block and bio with double newline', () => {
        const ship = makeShip({ quote: 'Words', bio: 'Bio text' });
        const result = extractShipText(ship);
        expect(result).toContain('\n\n');
        expect(result.indexOf('\n\n')).toBeGreaterThan(0);
    });
});

describe('extractArticleText', () => {
    it('prepends article title to body', () => {
        const article: LoreArticle = {
            title: 'Enemy Territory',
            slug: 's',
            body: 'Body text\n\nParagraph two',
            sourceUrl: '',
        };
        expect(extractArticleText(article)).toBe('Enemy Territory\n\nBody text\n\nParagraph two');
    });
});
