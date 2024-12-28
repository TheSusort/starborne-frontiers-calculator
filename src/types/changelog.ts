export interface ChangelogEntry {
    version: string;
    date: string;
    changes: string[];
}

export interface ChangelogState {
    lastSeenVersion: string;
}
