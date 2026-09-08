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

/** Player-facing explanation per stat. `does` is the mechanic; `wants` is who it is worth
 *  gearing on — the teaching point is that a stat on the wrong ship does nothing at all.
 *  A test asserts this plus NOT_A_GAME_STAT covers every key in STATS. */
export const STAT_GUIDE: Partial<Record<StatName, { does: string; wants: string }>> = {
    attack: {
        does: 'Scales almost all damage, including the damage-over-time effects that read off it. A handful of ships also read attack for a shield or a repair, but that is specific to their kit.',
        wants: 'Attackers first. Also debuffers whose damaging debuffs scale off attack.',
    },
    hp: {
        does: 'How much damage you can absorb before dying. Several skills also scale their effect off maximum HP.',
        wants: 'Defenders and supporters. Anything that has to survive being shot at.',
    },
    defence: {
        does: 'Reduces every hit you take. The reduction climbs with diminishing returns, so the first points are worth far more than the last.',
        wants: 'Defenders. Worth some on anything that sits at the front.',
    },
    crit: {
        does: 'The chance a hit crits. Worthless on its own — a crit that lands with no crit power behind it is a normal hit.',
        wants: 'Attackers, and supporters whose repairs can crit.',
    },
    critDamage: {
        does: 'How much extra damage a crit does. Equally worthless on its own — crit power you never trigger is a dead stat.',
        wants: 'Attackers, and only alongside crit rate. Balance the two rather than stacking one.',
    },
    speed: {
        does: 'Decides turn order, fastest first. It does not give you extra turns.',
        wants: 'Everything, but debuffers and supporters most — their whole job is to act before the enemy does.',
    },
    hacking: {
        does: "The chance your debuffs land. Every point above the target's security is one percent.",
        wants: 'Debuffers, and only them. On a ship with no debuffs in its kit it does literally nothing.',
    },
    security: {
        does: "Resists incoming debuffs. The attacker's hacking is measured against it.",
        wants: 'Defenders, and anything you cannot afford to see stunned or frozen.',
    },
    healModifier: {
        does: 'Increases the repairs this ship performs.',
        wants: 'Supporters that actually repair. Nothing else.',
    },
    shield: {
        does: 'Generates shield each turn as a share of maximum HP. Shield absorbs damage before HP does.',
        wants: 'Ships built around the Shield set, and anything that needs to soak chip damage.',
    },
    defensePenetration: {
        does: "Ignores part of the target's defense, so more of your attack gets through.",
        wants: 'Attackers hitting high-defense targets, where raw attack has stopped paying.',
    },
    shieldPenetration: {
        does: "Ignores part of a target's shield.",
        wants: 'Attackers facing shield-heavy teams.',
    },
    damageReduction: {
        does: 'Reduces the extra damage a critical hit does to you.',
        wants: 'Defenders, and anything being focused by a crit-built attacker.',
    },
};
