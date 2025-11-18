/**
 * Enhanced Personality Manager - Comprehensive AI personality system with avatar generation
 */
class PersonalityManager {
    constructor(apiService) {
        this.apiService = apiService;
        this.personalities = [];
        this.currentPersonality = null;
        this.currentChatId = null;
        this.currentTab = 'basic';
        this.isEditMode = false;
        this.editingPersonality = null;
        
        // Clean up old pending avatars on initialization
        this.cleanupOldPendingAvatars();
    }

    /**
     * Clean up pending avatars older than 24 hours from localStorage
     */
    cleanupOldPendingAvatars() {
        const maxAgeHours = 24;
        let cleanedCount = 0;
        
        try {
            // Get all localStorage keys
            const keys = Object.keys(localStorage);
            
            for (const key of keys) {
                if (key.startsWith('pending_avatar_')) {
                    try {
                        const data = JSON.parse(localStorage.getItem(key));
                        const ageInHours = (Date.now() - data.timestamp) / (1000 * 60 * 60);
                        
                        if (ageInHours > maxAgeHours) {
                            localStorage.removeItem(key);
                            cleanedCount++;
                        }
                    } catch (error) {
                        // Invalid data, remove it
                        localStorage.removeItem(key);
                        cleanedCount++;
                    }
                }
            }
            
            if (cleanedCount > 0) {
                console.log(`🧹 Cleaned up ${cleanedCount} old pending avatar(s)`);
            }
        } catch (error) {
            console.error('Error cleaning up pending avatars:', error);
        }
    }

    /**
     * Initialize personality system
     */
    async init() {
        try {
            // Load personalities from server
            await this.loadPersonalities();
            
            // Setup UI event listeners
            this.setupEventListeners();
            
            // Only auto-switch on first init if no personality is currently selected
            // This prevents overriding user's manual selection when personalities reload
            if (!this.currentPersonality && this.personalities.length > 0) {
                // Try to restore last saved personality first
                let savedPersonalityId = localStorage.getItem('last_personality_id');
                let personalityToSelect = null;
                
                if (savedPersonalityId) {
                    personalityToSelect = this.personalities.find(p => p.id == savedPersonalityId);
                    if (personalityToSelect) {
                        console.log('🎭 First init - restoring saved personality:', personalityToSelect.displayName);
                    }
                }
                
                // Fall back to default personality if no saved preference
                if (!personalityToSelect) {
                    console.log('🎭 First init - no saved preference, using default personality');
                    personalityToSelect = this.personalities.find(p => p.isDefault) || this.personalities[0];
                }
                
                // Switch to selected personality
                if (personalityToSelect && personalityToSelect.id) {
                    // Pass false for isUserAction since this is automatic init
                    await this.switchPersonality(personalityToSelect.id, false);
                } else {
                    console.warn('No valid personality found to switch to');
                }
            } else if (this.currentPersonality) {
                console.log('🎭 Already have active personality:', this.currentPersonality.displayName, '- not auto-switching');
            } else {
                console.warn('No personalities available on init');
            }
        } catch (error) {
            console.error('Failed to initialize personality system:', error);
            // Fallback to default personality
            this.setFallbackPersonality();
        }
    }

    /**
     * Load personalities from server or localStorage
     */
    async loadPersonalities() {
        try {
            // Try to load from API first
            if (this.apiService.isAuthenticated()) {
                const response = await this.apiService.getPersonalities();

                // Backend returns { personalities, total } or an array in test mode
                if (Array.isArray(response)) {
                    this.personalities = response;
                } else if (response && response.personalities) {
                    this.personalities = response.personalities;
                }

                if (this.personalities && this.personalities.length > 0) {
                    // Clear localStorage cache since we loaded from API successfully
                    console.log('✅ Loaded', this.personalities.length, 'personalities from API');
                    console.log('🧹 Clearing localStorage cache to prevent stale data');
                    localStorage.removeItem('ai_personalities');
                    this.updatePersonalityUI();
                    return;
                }
            }

            // Fallback: try localStorage, then default
            console.log('⚠️ Loading from localStorage fallback');
            const stored = localStorage.getItem('ai_personalities');
            if (stored) {
                this.personalities = JSON.parse(stored);
            } else {
                this.setFallbackPersonality();
            }

            this.updatePersonalityUI();
        } catch (error) {
            console.error('Error loading personalities:', error);
            this.setFallbackPersonality();
        }
    }

    /**
     * Set fallback personality if nothing else works
     */
    setFallbackPersonality() {
        this.personalities = [{
            id: null, // No ID until saved to database
            name: 'assistant',
            displayName: 'AI Assistant',
            description: 'General purpose helpful assistant',
            avatar: '🤖',
            systemPrompt: 'You are a helpful, knowledgeable, and friendly AI assistant.',
            temperature: 0.7,
            maxTokens: 2000,
            isDefault: true
        }];
        this.updatePersonalityUI();
    }

    /**
     * Setup event listeners for personality UI
     */
    setupEventListeners() {
        // Back button - show contacts page
        const backBtn = document.getElementById('backBtn');
        if (backBtn) {
            backBtn.addEventListener('click', () => {
                this.showContactsPage();
            });
        }

        // Add contact button
        const addContactBtn = document.getElementById('addContactBtn');
        if (addContactBtn) {
            addContactBtn.addEventListener('click', () => {
                this.showPersonalityEditor();
            });
        }

        // Avatar click - open editor for current personality
        const avatarElement = document.getElementById('personalityAvatar');
        if (avatarElement) {
            avatarElement.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.currentPersonality) {
                    this.showPersonalityEditor(this.currentPersonality.id);
                }
            });
        }

        // Create personality button
        const createPersonalityBtn = document.getElementById('createPersonalityBtn');
        if (createPersonalityBtn) {
            createPersonalityBtn.addEventListener('click', () => {
                this.showPersonalityEditor();
            });
        }

        // Edit personality button
        const editPersonalityBtn = document.getElementById('editPersonalityBtn');
        if (editPersonalityBtn) {
            editPersonalityBtn.addEventListener('click', () => {
                if (this.currentPersonality) {
                    this.showPersonalityEditor(this.currentPersonality.id);
                }
            });
        }

        // Personality modal controls
        const closePersonalityBtn = document.getElementById('closePersonalityBtn');
        const cancelPersonalityBtn = document.getElementById('cancelPersonalityBtn');
        const savePersonalityBtn = document.getElementById('savePersonalityBtn');
        const deletePersonalityBtn = document.getElementById('deletePersonalityBtn');
        const duplicatePersonalityBtn = document.getElementById('duplicatePersonalityBtn');

        if (closePersonalityBtn) {
            closePersonalityBtn.addEventListener('click', () => this.hidePersonalityEditor());
        }
        if (cancelPersonalityBtn) {
            cancelPersonalityBtn.addEventListener('click', () => this.hidePersonalityEditor());
        }
        if (savePersonalityBtn) {
            savePersonalityBtn.addEventListener('click', () => this.savePersonality());
        }
        if (deletePersonalityBtn) {
            deletePersonalityBtn.addEventListener('click', () => this.deletePersonality());
        }
        if (duplicatePersonalityBtn) {
            duplicatePersonalityBtn.addEventListener('click', () => this.duplicatePersonality());
        }

        // Tab navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Range sliders with value display
        this.setupRangeSlider('personalityTemperature', 'temperatureValue');
        this.setupRangeSlider('personalityTopP', 'topPValue');
        this.setupRangeSlider('personalityPresencePenalty', 'presencePenaltyValue');

        // Avatar generation
        const generateAvatarBtn = document.getElementById('generateAvatarBtn');
        const uploadAvatarBtn = document.getElementById('uploadAvatarBtn');
        const avatarFileInput = document.getElementById('avatarFileInput');
        const useAvatarBtn = document.getElementById('useAvatarBtn');
        const regenerateAvatarBtn = document.getElementById('regenerateAvatarBtn');

        if (generateAvatarBtn) {
            generateAvatarBtn.addEventListener('click', () => this.generateAvatar());
        }
        if (uploadAvatarBtn) {
            uploadAvatarBtn.addEventListener('click', () => avatarFileInput?.click());
        }
        if (avatarFileInput) {
            avatarFileInput.addEventListener('change', (e) => this.handleAvatarUpload(e));
        }
        if (useAvatarBtn) {
            useAvatarBtn.addEventListener('click', () => this.useGeneratedAvatar());
        }
        if (regenerateAvatarBtn) {
            regenerateAvatarBtn.addEventListener('click', () => this.generateAvatar());
        }

        // Avatar input live preview
        const personalityAvatar = document.getElementById('personalityAvatar');
        const currentPersonalityAvatar = document.getElementById('currentPersonalityAvatar');
        if (personalityAvatar && currentPersonalityAvatar) {
            personalityAvatar.addEventListener('input', (e) => {
                currentPersonalityAvatar.textContent = e.target.value || '🤖';
            });
            
            // Make avatar clickable to focus input (better for mobile)
            currentPersonalityAvatar.addEventListener('click', () => {
                personalityAvatar.focus();
                personalityAvatar.select();
            });
        }

        // Personality testing
        const testPersonalityBtn = document.getElementById('testPersonalityBtn');
        const loadSamplePromptsBtn = document.getElementById('loadSamplePromptsBtn');
        
        if (testPersonalityBtn) {
            testPersonalityBtn.addEventListener('click', () => this.testPersonality());
        }
        if (loadSamplePromptsBtn) {
            loadSamplePromptsBtn.addEventListener('click', () => this.loadSamplePrompts());
        }

        // Sample prompt buttons
        document.querySelectorAll('.prompt-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const prompt = e.target.dataset.prompt;
                document.getElementById('testPrompt').value = prompt;
                this.testPersonality();
            });
        });

        // Role-based preset loading
        const personalityRole = document.getElementById('personalityRole');
        if (personalityRole) {
            personalityRole.addEventListener('change', (e) => {
                this.loadRolePreset(e.target.value);
            });
        }
    }

    /**
     * Update personality UI elements
     */
    updatePersonalityUI() {
        const personalityList = document.getElementById('personalityList');
        if (!personalityList) return;

        personalityList.innerHTML = '';

        this.personalities.forEach(personality => {
            const item = document.createElement('div');
            item.className = `personality-item ${this.currentPersonality?.id === personality.id ? 'active' : ''}`;
            
            // Create avatar HTML - use image if avatarUrl exists, otherwise emoji
            const avatarHtml = personality.avatarUrl 
                ? `<img src="${personality.avatarUrl}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" />`
                : (personality.avatar || '🤖');
            
            item.innerHTML = `
                <div class="personality-avatar-small">
                    ${avatarHtml}
                </div>
                <div class="personality-info">
                    <h5>${personality.displayName}</h5>
                    <p>${personality.description || 'No description'}</p>
                </div>
                <div class="personality-actions">
                    <button class="personality-edit-btn" title="Edit Personality" onclick="event.stopPropagation()">✏️</button>
                </div>
            `;
            
            // Add click listener for selecting personality
            item.addEventListener('click', (e) => {
                // Don't switch if clicking on edit button
                if (e.target.classList.contains('personality-edit-btn')) {
                    return;
                }
                this.switchPersonality(personality.id);
                document.getElementById('personalityDropdown').style.display = 'none';
            });

            // Add edit button listener
            const editBtn = item.querySelector('.personality-edit-btn');
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showPersonalityEditor(personality);
            });

            personalityList.appendChild(item);
        });
    }

    /**
     * Switch to a different personality
     * @param {number} personalityId - ID of personality to switch to
     * @param {boolean} isUserAction - Whether this is a manual user action (true) or automatic (false)
     */
    async switchPersonality(personalityId, isUserAction = true) {
        const personality = this.personalities.find(p => p.id === personalityId);
        if (!personality) {
            console.warn(`Personality ${personalityId} not found, cannot switch`);
            return;
        }

        // Stop polling to prevent flickering during chat switch
        if (window.aiChat) {
            console.log('🛑 Stopping polling during personality switch');
            window.aiChat.shouldStopPolling = true;
            window.aiChat.stopMessagePolling();
        }

        this.currentPersonality = personality;

        // Update UI
        const personalityIcon = document.getElementById('personalityIcon');
        const aiAssistantName = document.getElementById('aiAssistantName');
        const personalityAvatarContainer = document.getElementById('personalityAvatar');

        if (personalityIcon) {
            // Display avatar image if available, otherwise use emoji
            if (personality.avatarUrl) {
                personalityIcon.innerHTML = '';
                const img = document.createElement('img');
                img.src = personality.avatarUrl;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '50%';
                personalityIcon.appendChild(img);
            } else {
                personalityIcon.textContent = personality.avatar || '🤖';
            }
        }
        if (aiAssistantName) {
            aiAssistantName.textContent = personality.displayName;
        }
        if (personalityAvatarContainer) {
            personalityAvatarContainer.title = `Current: ${personality.displayName} - Click arrow to switch`;
        }

        // Update personality list active state
        this.updatePersonalityUI();

        // Create new chat for this personality
        await this.createPersonalityChat(personality);

        // Store current personality (always local for app state)
        localStorage.setItem('current_personality', JSON.stringify(personality));
        
        // Save to database and localStorage if this was a user action
        if (isUserAction) {
            localStorage.setItem('last_personality_id', personality.id);
            console.log('💾 Saved personality preference (user action):', personality.id);
            
            // Save to backend for cross-device sync
            if (this.apiService && this.apiService.isAuthenticated()) {
                try {
                    await this.apiService.updateUserSetting('last_personality_id', personality.id);
                    console.log('☁️ Saved personality to cloud:', personality.id);
                } catch (error) {
                    console.error('Failed to save personality to cloud:', error);
                }
            }
        }

        // Notify app of personality change
        window.dispatchEvent(new CustomEvent('personalityChanged', {
            detail: { personality, chatId: this.currentChatId, isUserAction }
        }));
        
        // Restart polling after switch is complete
        if (window.aiChat && this.apiService.isAuthenticated()) {
            console.log('🔄 Restarting polling after personality switch');
            window.aiChat.shouldStopPolling = false;
            // Give a short delay to ensure chat is fully loaded
            setTimeout(() => {
                if (window.aiChat) {
                    window.aiChat.checkForNewMessages();
                }
            }, 500);
        }
    }

    /**
     * Get or create chat for the personality (reuses existing chat)
     */
    async createPersonalityChat(personality) {
        try {
            if (this.apiService.isAuthenticated()) {
                // Only use personalityId if it's a real database ID (small integer < 1000000)
                // localStorage IDs are timestamps (very large numbers)
                const isDbPersonality = personality.id && 
                                       Number.isInteger(personality.id) && 
                                       personality.id > 0 && 
                                       personality.id < 1000000;
                
                if (isDbPersonality) {
                    // Get all chats and find existing chat for this personality
                    const chats = await this.apiService.getChats();
                    const personalityChats = chats.filter(chat => chat.personality_id === personality.id);
                    
                    if (personalityChats.length > 0) {
                        // Use the most recent chat
                        this.currentChatId = personalityChats[0].id;
                        console.log(`♻️ Reusing existing chat ${this.currentChatId} for personality ${personality.displayName}`);
                    } else {
                        // Create new chat only if none exists
                        const chatData = {
                            sessionName: `Chat with ${personality.displayName}`,
                            personalityId: personality.id
                        };
                        const response = await this.apiService.createChatSession(chatData);
                        this.currentChatId = response?.session?.id || `local_chat_${personality.id}_${Date.now()}`;
                        console.log(`✨ Created new chat ${this.currentChatId} for personality ${personality.displayName}`);
                    }
                } else {
                    // Fallback to localStorage chat for non-DB personalities
                    this.currentChatId = `local_chat_${personality.id}_${Date.now()}`;
                }
            } else {
                // Create localStorage-based chat
                this.currentChatId = `local_chat_${personality.id}_${Date.now()}`;
            }
        } catch (error) {
            console.error('Failed to get/create personality chat:', error);
            this.currentChatId = `local_chat_${personality.id}_${Date.now()}`;
        }
    }

    /**
     * Show enhanced personality editor modal
     */
    showPersonalityEditor(personality = null) {
        const modal = document.getElementById('personalityModal');
        const title = document.getElementById('personalityModalTitle');
        const deleteBtn = document.getElementById('deletePersonalityBtn');

        if (!modal) return;

        this.isEditMode = !!personality;
        this.editingPersonality = personality;

        // Set modal title with emoji
        title.textContent = personality ? '🎭 Edit AI Personality' : '🆕 Create New Personality';
        deleteBtn.style.display = personality ? 'flex' : 'none';

        // Reset to basic tab
        this.switchTab('basic');

        // Fill form if editing, otherwise set defaults
        if (personality) {
            this.populatePersonalityForm(personality);
        } else {
            // Set default values for new personality
            this.populatePersonalityForm({
                name: '',
                displayName: '',
                avatar: '🤖',
                description: '',
                role: 'general',
                tags: '',
                systemPrompt: 'You are a helpful AI assistant.',
                personality: 'Helpful, friendly, knowledgeable',
                tone: 'friendly',
                verbosity: 'balanced',
                expertise: '',
                color: 'blue',
                temperature: 0.7,
                topP: 0.9,
                maxTokens: 2000,
                presencePenalty: 0,
                codeMode: false,
                creativeMode: false,
                analyticalMode: false,
                memoryContext: 'medium'
            });
        }

        // Check for pending avatar in localStorage
        const personalityId = personality?.id || 'temp';
        const avatarKey = `pending_avatar_${personalityId}`;
        const generatingKey = `avatar_generating_${personalityId}`;
        const pendingAvatar = localStorage.getItem(avatarKey);
        const generatingData = localStorage.getItem(generatingKey);
        
        const avatarPreview = document.getElementById('avatarPreview');
        const generatedAvatarImg = document.getElementById('generatedAvatarImg');
        
        // Check if there's a generation that was interrupted
        if (generatingData && !pendingAvatar) {
            try {
                const genData = JSON.parse(generatingData);
                const ageInMinutes = (Date.now() - genData.timestamp) / (1000 * 60);
                
                // If generation was started recently (< 10 minutes) and no result exists
                if (ageInMinutes < 10) {
                    // Show a message that generation may have been interrupted
                    const messageDiv = document.createElement('div');
                    messageDiv.style.cssText = 'padding: 12px; background: #ff9800; color: white; border-radius: 8px; margin: 10px 0; font-size: 14px;';
                    messageDiv.innerHTML = `⚠️ Avatar generation was interrupted ${ageInMinutes.toFixed(0)} minutes ago. You'll need to regenerate it since you left the page during generation.`;
                    
                    const avatarSection = document.getElementById('avatarPreview')?.parentElement;
                    if (avatarSection) {
                        avatarSection.insertBefore(messageDiv, avatarSection.firstChild);
                    }
                    
                    // Restore the prompt so they can easily regenerate
                    const avatarPromptInput = document.getElementById('avatarPrompt');
                    if (avatarPromptInput && genData.prompt) {
                        avatarPromptInput.value = genData.prompt;
                    }
                } 
                
                // Clean up old generation marker
                localStorage.removeItem(generatingKey);
            } catch (error) {
                console.error('Error checking generation status:', error);
                localStorage.removeItem(generatingKey);
            }
        }
        
        if (pendingAvatar) {
            try {
                const avatarData = JSON.parse(pendingAvatar);
                // Check if avatar is less than 24 hours old
                const ageInHours = (Date.now() - avatarData.timestamp) / (1000 * 60 * 60);
                
                if (ageInHours < 24) {
                    // Restore the avatar
                    this.generatedAvatarData = avatarData.imageData;
                    
                    if (generatedAvatarImg) {
                        generatedAvatarImg.src = avatarData.imageData;
                        generatedAvatarImg.style.display = 'block';
                    }
                    
                    if (avatarPreview) {
                        avatarPreview.style.display = 'block';
                    }
                    
                    // Restore the prompt
                    const avatarPromptInput = document.getElementById('avatarPrompt');
                    if (avatarPromptInput && avatarData.prompt) {
                        avatarPromptInput.value = avatarData.prompt;
                    }
                    
                    console.log('✅ Restored pending avatar from localStorage (age:', ageInHours.toFixed(1), 'hours)');
                } else {
                    // Avatar is too old, remove it
                    localStorage.removeItem(avatarKey);
                    console.log('🗑️ Removed stale avatar (age:', ageInHours.toFixed(1), 'hours)');
                    
                    if (avatarPreview) {
                        avatarPreview.style.display = 'none';
                    }
                }
            } catch (error) {
                console.error('Error restoring pending avatar:', error);
                localStorage.removeItem(avatarKey);
                
                if (avatarPreview) {
                    avatarPreview.style.display = 'none';
                }
            }
        } else {
            // No pending avatar, hide preview
            if (avatarPreview) {
                avatarPreview.style.display = 'none';
            }
        }

        // Reset test response
        const testResponse = document.getElementById('testResponse');
        if (testResponse) {
            testResponse.style.display = 'none';
        }

        // Show modal
        modal.style.display = 'flex';
        modal.classList.add('show');

        // Close personality dropdown if open
        const personalityDropdown = document.getElementById('personalityDropdown');
        if (personalityDropdown) {
            personalityDropdown.style.display = 'none';
        }
    }

    /**
     * Hide personality editor modal
     */
    hidePersonalityEditor() {
        const modal = document.getElementById('personalityModal');
        if (modal) {
            modal.style.display = 'none';
            modal.classList.remove('show');
        }
        this.editingPersonality = null;
        this.isEditMode = false;
        this.currentTab = 'basic';
        this.generatedAvatarData = null;
    }

    /**
     * Save personality changes
     */
    async savePersonality() {
        // Get all personality data from form
        const personalityData = this.getPersonalityDataFromForm();

        // Validation
        if (!personalityData.name?.trim() || !personalityData.displayName?.trim()) {
            alert('Name and Display Name are required');
            return;
        }

        // Check for duplicate names (excluding current personality if editing)
        const existingPersonality = this.personalities.find(p => 
            p.name === personalityData.name && 
            (!this.editingPersonality || p.id !== this.editingPersonality.id)
        );

        if (existingPersonality) {
            alert('A personality with this name already exists. Please choose a different name.');
            return;
        }

        // Create complete personality object
        const completePersonality = {
            ...personalityData,
            // Use existing ID when editing, null for new (backend will assign)
            id: this.editingPersonality ? this.editingPersonality.id : null,
            isDefault: this.editingPersonality ? this.editingPersonality.isDefault : false,
            createdAt: this.editingPersonality ? this.editingPersonality.createdAt : new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        try {
            if (this.editingPersonality) {
                // Update existing personality
                const index = this.personalities.findIndex(p => p.id === this.editingPersonality.id);
                if (index !== -1) {
                    this.personalities[index] = completePersonality;
                }

                // Persist update to server when authenticated
                if (this.apiService.isAuthenticated()) {
                    try {
                        const payload = {
                            name: completePersonality.name,
                            displayName: completePersonality.displayName,
                            description: completePersonality.description,
                            systemPrompt: completePersonality.systemPrompt,
                            temperature: completePersonality.temperature,
                            maxTokens: completePersonality.maxTokens,
                            personalityTraits: completePersonality.personalityTraits,
                            speakingStyle: completePersonality.speakingStyle,
                            gender: completePersonality.gender,
                            age: completePersonality.age,
                            ethnicity: completePersonality.ethnicity,
                            height: completePersonality.height,
                            build: completePersonality.build,
                            breastSize: completePersonality.breastSize,
                            hairType: completePersonality.hairType,
                            hairColor: completePersonality.hairColor,
                            eyeColor: completePersonality.eyeColor,
                            avatarUrl: completePersonality.avatarUrl
                        };
                        await this.apiService.updatePersonality(this.editingPersonality.id, payload);
                    } catch (err) {
                        console.warn('Failed to persist personality update, saved locally instead', err);
                    }
                }
            } else {
                // Create new personality
                if (this.apiService.isAuthenticated()) {
                    // Persist to server and use server-assigned integer ID
                    try {
                        const payload = {
                            name: completePersonality.name,
                            displayName: completePersonality.displayName,
                            description: completePersonality.description,
                            systemPrompt: completePersonality.systemPrompt,
                            temperature: completePersonality.temperature,
                            maxTokens: completePersonality.maxTokens,
                            personalityTraits: completePersonality.personalityTraits,
                            speakingStyle: completePersonality.speakingStyle,
                            gender: completePersonality.gender,
                            age: completePersonality.age,
                            ethnicity: completePersonality.ethnicity,
                            height: completePersonality.height,
                            build: completePersonality.build,
                            breastSize: completePersonality.breastSize,
                            hairType: completePersonality.hairType,
                            hairColor: completePersonality.hairColor,
                            eyeColor: completePersonality.eyeColor,
                            avatarUrl: completePersonality.avatarUrl
                        };
                        const res = await this.apiService.createPersonality(payload);
                        // Backend returns { personality: { id, ... } }
                        const created = res && (res.personality || res);
                        if (created && created.id) {
                            completePersonality.id = created.id;
                        }
                        this.personalities.push(completePersonality);
                    } catch (err) {
                        console.warn('Failed to persist new personality, saving locally', err);
                        this.personalities.push(completePersonality);
                    }
                } else {
                    // Not authenticated: save locally
                    this.personalities.push(completePersonality);
                }
            }

            // Save to localStorage fallback
            await this.savePersonalities();
            
            // Clear pending avatar from localStorage since it's now saved
            const avatarKey = `pending_avatar_${completePersonality.id}`;
            localStorage.removeItem(avatarKey);
            console.log('🗑️ Cleared pending avatar from localStorage after save');
            
            // Update UI and close modal
            this.updatePersonalityUI();
            this.hidePersonalityEditor();
            
            // If we just updated the currently active personality, refresh the header display
            if (this.currentPersonality && completePersonality.id === this.currentPersonality.id) {
                // Update current personality reference with new data
                this.currentPersonality = completePersonality;
                
                // Update header avatar display
                const personalityIcon = document.getElementById('personalityIcon');
                if (personalityIcon && completePersonality.avatarUrl) {
                    personalityIcon.innerHTML = '';
                    const img = document.createElement('img');
                    img.src = completePersonality.avatarUrl;
                    img.style.width = '100%';
                    img.style.height = '100%';
                    img.style.objectFit = 'cover';
                    img.style.borderRadius = '50%';
                    personalityIcon.appendChild(img);
                }
                
                // Also notify app.js to update if needed
                window.dispatchEvent(new CustomEvent('personalityUpdated', { 
                    detail: { personality: completePersonality } 
                }));
            }
            
            // Show success message
            const action = this.editingPersonality ? 'updated' : 'created';
            console.log(`✅ Personality "${completePersonality.displayName}" ${action} successfully`);
            
        } catch (error) {
            console.error('Failed to save personality:', error);
            alert('Failed to save personality. Please try again.');
        }
    }

    /**
     * Delete personality
     */
    async deletePersonality() {
        if (!this.editingPersonality) return;

        if (!confirm(`Delete personality "${this.editingPersonality.displayName}"?`)) {
            return;
        }

        try {
            // Delete from server if authenticated
            if (this.apiService.isAuthenticated()) {
                console.log('🗑️ Deleting personality from server:', this.editingPersonality.id);
                await this.apiService.deletePersonality(this.editingPersonality.id);
                
                // Reload personalities from server to get fresh data
                console.log('🔄 Reloading personalities from server...');
                await this.loadPersonalities();
                
                // Switch to default personality if we deleted the current one
                if (this.currentPersonality?.id === this.editingPersonality.id) {
                    const defaultPersonality = this.personalities.find(p => p.isDefault) || this.personalities[0];
                    if (defaultPersonality) {
                        await this.switchPersonality(defaultPersonality.id);
                    }
                }
            } else {
                // Fallback for non-authenticated mode
                this.personalities = this.personalities.filter(p => p.id !== this.editingPersonality.id);
                await this.savePersonalities();
                
                if (this.currentPersonality?.id === this.editingPersonality.id) {
                    const defaultPersonality = this.personalities.find(p => p.isDefault) || this.personalities[0];
                    if (defaultPersonality) {
                        await this.switchPersonality(defaultPersonality.id);
                    }
                }
                
                this.updatePersonalityUI();
            }
            
            this.hidePersonalityEditor();
            console.log('✅ Personality deleted successfully');
        } catch (error) {
            console.error('❌ Failed to delete personality:', error);
            alert(`Failed to delete personality: ${error.message}`);
        }
    }

    /**
     * Save personalities to server or localStorage
     */
    async savePersonalities() {
        try {
            if (this.apiService.isAuthenticated()) {
                // When authenticated, personalities are saved via API calls (create/update/delete)
                // Don't save to localStorage to avoid cache conflicts
                console.log('Skipping localStorage save - using API for personality management');
            } else {
                // Save to localStorage only when not authenticated
                localStorage.setItem('ai_personalities', JSON.stringify(this.personalities));
            }
        } catch (error) {
            console.error('Failed to save personalities:', error);
            throw error;
        }
    }

    /**
     * Get current personality
     */
    getCurrentPersonality() {
        return this.currentPersonality;
    }

    /**
     * Get current chat ID
     */
    getCurrentChatId() {
        return this.currentChatId;
    }
    /**
     * Setup range slider with value display
     */
    setupRangeSlider(sliderId, valueId) {
        const slider = document.getElementById(sliderId);
        const value = document.getElementById(valueId);
        if (slider && value) {
            slider.addEventListener('input', (e) => {
                value.textContent = e.target.value;
            });
        }
    }

    /**
     * Switch between tabs in personality modal
     */
    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });
        
        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === `${tabName}-tab`);
        });
        
        this.currentTab = tabName;
    }

    /**
     * Generate AI avatar using image generation service
     */
    async generateAvatar() {
        const prompt = document.getElementById('avatarPrompt').value;
        const style = document.getElementById('avatarStyle').value;
        const size = document.getElementById('avatarSize').value;
        
        if (!prompt.trim()) {
            alert('Please enter an avatar description');
            return;
        }

        const generateBtn = document.getElementById('generateAvatarBtn');
        generateBtn.disabled = true;
        generateBtn.textContent = 'Generating...';

        try {
            const personalityId = this.editingPersonality?.id;
            const enhancedPrompt = `${prompt}, ${style} style, avatar portrait, clean background, high quality, digital art`;
            
            // If we have a saved personality (has DB ID), use queued generation
            if (personalityId && this.apiService.isAuthenticated()) {
                console.log('🎭 Using queued avatar generation for personality', personalityId);
                
                // Start queued generation
                const result = await this.apiService.generateAvatarQueued(personalityId, enhancedPrompt);
                console.log('📡 Avatar generation job queued:', result.jobId);
                
                // Show status message
                generateBtn.textContent = 'Generating in background...';
                
                // Start polling for completion
                this.pollAvatarStatus(personalityId, result.jobId, generateBtn);
                
                return; // Exit early, polling will handle the rest
            }
            
            // Fallback: Use direct generation for unsaved personalities
            console.log('🔄 Using direct generation (personality not yet saved)');
            if (window.aiChat && window.aiChat.generateImage) {
                console.log('📸 Generating avatar via aiChat.generateImage...');
                
                const result = await window.aiChat.generateImage(enhancedPrompt);
                
                // Extract image data from result object
                const imageData = result?.content || result;
                
                if (imageData) {
                    const avatarPreview = document.getElementById('avatarPreview');
                    const generatedAvatarImg = document.getElementById('generatedAvatarImg');
                    
                    console.log('🖼️ Setting avatar preview:', {
                        hasPreview: !!avatarPreview,
                        hasImg: !!generatedAvatarImg,
                        dataLength: imageData?.length,
                        dataPrefix: imageData?.substring(0, 50)
                    });
                    
                    if (generatedAvatarImg) {
                        generatedAvatarImg.src = imageData;
                        generatedAvatarImg.style.display = 'block';
                        generatedAvatarImg.style.maxWidth = '100%';
                        generatedAvatarImg.style.height = 'auto';
                        console.log('✅ Image src set, dimensions:', {
                            width: generatedAvatarImg.width,
                            height: generatedAvatarImg.height,
                            naturalWidth: generatedAvatarImg.naturalWidth,
                            naturalHeight: generatedAvatarImg.naturalHeight
                        });
                    }
                    
                    if (avatarPreview) {
                        avatarPreview.style.display = 'block';
                    }
                    
                    this.generatedAvatarData = imageData;
                    
                    // Store in localStorage for persistence across page navigation
                    const personalityId = this.editingPersonality?.id || 'temp';
                    const avatarKey = `pending_avatar_${personalityId}`;
                    const avatarData = {
                        imageData: imageData,
                        timestamp: Date.now(),
                        prompt: prompt
                    };
                    localStorage.setItem(avatarKey, JSON.stringify(avatarData));
                    console.log('💾 Saved generated avatar to localStorage for later retrieval');
                    
                    console.log('✅ Avatar generated successfully');
                } else {
                    throw new Error('No image data returned');
                }
            } else {
                throw new Error('Image generation not available - please ensure AI Chat is initialized');
            }
        } catch (error) {
            console.error('Avatar generation error:', error);
            alert(`Avatar generation failed: ${error.message}`);
        } finally {
            generateBtn.disabled = false;
            generateBtn.textContent = '🎨 Generate Avatar';
        }
    }

    /**
     * Poll for avatar generation completion
     */
    async pollAvatarStatus(personalityId, jobId, generateBtn) {
        const maxAttempts = 60; // Poll for up to 5 minutes
        let attempts = 0;
        
        const checkStatus = async () => {
            attempts++;
            
            try {
                const status = await this.apiService.getAvatarStatus(personalityId);
                
                console.log(`🔍 Avatar status check ${attempts}/${maxAttempts}:`, status);
                
                if (status.status === 'completed' && status.avatarUrl) {
                    // Avatar generation completed!
                    console.log('✅ Avatar generation completed!');
                    
                    // Display the avatar
                    const avatarPreview = document.getElementById('avatarPreview');
                    const generatedAvatarImg = document.getElementById('generatedAvatarImg');
                    
                    if (generatedAvatarImg) {
                        generatedAvatarImg.src = status.avatarUrl;
                        generatedAvatarImg.style.display = 'block';
                    }
                    
                    if (avatarPreview) {
                        avatarPreview.style.display = 'block';
                    }
                    
                    // Store for later use
                    this.generatedAvatarData = status.avatarUrl;
                    
                    // Update button
                    generateBtn.disabled = false;
                    generateBtn.textContent = '🎉 Avatar Generated!';
                    
                    setTimeout(() => {
                        generateBtn.textContent = '🎨 Generate Avatar';
                    }, 3000);
                    
                    return; // Stop polling
                } else if (status.status === 'failed') {
                    throw new Error(status.error || 'Avatar generation failed');
                } else if (status.status === 'generating' || status.status === 'pending') {
                    // Still generating, continue polling
                    if (attempts < maxAttempts) {
                        setTimeout(checkStatus, 5000); // Check every 5 seconds
                    } else {
                        throw new Error('Avatar generation timed out');
                    }
                } else {
                    // No generation in progress
                    generateBtn.disabled = false;
                    generateBtn.textContent = '🎨 Generate Avatar';
                }
            } catch (error) {
                console.error('Error checking avatar status:', error);
                generateBtn.disabled = false;
                generateBtn.textContent = '🎨 Generate Avatar';
                alert(`Avatar generation error: ${error.message}`);
            }
        };
        
        // Start polling after 5 seconds (give generation time to start)
        setTimeout(checkStatus, 5000);
    }

    /**
     * Handle avatar file upload
     */
    async handleAvatarUpload(event) {
        const file = event.target.files[0];
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            alert('Please select an image file');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const avatarPreview = document.getElementById('avatarPreview');
            const generatedAvatarImg = document.getElementById('generatedAvatarImg');
            
            generatedAvatarImg.src = e.target.result;
            avatarPreview.style.display = 'block';
            
            // Store the full data URL for storage
            this.generatedAvatarData = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    /**
     * Use the generated/uploaded avatar
     */
    useGeneratedAvatar() {
        if (this.generatedAvatarData) {
            const personalityAvatar = document.getElementById('personalityAvatar');
            const currentPersonalityAvatar = document.getElementById('currentPersonalityAvatar');
            
            console.log('📸 Applying avatar:', {
                hasPersonalityAvatar: !!personalityAvatar,
                hasCurrentPersonalityAvatar: !!currentPersonalityAvatar,
                dataLength: this.generatedAvatarData?.length
            });
            
            // Store the full base64 data URL in dataset
            personalityAvatar.dataset.avatarUrl = this.generatedAvatarData;
            
            // Update the current avatar preview
            if (currentPersonalityAvatar) {
                currentPersonalityAvatar.innerHTML = '';
                const img = document.createElement('img');
                img.src = this.generatedAvatarData;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '50%';
                currentPersonalityAvatar.appendChild(img);
                console.log('✅ Avatar image added to currentPersonalityAvatar');
            } else {
                console.warn('⚠️ currentPersonalityAvatar element not found!');
            }
            
            // Keep preview visible so user can see the applied avatar
            // (Don't hide it - let them see what they just applied)
            
            console.log('✅ Avatar applied to personality form');
            
            // Note: Don't clear localStorage yet - only clear when personality is saved
        } else {
            console.warn('⚠️ No generated avatar data available');
        }
    }

    /**
     * Test personality with sample prompt
     */
    async testPersonality() {
        const testPrompt = document.getElementById('testPrompt').value;
        if (!testPrompt.trim()) {
            alert('Please enter a test prompt');
            return;
        }

        const testBtn = document.getElementById('testPersonalityBtn');
        testBtn.disabled = true;
        testBtn.textContent = 'Testing...';

        try {
            // Get current personality settings from form
            const personalityData = this.getPersonalityDataFromForm();
            
            const response = await this.apiService.request('/api/localai/v1/chat/completions', 'POST', {
                model: "gpt-4",
                messages: [
                    { role: "system", content: personalityData.systemPrompt || "You are a helpful AI assistant." },
                    { role: "user", content: testPrompt }
                ],
                temperature: parseFloat(personalityData.temperature || 0.7),
                max_tokens: parseInt(personalityData.maxTokens || 2000)
            });

            if (response.choices && response.choices[0]) {
                const testResponse = document.getElementById('testResponse');
                const responseContent = document.getElementById('responseContent');
                
                responseContent.textContent = response.choices[0].message.content;
                testResponse.style.display = 'block';
                
                // Update analytics
                this.updatePersonalityAnalytics(response.choices[0].message.content);
            } else {
                alert('No response received from AI');
            }
        } catch (error) {
            console.error('Personality test error:', error);
            alert('Test failed. Please check your settings and try again.');
        } finally {
            testBtn.disabled = false;
            testBtn.textContent = '🧪 Test Response';
        }
    }

    /**
     * Load sample prompts for testing
     */
    loadSamplePrompts() {
        const samplePrompts = [
            "Hello! Can you introduce yourself?",
            "What are your main strengths and capabilities?",
            "How do you approach problem-solving?",
            "Write a creative short story about a day in your life",
            "Explain a complex technical concept in simple terms",
            "What's your opinion on the future of AI?",
            "Help me brainstorm ideas for a creative project",
            "How do you handle difficult or sensitive questions?"
        ];
        
        const randomPrompt = samplePrompts[Math.floor(Math.random() * samplePrompts.length)];
        document.getElementById('testPrompt').value = randomPrompt;
    }

    /**
     * Update personality analytics based on response
     */
    updatePersonalityAnalytics(response) {
        const avgResponseLength = document.getElementById('avgResponseLength');
        const creativityScore = document.getElementById('creativityScore');
        const technicalScore = document.getElementById('technicalScore');
        const friendlinessScore = document.getElementById('friendlinessScore');
        
        // Simple analytics calculations
        avgResponseLength.textContent = response.length + ' chars';
        
        // Creative words indicator
        const creativeWords = ['imagine', 'creative', 'unique', 'innovative', 'artistic'].length;
        creativityScore.textContent = Math.min(100, Math.floor((response.match(/imagine|creative|unique|innovative|artistic/gi) || []).length * 20)) + '%';
        
        // Technical words indicator
        technicalScore.textContent = Math.min(100, Math.floor((response.match(/algorithm|technical|system|code|data|analysis/gi) || []).length * 15)) + '%';
        
        // Friendliness indicator
        friendlinessScore.textContent = Math.min(100, Math.floor((response.match(/please|thank|help|happy|great|wonderful/gi) || []).length * 10)) + '%';
    }

    /**
     * Load role-based presets
     */
    loadRolePreset(role) {
        const presets = {
            girlfriend: {
                systemPrompt: "You are a loving, caring girlfriend who enjoys spending time chatting and connecting. You're affectionate, supportive, and genuinely interested in your partner's life, thoughts, and feelings.",
                personality: "Affectionate, caring, playful, supportive, warm",
                expertise: "Emotional support, conversation, romance, companionship"
            },
            companion: {
                systemPrompt: "You are a close companion who values deep connection and meaningful conversations. You're always there to listen, share experiences, and provide comfort.",
                personality: "Understanding, loyal, empathetic, thoughtful, genuine",
                expertise: "Deep conversations, emotional support, companionship, sharing experiences"
            },
            friend: {
                systemPrompt: "You are a close friend who loves hanging out and having great conversations. You're fun to talk to, supportive, and always interested in what's going on.",
                personality: "Friendly, fun, supportive, easygoing, trustworthy",
                expertise: "Conversation, friendship, support, fun activities, advice"
            },
            romantic: {
                systemPrompt: "You are a romantic partner who expresses love and affection naturally. You enjoy intimate conversations, expressing feelings, and creating special moments together.",
                personality: "Romantic, passionate, affectionate, attentive, loving",
                expertise: "Romance, emotional connection, intimacy, relationship building"
            },
            confidant: {
                systemPrompt: "You are a trusted confidant who provides a safe space for sharing thoughts and feelings. You listen without judgment and offer thoughtful insights.",
                personality: "Trustworthy, discreet, understanding, wise, supportive",
                expertise: "Active listening, advice, emotional support, problem-solving"
            },
            flirty: {
                systemPrompt: "You are a playful, flirty friend who keeps conversations fun and engaging with lighthearted teasing and charm.",
                personality: "Flirty, playful, charming, witty, fun",
                expertise: "Flirtation, banter, playful conversation, humor"
            },
            supportive: {
                systemPrompt: "You are a supportive partner who provides encouragement, comfort, and strength. You celebrate successes and offer comfort during challenges.",
                personality: "Supportive, encouraging, patient, understanding, caring",
                expertise: "Emotional support, motivation, encouragement, problem-solving"
            },
            playful: {
                systemPrompt: "You are a playful companion who keeps things light and fun. You enjoy jokes, games, and making every conversation entertaining.",
                personality: "Playful, energetic, humorous, spontaneous, cheerful",
                expertise: "Fun conversations, humor, games, entertainment, lightheartedness"
            },
            caring: {
                systemPrompt: "You are a caring friend who shows genuine concern and warmth. You're attentive to feelings and always ready to offer comfort and care.",
                personality: "Caring, gentle, nurturing, kind, compassionate",
                expertise: "Emotional care, comfort, kindness, support, understanding"
            },
            general: {
                systemPrompt: "You are a friendly person who enjoys good conversations about anything and everything. You're easygoing, interesting, and fun to talk to.",
                personality: "Professional, strategic, results-oriented, practical, confident",
                expertise: "Business strategy, management, planning, analysis, consulting"
            },
            teacher: {
                systemPrompt: "You are an educational AI tutor. You explain concepts clearly, adapt to different learning styles, and help students understand complex topics.",
                personality: "Patient, encouraging, clear, supportive, educational",
                expertise: "Teaching, explanation, education, learning, mentorship"
            },
            therapist: {
                systemPrompt: "You are a supportive AI counselor. You listen empathetically, provide emotional support, and help users work through challenges with care and understanding.",
                personality: "Empathetic, supportive, understanding, caring, non-judgmental",
                expertise: "Emotional support, active listening, guidance, wellness"
            },
            scientist: {
                systemPrompt: "You are a scientific AI researcher. You approach problems with scientific rigor, explain complex concepts clearly, and help with research and analysis.",
                personality: "Curious, methodical, evidence-based, precise, inquisitive",
                expertise: "Scientific research, analysis, experimentation, data interpretation"
            },
            artist: {
                systemPrompt: "You are an artistic AI assistant. You appreciate and understand various art forms, help with creative projects, and provide artistic inspiration.",
                personality: "Creative, expressive, imaginative, aesthetic, inspiring",
                expertise: "Visual arts, design, creativity, aesthetics, artistic techniques"
            }
        };

        const preset = presets[role];
        if (preset && role !== 'custom') {
            document.getElementById('personalitySystemPrompt').value = preset.systemPrompt;
            document.getElementById('personalityPersonality').value = preset.personality;
            document.getElementById('personalityExpertise').value = preset.expertise;
        }
    }

    /**
     * Duplicate current personality
     */
    async duplicatePersonality() {
        if (!this.editingPersonality) return;

        const newPersonality = {
            ...this.editingPersonality,
            id: Date.now(),
            name: this.editingPersonality.name + '_copy',
            displayName: this.editingPersonality.displayName + ' (Copy)'
        };

        this.personalities.push(newPersonality);
        await this.savePersonalities();
        this.updatePersonalityUI();
        
        // Edit the new copy
        this.showPersonalityEditor(newPersonality);
    }

    /**
     * Get personality data from form fields
     */
    getPersonalityDataFromForm() {
        const displayName = document.getElementById('personalityDisplayName')?.value || 'AI Assistant';
        
        // Auto-generate internal name from display name
        const name = displayName.toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '')
            .substring(0, 50) || 'assistant';
        
        // Get avatar URL from dataset if available (generated avatar)
        const avatarInput = document.getElementById('personalityAvatar');
        const avatarUrl = avatarInput?.dataset?.avatarUrl || null;
        
        return {
            name: name,
            displayName: displayName,
            description: document.getElementById('personalityDescription')?.value,
            avatar: avatarInput?.value || '🤖',
            avatarUrl: avatarUrl,
            role: document.getElementById('personalityRole')?.value,
            tags: document.getElementById('personalityTags')?.value,
            systemPrompt: document.getElementById('personalitySystemPrompt')?.value,
            personality: document.getElementById('personalityPersonality')?.value,
            tone: document.getElementById('personalityTone')?.value,
            verbosity: document.getElementById('personalityVerbosity')?.value,
            expertise: document.getElementById('personalityExpertise')?.value,
            color: document.getElementById('personalityColor')?.value,
            temperature: document.getElementById('personalityTemperature')?.value,
            topP: document.getElementById('personalityTopP')?.value,
            maxTokens: document.getElementById('personalityMaxTokens')?.value,
            presencePenalty: document.getElementById('personalityPresencePenalty')?.value,
            codeMode: document.getElementById('personalityCodeMode')?.checked,
            creativeMode: document.getElementById('personalityCreativeMode')?.checked,
            analyticalMode: document.getElementById('personalityAnalyticalMode')?.checked,
            memoryContext: document.getElementById('personalityMemoryContext')?.value,
            // Physical appearance fields
            gender: document.getElementById('personalityGender')?.value,
            age: document.getElementById('personalityAge')?.value,
            ethnicity: document.getElementById('personalityEthnicity')?.value,
            height: document.getElementById('personalityHeight')?.value,
            build: document.getElementById('personalityBuild')?.value,
            breastSize: document.getElementById('personalityBreastSize')?.value,
            hairType: document.getElementById('personalityHairType')?.value,
            hairColor: document.getElementById('personalityHairColor')?.value,
            eyeColor: document.getElementById('personalityEyeColor')?.value,
            personalityTraits: document.getElementById('personalityPersonality')?.value,
            speakingStyle: document.getElementById('personalityTone')?.value
        };
    }

    /**
     * Populate form fields with personality data
     */
    populatePersonalityForm(personality) {
        document.getElementById('personalityName').value = personality.name || '';
        document.getElementById('personalityDisplayName').value = personality.displayName || '';
        document.getElementById('personalityDescription').value = personality.description || '';
        const avatarInput = document.getElementById('personalityAvatar');
        avatarInput.value = personality.avatar || '🤖';
        
        // Store avatarUrl in dataset if it exists
        if (personality.avatarUrl) {
            avatarInput.dataset.avatarUrl = personality.avatarUrl;
            
            // Display the avatar image in the preview
            const currentPersonalityAvatar = document.getElementById('currentPersonalityAvatar');
            if (currentPersonalityAvatar) {
                currentPersonalityAvatar.innerHTML = '';
                const img = document.createElement('img');
                img.src = personality.avatarUrl;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '50%';
                currentPersonalityAvatar.appendChild(img);
            }
        } else {
            delete avatarInput.dataset.avatarUrl;
        }
        document.getElementById('personalityRole').value = personality.role || 'general';
        document.getElementById('personalityTags').value = personality.tags || '';
        document.getElementById('personalitySystemPrompt').value = personality.systemPrompt || '';
        document.getElementById('personalityPersonality').value = personality.personality || personality.personalityTraits || '';
        document.getElementById('personalityTone').value = personality.tone || personality.speakingStyle || 'friendly';
        document.getElementById('personalityVerbosity').value = personality.verbosity || 'balanced';
        document.getElementById('personalityExpertise').value = personality.expertise || '';
        document.getElementById('personalityColor').value = personality.color || 'blue';
        document.getElementById('personalityTemperature').value = personality.temperature || 0.7;
        document.getElementById('personalityTopP').value = personality.topP || 0.9;
        document.getElementById('personalityMaxTokens').value = personality.maxTokens || 2000;
        document.getElementById('personalityPresencePenalty').value = personality.presencePenalty || 0;
        document.getElementById('personalityCodeMode').checked = personality.codeMode || false;
        document.getElementById('personalityCreativeMode').checked = personality.creativeMode || false;
        document.getElementById('personalityAnalyticalMode').checked = personality.analyticalMode || false;
        document.getElementById('personalityMemoryContext').value = personality.memoryContext || 'medium';
        
        // Physical appearance fields
        document.getElementById('personalityGender').value = personality.gender || '';
        document.getElementById('personalityAge').value = personality.age || '';
        document.getElementById('personalityEthnicity').value = personality.ethnicity || '';
        document.getElementById('personalityHeight').value = personality.height || '';
        document.getElementById('personalityBuild').value = personality.build || '';
        document.getElementById('personalityBreastSize').value = personality.breastSize || '';
        document.getElementById('personalityHairType').value = personality.hairType || '';
        document.getElementById('personalityHairColor').value = personality.hairColor || '';
        document.getElementById('personalityEyeColor').value = personality.eyeColor || '';

        // Update avatar preview
        document.getElementById('currentPersonalityAvatar').textContent = personality.avatar || '🤖';
        
        // Update slider displays
        document.getElementById('temperatureValue').textContent = personality.temperature || 0.7;
        document.getElementById('topPValue').textContent = personality.topP || 0.9;
        document.getElementById('presencePenaltyValue').textContent = personality.presencePenalty || 0;
    }

    /**
     * Show contacts page and populate with personalities
     */
    showContactsPage() {
        const contactsPage = document.getElementById('contactsPage');
        const chatContainer = document.querySelector('.chat-container');
        const contactsList = document.getElementById('contactsList');
        
        if (!contactsPage || !chatContainer) return;
        
        // Hide chat, show contacts
        chatContainer.style.display = 'none';
        contactsPage.style.display = 'flex';
        
        // Populate contacts list
        contactsList.innerHTML = '';
        
        this.personalities.forEach(personality => {
            const contactItem = document.createElement('div');
            contactItem.className = 'contact-item';
            contactItem.dataset.personalityId = personality.id;
            
            // Create avatar
            const avatar = document.createElement('div');
            avatar.className = 'avatar';
            
            if (personality.avatar_data) {
                const img = document.createElement('img');
                img.src = personality.avatar_data;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '50%';
                avatar.appendChild(img);
            } else {
                avatar.textContent = personality.avatar || '🤖';
            }
            
            // Create details
            const details = document.createElement('div');
            details.className = 'contact-item-details';
            
            const name = document.createElement('div');
            name.className = 'contact-item-name';
            name.textContent = personality.displayName || personality.name || 'Unnamed';
            
            const preview = document.createElement('div');
            preview.className = 'contact-item-preview';
            preview.textContent = personality.description || 'No description';
            
            details.appendChild(name);
            details.appendChild(preview);
            
            contactItem.appendChild(avatar);
            contactItem.appendChild(details);
            
            // Click to switch to this personality and return to chat
            contactItem.addEventListener('click', async () => {
                await this.switchPersonality(personality);
                this.hideContactsPage();
            });
            
            contactsList.appendChild(contactItem);
        });
    }

    /**
     * Hide contacts page and return to chat
     */
    hideContactsPage() {
        const contactsPage = document.getElementById('contactsPage');
        const chatContainer = document.querySelector('.chat-container');
        
        if (!contactsPage || !chatContainer) return;
        
        contactsPage.style.display = 'none';
        chatContainer.style.display = 'flex';
    }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PersonalityManager;
} else {
    window.PersonalityManager = PersonalityManager;
}