import { describe, expect, it } from 'vitest';
import { beatBoardShip, floatsFor } from '../beatBoardShip';
import type { FightBeat, FightShipState } from '../fightBeats';

const state = (s: Partial<FightShipState> = {}): FightShipState => ({
    position: 'M3',
    hpPct: 100,
    shieldPct: 0,
    buffs: [],
    debuffs: [],
    alive: true,
    charge: null,
    ...s,
});

const beat = (b: Partial<FightBeat>): FightBeat => ({
    round: 1,
    actor: 'player',
    actorShip: 0,
    charged: null,
    hits: [],
    player: [state()],
    enemy: [state()],
    ...b,
});

const nova = { name: 'Nova', imageUrl: 'nova.jpg' };

const beats: FightBeat[] = [
    beat({
        hits: [{ side: 'enemy', ship: 0, kind: 'damage', amount: 500, crit: false }],
        enemy: [state({ hpPct: 80 })],
    }),
    beat({
        actor: 'enemy',
        charged: { skillName: 'Overcharge' },
        hits: [{ side: 'player', ship: 0, kind: 'damage', amount: 900, crit: true }],
        player: [state({ hpPct: 40, charge: { value: 0, max: 3 } })],
        enemy: [state({ hpPct: 80, buffs: ['Attack Up II'] })],
    }),
];

describe('beatBoardShip', () => {
    it('maps the beat state, the acting rim, the banner, the numbers and the strike flash', () => {
        const enemy = beatBoardShip(nova, beats, 1, true, 'enemy', 0);
        expect(enemy).toMatchObject({
            name: 'Nova',
            imageUrl: 'nova.jpg',
            hpPct: 80,
            buffs: ['Attack Up II'],
            acting: true,
            flash: null,
            banner: { key: 1, text: 'CHARGED: Overcharge', short: 'CHARGED' },
        });
        // The previous beat's hit on it is still rising.
        expect(enemy.floats).toEqual([{ turn: 0, hits: [beats[0].hits[0]] }]);

        const player = beatBoardShip(nova, beats, 1, true, 'player', 0);
        expect(player).toMatchObject({ hpPct: 40, chargePct: 0, acting: false, flash: 1 });
        expect(player.banner).toBeNull();
    });

    it('not playing: state only, no numbers, rim or banner', () => {
        const enemy = beatBoardShip(nova, beats, 1, false, 'enemy', 0);
        expect(enemy).toMatchObject({ hpPct: 80, acting: false, floats: [], flash: null });
        expect(enemy.banner).toBeNull();
    });

    it('without motion: no numbers and no flash, the rest unchanged', () => {
        const player = beatBoardShip(nova, beats, 1, true, 'player', 0, { motion: false });
        expect(player).toMatchObject({ hpPct: 40, floats: [], flash: null });
        const enemy = beatBoardShip(nova, beats, 1, true, 'enemy', 0, { motion: false });
        expect(enemy.banner?.text).toBe('CHARGED: Overcharge');
    });
});

describe('floatsFor', () => {
    it('keeps only the current and previous beat, and only hits on that ship', () => {
        expect(floatsFor(beats, 0, 'player', 0)).toEqual([]);
        expect(floatsFor(beats, 1, 'player', 0)).toEqual([{ beat: 1, hits: [beats[1].hits[0]] }]);
    });
});
