import React, { useMemo } from 'react';
import { Select } from '../ui/Select';
import {
    BOUNTY_BOSSES,
    BOUNTY_ENCOUNTERS,
    bossShipId,
    parseBossShipId,
} from '../../constants/bountyBosses';
import { encounterBoard, loadedBossShipId } from '../../utils/simulator/bossBoard';
import type { BoardState } from './PlacementBoard';

const NONE = '';

interface Props {
    /** The enemy board; the selected encounter is whichever boss it holds at its anchor. */
    board: BoardState;
    /** Replaces the whole board: the boss at its anchor and its adds, or `{}` for None. */
    onChange: (board: BoardState) => void;
    disabled?: boolean;
    helpLabel?: string;
}

const BossEncounterPicker: React.FC<Props> = ({ board, onChange, disabled, helpLabel }) => {
    const options = useMemo(
        () => [
            { value: NONE, label: 'None' },
            ...BOUNTY_ENCOUNTERS.flatMap((encounter) => {
                const boss = BOUNTY_BOSSES.find((candidate) => candidate.id === encounter.bountyId);
                return boss
                    ? [
                          {
                              value: bossShipId(boss.id, encounter.level),
                              label: `${boss.name} — Lv ${encounter.level}`,
                          },
                      ]
                    : [];
            }),
        ],
        []
    );

    const handleChange = (value: string) => {
        const parsed = value === NONE ? null : parseBossShipId(value);
        if (!parsed) {
            onChange({});
            return;
        }
        const loaded = encounterBoard(parsed.id, parsed.level);
        if (loaded) onChange(loaded);
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
