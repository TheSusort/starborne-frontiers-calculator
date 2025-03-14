import { useCallback } from 'react';
import { EncounterNote } from '../types/encounters';
import { useStorage } from './useStorage';
import { STORAGE_KEYS } from '../constants/storage';

const STORAGE_KEY = STORAGE_KEYS.ENCOUNTER_NOTES;

export const useEncounterNotes = () => {
    const {
        data: encounters = [],
        setData: setEncounters,
        loading,
    } = useStorage<EncounterNote[]>({
        key: STORAGE_KEY,
        defaultValue: [],
        useRealtime: true,
    });

    const addEncounter = useCallback(
        (encounter: Omit<EncounterNote, 'id' | 'createdAt'>) => {
            const newEncounter: EncounterNote = {
                ...encounter,
                id: crypto.randomUUID(),
                createdAt: Date.now(),
            };
            setEncounters([...encounters, newEncounter]);
        },
        [encounters, setEncounters]
    );

    const updateEncounter = useCallback(
        (encounter: EncounterNote) => {
            const updatedEncounters = encounters.map((e) =>
                e.id === encounter.id ? encounter : e
            );
            setEncounters(updatedEncounters);
        },
        [encounters, setEncounters]
    );

    const deleteEncounter = useCallback(
        (encounterId: string) => {
            const updatedEncounters = encounters.filter((e) => e.id !== encounterId);
            setEncounters(updatedEncounters);
        },
        [encounters, setEncounters]
    );

    return {
        encounters,
        loading,
        addEncounter,
        updateEncounter,
        deleteEncounter,
    };
};
