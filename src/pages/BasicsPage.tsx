import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
    Magnet,
    Crosshair,
    EyeOff,
    Swords,
    Upload,
    Zap,
    ScrollText,
    type LucideIcon,
} from 'lucide-react';
import { Callout, Chip, GroupLabel, IconBadge, IconPlate } from '../components/ui';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';
import TargetingBoard from '../components/basics/TargetingBoard';
import AffinityWheel from '../components/basics/AffinityWheel';
import StatGuideTable from '../components/basics/StatGuideTable';
import GearBasicsSection from '../components/basics/GearBasicsSection';
import { ROLE_GUIDE } from '../components/basics/roleGuideData';
import { SECTIONS, SECTION_IDS } from '../components/basics/basicsSections';
import type { BasicsSection } from '../components/basics/basicsSections';
import { ShipIcon } from '../components/ship/shipDisplayComponents';
import { SHIP_TYPES } from '../constants/shipTypes';
import type { ShipRoleCategory } from '../constants/shipTypes';
import { STATS } from '../constants/stats';
import { useScrollSpy } from '../hooks/useScrollSpy';

const ROLE_CATEGORIES: ShipRoleCategory[] = ['ATTACKER', 'DEFENDER', 'DEBUFFER', 'SUPPORTER'];

/** One digit per section, not a padded "01": Electrolize's zero is a plain rounded rectangle with
 *  no counter, so at display size the pad reads as a missing-glyph box beside the 1. Column width
 *  is fixed by the container instead. */
const stepNumber = (index: number): string => String(index + 1);

/** A numbered plate header on a hairline rule, carrying the section's own hue. The badge, the
 *  numeral and the rail's matching entry all take that one colour, so it is an index the reader
 *  can navigate by rather than decoration — see `basicsSections.ts` for why the hues ramp. */
const Section: React.FC<{
    section: BasicsSection;
    index: number;
    children: React.ReactNode;
}> = ({ section, index, children }) => (
    <section id={section.id} className="space-y-4 scroll-mt-24">
        <div className="flex items-center gap-3 border-b border-dark-border pb-3">
            <span
                aria-hidden="true"
                className={`w-6 shrink-0 text-right text-3xl leading-none ${section.text}`}
            >
                {stepNumber(index)}
            </span>
            <IconBadge
                icon={section.icon}
                size={20}
                gradientFrom={section.gradientFrom}
                gradientTo={section.gradientTo}
                className="shrink-0 !w-9 !h-9"
            />
            <h2 className="text-xl font-semibold">{section.title}</h2>
        </div>
        {children}
    </section>
);

/** One "who does the shooting" card. `data-testid` is the roles tripwire's hook: the test
 *  asserts every stat inside comes from `STATS[…].label`, never a hand-typed name. */
const RoleCard: React.FC<{ category: ShipRoleCategory }> = ({ category }) => {
    const role = ROLE_GUIDE[category];
    return (
        <div data-testid={`role-row-${category}`} className="card space-y-3">
            <div className="flex items-center gap-2 border-b border-dark-border pb-2">
                <ShipIcon
                    iconUrl={SHIP_TYPES[category].iconUrl}
                    name={SHIP_TYPES[category].name}
                    className="!w-6"
                />
                <h3 className="text-base font-semibold text-primary">
                    {SHIP_TYPES[category].name}
                </h3>
            </div>
            <p className="text-sm text-theme-text">{role.job}</p>
            <div>
                <GroupLabel className="mb-1.5">Stats to gear</GroupLabel>
                <div className="flex flex-wrap gap-1.5">
                    {role.stats.map((stat) => (
                        <Chip key={stat}>{STATS[stat].label}</Chip>
                    ))}
                </div>
                {role.statsNote && (
                    <p className="text-xs text-theme-text-secondary mt-1.5">{role.statsNote}</p>
                )}
            </div>
            {role.kitDependent && (
                <div>
                    <GroupLabel className="mb-1.5">{role.kitDependent.note}</GroupLabel>
                    <div className="space-y-1.5">
                        {role.kitDependent.options.map((option) => (
                            <div key={option.label} className="flex flex-wrap items-center gap-1.5">
                                <span className="text-xs text-theme-text-secondary shrink-0">
                                    {option.label}:
                                </span>
                                {option.stats.map((stat) => (
                                    <Chip key={stat}>{STATS[stat].label}</Chip>
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <div>
                <GroupLabel className="mb-1.5">Sets to look for</GroupLabel>
                <div className="flex flex-wrap gap-1.5">
                    {role.sets.split(', ').map((set) => (
                        <Chip key={set}>{set}</Chip>
                    ))}
                </div>
            </div>
        </div>
    );
};

/** The hacking formula as an equation. Numbers and labels are split across elements on
 *  purpose — the sentence underneath stays the readable statement of the same example. */
const HackingEquation: React.FC = () => {
    const tile = (value: string, label: string) => (
        <div className="card flex-1 min-w-[5rem] !p-3 flex flex-col justify-center text-center">
            <p className="text-2xl tabular-nums text-primary">{value}</p>
            <p className="text-xs text-theme-text-secondary">{label}</p>
        </div>
    );
    return (
        <div className="flex items-stretch gap-2 sm:gap-3 max-w-[34rem]" aria-hidden="true">
            {tile('80', STATS.hacking.label)}
            <span className="self-center text-xl text-theme-text-secondary">&minus;</span>
            {tile('40', STATS.security.label)}
            <span className="self-center text-xl text-theme-text-secondary">=</span>
            {tile('40%', 'chance to land')}
        </div>
    );
};

const OVERRIDES: { icon: LucideIcon; term: string; body: React.ReactNode }[] = [
    {
        icon: Magnet,
        term: 'Taunt',
        body: (
            <>
                a buff on one of your ships. Every enemy attack has to target it instead. If two
                ships are taunting, the most recently applied one wins.
            </>
        ),
    },
    {
        icon: Swords,
        term: 'Provoke',
        body: (
            <>
                a debuff on an enemy attacker. That specific attacker must target whoever provoked
                it.
            </>
        ),
    },
    {
        icon: Crosshair,
        term: 'Concentrate Fire',
        body: <>forces a whole team onto one target, and ignores stealth completely.</>,
    },
    {
        icon: EyeOff,
        term: 'Stealth',
        body: (
            <>
                a stealthed ship cannot be targeted by an ordinary skill. Taunt, Provoke and
                Concentrate Fire all bypass it: if one of those is forcing the target, stealth does
                not save the ship.
            </>
        ),
    },
];

const NEXT_STEPS: { icon: LucideIcon; body: React.ReactNode }[] = [
    {
        icon: Upload,
        body: (
            <>
                Import your game data using the Import button in the sidebar (also on the{' '}
                <Link to="/" className="text-primary hover:text-primary-hover">
                    Home
                </Link>{' '}
                page), and the rest of the planner fills itself in.
            </>
        ),
    },
    {
        icon: Zap,
        body: (
            <>
                Let{' '}
                <Link to="/autogear" className="text-primary hover:text-primary-hover">
                    Autogear
                </Link>{' '}
                pick a loadout for a ship, then look at what it chose and why.
            </>
        ),
    },
    {
        icon: Swords,
        body: (
            <>
                Test a team against a real encounter in the{' '}
                <Link to="/simulator" className="text-primary hover:text-primary-hover">
                    Combat Simulator
                </Link>
                .
            </>
        ),
    },
    {
        icon: ScrollText,
        body: (
            <>
                For the planner itself rather than the game, read the{' '}
                <Link to="/documentation" className="text-primary hover:text-primary-hover">
                    documentation
                </Link>
                .
            </>
        ),
    },
];

const BasicsPage: React.FC = () => {
    const location = useLocation();
    const activeId = useScrollSpy(SECTION_IDS);

    useEffect(() => {
        if (!location.hash) return;
        const element = document.getElementById(location.hash.slice(1));
        if (!element) return;
        const timer = setTimeout(() => element.scrollIntoView({ behavior: 'smooth' }), 100);
        return () => clearTimeout(timer);
    }, [location]);

    return (
        <>
            <Seo {...SEO_CONFIG.basics} />
            {/* One measure for the page: the rail, the gutter and a 68ch column. Centring the
                block keeps a wide monitor from leaving the whole page pinned to the left edge. */}
            <div className="space-y-8 max-w-[calc(14rem+2.5rem+68ch)] mx-auto">
                {/* This page is the front door for a player who has not opened the planner yet,
                    so it opens on the hangar rather than on a form — the same photographic ground
                    the sidebar stands on, with the console panel recessed onto it. Rendered
                    without PageLayout for the same reason HomePage is. */}
                <header className="relative border border-dark-border overflow-hidden">
                    <div
                        aria-hidden="true"
                        className="absolute inset-0 bg-[url('/images/Deep_crevasse_01_extended.webp')] bg-cover bg-center"
                    />
                    <div
                        aria-hidden="true"
                        className="absolute inset-0 bg-dark/90 sm:bg-gradient-to-r sm:from-dark sm:via-dark/85 sm:to-dark/40"
                    />
                    <div className="relative p-4 sm:p-6 lg:p-8 space-y-6">
                        <div className="max-w-[52ch] space-y-2">
                            <h1 className="text-2xl font-bold">Game Basics</h1>
                            <p className="text-sm text-theme-text-secondary">
                                New to Starborne Frontiers? This is what the game does not tell you:
                                what every stat is actually for, what each role does, and how the
                                game decides who gets hit.
                            </p>
                        </div>

                        {/* The mobile stand-in for the rail: below lg the sticky column is
                            hidden, so the plate on the header carries the index instead. */}
                        <nav aria-label="On this page" className="card lg:hidden bg-dark/85">
                            <GroupLabel className="mb-2 tracking-widest">Contents</GroupLabel>
                            <ol className="grid gap-x-8 sm:grid-cols-2">
                                {SECTIONS.map((section, index) => (
                                    <li key={section.id}>
                                        <a
                                            href={`#${section.id}`}
                                            className="flex items-baseline gap-2 py-2 text-sm text-theme-text"
                                        >
                                            <span
                                                className={`w-3 shrink-0 text-right text-xs tabular-nums ${section.text}`}
                                            >
                                                {stepNumber(index)}
                                            </span>
                                            <span>{section.title}</span>
                                        </a>
                                    </li>
                                ))}
                            </ol>
                        </nav>
                    </div>
                </header>

                <div className="lg:grid lg:grid-cols-[14rem_minmax(0,68ch)] lg:gap-10 lg:items-start">
                    {/* Sticky index. Its active entry takes the SECTION's hue, never Signal
                        Orange — that is what stops it reading as the sidebar's active-nav
                        treatment repeated one column away. */}
                    <nav
                        aria-label="On this page"
                        className="hidden lg:block lg:sticky lg:top-6 lg:max-h-[calc(100vh-4rem)] lg:overflow-y-auto"
                    >
                        <GroupLabel className="mb-3 tracking-widest">On this page</GroupLabel>
                        <ol>
                            {SECTIONS.map((section, index) => {
                                const isActive = section.id === activeId;
                                return (
                                    <li key={section.id}>
                                        <a
                                            href={`#${section.id}`}
                                            aria-current={isActive ? 'true' : undefined}
                                            className={`flex items-baseline gap-2 border-l-2 pl-3 py-1.5 text-sm transition-colors ${
                                                isActive
                                                    ? `${section.border} ${section.text} ${section.tint}`
                                                    : 'border-dark-border text-theme-text-secondary hover:text-theme-text hover:border-theme-text-secondary'
                                            }`}
                                        >
                                            <span
                                                className={`w-3 shrink-0 text-right text-xs tabular-nums ${
                                                    isActive ? '' : section.text
                                                }`}
                                            >
                                                {stepNumber(index)}
                                            </span>
                                            <span>{section.title}</span>
                                        </a>
                                    </li>
                                );
                            })}
                        </ol>
                    </nav>

                    <div className="space-y-12 min-w-0 max-w-[68ch] lg:max-w-none">
                        <Section section={SECTIONS[0]} index={0}>
                            <Callout>
                                <p>
                                    Ships act in order of <strong>speed</strong>, fastest first.
                                    That is all speed does — it does not give you extra turns, it
                                    decides who moves before whom.
                                </p>
                            </Callout>
                            <p>
                                That still makes it one of the most contested stats in the game,
                                because moving first is how a debuffer lands its debuff before the
                                enemy attacks, how a supporter gets a shield up before the hit
                                lands, and how you kill something before it acts at all. Some skills
                                push a ship&apos;s turn earlier or shove an enemy&apos;s later —
                                those are strong for the same reason.
                            </p>
                            <Callout variant="rule" title="Fights are not open-ended">
                                <p>
                                    A fight you have not won after 30 rounds in PvP, or 100 rounds
                                    in PvE, counts as a loss.
                                </p>
                            </Callout>
                        </Section>

                        <Section section={SECTIONS[1]} index={1}>
                            <p>
                                Every ship is an Attacker, Defender, Debuffer or Supporter. The role
                                is not cosmetic — it tells you which stats are worth putting on the
                                ship and which are wasted.
                            </p>
                            <div className="grid gap-4 sm:grid-cols-2">
                                {ROLE_CATEGORIES.map((category) => (
                                    <RoleCard key={category} category={category} />
                                ))}
                            </div>
                            <p className="text-theme-text-secondary">
                                This planner&apos;s{' '}
                                <Link
                                    to="/autogear"
                                    className="text-primary hover:text-primary-hover"
                                >
                                    Autogear
                                </Link>{' '}
                                offers finer presets — Debuffer(Bomber), Supporter(Shield) and so
                                on. Those are instructions to the optimiser about what to
                                prioritise, not extra roles in the game.
                            </p>
                        </Section>

                        <Section section={SECTIONS[2]} index={2}>
                            <Callout variant="mistake">
                                <p>
                                    The most common new-player mistake is gearing a stat the ship
                                    cannot use. Hacking on a ship with no debuffs does nothing. Crit
                                    power with no crit rate does nothing. Read the ship&apos;s
                                    skills first, then gear it.
                                </p>
                            </Callout>
                            <StatGuideTable />
                            <p className="text-theme-text-secondary">
                                Defense is the one with a curve: each point reduces incoming damage
                                a little less than the last, so past a point more HP beats more
                                defense. The{' '}
                                <Link
                                    to="/defense"
                                    className="text-primary hover:text-primary-hover"
                                >
                                    Defense Calculator
                                </Link>{' '}
                                shows where your ship sits on it.
                            </p>
                        </Section>

                        <Section section={SECTIONS[3]} index={3}>
                            <p>
                                Every ship has one of four affinities. Three of them beat each other
                                in a cycle; the fourth, Antimatter, sits outside it and neither
                                gains nor suffers.
                            </p>
                            <AffinityWheel />
                        </Section>

                        <Section section={SECTIONS[4]} index={4}>
                            <p>
                                Debuffs are not guaranteed. Whether one lands is decided by the
                                attacker&apos;s <strong>hacking</strong> against the target&apos;s{' '}
                                <strong>security</strong>: every point of hacking above the
                                target&apos;s security is one percent chance to land. Affinity
                                shifts your hacking by 25% either way before the comparison — see
                                Affinities above.
                            </p>
                            <HackingEquation />
                            <p className="text-sm text-theme-text-secondary">
                                Your debuffer has <strong>80 hacking</strong>. The enemy has{' '}
                                <strong>40 security</strong>. 80 − 40 = a{' '}
                                <strong>40% chance</strong> to apply the debuff.
                            </p>
                            <Callout variant="tip">
                                <p>
                                    Anything above 100% is wasted — there is no overkill bonus. And
                                    security works the other way: it is the only stat that stops a
                                    debuff landing on you, which is why it belongs on defenders and
                                    on anything you cannot afford to see frozen.
                                </p>
                            </Callout>
                        </Section>

                        <Section section={SECTIONS[5]} index={5}>
                            <p>
                                Both fleets sit on a board of three <strong>rows</strong> — top,
                                middle and bottom — with four <strong>positions</strong> in each,
                                numbered from the back forward.
                            </p>
                            <Callout title="Position 4 is the front">
                                <p>
                                    A skill does not just pick whoever it likes. Targeting starts in
                                    the <strong>attacking ship&apos;s own row</strong>, steps down a
                                    row if that one is empty, and wraps from the bottom back around
                                    to the top. The first row that still has a living enemy in it is
                                    the row that gets hit.
                                </p>
                            </Callout>
                            <p>
                                Try it — the attacker below sits in the bottom row, and the enemy
                                has nothing in theirs:
                            </p>
                            <TargetingBoard />
                            <p className="text-theme-text-secondary">
                                When a skill hits more than one ship, the main target takes full
                                damage and every other ship caught in the pattern takes half, unless
                                the skill says otherwise.
                            </p>
                        </Section>

                        <Section section={SECTIONS[6]} index={6}>
                            <p>Four things override everything above.</p>
                            <div className="grid gap-4 sm:grid-cols-2">
                                {OVERRIDES.map(({ icon, term, body }) => (
                                    <IconPlate key={term} icon={icon}>
                                        <strong className="text-theme-text">{term}</strong> — {body}
                                    </IconPlate>
                                ))}
                            </div>
                        </Section>

                        <Section section={SECTIONS[7]} index={7}>
                            <GearBasicsSection />
                        </Section>

                        <Section section={SECTIONS[8]} index={8}>
                            <div className="grid gap-4 sm:grid-cols-2">
                                {NEXT_STEPS.map(({ icon, body }, index) => (
                                    <IconPlate key={index} icon={icon}>
                                        {body}
                                    </IconPlate>
                                ))}
                            </div>
                        </Section>
                    </div>
                </div>
            </div>
        </>
    );
};

export default BasicsPage;
