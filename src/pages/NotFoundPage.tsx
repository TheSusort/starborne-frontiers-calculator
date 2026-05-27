import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '../components/ui';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';

const BAR_TOTAL = 22;
const BAR_FINAL_FILLED_DEFAULT = 13;

const DEFAULT_TERMINAL_LINES = [
    '> INITIALIZING NAV SYSTEMS... [OK]',
    '> SCANNING SECTOR_404...',
    '> ERROR: NULL_SECTOR_REFERENCE',
];

interface EasterEggConfig {
    terminalLines: [string, string, string];
    barLabel: string;
    barColorClass: string;
    title: string;
    subtitle: string;
    body: string;
}

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
    const terminalLines = easterEgg?.terminalLines ?? DEFAULT_TERMINAL_LINES;
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
                        <div className="text-[0.65rem] text-primary uppercase tracking-[0.3em] [text-shadow:0_1px_4px_rgba(0,0,0,0.8)]">
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
                                        <div
                                            ref={glitchRef}
                                            className="text-center text-8xl font-bold text-primary tracking-widest"
                                        >
                                            404
                                        </div>

                                        <div className="text-center space-y-2">
                                            <p className="text-base font-bold tracking-widest uppercase text-primary">
                                                SECTOR_404: SIGNAL LOST
                                            </p>
                                            <p className="text-sm text-gray-400">
                                                The route you&apos;re looking for has been redacted
                                                from our navigation charts.
                                            </p>
                                        </div>

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
