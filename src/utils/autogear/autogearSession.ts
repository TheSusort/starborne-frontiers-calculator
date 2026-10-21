import { GearSuggestion } from '../../types/autogear';
import { SimulationSummary } from '../simulation/simulationCalculator';
import { StatBreakdown } from '../ship/statsCalculator';
import { IMPORT_START_EVENT } from '../../components/import/importEvents';
import { PROFILE_SWITCH_EVENT } from '../../contexts/ActiveProfileProvider';
import { HardRequirementViolation } from './AutogearStrategy';

export interface AutogearShipResult {
    suggestions: GearSuggestion[];
    currentSimulation: SimulationSummary | null;
    suggestedSimulation: SimulationSummary | null;
    arenaSimulation: SimulationSummary | null;
    currentStats: StatBreakdown;
    suggestedStats: StatBreakdown;
    arenaModifiers: Record<string, number> | null;
    hardRequirementsMet: boolean;
    hardViolations?: HardRequirementViolation[];
    attempts: number;
}

/** The last autogear selection and its results, kept for the life of the browser tab. */
export interface AutogearSession {
    shipIds: string[];
    results: Record<string, AutogearShipResult>;
    activeTab: string | null;
}

const SESSION_KEY = 'autogear_session';
const VERSION = 1;

interface StoredSession extends AutogearSession {
    v: number;
    profileId: string;
}

const profileKey = (profileId: string | null) => profileId ?? 'local';

const storage = (): Storage | null => {
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
};

export const saveAutogearSession = (profileId: string | null, session: AutogearSession) => {
    const stored: StoredSession = { v: VERSION, profileId: profileKey(profileId), ...session };
    try {
        storage()?.setItem(SESSION_KEY, JSON.stringify(stored));
    } catch {
        // Quota or serialisation failure: the session is a convenience, so drop it.
        clearAutogearSession();
    }
};

/** Returns the stored session only when it belongs to this profile and has the current shape. */
export const loadAutogearSession = (profileId: string | null): AutogearSession | null => {
    try {
        const raw = storage()?.getItem(SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Partial<StoredSession>;
        if (
            parsed?.v !== VERSION ||
            parsed.profileId !== profileKey(profileId) ||
            !Array.isArray(parsed.shipIds) ||
            !parsed.shipIds.every((id) => typeof id === 'string') ||
            typeof parsed.results !== 'object' ||
            parsed.results === null
        ) {
            return null;
        }
        return {
            shipIds: parsed.shipIds,
            results: parsed.results,
            activeTab: typeof parsed.activeTab === 'string' ? parsed.activeTab : null,
        };
    } catch {
        return null;
    }
};

export const clearAutogearSession = () => {
    try {
        storage()?.removeItem(SESSION_KEY);
    } catch {
        // Storage unavailable: nothing is kept, so nothing to clear.
    }
};

/**
 * A new import replaces the fleet, and results belong to the profile that ran them, so all
 * three events drop the session. Installed once at app start so it fires on any page.
 */
export const SESSION_RESET_EVENTS = [IMPORT_START_EVENT, PROFILE_SWITCH_EVENT, 'app:signout'];

export const installAutogearSessionResets = () => {
    SESSION_RESET_EVENTS.forEach((event) => window.addEventListener(event, clearAutogearSession));
};
