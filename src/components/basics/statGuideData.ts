import type { StatName } from '../../types/stats';

/** Lives in this plain `.ts` module (rather than `StatGuideTable.tsx` itself) so non-component
 *  values can be exported without tripping `react-refresh/only-export-components` — the rule
 *  fires when a `.tsx` component file also exports non-primitive constants.
 *
 *  Stats in STATS that are planner-internal modelling values, not things a player sees or
 *  gears in game. Excluded from the page on purpose; a test asserts every STATS key is either
 *  documented below or listed here.
 *
 *  hpRegen: the planner's way of modelling self-repair triggered by an incoming hit. There is
 *  no "HP Regen" stat in the game. */
export const NOT_A_GAME_STAT: StatName[] = ['hpRegen'];

/** Which of the three panels a stat is taught in. The grouping is a reading aid, not a game
 *  mechanic: it exists so thirteen stats scan as three ideas rather than one list. */
export type StatGroup = 'offensive' | 'defensive' | 'utility';

/** Band order, heading and hue, keyed by `StatGroup`. `StatGuideTable` renders the bands in this
 *  object's order and puts each stat in the band its `group` names. The hue is what lets a reader
 *  scanning thirteen rows see which of the three ideas they are inside without reading a heading. */
export const STAT_GROUPS: Record<StatGroup, { title: string; accent: string; text: string }> = {
    offensive: { title: 'Offensive', accent: 'border-l-red-500', text: 'text-red-400' },
    defensive: { title: 'Defensive', accent: 'border-l-sky-500', text: 'text-sky-400' },
    utility: { title: 'Utility', accent: 'border-l-emerald-500', text: 'text-emerald-400' },
};

/** Player-facing explanation per stat. `does` is the mechanic; `wants` is who it is worth
 *  gearing on — the teaching point is that a stat on the wrong ship does nothing at all.
 *  `group` decides which panel the stat is shown in; carrying it here rather than in a second
 *  list means the STATS-coverage test below is the only tripwire a new stat has to satisfy.
 *  A test asserts this plus NOT_A_GAME_STAT covers every key in STATS. */
export const STAT_GUIDE: Partial<
    Record<StatName, { does: string; wants: string; group: StatGroup }>
> = {
    attack: {
        does: 'Scales almost all damage, including the damage-over-time effects that read off it. A handful of ships also read attack for a shield or a repair, but that is specific to their kit.',
        wants: 'Attackers first. Also debuffers whose damaging debuffs scale off attack.',
        group: 'offensive',
    },
    hp: {
        does: 'How much damage you can absorb before dying. Several skills also scale their effect off maximum HP.',
        wants: 'Defenders and supporters. Anything that has to survive being shot at.',
        group: 'defensive',
    },
    defence: {
        does: 'Reduces every hit you take. The reduction climbs with diminishing returns, so the first points are worth far more than the last.',
        wants: 'Defenders. Worth some on anything that sits at the front.',
        group: 'defensive',
    },
    crit: {
        does: 'The chance a hit crits. Worthless on its own — a crit that lands with no crit power behind it is a normal hit.',
        wants: 'Attackers, and healers whose repairs can crit.',
        group: 'offensive',
    },
    critDamage: {
        does: 'How much extra damage a crit does. Equally worthless on its own — crit power you never trigger is a dead stat.',
        wants: 'Attackers, and healers whose repairs can crit. Only alongside crit rate — balance the two rather than stacking one.',
        group: 'offensive',
    },
    speed: {
        does: 'Decides turn order, fastest first. It does not give you extra turns.',
        wants: 'Everything, but debuffers and supporters most — their whole job is to act before the enemy does.',
        group: 'utility',
    },
    hacking: {
        does: "The chance your debuffs land. Every point above the target's security is one percent.",
        wants: 'Debuffers first, but every role has outlier ships whose kit inflicts a debuff and wants hacking to land it. On a ship whose kit inflicts nothing, it does literally nothing.',
        group: 'utility',
    },
    security: {
        does: "Resists incoming debuffs. The attacker's hacking is measured against it.",
        wants: 'Defenders, and anything you cannot afford to see stunned or frozen.',
        group: 'defensive',
    },
    healModifier: {
        does: 'Increases the repairs this ship performs.',
        wants: 'Supporters that actually repair. A few tanks that heal on hit can build around it too, but that is an outlier strategy, not the norm.',
        group: 'utility',
    },
    shield: {
        does: 'Generates shield each turn as a share of maximum HP. Shield absorbs damage before HP does.',
        wants: 'No ship is "built around" the Shield set — gear it for raw survivability, for a ship kit that synergises with shield, or to feed the Arcane Siege implant.',
        group: 'defensive',
    },
    defensePenetration: {
        does: "Ignores part of the target's defense, so more of your attack gets through.",
        wants: 'Attackers hitting high-defense targets, where raw attack has stopped paying.',
        group: 'offensive',
    },
    shieldPenetration: {
        does: "Ignores part of a target's shield. It is not a stat you can gear: it comes only from a ship's own skills.",
        wants: 'Nothing to gear for. A ship either has it in its kit or it does not.',
        group: 'offensive',
    },
    damageReduction: {
        does: 'Reduces the extra damage a critical hit does to you.',
        wants: 'Defenders, and anything being focused by a crit-built attacker.',
        group: 'defensive',
    },
};
