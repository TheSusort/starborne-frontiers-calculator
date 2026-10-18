export const FLIGHT_START_EVENT = 'app:flight:start';
export const FLIGHT_END_EVENT = 'app:flight:end';

/** Viewport coordinates and size of the background fighter the player clicked. */
export interface FlightOrigin {
    x: number;
    y: number;
    size: number;
}

export interface FlightStartDetail {
    origin?: FlightOrigin;
}

export function requestFlight(origin?: FlightOrigin): void {
    window.dispatchEvent(
        new CustomEvent<FlightStartDetail>(FLIGHT_START_EVENT, { detail: { origin } })
    );
}

export function announceFlightEnd(): void {
    window.dispatchEvent(new Event(FLIGHT_END_EVENT));
}
