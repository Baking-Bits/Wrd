/**
 * Notification Manager - Handles push notifications for AI messages
 */
class NotificationManager {
    constructor() {
        this.permission = 'default';
        this.enabled = false;
        this.isPageVisible = true;
        this.serviceWorkerRegistration = null;
        
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
