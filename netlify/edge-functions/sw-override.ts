// Intercepts /sw.js requests from the legacy starborne-planner.netlify.app origin
// and serves a minimal redirect-only service worker instead.
//
// Why this exists:
//   Netlify's infrastructure redirects ALL netlify.app traffic to the primary
//   domain (starborneplanner.com), including sw.js. Browsers hard-reject
//   cross-origin SW scripts, so the stale v1.42.0 SW can never update via the
//   normal mechanism. Edge functions run *before* redirect rules, so this is
//   the only layer that can intercept sw.js before Netlify's redirect fires.
//
// Why a minimal SW (not the real workbox one):
//   The real sw.js's precache fetches ~100 assets from netlify.app. Every one
//   of those would be 301-redirected cross-origin, making them opaque (status 0).
//   Workbox rejects opaque responses, so the install event would fail and the
//   new SW would never activate. A no-precache SW installs instantly.

const MINIMAL_SW = `
self.skipWaiting();

self.addEventListener('activate', function (event) {
  event.waitUntil(
    self.clients.claim().then(function () {
      return self.clients.matchAll({ type: 'window' });
    }).then(function (clients) {
      return Promise.all(
        clients
          .filter(function (c) {
            return new URL(c.url).hostname === 'starborne-planner.netlify.app';
          })
          .map(function (c) {
            var u = new URL(c.url);
            return c.navigate(
              'https://starborneplanner.com' + u.pathname + u.search + u.hash
            );
          })
      );
    })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.mode !== 'navigate') return;
  var url = new URL(event.request.url);
  event.respondWith(
    Promise.resolve(
      Response.redirect(
        'https://starborneplanner.com' + url.pathname + url.search + url.hash,
        302
      )
    )
  );
});
`.trim();

export default async function handler(request: Request): Promise<Response | void> {
    const url = new URL(request.url);

    // Only intercept sw.js from the legacy netlify.app subdomain.
    // For starborneplanner.com the real workbox SW must be served as-is.
    if (!url.hostname.endsWith('.netlify.app')) {
        return;
    }

    return new Response(MINIMAL_SW, {
        headers: {
            'content-type': 'application/javascript; charset=utf-8',
            'cache-control': 'no-cache, no-store, must-revalidate',
        },
    });
}

export const config = {
    path: '/sw.js',
};
