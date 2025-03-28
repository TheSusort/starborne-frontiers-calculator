import { JSDOM } from 'jsdom';
import fetch from 'node-fetch';

export interface BuffData {
    name: string;
    description: string;
}

export async function fetchBuffsFromRocky(shipName: string): Promise<BuffData[]> {
    try {
        const targetUrl = `https://www.rockyfrontiers.com/units/${shipName.toLowerCase()}`;

        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.statusText}`);
        }

        const html = await response.text();
        const dom = new JSDOM(html);
        const doc = dom.window.document;

        // Find all buff items
        const buffItems = doc.querySelectorAll('body > .w-dyn-list .w-dyn-item');
        const buffs: BuffData[] = [];

        buffItems.forEach((item) => {
            const name = item.querySelector('p.paragraph')?.textContent?.trim();
            const divBlock3Text = item.querySelector('div.div-block-3')?.textContent?.trim();
            const description =
                divBlock3Text && divBlock3Text.length > 0
                    ? divBlock3Text
                    : item.querySelector('p.paragraph-2')?.textContent?.trim();

            if (name && description) {
                buffs.push({ name, description });
            }
        });

        return buffs;
    } catch (error) {
        console.error('Error fetching buff data:', error);
        throw error;
    }
}
