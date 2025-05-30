import { JSDOM } from 'jsdom';
import fetch from 'node-fetch';
import { BaseStats } from '../../types/stats';

export interface ParsedShipData {
    baseStats: BaseStats;
    faction: string;
    type: string;
    rarity: string;
    affinity: string;
    imageKey: string;
    activeSkillText: string;
    chargeSkillText: string;
    firstPassiveSkillText: string;
    secondPassiveSkillText: string;
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
            throw new Error(`HTTP error! status: ${response.statusText}`);
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

        // image urls looks like this: https://cdn.prod.website-files.com/660f1bf7e4aae68121d0ff5d/6623820e50414800d0262797_66231f1529e837f9924968de_Atlas_11_Portrait.png
        // we want imageKey to be Atlas_11_Portrait.png
        const imageName = doc
            .querySelector('.database-page-item-image')
            ?.getAttribute('src')
            ?.split('/')
            .pop();

        // slice imageName by _ and take the last 3 elements
        const imageKey = imageName?.split('_').slice(-3).join('_');

        const activeSkillText = doc
            .querySelector('.containerActive div:last-child .skilldescription')
            ?.textContent?.trim();
        const chargeSkillText = doc
            .querySelector('.containerCharge div:last-child .skilldescription')
            ?.textContent?.trim();
        const firstPassiveSkillText = doc
            .querySelector('.passive1 .skilldescription')
            ?.textContent?.trim();
        const secondPassiveSkillText = doc
            .querySelector('.passive2 .skilldescription')
            ?.textContent?.trim();

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
            imageKey: imageKey || '',
            activeSkillText: activeSkillText || '',
            chargeSkillText: chargeSkillText || '',
            firstPassiveSkillText: firstPassiveSkillText || '',
            secondPassiveSkillText: secondPassiveSkillText || '',
        };
    } catch (error) {
        console.error('Error fetching ship data:', error);
        throw error;
    }
}
