import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { TopUser, UserSortField, SortDirection, getAllUsers } from '../../services/adminService';
import { Input, DataTable, Column } from '../ui';

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

    const handleSort = (field: string) => {
        const sortField = field as UserSortField;
        if (sortBy === sortField) {
            // Toggle direction
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(sortField);
            setSortDirection('desc');
        }
    };

    const columns: Column<TopUser>[] = useMemo(
        () => [
            {
                key: 'index',
                label: '#',
                align: 'left',
                render: (_, index) => (
                    <span className="text-gray-400">
                        {(currentPage - 1) * pageSize + index + 1}
                    </span>
                ),
            },
            {
                key: 'email',
                label: 'Email',
                sortable: true,
                align: 'left',
                render: (user) => <span className="text-gray-200">{user.email}</span>,
            },
            {
                key: 'total_autogear_runs',
                label: 'Autogear Runs',
                sortable: true,
                align: 'right',
                render: (user) => (
                    <span className="text-blue-400">
                        {user.total_autogear_runs.toLocaleString()}
                    </span>
                ),
            },
            {
                key: 'total_data_imports',
                label: 'Data Imports',
                sortable: true,
                align: 'right',
                render: (user) => (
                    <span className="text-green-400">
                        {user.total_data_imports.toLocaleString()}
                    </span>
                ),
            },
            {
                key: 'total_activity',
                label: 'Total Activity',
                sortable: true,
                align: 'right',
                render: (user) => (
                    <span className="text-yellow-400 font-semibold">
                        {user.total_activity.toLocaleString()}
                    </span>
                ),
            },
            {
                key: 'last_active',
                label: 'Last Active',
                sortable: true,
                align: 'right',
                render: (user) => (
                    <span className="text-gray-400">
                        {user.last_active ? new Date(user.last_active).toLocaleDateString() : 'N/A'}
                    </span>
                ),
            },
        ],
        [currentPage, pageSize]
    );

    const totalPages = Math.ceil(totalCount / pageSize);

    return (
        <div>
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

            <DataTable
                data={users}
                columns={columns}
                loading={loading}
                emptyMessage="No users found"
                getRowKey={(user) => user.user_id}
                onSort={handleSort}
                sortBy={sortBy}
                sortDirection={sortDirection}
                pagination={{
                    currentPage,
                    totalPages,
                    totalItems: totalCount,
                    pageSize,
                    onPageChange: setCurrentPage,
                }}
            />
        </div>
    );
};
