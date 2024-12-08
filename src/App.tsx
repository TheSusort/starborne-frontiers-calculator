import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/layout/Sidebar';
import { ShipsPage } from './pages/ShipsPage';
import { GearPage } from './pages/GearPage';
import { SimulationPage } from './pages/SimulationPage';
import { AutogearPage } from './pages/AutogearPage';
import { EngineeringStatsPage } from './pages/EngineeringStatsPage';
import { AUTHOR } from './constants/config';

const App: React.FC = () => {
    return (
        <Router>
            <div className="flex">
                <Sidebar />
                <div className="flex-1 lg:ml-64 bg-dark-lighter">
                    <div className="min-h-screen py-8 px-4 mt-14 lg:mt-0 flex flex-col">
                        <div className="max-w-7xl mx-auto w-full flex-grow">
                            <Routes>
                                <Route path="/ships" element={<ShipsPage />} />
                                <Route path="/gear" element={<GearPage />} />
                                <Route path="/simulation" element={<SimulationPage />} />
                                <Route path="/autogear" element={<AutogearPage />} />
                                <Route path="/engineering" element={<EngineeringStatsPage />} />
                                <Route path="/" element={<Navigate to="/ships" replace />} />
                            </Routes>
                        </div>

                        <footer className="text-center text-xs text-gray-400 mt-auto">
                            Made with ❤️ by {AUTHOR}
                        </footer>
                    </div>
                </div>
            </div>
        </Router>
    );
};

export default App;

