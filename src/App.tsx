import React, { useEffect, useState, Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/ui';
import { NotificationProvider } from './contexts/NotificationProvider';
import { NotificationContainer } from './components/notification/NotificationContainer';
import Hotjar from '@hotjar/browser';
import { AuthProvider } from './contexts/AuthProvider';
import { CHANGELOG, CURRENT_VERSION, AUTHOR } from './constants';
import { useChangelogState } from './hooks/useChangelogState';

// Lazy load components and pages
const ChangelogModal = lazy(() => import('./components/changelog/ChangelogModal'));
const JokeCorner = lazy(() => import('./components/home/JokeCorner'));
const ShipsPage = lazy(() => import('./pages/ShipsPage'));
const GearPage = lazy(() => import('./pages/GearPage'));
const SimulationPage = lazy(() => import('./pages/SimulationPage'));
const AutogearPage = lazy(() => import('./pages/AutogearPage'));
const EngineeringStatsPage = lazy(() => import('./pages/EngineeringStatsPage'));
const LoadoutsPage = lazy(() => import('./pages/LoadoutsPage'));
const EncounterNotesPage = lazy(() => import('./pages/EncounterNotesPage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const ShipDetailsPage = lazy(() => import('./pages/ShipDetailsPage'));
const ShipIndexPage = lazy(() => import('./pages/ShipIndexPage'));

// init hotjar
const siteId = 5241833;
const hotjarVersion = 6;
Hotjar.init(siteId, hotjarVersion);

const AppContent: React.FC = () => {
    const [showChangelog, setShowChangelog] = useState(false);
    const [lastSeenVersion, setLastSeenVersion] = useState(CURRENT_VERSION);
    const { changelogState, updateLastSeenVersion, loading } = useChangelogState();

    useEffect(() => {
        if (changelogState.lastSeenVersion !== CURRENT_VERSION && !loading) {
            setShowChangelog(true);
            setLastSeenVersion(changelogState.lastSeenVersion);
        }
    }, [changelogState.lastSeenVersion, loading]);

    const handleCloseChangelog = () => {
        setShowChangelog(false);
        updateLastSeenVersion(CURRENT_VERSION);
    };

    return (
        <Router>
            <main className="flex">
                <Sidebar />
                <div className="flex-1 lg:pl-64 max-w-full">
                    <div className="min-h-screen py-8 px-4 mt-14 lg:mt-0 flex flex-col">
                        <div className="max-w-7xl mx-auto w-full flex-grow">
                            <Suspense fallback={<div className="text-center">Loading...</div>}>
                                <Routes>
                                    <Route path="/ships" element={<ShipsPage />} />
                                    <Route path="/gear" element={<GearPage />} />
                                    <Route path="/simulation" element={<SimulationPage />} />
                                    <Route path="/autogear" element={<AutogearPage />} />
                                    <Route path="/engineering" element={<EngineeringStatsPage />} />
                                    <Route path="/loadouts" element={<LoadoutsPage />} />
                                    <Route path="/encounters" element={<EncounterNotesPage />} />
                                    <Route path="/" element={<HomePage />} />
                                    <Route path="/ships/:shipId" element={<ShipDetailsPage />} />
                                    <Route path="/ships/index" element={<ShipIndexPage />} />
                                </Routes>
                            </Suspense>
                        </div>

                        <JokeCorner />
                        <footer className="text-center text-xs mt-auto pt-5">
                            Made with ❤️ by {AUTHOR}
                        </footer>
                    </div>
                </div>
                <ChangelogModal
                    isOpen={showChangelog}
                    onClose={handleCloseChangelog}
                    entries={CHANGELOG}
                    lastSeenVersion={lastSeenVersion}
                />
                <NotificationContainer />
            </main>
        </Router>
    );
};

const App: React.FC = () => {
    return (
        <NotificationProvider>
            <AuthProvider>
                <AppContent />
            </AuthProvider>
        </NotificationProvider>
    );
};

export default App;
