export * from './changelog';
export * from './config';
export * from './factions';
export * from './gearSets';
export * from './gearTypes';
export * from './jokes';
export * from './mainStatValues';
export * from './rarities';
export * from './shipTypes';
export * from './stats';
export * from './statValues';
export * from './storage';

// Create lazy loaded exports for heavy data
export const loadShips = () => import('./ships').then((m) => m.SHIPS);
