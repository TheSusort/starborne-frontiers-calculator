import React from 'react';
import { Link, useLocation } from 'react-router-dom';

export const Sidebar: React.FC = () => {
    const location = useLocation();

    const isActive = (path: string) => location.pathname === path;

    return (
        <div className="w-64 bg-gray-800 min-h-screen fixed left-0 top-0">
            <div className="p-4">
                <h1 className="text-white text-xl font-bold mb-8">
                    Starborne Frontiers
                </h1>
                <nav className="space-y-2">
                    <Link
                        to="/ships"
                        className={`block px-4 py-2 rounded-lg transition-colors ${
                            isActive('/ships')
                                ? 'bg-blue-600 text-white'
                                : 'text-gray-300 hover:bg-gray-700'
                        }`}
                    >
                        Ships
                    </Link>
                    <Link
                        to="/gear"
                        className={`block px-4 py-2 rounded-lg transition-colors ${
                            isActive('/gear')
                                ? 'bg-blue-600 text-white'
                                : 'text-gray-300 hover:bg-gray-700'
                        }`}
                    >
                        Gear
                    </Link>
                </nav>
            </div>
        </div>
    );
}; 