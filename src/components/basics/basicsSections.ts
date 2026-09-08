import {
    Gauge,
    Users,
    BarChart3,
    Atom,
    ShieldAlert,
    Crosshair,
    Magnet,
    Wrench,
    Compass,
    type LucideIcon,
} from 'lucide-react';

export interface BasicsSection {
    id: string;
    title: string;
    icon: LucideIcon;
    /** Tailwind gradient stops for the section's `IconBadge`. */
    gradientFrom: string;
    gradientTo: string;
    /** The same hue as text, for the section number and the rail's active entry. */
    text: string;
    /** The same hue as a border, for the rail's active entry. */
    border: string;
    /** The same hue at 10% as a ground, for the rail's active entry. */
    tint: string;
}

/** The page's sections in reading order — the source of the section headers, the navigation rail
 *  and the mobile index, so a section can never exist without a link to it (a test asserts every
 *  id here renders an anchor and a matching `a[href="#id"]`).
 *
 *  Each section owns a hue, and the hues walk one direction round the wheel so the rail reads as
 *  a ramp rather than a jumble. The hue is wayfinding, not decoration: the same one marks the
 *  section's badge, its number and its entry in the rail, so a reader who remembers "affinities
 *  was the sky-blue one" can find it in the rail without reading. That is also what keeps the
 *  rail's active entry from being the sidebar's active-nav treatment repeated a column away —
 *  the sidebar is always Signal Orange, a rail entry never is.
 *
 *  Lives in this plain `.ts` module (rather than `BasicsPage.tsx` itself) so these
 *  non-component values can be exported without tripping `react-refresh/only-export-components`
 *  — same reason `STAT_GUIDE` lives outside `StatGuideTable.tsx` in `statGuideData.ts`. */
export const SECTIONS: BasicsSection[] = [
    {
        id: 'turn-order',
        title: 'Speed and turn order',
        icon: Gauge,
        gradientFrom: 'from-violet-600',
        gradientTo: 'to-violet-900',
        text: 'text-violet-400',
        border: 'border-violet-400',
        tint: 'bg-violet-400/10',
    },
    {
        id: 'roles',
        title: 'The four roles',
        icon: Users,
        gradientFrom: 'from-indigo-600',
        gradientTo: 'to-indigo-900',
        text: 'text-indigo-400',
        border: 'border-indigo-400',
        tint: 'bg-indigo-400/10',
    },
    {
        id: 'stats',
        title: 'What each stat does',
        icon: BarChart3,
        gradientFrom: 'from-blue-600',
        gradientTo: 'to-blue-900',
        text: 'text-blue-400',
        border: 'border-blue-400',
        tint: 'bg-blue-400/10',
    },
    {
        id: 'affinities',
        title: 'Affinities',
        icon: Atom,
        gradientFrom: 'from-sky-600',
        gradientTo: 'to-sky-900',
        text: 'text-sky-400',
        border: 'border-sky-400',
        tint: 'bg-sky-400/10',
    },
    {
        id: 'hacking-security',
        title: 'Hacking and security',
        icon: ShieldAlert,
        gradientFrom: 'from-cyan-600',
        gradientTo: 'to-cyan-900',
        text: 'text-cyan-400',
        border: 'border-cyan-400',
        tint: 'bg-cyan-400/10',
    },
    {
        id: 'targeting',
        title: 'Rows and targeting',
        icon: Crosshair,
        gradientFrom: 'from-teal-600',
        gradientTo: 'to-teal-900',
        text: 'text-teal-400',
        border: 'border-teal-400',
        tint: 'bg-teal-400/10',
    },
    {
        id: 'forced-targeting',
        title: 'Taunt, provoke and stealth',
        icon: Magnet,
        gradientFrom: 'from-emerald-600',
        gradientTo: 'to-emerald-900',
        text: 'text-emerald-400',
        border: 'border-emerald-400',
        tint: 'bg-emerald-400/10',
    },
    {
        id: 'gear',
        title: 'Gear, briefly',
        icon: Wrench,
        gradientFrom: 'from-lime-600',
        gradientTo: 'to-lime-900',
        text: 'text-lime-400',
        border: 'border-lime-400',
        tint: 'bg-lime-400/10',
    },
    {
        id: 'next-steps',
        title: 'Where to go next',
        icon: Compass,
        gradientFrom: 'from-yellow-600',
        gradientTo: 'to-yellow-900',
        text: 'text-yellow-400',
        border: 'border-yellow-400',
        tint: 'bg-yellow-400/10',
    },
];

/** Stable identity for the scroll-spy effect's dependency array. */
export const SECTION_IDS: string[] = SECTIONS.map((s) => s.id);
