import React from 'react';
import { TopUser } from '../../services/adminService';

interface TopUsersTableProps {
    users: TopUser[];
}

export const TopUsersTable: React.FC<TopUsersTableProps> = ({ users }) => {
    return (
        <div className="card">
            <h3 className="text-xl font-semibold mb-4">Top Active Users</h3>
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-dark-border">
                            <th className="pb-3 font-semibold text-gray-300">Rank</th>
                            <th className="pb-3 font-semibold text-gray-300">Email</th>
                            <th className="pb-3 font-semibold text-gray-300 text-right">
                                Autogear Runs
                            </th>
                            <th className="pb-3 font-semibold text-gray-300 text-right">
                                Data Imports
                            </th>
                            <th className="pb-3 font-semibold text-gray-300 text-right">
                                Total Activity
                            </th>
                            <th className="pb-3 font-semibold text-gray-300 text-right">
                                Last Active
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {users.map((user, index) => (
                            <tr
                                key={user.user_id}
                                className="border-b border-gray-800 hover:bg-dark transition-colors"
                            >
                                <td className="py-3">
                                    <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-primary/20 text-primary font-semibold">
                                        {index + 1}
                                    </span>
                                </td>
                                <td className="py-3 text-gray-200">{user.email}</td>
                                <td className="py-3 text-right text-blue-400">
                                    {user.total_autogear_runs.toLocaleString()}
                                </td>
                                <td className="py-3 text-right text-green-400">
                                    {user.total_data_imports.toLocaleString()}
                                </td>
                                <td className="py-3 text-right text-yellow-400 font-semibold">
                                    {user.total_activity.toLocaleString()}
                                </td>
                                <td className="py-3 text-right text-gray-400">
                                    {user.last_active
                                        ? new Date(user.last_active).toLocaleDateString()
                                        : 'N/A'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
