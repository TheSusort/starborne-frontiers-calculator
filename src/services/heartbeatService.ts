import { supabase } from '../config/supabase';

const HEARTBEAT_INTERVAL = 30_000; // 30 seconds
const SESSION_ID_KEY = 'heartbeat_session_id';

function getSessionId(): string {
    let id = localStorage.getItem(SESSION_ID_KEY);
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(SESSION_ID_KEY, id);
    }
    return id;
}

let intervalId: number | null = null;
let currentUserId: string | null = null;

async function sendHeartbeat(): Promise<void> {
    try {
        await supabase.from('heartbeats').insert({
            session_id: getSessionId(),
            user_id: currentUserId,
        });
    } catch (error) {
        // Silently fail - heartbeats are non-critical
        // eslint-disable-next-line no-console
        console.debug('Heartbeat failed:', error);
    }
}

export function startHeartbeat(userId: string | null): void {
    if (intervalId !== null) {
        // Already running, just update the user ID
        currentUserId = userId;
        return;
    }

    currentUserId = userId;

    // Send immediately on start
    sendHeartbeat();

    // Then send every 30 seconds
    intervalId = window.setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
}

export function stopHeartbeat(): void {
    if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
    }
    currentUserId = null;
}

export function updateHeartbeatUser(userId: string | null): void {
    currentUserId = userId;
}
