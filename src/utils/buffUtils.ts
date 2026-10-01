import { BUFFS, Buff } from '../constants/buffs';
import { canonicalStatusName } from './skillTextParser';

/** The description of a status by name; a catalogue spelling (`STATUS_NAME_ALIASES`) resolves to
 *  the engine's name first. */
export function getBuffDescription(buffName: string): string | undefined {
    const name = canonicalStatusName(buffName);
    return BUFFS.find((buff: Buff) => buff.name === name)?.description;
}
