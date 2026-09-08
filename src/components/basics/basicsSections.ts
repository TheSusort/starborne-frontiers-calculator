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
}

/** The page's sections in reading order — the source of both the section headers and the
 *  navigation rail, so a section can never exist without a link to it (a test asserts every
 *  id here renders an anchor and a matching `a[href="#id"]`).
 *
 *  Lives in this plain `.ts` module (rather than `BasicsPage.tsx` itself) so these
 *  non-component values can be exported without tripping `react-refresh/only-export-components`
 *  — same reason `STAT_GUIDE` lives outside `StatGuideTable.tsx` in `statGuideData.ts`. */
export const SECTIONS: BasicsSection[] = [
    {
        id: 'turn-order',
        title: 'Speed and turn order',
        icon: Gauge,
        gradientFrom: 'from-amber-600',
        gradientTo: 'to-amber-800',
    },
    {
        id: 'roles',
        title: 'The four roles',
        icon: Users,
        gradientFrom: 'from-blue-600',
        gradientTo: 'to-blue-800',
    },
    {
        id: 'stats',
        title: 'What each stat does',
        icon: BarChart3,
        gradientFrom: 'from-purple-600',
        gradientTo: 'to-purple-800',
    },
    {
        id: 'affinities',
        title: 'Affinities',
        icon: Atom,
        gradientFrom: 'from-emerald-600',
        gradientTo: 'to-emerald-800',
    },
    {
        id: 'hacking-security',
        title: 'Hacking and security',
        icon: ShieldAlert,
        gradientFrom: 'from-cyan-600',
        gradientTo: 'to-cyan-800',
    },
    {
        id: 'targeting',
        title: 'Rows and targeting',
        icon: Crosshair,
        gradientFrom: 'from-rose-600',
        gradientTo: 'to-rose-800',
    },
    {
        id: 'forced-targeting',
        title: 'Taunt, provoke and stealth',
        icon: Magnet,
        gradientFrom: 'from-indigo-600',
        gradientTo: 'to-indigo-800',
    },
    {
        id: 'gear',
        title: 'Gear, briefly',
        icon: Wrench,
        gradientFrom: 'from-slate-500',
        gradientTo: 'to-slate-700',
    },
    {
        id: 'next-steps',
        title: 'Where to go next',
        icon: Compass,
        gradientFrom: 'from-orange-600',
        gradientTo: 'to-orange-800',
    },
];

/** Stable identity for the scroll-spy effect's dependency array. */
export const SECTION_IDS: string[] = SECTIONS.map((s) => s.id);
