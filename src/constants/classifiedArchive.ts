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
        hintLine: 'BINDERBURG SURVEY LOG — TAU SCORPII — STRUCTURE CLASS: UNDEFINED',
        authCode: 'DOOR-7A',
        barColorClass: 'text-indigo-400',
        sourceEggSlug: 'the-mechanisms',
        body: `The first confirmed survey log dates to 2289. Binderburg had already been operating a research station in the vicinity for eleven years.\n\nWhen pressed — formally, and through back-channels — they described the mechanisms as a gravitational curiosity. Not worth the attention others were paying them. They did not answer follow-up questions.\n\nWhat Gelecek's research teams eventually documented across the Tau Scorpii cluster: five confirmed structures, seventeen more distributed along the event horizons of black holes across forty light-years. They do not decay. They predate the stars they orbit.\n\nThree years of investigation produced one major discovery: the mechanisms do not simply exist at the boundary of space-time distortion. They generate it. Gelecek's Translocation Drive was not invented. It was reverse-engineered from a process that was already here, operating on principles we still do not fully understand.\n\nBinderburg had been there first. Their stations were already fortified before Gelecek arrived.\n\nNeither faction understands what the mechanisms actually are. Binderburg simply stopped asking.\n\nThey are not artifacts. They are not ruins.\n\nThey are doors.`,
    },
    {
        id: 'the-bludgeon',
        title: 'First Contact — Field Report',
        hintLine: 'GELECEK FIELD INTEL — BLUNT-ALPHA CONTACT LOG — PLASMA SHELL',
        authCode: 'HIVE-3X',
        barColorClass: 'text-yellow-400',
        sourceEggSlug: 'the-bludgeon',
        body: `CONTACT DESIGNATION: BLUNT-ALPHA\nLEAD RESEARCHER: [REDACTED — DATA CORRUPTION]\n\nEntity first logged thirty-one days prior to this report. Mass: supercarrier class or greater. Origin: unconfirmed. Drive signature: absent. Jump wake: absent. The entity appears and disappears without mechanism we can identify.\n\nObservations:\n— Radiation pulses, periodic, source internal. Pattern is not random.\n— Auxiliary units, variable count, 12–40 at any time. Communication method: undetectable. Response latency: zero.\n— Hull composition: unknown. Damage inflicted triggers visible reformation. We have no model for this.\n— All intrusion attempts: failed. No exploitable architecture.\n— Armament: plasma-shell battery. Entity has not initiated engagement.\n\nCritical anomaly: ships within close scan range have returned with full data corruption across drives and flight recorders. Initial hypothesis: electromagnetic discharge. Revised hypothesis: the entity detects our scanning methods and responds to them. In real time. Selectively.\n\nNote from lead researcher, recovered from partial drive backup:\n\nIt does not retaliate. We fired on it directly and it absorbed the damage and moved on. It repositioned its offshoots. It did not attack us.\n\nI do not think it considers us a threat. I think it is studying us the way we study something we have not yet classified.\n\nThe data corruption is not a side effect. Something reached into our ships and took exactly what it wanted.\n\nWe were not making first contact.\n\n[END OF RECOVERABLE DATA — FURTHER ENTRIES CORRUPTED]`,
    },
    {
        id: 'the-abyss',
        title: 'Internal Memo — Blockade Command',
        hintLine: 'JOINT FACTION INCIDENT — EXPANSE PERIMETER — DEPTH CLASS: OMEGA',
        authCode: 'KEEP-OUT',
        barColorClass: 'text-purple-400',
        sourceEggSlug: 'the-abyss',
        body: `TO: SOVEREIGN SIX FACTION LEADS\nCLASSIFICATION: OMEGA\nRE: EXPANSE PERIMETER — CONTAINMENT STATUS\n\nThe anomaly was first detected during the Tau Scorpii campaign, 2411. Initial assessment: a localised space-time irregularity. Navigational hazard. Standard advisory issued.\n\nAll six sovereign factions agreed to a joint blockade within ninety days.\n\nThis has never happened before. It has never happened since.\n\nThe public advisory describes the Abyss as a navigational hazard. The classified addendum, distributed only to leadership, states the following: the perimeter exists not to prevent entry, but to prevent exit. Ships and personnel within proximity have reported navigation failures, communication blackouts, and behavioral changes consistent with external influence. The source of this influence has not been identified.\n\nThat addendum was written three years ago.\n\nSince then, seven blockade stations have been quietly decommissioned. Two others fell silent without explanation. Everliving research vessels have been confirmed inside the perimeter. Marauder activity is surging at the Gamish Waypoint.\n\nThe projections for the Abyss's rate of expansion have been removed from the shared intelligence database. This was done quietly, by parties who have not identified themselves.\n\nThey removed the projections because they did not want us to see what the expansion rate implies.\n\nIt is no longer working.`,
    },
    {
        id: 'furnace-of-heaven',
        title: 'Furnace Signal — Decrypted Packet',
        hintLine: 'SIGNAL INTERCEPT — NEBULAR STELLAR FORGE — HEAT SIG: CELESTIAL',
        authCode: 'ALREADY',
        barColorClass: 'text-orange-400',
        sourceEggSlug: 'furnace-of-heaven',
        body: `SIGNAL DESIGNATION: FURNACE-7\nINFORMAL: "THE CENSUS"\nORIGIN: NEBULAR STELLAR FORGE, ABYSS PERIMETER\n\nThe signal was not discovered. It was noticed.\n\nA long-range relay array registered a repeating transmission from the stellar forge region in 2409 — a dense nebular formation on the outer edge of what would later be designated the Abyss perimeter. Initial assessment: thermal interference from natural stellar processes. Filed and forgotten.\n\nEleven months later, a decryption pass found structure inside the noise.\n\nForty-seven linguists and three independent AI systems reached the same conclusion: the signal is enumerative. It is counting.\n\nWhat it is counting is not yet known.\n\nThree probes were dispatched to triangulate the origin. None returned. One unarmed scout followed with an open communications feed. The pilot reported the signal growing louder and more structured as they approached. Then the feed cut. No debris has been recovered.\n\nAddendum — Analyst Kovacs, Signals Intelligence:\n\nThe transmission predates our relay installation by at least sixty years. Possibly much longer. We only know when we started listening.\n\nThe Abyss was not detected until 2411. The signal was already broadcasting in 2409, before the anomaly had a name.\n\nWhatever is in the Furnace of Heaven was transmitting before we arrived. It was not warning us away. It was not calling for help.\n\nI believe it is making a record.\n\n[FURTHER ANALYSIS SUSPENDED — KOVACS HAS NOT RETURNED TO DUTY]`,
    },
];

export function readUnlocked(): string[] {
    try {
        const raw = localStorage.getItem('classified_unlocked');
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) return [];
        const validIds = new Set(CLASSIFIED_FRAGMENTS.map((f) => f.id));
        const seen = new Set<string>();
        return parsed.filter((x) => {
            if (typeof x !== 'string' || !validIds.has(x) || seen.has(x)) return false;
            seen.add(x);
            return true;
        });
    } catch {
        return [];
    }
}

export function writeUnlocked(ids: string[]): void {
    localStorage.setItem('classified_unlocked', JSON.stringify(ids));
}
