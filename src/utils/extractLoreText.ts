import { Ship } from '../types/ship';
import { LoreArticle } from '../constants/websiteLore';

export function extractShipText(ship: Ship): string {
    const parts: string[] = [ship.name];

    if (ship.quote) {
        const attribution = ship.quoteAuthor ? ` — ${ship.quoteAuthor}` : '';
        parts.push(`"${ship.quote}"${attribution}.`);
    }

    if (ship.bio) {
        const stripped = ship.bio
            .replace(/<\/h[1-6]>/gi, '. ') // period after heading for TTS pause
            .replace(/<[^>]*>/g, ' ') // strip remaining tags including bare <br>
            .replace(/[ \t]+/g, ' ') // collapse consecutive spaces/tabs
            .trim();
        parts.push(stripped);
    }

    return parts.join('\n\n');
}

export function extractArticleText(article: LoreArticle): string {
    return `${article.title}\n\n${article.body}`;
}
