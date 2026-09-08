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
 *  against them (out of scope — see the roles-table task).
 *
 *  `kitDependent` covers a role whose secondary stats are not universal — a debuffer's kit
 *  decides whether it wants damage or survivability behind hacking/speed, so those stats do not
 *  belong in the primary `stats` chip row (that would claim every debuffer wants all of them). */
export const ROLE_GUIDE: Record<
    ShipRoleCategory,
    {
        job: string;
        stats: StatName[];
        statsNote?: string;
        kitDependent?: { note: string; options: { label: string; stats: StatName[] }[] };
        sets: string;
    }
> = {
    ATTACKER: {
        job: 'Kills things. Everything else on your team exists to let the attacker connect.',
        stats: ['attack', 'crit', 'critDamage', 'defensePenetration'],
        sets: 'Attack, Critical, Piercer, Abyssal Assault',
    },
    DEFENDER: {
        job: 'Survives being shot at, and takes hits meant for someone else.',
        stats: ['hp', 'defence', 'security'],
        sets: 'Fortitude, Defense, Protection, Abyssal Safeguard, Abyssal Ward',
    },
    DEBUFFER: {
        job: 'Weakens the enemy — damage over time, stuns, freezes, stat shreds.',
        stats: ['hacking', 'speed'],
        kitDependent: {
            note: "Secondary — picked by the ship's kit",
            options: [
                { label: 'Damage', stats: ['attack', 'crit', 'critDamage'] },
                { label: 'Survivability', stats: ['hp', 'defence'] },
            ],
        },
        sets: 'Hacking, Speed, Swiftness, Abyssal Breach, Exploit',
    },
    SUPPORTER: {
        job: 'Repairs, shields and buffs your side, usually before the damage lands.',
        stats: ['hp', 'speed'],
        statsNote: 'Crit Rate and Crit Power if it repairs',
        sets: 'Fortitude, Speed, Repair, Boost, Recovery',
    },
};
