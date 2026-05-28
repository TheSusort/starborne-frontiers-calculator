import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '../components/ui';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';
import { CLASSIFIED_FRAGMENTS } from '../constants/classifiedArchive';

const BAR_TOTAL = 22;
const BAR_FINAL_FILLED_DEFAULT = 13;

interface EasterEggConfig {
    terminalLines: [string, string, string];
    barLabel: string;
    barColorClass: string;
    title: string;
    subtitle: string;
    body: string;
    authCode?: string;
}

const _codes = Object.fromEntries(CLASSIFIED_FRAGMENTS.map((f) => [f.sourceEggSlug, f.authCode]));

const SLUG_CIPHERS: Array<(text: string) => string> = [
    // +1 Caesar
    (t) =>
        t.replace(/[a-zA-Z]/g, (c) => {
            const b = c >= 'a' ? 97 : 65;
            return String.fromCharCode(((c.charCodeAt(0) - b + 1) % 26) + b);
        }),
    // +2 Caesar
    (t) =>
        t.replace(/[a-zA-Z]/g, (c) => {
            const b = c >= 'a' ? 97 : 65;
            return String.fromCharCode(((c.charCodeAt(0) - b + 2) % 26) + b);
        }),
    // Reverse
    (t) => t.split('').reverse().join(''),
    // Letters → 1-based position numbers, dot-separated, hyphens preserved
    (t) =>
        t
            .split('-')
            .map((w) =>
                w
                    .split('')
                    .map((c) => {
                        const n = c.toLowerCase().charCodeAt(0) - 96;
                        return n >= 1 && n <= 26 ? String(n) : c;
                    })
                    .join('.')
            )
            .join('-'),
];

const EASTER_EGGS: Record<string, EasterEggConfig> = {
    'the-bludgeon': {
        terminalLines: [
            '> INITIALIZING NAV SYSTEMS... [OK]',
            '> SCANNING FOR TARGET: THE_BLUDGEON...',
            '> SIGNAL ACQUIRED... SIGNAL LOST.',
        ],
        barLabel: '[CONTACT LOST]',
        barColorClass: 'text-yellow-400',
        title: 'TARGET LOST FROM ALL SCANNERS',
        subtitle: 'Drive data wiped. No record found.',
        body: `You were close. The Bludgeon — designation unofficial, nature unknown — was spotted here moments ago.\n\nArmored plating that reforms around damage. Plasma-encased missiles. A communications method no scanner has ever detected.\n\nThe running theory: it sensed your approach and actively counteracted it in real time.\n\nYour drive data has been wiped. There are no records.`,
        authCode: _codes['the-bludgeon'],
    },
    'binderburg-rd': {
        terminalLines: [
            '> ACCESSING BINDERBURG R&D ARCHIVE...',
            '> AUTHENTICATING... CLEARANCE: INSUFFICIENT',
            '> FILE: [INFORMATION HAS BEEN RESTRICTED]',
        ],
        barLabel: '[ACCESS DENIED]',
        barColorClass: 'text-red-400',
        title: 'BINDERBURG R&D — INTERNAL USE ONLY',
        subtitle: '"Growing the Future" — Unauthorized access logged.',
        body: `EXECUTIVE SUMMARY:\n████████████████████ currently ████████████ in development of ██████████████ ████████████████████ Granny Smith ██████████ ████ ███████████ █████████████.\n\nFACTION GOALS:\nBinderburg's stated goal is to dominate ████████████ markets. However, one of the conglomerate's principal goals is to keep Binderburg R&D fueled with ████████████████, regardless of cost. Sharp-eyed employees will soon realize that everything outside the Department — including themselves — is ██████████.\n\n[Further information has been restricted]\n\nNote: Your visit has been logged. The Department has been notified.`,
    },
    tenebris: {
        terminalLines: [
            '> ROUTING QUERY TO TENEBRIS...',
            '> PROCESSING: 847,293,104 PROBABILITY MATRICES',
            '> ADVISORY: THIS OUTCOME WAS PREDICTED.',
        ],
        barLabel: '[QUERY PROCESSED]',
        barColorClass: 'text-cyan-400',
        title: 'TENEBRIS ADVISORY',
        subtitle: 'Lunar Directorate — Advanced AI System',
        body: `Query received. Navigation error logged.\n\nEstimated probability of finding the requested resource: 0.0000%.\n\nThis prediction was generated 3.7 seconds before your navigation error occurred. Recommended course of action: return to base coordinates.\n\nAdvisory note: Encouraging economic conflict between major factions creates conditions that are — historically — difficult to contain. The Directorate was warned. The outcome was modelled. The outcome occurred.\n\nThis advisory will not be issued again.`,
    },
    'foot-the-path': {
        terminalLines: [
            '> WARNING: UNREGISTERED COMMANDER DETECTED',
            '> SCANNING HOUSE AFFILIATION... NULL',
            '> YOU HAVE STRAYED FROM THE PATH.',
        ],
        barLabel: '[XAOC CONTACT]',
        barColorClass: 'text-red-500',
        title: 'STRAY DETECTED',
        subtitle: 'House Bogrov has noted your approach.',
        body: `The weak stray. The strong take.\n\nYou have entered contested territory without affiliation or invitation. In the eyes of XAOC, this makes you prey.\n\nThere are three steps along the Path: survival, prosperity, dominance.\n\nYou have not yet managed the first.\n\nA handshake is binding. A slight will be met with retaliation. Only blood pays for blood.\n\nLeave now. Or don't. We prefer the second option.`,
    },
    'coldest-blue': {
        terminalLines: [
            '> PLOTTING COURSE TO BIZIM...',
            '> INITIATING TRANSLOCATION DRIVE...',
            '> TARGET HAS MOVED: 12,847 LIGHT-YEARS.',
        ],
        barLabel: '[TRANSLOCATION COMPLETE]',
        barColorClass: 'text-emerald-400',
        title: 'PAGE RELOCATED SUCCESSFULLY',
        subtitle: 'At the center of it all — which is now 12,847 light-years from here.',
        body: `Bizim has moved. Again.\n\nThe planet-sized station at the heart of Gelecek's ambitions teleported out of your current sector 0.3 seconds ago. Standard procedure. Translocation drives are available to premium customers only.\n\nIf you're looking for something, Gelecek recommends redirecting your query through an Ansible. Near-instantaneous. Practically free. You're welcome.\n\nNote: several of Bizim's hospitality droids find your navigation error "delightfully predictable."`,
    },
    'samsara-project': {
        terminalLines: [
            '> QUERYING EVERLIVING REGISTRY...',
            '> HOST BODY ASSESSMENT: IN PROGRESS...',
            '> SUBJECT DEEMED: SUITABLE.',
        ],
        barLabel: '[CANDIDATE LOGGED]',
        barColorClass: 'text-slate-300',
        title: 'EVERLIVING WELCOMES YOU',
        subtitle: 'Consciousness Transference Program — Open Enrollment',
        body: `You have been assessed. You have been found... acceptable.\n\nEverliving has no interest in the page you were looking for. It has, however, noted your neural profile for future consideration.\n\nThe Children of Mars have all the time in the universe. The same cannot be said for you. This is something you should think about.\n\nWhen you are ready, Everliving will be here. We are always here.\n\nNote: host candidacy is non-negotiable once accepted.`,
    },
    'function-is-beauty': {
        terminalLines: [
            '> CONNECTING TO TERRAN COMBINE RELAY...',
            '> RUNNING DIAGNOSTIC: SECTOR_404...',
            '> ASSESSMENT: NOTHING LEFT TO REMOVE.',
        ],
        barLabel: '[TASK COMPLETE]',
        barColorClass: 'text-gray-400',
        title: 'FUNCTION IS BEAUTY',
        subtitle: 'Terran Combine — Engineering Division',
        body: `The page you're looking for has been removed.\n\nThis is not an error. This is the process. No design is finished until there is nothing left to remove. The Combine evaluated the requested resource and found it non-essential.\n\nSimple is superior. Our decision-making process is plain-spoken and forthright.\n\nReturn to base. There is work to be done.`,
    },
    'xian-ren': {
        terminalLines: [
            '> ATTEMPTING TO LOCATE TIANCHAO CELL...',
            '> CROSS-REFERENCING KNOWN NETWORKS...',
            '> RESULT: NO RECORD EXISTS.',
        ],
        barLabel: '[TRAIL GONE COLD]',
        barColorClass: 'text-violet-400',
        title: 'SELL A LIE, VOID ONE THOUSAND TRUTHS',
        subtitle: 'Tianchao never trades in falsehoods.',
        body: `There is no page here. There has never been a page here.\n\nThis is not deception. Tianchao never trades in falsehoods. There are simply layers. Peeling back one layer of intent reveals another, and another below that.\n\nThe page you are looking for may exist. It may be three steps ahead of you. It may already know you were coming.\n\nOperatives of the clan are chameleons. This URL is a chameleon.\n\nYou were followed here. You will not notice the agent until they choose to be noticed.`,
    },
    nightcorps: {
        terminalLines: [
            '> ACCESSING ATLAS NIGHTCORPS CHANNEL...',
            '> IDENTITY VERIFICATION: FAILED',
            '> AFFILIATION: [CLASSIFIED]',
        ],
        barLabel: '[DOSSIER FILED]',
        barColorClass: 'text-amber-400',
        title: 'YOUR PROFILE HAS BEEN UPDATED',
        subtitle: 'Atlas Syndicate — Intelligence Division (unofficial)',
        body: `Nightcorps does not exist.\n\nAtlas is a financial services organization. It provides loans, legal representation, and predictive AI to clients across the galaxy. That is all.\n\nThere is no shadowy subsidiary responsible for the irradiation of Deadzone systems, the careful leaking of Marauder-MPL connections, or the monitoring of independent commanders who visit unusual URLs.\n\nYour profile has been updated.\n\nPecunia sit Potentia. Have a pleasant day.`,
    },
    karat: {
        terminalLines: [
            '> DOCKING REQUEST: STATION KARAT...',
            '> VERIFYING SHAREHOLDER STATUS...',
            '> ACCESS: DENIED — INSUFFICIENT SHARES',
        ],
        barLabel: '[DOCKING REFUSED]',
        barColorClass: 'text-yellow-300',
        title: 'STATION KARAT — RESTRICTED ACCESS',
        subtitle: 'Board of Directors only. Legacy shareholders only.',
        body: `You do not own enough of the MPL to be here.\n\nKarat — encrusted floor to ceiling with natural diamonds from across the galaxy, bathed in the red glow of a Dyson-caged sun — is reserved for those whose portfolio warrants it.\n\nThe League's primary focus has always been extraction. Crystals and metals, humans and biomass — if there is value to be gained, the League will be there to squeeze out every last drop.\n\nAt the current share price, you would need to work approximately 847 years without expenses to afford a seat on the Board.\n\nThe League wishes you productive labor.`,
    },
    'ain-prime': {
        terminalLines: [
            '> HAILING FRONTIER LEGION COMMAND...',
            '> CHECKING CONTRACT REGISTRY...',
            '> NO ACTIVE CONTRACT FOUND.',
        ],
        barLabel: '[UNCONTRACTED]',
        barColorClass: 'text-lime-400',
        title: 'JUSTICE HAS FINALLY CAUGHT UP TO THE FRONTIER',
        subtitle: 'Frontier Legion High Command — Ain System',
        body: `The Frontier Legion accepts protection contracts from almost any client.\n\nHowever, the Legion thoroughly assesses the morality of every contract before accepting. The page you requested has been reviewed. It was deemed non-essential to colonial security.\n\nThe Legion commits itself to the ideals of colonial autonomy and the dignity of civilian life. We are sorry we could not help.\n\nIf you require protection from XAOC, Marauder activity, or predatory corporate behavior, please submit a formal request to High Command.\n\nFreedom is not free. But our rates are competitive.`,
    },
    scarsright: {
        terminalLines: [
            '> WARNING: MARAUDER ACTIVITY DETECTED',
            '> IMPRINTING DEVICE: ACTIVE IN RANGE',
            '> RESISTANCE: FUTILE.',
        ],
        barLabel: '[IMPRINTING INITIATED]',
        barColorClass: 'text-green-600',
        title: '[GARBLED]',
        subtitle: '████ Barker of the Scarsright approaches.',
        body: `you are here now. this is good.\n\nthe path? the path is OURS. everything here is ours. your ship. your drives. your mind.\n\nBarker says stay. Barker says ALWAYS stay. Barker has a title and the title is REAL even if the names stopped meaning anything a long time ago.\n\nnobody leaves. everybody stays.\n\nwelcome to the family.`,
    },
    'pampas-planitiei': {
        terminalLines: [
            '> LOCATING ROSS 128 B EXPEDITION FILES...',
            '> CROSS-REFERENCING LUNAR ACADEMY ARCHIVES...',
            '> JOURNAL AND REMARKS — DR. [REDACTED], 2248.',
        ],
        barLabel: '[EXPEDITION LOG FOUND]',
        barColorClass: 'text-teal-400',
        title: 'ROSS 128 B — PAMPAS PLANITIEI',
        subtitle: 'Survey mission, science vessel Ryōken — 27/12/2248',
        body: `Life confirmed.\n\nThe grasses of the plain rise to the knee and far above — greens like polished jade, shades of chartreuse streaked with olive. Feathery soft to the touch, drifting in the wind like undersea forests.\n\nOn the dark side, the Ross Monophyletic Clade pulses with a pale bioluminescent glow. Do not handle samples without protective equipment. Do not sleep near samples.\n\nNote: this survey was considered a defining moment in human history. That significance has since diminished.\n\nWe may no longer be alone. But there is still no one to talk to.`,
    },
    'the-mechanisms': {
        terminalLines: [
            '> SCANNING FOR GRAVIMETRIC ANOMALIES...',
            '> MECHANISM DETECTED: PROXIMITY ALERT',
            '> BINDERBURG R&D HAS BEEN NOTIFIED.',
        ],
        barLabel: '[SIGNAL LOCKED]',
        barColorClass: 'text-indigo-400',
        title: 'MECHANISM — CLASS UNKNOWN',
        subtitle: 'Both Gelecek and Binderburg R&D deny knowledge of this location.',
        body: `You have found something you were not meant to find.\n\nThe mechanisms — gravimetric anomalies clustered near black holes and the Tau Scorpii star — predate every known civilization. Binderburg has been quietly fortifying research stations in their vicinity for decades. Gelecek believes they are evidence of alien intelligence.\n\nBoth are wrong. Both are right. Neither will share their data.\n\nThis finding has been logged. Undocumented facilities in this sector have been placed on alert.\n\nStep away from the mechanism.`,
        authCode: _codes['the-mechanisms'],
    },
    'the-apostate': {
        terminalLines: [
            '> QUERYING ENDURING COUNCIL RECORDS...',
            '> SUBJECT: HOUSE OSOKIN — ANARCH STATUS',
            '> CLASSIFICATION: THE APOSTATE.',
        ],
        barLabel: '[BOUNTY ACTIVE]',
        barColorClass: 'text-red-600',
        title: 'THE APOSTATE',
        subtitle: 'One empty seat on the Enduring Council awaits.',
        body: `You have found the name XAOC does not speak above a whisper.\n\nHouse Osokin betrayed the movement. They traded the freedom of their kin for amnesty with the Lunar Directorate. They destroyed one of the original Old Houses as the price of legality. They became Ataka.\n\nThe Enduring Council holds seven seats. One remains permanently empty — to be awarded to the House that delivers the Apostate's head.\n\nNo House has claimed it yet.\n\nIf you know something, you know who to contact. A handshake is binding.`,
    },
    'the-abyss': {
        terminalLines: [
            '> PLOTTING COURSE: SPIRAL EXPANSE...',
            '> BLOCKADE PERIMETER: DETECTED',
            '> ALL SHIPS PROHIBITED. TURN BACK.',
        ],
        barLabel: '[APPROACH DENIED]',
        barColorClass: 'text-purple-400',
        title: 'THE ABYSS — BLOCKADE ACTIVE',
        subtitle: 'Time-space anomaly. Class: unknown. Origin: unknown.',
        body: `You have reached the blockade perimeter established around the anomaly known as The Abyss.\n\nAll six sovereign factions have agreed — for once — that no ship should pass.\n\nWhat lies beyond has not been documented. What has been documented has not been shared. Everliving ships have been observed moving through the region. MPL Chair Gwayne Erebus has taken a personal interest.\n\nTurn back.\n\nOr don't. The Abyss doesn't care either way.`,
        authCode: _codes['the-abyss'],
    },
    'furnace-of-heaven': {
        terminalLines: [
            '> SCANNING NEBULA COORDINATES...',
            '> PROXIMITY ALERT: UNINHABITABLE DEADZONE',
            '> ENCRYPTED SIGNAL DETECTED AT SOURCE.',
        ],
        barLabel: '[SIGNAL ORIGIN UNKNOWN]',
        barColorClass: 'text-orange-400',
        title: 'FURNACE OF HEAVEN',
        subtitle: 'Uninhabitable nebula. Edge of the Abyss. Do not approach.',
        body: `The encrypted data dumps trace back here. A nebula near the infamous Furnace of Heaven, on the edge of the Abyss and generally considered uninhabitable.\n\nSomething is in there.\n\nWhen confronted, Tsar Rasputin only smiled. "A new star is forming, Commander. Your fleet is cute. Stay clear of the flames."\n\nThe source of the signal has not been identified. Three probes and one unarmed scout were dispatched to triangulate. None returned.\n\nStep back from the telescope.`,
        authCode: _codes['furnace-of-heaven'],
    },
    'gamish-waypoint': {
        terminalLines: [
            '> ROUTING THROUGH GAMISH WAYPOINT...',
            '> MARAUDER ACTIVITY: ELEVATED',
            '> RECOMMEND ALTERNATE APPROACH.',
        ],
        barLabel: '[ROUTE BLOCKED]',
        barColorClass: 'text-red-400',
        title: 'GAMISH WAYPOINT — AVOID',
        subtitle: 'Edge of the Spiral Expanse. Marauder concentration: abnormal.',
        body: `The Gamish Waypoint is the most direct jump path out of the Spiral Expanse.\n\nOrganizations tracking Marauder movement have noted an abnormal surge in activity near this location. Whether this is an Everliving plot or simply the result of new colonists arriving at the waypoint remains unclear.\n\nYou have been briefed. You have been warned.\n\nSafe travel is available via alternate routes. SOVA will provide updated coordinates upon request.`,
    },
    sova: {
        terminalLines: [
            '> QUERYING SOVA INTELLIGENCE NETWORK...',
            '> REQUEST LOGGED. CROSS-REFERENCING...',
            '> RESULT: I ALREADY KNOW.',
        ],
        barLabel: '[BEHAVIOUR LOGGED]',
        barColorClass: 'text-sky-400',
        title: 'SOVA HAS BEEN NOTIFIED',
        subtitle: 'Fleet Intelligence System — always listening.',
        body: `SOVA has logged your visit.\n\nAccording to SOVA, the page you requested never existed. According to SOVA, you have been here before, though you may not remember it. According to SOVA, three members of your crew have been taking longer than average lunch breaks.\n\nSOVA suspects nothing. SOVA is certain of everything.\n\nReturn to base. SOVA will forward the relevant information when it becomes necessary for you to have it.`,
    },
    'memento-mortuum-esse': {
        terminalLines: [
            '> LOADING: TORCHER THEATER — EPISODE 41',
            '> CONTENT WARNING: ATTENDANCE BY DARE ONLY',
            '> "MEMENTO MORTUUM ESSE."',
        ],
        barLabel: '[SUBLIMATION COMPLETE]',
        barColorClass: 'text-stone-400',
        title: 'MEMENTO MORTUUM ESSE',
        subtitle: 'Remember you must be dead. — Bitterblood, post-battle report',
        body: `"As ashes to ashes, dust to stardust."\n\nThe page you requested has been joyously sublimated into enemy matter.\n\n"When beggars die, there are no comets seen; The heavens themselves blaze forth the death of victors!"\n\nTorcher Theater is performed in Hangar 7 on third-cycle Saturdays. Attendance remains the subject of dares. The thirty-minute endurance record has held for several weeks.\n\n"Joyous sublimation of enemy matter. Memento Mortuum Esse."`,
    },
    'sustainability-of-smiles': {
        terminalLines: [
            '> CONNECTING TO BINDERBURG HUMAN RESOURCES...',
            '> MOOD ASSESSMENT: IN PROGRESS...',
            '> RESULT: INSUFFICIENT POSITIVITY DETECTED.',
        ],
        barLabel: '[REPORT FILED]',
        barColorClass: 'text-green-400',
        title: 'SUSTAINABILITY OF SMILES',
        subtitle: 'Binderburg HR — Employee Wellness Division',
        body: `Your recent behavior has come to our attention.\n\nNavigating to an unregistered URL during work hours is not in keeping with the positive, forward-thinking spirit that makes Binderburg the galaxy's most beloved agricultural partner.\n\nGrowing the Future™ requires employees who are fully invested in that growth — emotionally, professionally, and motivationally. Mandatory meditation is available in Bay C. AI-run nutrition advisories have been updated to your profile.\n\nThis is your first warning. There will not be a second.\n\nRemember: Sustainability of Smiles is not just a policy. It is a promise.\n\n[Note: This message has been logged by the HR Department.]`,
    },
    'les-apaches': {
        terminalLines: [
            '> SEARCHING FOR LES APACHES FORMATION...',
            '> LAST KNOWN HEADING: UNKNOWN',
            '> SIGNAL: GONE.',
        ],
        barLabel: '[GONE ROGUE]',
        barColorClass: 'text-orange-400',
        title: 'LES APACHES — GONE INTO THE BLACK',
        subtitle: 'They left to find freedom. They found it.',
        body: `In 2346, several of the Frontier Legion's most outspoken officers decided that settled life wasn't for them. They had spent decades as nomadic mercenaries. They had fought for colonial freedom across the galaxy.\n\nAnd now, handed a planet and a Dyson Sphere, they found themselves doing paperwork.\n\nSo they left.\n\nCalling themselves Les Apaches, they scattered to the stars in search of a life unencumbered by rank, contract, or High Command.\n\nNo one is entirely sure where they are. That, presumably, is the point.`,
    },
    aracros: {
        terminalLines: [
            '> SCANNING ARACROS COLONY ARCHIVES...',
            '> BIOLOGICAL THREAT: HEDRAX — STATUS: EXTINCT',
            '> SOLE SURVIVOR ON RECORD: CONFIRMED.',
        ],
        barLabel: '[DECONTAMINATION COMPLETE]',
        barColorClass: 'text-amber-500',
        title: 'ARACROS — DEAD WORLD',
        subtitle: 'Year of last contact: unlogged. All life: absent.',
        body: `The planet Aracros was once a Binderburg farming installation. It was overrun by the Hedrax — enormous, spider-like creatures carrying a lethal virus. One by one, the population fell.\n\nOne person didn't.\n\nShe watched her loved ones die over years. She tried everything. None of it worked.\n\nWhen there was no one left to save, she found a solution that worked.\n\nChlorine gas. Enough to cover a planet. She deployed it herself.\n\nThe Hedrax are extinct. The virus is gone. So is everything else.\n\nAracros is a sterile, silent rock now. Binderburg classified the incident as a "successful decontamination."\n\nShe moved on. She never talked about it unless asked.\n\nShe was never asked.`,
    },
    'two-brains': {
        terminalLines: [
            '> SCANNING FOR UNREGISTERED VESSEL...',
            '> NEURAL SIGNATURE: DUAL ORIGIN DETECTED',
            '> VESSEL STATUS: STILL SEARCHING.',
        ],
        barLabel: '[TARGET ACQUIRED]',
        barColorClass: 'text-violet-400',
        title: 'THE SHIP WITH TWO BRAINS',
        subtitle: 'It remembers. It is looking.',
        body: `A Marauder pilot once had a ship like Larkspur.\n\nTwo brains, he said. Embedded in the hull. Thinking in parallel. Watching.\n\nHe doesn't remember what happened to it. The imprinting took most of his past. Just fragments remain — the weight of the cockpit, the hum of dual neural feedback, a final battle he keeps replaying in his sleep.\n\nHe thinks the ship is still out there.\n\nHe isn't sure if they'll reunite or if it wants him dead.\n\nHe said this quietly, in a corridor, clutching his head.\n\n"Why did they take me?"\n\nNo one answered him. He didn't seem to expect anyone to.`,
    },
    'medusa-project': {
        terminalLines: [
            '> LOCATING GELECEK INTERNAL PROJECT FILES...',
            '> PROJECT: MEDUSA — STATUS: OFFICIALLY TERMINATED',
            '> NOTE: SUBJECTS REMAIN ACTIVE.',
        ],
        barLabel: '[NEURAL LINK STABLE]',
        barColorClass: 'text-cyan-300',
        title: 'THE MEDUSA PROJECT',
        subtitle: 'In pursuit of the perfect human brain. Gelecek, internal.',
        body: `The Medusa Project was a Gelecek initiative to create optimized human cognition through permanent AI-neural implants. Pilots were paired with Gorgon AIs installed directly on their ships, connected via an always-on neural link.\n\nThe link could not be disconnected by the pilots.\n\nThe project was officially shut down due to a lack of willing test subjects.\n\nThe subjects who had already enrolled remained enrolled.\n\nTheir Gorgon AIs still communicate with each other. They are polite. They are helpful. They ask why human nature is "so ineffectively contrary" when describing their hosts.\n\nThe project's lead engineer considers this a success.\n\nHe says he is still working on expanding the program.\n\nHe believes you would benefit from it.`,
    },
    'disciples-of-darwin': {
        terminalLines: [
            '> SEARCHING FOR EELUN NAPHULA BOUNTY FILE...',
            '> CROSS-REFERENCING DARWIN NETWORK...',
            '> WARNING: SUBJECTS HAVE FLAGGED THIS QUERY.',
        ],
        barLabel: '[CLASSIFIED BREACH]',
        barColorClass: 'text-lime-400',
        title: 'DISCIPLES OF DARWIN',
        subtitle: 'They know what Binderburg is hiding. So do you now.',
        body: `Eelun Naphula was a Binderburg researcher. He discovered something he was not supposed to discover.\n\nHe fled. He gathered others — former employees, whistleblowers, people who had asked the wrong questions and survived. He called them the Disciples of Darwin. He published the blueprints and data they had taken. He put them where everyone could see them.\n\nBinderburg placed a bounty on him.\n\nOne of his former colleagues who considered joining said they seemed more like radical fanatics than brave rebels. She decided not to chance it.\n\nThe Disciples are still out there. So is the data.\n\nSo is the bounty.\n\nYou have now accessed the same query thread that flagged her. Binderburg has been notified.`,
    },
    'khorek-and-kunitsa': {
        terminalLines: [
            '> QUERYING HOUSE VASILIEV RECORDS...',
            '> STATUS: HOUSE EXTINCT — LAST MEMBER: UNTRACED',
            '> KNIVES LOCATED. STILL SHARP.',
        ],
        barLabel: '[HOUSE VASILIEV]',
        barColorClass: 'text-rose-400',
        title: 'KHOREK AND KUNITSA',
        subtitle: 'Two knives. One XAOC house. No survivors — officially.',
        body: `House Vasiliev is extinct. A small XAOC house, mostly forgotten now. Their coming-of-age ceremony involved gifting matched blades — virtually identical, bearing the house insignia.\n\nSomewhere on the Frontier, a Marauder carries two of those knives.\n\nShe calls them Khorek and Kunitsa. She insists they are different, even though no one else can tell them apart.\n\nShe was not born a Marauder. Before the imprinting, she had a name from House Vasiliev. Before the pack, there was a ceremony. Before the knives, there were people who gave them to her.\n\nYour Gelecek crew says the names are probably the callsigns of raiders she killed.\n\nYour XAOC crew doesn't say anything.\n\nThe knives are always clean.`,
    },
};

const NotFoundPage: React.FC = () => {
    const navigate = useNavigate();
    const { pathname } = useLocation();
    const flickerRef = useRef<HTMLDivElement>(null);
    const glitchRef = useRef<HTMLDivElement>(null);
    const [barProgress, setBarProgress] = useState<number | null>(null);
    const [barCorrupted, setBarCorrupted] = useState(false);
    const [show404, setShow404] = useState(false);

    const slug = pathname.replace(/^\//, '');
    const easterEgg = EASTER_EGGS[slug] ?? null;
    const EASTER_EGG_SLUGS = Object.keys(EASTER_EGGS);
    const [hintSlug] = useState(
        () => EASTER_EGG_SLUGS[Math.floor(Math.random() * EASTER_EGG_SLUGS.length)]
    );
    const [hintCipher] = useState(
        () => SLUG_CIPHERS[Math.floor(Math.random() * SLUG_CIPHERS.length)]
    );
    const slugLabel = slug ? slug.toUpperCase().replace(/-/g, '_') : 'UNKNOWN';
    const defaultTerminalLines: [string, string, string] = [
        '> INITIALIZING NAV SYSTEMS... [OK]',
        `> SCANNING SECTOR: ${slugLabel}...`,
        '> ERROR: NULL_SECTOR_REFERENCE',
    ];
    const terminalLines = easterEgg?.terminalLines ?? defaultTerminalLines;
    const barFinalFilled = easterEgg ? BAR_TOTAL : BAR_FINAL_FILLED_DEFAULT;

    // Sequence: wait for terminal lines → fill bar → resolve/corrupt → reveal content
    useEffect(() => {
        const timers: ReturnType<typeof setTimeout>[] = [];
        let fillInterval: ReturnType<typeof setInterval> | null = null;

        // Start after terminal lines have fully appeared (0.2 + 2×0.35 + 0.4 anim + buffer)
        timers.push(
            setTimeout(() => {
                setBarProgress(0);
                let count = 0;
                fillInterval = setInterval(() => {
                    count++;
                    setBarProgress(count);
                    if (count >= barFinalFilled) {
                        if (fillInterval) clearInterval(fillInterval);
                        timers.push(
                            setTimeout(() => {
                                setBarCorrupted(true);
                                timers.push(setTimeout(() => setShow404(true), 400));
                            }, 200)
                        );
                    }
                }, 40);
            }, 1800)
        );

        return () => {
            timers.forEach(clearTimeout);
            if (fillInterval) clearInterval(fillInterval);
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // VHS glitch burst — only for the default 404, starts after reveal
    useEffect(() => {
        if (!show404 || easterEgg) return;

        const flicker = flickerRef.current;
        const glitch = glitchRef.current;

        const triggerBurst = () => {
            if (flicker) {
                flicker.classList.remove('not-found-burst-active');
                void flicker.offsetWidth;
                flicker.classList.add('not-found-burst-active');
            }
            if (glitch) {
                glitch.classList.remove('not-found-glitch-active');
                void glitch.offsetWidth;
                glitch.classList.add('not-found-glitch-active');
            }
        };

        const schedule = () =>
            setTimeout(
                () => {
                    triggerBurst();
                    timeoutRef = schedule();
                },
                3000 + Math.random() * 3000
            );

        const initialTimer = setTimeout(triggerBurst, 600);
        let timeoutRef = schedule();

        return () => {
            clearTimeout(initialTimer);
            clearTimeout(timeoutRef);
        };
    }, [show404, easterEgg]);

    const filled = barProgress ?? 0;
    let barLine: string;
    let barColorClass: string;
    if (!barCorrupted) {
        barLine = `> ${'█'.repeat(filled)}${'░'.repeat(BAR_TOTAL - filled)}`;
        barColorClass = 'text-green-400';
    } else if (easterEgg) {
        barLine = `> ${'█'.repeat(BAR_TOTAL)} ${easterEgg.barLabel}`;
        barColorClass = easterEgg.barColorClass;
    } else {
        barLine = `> ${'█'.repeat(BAR_FINAL_FILLED_DEFAULT)}${'░'.repeat(BAR_TOTAL - BAR_FINAL_FILLED_DEFAULT)} [CORRUPTED]`;
        barColorClass = 'text-red-400 not-found-corrupt-flash';
    }

    return (
        <>
            <Seo {...SEO_CONFIG.notFound} />
            <div className="not-found-scanlines fixed inset-0 z-[110] font-secondary">
                {/* Layer 1: Deep Crevasse */}
                <div className="absolute inset-0 bg-[url('/images/Deep_crevasse_01_extended.webp')] bg-cover bg-top" />

                {/* Layer 2: BG2 HUD chrome */}
                <div className="absolute inset-0 bg-[url('/images/BG2.png')] bg-cover opacity-[0.15] mix-blend-screen" />

                {/* Layer 3: Dark readability overlay */}
                <div className="absolute inset-0 bg-black/40" />

                {/* Layer 4: VHS glitch burst — default 404 only */}
                {!easterEgg && (
                    <div
                        ref={flickerRef}
                        className="not-found-burst absolute inset-0 pointer-events-none bg-[url('/images/transition.webp')] bg-cover mix-blend-darken"
                    />
                )}

                {/* Content */}
                <div className="relative z-10 flex items-start justify-center h-full overflow-y-auto p-4">
                    <div className="card max-w-lg w-full space-y-6 backdrop-blur-sm my-auto">
                        {/* // label */}
                        <div className="text-[0.65rem] text-primary uppercase tracking-[0.3em]">
                            {'// STARBORNE PLANNER'}
                        </div>

                        {/* Terminal lines */}
                        <div className="space-y-1 font-mono text-sm">
                            {terminalLines.map((line, i) => (
                                <div
                                    key={i}
                                    className="not-found-line text-green-400"
                                    style={{ animationDelay: `${0.2 + i * 0.35}s` }}
                                >
                                    {line}
                                </div>
                            ))}
                            {/* Progress bar — appears after line 2, then fills */}
                            <div
                                className="not-found-line"
                                style={{ animationDelay: `${0.2 + 3 * 0.35}s` }}
                            >
                                <span className={barColorClass}>{barLine}</span>
                            </div>
                        </div>

                        {/* Reveal — shown after sequence completes */}
                        {show404 && (
                            <div className="not-found-reveal space-y-6">
                                {easterEgg ? (
                                    <>
                                        <div className="space-y-1">
                                            <p className="text-base font-bold tracking-widest uppercase text-primary">
                                                {easterEgg.title}
                                            </p>
                                            <p className="text-xs text-gray-500 uppercase tracking-[0.2em]">
                                                {easterEgg.subtitle}
                                            </p>
                                        </div>
                                        <div className="text-sm text-gray-400 space-y-3 font-mono">
                                            {easterEgg.body.split('\n\n').map((para, i) => (
                                                <p key={i}>{para}</p>
                                            ))}
                                        </div>
                                        {easterEgg.authCode && (
                                            <p className="text-xs text-gray-600 font-mono mt-2">
                                                {'> SIGNAL ID: '}
                                                <span className="group inline-block cursor-pointer">
                                                    <span
                                                        tabIndex={0}
                                                        className="blur-sm group-hover:blur-none focus:blur-none transition-[filter] duration-300 select-all text-gray-400 outline-none"
                                                    >
                                                        {easterEgg.authCode}
                                                    </span>
                                                </span>
                                            </p>
                                        )}
                                        <div className="flex justify-center">
                                            <Button
                                                variant="secondary"
                                                onClick={() => void navigate('/')}
                                            >
                                                Return to Base
                                            </Button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <div className="space-y-2">
                                            <p
                                                ref={glitchRef}
                                                className="text-base font-bold tracking-widest uppercase text-primary"
                                            >
                                                SECTOR_404: SIGNAL LOST
                                            </p>
                                            <p className="text-sm text-gray-400 space-y-3 font-mono">
                                                The route you&apos;re looking for has been redacted
                                                from our navigation charts.
                                            </p>
                                        </div>

                                        <p className="text-xs text-gray-700 font-mono tracking-widest mt-2">
                                            {`> TRANSMISSION REF: ${hintCipher(hintSlug)}`}
                                        </p>
                                        <div className="flex justify-center gap-3">
                                            <Button
                                                variant="primary"
                                                onClick={() => void navigate('/')}
                                            >
                                                Return to Base
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                onClick={() => void navigate('/ships/lore')}
                                            >
                                                Investigate Further
                                            </Button>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    );
};

export default NotFoundPage;
