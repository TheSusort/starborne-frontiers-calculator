import { BUFFS, Buff } from '../constants/buffs';

export function getBuffDescription(buffName: string): string | undefined {
    return BUFFS.find((buff: Buff) => buff.name === buffName)?.description;
}
