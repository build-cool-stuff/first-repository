const CACHE_VERSION = 'v1';
const CACHE_NAME = `bookmark-manager-${CACHE_VERSION}`;

const APP_SHELL = ['/', '/favicon.png'];

self.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
	);
	self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches.keys().then((keys) =>
			Promise.all(
				keys
					.filter((key) => key.startsWith('bookmark-manager-') && key !== CACHE_NAME)
					.map((key) => caches.delete(key))
			)
		)
	);
	self.clients.claim();
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);

	// Network-first for API calls (Google Drive, etc.)
	if (
		url.origin !== self.location.origin ||
		url.pathname.startsWith('/api') ||
		url.hostname.includes('googleapis.com')
	) {
		event.respondWith(
			fetch(request)
				.then((response) => {
					return response;
				})
				.catch(() => caches.match(request))
		);
		return;
	}

	// Cache-first for static assets (JS, CSS, images, fonts)
	if (
		request.destination === 'script' ||
		request.destination === 'style' ||
		request.destination === 'image' ||
		request.destination === 'font' ||
		url.pathname.match(/\.(js|css|png|jpg|svg|woff2?)$/)
	) {
		event.respondWith(
			caches.match(request).then((cached) => {
				if (cached) return cached;
				return fetch(request).then((response) => {
					const clone = response.clone();
					caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
					return response;
				});
			})
		);
		return;
	}

	// Network-first for navigation / everything else (SPA pages)
	event.respondWith(
		fetch(request)
			.then((response) => {
				const clone = response.clone();
				caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
				return response;
			})
			.catch(() => caches.match(request).then((cached) => cached || caches.match('/')))
	);
});
