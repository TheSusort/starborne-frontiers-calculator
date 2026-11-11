import React, { useMemo } from 'react';
import { Select } from '../ui/Select';
import { BOUNTY_BOSSES, bossShip, bossShipId, parseBossShipId } from '../../constants/bountyBosses';
import { loadedBossShipId } from '../../utils/simulator/bossBoard';
import type { BoardState } from './PlacementBoard';

const NONE = '';

interface Props {
    /** The enemy board; the selected encounter is whichever boss it holds at its anchor. */
    board: BoardState;
    /** Replaces the whole board: the boss at its anchor, or `{}` for None. */
    onChange: (board: BoardState) => void;
    disabled?: boolean;
    helpLabel?: string;
}

const BossEncounterPicker: React.FC<Props> = ({ board, onChange, disabled, helpLabel }) => {
    const options = useMemo(
        () => [
            { value: NONE, label: 'None' },
            ...BOUNTY_BOSSES.flatMap((boss) =>
                Object.keys(boss.statsByLevel).map((level) => ({
                    value: bossShipId(boss.id, Number(level)),
                    label: `${boss.name} — Lv ${level}`,
                }))
            ),
        ],
        []
    );

    const handleChange = (value: string) => {
        const parsed = value === NONE ? null : parseBossShipId(value);
        if (!parsed) {
            onChange({});
            return;
        }
        const ship = bossShip(parsed.id, parsed.level);
        const boss = BOUNTY_BOSSES.find((candidate) => candidate.id === parsed.id);
        if (!ship || !boss) return;
        onChange({ [boss.footprint[0]]: { ship } });
    };

    return (
        <Select
            label="Encounter"
            options={options}
            value={loadedBossShipId(board) ?? NONE}
            onChange={handleChange}
            disabled={disabled}
            helpLabel={helpLabel}
        />
    );
};

export default BossEncounterPicker;
