import type { AffinityName } from '../types/ship';

/** Select options for the four ship/enemy affinities, in canonical calculator order. */
export const AFFINITY_OPTIONS: { value: AffinityName; label: string }[] = [
    { value: 'antimatter', label: 'Antimatter' },
    { value: 'thermal', label: 'Thermal' },
    { value: 'chemical', label: 'Chemical' },
    { value: 'electric', label: 'Electric' },
];
