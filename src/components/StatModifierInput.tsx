import React from 'react';
import { Select, Input, Button } from './ui';
import { Stat } from '../types/gear';
import { CloseIcon } from './ui/CloseIcon';

interface Props {
  stats: Stat[];
  onChange: (stats: Stat[]) => void;
  maxStats: number;
}

export const StatModifierInput: React.FC<Props> = ({ stats, onChange, maxStats }) => {
  const handleStatChange = (index: number, field: keyof Stat, value: string) => {
    const newStats = [...stats];
    newStats[index] = {
      ...newStats[index],
      [field]: field === 'value' ? Number(value) : value,
    };
    onChange(newStats);
  };

  const addStat = () => {
    if (stats.length < maxStats) {
      onChange([...stats, { name: 'attack', type: 'flat', value: 0 }]);
    }
  };

  const removeStat = (index: number) => {
    const newStats = stats.filter((_, i) => i !== index);
    onChange(newStats);
  };

  return (
    <div className="space-y-4">
      {stats.map((stat, index) => (
        <div key={index} className="flex gap-4 items-end">
          <Select
            label="Stat"
            value={stat.name}
            onChange={(e) => handleStatChange(index, 'name', e.target.value)}
            options={[
              { value: 'attack', label: 'Attack' },
              { value: 'defence', label: 'Defence' },
              { value: 'hp', label: 'HP' },
              { value: 'speed', label: 'Speed' },
              { value: 'crit', label: 'Crit' },
              { value: 'critDamage', label: 'Crit Damage' },
              { value: 'hacking', label: 'Hacking' },
              { value: 'security', label: 'Security' },
            ]}
          />
          <Input
            type="number"
            label="Value"
            value={stat.value}
            onChange={(e) => handleStatChange(index, 'value', e.target.value)}
          />
          <Select
            label="Type"
            value={stat.type}
            onChange={(e) => handleStatChange(index, 'type', e.target.value)}
            options={[
              { value: 'flat', label: 'Flat' },
              { value: 'percentage', label: 'Percentage' },
            ]}
          />
          <Button
            variant="danger"
            onClick={() => removeStat(index)}
          >
            <CloseIcon />
          </Button>
        </div>
      ))}
      {stats.length < maxStats && (
        <Button
          variant="secondary"
          onClick={addStat}
          type="button"
        >
          Add Stat
        </Button>
      )}
    </div>
  );
};