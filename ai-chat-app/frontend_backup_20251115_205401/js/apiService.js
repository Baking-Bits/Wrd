/**
 * API Service Layer - Handles all HTTP communication with the backend
 * Centralized service for authentication, personalities, chats, and settings
 */
class ApiService {
    constructor() {
        this.baseUrl = 'http://localhost:3001/api';
        this.token = localStorage.getItem('authToken');
        
        // Test mode - disable API calls if backend is not available
        this.testMode = false;
        this.testModeChecked = false;
    }

    // =============================================================================
    // AUTHENTICATION METHODS
    // =============================================================================

    /**
     * Register a new user
     * @param {Object} userData - {username, email, password}
     * @returns {Promise<Object>} Registration response
     */
    async register(userData) {
        try {
            const response = await fetch(`${this.baseUrl}/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(userData)
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Registration failed');
            }

            // Store token if registration includes login
            if (data.token) {
                this.setToken(data.token);
            }

            return data;
        } catch (error) {
            console.error('Registration error:', error);
            throw error;
        }
    }

    /**
     * Login user
     * @param {Object} credentials - {email, password}
     * @returns {Promise<Object>} Login response with token and user data
     */
    async login(credentials) {
        try {
            const response = await fetch(`${this.baseUrl}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(credentials)
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Login failed');
            }

            // Store token
            this.setToken(data.token);

            return data;
        } catch (error) {
            console.error('Login error:', error);
            throw error;
        }
    }

    /**
     * Logout user
     * @returns {Promise<Object>} Logout response
     */
    async logout() {
        try {
            const response = await fetch(`${this.baseUrl}/auth/logout`, {
                method: 'POST',
                headers: this.getAuthHeaders()
            });

            // Clear token regardless of response
            this.clearToken();

            if (!response.ok) {
                console.warn('Logout request failed, but token cleared locally');
            }

            return { success: true, message: 'Logged out successfully' };
        } catch (error) {
            console.error('Logout error:', error);
            // Clear token even if request fails
            this.clearToken();
            return { success: true, message: 'Logged out locally' };
        }
    }

    /**
     * Get user profile
     * @returns {Promise<Object>} User profile data
     */
    async getProfile() {
        try {
            const response = await this.authenticatedRequest(`${this.baseUrl}/auth/profile`);
            return response;
        } catch (error) {
            console.error('Get profile error:', error);
            throw error;
        }
    }

    // =============================================================================
    // PERSONALITY METHODS
    // =============================================================================

    /**
     * Get all personalities for current user
     * @returns {Promise<Array>} Array of personality objects
     */
    async getPersonalities() {
        try {
            const response = await this.authenticatedRequest(`${this.baseUrl}/personalities`);
            return response;
        } catch (error) {
            console.error('Get personalities error:', error);
            throw error;
        }
    }

    /**
     * Create a new personality
     * @param {Object} personalityData - Personality configuration
     * @returns {Promise<Object>} Created personality
     */
    async createPersonality(personalityData) {
        try {
            const response = await this.authenticatedRequest(`${this.baseUrl}/personalities`, {
                method: 'POST',
                body: JSON.stringify(personalityData)
            });
            return response;
        } catch (error) {
            console.error('Create personality error:', error);
            throw error;
        }
    }

    /**
     * Update an existing personality
     * @param {string} id - Personality ID
     * @param {Object} personalityData - Updated personality data
     * @returns {Promise<Object>} Updated personality
     */
    async updatePersonality(id, personalityData) {
        try {
            const response = await this.authenticatedRequest(`${this.baseUrl}/personalities/${id}`, {
                method: 'PUT',
                body: JSON.stringify(personalityData)
            });
            return response;
        } catch (error) {
            console.error('Update personality error:', error);
            throw error;
        }
    }

    /**
     * Delete a personality
     * @param {string} id - Personality ID
     * @returns {Promise<Object>} Deletion confirmation
     */
    async deletePersonality(id) {
        try {
            const response = await this.authenticatedRequest(`${this.baseUrl}/personalities/${id}`, {
                method: 'DELETE'
            });
            return response;
        } catch (error) {
            console.error('Delete personality error:', error);
            throw error;
        }
    }

    /**
     * Generate avatar for personality
     * @param {string} id - Personality ID
     * @returns {Promise<Object>} Avatar generation response
     */
    async generateAvatar(id) {
        try {
            const response = await this.authenticatedRequest(`${this.baseUrl}/personalities/${id}/avatar`, {
                method: 'POST'
            });
            return response;
        } catch (error) {
            console.error('Generate avatar error:', error);
            throw error;
        }
    }

    // =============================================================================
    // CHAT METHODS
    // =============================================================================

    /**
     * Get all chat sessions for current user
     * @returns {Promise<Array>} Array of chat sessions
     */
    async getChatSessions() {
        try {
            const response = await this.authenticatedRequest(`${this.baseUrl}/chats`);
            return response;
        } catch (error) {
            console.error('Get chat sessions error:', error);
            throw error;
        }
    }

    /**
     * Create a new chat session
     * @param {Object} sessionData - {personalityId, name}
     * @returns {Promise<Object>} Created chat session
     */
    async createChatSession(sessionData) {
        try {
            const response = await this.authenticatedRequest(`${this.baseUrl}/chats`, {
                method: 'POST',
                body: JSON.stringify(sessionData)
            });
            return response;
        } catch (error) {
            console.error('Create chat session error:', error);
            throw error;
        }
    }

    /**
     * Get messages for a chat session
     * @param {string} sessionId - Chat session ID
     * @returns {Promise<Array>} Array of messages
     */
    async getChatMessages(sessionId) {
        try {
            const response = await this.authenticatedRequest(`${this.baseUrl}/chats/${sessionId}/messages`);
            return response;
        } catch (error) {
            console.error('Get chat messages error:', error);
            throw error;
        }
    }

    /**
     * Send a message in a chat session
     * @param {string} sessionId - Chat session ID
     * @param {Object} messageData - {message, type}
     * @returns {Promise<Object>} AI response
     */
    async sendMessage(sessionId, messageData) {
        try {
            const response = await this.authenticatedRequest(`${this.baseUrl}/chats/${sessionId}/messages`, {
                method: 'POST',
                body: JSON.stringify(messageData)
            });
            return response;
        } catch (error) {
            console.error('Send message error:', error);
            throw error;
        }
    }

    /**
     * Update chat session (rename, etc.)
     * @param {string} sessionId - Chat session ID
     * @param {Object} sessionData - Updated session data
     * @returns {Promise<Object>} Updated session
     */
    async updateChatSession(sessionId, sessionData) {
        try {
            const response = await this.authenticatedRequest(`${this.baseUrl}/chats/${sessionId}`, {
                method: 'PUT',
                body: JSON.stringify(sessionData)
            });
            return response;
        } catch (error) {
            console.error('Update chat session error:', error);
            throw error;
        }
    }

    /**
     * Delete a chat session
     * @param {string} sessionId - Chat session ID
     * @returns {Promise<Object>} Deletion confirmation
     */
    async deleteChatSession(sessionId) {
        try {
            const response = await this.authenticatedRequest(`${this.baseUrl}/chats/${sessionId}`, {
                method: 'DELETE'
            });
            return response;
        } catch (error) {
            console.error('Delete chat session error:', error);
            throw error;
        }
    }

    // =============================================================================
    // SETTINGS METHODS
    // =============================================================================

    /**
     * Get user settings
     * @returns {Promise<Object>} User settings
     */
    async getSettings() {
        try {
            const response = await this.authenticatedRequest(`${this.baseUrl}/settings`);
            return response;
        } catch (error) {
            console.error('Get settings error:', error);
            throw error;
        }
    }

    /**
     * Update user settings
     * @param {Object} settings - Settings to update
     * @returns {Promise<Object>} Updated settings
     */
    async updateSettings(settings) {
        try {
            const response = await this.authenticatedRequest(`${this.baseUrl}/settings`, {
                method: 'PUT',
                body: JSON.stringify(settings)
            });
            return response;
        } catch (error) {
            console.error('Update settings error:', error);
            throw error;
        }
    }

    /**
     * Test AI service connectivity
     * @param {string} service - Service name ('localai', 'automatic1111', 'comfyui')
     * @returns {Promise<Object>} Service status
     */
    async testAIService(service) {
        try {
            const response = await this.authenticatedRequest(`${this.baseUrl}/settings/test-service`, {
                method: 'POST',
                body: JSON.stringify({ service })
            });
            return response;
        } catch (error) {
            console.error('Test AI service error:', error);
            throw error;
        }
    }

    // =============================================================================
    // UTILITY METHODS
    // =============================================================================

    /**
     * Set authentication token
     * @param {string} token - JWT token
     */
    setToken(token) {
        this.token = token;
        localStorage.setItem('authToken', token);
    }

    /**
     * Clear authentication token
     */
    clearToken() {
        this.token = null;
        localStorage.removeItem('authToken');
    }

    /**
     * Check if user is authenticated
     * @returns {boolean} True if token exists
     */
    isAuthenticated() {
        return !!this.token;
    }

    /**
     * Get authentication headers
     * @returns {Object} Headers with Authorization
     */
    getAuthHeaders() {
        const headers = {
            'Content-Type': 'application/json'
        };

        if (this.token) {
            headers.Authorization = `Bearer ${this.token}`;
        }

        return headers;
    }

    /**
     * Check if backend is available
     * @returns {Promise<boolean>} True if backend is available
     */
    async checkBackendAvailability() {
        if (this.testModeChecked) return !this.testMode;
        
        try {
            const response = await fetch(`${this.baseUrl}/health`, { 
                method: 'GET',
                signal: AbortSignal.timeout(3000) // 3 second timeout
            });
            this.testMode = false;
            this.testModeChecked = true;
            console.log('✅ Backend is available');
            return true;
        } catch (error) {
            this.testMode = true;
            this.testModeChecked = true;
            console.log('⚠️ Backend not available, switching to test mode');
            return false;
        }
    }

    /**
     * Make authenticated request
     * @param {string} url - Request URL
     * @param {Object} options - Fetch options
     * @returns {Promise<Object>} Response data
     */
    async authenticatedRequest(url, options = {}) {
        // Check backend availability first
        if (!this.testModeChecked) {
            await this.checkBackendAvailability();
        }
        
        if (this.testMode) {
            console.log('🔧 Test mode: Simulating API response');
            return this.simulateApiResponse(url, options);
        }
        
        try {
            const config = {
                method: 'GET',
                headers: this.getAuthHeaders(),
                ...options
            };

            const response = await fetch(url, config);
            const data = await response.json();

            if (!response.ok) {
                // Handle authentication errors
                if (response.status === 401) {
                    this.clearToken();
                    throw new Error('Authentication expired. Please login again.');
                }
                throw new Error(data.message || `Request failed with status ${response.status}`);
            }

            return data;
        } catch (error) {
            console.error('Authenticated request error:', error);
            throw error;
        }
    }

    /**
     * Simulate API responses for testing without backend
     * @param {string} url - Request URL
     * @param {Object} options - Request options
     * @returns {Object} Simulated response
     */
    simulateApiResponse(url, options = {}) {
        const method = options.method || 'GET';
        
        // Simulate different endpoints
        if (url.includes('/settings')) {
            return {
                localaiUrl: '/api/localai',
                localaiModel: 'josiefied-qwen3-4b-abliterated-gpu',
                a1111Url: '/api/a1111',
                comfyUrl: '/api/comfy',
                showThinking: false,
                autoUnloadModel: true
            };
        }
        
        if (url.includes('/personalities')) {
            return [
                {
                    id: 'aria',
                    name: 'Aria',
                    description: 'Creative and enthusiastic assistant',
                    systemPrompt: 'You are Aria, a creative and enthusiastic AI assistant...'
                }
            ];
        }
        
        if (url.includes('/chats')) {
            return [];
        }
        
        return { message: 'Test mode response' };
    }

    /**
     * Handle API errors consistently
     * @param {Error} error - Error object
     * @param {string} context - Context where error occurred
     */
    handleError(error, context) {
        console.error(`${context}:`, error);
        
        // Show user-friendly error messages
        let message = error.message;
        if (error.message.includes('fetch')) {
            message = 'Connection error. Please check your internet connection.';
        } else if (error.message.includes('401')) {
            message = 'Authentication expired. Please login again.';
        } else if (error.message.includes('500')) {
            message = 'Server error. Please try again later.';
        }

        // You can integrate with a notification system here
        this.showNotification('error', message);
    }

    /**
     * Show notification (placeholder for UI integration)
     * @param {string} type - 'success', 'error', 'warning', 'info'
     * @param {string} message - Notification message
     */
    showNotification(type, message) {
        // This will be integrated with the UI notification system
        console.log(`[${type.toUpperCase()}] ${message}`);
    }
}

// Create singleton instance
const apiService = new ApiService();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = ApiService;
} else {
    window.ApiService = ApiService;
    window.apiService = apiService;
}