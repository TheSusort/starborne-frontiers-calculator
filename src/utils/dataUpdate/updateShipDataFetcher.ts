import { JSDOM } from 'jsdom';
import fetch from 'node-fetch';
import { BaseStats } from '../../types/stats';

export interface ParsedShipData {
    baseStats: BaseStats;
    faction: string;
    type: string;
    rarity: string;
    affinity: string;
}

export async function fetchShipDataFromRocky(shipName: string): Promise<ParsedShipData | null> {
    try {
        const targetUrl = `https://www.rockyfrontiers.com/units/${shipName.toLowerCase()}`;

        const response = await fetch(targetUrl, {
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            },
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const html = await response.text();
        const dom = new JSDOM(html);
        const doc = dom.window.document;

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
        const affinity = doc
            .querySelector('.database-page-item-affinity')
            ?.textContent?.trim()
            .toUpperCase();

        if (!faction || !type || !rarity || !affinity) {
            console.error('Missing required ship data (faction, type, or rarity)');
            return null;
        }

        return {
            baseStats,
            faction,
            type,
            rarity,
            affinity,
        };
    } catch (error) {
        console.error('Error fetching ship data:', error);
        throw error;
    }
}
