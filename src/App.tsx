import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Sidebar } from './components/ui';
import { ShipsPage } from './pages/ShipsPage';
import { GearPage } from './pages/GearPage';
import { SimulationPage } from './pages/SimulationPage';
import { AutogearPage } from './pages/AutogearPage';
import { EngineeringStatsPage } from './pages/EngineeringStatsPage';
import { LoadoutsPage } from './pages/LoadoutsPage';
import { ChangelogModal } from './components/changelog/ChangelogModal';
import { CHANGELOG, CURRENT_VERSION, AUTHOR } from './constants';
import { ChangelogState } from './types/changelog';
import { NotificationProvider } from './contexts/NotificationProvider';
import { NotificationContainer } from './components/notification/NotificationContainer';
import { migrateTianshaoToTianchao } from './migrations/factionMigration';
import { migrateShipAffinity } from './migrations/affinityMigration';
import EncounterNotesPage from './pages/EncounterNotesPage';
import HomePage from './pages/HomePage';
import { JokeCorner } from './components/home/JokeCorner';
import { ShipDetailsPage } from './pages/ShipDetailsPage';
import Hotjar from '@hotjar/browser';
import { AuthProvider } from './contexts/AuthProvider';
import { STORAGE_KEYS } from './constants/storage';

// init hotjar
const siteId = 5241833;
const hotjarVersion = 6;
Hotjar.init(siteId, hotjarVersion);

// Run migrations when app starts
migrateTianshaoToTianchao();
migrateShipAffinity();

const App: React.FC = () => {
    const [showChangelog, setShowChangelog] = useState(false);
    const [lastSeenVersion, setLastSeenVersion] = useState(CURRENT_VERSION);

    useEffect(() => {
        const savedState = localStorage.getItem(STORAGE_KEYS.CHANGELOG_STATE);

        let currentState: ChangelogState;

        if (savedState && JSON.parse(savedState)?.lastSeenVersion.match(/^\d+\.\d+\.\d+$/)) {
            currentState = { lastSeenVersion: JSON.parse(savedState).lastSeenVersion };
        } else {
            currentState = { lastSeenVersion: '0.0.0' };
        }

        if (currentState.lastSeenVersion !== CURRENT_VERSION) {
            setShowChangelog(true);
            setLastSeenVersion(currentState.lastSeenVersion);
        }
    }, []);

    const handleCloseChangelog = () => {
        setShowChangelog(false);
        localStorage.setItem(
            STORAGE_KEYS.CHANGELOG_STATE,
            JSON.stringify({
                lastSeenVersion: CURRENT_VERSION,
            })
        );
    };

    return (
        <NotificationProvider>
            <AuthProvider>
                <Router>
                    <main className="flex">
                        <Sidebar />
                        <div className="flex-1 lg:pl-64 max-w-full bg-dark-lighter">
                            <div className="min-h-screen py-8 px-4 mt-14 lg:mt-0 flex flex-col overflow-x-hidden">
                                <div className="max-w-7xl mx-auto w-full flex-grow">
                                    <Routes>
                                        <Route path="/ships" element={<ShipsPage />} />
                                        <Route path="/gear" element={<GearPage />} />
                                        <Route path="/simulation" element={<SimulationPage />} />
                                        <Route path="/autogear" element={<AutogearPage />} />
                                        <Route
                                            path="/engineering"
                                            element={<EngineeringStatsPage />}
                                        />
                                        <Route path="/loadouts" element={<LoadoutsPage />} />
                                        <Route
                                            path="/encounters"
                                            element={<EncounterNotesPage />}
                                        />
                                        <Route path="/" element={<HomePage />} />
                                        <Route
                                            path="/ships/:shipId"
                                            element={<ShipDetailsPage />}
                                        />
                                    </Routes>
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
            </AuthProvider>
        </NotificationProvider>
    );
};

export default App;
