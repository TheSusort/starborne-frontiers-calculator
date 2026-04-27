// Runs in the service worker context (imported via workbox importScripts).
// Handles two scenarios:
//   1. fetch handler: redirects future navigation requests from the netlify.app origin
//   2. activate handler: navigates any already-open netlify.app tabs to the custom domain
//      the moment this new SW activates (bypasses the autoUpdate race condition)

self.addEventListener('fetch', function (event) {
    if (event.request.mode !== 'navigate') return;
    var url = new URL(event.request.url);
    if (url.hostname !== 'starborne-planner.netlify.app') return;
    event.respondWith(
        Promise.resolve(
            Response.redirect(
                'https://starborneplanner.com' + url.pathname + url.search + url.hash,
                302
            )
        )
    );
});

self.addEventListener('activate', function (event) {
    event.waitUntil(
        self.clients
            .claim()
            .then(function () {
                return self.clients.matchAll({ type: 'window' });
            })
            .then(function (clients) {
                return Promise.all(
                    clients
                        .filter(function (client) {
                            return (
                                new URL(client.url).hostname ===
                                'starborne-planner.netlify.app'
                            );
                        })
                        .map(function (client) {
                            var dest = new URL(client.url);
                            return client.navigate(
                                'https://starborneplanner.com' +
                                    dest.pathname +
                                    dest.search +
                                    dest.hash
                            );
                        })
                );
            })
    );
});
