/**
 * Yields one macrotask so the browser can paint and handle input between chunks of
 * main-thread work. A `MessageChannel` message is used instead of `setTimeout(0)` because
 * browsers clamp nested timers to at least 4ms and throttle timers in a background tab to
 * roughly once a second, which would stall a long run whenever the player switches tabs.
 * Falls back to `setTimeout(0)` where `MessageChannel` is unavailable.
 */
export function yieldToEventLoop(): Promise<void> {
    if (typeof MessageChannel === 'undefined') {
        return new Promise((resolve) => setTimeout(resolve, 0));
    }
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
            // An open port keeps a Node event loop alive, so close it once used.
            channel.port1.close();
            resolve();
        };
        channel.port2.postMessage(null);
    });
}
