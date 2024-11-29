import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { ShipsPage } from './pages/ShipsPage';
import { GearPage } from './pages/GearPage';

const App: React.FC = () => {
    return (
        <Router>
            <div className="flex">
                <Sidebar />
                <div className="flex-1 ml-64">
                    <div className="min-h-screen bg-gray-100 py-8 px-4">
                        <div className="max-w-7xl mx-auto">
                            <Routes>
                                <Route path="/ships" element={<ShipsPage />} />
                                <Route path="/gear" element={<GearPage />} />
                                <Route path="/" element={<Navigate to="/ships" replace />} />
                            </Routes>
                        </div>
                    </div>
                </div>
            </div>
        </Router>
    );
};

export default App;

