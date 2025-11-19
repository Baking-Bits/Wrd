const webpush = require('web-push');
const config = require('./config');

class PushService {
    constructor() {
        this.enabled = false;
        this.db = null;
        this.initialized = false;
        this.publicKey = null;
    }

    initialize(dbInstance) {
        this.db = dbInstance;
        const pushConfig = config.pushNotifications || {};
        this.publicKey = pushConfig.vapidPublicKey || null;

        if (pushConfig.enabled === false) {
            console.log('📵 Push notifications disabled via config');
            this.enabled = false;
            this.initialized = true;
            return;
        }

        if (!pushConfig.vapidPublicKey || !pushConfig.vapidPrivateKey) {
            console.warn('⚠️ Push notifications disabled: missing VAPID keys');
            this.enabled = false;
            this.initialized = true;
            return;
        }

        const subject = pushConfig.subject || 'mailto:support@example.com';
        webpush.setVapidDetails(subject, pushConfig.vapidPublicKey, pushConfig.vapidPrivateKey);
        this.enabled = true;
        this.initialized = true;
        console.log('✅ Push notifications enabled');
    }

    isEnabled() {
        return this.enabled;
    }

    getPublicKey() {
        return this.publicKey;
    }

    async saveSubscription(userId, subscription, metadata = {}) {
        if (!this.enabled || !this.db) {
            return { success: false, message: 'Push notifications disabled' };
        }

        await this.db.pushSubscriptions.saveSubscription(userId, subscription, metadata);
        return { success: true };
    }

    async removeSubscription(userId, endpoint) {
        if (!this.enabled || !this.db) {
            return { success: false };
        }
        const removed = await this.db.pushSubscriptions.removeSubscription(userId, endpoint);
        return { success: removed };
    }

    async notifyAiMessage({ userId, chatId, messageId, personalityName, messagePreview, messageType = 'text' }) {
        if (!this.enabled || !this.db) {
            return;
        }

        try {
            const subscriptions = await this.db.pushSubscriptions.getActiveSubscriptions(userId);
            if (!subscriptions || subscriptions.length === 0) {
                return;
            }

            const payload = JSON.stringify({
                title: personalityName || 'AI Companion',
                body: messagePreview || 'New message from your AI companion',
                icon: '/assets/icon-192.svg',
                badge: '/assets/icon-192.svg',
                tag: `chat-${chatId}`,
                data: {
                    chatId,
                    messageId,
                    type: messageType,
                    url: `/chat/${chatId}`
                }
            });

            await Promise.all(subscriptions.map(sub => this.sendToSubscription(sub, payload)));
        } catch (error) {
            console.error('Push notification broadcast failed:', error.message);
        }
    }

    async sendToSubscription(subscriptionRow, payload) {
        const subscription = {
            endpoint: subscriptionRow.endpoint,
            keys: {
                p256dh: subscriptionRow.p256dh,
                auth: subscriptionRow.auth
            }
        };

        try {
            await webpush.sendNotification(subscription, payload);
            await this.db.pushSubscriptions.markSubscriptionUsed(subscriptionRow.id);
        } catch (error) {
            const status = error.statusCode || error.status;
            if (status === 404 || status === 410) {
                console.warn('Removing stale push subscription:', status);
                await this.db.pushSubscriptions.deactivateSubscriptionById(subscriptionRow.id);
                return;
            }
            console.error('Failed to send push notification:', error.message);
        }
    }
}

module.exports = new PushService();
