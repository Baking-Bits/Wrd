// Service worker for PWA and push notifications
const CACHE_NAME = 'ai-chat-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/css/styles.css',
    '/css/auth.css',
    '/js/app.js',
    '/js/personalityManager.js',
    '/js/apiService.js',
    '/js/authManager.js',
    '/js/notificationManager.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
    console.log('Service Worker installing...');
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
            .then(() => self.skipWaiting())
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log('Service Worker activating...');
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName !== CACHE_NAME) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch event - serve from cache, fallback to network
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then((response) => {
                return response || fetch(event.request);
            })
    );
});

// Push notification event
self.addEventListener('push', (event) => {
    console.log('Push notification received:', event);
    
    let notificationData = {
        title: 'AI Chat',
        body: 'You have a new message',
        icon: '/assets/icon-192.svg',
        badge: '/assets/icon-192.svg',
        tag: 'ai-message',
        requireInteraction: false
    };

    if (event.data) {
        try {
            const data = event.data.json();
            notificationData = {
                title: data.title || notificationData.title,
                body: data.body || notificationData.body,
                icon: data.icon || notificationData.icon,
                badge: data.badge || notificationData.badge,
                tag: data.tag || notificationData.tag,
                data: data.data || {},
                requireInteraction: data.requireInteraction || false
            };
        } catch (e) {
            notificationData.body = event.data.text();
        }
    }

    event.waitUntil(
        self.registration.showNotification(notificationData.title, {
            body: notificationData.body,
            icon: notificationData.icon,
            badge: notificationData.badge,
            tag: notificationData.tag,
            data: notificationData.data,
            requireInteraction: notificationData.requireInteraction
        })
    );
});

// Notification click event
self.addEventListener('notificationclick', (event) => {
    console.log('Notification clicked:', event);
    event.notification.close();

    const targetUrl = event.notification?.data?.url || '/';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                // If app is already open, focus it
                for (let client of clientList) {
                    if (client.url.includes(self.registration.scope) && 'focus' in client) {
                        if ('navigate' in client && targetUrl) {
                            client.navigate(targetUrl).catch(() => {});
                        }
                        return client.focus();
                    }
                }
                // Otherwise open new window
                if (clients.openWindow) {
                    return clients.openWindow(targetUrl);
                }
            })
    );
});