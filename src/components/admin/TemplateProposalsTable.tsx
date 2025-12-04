import React, { useState } from 'react';
import { TemplateProposalRecord } from '../../services/shipTemplateProposalService';
import { Button } from '../ui/Button';

interface TemplateProposalsTableProps {
    proposals: TemplateProposalRecord[];
    onApprove: (proposalId: string) => Promise<void>;
    onReject: (proposalId: string) => Promise<void>;
}

export const TemplateProposalsTable: React.FC<TemplateProposalsTableProps> = ({
    proposals,
    onApprove,
    onReject,
}) => {
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [processing, setProcessing] = useState<string | null>(null);

    const handleApprove = async (proposalId: string) => {
        setProcessing(proposalId);
        try {
            await onApprove(proposalId);
        } finally {
            setProcessing(null);
        }
    };

    const handleReject = async (proposalId: string) => {
        setProcessing(proposalId);
        try {
            await onReject(proposalId);
        } finally {
            setProcessing(null);
        }
    };

    if (proposals.length === 0) {
        return (
            <div className="card text-center">
                <p className="text-gray-400">No pending template proposals</p>
            </div>
        );
    }

    return (
        <div className="card">
            <h3 className="text-xl font-semibold mb-4">Template Update Proposals</h3>
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="border-b border-dark-border">
                            <th className="text-left p-3 text-gray-400">Ship</th>
                            <th className="text-left p-3 text-gray-400">Reports</th>
                            <th className="text-left p-3 text-gray-400">Changes</th>
                            <th className="text-left p-3 text-gray-400">First Reported</th>
                            <th className="text-right p-3 text-gray-400">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {proposals.map((proposal) => (
                            <React.Fragment key={proposal.id}>
                                <tr className="border-b border-gray-800 hover:bg-dark transition-colors">
                                    <td className="p-3">
                                        <div className="font-semibold">{proposal.ship_name}</div>
                                    </td>
                                    <td className="p-3">
                                        <span className="px-2 py-1 bg-primary/20 text-primary text-sm">
                                            {proposal.proposal_count} user
                                            {proposal.proposal_count > 1 ? 's' : ''}
                                        </span>
                                    </td>
                                    <td className="p-3">
                                        <span className="text-sm text-gray-400">
                                            {proposal.stat_differences.length} stat
                                            {proposal.stat_differences.length !== 1 ? 's' : ''}
                                        </span>
                                    </td>
                                    <td className="p-3 text-sm text-gray-400">
                                        {new Date(proposal.created_at).toLocaleDateString()}
                                    </td>
                                    <td className="p-3 text-right space-x-2">
                                        <Button
                                            variant="secondary"
                                            size="sm"
                                            onClick={() =>
                                                setExpandedId(
                                                    expandedId === proposal.id ? null : proposal.id
                                                )
                                            }
                                        >
                                            {expandedId === proposal.id ? 'Hide' : 'View'}
                                        </Button>
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            onClick={() => handleApprove(proposal.id)}
                                            disabled={processing === proposal.id}
                                        >
                                            {processing === proposal.id
                                                ? 'Processing...'
                                                : 'Approve'}
                                        </Button>
                                        <Button
                                            variant="danger"
                                            size="sm"
                                            onClick={() => handleReject(proposal.id)}
                                            disabled={processing === proposal.id}
                                        >
                                            Reject
                                        </Button>
                                    </td>
                                </tr>
                                {expandedId === proposal.id && (
                                    <tr>
                                        <td colSpan={5} className="p-4 bg-dark">
                                            <div className="space-y-4">
                                                <div>
                                                    <h4 className="font-semibold mb-2">
                                                        Stat Differences:
                                                    </h4>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                                        {proposal.stat_differences.map((diff) => (
                                                            <div
                                                                key={diff.stat}
                                                                className="bg-dark-lighter p-3 border border-dark-border"
                                                            >
                                                                <div className="text-sm text-gray-400 mb-1">
                                                                    {diff.stat}
                                                                </div>
                                                                <div className="flex items-center justify-between">
                                                                    <span className="text-red-400">
                                                                        {diff.currentValue ?? 'N/A'}
                                                                    </span>
                                                                    <span className="text-gray-500 mx-2">
                                                                        →
                                                                    </span>
                                                                    <span className="text-green-400">
                                                                        {diff.proposedValue}
                                                                    </span>
                                                                </div>
                                                                <div className="text-xs text-gray-500 mt-1">
                                                                    {diff.difference > 0 ? '+' : ''}
                                                                    {diff.difference}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                    {proposal.current_stats && (
                                                        <div>
                                                            <h4 className="font-semibold mb-2 text-red-400">
                                                                Current Stats:
                                                            </h4>
                                                            <div className="bg-dark-lighter p-3 border border-dark-border text-sm">
                                                                <pre className="text-gray-300 whitespace-pre-wrap">
                                                                    {JSON.stringify(
                                                                        proposal.current_stats,
                                                                        null,
                                                                        2
                                                                    )}
                                                                </pre>
                                                            </div>
                                                        </div>
                                                    )}
                                                    <div>
                                                        <h4 className="font-semibold mb-2 text-green-400">
                                                            Proposed Stats:
                                                        </h4>
                                                        <div className="bg-dark-lighter p-3 border border-dark-border text-sm">
                                                            <pre className="text-gray-300 whitespace-pre-wrap">
                                                                {JSON.stringify(
                                                                    proposal.proposed_stats,
                                                                    null,
                                                                    2
                                                                )}
                                                            </pre>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </React.Fragment>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
