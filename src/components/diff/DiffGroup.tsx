import React, { useState } from 'react';
import { DiffGroup } from '../../types/diff';
import { ChevronDownIcon, ChevronRightIcon } from '../ui/icons';

interface DiffGroupProps {
    group: DiffGroup;
    groupIndex: number;
}

const getTypeColor = (type: string) => {
    switch (type) {
        case 'added':
            return 'text-green-400 border-green-500/30 bg-green-900/20';
        case 'removed':
            return 'text-red-400 border-red-500/30 bg-red-900/20';
        case 'modified':
            return 'text-yellow-400 border-yellow-500/30 bg-yellow-900/20';
        default:
            return 'text-gray-400 border-gray-500/30 bg-gray-900/20';
    }
};

const getTypeIcon = (type: string) => {
    switch (type) {
        case 'added':
            return '➕';
        case 'removed':
            return '➖';
        case 'modified':
            return '🔄';
        default:
            return '•';
    }
};

export const DiffGroupComponent: React.FC<DiffGroupProps> = ({ group, groupIndex }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [expandedChildren, setExpandedChildren] = useState<Set<number>>(new Set());

    const toggleChild = (childIndex: number) => {
        const newExpanded = new Set(expandedChildren);
        if (newExpanded.has(childIndex)) {
            newExpanded.delete(childIndex);
        } else {
            newExpanded.add(childIndex);
        }
        setExpandedChildren(newExpanded);
    };

    const typeColor = getTypeColor(group.type);
    const typeIcon = getTypeIcon(group.type);

    return (
        <div className={`border mb-4 ${typeColor}`}>
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full p-4 text-left flex items-center justify-between hover:bg-opacity-30 transition-colors"
            >
                <div className="flex items-center space-x-2">
                    <span className="text-lg">{typeIcon}</span>
                    <span className="font-semibold">{group.name}</span>
                    <span className="text-sm opacity-75">
                        ({group.changes.length + (group.children?.length || 0)} changes)
                    </span>
                </div>
                {isExpanded ? (
                    <ChevronDownIcon className="h-5 w-5" />
                ) : (
                    <ChevronRightIcon className="h-5 w-5" />
                )}
            </button>

            {isExpanded && (
                <div className="px-4 pb-4">
                    {/* Direct changes in this group */}
                    {group.changes.length > 0 && (
                        <div className="space-y-2 mb-4">
                            {group.changes.map((change, index) => (
                                <div
                                    key={`${groupIndex}-${index}`}
                                    className="bg-dark/50 p-3 border border-dark-border"
                                >
                                    <div className="text-sm">{change.description}</div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Child groups for modified items */}
                    {group.children && group.children.length > 0 && (
                        <div className="space-y-2">
                            {group.children.map((child, childIndex) => (
                                <div
                                    key={`${groupIndex}-child-${childIndex}`}
                                    className="border border-dark-border bg-dark/30"
                                >
                                    <button
                                        onClick={() => toggleChild(childIndex)}
                                        className="w-full p-3 text-left flex items-center justify-between hover:bg-dark/50 transition-colors"
                                    >
                                        <div className="flex items-center space-x-2">
                                            <span className="text-yellow-400">🔄</span>
                                            <span className="font-medium">{child.name}</span>
                                            <span className="text-sm opacity-75">
                                                ({child.changes.length} changes)
                                            </span>
                                        </div>
                                        {expandedChildren.has(childIndex) ? (
                                            <ChevronDownIcon className="h-4 w-4" />
                                        ) : (
                                            <ChevronRightIcon className="h-4 w-4" />
                                        )}
                                    </button>

                                    {expandedChildren.has(childIndex) && (
                                        <div className="px-3 pb-3">
                                            <div className="space-y-2">
                                                {child.changes.map((change, changeIndex) => (
                                                    <div
                                                        key={`${groupIndex}-child-${childIndex}-change-${changeIndex}`}
                                                        className="bg-dark/50 p-2 border border-dark-border"
                                                    >
                                                        <div className="text-sm">
                                                            {change.description}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
