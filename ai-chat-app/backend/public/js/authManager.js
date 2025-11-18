/**
 * Authentication Manager - Handles login/register UI and authentication flow
 */
class AuthManager {
    constructor(apiService) {
        this.apiService = apiService;
        this.currentUser = null;
        this.authModal = null;
        this.isInitialized = false;
        this.offlineCheckInterval = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 60; // Try for 5 minutes (5s intervals)
    }

    /**
     * Show offline overlay when server is unreachable
     */
    showOfflineOverlay() {
        const overlay = document.getElementById('offlineOverlay');
        if (overlay) {
            overlay.style.display = 'flex';
            // Store that we've seen the server before
            localStorage.setItem('serverWasOnline', 'true');
            localStorage.setItem('lastOfflineTime', Date.now().toString());
        }
    }

    /**
     * Hide offline overlay when server is back
     */
    hideOfflineOverlay() {
        const overlay = document.getElementById('offlineOverlay');
        if (overlay) {
            overlay.style.display = 'none';
            this.reconnectAttempts = 0;
        }
    }

    /**
     * Start checking for server availability
     */
    startOfflineCheck() {
        if (this.offlineCheckInterval) return;
        
        this.offlineCheckInterval = setInterval(async () => {
            const available = await this.apiService.checkBackendAvailability();
            const overlay = document.getElementById('offlineOverlay');
            const status = document.querySelector('.offline-status');
            
            if (!available) {
                if (overlay && overlay.style.display !== 'flex') {
                    this.showOfflineOverlay();
                }
                this.reconnectAttempts++;
                
                if (status) {
                    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                        status.textContent = 'Server is taking longer than expected...';
                    } else {
                        status.textContent = `Checking connection... (attempt ${this.reconnectAttempts})`;
                    }
                }
            } else {
                if (overlay && overlay.style.display === 'flex') {
                    this.hideOfflineOverlay();
                    // Reload page to reinitialize everything
                    window.location.reload();
                }
            }
        }, 5000); // Check every 5 seconds
    }

    /**
     * Manual retry connection
     */
    async retryConnection() {
        const status = document.querySelector('.offline-status');
        if (status) status.textContent = 'Retrying connection...';
        
        const available = await this.apiService.checkBackendAvailability();
        if (available) {
            this.hideOfflineOverlay();
            window.location.reload();
        } else {
            if (status) status.textContent = 'Still unable to connect. Will keep trying...';
        }
    }

    /**
     * Initialize authentication system
     */
    async init() {
        if (this.isInitialized) return;

        // Setup retry button listener
        const retryBtn = document.getElementById('retryConnectionBtn');
        if (retryBtn) {
            retryBtn.addEventListener('click', () => this.retryConnection());
        }

        // Check if backend is available
        console.log('🔍 Checking backend availability...');
        const backendAvailable = await this.apiService.checkBackendAvailability();
        console.log('🔍 Backend available:', backendAvailable);
        
        // If server was online before but now offline, show maintenance screen
        const serverWasOnline = localStorage.getItem('serverWasOnline');
        if (!backendAvailable && serverWasOnline) {
            this.showOfflineOverlay();
            this.startOfflineCheck();
            this.isInitialized = true;
            return;
        }
        
        // Start monitoring for connection issues
        if (backendAvailable) {
            localStorage.setItem('serverWasOnline', 'true');
            this.startOfflineCheck();
        }
        
        // Always create auth modal and setup listeners
        this.createAuthModal();
        this.setupEventListeners();

        if (!backendAvailable) {
            console.log('❌ Backend not available - authentication required');
            this.showUnauthenticatedUI();
            this.isInitialized = true;
            return;
        }
        
        // Check if user is already logged in
        if (this.apiService.isAuthenticated()) {
            try {
                this.currentUser = await this.apiService.getProfile();
                this.showAuthenticatedUI();
            } catch (error) {
                console.log('Invalid token, showing login');
                this.apiService.clearToken();
                this.showUnauthenticatedUI();
            }
        } else {
            this.showUnauthenticatedUI();
        }

        this.isInitialized = true;
    }

    /**
     * Create authentication modal HTML
     */
    createAuthModal() {
        // Skip modal creation in test mode
        if (this.apiService.testMode) {
            return;
        }
        
        const modalHTML = `
            <div id="authModal" class="auth-modal" style="display: none;">
                <div class="auth-modal-content">
                    <div class="auth-header">
                        <h2 id="authTitle">Sign In</h2>
                        <button class="auth-close" id="closeAuthModal">&times;</button>
                    </div>
                    
                    <!-- Login Form -->
                    <form id="loginForm" class="auth-form">
                        <div class="form-group">
                            <label for="loginEmail">Email:</label>
                            <input type="email" id="loginEmail" required>
                        </div>
                        <div class="form-group">
                            <label for="loginPassword">Password:</label>
                            <input type="password" id="loginPassword" required>
                        </div>
                        <button type="submit" class="auth-btn">Sign In</button>
                        <p class="auth-switch">
                            Don't have an account? 
                            <a href="#" id="showRegister">Sign up</a>
                        </p>
                    </form>

                    <!-- Register Form -->
                    <form id="registerForm" class="auth-form" style="display: none;">
                        <div class="form-group">
                            <label for="registerUsername">Username:</label>
                            <input type="text" id="registerUsername" required>
                        </div>
                        <div class="form-group">
                            <label for="registerEmail">Email:</label>
                            <input type="email" id="registerEmail" required>
                        </div>
                        <div class="form-group">
                            <label for="registerPassword">Password:</label>
                            <input type="password" id="registerPassword" required minlength="6">
                        </div>
                        <div class="form-group">
                            <label for="confirmPassword">Confirm Password:</label>
                            <input type="password" id="confirmPassword" required>
                        </div>
                        <button type="submit" class="auth-btn">Sign Up</button>
                        <p class="auth-switch">
                            Already have an account? 
                            <a href="#" id="showLogin">Sign in</a>
                        </p>
                    </form>

                    <div id="authMessage" class="auth-message"></div>
                </div>
            </div>
        `;

        // Add to document
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.authModal = document.getElementById('authModal');
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Skip event listeners in test mode
        if (this.apiService.testMode) {
            return;
        }
        
        // Modal controls
        document.getElementById('closeAuthModal').addEventListener('click', () => {
            this.hideAuthModal();
        });

        // Form switching
        document.getElementById('showRegister').addEventListener('click', (e) => {
            e.preventDefault();
            this.showRegisterForm();
        });

        document.getElementById('showLogin').addEventListener('click', (e) => {
            e.preventDefault();
            this.showLoginForm();
        });

        // Form submissions
        document.getElementById('loginForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        document.getElementById('registerForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleRegister();
        });

        // User dropdown listeners will be set up after login in setupUserDropdownListeners()

        // Auth button in header
        const authButton = document.getElementById('authButton');
        if (authButton) {
            authButton.addEventListener('click', () => this.showAuthModal());
        }

        // Close modal on outside click
        if (this.authModal) {
            this.authModal.addEventListener('click', (e) => {
                if (e.target === this.authModal) {
                    this.hideAuthModal();
                }
            });
        }
    }

    /**
     * Add login button to header (no longer needed - using existing HTML)
     */
    addLoginButton() {
        // Login button is now part of the HTML template
        return;
    }

    /**
     * Handle login form submission
     */
    async handleLogin() {
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;

        this.showAuthMessage('Signing in...', 'info');

        try {
            const response = await this.apiService.login({ email, password });
            this.currentUser = response.user;
            
            this.showAuthMessage('Login successful!', 'success');
            setTimeout(() => {
                this.hideAuthModal();
                this.showAuthenticatedUI();
                this.onAuthSuccess();
            }, 1000);

        } catch (error) {
            this.showAuthMessage(error.message, 'error');
        }
    }

    /**
     * Handle register form submission
     */
    async handleRegister() {
        const username = document.getElementById('registerUsername').value;
        const email = document.getElementById('registerEmail').value;
        const password = document.getElementById('registerPassword').value;
        const confirmPassword = document.getElementById('confirmPassword').value;

        if (password !== confirmPassword) {
            this.showAuthMessage('Passwords do not match', 'error');
            return;
        }

        this.showAuthMessage('Creating account...', 'info');

        try {
            const response = await this.apiService.register({ username, email, password });
            
            // If registration includes login (token provided)
            if (response.token) {
                this.currentUser = response.user;
                this.showAuthMessage('Account created successfully!', 'success');
                setTimeout(() => {
                    this.hideAuthModal();
                    this.showAuthenticatedUI();
                    this.onAuthSuccess();
                }, 1000);
            } else {
                this.showAuthMessage('Account created! Please sign in.', 'success');
                setTimeout(() => {
                    this.showLoginForm();
                }, 1500);
            }

        } catch (error) {
            this.showAuthMessage(error.message, 'error');
        }
    }

    /**
     * Handle logout
     */
    async handleLogout() {
        try {
            await this.apiService.logout();
            this.currentUser = null;
            this.showUnauthenticatedUI();
            this.onAuthLogout();
        } catch (error) {
            console.error('Logout error:', error);
            // Clear local state anyway
            this.currentUser = null;
            this.showUnauthenticatedUI();
            this.onAuthLogout();
        }
    }

    /**
     * Show authentication modal
     */
    showAuthModal() {
        this.authModal.style.display = 'flex';
        document.getElementById('loginEmail').focus();
    }

    /**
     * Hide authentication modal
     */
    hideAuthModal() {
        this.authModal.style.display = 'none';
        this.clearForms();
    }

    /**
     * Show login form
     */
    showLoginForm() {
        document.getElementById('authTitle').textContent = 'Sign In';
        document.getElementById('loginForm').style.display = 'block';
        document.getElementById('registerForm').style.display = 'none';
        this.clearAuthMessage();
    }

    /**
     * Show register form
     */
    showRegisterForm() {
        document.getElementById('authTitle').textContent = 'Sign Up';
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('registerForm').style.display = 'block';
        this.clearAuthMessage();
    }

    /**
     * Show authentication message
     */
    showAuthMessage(message, type) {
        const messageEl = document.getElementById('authMessage');
        messageEl.textContent = message;
        messageEl.className = `auth-message ${type}`;
        messageEl.style.display = 'block';
    }

    /**
     * Clear authentication message
     */
    clearAuthMessage() {
        const messageEl = document.getElementById('authMessage');
        messageEl.style.display = 'none';
        messageEl.textContent = '';
        messageEl.className = 'auth-message';
    }

    /**
     * Clear form inputs
     */
    clearForms() {
        document.getElementById('loginForm').reset();
        document.getElementById('registerForm').reset();
        this.clearAuthMessage();
    }

    /**
     * Show authenticated UI state
     */
    showAuthenticatedUI() {
        // Hide auth button, show user profile
        const authButton = document.getElementById('authButton');
        const userProfile = document.getElementById('userProfile');
        
        if (authButton) {
            authButton.style.display = 'none';
        }
        
        // Show the chat interface
        const chatContainer = document.querySelector('.chat-container');
        if (chatContainer) {
            chatContainer.style.display = 'flex';
        }
        
        if (userProfile && this.currentUser) {
            userProfile.style.display = 'flex';
            
            // Update user info in both dropdown and header display
            const userName = document.getElementById('userName');
            const userEmail = document.getElementById('userEmail');
            const userInitials = document.getElementById('userInitials');
            const userNameDisplay = document.getElementById('userNameDisplay');
            
            if (userName) userName.textContent = this.currentUser.username;
            if (userEmail) userEmail.textContent = this.currentUser.email;
            if (userNameDisplay) {
                // Truncate long usernames for compact display
                const displayName = this.currentUser.username.length > 12 
                    ? this.currentUser.username.substring(0, 12) + '...'
                    : this.currentUser.username;
                userNameDisplay.textContent = displayName;
            }
            
            // Create initials for avatar
            if (userInitials) {
                const initials = this.currentUser.username
                    .split(' ')
                    .map(name => name[0])
                    .join('')
                    .toUpperCase()
                    .substring(0, 2);
                userInitials.textContent = initials;
            }

            // Set up user dropdown event listeners now that elements exist
            this.setupUserDropdownListeners();
        }
    }

    /**
     * Set up user dropdown event listeners (called after UI is created)
     */
    setupUserDropdownListeners() {
        const userMenuBtn = document.getElementById('userMenuBtn');
        const userDropdown = document.getElementById('userDropdown');
        
        if (userMenuBtn && userDropdown) {
            // Remove any existing listeners to prevent duplicates
            userMenuBtn.replaceWith(userMenuBtn.cloneNode(true));
            const newUserMenuBtn = document.getElementById('userMenuBtn');
            
            newUserMenuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                userDropdown.style.display = userDropdown.style.display === 'block' ? 'none' : 'block';
            });

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                if (!newUserMenuBtn.contains(e.target) && !userDropdown.contains(e.target)) {
                    userDropdown.style.display = 'none';
                }
            });
            
            // Also set up the logout, settings, and clear chat button listeners
            const logoutBtn = document.getElementById('logoutBtn');
            const settingsBtn = document.getElementById('settingsBtn');
            const clearChatBtn = document.getElementById('clearChatBtn');
            
            if (clearChatBtn) {
                clearChatBtn.addEventListener('click', () => {
                    // Close dropdown first
                    userDropdown.style.display = 'none';
                    // Trigger clear chat event (app.js will handle this)
                    const clearChatEvent = new CustomEvent('clearChat');
                    window.dispatchEvent(clearChatEvent);
                });
            }
            
            if (logoutBtn) {
                logoutBtn.addEventListener('click', () => {
                    this.handleLogout();
                });
            }

            if (settingsBtn) {
                settingsBtn.addEventListener('click', () => {
                    // Close dropdown first
                    userDropdown.style.display = 'none';
                    // Trigger settings modal (app.js will handle this)
                    const settingsEvent = new CustomEvent('showSettings');
                    window.dispatchEvent(settingsEvent);
                });
            }
        }
    }

    /**
     * Show unauthenticated UI state
     */
    showUnauthenticatedUI() {
        // Show login button, hide user profile
        const authButton = document.getElementById('authButton');
        const userProfile = document.getElementById('userProfile');
        const userDropdown = document.getElementById('userDropdown');
        
        console.log('🔓 Showing unauthenticated UI - displaying login page');
        
        if (authButton) {
            authButton.style.display = 'flex';
        }
        
        if (userProfile) {
            userProfile.style.display = 'none';
        }
        
        // Close dropdown if open
        if (userDropdown) {
            userDropdown.style.display = 'none';
        }
        
        // Hide the entire chat interface and show only the login modal
        const chatContainer = document.querySelector('.chat-container');
        const contactsPage = document.getElementById('contactsPage');
        
        if (chatContainer) {
            chatContainer.style.display = 'none';
        }
        if (contactsPage) {
            contactsPage.style.display = 'none';
        }
        
        // Show auth modal automatically
        this.showAuthModal();
    }

    /**
     * Get current user
     */
    getCurrentUser() {
        return this.currentUser;
    }

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        return !!this.currentUser && this.apiService.isAuthenticated();
    }

    /**
     * Force authentication - show modal if not authenticated
     */
    requireAuth() {
        if (!this.isAuthenticated()) {
            this.showAuthModal();
            return false;
        }
        return true;
    }

    /**
     * Callback for successful authentication
     */
    async onAuthSuccess() {
        // Load personalities first, then notify app
        console.log('🎭 Loading personalities after authentication...');
        if (window.personalityManager) {
            try {
                await window.personalityManager.loadPersonalities();
                console.log('✅ Personalities loaded successfully');
            } catch (error) {
                console.error('❌ Failed to load personalities:', error);
            }
        }
        
        // This will be called when authentication is successful
        // Can be overridden or listened to by the main app
        window.dispatchEvent(new CustomEvent('authSuccess', { 
            detail: { user: this.currentUser } 
        }));
    }

    /**
     * Callback for logout
     */
    onAuthLogout() {
        // This will be called when user logs out
        // Can be overridden or listened to by the main app
        window.dispatchEvent(new CustomEvent('authLogout'));
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = AuthManager;
} else {
    window.AuthManager = AuthManager;
}