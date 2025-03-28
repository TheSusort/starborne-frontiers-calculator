import { BUFFS, Buff } from '../constants/buffs';

function escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function findBuffsInText(text: string): string[] {
    if (!text) return [];

    // Create a regex pattern from all buff names, properly escaping special characters
    const buffNames = BUFFS.map((buff: Buff) => escapeRegExp(buff.name));
    const pattern = new RegExp(buffNames.join('|'), 'g');

    // Find all matches in the text
    const matches = text.match(pattern) || [];

    // Remove duplicates and return
    return [...new Set(matches)];
}

export function getBuffDescription(buffName: string): string | undefined {
    return BUFFS.find((buff: Buff) => buff.name === buffName)?.description;
}
