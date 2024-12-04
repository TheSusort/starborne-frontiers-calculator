interface ParsedShipData {
    baseStats: {
        hp: number;
        attack: number;
        defence: number;
        hacking: number;
        security: number;
        crit: number;
        critDamage: number;
        speed: number;
        healModifier: number;
    };
    faction: string;
    type: string;
    rarity: string;
}

export async function fetchShipData(shipName: string): Promise<ParsedShipData | null> {
    try {
        // Using a CORS proxy service
        const corsProxy = 'https://corsproxy.io/?';
        const targetUrl = `https://www.rockyfrontiers.com/units/${shipName.toLowerCase()}`;

        const response = await fetch(`${corsProxy}${encodeURIComponent(targetUrl)}`, {
            headers: {
                'Origin': window.location.origin,
            },
        });

        const html = await response.text();


        // Create a DOM parser
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        console.log(doc);
        // Extract stats from Level 60 tab
        const statsDiv = doc.querySelector('.w-tab-pane[data-w-tab="Level 60"]');
        const baseStats = {
            hp: parseFloat(statsDiv?.querySelectorAll('.base-stat-number')?.[0]?.textContent?.replace(/,/g, '') || '0'),
            attack: parseFloat(statsDiv?.querySelectorAll('.base-stat-number')?.[1]?.textContent?.replace(/,/g, '') || '0'),
            defence: parseFloat(statsDiv?.querySelectorAll('.base-stat-number')?.[2]?.textContent?.replace(/,/g, '') || '0'),
            hacking: parseFloat(statsDiv?.querySelectorAll('.base-stat-number')?.[3]?.textContent?.replace(/,/g, '') || '0'),
            security: parseFloat(statsDiv?.querySelectorAll('.base-stat-number')?.[4]?.textContent?.replace(/,/g, '') || '0'),
            crit: parseFloat(statsDiv?.querySelectorAll('.base-stat-number')?.[5]?.textContent?.replace(/,/g, '').replace('%', '') || '0'),
            critDamage: parseFloat(statsDiv?.querySelectorAll('.base-stat-number')?.[6]?.textContent?.replace(/,/g, '').replace('%', '') || '0'),
            speed: parseFloat(statsDiv?.querySelectorAll('.base-stat-number')?.[7]?.textContent?.replace(/,/g, '') || '0'),
            healModifier: 0
        };
        console.log(baseStats);

        // Extract faction, type and rarity
        const faction = doc.querySelector('.database-page-item-faction')?.textContent?.trim().toUpperCase().replace(' ', '_') || '';
        const type = doc.querySelector('.database-page-item-faction ~ .database-overview-stat')?.textContent?.trim().toUpperCase() || '';
        const rarity = doc.querySelector('.database-page-item-rarity')?.textContent?.trim().toLowerCase() || '';

        console.log(faction, type, rarity);
        return {
            baseStats,
            faction,
            type,
            rarity
        };
    } catch (error) {
        console.error('Error fetching ship data:', error);
        return null;
    }
}