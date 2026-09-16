import type { Ship } from '../../../types/ship';
import type { Position } from '../../../types/encounters';
import type { BoardState } from '../../../components/simulator/PlacementBoard';
import {
    DEFAULT_ENEMY_HP,
    DEFAULT_ENEMY_DEFENCE,
    DEFAULT_ENEMY_SECURITY,
    DEFAULT_ENEMY_SPEED,
} from '../../calculators/healingDefaultEnemy';

/** A generic combatant needs skill text: `getShipSkillRows` drops empty-text rows, so a ship
 *  without any resolves to zero abilities and every fight is a 0-damage draw. */
const SPARRING_SKILL = 'This Unit deals <unit-damage>120% damage</unit-damage>.';

const sparringPartner = (id: string, attack: number, speed: number): Ship =>
    ({
        id,
        name: id,
        type: 'ATTACKER',
        baseStats: {
            attack,
            crit: 50,
            critDamage: 150,
            hacking: 200,
            security: DEFAULT_ENEMY_SECURITY,
            defence: DEFAULT_ENEMY_DEFENCE,
            hp: DEFAULT_ENEMY_HP,
            speed,
        },
        equipment: {},
        implants: {},
        refits: [],
        activeSkillText: SPARRING_SKILL,
        activeTarget: 'front',
        activePattern: 'Pattern-Base',
    }) as unknown as Ship;

const FOCUS_POSITION: Position = 'M4';
const ALLY_POSITIONS: Position[] = ['T2', 'B2'];
const ENEMY_POSITIONS: Position[] = ['M4', 'T2', 'B2'];

/** The healing calculator's constants have no `attack` field (a practice target for healing
 *  doesn't hit back), so this fixture needs its own. Tuned so the player side — the focus plus
 *  two sparring allies — wins roughly 60-90% of fights against three sparring enemies rather than
 *  every fight: a blowout would leave every metric insensitive to the focus ship's own gear. */
const SPARRING_ENEMY_ATTACK = 4_800;

/**
 * The fight used when the player has picked no encounter or saved setup.
 *
 * One fixture for every role: the role selects the primary metric, not the board. The focus gets
 * allies because a focus-alone board would make a team-damage metric identical to focus damage.
 *
 * Enemy stats come from the healing calculator's practice-target constants so the two practice
 * opponents in this app cannot drift into different numbers.
 *
 * This is deliberately NOT a team-aware answer: the board carries no real ally kit and no real
 * opponent, so it cannot say whether a build is better with the player's actual team against the
 * player's actual enemy — only how it performs against this generic sparring pair.
 */
export function practiceBoards(focus: Ship): {
    playerBoard: BoardState;
    enemyBoard: BoardState;
} {
    const playerBoard: BoardState = { [FOCUS_POSITION]: { ship: focus } };
    ALLY_POSITIONS.forEach((position, index) => {
        playerBoard[position] = {
            ship: sparringPartner(`practice-ally-${index}`, 4_200, 100 - index),
        };
    });

    const enemyBoard: BoardState = {};
    ENEMY_POSITIONS.forEach((position, index) => {
        enemyBoard[position] = {
            ship: sparringPartner(
                `practice-enemy-${index}`,
                SPARRING_ENEMY_ATTACK,
                DEFAULT_ENEMY_SPEED + index
            ),
        };
    });

    return { playerBoard, enemyBoard };
}
