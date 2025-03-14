export interface UserData {
    inventory?: any[];
    loadouts?: any[];
    ships?: any[];
    engineering?: any[];
    encounterNotes?: any[];
    teamLoadouts?: any[];
    engineeringStats?: Record<string, any>;
    changelogState?: Record<string, any>;
    [key: string]: any;
}
