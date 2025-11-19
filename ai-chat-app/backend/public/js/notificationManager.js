/**
 * Notification Manager - Handles push notifications for AI messages
 */
class NotificationManager {
    constructor() {
        this.permission = 'default';
        this.enabled = false;
        this.isPageVisible = true;
        this.serviceWorkerRegistration = null;
        this.subscription = null;
        this.vapidKey = null;
        this.apiBase = `${window.location.origin}/api`;
        
        // Track page visibility
        this.setupVisibilityTracking();
    }

    /**
     * Initialize notification system
     */
    async init() {
        try {
            // Check if notifications are supported
            if (!('Notification' in window)) {
                console.log('This browser does not support notifications');
                return false;
            }

            // Check if service worker is supported
            if (!('serviceWorker' in navigator)) {
                console.log('Service workers are not supported');
                return false;
            }

            // Register service worker if not already registered
            this.serviceWorkerRegistration = await navigator.serviceWorker.register('/sw.js', {
                scope: '/'
            });

            console.log('Service Worker registered for notifications');

            // Check current permission
            this.permission = Notification.permission;
            this.enabled = this.permission === 'granted';

            // Auto-request permission if default (not denied)
            if (this.permission === 'default') {
                await this.requestPermission();
            }

            if (this.enabled) {
                await this.syncPushSubscription();
            }

            return this.enabled;
        } catch (error) {
            console.error('Failed to initialize notifications:', error);
            return false;
        }
    }

    /**
     * Request notification permission from user
     */
    async requestPermission() {
        try {
            const permission = await Notification.requestPermission();
            this.permission = permission;
            this.enabled = permission === 'granted';

            if (this.enabled) {
                console.log('✅ Notifications enabled');
                await this.syncPushSubscription();
            } else {
                console.log('⚠️ Notifications denied');
            }

            return this.enabled;
        } catch (error) {
            console.error('Failed to request notification permission:', error);
            return false;
        }
    }

    /**
     * Track page visibility to only show notifications when page is hidden
     */
    setupVisibilityTracking() {
        document.addEventListener('visibilitychange', () => {
            this.isPageVisible = !document.hidden;
            console.log('Page visible:', this.isPageVisible);
        });

        // Also track window focus
        window.addEventListener('focus', () => {
            this.isPageVisible = true;
        });

        window.addEventListener('blur', () => {
            this.isPageVisible = false;
        });
    }

    async syncPushSubscription() {
        if (!this.enabled || !this.serviceWorkerRegistration) {
            return;
        }

        if (!window.apiService || !apiService.isAuthenticated()) {
            console.log('🔐 Skipping push sync: user not authenticated');
            return;
        }

        try {
            if (!this.vapidKey) {
                this.vapidKey = await this.fetchVapidKey();
            }

            if (!this.vapidKey) {
                console.warn('⚠️ VAPID key unavailable, cannot register push notifications');
                return;
            }

            const existing = await this.serviceWorkerRegistration.pushManager.getSubscription();
            if (existing) {
                this.subscription = existing;
            } else {
                const applicationServerKey = this.urlBase64ToUint8Array(this.vapidKey);
                this.subscription = await this.serviceWorkerRegistration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey
                });
            }

            await this.sendSubscriptionToServer(this.subscription);
        } catch (error) {
            console.error('Failed to sync push subscription:', error);
        }
    }

    async fetchVapidKey() {
        if (!window.apiService || !apiService.isAuthenticated()) {
            return null;
        }

        try {
            const response = await fetch(`${this.apiBase}/notifications/vapid-key`, {
                headers: apiService.getAuthHeaders()
            });
            const data = await response.json();
            if (!response.ok || !data.enabled) {
                return null;
            }
            return data.publicKey || null;
        } catch (error) {
            console.error('Failed to fetch VAPID key:', error);
            return null;
        }
    }

    async sendSubscriptionToServer(subscription) {
        if (!subscription || !window.apiService || !apiService.isAuthenticated()) {
            return;
        }

        const payload = subscription.toJSON ? subscription.toJSON() : subscription;
        try {
            await fetch(`${this.apiBase}/notifications/subscribe`, {
                method: 'POST',
                headers: apiService.getAuthHeaders(),
                body: JSON.stringify({
                    subscription: payload,
                    device: this.getDeviceInfo()
                })
            });
            console.log('🔔 Push subscription synced with server');
        } catch (error) {
            console.error('Failed to register push subscription:', error);
        }
    }

    async unsubscribeFromServer(endpoint) {
        if (!endpoint || !window.apiService || !apiService.isAuthenticated()) {
            return;
        }

        try {
            await fetch(`${this.apiBase}/notifications/subscribe`, {
                method: 'DELETE',
                headers: apiService.getAuthHeaders(),
                body: JSON.stringify({ endpoint })
            });
            console.log('🗑️ Push subscription removed from server');
        } catch (error) {
            console.error('Failed to remove push subscription:', error);
        }
    }

    async disablePushNotifications() {
        if (!this.serviceWorkerRegistration) {
            return;
        }

        const subscription = await this.serviceWorkerRegistration.pushManager.getSubscription();
        if (subscription) {
            const endpoint = subscription.endpoint;
            await subscription.unsubscribe();
            await this.unsubscribeFromServer(endpoint);
            this.subscription = null;
        }
    }

    getDeviceInfo() {
        const uaData = navigator.userAgentData || {};
        return {
            name: uaData.platform || navigator.platform || 'unknown',
            platform: uaData.platform || navigator.platform || 'unknown',
            userAgent: navigator.userAgent
        };
    }

    urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const rawData = window.atob(base64);
        const outputArray = new Uint8Array(rawData.length);
        for (let i = 0; i < rawData.length; ++i) {
            outputArray[i] = rawData.charCodeAt(i);
        }
        return outputArray;
    }

    /**
     * Show notification for AI message
     * @param {string} personalityName - Name of the AI personality
     * @param {string} messageType - Type of message ('text' or 'image')
     */
    async showAIMessageNotification(personalityName, messageType = 'text') {
        // Only show notification if:
        // 1. Enabled
        // 2. Page is not visible
        // 3. Permission granted
        if (!this.enabled || this.isPageVisible || this.permission !== 'granted') {
            return;
        }

        try {
            const title = personalityName;
            const body = messageType === 'image' 
                ? '🖼️ Sent you an image'
                : '💬 Sent you a message';

            const options = {
                body: body,
                icon: '/assets/icon-192.svg',
                badge: '/assets/icon-192.svg',
                tag: 'ai-message',
                requireInteraction: false,
                silent: false,
                vibrate: [200, 100, 200],
                data: {
                    personality: personalityName,
                    type: messageType,
                    timestamp: Date.now()
                }
            };

            // Use service worker if available, otherwise direct notification
            if (this.serviceWorkerRegistration && this.serviceWorkerRegistration.active) {
                // Show via service worker
                await this.serviceWorkerRegistration.showNotification(title, options);
            } else {
                // Fallback to direct notification
                new Notification(title, options);
            }

            console.log(`📱 Notification shown: "${personalityName}" sent ${messageType}`);
        } catch (error) {
            console.error('Failed to show notification:', error);
        }
    }

    /**
     * Test notification
     */
    async testNotification() {
        if (!this.enabled) {
            const granted = await this.requestPermission();
            if (!granted) {
                alert('Please enable notifications in your browser settings');
                return;
            }
        }

        await this.showAIMessageNotification('Test AI', 'text');
    }

    /**
     * Get notification status
     */
    getStatus() {
        return {
            supported: 'Notification' in window,
            permission: this.permission,
            enabled: this.enabled,
            isPageVisible: this.isPageVisible
        };
    }
}

// Export singleton instance
const notificationManager = new NotificationManager();
