import React, { useEffect, useState, Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { Sidebar } from './components/ui';
import { NotificationProvider } from './contexts/NotificationProvider';
import { NotificationContainer } from './components/notification/NotificationContainer';
import Hotjar from '@hotjar/browser';
import { AuthProvider } from './contexts/AuthProvider';
import { STORAGE_KEYS } from './constants/storage';
import { CHANGELOG, CURRENT_VERSION, AUTHOR } from './constants';
import { ChangelogState } from './types/changelog';
import Seo from './components/seo/Seo';
import SharedEncountersPage from './pages/SharedEncountersPage';
// Lazy load components and pages
const ChangelogModal = lazy(() => import('./components/changelog/ChangelogModal'));
const JokeCorner = lazy(() => import('./components/home/JokeCorner'));
const ShipsPage = lazy(() => import('./pages/manager/ShipsPage'));
const GearPage = lazy(() => import('./pages/manager/GearPage'));
const SimulationPage = lazy(() => import('./pages/manager/SimulationPage'));
const AutogearPage = lazy(() => import('./pages/manager/AutogearPage'));
const EngineeringStatsPage = lazy(() => import('./pages/manager/EngineeringStatsPage'));
const LoadoutsPage = lazy(() => import('./pages/manager/LoadoutsPage'));
const EncounterNotesPage = lazy(() => import('./pages/manager/EncounterNotesPage'));
const HomePage = lazy(() => import('./pages/HomePage'));
const ShipDetailsPage = lazy(() => import('./pages/manager/ShipDetailsPage'));
const ShipIndexPage = lazy(() => import('./pages/ShipIndexPage'));
const ImplantIndexPage = lazy(() => import('./pages/ImplantIndexPage'));

// Calculator pages
const DefenseCalculatorPage = lazy(() => import('./pages/calculators/DefenseCalculatorPage'));
const DPSCalculatorPage = lazy(() => import('./pages/calculators/DPSCalculatorPage'));
const HealingCalculatorPage = lazy(() => import('./pages/calculators/HealingCalculatorPage'));
const DamageDeconstructionPage = lazy(() => import('./pages/calculators/DamageDeconstructionPage'));

// init hotjar
const siteId = 5241833;
const hotjarVersion = 6;
Hotjar.init(siteId, hotjarVersion);

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
        <HelmetProvider>
            <NotificationProvider>
                <AuthProvider>
                    <Router>
                        <Seo
                            title=""
                            description="Starborne Planner - Your comprehensive tool for ship management, gear optimization, and battle simulations."
                            keywords="starborne, frontiers, calculator, ships, gear, simulation"
                        />
                        <main className="flex">
                            <Sidebar />
                            <div className="flex-1 lg:pl-64 max-w-full">
                                <div className="min-h-screen py-8 px-4 mt-14 lg:mt-0 flex flex-col">
                                    <div className="max-w-7xl mx-auto w-full flex-grow">
                                        <Suspense
                                            fallback={<div className="text-center">Loading...</div>}
                                        >
                                            <Routes>
                                                <Route path="/ships" element={<ShipsPage />} />
                                                <Route path="/gear" element={<GearPage />} />
                                                <Route
                                                    path="/simulation"
                                                    element={<SimulationPage />}
                                                />
                                                <Route
                                                    path="/autogear"
                                                    element={<AutogearPage />}
                                                />
                                                <Route
                                                    path="/engineering"
                                                    element={<EngineeringStatsPage />}
                                                />
                                                <Route
                                                    path="/loadouts"
                                                    element={<LoadoutsPage />}
                                                />
                                                <Route
                                                    path="/encounters"
                                                    element={<EncounterNotesPage />}
                                                />
                                                <Route path="/" element={<HomePage />} />
                                                <Route
                                                    path="/ships/:shipId"
                                                    element={<ShipDetailsPage />}
                                                />
                                                <Route
                                                    path="/ships/index"
                                                    element={<ShipIndexPage />}
                                                />
                                                <Route
                                                    path="/defense"
                                                    element={<DefenseCalculatorPage />}
                                                />
                                                <Route
                                                    path="/damage"
                                                    element={<DPSCalculatorPage />}
                                                />
                                                <Route
                                                    path="/healing"
                                                    element={<HealingCalculatorPage />}
                                                />
                                                <Route
                                                    path="/damage-deconstruction"
                                                    element={<DamageDeconstructionPage />}
                                                />
                                                <Route
                                                    path="/shared-encounters"
                                                    element={<SharedEncountersPage />}
                                                />
                                                <Route
                                                    path="/implants"
                                                    element={<ImplantIndexPage />}
                                                />
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
                </AuthProvider>
            </NotificationProvider>
        </HelmetProvider>
    );
};

export default App;
