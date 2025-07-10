export interface DiffResult {
    type: 'added' | 'removed' | 'modified' | 'unchanged';
    path: string;
    oldValue?: unknown;
    newValue?: unknown;
    description: string;
    groupKey?: string; // For grouping related changes
    groupName?: string; // Display name for the group
}

export interface DiffSummary {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
}

export interface DiffGroup {
    name: string;
    changes: DiffResult[];
    type: 'added' | 'removed' | 'modified' | 'mixed';
    isParent?: boolean;
    children?: Array<{
        name: string;
        changes: DiffResult[];
        type: 'modified';
    }>;
}
