import type { HexBoardShip } from './AnimatedHexBoard';
import type { FightBeat, FightHit, FightShipState, FightSide } from './fightBeats';

/** Who stands on a cell, which no beat carries: what the board draws besides the fight state. */
export interface BoardShipIdentity {
    name: string;
    imageUrl: string | null;
    /** The image already faces the other side, so a mirrored board never flips it. */
    facesOpponent?: boolean;
}

/** The state shown for a ship before the first beat. */
export const IDLE_SHIP_STATE: FightShipState = {
    position: 'M2',
    hpPct: 100,
    shieldPct: 0,
    buffs: [],
    debuffs: [],
    alive: true,
    charge: null,
};

export const chargedText = (charged: { skillName?: string }) =>
    charged.skillName ? `CHARGED: ${charged.skillName}` : 'CHARGED SKILL';

/** The numbers still floating over ship `ship` of `side` while beat `index` plays: the current
 *  beat's and the one before it, so a short turn does not cut a number off mid-rise. */
export const floatsFor = (beats: FightBeat[], index: number, side: FightSide, ship: number) =>
    [index - 1, index]
        .filter((i) => i >= 0 && i < beats.length)
        .map((i) => ({
            beat: i,
            hits: beats[i].hits.filter((h) => h.side === side && h.ship === ship),
        }))
        .filter((f) => f.hits.length > 0);

/**
 * Ship `ship` of side `key` while beat `index` plays. With `playing` false (the playback is over,
 * or not started) the ship shows its state only: no floating numbers, no acting rim, no banner.
 */
export const beatShipProps = (
    beats: FightBeat[],
    index: number,
    playing: boolean,
    key: FightSide,
    ship: number
) => {
    const beat = index >= 0 ? beats[index] : null;
    const acting = playing && beat?.actor === key && beat.actorShip === ship;
    return {
        state: beat?.[key][ship] ?? IDLE_SHIP_STATE,
        floats: playing ? floatsFor(beats, index, key, ship) : [],
        charged:
            acting && beat?.charged ? { beat: index, skillName: beat.charged.skillName } : null,
        acting,
    };
};

const landsDamage = (hits: readonly FightHit[]) => hits.some((h) => h.kind === 'damage');

/**
 * What ship `ship` of side `key` shows on its hex while beat `index` plays (see
 * `beatShipProps`). A ship struck by damage on this beat flashes. With `motion` false the ship
 * carries no floating numbers and no flash, so the board only jumps from state to state.
 */
export const beatBoardShip = (
    identity: BoardShipIdentity,
    beats: FightBeat[],
    index: number,
    playing: boolean,
    key: FightSide,
    ship: number,
    { motion = true }: { motion?: boolean } = {}
): HexBoardShip => {
    const { state, floats, charged, acting } = beatShipProps(beats, index, playing, key, ship);
    const struck = motion && floats.find((f) => f.beat === index && landsDamage(f.hits));
    return {
        name: identity.name,
        imageUrl: identity.imageUrl,
        facesOpponent: identity.facesOpponent,
        hpPct: state.hpPct,
        shieldPct: state.shieldPct,
        chargePct: state.charge ? (100 * state.charge.value) / state.charge.max : null,
        buffs: state.buffs,
        debuffs: state.debuffs,
        alive: state.alive,
        acting,
        floats: motion ? floats.map((f) => ({ turn: f.beat, hits: f.hits })) : [],
        flash: struck ? index : null,
        banner: charged && {
            key: charged.beat,
            text: chargedText(charged),
            short: 'CHARGED',
        },
    };
};
