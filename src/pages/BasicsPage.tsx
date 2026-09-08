import React, { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PageLayout } from '../components/ui';
import Seo from '../components/seo/Seo';
import { SEO_CONFIG } from '../constants/seo';
import TargetingBoard from '../components/basics/TargetingBoard';
import AffinityWheel from '../components/basics/AffinityWheel';
import StatGuideTable from '../components/basics/StatGuideTable';
import GearBasicsSection from '../components/basics/GearBasicsSection';

const SECTIONS: { id: string; title: string }[] = [
    { id: 'turn-order', title: 'Speed and turn order' },
    { id: 'roles', title: 'The four roles' },
    { id: 'stats', title: 'What each stat does' },
    { id: 'affinities', title: 'Affinities' },
    { id: 'hacking-security', title: 'Hacking and security' },
    { id: 'targeting', title: 'Rows and targeting' },
    { id: 'forced-targeting', title: 'Taunt, provoke and stealth' },
    { id: 'gear', title: 'Gear, briefly' },
    { id: 'next-steps', title: 'Where to go next' },
];

const ROLE_GUIDE: { role: string; job: string; stats: string; sets: string }[] = [
    {
        role: 'Attacker',
        job: 'Kills things. Everything else on your team exists to let the attacker connect.',
        stats: 'Attack, Crit Rate, Crit Damage',
        sets: 'Attack, Critical',
    },
    {
        role: 'Defender',
        job: 'Survives being shot at, and takes hits meant for someone else.',
        stats: 'HP, Defense, Security',
        sets: 'Fortitude, Defense, Protection',
    },
    {
        role: 'Debuffer',
        job: 'Weakens the enemy — damage over time, stuns, freezes, stat shreds.',
        stats: 'Hacking, Attack, Speed',
        sets: 'Hacking, Attack, Speed',
    },
    {
        role: 'Supporter',
        job: 'Repairs, shields and buffs your side, usually before the damage lands.',
        stats: 'HP, Speed (Crit Rate if it repairs)',
        sets: 'Fortitude, Speed, Repair, Boost',
    },
];

const Section: React.FC<{ id: string; title: string; children: React.ReactNode }> = ({
    id,
    title,
    children,
}) => (
    <section id={id} className="space-y-4 scroll-mt-24">
        <h2 className="text-xl font-semibold">{title}</h2>
        {children}
    </section>
);

const BasicsPage: React.FC = () => {
    const location = useLocation();

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
            <PageLayout
                title="Game Basics"
                description="New to Starborne Frontiers? This is what the game does not tell you: what every stat is actually for, what each role does, and how the game decides who gets hit."
            >
                <div className="space-y-10">
                    <nav className="card">
                        <h2 className="text-lg font-semibold mb-3">On this page</h2>
                        <ul className="space-y-1">
                            {SECTIONS.map((s) => (
                                <li key={s.id}>
                                    <a
                                        href={`#${s.id}`}
                                        className="text-primary hover:text-primary-light"
                                    >
                                        {s.title}
                                    </a>
                                </li>
                            ))}
                        </ul>
                    </nav>

                    <Section id="turn-order" title="Speed and turn order">
                        <p>
                            Ships act in order of <strong>speed</strong>, fastest first. That is all
                            speed does — it does not give you extra turns, it decides who moves
                            before whom.
                        </p>
                        <p>
                            That still makes it one of the most contested stats in the game, because
                            moving first is how a debuffer lands its debuff before the enemy
                            attacks, how a supporter gets a shield up before the hit lands, and how
                            you kill something before it acts at all. Some skills push a ship&apos;s
                            turn earlier or shove an enemy&apos;s later — those are strong for the
                            same reason.
                        </p>
                        <p className="text-theme-text-secondary">
                            Fights are not open-ended. A fight you have not won after 30 rounds in
                            PvP, or 100 rounds in PvE, counts as a loss.
                        </p>
                    </Section>

                    <Section id="roles" title="The four roles">
                        <p>
                            Every ship is an Attacker, Defender, Debuffer or Supporter. The role is
                            not cosmetic — it tells you which stats are worth putting on the ship
                            and which are wasted.
                        </p>
                        <div className="card overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead>
                                    <tr className="border-b border-dark-border">
                                        <th scope="col" className="py-2 pr-4 font-semibold">
                                            Role
                                        </th>
                                        <th scope="col" className="py-2 pr-4 font-semibold">
                                            What it is for
                                        </th>
                                        <th scope="col" className="py-2 pr-4 font-semibold">
                                            Stats to gear
                                        </th>
                                        <th scope="col" className="py-2 font-semibold">
                                            Sets to look for
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ROLE_GUIDE.map((r) => (
                                        <tr
                                            key={r.role}
                                            className="border-b border-dark-border last:border-0 align-top"
                                        >
                                            <td className="py-2 pr-4 font-medium text-primary whitespace-nowrap">
                                                {r.role}
                                            </td>
                                            <td className="py-2 pr-4 text-theme-text">{r.job}</td>
                                            <td className="py-2 pr-4 text-theme-text">{r.stats}</td>
                                            <td className="py-2 text-theme-text-secondary">
                                                {r.sets}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p className="text-theme-text-secondary">
                            This planner&apos;s{' '}
                            <Link to="/autogear" className="text-primary hover:text-primary-light">
                                Autogear
                            </Link>{' '}
                            offers finer presets — Debuffer (Bomber), Supporter (Shield) and so on.
                            Those are instructions to the optimiser about what to prioritise, not
                            extra roles in the game.
                        </p>
                    </Section>

                    <Section id="stats" title="What each stat does">
                        <p>
                            The most common new-player mistake is gearing a stat the ship cannot
                            use. Hacking on a ship with no debuffs does nothing. Crit power with no
                            crit rate does nothing. Read the ship&apos;s skills first, then gear it.
                        </p>
                        <StatGuideTable />
                        <p className="text-theme-text-secondary">
                            Defense is the one with a curve: each point reduces incoming damage a
                            little less than the last, so past a point more HP beats more defense.
                            The{' '}
                            <Link to="/defense" className="text-primary hover:text-primary-light">
                                Defense Calculator
                            </Link>{' '}
                            shows where your ship sits on it.
                        </p>
                    </Section>

                    <Section id="affinities" title="Affinities">
                        <p>
                            Every ship has one of four affinities. Three of them beat each other in
                            a cycle; the fourth, Antimatter, sits outside it and neither gains nor
                            suffers.
                        </p>
                        <AffinityWheel />
                    </Section>

                    <Section id="hacking-security" title="Hacking and security">
                        <p>
                            Debuffs are not guaranteed. Whether one lands is decided by the
                            attacker&apos;s <strong>hacking</strong> against the target&apos;s{' '}
                            <strong>security</strong>: every point of hacking above the
                            target&apos;s security is one percent chance to land.
                        </p>
                        <div className="card">
                            <p className="text-sm">
                                Your debuffer has <strong>80 hacking</strong>. The enemy has{' '}
                                <strong>40 security</strong>. 80 − 40 = a{' '}
                                <strong>40% chance</strong> to apply the debuff.
                            </p>
                        </div>
                        <p>
                            Anything above 100% is wasted — there is no overkill bonus. And security
                            works the other way: it is the only stat that stops a debuff landing on
                            you, which is why it belongs on defenders and on anything you cannot
                            afford to see frozen.
                        </p>
                    </Section>

                    <Section id="targeting" title="Rows and targeting">
                        <p>
                            Both fleets sit on a board of three <strong>rows</strong> — top, middle
                            and bottom — with four <strong>positions</strong> in each, numbered from
                            the back forward. Position 4 is the front.
                        </p>
                        <p>
                            A skill does not just pick whoever it likes. Targeting starts in the{' '}
                            <strong>attacking ship&apos;s own row</strong>, steps down a row if that
                            one is empty, and wraps from the bottom back around to the top. The
                            first row that still has a living enemy in it is the row that gets hit.
                        </p>
                        <p>
                            Try it — the attacker below sits in the bottom row, and the enemy has
                            nothing in theirs:
                        </p>
                        <TargetingBoard />
                        <p className="text-theme-text-secondary">
                            When a skill hits more than one ship, the main target takes full damage
                            and every other ship caught in the pattern takes half, unless the skill
                            says otherwise.
                        </p>
                    </Section>

                    <Section id="forced-targeting" title="Taunt, provoke and stealth">
                        <p>Four things override everything above.</p>
                        <ul className="list-disc list-inside space-y-2">
                            <li>
                                <strong>Taunt</strong> — a buff on one of your ships. Every enemy
                                attack has to target it instead. If two ships are taunting, the most
                                recently applied one wins.
                            </li>
                            <li>
                                <strong>Provoke</strong> — a debuff on an enemy attacker. That
                                specific attacker must target whoever provoked it.
                            </li>
                            <li>
                                <strong>Concentrate Fire</strong> — forces a whole team onto one
                                target, and ignores stealth completely.
                            </li>
                            <li>
                                <strong>Stealth</strong> — a stealthed ship cannot be targeted at
                                all, except by skills that specifically say they can hit stealth,
                                and by Concentrate Fire.
                            </li>
                        </ul>
                    </Section>

                    <Section id="gear" title="Gear, briefly">
                        <GearBasicsSection />
                    </Section>

                    <Section id="next-steps" title="Where to go next">
                        <ul className="list-disc list-inside space-y-2">
                            <li>
                                Import your game data on the{' '}
                                <Link to="/ships" className="text-primary hover:text-primary-light">
                                    Ships
                                </Link>{' '}
                                page, and the rest of the planner fills itself in.
                            </li>
                            <li>
                                Let{' '}
                                <Link
                                    to="/autogear"
                                    className="text-primary hover:text-primary-light"
                                >
                                    Autogear
                                </Link>{' '}
                                pick a loadout for a ship, then look at what it chose and why.
                            </li>
                            <li>
                                Test a team against a real encounter in the{' '}
                                <Link
                                    to="/simulator"
                                    className="text-primary hover:text-primary-light"
                                >
                                    Combat Simulator
                                </Link>
                                .
                            </li>
                            <li>
                                For the planner itself rather than the game, read the{' '}
                                <Link
                                    to="/documentation"
                                    className="text-primary hover:text-primary-light"
                                >
                                    documentation
                                </Link>
                                .
                            </li>
                        </ul>
                    </Section>
                </div>
            </PageLayout>
        </>
    );
};

export default BasicsPage;
