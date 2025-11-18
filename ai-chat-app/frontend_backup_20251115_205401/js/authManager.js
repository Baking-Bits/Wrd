/**
 * Authentication Manager - Handles login/register UI and authentication flow
 */
class AuthManager {
    constructor(apiService) {
        this.apiService = apiService;
        this.currentUser = null;
        this.authModal = null;
        this.isInitialized = false;
    }

    /**
     * Initialize authentication system
     */
    async init() {
        if (this.isInitialized) return;

        // Check if backend is available
        const backendAvailable = await this.apiService.checkBackendAvailability();
        
        if (!backendAvailable) {
            console.log('🔧 Backend not available - skipping authentication for testing');
            // Simulate logged in user for testing
            this.currentUser = {
                id: 'test-user',
                username: 'Test User',
                email: 'test@example.com'
            };
            this.showAuthenticatedUI();
            setTimeout(() => this.onAuthSuccess(), 100);
            this.isInitialized = true;
            return;
        }

        this.createAuthModal();
        this.setupEventListeners();
        
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

            <!-- User Profile Dropdown -->
            <div id="userProfile" class="user-profile" style="display: none;">
                <div class="user-avatar">
                    <span id="userInitials"></span>
                </div>
                <div class="user-dropdown">
                    <div class="user-info">
                        <span id="userName"></span>
                        <span id="userEmail"></span>
                    </div>
                    <div class="user-actions">
                        <button id="profileSettings">Settings</button>
                        <button id="logoutBtn">Logout</button>
                    </div>
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

        // User profile actions
        document.getElementById('logoutBtn').addEventListener('click', () => {
            this.handleLogout();
        });

        // Close modal on outside click
        this.authModal.addEventListener('click', (e) => {
            if (e.target === this.authModal) {
                this.hideAuthModal();
            }
        });

        // Add login button to header if it doesn't exist
        this.addLoginButton();
    }

    /**
     * Add login button to header
     */
    addLoginButton() {
        const header = document.querySelector('.chat-header') || document.querySelector('header');
        if (header && !document.getElementById('authButton')) {
            const authButton = document.createElement('button');
            authButton.id = 'authButton';
            authButton.className = 'auth-trigger';
            authButton.textContent = 'Sign In';
            authButton.addEventListener('click', () => this.showAuthModal());
            
            header.appendChild(authButton);
        }
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
        // Update header button
        const authButton = document.getElementById('authButton');
        if (authButton) {
            authButton.style.display = 'none';
        }

        // Show user profile
        const userProfile = document.getElementById('userProfile');
        const userName = document.getElementById('userName');
        const userEmail = document.getElementById('userEmail');
        const userInitials = document.getElementById('userInitials');

        if (userProfile && this.currentUser) {
            userProfile.style.display = 'flex';
            userName.textContent = this.currentUser.username;
            userEmail.textContent = this.currentUser.email;
            
            // Create initials
            const initials = this.currentUser.username
                .split(' ')
                .map(name => name[0])
                .join('')
                .toUpperCase()
                .substring(0, 2);
            userInitials.textContent = initials;
        }
    }

    /**
     * Show unauthenticated UI state
     */
    showUnauthenticatedUI() {
        // Show login button
        const authButton = document.getElementById('authButton');
        if (authButton) {
            authButton.style.display = 'block';
        }

        // Hide user profile
        const userProfile = document.getElementById('userProfile');
        if (userProfile) {
            userProfile.style.display = 'none';
        }
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
    onAuthSuccess() {
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