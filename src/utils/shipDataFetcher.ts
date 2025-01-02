import { SHIPS } from '../constants/ships';

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

export async function fetchShipDataFromRocky(shipName: string): Promise<ParsedShipData | null> {
    try {
        const corsProxy = 'https://thingproxy.freeboard.io/fetch/';
        const targetUrl = `https://www.rockyfrontiers.com/units/${shipName.toLowerCase()}`;

        const response = await fetch(`${corsProxy}${targetUrl}`, {
            headers: {
                Origin: window.location.origin,
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const html = await response.text();

        // Create a DOM parser
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Check if the page contains ship data
        const statsDiv = doc.querySelector('.w-tab-pane[data-w-tab="Level 60"]');
        if (!statsDiv) {
            console.error('Could not find stats div in the response');
            return null;
        }

        // Extract stats with error checking
        const statElements = statsDiv.querySelectorAll('.base-stat-number');
        if (statElements.length < 8) {
            console.error('Incomplete stat data found');
            return null;
        }

        const baseStats = {
            hp: parseFloat(statElements[0]?.textContent?.replace(/,/g, '') || '0'),
            attack: parseFloat(statElements[1]?.textContent?.replace(/,/g, '') || '0'),
            defence: parseFloat(statElements[2]?.textContent?.replace(/,/g, '') || '0'),
            hacking: parseFloat(statElements[3]?.textContent?.replace(/,/g, '') || '0'),
            security: parseFloat(statElements[4]?.textContent?.replace(/,/g, '') || '0'),
            crit: parseFloat(
                statElements[5]?.textContent?.replace(/,/g, '').replace('%', '') || '0'
            ),
            critDamage: parseFloat(
                statElements[6]?.textContent?.replace(/,/g, '').replace('%', '') || '0'
            ),
            speed: parseFloat(statElements[7]?.textContent?.replace(/,/g, '') || '0'),
            healModifier: 0,
        };

        const faction = doc
            .querySelector('.database-page-item-faction')
            ?.textContent?.trim()
            .toUpperCase()
            .replace(' ', '_');
        const type = doc
            .querySelector('.database-page-item-faction ~ .database-overview-stat')
            ?.textContent?.trim()
            .toUpperCase();
        const rarity = doc
            .querySelector('.database-page-item-rarity')
            ?.textContent?.trim()
            .toLowerCase();

        if (!faction || !type || !rarity) {
            console.error('Missing required ship data (faction, type, or rarity)');
            return null;
        }

        return {
            baseStats,
            faction,
            type,
            rarity,
        };
    } catch (error) {
        console.error('Error fetching ship data:', error);
        throw error; // Re-throw to handle in the component
    }
}

export async function fetchShipData(shipName: string): Promise<ParsedShipData | null> {
    // fetch ship data from constant ships
    const shipData = SHIPS[shipName.toUpperCase().replace(' ', '_') as keyof typeof SHIPS];
    if (!shipData) {
        return null;
    }

    const parsedShipData: ParsedShipData = {
        baseStats: {
            hp: shipData.hp,
            attack: shipData.attack,
            defence: shipData.defense,
            hacking: shipData.hacking,
            security: shipData.security,
            crit: shipData.critRate,
            critDamage: shipData.critDamage,
            speed: shipData.speed,
            healModifier: 0,
        },
        faction: shipData.faction.toUpperCase().replace(' ', '_'),
        type: shipData.role.toUpperCase(),
        rarity: shipData.rarity.toLowerCase(),
    };

    return parsedShipData;
}
