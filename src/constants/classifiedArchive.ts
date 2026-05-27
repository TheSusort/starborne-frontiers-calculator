export interface ClassifiedFragment {
    id: string;
    title: string;
    hintLine: string;
    authCode: string;
    body: string;
    barColorClass: string;
    sourceEggSlug: string;
}

export const CLASSIFIED_FRAGMENTS: ClassifiedFragment[] = [
    {
        id: 'the-mechanisms',
        title: 'The Doors Were Always There',
        hintLine: 'GRAVIMETRIC SURVEY — TAU SCORPII REGION — BINDERBURG INTERNAL',
        authCode: 'DOOR-7A',
        barColorClass: 'text-indigo-400',
        sourceEggSlug: 'the-mechanisms',
        body: `[PLACEHOLDER — awaiting dev lore]\n\nThe mechanisms predate every recorded civilisation. Gelecek derived the Translocation Drive from them. Binderburg has been quietly fortifying stations in their vicinity for decades.\n\nNeither faction understands what they actually are.\n\nThey are not artifacts. They are not ruins.\n\nThey are doors.`,
    },
    {
        id: 'the-bludgeon',
        title: 'First Contact — Field Report',
        hintLine: 'ANOMALY DESIGNATION: THE_BLUDGEON — GELECEK FIELD INTELLIGENCE',
        authCode: 'HIVE-3X',
        barColorClass: 'text-yellow-400',
        sourceEggSlug: 'the-bludgeon',
        body: `[PLACEHOLDER — awaiting dev lore]\n\nFirst contact was not recognised as contact.\n\nArmored plating that reforms around damage. Communications no scanner has ever detected. Swarming offshoots responding to a signal that cannot be found.\n\nThe researchers thought they were observing a weapon.\n\nThey were being observed.`,
    },
    {
        id: 'the-abyss',
        title: 'Internal Memo — Blockade Command',
        hintLine: 'SPIRAL EXPANSE BLOCKADE — JOINT FACTION COMMUNIQUÉ — EYES ONLY',
        authCode: 'KEEP-OUT',
        barColorClass: 'text-purple-400',
        sourceEggSlug: 'the-abyss',
        body: `[PLACEHOLDER — awaiting dev lore]\n\nAll six factions agreed to the blockade.\n\nThis has never happened before. It has never happened since.\n\nThe official statement says the anomaly is a navigational hazard. The classified addendum says the blockade is not to keep ships out.\n\nIt is to keep something in.\n\nIt is no longer working.`,
    },
    {
        id: 'furnace-of-heaven',
        title: 'Furnace Signal — Decrypted Packet',
        hintLine: 'ENCRYPTED SIGNAL — ORIGIN: FURNACE OF HEAVEN NEBULA — UNATTRIBUTED',
        authCode: 'ALREADY',
        barColorClass: 'text-orange-400',
        sourceEggSlug: 'furnace-of-heaven',
        body: `[PLACEHOLDER — awaiting dev lore]\n\nThe signal has been broadcasting for longer than the blockade has existed.\n\nThree probes and one unarmed scout were dispatched to triangulate. None returned.\n\nThe signal is not a warning.\n\nIt is not a distress call.\n\nDecryption analysis suggests it is a census.`,
    },
];

export function readUnlocked(): string[] {
    try {
        const raw = localStorage.getItem('classified_unlocked');
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
    } catch {
        return [];
    }
}

export function writeUnlocked(ids: string[]): void {
    localStorage.setItem('classified_unlocked', JSON.stringify(ids));
}
