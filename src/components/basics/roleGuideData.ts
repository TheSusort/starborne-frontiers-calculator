import type { ShipRoleCategory } from '../../constants/shipTypes';
import type { StatName } from '../../types/stats';

/** Lives in this plain `.ts` module (rather than `BasicsPage.tsx` itself) so these non-component
 *  values can be exported without tripping `react-refresh/only-export-components` — same reason
 *  `STAT_GUIDE` lives outside `StatGuideTable.tsx` in `statGuideData.ts`.
 *
 *  Keyed on `ShipRoleCategory` and rendered from `SHIP_TYPES[cat].name` / `STATS[x].label` so a
 *  stat's display name can never drift from what `StatGuideTable` shows for the same stat two
 *  sections later — a test asserts every rendered role-table stat name comes from STATS. `job`
 *  and `sets` stay hand-authored prose; `sets` names real GEAR_SETS entries but is not re-keyed
 *  against them (out of scope — see the roles-table task). */
export const ROLE_GUIDE: Record<
    ShipRoleCategory,
    { job: string; stats: StatName[]; statsNote?: string; sets: string }
> = {
    ATTACKER: {
        job: 'Kills things. Everything else on your team exists to let the attacker connect.',
        stats: ['attack', 'crit', 'critDamage'],
        sets: 'Attack, Critical',
    },
    DEFENDER: {
        job: 'Survives being shot at, and takes hits meant for someone else.',
        stats: ['hp', 'defence', 'security'],
        sets: 'Fortitude, Defense, Protection',
    },
    DEBUFFER: {
        job: 'Weakens the enemy — damage over time, stuns, freezes, stat shreds.',
        stats: ['hacking', 'attack', 'speed'],
        sets: 'Hacking, Attack, Speed',
    },
    SUPPORTER: {
        job: 'Repairs, shields and buffs your side, usually before the damage lands.',
        stats: ['hp', 'speed'],
        statsNote: 'Crit Rate if it repairs',
        sets: 'Fortitude, Speed, Repair, Boost',
    },
};
