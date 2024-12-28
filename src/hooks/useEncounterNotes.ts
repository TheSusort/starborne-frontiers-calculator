import { useState, useEffect } from 'react';
import { EncounterNote } from '../types/encounters';

const STORAGE_KEY = 'encounterNotes';

export const useEncounterNotes = () => {
    const [encounters, setEncounters] = useState<EncounterNote[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        loadEncounters();
    }, []);

    const loadEncounters = () => {
        const savedEncounters = localStorage.getItem(STORAGE_KEY);
        if (savedEncounters) {
            setEncounters(JSON.parse(savedEncounters));
        }
        setIsLoading(false);
    };

    const saveEncounters = (updatedEncounters: EncounterNote[]) => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedEncounters));
        setEncounters(updatedEncounters);
    };

    const addEncounter = (encounter: Omit<EncounterNote, 'id' | 'createdAt'>) => {
        const newEncounter: EncounterNote = {
            ...encounter,
            id: Date.now().toString(),
            createdAt: Date.now(),
        };
        saveEncounters([...encounters, newEncounter]);
    };

    const updateEncounter = (encounter: EncounterNote) => {
        const updatedEncounters = encounters.map((e) => (e.id === encounter.id ? encounter : e));
        saveEncounters(updatedEncounters);
    };

    const deleteEncounter = (encounterId: string) => {
        const updatedEncounters = encounters.filter((e) => e.id !== encounterId);
        saveEncounters(updatedEncounters);
    };

    return {
        encounters,
        isLoading,
        addEncounter,
        updateEncounter,
        deleteEncounter,
    };
};
