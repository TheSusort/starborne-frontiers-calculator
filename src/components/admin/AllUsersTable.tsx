import React, { useState, useEffect, useCallback } from 'react';
import { TopUser, UserSortField, SortDirection, getAllUsers } from '../../services/adminService';
import { Input } from '../ui';
import { Loader } from '../ui/Loader';

export const AllUsersTable: React.FC = () => {
    const [users, setUsers] = useState<TopUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [sortBy, setSortBy] = useState<UserSortField>('total_activity');
    const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
    const [totalCount, setTotalCount] = useState(0);
    const [currentPage, setCurrentPage] = useState(1);
    const pageSize = 10;

    const loadUsers = useCallback(async () => {
        setLoading(true);
        const result = await getAllUsers({
            search,
            sortBy,
            sortDirection,
            limit: pageSize,
            offset: (currentPage - 1) * pageSize,
        });
        setUsers(result.users);
        setTotalCount(result.totalCount);
        setLoading(false);
    }, [search, sortBy, sortDirection, currentPage]);

    useEffect(() => {
        loadUsers();
    }, [loadUsers]);

    const handleSort = (field: UserSortField) => {
        if (sortBy === field) {
            // Toggle direction
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(field);
            setSortDirection('desc');
        }
    };

    const getSortIcon = (field: UserSortField) => {
        if (sortBy !== field) {
            return <span className="text-gray-600">⇅</span>;
        }
        return sortDirection === 'asc' ? (
            <span className="text-primary">↑</span>
        ) : (
            <span className="text-primary">↓</span>
        );
    };

    const totalPages = Math.ceil(totalCount / pageSize);

    return (
        <div className="bg-dark-lighter p-6 border border-gray-700">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold">All Users</h3>
                <div className="flex items-center gap-2">
                    <Input
                        type="text"
                        placeholder="Search by email..."
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            setCurrentPage(1); // Reset to first page on search
                        }}
                        className="max-w-xs"
                    />
                </div>
            </div>

            <>
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="border-b border-gray-700">
                                <th className="pb-3 ps-3 font-semibold text-gray-300">#</th>
                                <th
                                    className="pb-3 font-semibold text-gray-300 cursor-pointer hover:text-primary transition-colors"
                                    onClick={() => handleSort('email')}
                                >
                                    <div className="flex items-center gap-2">
                                        Email {getSortIcon('email')}
                                    </div>
                                </th>
                                <th
                                    className="pb-3 font-semibold text-gray-300 text-right cursor-pointer hover:text-primary transition-colors"
                                    onClick={() => handleSort('total_autogear_runs')}
                                >
                                    <div className="flex items-center justify-end gap-2">
                                        Autogear Runs {getSortIcon('total_autogear_runs')}
                                    </div>
                                </th>
                                <th
                                    className="pb-3 font-semibold text-gray-300 text-right cursor-pointer hover:text-primary transition-colors"
                                    onClick={() => handleSort('total_data_imports')}
                                >
                                    <div className="flex items-center justify-end gap-2">
                                        Data Imports {getSortIcon('total_data_imports')}
                                    </div>
                                </th>
                                <th
                                    className="pb-3 font-semibold text-gray-300 text-right cursor-pointer hover:text-primary transition-colors"
                                    onClick={() => handleSort('total_activity')}
                                >
                                    <div className="flex items-center justify-end gap-2">
                                        Total Activity {getSortIcon('total_activity')}
                                    </div>
                                </th>
                                <th
                                    className="pb-3 pe-3 font-semibold text-gray-300 text-right cursor-pointer hover:text-primary transition-colors"
                                    onClick={() => handleSort('last_active')}
                                >
                                    <div className="flex items-center justify-end gap-2">
                                        Last Active {getSortIcon('last_active')}
                                    </div>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={6} className="py-3 text-center text-gray-400">
                                        <Loader size="sm" />
                                    </td>
                                </tr>
                            ) : (
                                users.map((user, index) => (
                                    <tr
                                        key={user.user_id}
                                        className="border-b border-gray-800 hover:bg-dark transition-colors"
                                    >
                                        <td className="py-3 ps-3 text-gray-400">
                                            {(currentPage - 1) * pageSize + index + 1}
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
                                        <td className="py-3 pe-3 text-right text-gray-400">
                                            {user.last_active
                                                ? new Date(user.last_active).toLocaleDateString()
                                                : 'N/A'}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex justify-between items-center mt-4 px-3">
                        <div className="text-sm text-gray-400">
                            Showing {(currentPage - 1) * pageSize + 1} to{' '}
                            {Math.min(currentPage * pageSize, totalCount)} of {totalCount}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                                className="px-3 py-1 bg-dark border border-gray-700 rounded hover:bg-dark-lighter disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                Previous
                            </button>
                            <div className="flex items-center px-3 py-1 text-gray-400">
                                Page {currentPage} of {totalPages}
                            </div>
                            <button
                                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                disabled={currentPage === totalPages}
                                className="px-3 py-1 bg-dark border border-gray-700 rounded hover:bg-dark-lighter disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                )}
            </>
        </div>
    );
};
