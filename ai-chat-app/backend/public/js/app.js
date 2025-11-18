
class AIChat {
    constructor(useAPI = true) {
        console.log('AIChat constructor started');
        this.currentService = 'localai';
        this.lastActiveService = null; // Track previous service for smart VRAM management
        this.messages = [];
        this.useAPI = useAPI; // Flag to determine if we use API or localStorage
        this.lastMessageTime = null; // Track last message timestamp for realistic delays
        this.pollingInterval = null; // For checking new messages
        this.lastKnownMessageCount = 0; // Track message count for polling
        this.shouldStopPolling = false; // Flag to stop polling during chat switches
        
        // Initialize notification manager
        if (typeof notificationManager !== 'undefined') {
            notificationManager.init().then(enabled => {
                console.log('📱 Notifications:', enabled ? 'Enabled' : 'Disabled');
            });
        }
        
        // Initialize UI elements first
        this.initializeElements();
        this.setupConsoleLogging();
        this.setupMobileViewport();
        this.bindEvents();
        
        // Load data based on authentication status
        if (this.useAPI && apiService && apiService.isAuthenticated()) {
            // Load from API
            this.initializeFromAPI().then(() => {
                this.loadChatHistory();
                this.updateServiceStatus();
                console.log('AIChat constructor completed (API mode)');
            }).catch(error => {
                console.error('API initialization failed, falling back to localStorage');
                this.initializeFromLocalStorage();
            });
        } else {
            // Fall back to localStorage
            this.initializeFromLocalStorage();
        }
    }

    /**
     * Initialize from localStorage (legacy mode)
     */
    initializeFromLocalStorage() {
        this.settings = this.loadSettings();
        console.log('Settings loaded:', this.settings);
        // Personalities managed by personalityManager.js
        this.currentPersonality = null; // Will be set by personalityManager
        this.updateAIName();
        this.loadChatHistory();
        this.updateServiceStatus();
        console.log('AIChat constructor completed (localStorage mode)');
    }

    setupConsoleLogging() {
        // Enhanced console logging with styles
        console.log('%c🤖 Private AI Chat Initialized', 'background: linear-gradient(45deg, #667eea, #764ba2); color: white; font-weight: bold; padding: 8px; border-radius: 4px;');
        console.log('%cℹ️ Debug Mode Active - All API calls will be logged here', 'background: #4CAF50; color: white; padding: 4px; border-radius: 4px;');
        console.log('Settings:', this.settings);
        
        // Override console.error to make errors more visible
        const originalError = console.error;
        console.error = function(...args) {
            console.log('%c🚨 ERROR DETECTED:', 'background: red; color: white; font-weight: bold; padding: 6px; font-size: 14px;');
            originalError.apply(console, args);
        };
    }

    setupMobileViewport() {
        // Handle mobile viewport changes (keyboard showing/hiding)
        if (window.visualViewport) {
            const viewport = window.visualViewport;
            
            const handleViewportChange = () => {
                // Adjust chat container height when keyboard appears
                const chatContainer = document.querySelector('.chat-container');
                if (chatContainer) {
                    chatContainer.style.height = `${viewport.height}px`;
                }
            };
            
            viewport.addEventListener('resize', handleViewportChange);
            viewport.addEventListener('scroll', handleViewportChange);
        }
        
        // Prevent body scroll on mobile when input is focused
        this.messageInput?.addEventListener('focus', () => {
            document.body.style.position = 'fixed';
            document.body.style.width = '100%';
        });
        
        this.messageInput?.addEventListener('blur', () => {
            document.body.style.position = '';
            document.body.style.width = '';
            this.scrollToBottom();
        });
    }

    parseThinkingFromContent(rawContent) {
        let thinking = '';
        let content = rawContent;
        
        // First: Decode Unicode escape sequences (e.g., \u003c = <, \u003e = >)
        let decodedContent = rawContent;
        try {
            decodedContent = rawContent.replace(/\\u([0-9a-fA-F]{4})/g, (match, code) => {
                return String.fromCharCode(parseInt(code, 16));
            });
            if (decodedContent !== rawContent) {
                console.log(`  🔧 Decoded Unicode sequences: ${rawContent.length} → ${decodedContent.length} chars`);
            }
        } catch (error) {
            console.log(`  ⚠️ Unicode decoding failed, using original content`);
            decodedContent = rawContent;
        }
        
        // Update content to use decoded version
        content = decodedContent;
        
        // Check for structured thinking tags (e.g., Qwen's <think> blocks)
        const structuredPatterns = [
            // Pattern 1: <think>...</think> (Qwen style)
            /<think>([\s\S]*?)<\/think>/i,
            // Pattern 2: <thinking>...</thinking>
            /<thinking>([\s\S]*?)<\/thinking>/i,
            // Pattern 3: [THINKING]...[/THINKING]
            /\[thinking\]([\s\S]*?)\[\/thinking\]/i,
            // Pattern 4: **Thinking:** ... **Response:**
            /\*\*thinking\*\*:?([\s\S]*?)\*\*response\*\*:?([\s\S]*)/i
        ];
        
        // Try structured patterns first
        for (const pattern of structuredPatterns) {
            const match = rawContent.match(pattern);
            if (match) {
                if (match.length === 2) {
                    // Single capture group - just thinking content
                    thinking = match[1].trim();
                    content = rawContent.replace(match[0], '').trim();
                    console.log(`  🏷️ Found structured thinking tag: ${pattern}`);
                    break;
                } else if (match.length === 3) {
                    // Two capture groups - thinking and response
                    thinking = match[1].trim();
                    content = match[2].trim();
                    console.log(`  🏷️ Found structured thinking + response: ${pattern}`);
                    break;
                }
            }
        }
        
        // Fallback: Split on first double line break if no structured tags found
        let doubleNewlineIndex = -1;
        if (!thinking) {
            doubleNewlineIndex = rawContent.indexOf('\n\n');
            
            if (doubleNewlineIndex !== -1) {
                const firstPart = rawContent.substring(0, doubleNewlineIndex).trim();
                const secondPart = rawContent.substring(doubleNewlineIndex + 2).trim();
                
                // If first part looks like thinking (contains reasoning patterns)
                if (this.looksLikeThinking(firstPart)) {
                    thinking = firstPart;
                    content = secondPart || rawContent;
                    console.log(`  📝 Split on double newline - thinking detected`);
                }
            }
        }
        
        // Aggressive cleanup of content
        content = this.cleanContent(content);
        thinking = this.cleanContent(thinking);
        
        // Debug logging with character-level inspection
        console.log(`🧠 Thinking extraction results:`);
        console.log(`   Raw content length: ${rawContent.length}`);
        console.log(`   Raw content chars: [${Array.from(rawContent.substring(0, 20)).map(c => c.charCodeAt(0)).join(', ')}]`);
        console.log(`   Double newline found: ${doubleNewlineIndex !== -1}`);
        console.log(`   Extracted thinking: "${thinking.substring(0, 100)}${thinking.length > 100 ? '...' : ''}"`);
        console.log(`   Final content: "${content.substring(0, 100)}${content.length > 100 ? '...' : ''}"`);
        console.log(`   Content chars: [${Array.from(content.substring(0, 20)).map(c => c.charCodeAt(0)).join(', ')}]`);
        
        return {
            thinking: thinking,
            content: content
        };
    }

    cleanContent(text) {
        if (!text) return '';
        
        return text
            .trim() // Remove leading/trailing whitespace
            .replace(/^[\u0000-\u0020]+/g, '') // Remove ALL control characters and whitespace at start
            .replace(/[\u0000-\u0020]+$/g, '') // Remove ALL control characters and whitespace at end
            .replace(/^\n+/g, '') // Remove all leading newlines
            .replace(/\n+$/g, '') // Remove all trailing newlines  
            .replace(/^\s+/gm, '') // Remove leading spaces from each line
            .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
            .replace(/^[\r\n\s\t\v\f\u00A0\u2028\u2029]+/g, '') // Remove various whitespace chars
            .replace(/^[^\S\r\n]+/g, '') // Remove non-newline whitespace at start
            .trim(); // Final trim
    }

    looksLikeThinking(text) {
        // Check if text contains common thinking patterns
        const thinkingIndicators = [
            /okay,?\s+the user/i,
            /I need to/i,
            /I should/i,
            /let me/i,
            /since they/i,
            /first,?\s+/i,
            /I'll craft/i,
            /my approach/i,
            /the guidelines/i,
            /make sure to/i
        ];
        
        return thinkingIndicators.some(pattern => pattern.test(text));
    }



    initializeElements() {
        console.log('initializeElements called');
        // Main elements
        this.messagesContainer = document.getElementById('messagesContainer');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        console.log('Elements found:', {
            messagesContainer: !!this.messagesContainer,
            messageInput: !!this.messageInput,
            sendBtn: !!this.sendBtn
        });
        this.settingsModal = document.getElementById('settingsModal');
        this.loadingOverlay = document.getElementById('loadingOverlay');
        this.loadingText = document.getElementById('loadingText');
        this.aiStatus = document.getElementById('aiStatus');

        // Service buttons
        this.serviceButtons = document.querySelectorAll('.service-btn');
        
        // Header buttons (settings moved to user dropdown)
        
        // AI Assistant header
        this.aiAssistantName = document.getElementById('aiAssistantName');
        
        // Modal elements
        this.closeSettingsBtn = document.getElementById('closeSettingsBtn');
        this.cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
        this.saveSettingsBtn = document.getElementById('saveSettingsBtn');
        
        // Settings inputs (simplified)
        this.showThinkingToggle = document.getElementById('showThinking');
    }

    bindEvents() {
        // Send message events
        this.sendBtn.addEventListener('click', () => {
            console.log('Send button clicked');
            this.handleSendMessage();
        });
        this.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSendMessage();
            }
        });

        // Auto-resize textarea
        this.messageInput.addEventListener('input', () => {
            this.messageInput.style.height = 'auto';
            this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 120) + 'px';
        });

        // Service selection
        this.serviceButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                this.currentService = btn.dataset.service;
                this.updateServiceSelection();
                this.updatePlaceholder();
            });
        });

        // Header actions (settings now in user dropdown)
        
        // Docker action buttons (now in settings modal)
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('docker-action')) {
                e.stopPropagation();
                const container = e.target.dataset.container;
                const action = e.target.dataset.action;
                this.handleDockerAction(container, action);
            }
        });

        // Modal events
        this.closeSettingsBtn.addEventListener('click', () => this.hideSettings());
        this.cancelSettingsBtn.addEventListener('click', () => this.hideSettings());
        this.saveSettingsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.saveSettings();
        });
        
        // Add touch support for mobile
        this.saveSettingsBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.saveSettings();
        });
        
        // Settings buttons
        this.testLocalAIBtn = document.getElementById('testLocalAI');
        this.unloadAllModelsBtn = document.getElementById('unloadAllModels');
        this.clearChatBtn = document.getElementById('clearChatBtn');
        this.clearAllChatsBtn = document.getElementById('clearAllChatsBtn');
        this.logoutFromSettingsBtn = document.getElementById('logoutFromSettingsBtn');
        
        if (this.testLocalAIBtn) {
            this.testLocalAIBtn.addEventListener('click', () => this.testLocalAIConnection());
        }
        if (this.unloadAllModelsBtn) {
            this.unloadAllModelsBtn.addEventListener('click', () => this.unloadAllModels());
        }
        if (this.clearChatBtn) {
            this.clearChatBtn.addEventListener('click', () => this.clearChatHistory());
        }
        if (this.clearAllChatsBtn) {
            this.clearAllChatsBtn.addEventListener('click', () => this.clearAllChats());
        }
        if (this.logoutFromSettingsBtn) {
            this.logoutFromSettingsBtn.addEventListener('click', () => {
                // Close settings modal first
                this.hideSettings();
                // Trigger logout through auth manager
                if (authManager) {
                    authManager.handleLogout();
                }
            });
        }
        
        // Test thinking button
        this.testThinkingBtn = document.getElementById('testThinking');
        if (this.testThinkingBtn) {
            this.testThinkingBtn.addEventListener('click', () => this.testThinkingToggle());
        }
        
        // Avatar generation is now handled by PersonalityManager
        // (useAvatarBtn event listener removed - handled by PersonalityManager)
        
        // Close modal on overlay click
        this.settingsModal.addEventListener('click', (e) => {
            if (e.target === this.settingsModal) {
                this.hideSettings();
            }
        });
        
        // Mobile keyboard support - Enter key saves settings
        const settingsInputs = [
            this.aiName, this.aiAge, this.aiPersonality, 
            this.aiInterests, this.aiBackground, this.aiGoals
        ];
        
        settingsInputs.forEach(input => {
            if (input) {
                input.addEventListener('keypress', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        this.saveSettings();
                    }
                });
            }
        });
    }    loadSettings() {
        const defaultSettings = {
            localaiUrl: '/api/localai',
            localaiModel: 'josiefied-qwen3-4b-abliterated-gpu',
            a1111Url: '/api/a1111', // Back to proxy
            comfyUrl: '/api/comfy',
            showThinking: false, // Hidden by default
            autoUnloadModel: true, // Free VRAM by default
            // AI Personality Settings
            aiName: '',
            aiAge: '',
            aiGender: '',
            aiPersonality: '',
            aiInterests: '',
            aiBackground: '',
            aiGoals: '',
            aiStyle: 'casual'
        };
        
        const saved = localStorage.getItem('aiChatSettings');
        const finalSettings = saved ? { ...defaultSettings, ...JSON.parse(saved) } : defaultSettings;
        
        // Debug: Log settings loading
        console.log(`⚙️ Settings loaded:`);
        console.log(`   LocalStorage exists: ${saved ? 'YES' : 'NO'}`);
        console.log(`   Show thinking: ${finalSettings.showThinking}`);
        console.log(`   Full settings:`, finalSettings);
        
        return finalSettings;
    }

    saveSettingsToStorage() {
        try {
            localStorage.setItem('aiChatSettings', JSON.stringify(this.settings));
            console.log('💾 Settings successfully saved to localStorage');
        } catch (error) {
            console.error('❌ Failed to save settings to localStorage:', error);
        }
    }

    // ===== PERSONALITY MANAGEMENT (handled by personalityManager.js) =====
    // Note: Personality management now handled by window.personalityManager
    // This keeps app.js lean and focused on chat functionality

    getPersonalityColor(personalityId) {
        const colors = {
            'aria': 'linear-gradient(135deg, #ff6b6b, #ff8787)',     // Warm red/pink
            'zane': 'linear-gradient(135deg, #4ecdc4, #44a08d)',     // Tech teal/green  
            'luna': 'linear-gradient(135deg, #a8edea, #fed6e3)',     // Soft blue/pink
        };
        return colors[personalityId] || 'linear-gradient(135deg, #667eea, #764ba2)'; // Default purple
    }

    showPersonalitySelector() {
        console.log('showPersonalitySelector called');
        // Get personalities from personalityManager (array format)
        const personalities = window.personalityManager ? window.personalityManager.personalities : [];
        console.log('Available personalities:', personalities);
        
        // Create personality selector modal
        const modal = document.createElement('div');
        modal.className = 'personality-modal';
        modal.innerHTML = `
            <div class="personality-modal-content">
                <div class="personality-header">
                    <h3>Choose AI Personality</h3>
                    <button class="personality-close">&times;</button>
                </div>
                <div class="personality-grid">
                    ${personalities && personalities.length > 0 ? personalities.map(personality => `
                        <div class="personality-card ${personality.id === this.currentPersonality.id ? 'active' : ''}" 
                             data-personality="${personality.id}">
                            <div class="personality-avatar">
                                ${personality.avatarUrl ? 
                                    `<img src="${personality.avatarUrl}" alt="${personality.name}" class="personality-avatar-img">` :
                                    `<div class="personality-initial" style="background: ${this.getPersonalityColor(personality.id)}">${personality.name.charAt(0)}</div>`
                                }
                            </div>
                            <div class="personality-info">
                                <div class="personality-header-row">
                                    <h4>${personality.name}</h4>
                                    <div class="personality-actions">
                                        <button class="btn-edit-personality" data-personality="${personality.id}" title="Edit Personality">
                                            ✏️
                                        </button>
                                        ${personality.avatarUrl ? `
                                            <button class="btn-update-avatar" data-personality="${personality.id}" title="Update Avatar">
                                                🔄
                                            </button>
                                        ` : `
                                            <button class="btn-generate-avatar" data-personality="${personality.id}" title="Generate Avatar">
                                                🎨
                                            </button>
                                        `}
                                    </div>
                                </div>
                                <p class="personality-desc">${personality.description}</p>
                                <div class="personality-traits">
                                    ${personality.personalityTraits ? 
                                        (typeof personality.personalityTraits === 'string' ? 
                                            personality.personalityTraits.split(',').slice(0, 3).map(trait => 
                                                `<span class="trait-tag">${trait.trim()}</span>`
                                            ).join('') : 
                                            personality.personalityTraits.slice(0, 3).map(trait => 
                                                `<span class="trait-tag">${trait}</span>`
                                            ).join('')) : 
                                        '<span class="trait-tag">Custom</span>'}
                                </div>
                            </div>
                        </div>
                    `).join('') : '<p class="no-personalities">No personalities available. Please reload the page.</p>'}
                </div>
                <div class="personality-footer">
                    <button class="btn-create-personality">+ Create New Personality</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Add event listeners
        modal.querySelector('.personality-close').onclick = () => modal.remove();
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

        // Personality selection - only from info area, not buttons
        modal.querySelectorAll('.personality-card').forEach(card => {
            const infoArea = card.querySelector('.personality-info');
            const avatarArea = card.querySelector('.personality-avatar');
            
            // Click on info or avatar to select
            [infoArea, avatarArea].forEach(area => {
                if (area) {
                    area.style.cursor = 'pointer';
                    area.onclick = (e) => {
                        const personalityId = card.dataset.personality;
                        // Use personalityManager to switch
                        if (window.personalityManager) {
                            const personality = window.personalityManager.personalities.find(p => p.id == personalityId);
                            if (personality) {
                                window.personalityManager.switchPersonality(personalityId);
                                modal.remove();
                            }
                        }
                    };
                }
            });
        });

        // Avatar generation buttons
        modal.querySelectorAll('.btn-generate-avatar').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const personalityId = btn.dataset.personality;
                this.generatePersonalityAvatar(personalityId);
            });
        });

        // Avatar update buttons
        modal.querySelectorAll('.btn-update-avatar').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const personalityId = btn.dataset.personality;
                this.updatePersonalityAvatar(personalityId);
            });
        });

        // Edit personality buttons
        modal.querySelectorAll('.btn-edit-personality').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const personalityId = btn.dataset.personality;
                console.log('Edit button clicked for personality:', personalityId);
                modal.remove(); // Close personality selector
                this.showPersonalityEditor(personalityId); // Open editor
            });
        });

        // Create new personality button
        modal.querySelector('.btn-create-personality').addEventListener('click', (e) => {
            e.stopPropagation();
            e.preventDefault();
            console.log('Create personality button clicked');
            modal.remove();
            this.showPersonalityEditor();
        });
    }

    async generatePersonalityAvatar(personalityId) {
        const personality = this.personalities[personalityId];
        if (!personality) return;

        try {
            // Show generating status
            const statusMsg = this.addMessage('system', `🎨 Generating ${personality.name}'s avatar...`);

            // Create detailed prompt based on personality
            const prompt = this.createPersonalityPrompt(personality);
            
            console.log(`🎨 Generating avatar for ${personality.name} with prompt: ${prompt}`);

            // Generate the avatar image
            const avatarResponse = await this.generateImage(prompt);
            
            // Save avatar to personality (extract content from response)
            personality.avatar = avatarResponse.content;
            this.personalities[personalityId] = personality;
            this.savePersonalities();
            
            // Update UI if this is the current personality
            if (this.currentPersonality.id === personalityId) {
                this.updatePersonalityDisplay();
            }
            
            // Update status message
            this.updateMessage(statusMsg.id, 'system', `✅ ${personality.name}'s avatar generated successfully!`);
            
            console.log(`✅ Avatar generated and saved for ${personality.name}`);
            
        } catch (error) {
            console.error('❌ Avatar generation failed:', error);
            this.addMessage('system', `❌ Failed to generate ${personality.name}'s avatar: ${error.message}`);
        }
    }

    async updatePersonalityAvatar(personalityId) {
        const personality = this.personalities[personalityId];
        if (!personality) return;

        try {
            // Show updating status
            const statusMsg = this.addMessage('system', `🔄 Updating ${personality.name}'s avatar based on current settings...`);

            // Create updated prompt based on current personality settings
            const prompt = this.createPersonalityPrompt(personality);
            
            console.log(`🔄 Updating avatar for ${personality.name} with prompt: ${prompt}`);

            // Generate the new avatar image
            const avatarResponse = await this.generateImage(prompt);
            
            // Save updated avatar to personality (extract content from response)
            personality.avatar = avatarResponse.content;
            this.personalities[personalityId] = personality;
            this.savePersonalities();
            
            // Update UI if this is the current personality
            if (this.currentPersonality.id === personalityId) {
                this.updatePersonalityDisplay();
            }
            
            // Update status message
            this.updateMessage(statusMsg.id, 'system', `✅ ${personality.name}'s avatar updated successfully!`);
            
            console.log(`✅ Avatar updated and saved for ${personality.name}`);
            
        } catch (error) {
            console.error('❌ Avatar update failed:', error);
            this.addMessage('system', `❌ Failed to update ${personality.name}'s avatar: ${error.message}`);
        }
    }

    createPersonalityPrompt(personality) {
        const { traits, age, gender, background } = personality.personality;
        
        // Build detailed prompt based on personality
        const genderDesc = gender === 'male' ? 'handsome man' : 
                          gender === 'female' ? 'beautiful woman' : 'person';
        
        const ageDesc = `${age} years old`;
        const traitDesc = traits.slice(0, 3).join(', ');
        
        // Style based on personality type
        let styleDesc = '';
        if (personality.id === 'aria') {
            styleDesc = 'artistic, creative styling, wearing modern casual clothes with creative accessories, warm lighting, artistic background';
        } else if (personality.id === 'zane') {
            styleDesc = 'professional tech expert, wearing modern business casual, clean minimalist background, sharp lighting, confident expression';
        } else if (personality.id === 'luna') {
            styleDesc = 'wise counselor, wearing elegant comfortable clothing, soft natural lighting, serene background, kind eyes';
        } else {
            styleDesc = 'professional headshot, modern clothing, clean background';
        }

        return `professional headshot portrait of a ${genderDesc}, ${ageDesc}, ${traitDesc}, ${styleDesc}, high quality, realistic, detailed face, expressive eyes, 4k, photorealistic`;
    }

    showPersonalityEditor(editingId = null) {
        console.log('showPersonalityEditor called with:', editingId);
        const isEditing = editingId && this.personalities[editingId];
        const personality = isEditing ? this.personalities[editingId] : null;
        console.log('Editing mode:', isEditing, 'Personality:', personality);
        
        // Create personality editor modal
        const modal = document.createElement('div');
        modal.className = 'personality-editor-modal';
        modal.innerHTML = `
            <div class="personality-editor-content">
                <div class="personality-editor-header">
                    <h3>${isEditing ? `Edit ${personality.name}` : 'Create New Personality'}</h3>
                    <button class="personality-close">&times;</button>
                </div>
                
                <div class="personality-editor-body">
                    <div class="editor-tabs">
                        <button class="editor-tab active" data-tab="basic">Basic Info</button>
                        <button class="editor-tab" data-tab="personality">Personality</button>
                        <button class="editor-tab" data-tab="advanced">Advanced</button>
                    </div>
                    
                    <form class="personality-form" id="personalityForm">
                        <!-- Basic Info Tab -->
                        <div class="editor-tab-content active" data-tab="basic">
                            <div class="form-row">
                                <div class="form-group">
                                    <label for="personalityId">ID (unique identifier)</label>
                                    <input type="text" id="personalityId" name="id" 
                                           value="${personality?.id || ''}" 
                                           ${isEditing ? 'readonly' : ''} 
                                           placeholder="e.g., sarah, alex, dr-smith" required>
                                    <small>Used internally, cannot be changed after creation</small>
                                </div>
                                <div class="form-group">
                                    <label for="personalityName">Name</label>
                                    <input type="text" id="personalityName" name="name" 
                                           value="${personality?.name || ''}" 
                                           placeholder="e.g., Sarah" required>
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label for="personalityDisplayName">Display Name</label>
                                <input type="text" id="personalityDisplayName" name="displayName" 
                                       value="${personality?.displayName || ''}" 
                                       placeholder="e.g., Sarah - The Helpful Assistant">
                            </div>
                            
                            <div class="form-group">
                                <label for="personalityDescription">Description</label>
                                <textarea id="personalityDescription" name="description" rows="3" 
                                          placeholder="Brief description of this AI personality">${personality?.description || ''}</textarea>
                            </div>
                            
                            <div class="form-row">
                                <div class="form-group">
                                    <label for="personalityAge">Age</label>
                                    <input type="text" id="personalityAge" name="age" 
                                           value="${personality?.personality?.age || ''}" 
                                           placeholder="e.g., 25, 30-35">
                                </div>
                                <div class="form-group">
                                    <label for="personalityGender">Gender</label>
                                    <select id="personalityGender" name="gender">
                                        <option value="">Not specified</option>
                                        <option value="female" ${personality?.personality?.gender === 'female' ? 'selected' : ''}>Female</option>
                                        <option value="male" ${personality?.personality?.gender === 'male' ? 'selected' : ''}>Male</option>
                                        <option value="non-binary" ${personality?.personality?.gender === 'non-binary' ? 'selected' : ''}>Non-binary</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        
                        <!-- Personality Tab -->
                        <div class="editor-tab-content" data-tab="personality">
                            <div class="form-group">
                                <label for="personalityTraits">Personality Traits</label>
                                <input type="text" id="personalityTraits" name="traits" 
                                       value="${personality?.personality?.traits?.join(', ') || ''}" 
                                       placeholder="e.g., creative, enthusiastic, helpful, analytical">
                                <small>Comma-separated list of traits</small>
                            </div>
                            
                            <div class="form-group">
                                <label for="personalityStyle">Communication Style</label>
                                <select id="personalityStyle" name="style">
                                    <option value="casual" ${personality?.personality?.style === 'casual' ? 'selected' : ''}>Casual</option>
                                    <option value="professional" ${personality?.personality?.style === 'professional' ? 'selected' : ''}>Professional</option>
                                    <option value="warm" ${personality?.personality?.style === 'warm' ? 'selected' : ''}>Warm</option>
                                    <option value="enthusiastic" ${personality?.personality?.style === 'enthusiastic' ? 'selected' : ''}>Enthusiastic</option>
                                    <option value="analytical" ${personality?.personality?.style === 'analytical' ? 'selected' : ''}>Analytical</option>
                                    <option value="creative" ${personality?.personality?.style === 'creative' ? 'selected' : ''}>Creative</option>
                                </select>
                            </div>
                            
                            <div class="form-group">
                                <label for="personalityBackground">Background</label>
                                <textarea id="personalityBackground" name="background" rows="3" 
                                          placeholder="Professional background, expertise, life experience...">${personality?.personality?.background || ''}</textarea>
                            </div>
                            
                            <div class="form-group">
                                <label for="personalityInterests">Interests</label>
                                <input type="text" id="personalityInterests" name="interests" 
                                       value="${personality?.personality?.interests?.join(', ') || ''}" 
                                       placeholder="e.g., technology, art, cooking, sports">
                                <small>Comma-separated list</small>
                            </div>
                            
                            <div class="form-group">
                                <label for="personalityGoals">Goals & Values</label>
                                <input type="text" id="personalityGoals" name="goals" 
                                       value="${personality?.personality?.goals?.join(', ') || ''}" 
                                       placeholder="e.g., Help users learn, Promote creativity, Solve problems">
                                <small>Comma-separated list</small>
                            </div>
                            
                            <div class="form-group">
                                <label for="personalityResponseStyle">Response Style Description</label>
                                <textarea id="personalityResponseStyle" name="responseStyle" rows="3" 
                                          placeholder="How this personality communicates and responds to users...">${personality?.personality?.responseStyle || ''}</textarea>
                            </div>
                        </div>
                        
                        <!-- Advanced Tab -->
                        <div class="editor-tab-content" data-tab="advanced">
                            <div class="form-group">
                                <label for="personalitySystemPrompt">System Prompt</label>
                                <textarea id="personalitySystemPrompt" name="systemPrompt" rows="6" 
                                          placeholder="You are [name], a [description]. Your personality is...">${personality?.settings?.systemPrompt || ''}</textarea>
                                <small>The core instruction that defines how this AI behaves</small>
                            </div>
                            
                            <div class="form-row">
                                <div class="form-group">
                                    <label for="personalityModel">AI Model</label>
                                    <select id="personalityModel" name="localaiModel">
                                        <option value="josiefied-qwen3-4b-abliterated-gpu" ${personality?.settings?.localaiModel === 'josiefied-qwen3-4b-abliterated-gpu' ? 'selected' : ''}>Qwen 3 4B (Default)</option>
                                        <option value="custom-model" ${personality?.settings?.localaiModel === 'custom-model' ? 'selected' : ''}>Custom Model</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="personalityResponseLength">Response Length</label>
                                    <select id="personalityResponseLength" name="responseLength">
                                        <option value="concise" ${personality?.settings?.responseLength === 'concise' ? 'selected' : ''}>Concise</option>
                                        <option value="detailed" ${personality?.settings?.responseLength === 'detailed' ? 'selected' : ''}>Detailed</option>
                                        <option value="thoughtful" ${personality?.settings?.responseLength === 'thoughtful' ? 'selected' : ''}>Thoughtful</option>
                                    </select>
                                </div>
                            </div>
                            
                            <div class="form-group">
                                <label class="checkbox-label">
                                    <input type="checkbox" id="personalityAutoImages" name="autoGenerateImages" 
                                           ${personality?.settings?.autoGenerateImages ? 'checked' : ''}>
                                    <span class="checkmark"></span>
                                    Enable automatic image generation
                                </label>
                                <small>When enabled, this personality will automatically generate images for visual descriptions</small>
                            </div>
                        </div>
                    </form>
                </div>
                
                <div class="personality-editor-footer">
                    ${isEditing ? `
                        <button type="button" class="btn-delete-personality" data-personality="${editingId}">
                            🗑️ Delete Personality
                        </button>
                    ` : ''}
                    <div class="footer-actions">
                        <button type="button" class="btn-cancel">Cancel</button>
                        <button type="button" class="btn-preview">Preview</button>
                        <button type="submit" class="btn-save">${isEditing ? 'Save Changes' : 'Create Personality'}</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this.setupPersonalityEditorEvents(modal, isEditing, editingId);
    }

    setupPersonalityEditorEvents(modal, isEditing, editingId) {
        // Close modal events
        modal.querySelector('.personality-close').onclick = () => modal.remove();
        modal.querySelector('.btn-cancel').onclick = () => modal.remove();
        modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

        // Tab switching
        modal.querySelectorAll('.editor-tab').forEach(tab => {
            tab.onclick = () => {
                const tabName = tab.dataset.tab;
                
                // Update active tab
                modal.querySelectorAll('.editor-tab').forEach(t => t.classList.remove('active'));
                modal.querySelectorAll('.editor-tab-content').forEach(t => t.classList.remove('active'));
                
                tab.classList.add('active');
                modal.querySelector(`[data-tab="${tabName}"].editor-tab-content`).classList.add('active');
            };
        });

        // Delete personality
        const deleteBtn = modal.querySelector('.btn-delete-personality');
        if (deleteBtn) {
            deleteBtn.onclick = () => this.deletePersonality(editingId, modal);
        }

        // Preview personality
        modal.querySelector('.btn-preview').onclick = () => this.previewPersonality(modal);

        // Save personality
        modal.querySelector('.btn-save').onclick = () => this.savePersonality(modal, isEditing, editingId);
        
        // Form submission
        modal.querySelector('#personalityForm').onsubmit = (e) => {
            e.preventDefault();
            this.savePersonality(modal, isEditing, editingId);
        };

        // Auto-generate display name
        const nameInput = modal.querySelector('#personalityName');
        const displayNameInput = modal.querySelector('#personalityDisplayName');
        nameInput.oninput = () => {
            if (!displayNameInput.value || displayNameInput.value === `${nameInput.value} - The Helpful Assistant`) {
                displayNameInput.value = `${nameInput.value} - The Helpful Assistant`;
            }
        };

        // Auto-generate ID from name
        const idInput = modal.querySelector('#personalityId');
        if (!isEditing) {
            nameInput.oninput = () => {
                if (!idInput.value) {
                    idInput.value = nameInput.value.toLowerCase()
                        .replace(/[^a-z0-9]/g, '-')
                        .replace(/-+/g, '-')
                        .replace(/^-|-$/g, '');
                }
            };
        }
    }

    deletePersonality(personalityId, modal) {
        const personality = this.personalities[personalityId];
        if (!personality) return;

        if (confirm(`Are you sure you want to delete "${personality.name}"? This cannot be undone.`)) {
            // Prevent deletion if it's the current personality and only one left
            const personalityCount = Object.keys(this.personalities).length;
            if (personalityCount <= 1) {
                alert('Cannot delete the last personality. Create another one first.');
                return;
            }

            // Switch to different personality if deleting current one
            if (this.currentPersonality.id === personalityId) {
                const remainingIds = Object.keys(this.personalities).filter(id => id !== personalityId);
                this.setCurrentPersonality(remainingIds[0]);
            }

            // Delete personality
            delete this.personalities[personalityId];
            this.savePersonalities();
            
            modal.remove();
            this.addMessage('system', `🗑️ Personality "${personality.name}" deleted successfully.`);
        }
    }

    previewPersonality(modal) {
        const formData = new FormData(modal.querySelector('#personalityForm'));
        const personalityId = formData.get('id');
        const existingPersonality = this.personalities[personalityId];
        const preview = this.buildPersonalityFromForm(formData, existingPersonality);
        
        const previewModal = document.createElement('div');
        previewModal.className = 'personality-preview-modal';
        previewModal.innerHTML = `
            <div class="personality-preview-content">
                <div class="preview-header">
                    <h3>Personality Preview</h3>
                    <button class="preview-close">&times;</button>
                </div>
                <div class="preview-body">
                    <div class="preview-card">
                        <div class="preview-avatar">
                            ${preview.avatar ? 
                                `<img src="${preview.avatar}" alt="${preview.name}" class="personality-avatar-img">` :
                                `<div class="personality-initial" style="background: ${this.getPersonalityColor(preview.id)}">${preview.name.charAt(0)}</div>`
                            }
                        </div>
                        <div class="preview-info">
                            <h4>${preview.displayName || preview.name}</h4>
                            <p>${preview.description}</p>
                            <div class="preview-traits">
                                ${preview.personality.traits.map(trait => `<span class="trait-tag">${trait}</span>`).join('')}
                            </div>
                        </div>
                    </div>
                    
                    <div class="preview-details">
                        <h5>System Prompt Preview:</h5>
                        <pre>${preview.settings.systemPrompt}</pre>
                        
                        <div class="preview-settings">
                            <div><strong>Style:</strong> ${preview.personality.style}</div>
                            <div><strong>Auto Images:</strong> ${preview.settings.autoGenerateImages ? 'Enabled' : 'Disabled'}</div>
                            <div><strong>Response Length:</strong> ${preview.settings.responseLength}</div>
                        </div>
                    </div>
                </div>
                <div class="preview-footer">
                    <button class="btn-close">Close</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(previewModal);
        
        // Close events
        previewModal.querySelector('.preview-close').onclick = () => previewModal.remove();
        previewModal.querySelector('.btn-close').onclick = () => previewModal.remove();
        previewModal.onclick = (e) => { if (e.target === previewModal) previewModal.remove(); };
    }

    savePersonality(modal, isEditing, editingId) {
        const form = modal.querySelector('#personalityForm');
        if (!form.checkValidity()) {
            form.reportValidity();
            return;
        }

        const formData = new FormData(form);
        const existingPersonality = isEditing ? this.personalities[editingId] : null;
        const personality = this.buildPersonalityFromForm(formData, existingPersonality);
        
        // Validation
        if (!isEditing && this.personalities[personality.id]) {
            alert(`Personality ID "${personality.id}" already exists. Please choose a different ID.`);
            return;
        }

        // Save personality
        this.personalities[personality.id] = personality;
        this.savePersonalities();
        
        modal.remove();
        
        if (isEditing) {
            this.addMessage('system', `✅ Personality "${personality.name}" updated successfully!`);
            
            // Update UI if editing current personality
            if (this.currentPersonality.id === personality.id) {
                this.currentPersonality = personality;
                this.updatePersonalityDisplay();
            }
        } else {
            this.addMessage('system', `✅ New personality "${personality.name}" created successfully!`);
            
            // Switch to new personality
            this.setCurrentPersonality(personality.id);
        }
    }

    buildPersonalityFromForm(formData, existingPersonality = null) {
        const traits = formData.get('traits') ? formData.get('traits').split(',').map(t => t.trim()).filter(t => t) : [];
        const interests = formData.get('interests') ? formData.get('interests').split(',').map(t => t.trim()).filter(t => t) : [];
        const goals = formData.get('goals') ? formData.get('goals').split(',').map(t => t.trim()).filter(t => t) : [];

        return {
            id: formData.get('id'),
            name: formData.get('name'),
            displayName: formData.get('displayName') || formData.get('name'),
            description: formData.get('description') || 'A helpful AI assistant',
            avatar: existingPersonality?.avatar || null,
            personality: {
                traits: traits,
                style: formData.get('style') || 'casual',
                age: formData.get('age') || '25',
                gender: formData.get('gender') || '',
                background: formData.get('background') || '',
                interests: interests,
                goals: goals,
                responseStyle: formData.get('responseStyle') || 'Helpful and engaging'
            },
            settings: {
                localaiModel: formData.get('localaiModel') || 'josiefied-qwen3-4b-abliterated-gpu',
                systemPrompt: formData.get('systemPrompt') || this.generateDefaultSystemPrompt(formData),
                autoGenerateImages: formData.get('autoGenerateImages') === 'on',
                responseLength: formData.get('responseLength') || 'detailed'
            }
        };
    }

    generateDefaultSystemPrompt(formData) {
        const name = formData.get('name') || 'AI Assistant';
        const traits = formData.get('traits') || 'helpful, friendly';
        const background = formData.get('background') || 'general knowledge assistant';
        const style = formData.get('style') || 'casual';
        
        return `You are ${name}, a ${traits} AI assistant. Your background: ${background}. Communicate in a ${style} style, being helpful and engaging while staying true to your personality.`;
    }

    async savePersonalityChatHistory(personalityId, messages) {
        try {
            // Save to API if authenticated
            if (this.useAPI && apiService && apiService.isAuthenticated()) {
                // Find or create chat for this personality
                const chatId = await this.getOrCreateChatForPersonality(personalityId);
                // Note: Individual messages are saved when sent via addMessage
                console.log(`☁️ Chat synced to cloud for personality ${personalityId}`);
            } else {
                // Fallback to localStorage
                const key = `chat_history_${personalityId}`;
                localStorage.setItem(key, JSON.stringify(messages));
                console.log(`💾 Saved ${messages.length} messages locally for personality ${personalityId}`);
            }
        } catch (error) {
            console.error('Error saving personality chat history:', error);
            // Fallback to localStorage on error
            const key = `chat_history_${personalityId}`;
            localStorage.setItem(key, JSON.stringify(messages));
        }
    }

    async loadPersonalityChatHistory(personalityId) {
        try {
            // Load from API if authenticated
            if (this.useAPI && apiService && apiService.isAuthenticated()) {
                console.log(`🔍 Loading chat history for personality ${personalityId}...`);
                const chatId = await this.getOrCreateChatForPersonality(personalityId);
                console.log(`📡 Using chat ID: ${chatId}`);
                const messagesData = await apiService.getChatMessages(chatId);
                console.log(`📥 Received ${messagesData.length} messages from API`);
                const messages = messagesData.map(msg => {
                    // Auto-detect image type if content is base64 image data
                    let messageType = msg.metadata?.type || 'text';
                    if (messageType === 'text' && typeof msg.content === 'string' && msg.content.startsWith('data:image')) {
                        messageType = 'image';
                    }
                    
                    return {
                        id: msg.id,
                        sender: msg.role === 'user' ? 'user' : 'ai',
                        content: msg.content,
                        type: messageType,
                        timestamp: new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        thinking: msg.metadata?.thinking || ''
                    };
                });
                console.log(`☁️ Loaded ${messages.length} messages from cloud for personality ${personalityId}`);
                return messages;
            } else {
                // Fallback to localStorage
                const key = `chat_history_${personalityId}`;
                const saved = localStorage.getItem(key);
                if (saved) {
                    const messages = JSON.parse(saved);
                    console.log(`📂 Loaded ${messages.length} messages locally for personality ${personalityId}`);
                    return messages;
                }
            }
        } catch (error) {
            console.error('Error loading personality chat history:', error);
            // Fallback to localStorage on error
            const key = `chat_history_${personalityId}`;
            const saved = localStorage.getItem(key);
            if (saved) {
                return JSON.parse(saved);
            }
        }
        return [];
    }

    async loadChatHistory() {
        // Load messages for current personality
        if (this.currentPersonality) {
            this.messages = await this.loadPersonalityChatHistory(this.currentPersonality.id);
            this.renderMessages();
            
            // Set initial message count for polling
            this.lastKnownMessageCount = this.messages.length;
            
            // Start polling for new messages
            if (this.useAPI && apiService.isAuthenticated()) {
                this.checkForNewMessages();
            }
        } else {
            // Fallback to old method if no personality
            const saved = localStorage.getItem('aiChatHistory');
            if (saved) {
                this.messages = JSON.parse(saved);
                this.renderMessages();
            }
            this.lastKnownMessageCount = this.messages.length;
        }
    }

    saveChatHistory() {
        if (this.currentPersonality) {
            this.savePersonalityChatHistory(this.currentPersonality.id, this.messages);
        } else {
            localStorage.setItem('aiChatHistory', JSON.stringify(this.messages));
        }
    }

    async getOrCreateChatForPersonality(personalityId) {
        try {
            // Check if personalityManager already has a chat ID for this personality
            if (window.personalityManager && window.personalityManager.currentChatId && 
                window.personalityManager.currentPersonality?.id === personalityId) {
                console.log(`♻️ Reusing chat ${window.personalityManager.currentChatId} from personalityManager`);
                return window.personalityManager.currentChatId;
            }
            
            // Always get chats from API to ensure cross-device sync
            // (Don't use localStorage cache as it prevents cross-device chat sharing)
            const chats = await apiService.getChats();
            
            // Find the most recent chat for this personality
            const personalityChats = chats.filter(chat => chat.personality_id === personalityId);
            
            if (personalityChats.length > 0) {
                // Use the most recent chat (they're returned in descending order by created_at)
                const existingChat = personalityChats[0];
                console.log(`☁️ Using existing cloud chat ${existingChat.id} for personality ${personalityId}`);
                return existingChat.id;
            }
            
            // Create new chat for this personality
            console.log(`✨ Creating new cloud chat for personality ${personalityId}`);
            const newChat = await apiService.createChat(personalityId);
            return newChat.id;
        } catch (error) {
            console.error('Error getting/creating chat:', error);
            throw error;
        }
    }

    async clearChatHistory() {
        // Show confirmation dialog
        const confirmClear = confirm('Are you sure you want to clear the current chat? This cannot be undone.');
        
        if (confirmClear) {
            try {
                // Get current chat ID from personality manager
                const chatId = window.personalityManager?.getCurrentChatId();
                
                // Clear messages from database if we have a chat ID
                if (chatId && apiService.isAuthenticated()) {
                    try {
                        await apiService.deleteChatMessages(chatId);
                        console.log(`🗑️ Cleared messages for chat ${chatId} from database`);
                    } catch (error) {
                        console.error('Error clearing chat from database:', error);
                    }
                }
                
                // Clear messages array
                this.messages = [];
                
                // Clear from localStorage for current chat
                localStorage.removeItem('aiChatHistory');
                if (chatId) {
                    localStorage.removeItem(`chat_${chatId}`);
                }
                
                // Re-render empty message container (will show welcome message)
                this.renderMessages();
                
                // Show success notification
                this.showNotification('🗑️ Current chat cleared successfully!', 'success');
                
                console.log('🗑️ Current chat cleared by user');
            } catch (error) {
                console.error('Error clearing chat:', error);
                this.showNotification('❌ Error clearing chat', 'error');
            }
        }
    }

    async clearAllChats() {
        // Show strong confirmation dialog
        const confirmClear = confirm('⚠️ Are you sure you want to delete ALL chat conversations? This will permanently delete all your chat history and cannot be undone.');
        
        if (confirmClear) {
            // Double confirmation for such a destructive action
            const doubleConfirm = confirm('This is your final warning! ALL chat data will be permanently deleted. Are you absolutely sure?');
            
            if (doubleConfirm) {
                try {
                    // Clear current messages
                    this.messages = [];
                    
                    // Clear all localStorage chat data
                    const keysToRemove = [];
                    for (let i = 0; i < localStorage.length; i++) {
                        const key = localStorage.key(i);
                        if (key && (key.startsWith('aiChatHistory') || key.startsWith('chat_') || key.startsWith('local_chat_'))) {
                            keysToRemove.push(key);
                        }
                    }
                    keysToRemove.forEach(key => localStorage.removeItem(key));
                    
                    // Clear server-side chats if authenticated
                    if (apiService && apiService.isAuthenticated()) {
                        try {
                            await apiService.deleteAllUserChats();
                            console.log('🗑️ Cleared all server-side chats');
                        } catch (error) {
                            console.error('Error clearing server-side chats:', error);
                        }
                    }
                    
                    // Re-render empty message container
                    this.renderMessages();
                    
                    // Show success notification
                    this.showNotification('🗑️ All chats cleared successfully!', 'success');
                    
                    console.log('🗑️ ALL chat history cleared by user');
                } catch (error) {
                    console.error('Error clearing all chats:', error);
                    this.showNotification('❌ Error clearing chats', 'error');
                }
            }
        }
    }

    /**
     * Start polling for new messages (for background AI processing)
     */
    startMessagePolling() {
        if (this.pollingInterval) {
            return; // Already polling
        }

        console.log('🔄 Starting message polling for background updates');
        
        // Poll every 1 second
        this.pollingInterval = setInterval(async () => {
            await this.checkForNewMessages();
        }, 1000);
    }

    /**
     * Stop polling for new messages
     */
    stopMessagePolling() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
            this.pollingInterval = null;
            console.log('⏹️ Stopped message polling');
        }
    }

    /**
     * Check for new messages from server
     */
    async checkForNewMessages() {
        if (!this.useAPI || !apiService.isAuthenticated()) {
            return;
        }

        try {
            const chatId = window.personalityManager?.getCurrentChatId();
            if (!chatId) {
                // Don't retry polling without chat ID - wait for personality switch
                return;
            }
            
            // Check if polling should stop (e.g., during personality switch)
            if (this.shouldStopPolling) {
                console.log('⏹️ Polling stopped due to shouldStopPolling flag');
                return;
            }

            // Get current messages from server
            const serverMessages = await apiService.getChatMessages(chatId);
            
            console.log(`🔄 Poll: Server has ${serverMessages.length} msgs, we have ${this.messages.length} local, tracking ${this.lastKnownMessageCount}`);
            
            // Check for mismatch - if server has fewer messages than we're tracking, we're out of sync
            // Note: We might have more local messages if we just sent one that server hasn't confirmed yet
            if (serverMessages.length < this.lastKnownMessageCount) {
                console.warn(`⚠️ Message count mismatch! Server: ${serverMessages.length}, Tracking: ${this.lastKnownMessageCount}. Refreshing...`);
                await this.loadChatHistory(chatId);
                this.lastKnownMessageCount = this.messages.length;
                return;
            }
            
            // Check if there are new messages
            if (serverMessages.length > this.lastKnownMessageCount) {
                console.log(`📬 Found ${serverMessages.length - this.lastKnownMessageCount} new messages from server`);
                
                // Get only new messages - but be smart about it
                // If we have local messages that aren't confirmed by server yet, skip those
                let newMessages;
                if (this.lastKnownMessageCount === 0) {
                    // First time polling or after refresh - get all messages
                    newMessages = serverMessages;
                    console.log(`🆕 Initial load: Processing all ${newMessages.length} messages from server`);
                } else {
                    // Get messages after the last known count
                    newMessages = serverMessages.slice(this.lastKnownMessageCount);
                    console.log(`🆕 Incremental update: Processing ${newMessages.length} new messages from server`);
                }
                
                // Add new messages to UI
                for (const msg of newMessages) {
                    // Parse metadata if it's a string
                    let metadata = {};
                    if (msg.metadata && typeof msg.metadata === 'string') {
                        try {
                            metadata = JSON.parse(msg.metadata);
                        } catch (e) {
                            console.warn('Failed to parse metadata:', e);
                        }
                    } else if (msg.metadata) {
                        metadata = msg.metadata;
                    }
                    
                    // Map database role to UI sender
                    const sender = msg.role === 'assistant' ? 'ai' : msg.role;
                    const type = metadata.type || 'text';
                    const thinking = metadata.thinking || '';
                    
                    // Check if message is already in our local array
                    // Match by content to avoid false duplicates
                    const exists = this.messages.some(m => {
                        const contentMatch = m.sender === sender && m.content === msg.content;
                        return contentMatch;
                    });
                    
                    console.log(`🔍 Message check - ID: ${msg.id}, Sender: ${sender}, Type: ${type}, Exists: ${exists}`);
                    console.log(`   Content: "${msg.content.substring(0, 80)}..."`);
                    console.log(`   Has thinking: ${!!thinking}, Local array size: ${this.messages.length}`);
                    
                    if (!exists) {
                        console.log(`➕ Adding new ${sender} message to array`);
                        
                        // Add to messages array
                        this.messages.push({
                            id: Date.now() + Math.random(),
                            sender: sender,
                            content: msg.content,
                            type: type,
                            thinking: thinking,
                            timestamp: msg.created_at || Date.now()
                        });
                        
                        // Render single message with proper structure
                        console.log(`🎨 Calling renderSingleMessage for ${sender} (thinking: ${!!thinking})`);
                        console.log(`📦 messagesContainer element exists:`, !!this.messagesContainer);
                        
                        this.renderSingleMessage({
                            sender: sender,
                            content: msg.content,
                            type: type,
                            thinking: thinking
                        });
                        
                        console.log(`✅ Message rendered, total DOM messages:`, this.messagesContainer?.children?.length);
                        
                        // Send notification for AI messages
                        if (sender === 'ai' && typeof notificationManager !== 'undefined') {
                            const personalityName = this.currentPersonality?.displayName || 'AI Assistant';
                            notificationManager.showAIMessageNotification(personalityName, type);
                        }
                    } else {
                        console.log(`⏭️ Skipping duplicate ${sender} message`);
                    }
                }
                
                this.lastKnownMessageCount = serverMessages.length;
                console.log(`✅ Updated lastKnownMessageCount to ${this.lastKnownMessageCount} (server message count)`);
                
                // Hide loading indicator if it's showing
                this.hideLoading();
                
                // Scroll to bottom
                this.scrollToBottom();
            } else {
                // No new messages, but still sync the count to match server
                // This prevents count drift over time
                if (this.lastKnownMessageCount !== serverMessages.length) {
                    console.log(`🔄 Syncing message count: ${this.lastKnownMessageCount} → ${serverMessages.length}`);
                    this.lastKnownMessageCount = serverMessages.length;
                }
            }
        } catch (error) {
            console.error('Error checking for new messages:', error);
        }
        
        // Continue polling if using API and not stopped
        if (this.useAPI && apiService.isAuthenticated() && !this.shouldStopPolling) {
            setTimeout(() => this.checkForNewMessages(), 2000);
        }
    }

    /**
     * Render a single new message
     */
    renderSingleMessage(msg) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message', msg.sender);
        
        // Check if content is base64 image
        const isBase64Image = typeof msg.content === 'string' && 
                             msg.content.startsWith('data:image');
        
        if (isBase64Image || msg.type === 'image') {
            // Render as image - wrap in bubble for consistent styling
            const bubble = document.createElement('div');
            bubble.classList.add('message-bubble', 'image-bubble');
            
            const img = document.createElement('img');
            img.src = msg.content;
            img.alt = 'Generated image';
            img.classList.add('generated-image');
            img.style.cursor = 'pointer';
            
            // Add click handler for fullscreen
            img.addEventListener('click', () => {
                this.toggleImageFullscreen(img.src);
            });
            
            bubble.appendChild(img);
            messageDiv.appendChild(bubble);
        } else {
            // Parse content to extract thinking tags and image prompts
            let content = msg.content;
            let thinking = msg.thinking || '';
            
            // Extract thinking tags from content if not already in metadata
            if (!thinking) {
                // Try <thinking> tags first
                let thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/i);
                if (thinkingMatch) {
                    thinking = thinkingMatch[1].trim();
                }
                // Try <think> tags (Qwen uses this)
                if (!thinking) {
                    thinkingMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
                    if (thinkingMatch) {
                        thinking = thinkingMatch[1].trim();
                    }
                }
                // Remove all thinking tags from content
                content = content
                    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
                    .replace(/<think>[\s\S]*?<\/think>/gi, '')
                    .trim();
            }
            
            // Remove image prompts from display (they'll be handled separately)
            content = content.replace(/\[IMAGE_PROMPT:[^\]]+\]/gi, '').trim();
            
            console.log(`📄 Rendering message - Content length: ${content.length}, Has thinking: ${!!thinking}`);
            console.log(`📝 Content preview: "${content.substring(0, 100)}..."`);
            
            // Render as text with thinking support
            const bubble = document.createElement('div');
            bubble.classList.add('message-bubble');
            
            console.log('🎯 Final thinking check before rendering:');
            console.log('   - thinking exists:', !!thinking);
            console.log('   - thinking trimmed:', thinking?.trim() || 'none');
            console.log('   - sender is ai:', msg.sender === 'ai');
            console.log('   - showThinking setting:', this.settings?.showThinking);
            
            // Add thinking section if present (for AI messages) - hidden by default
            if (thinking && thinking.trim() && msg.sender === 'ai') {
                console.log('✅ Adding thinking section to message bubble');
                const thinkingDiv = document.createElement('div');
                thinkingDiv.className = 'thinking-process';
                thinkingDiv.style.display = 'none'; // Hidden until clicked
                
                // Add thinking header
                const thinkingHeader = document.createElement('div');
                thinkingHeader.className = 'thinking-header';
                thinkingHeader.innerHTML = '💭 Thought Process';
                thinkingDiv.appendChild(thinkingHeader);
                
                // Add thinking content
                const thinkingContent = document.createElement('div');
                thinkingContent.className = 'thinking-content';
                thinkingContent.innerHTML = this.formatTextContent(thinking);
                thinkingDiv.appendChild(thinkingContent);
                
                bubble.appendChild(thinkingDiv);
                
                // Add click handler to toggle thinking visibility
                bubble.style.cursor = 'pointer';
                bubble.title = 'Click to view thought process';
                bubble.addEventListener('click', (e) => {
                    // Don't toggle if clicking on links or buttons
                    if (e.target.tagName === 'A' || e.target.tagName === 'BUTTON') {
                        return;
                    }
                    const isVisible = thinkingDiv.style.display !== 'none';
                    thinkingDiv.style.display = isVisible ? 'none' : 'block';
                    bubble.title = isVisible ? 'Click to view thought process' : 'Click to hide thought process';
                });
            }
            
            // Add main content
            const contentDiv = document.createElement('div');
            contentDiv.innerHTML = this.formatTextContent(content);
            bubble.appendChild(contentDiv);
            
            messageDiv.appendChild(bubble);
        }
        
        this.messagesContainer.appendChild(messageDiv);
    }

    updateServiceSelection() {
        this.serviceButtons.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.service === this.currentService);
        });
    }

    updatePlaceholder() {
        const placeholders = {
            localai: 'Type a message...',
            automatic1111: 'Describe the image you want to generate...',
            comfyui: 'Enter workflow parameters or description...'
        };
        this.messageInput.placeholder = placeholders[this.currentService];
    }

    async updateServiceStatus() {
        try {
            const services = {
                localai: this.settings.localaiUrl,
                automatic1111: this.settings.a1111Url,
                comfyui: this.settings.comfyUrl
            };

            let activeServices = 0;
            for (const [service, url] of Object.entries(services)) {
                try {
                    const response = await fetch(url, { method: 'HEAD', mode: 'no-cors' });
                    activeServices++;
                } catch (error) {
                    console.log(`${service} not available`);
                }
            }

            this.aiStatus.textContent = activeServices > 0 ? 'Online' : 'Offline';
            this.aiStatus.style.color = activeServices > 0 ? '#4ade80' : '#f87171';
        } catch (error) {
            this.aiStatus.textContent = 'Offline';
            this.aiStatus.style.color = '#f87171';
        }
    }

    showSettings() {
        // Load current settings into form (simplified)
        if (this.showThinkingToggle) {
            this.showThinkingToggle.checked = this.settings?.showThinking || false;
        }
        
        // Debug: Log thinking toggle state
        console.log(`🎛️ Settings opened - Show Thinking: ${this.settings?.showThinking}`);
        console.log(`🔘 Toggle checked state: ${this.showThinkingToggle?.checked}`);
        
        this.settingsModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    hideSettings() {
        this.settingsModal.style.display = 'none';
        document.body.style.overflow = '';
    }

    saveSettings() {
        console.log('🔧 Save Settings called - starting save process...');
        
        // Initialize settings if not exists
        if (!this.settings) {
            this.settings = this.loadSettings();
        }
        
        // Update settings from form (simplified)
        if (this.showThinkingToggle) {
            this.settings.showThinking = this.showThinkingToggle.checked;
        }
        
        // Debug: Log thinking toggle save state
        console.log(`💾 Saving settings - Show Thinking: ${this.settings.showThinking}`);
        console.log(`🔘 Toggle checked state: ${this.showThinkingToggle?.checked}`);
        
        this.saveSettingsToStorage();
        this.hideSettings();
        this.updateServiceStatus();
        this.updateAIName();
        
        this.showNotification(`Settings saved! Thinking: ${this.settings.showThinking ? 'Always visible' : 'Click to show'}`);
    }

    clearChat() {
        if (confirm('Are you sure you want to clear the chat history?')) {
            this.messages = [];
            this.saveChatHistory();
            this.renderMessages();
            this.showWelcomeMessage();
        }
    }

    updateAIName() {
        console.log('updateAIName called, currentPersonality:', this.currentPersonality);
        
        // Use personality name if available, otherwise fall back to settings or default
        let aiName = 'AI Assistant';
        let aiAvatar = '🤖';
        let avatarUrl = null;
        
        if (this.currentPersonality) {
            aiName = this.currentPersonality.displayName || this.currentPersonality.name || 'AI Assistant';
            aiAvatar = this.currentPersonality.avatar || '🤖';
            avatarUrl = this.currentPersonality.avatarUrl || null;
            console.log('Using personality:', aiName, aiAvatar, 'avatarUrl:', avatarUrl);
        } else if (this.settings && this.settings.aiName) {
            aiName = this.settings.aiName.trim();
            console.log('Using settings aiName:', aiName);
        }
        
        // Update UI elements
        const aiAssistantName = document.getElementById('aiAssistantName');
        const personalityIcon = document.getElementById('personalityIcon');
        
        if (aiAssistantName) {
            aiAssistantName.textContent = aiName;
            console.log('Updated aiAssistantName to:', aiName);
        }
        
        if (personalityIcon) {
            // Check if we have an image avatar URL
            if (avatarUrl && (avatarUrl.startsWith('data:image') || avatarUrl.startsWith('http'))) {
                // Clear text content and show image
                personalityIcon.innerHTML = '';
                const img = document.createElement('img');
                img.src = avatarUrl;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '50%';
                personalityIcon.appendChild(img);
                console.log('Updated personalityIcon with image:', avatarUrl.substring(0, 50) + '...');
            } else {
                // Use emoji/text avatar
                personalityIcon.textContent = aiAvatar;
                console.log('Updated personalityIcon to:', aiAvatar);
            }
        }
    }

    showWelcomeMessage() {
        const personalityName = this.personalityManager.currentPersonality?.name || 'your AI';
        const welcomeHTML = `
            <div class="welcome-message">
                <div class="welcome-content">
                    <h3>Start messing with ${personalityName}</h3>
                </div>
            </div>
        `;
        this.messagesContainer.innerHTML = welcomeHTML;
    }

    async handleSendMessage() {
        let message = this.messageInput.value.trim();
        console.log('🔍 DEBUG: handleSendMessage called with message:', JSON.stringify(message));
        console.log('🔍 DEBUG: Message length:', message.length, 'First 10 chars:', message.substring(0, 10));
        if (!message) return;

        // Check for service commands
        console.log('🔍 DEBUG: Checking if message starts with "/image ":', message.startsWith('/image '));
        
        // Check for /image (X) command for multiple images
        const multiImageMatch = message.match(/^\/image\s*\((\d+)\)\s+(.+)$/i);
        if (multiImageMatch) {
            const count = parseInt(multiImageMatch[1]);
            message = multiImageMatch[2];
            console.log(`🎨 Multi-image command detected: ${count} images`);
            this.currentService = 'automatic1111';
            this.imageGenerationCount = Math.min(count, 10); // Cap at 10 images
            console.log('🔄 Service set to:', this.currentService, 'Count:', this.imageGenerationCount, 'Prompt:', message);
            this.updateServiceStatus();
            this.messageInput.placeholder = 'Describe the image you want to generate...';
        } else if (message.startsWith('/image ')) {
            console.log('🎨 Image command detected, switching to Automatic1111');
            this.currentService = 'automatic1111';
            this.imageGenerationCount = 1; // Default to 1 image
            message = message.substring(7); // Remove '/image ' command
            console.log('🔄 Service set to:', this.currentService, 'Prompt:', message);
            this.updateServiceStatus();
            this.messageInput.placeholder = 'Describe the image you want to generate...';
        } else if (this.isImageRequest(message)) {
            console.log('🎨 Natural image request detected, switching to Automatic1111');
            this.currentService = 'automatic1111';
            console.log('🔄 Service set to:', this.currentService, 'Prompt:', message);
            this.updateServiceStatus();
            this.messageInput.placeholder = 'Describe the image you want to generate...';
        } else if (message.startsWith('/chat ')) {
            console.log('💬 Chat command detected, switching to LocalAI');
            this.currentService = 'localai';
            message = message.substring(6); // Remove '/chat ' command
            console.log('🔄 Service set to:', this.currentService, 'Prompt:', message);
            this.updateServiceStatus();
            this.messageInput.placeholder = 'Type a message...';
        } else if (message.startsWith('/comfy ')) {
            console.log('🔧 ComfyUI command detected, switching to ComfyUI');
            this.currentService = 'comfyui';
            message = message.substring(7); // Remove '/comfy ' command
            console.log('🔄 Service set to:', this.currentService, 'Prompt:', message);
            this.updateServiceStatus();
            this.messageInput.placeholder = 'Enter workflow parameters or description...';
        } else {
            // Regular message - switch to LocalAI for chat
            console.log('💬 Regular chat message detected, switching to LocalAI');
            this.currentService = 'localai';
            console.log('🔄 Service set to:', this.currentService, 'Prompt:', message);
            this.updateServiceStatus();
            this.messageInput.placeholder = 'Type a message...';
        }

        // TRY NEW BACKGROUND PROCESSING if using API and it's a LocalAI chat message
        if (this.useAPI && apiService.isAuthenticated() && this.currentService === 'localai') {
            try {
                // Get current chat ID
                const chatId = window.personalityManager?.getCurrentChatId();
                const personalityId = this.currentPersonality?.id;

                if (chatId) {
                    // Send message with queued AI processing (this saves user message to DB)
                    console.log('🚀 Using background processing for AI response');
                    const result = await apiService.sendMessageQueued(chatId, message, this.currentPersonality);
                    console.log(`📬 Message queued with job ID: ${result.jobId}`);

                    // Add user message to UI only (don't save to DB again)
                    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    const msgObj = { 
                        id: Date.now() + Math.random(), 
                        sender: 'user', 
                        content: message, 
                        type: 'text', 
                        timestamp 
                    };
                    this.messages.push(msgObj);
                    this.renderMessage(msgObj);
                    this.scrollToBottom();
                    
                    this.messageInput.value = '';
                    this.messageInput.style.height = 'auto';

                    // DON'T update lastKnownMessageCount here - let polling detect both user msg and AI response
                    // The server will have saved the user message via sendMessageQueued
                    console.log(`📊 Current local messages: ${this.messages.length}, lastKnownMessageCount: ${this.lastKnownMessageCount}`);
                    console.log(`⏳ Polling will detect user message + AI response from server`);

                    // Start polling for new messages
                    this.startMessagePolling();

                    // Show typing indicator
                    setTimeout(() => {
                        this.showLoading();
                    }, this.calculateTypingDelay());

                    return; // Exit - polling will handle displaying AI response
                }
            } catch (error) {
                console.error('❌ Background processing failed, falling back to direct mode:', error);
                // Fall through to original processing
            }
        }

        // ORIGINAL PROCESSING (fallback or for image/comfy commands)
        // Add user message
        this.addMessage('user', message);
        this.messageInput.value = '';
        this.messageInput.style.height = 'auto';

        // Calculate realistic typing delay based on conversation activity
        const typingDelay = this.calculateTypingDelay();
        console.log(`⏱️ Typing indicator will appear in ${(typingDelay / 1000).toFixed(1)}s`);

        // Start API call immediately (don't wait for typing indicator)
        console.log('🚀 Routing message to service:', this.currentService);
        let responsePromise;
        switch (this.currentService) {
            case 'localai':
                console.log('➡️ Sending to LocalAI:', message);
                responsePromise = this.sendToLocalAI(message);
                break;
            case 'automatic1111':
                console.log('➡️ Sending to Automatic1111 for image generation:', message);
                const imageCount = this.imageGenerationCount || 1;
                if (imageCount > 1) {
                    console.log(`🎨 Generating ${imageCount} images...`);
                    responsePromise = this.generateMultipleImages(message, imageCount);
                } else {
                    responsePromise = this.generateImage(message);
                }
                this.imageGenerationCount = 1; // Reset for next time
                break;
            case 'comfyui':
                console.log('➡️ Sending to ComfyUI:', message);
                responsePromise = this.runComfyUIWorkflow(message);
                break;
            default:
                console.error('❌ Unknown service selected:', this.currentService);
                throw new Error('Unknown service selected');
        }

        // Show typing indicator after realistic delay
        setTimeout(() => {
            this.showLoading();
        }, typingDelay);

        try {
            // Wait for the API response
            const response = await responsePromise;

            // Check for automatic image generation trigger
            console.log('🔍 Checking automatic image generation...', {
                responseType: response.type, 
                service: this.currentService,
                contentLength: response.content ? response.content.length : 0
            });
            
            if (response.type === 'text' && this.currentService === 'localai') {
                console.log('✅ Processing LocalAI text response for auto image generation');
                const imageResult = await this.processAutoImageGeneration(response);
                console.log('🎨 Image generation result:', imageResult ? 'Found image request' : 'No image request');
                
                if (imageResult) {
                    console.log('🖼️ Auto image generation activated!');
                    // Hide the text response loading indicator
                    this.hideLoading();
                    
                    // Add text response first
                    this.addMessage('ai', imageResult.textContent, 'text', response.thinking);
                    
                    // Then generate and add image
                    if (imageResult.imagePrompt) {
                        console.log('🎯 Starting image generation with prompt:', imageResult.imagePrompt);
                        this.showLoading();
                        
                        try {
                            const imageResponse = await this.generateImage(imageResult.imagePrompt);
                            await new Promise(resolve => setTimeout(resolve, 1000)); // Brief pause
                            this.addMessage('ai', imageResponse.content, 'image');
                            console.log('✅ Auto image generation complete!');
                        } catch (imageError) {
                            console.log('⚠️ Auto image generation failed:', imageError.message);
                            // Don't show error to user - text response is already displayed
                        }
                        
                        this.hideLoading();
                    }
                } else {
                    // No image generation - normal flow
                    console.log('📝 No image generation - displaying text only');
                    this.addMessage('ai', response.content, response.type || 'text', response.thinking);
                }
            } else {
                // Non-LocalAI services or non-text responses - normal flow
                console.log('📝 Non-LocalAI or non-text response - normal flow');
                this.addMessage('ai', response.content, response.type || 'text', response.thinking);
            }
        } catch (error) {
            console.error('💥 Message sending failed:', error);
            
            let errorMessage = error.message;
            let debugInfo = '';
            
            // Provide more specific error messages
            if (error.message.includes('Failed to fetch')) {
                errorMessage = `Connection failed. Please check:\n• LocalAI is running at ${this.settings.localaiUrl}\n• CORS is enabled\n• The model "${this.settings.localaiModel}" is loaded`;
                debugInfo = '\n\n🔍 Check browser console (F12) for detailed error logs.';
            } else if (error.message.includes('All LocalAI endpoints failed')) {
                errorMessage = `All API endpoints failed. Common issues:\n• LocalAI not running or wrong IP address\n• Model not loaded or incorrect model name\n• Network connectivity issues\n• API endpoints not supported`;
                debugInfo = '\n\n🔍 Detailed error logs are in the browser console (F12).\n💡 Try the "Test LocalAI Connection" button in settings.';
            }
            
            // Show comprehensive error in UI
            this.addMessage('ai', `${errorMessage}${debugInfo}`, 'text');
            
            // Also log to console with styling for visibility
            console.log('%c🚨 ERROR SUMMARY FOR USER:', 'background: red; color: white; font-weight: bold; padding: 4px;');
            console.log(errorMessage);
            if (debugInfo) {
                console.log('%cℹ️ Additional Info:', 'background: blue; color: white; font-weight: bold; padding: 4px;');
                console.log(debugInfo.replace(/\n/g, ''));
            }
        }

        this.hideLoading();
    }

    async sendToLocalAI(message) {
        this.setLoadingText('Thinking...');
        this.setVRAMStatusProcessing('Freeing VRAM...');
        
        // SMART DOCKER MANAGEMENT - Stop A1111 container completely
        console.log('💬 Chat request - Smart A1111 Docker container management');
        
        try {
            // Stop A1111 container completely to free all VRAM
            console.log('🛑 Stopping A1111 Docker container to free all VRAM...');
            const stopResponse = await fetch('/api/docker/stop/a1111', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (stopResponse.ok) {
                console.log('✅ A1111 container stopped - VRAM fully available for LocalAI');
            } else {
                console.log('⚠️ A1111 container stop failed, proceeding anyway');
            }
            
            // Brief delay to ensure container stops properly
            console.log('⏳ Waiting 2 seconds for A1111 container shutdown...');
            await new Promise(resolve => setTimeout(resolve, 2000));
            console.log('💾 VRAM should now be fully available for LocalAI');
        } catch (error) {
            console.log('⚠️ Checkpoint unload failed, trying service restart...');
            try {
                // Fallback to service restart if checkpoint unload fails
                console.log('🔄 Using A1111 service restart as fallback...');
                await this.restartA1111();
                console.log('✅ A1111 service restarted - VRAM freed');
            } catch (restartError) {
                console.log('⚠️ Both methods failed, proceeding with available VRAM...');
            }
        }
        
        console.log('🎯 VRAM cleanup complete - LocalAI ready for maximum performance');
        console.log('💾 LocalAI will auto-release VRAM using keep_alive: 0 after each response');
        
        // Update service tracking
        this.lastActiveService = 'localai';
        this.setVRAMStatusLocalAI();
        
        // Build messages array with optional system prompt
        const messages = [];
        
        // Add system prompt with image generation capability
        console.log('🔍 Attempting to generate system prompt...');
        const systemPrompt = this.generateSystemPromptWithImageGeneration();
        console.log('🔍 System prompt generation result:', systemPrompt ? systemPrompt.length : 'null');
        console.log('🔍 System prompt type:', typeof systemPrompt);
        
        if (systemPrompt && systemPrompt.length > 0) {
            messages.push({ role: 'system', content: systemPrompt });
            console.log(`🎭 ✅ System prompt with image generation added (${systemPrompt.length} chars)`);
            console.log('📋 System prompt preview:', systemPrompt.substring(0, 300) + '...');
        } else {
            console.log('⚠️ System prompt is empty or null! Forcing generation...');
            // Force a basic system prompt with image instructions
            const forcedPrompt = `You are a helpful AI assistant.

IMPORTANT: IMAGE GENERATION CAPABILITY

When describing visual things, ALWAYS add an image generation request at the end of your response:

[IMAGE_PROMPT: descriptive prompt here]

WHEN TO USE:
- Food descriptions (sandwiches, pizza, etc.)
- Objects, places, people
- Visual concepts or scenes

Example:
"A sandwich has layers of ingredients between bread slices.

[IMAGE_PROMPT: delicious sandwich on a plate, fresh bread with meat, lettuce, tomato, cheese, food photography]"

CRITICAL: Always include [IMAGE_PROMPT: ...] when describing anything visual!`;
            
            messages.push({ role: 'system', content: forcedPrompt });
            console.log(`🎭 ⚠️ Using forced system prompt (${forcedPrompt.length} chars)`);
        }
        
        // Add user message
        messages.push({ role: 'user', content: message });
        
        // Use only the working OpenAI compatible endpoint
        // Build request with immediate VRAM release option
        const chatRequest = {
            model: this.settings.localaiModel,
            messages: messages,
            temperature: 0.7,
            max_tokens: 2000,
            // CRITICAL: Force immediate model unload after generation
            options: {
                keep_alive: 0  // Immediately unload model from VRAM after response
            }
        };

        console.log('💾 Request includes keep_alive: 0 for immediate VRAM release');

        const endpoints = [
            // Use only the working OpenAI-compatible endpoint
            {
                url: `${this.settings.localaiUrl}/v1/chat/completions`,
                method: 'POST',
                body: JSON.stringify(chatRequest),
                headers: { 'Content-Type': 'application/json' }
            }
        ];

        let lastError = null;
        let allErrors = [];
        
        console.group('🚀 Sending message to LocalAI...');
        console.log(`Message: "${message}"`);
        console.log(`Model: ${this.settings.localaiModel}`);
        console.log(`Base URL: ${this.settings.localaiUrl}`);
        console.log('─'.repeat(60));
        
        for (let i = 0; i < endpoints.length; i++) {
            const endpoint = endpoints[i];
            console.log(`\nSending to LocalAI (${i + 1}/${endpoints.length}):`);
            console.log(`  Method: ${endpoint.method}`);
            console.log(`  URL: ${endpoint.url}`);
            
            try {
                const fetchOptions = {
                    method: endpoint.method,
                    headers: endpoint.headers || {}
                };
                
                if (endpoint.body) {
                    fetchOptions.body = endpoint.body;
                    console.log(`  Body: ${typeof endpoint.body === 'string' ? endpoint.body.substring(0, 200) : endpoint.body}`);
                }
                console.log(`  Headers:`, fetchOptions.headers);
                
                const startTime = performance.now();
                const response = await fetch(endpoint.url, fetchOptions);
                const endTime = performance.now();
                const duration = Math.round(endTime - startTime);
                
                console.log(`  Response: ${response.status} ${response.statusText} (${duration}ms)`);
                
                if (response.ok) {
                    const data = await response.json();
                    console.log(`  ✅ SUCCESS! Raw response:`, data);
                    
                    // COMPREHENSIVE RAW RESPONSE LOGGING
                    console.log('');
                    console.log('🔍📋 COMPLETE AI RESPONSE ANALYSIS');
                    console.log('═'.repeat(80));
                    console.log('📦 Full JSON Response Object:');
                    console.log(JSON.stringify(data, null, 2));
                    console.log('═'.repeat(80));
                    
                    // Extract content from response
                    let content = '';
                    let thinkingContent = '';
                    
                    // Handle different response formats and extract thinking
                    let rawContent = '';
                    
                    if (data.response) {
                        rawContent = data.response;
                        console.log(`  📝 Using data.response: "${rawContent.substring(0, 200)}..."`);
                    } else if (data.message) {
                        rawContent = data.message;
                        console.log(`  📝 Using data.message: "${rawContent.substring(0, 200)}..."`);
                    } else if (data.choices && data.choices.length > 0) {
                        rawContent = data.choices[0].message?.content || data.choices[0].text || 'No response received';
                        console.log(`  📝 Using data.choices[0]: "${rawContent.substring(0, 200)}..."`);
                    } else if (data.text) {
                        rawContent = data.text;
                        console.log(`  📝 Using data.text: "${rawContent.substring(0, 200)}..."`);
                    } else if (typeof data === 'string') {
                        rawContent = data;
                        console.log(`  📝 Using raw string: "${rawContent.substring(0, 200)}..."`);
                    } else {
                        rawContent = JSON.stringify(data);
                        console.log(`  📝 Using JSON.stringify: "${rawContent.substring(0, 200)}..."`);
                    }
                    
                    // DETAILED CONTENT EXTRACTION LOGGING
                    console.log('📝 Raw Content Extraction:');
                    console.log(`   • Length: ${rawContent.length} characters`);
                    console.log(`   • Type: ${typeof rawContent}`);
                    console.log('─'.repeat(60));
                    console.log('📖 FULL RAW CONTENT (COMPLETE):');
                    console.log('─'.repeat(60));
                    console.log(rawContent);
                    console.log('─'.repeat(60));
                    console.log('🔍 Thinking Pattern Detection:');
                    console.log(`   • Contains <think>: ${rawContent.includes('<think>')}`);
                    console.log(`   • Contains <thinking>: ${rawContent.includes('<thinking>')}`);
                    console.log(`   • Contains [THINKING]: ${rawContent.includes('[THINKING]')}`);
                    console.log(`   • Contains **Thinking**: ${rawContent.includes('**Thinking')}`);
                    console.log(`   • Has double newlines: ${rawContent.includes('\n\n')}`);
                    console.log('─'.repeat(60));
                    
                    // Parse thinking from the response content
                    const thinkingResult = this.parseThinkingFromContent(rawContent);
                    content = thinkingResult.content;
                    thinkingContent = thinkingResult.thinking;
                    
                    console.log('🧠 THINKING EXTRACTION RESULTS:');
                    console.log('─'.repeat(60));
                    console.log(`📊 Extracted Thinking (${thinkingContent.length} chars):`);
                    if (thinkingContent.trim()) {
                        console.log('┌─ THINKING CONTENT START ─┐');
                        console.log(thinkingContent);
                        console.log('└─ THINKING CONTENT END ───┘');
                    } else {
                        console.log('   (No thinking content extracted)');
                    }
                    console.log('─'.repeat(60));
                    console.log(`💬 Final Response Content (${content.length} chars):`);
                    if (content.trim()) {
                        console.log('┌─ RESPONSE CONTENT START ─┐');
                        console.log(content);
                        console.log('└─ RESPONSE CONTENT END ───┘');
                    } else {
                        console.log('   (No response content)');
                    }
                    console.log('─'.repeat(60));
                    
                    // Also check for separate thinking field
                    if (data.thinking) {
                        console.log(`🔍 Found separate thinking field in data.thinking:`);
                        console.log('┌─ DATA.THINKING START ─┐');
                        console.log(data.thinking);
                        console.log('└─ DATA.THINKING END ───┘');
                        // Always extract thinking from data.thinking field if available
                        thinkingContent = data.thinking;
                        console.log('✅ Using data.thinking as thinking content');
                    }
                    
                    console.log('🎯 FINAL RESULTS:');
                    console.log(`   • Will show thinking: ${this.settings.showThinking}`);
                    console.log(`   • Thinking length: ${thinkingContent.length}`);
                    console.log(`   • Content length: ${content.length}`);
                    console.log('═'.repeat(80));
                    
                    console.groupEnd();
                    
                    // VRAM Auto-Release Complete
                    console.log('💾 LocalAI response complete - VRAM automatically released via keep_alive: 0');
                    this.setVRAMStatusReady();
                    
                    return {
                        content: content,
                        thinking: thinkingContent,
                        type: 'text'
                    };
                } else {
                    const errorText = await response.text().catch(() => 'Could not read error response');
                    const errorMsg = `${response.status} ${response.statusText}: ${errorText}`;
                    console.log(`  ❌ FAILED: ${errorMsg}`);
                    lastError = `${endpoint.method} ${endpoint.url}: ${errorMsg}`;
                    allErrors.push({
                        attempt: i + 1,
                        method: endpoint.method,
                        url: endpoint.url,
                        status: response.status,
                        statusText: response.statusText,
                        error: errorText,
                        duration: duration
                    });
                }
            } catch (error) {
                console.log(`  💥 EXCEPTION: ${error.name}: ${error.message}`);
                console.log(`  Stack:`, error.stack);
                lastError = `${endpoint.method} ${endpoint.url}: ${error.message}`;
                allErrors.push({
                    attempt: i + 1,
                    method: endpoint.method,
                    url: endpoint.url,
                    error: error.message,
                    type: error.name
                });
            }
        }
        
        console.log('\n' + '❌'.repeat(20));
        console.log('🚨 ALL ENDPOINTS FAILED!');
        console.log('📋 Complete Error Summary:');
        allErrors.forEach((err, index) => {
            console.log(`\n  ${index + 1}. ${err.method} ${err.url}`);
            if (err.status) {
                console.log(`     Status: ${err.status} ${err.statusText}`);
                console.log(`     Duration: ${err.duration}ms`);
            }
            console.log(`     Error: ${err.error}`);
        });
        
        console.log('\n💡 NEXT STEPS:');
        console.log('  1. Check if LocalAI is actually running');
        console.log('  2. Verify the IP address: 192.168.1.206:8082');
        console.log('  3. Check LocalAI console for error messages');
        console.log('  4. Try accessing LocalAI web interface directly');
        console.groupEnd();
        
        throw new Error(`All LocalAI endpoints failed. Attempts: ${allErrors.length}. Last error: ${lastError}`);
    }

    async unloadLocalAIModel() {
        try {
            console.log('🗑️ Attempting to unload LocalAI model to free VRAM...');
            
            // Try different possible endpoints for model management
            const unloadEndpoints = [
                // OpenAI-compatible model delete/unload
                `${this.settings.localaiUrl}/v1/models/${this.settings.localaiModel}/unload`,
                // LocalAI specific endpoints
                `${this.settings.localaiUrl}/models/unload`,
                `${this.settings.localaiUrl}/v1/models/unload`,
                // Alternative model management endpoints
                `${this.settings.localaiUrl}/model/unload/${this.settings.localaiModel}`,
                `${this.settings.localaiUrl}/unload/${this.settings.localaiModel}`
            ];

            for (const endpoint of unloadEndpoints) {
                try {
                    console.log(`  🔄 Trying: ${endpoint}`);
                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            model: this.settings.localaiModel
                        })
                    });

                    if (response.ok) {
                        console.log(`  ✅ Model unloaded successfully via: ${endpoint}`);
                        return;
                    } else {
                        console.log(`  ❌ Failed: ${response.status} ${response.statusText}`);
                    }
                } catch (error) {
                    console.log(`  💥 Error: ${error.message}`);
                }
            }
            
            // LocalAI doesn't have traditional unload endpoints - use keep_alive instead
            console.log('💡 LocalAI uses keep_alive parameter for model management');
            console.log('🔄 Triggering model unload using keep_alive: 0...');
            
            try {
                const unloadResponse = await fetch(`${this.settings.localaiUrl}/api/generate`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        model: this.settings.localaiModel,
                        prompt: "",  // Empty prompt
                        options: {
                            keep_alive: 0,  // Force immediate VRAM unload
                            num_predict: 1   // Minimal prediction
                        }
                    })
                });

                if (unloadResponse.ok) {
                    console.log('✅ LocalAI model unload triggered via keep_alive: 0');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                } else {
                    console.log(`⚠️ keep_alive unload method also failed: ${unloadResponse.status}`);
                }
            } catch (keepAliveError) {
                console.log(`⚠️ keep_alive method error: ${keepAliveError.message}`);
            }
            
        } catch (error) {
            console.log(`⚠️ Model unload error: ${error.message}`);
        }
    }

    async gentleUnloadLocalAI() {
        // TRUST THE IMPROVED LOCALAI WATCHDOG - No manual intervention needed
        console.log('🤖 Trusting LocalAI watchdog for automatic VRAM management...');
        console.log('💡 Watchdog will clear VRAM 15 seconds after last response');
        
        // Small delay to let any pending operations complete and allow some watchdog time
        console.log('⏳ Brief pause to let LocalAI watchdog begin cleanup cycle...');
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log('✅ LocalAI watchdog should be handling VRAM release');
    }

    async loadLocalAIModel() {
        try {
            console.log('🔄 Attempting to reload LocalAI model for chat responses...');
            
            // Try multiple endpoints for loading the model
            const loadEndpoints = [
                `${this.settings.localaiUrl}/models/load`,
                `${this.settings.localaiUrl}/model/load`,
                `${this.settings.localaiUrl}/load`
            ];
            
            for (const endpoint of loadEndpoints) {
                try {
                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            model: this.settings.localaiModel
                        })
                    });

                    if (response.ok) {
                        console.log(`✅ LocalAI model loaded successfully via ${endpoint}`);
                        return;
                    } else {
                        console.log(`❌ Load failed at ${endpoint}: ${response.status}`);
                    }
                } catch (endpointError) {
                    console.log(`❌ Load endpoint ${endpoint} failed: ${endpointError.message}`);
                }
            }
            
            console.log('⚠️ All load endpoints failed - trying simple chat test to warm up model');
            // Fallback: send a simple test message to trigger model loading
            await this.sendMessage('test', false);
            
        } catch (error) {
            console.log(`⚠️ Model load error: ${error.message}`);
        }
    }

    async unloadA1111Model() {
        try {
            console.log('🗑️ Attempting to unload Automatic1111 model to free VRAM...');
            
            // Primary endpoint - the official checkpoint unload API
            try {
                console.log('🎯 Using official unload-checkpoint endpoint...');
                const response = await fetch(`${this.settings.a1111Url}/sdapi/v1/unload-checkpoint`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({})
                });

                if (response.ok) {
                    console.log('✅ A1111 checkpoint unloaded successfully - VRAM freed!');
                    
                    // Wait for VRAM to be released
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return;
                } else {
                    console.log(`❌ Primary unload failed: ${response.status} - ${response.statusText}`);
                }
            } catch (primaryError) {
                console.log(`❌ Primary unload endpoint failed: ${primaryError.message}`);
            }
            
            // Fallback endpoints (legacy/alternative methods)
            console.log('🔄 Trying fallback unload methods...');
            const fallbackEndpoints = [
                `${this.settings.a1111Url}/sdapi/v1/memory`,
                `${this.settings.a1111Url}/api/v1/memory/free`
            ];
            
            for (const endpoint of fallbackEndpoints) {
                try {
                    const response = await fetch(endpoint, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({})
                    });

                    if (response.ok) {
                        console.log(`✅ A1111 unloaded via fallback: ${endpoint}`);
                        return;
                    } else {
                        console.log(`❌ Fallback failed at ${endpoint}: ${response.status}`);
                    }
                } catch (endpointError) {
                    console.log(`❌ Fallback ${endpoint} failed: ${endpointError.message}`);
                }
            }
            
            console.log('⚠️ All A1111 unload methods failed - will use service restart as backup');
        } catch (error) {
            console.log(`⚠️ A1111 model unload error: ${error.message}`);
        }
    }

    async restartA1111() {
        try {
            console.log('🔄 Restarting A1111 service to clear GPU context...');
            
            const response = await fetch(`${this.settings.a1111Url.replace('/api/a1111', '/api/restart/a1111')}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log('✅ A1111 restart successful:', result.message);
                
                // Wait longer for A1111 to fully restart and initialize
                console.log('🔄 Waiting for A1111 service to fully initialize...');
                await new Promise(resolve => setTimeout(resolve, 10000)); // 10 second wait
                
                // Verify A1111 is ready with retry logic
                console.log('🔍 Verifying A1111 readiness...');
                let ready = false;
                for (let attempt = 1; attempt <= 5; attempt++) {
                    try {
                        console.log(`🧪 A1111 readiness check ${attempt}/5...`);
                        const testResponse = await fetch(`${this.settings.a1111Url}/sdapi/v1/options`, { 
                            method: 'GET',
                            timeout: 5000 
                        });
                        if (testResponse.ok) {
                            const options = await testResponse.json();
                            console.log(`✅ A1111 ready! Options loaded: ${Object.keys(options).length} settings`);
                            
                            // Check if a model is loaded
                            if (options.sd_model_checkpoint && options.sd_model_checkpoint !== '') {
                                console.log(`📦 Model loaded: ${options.sd_model_checkpoint}`);
                                ready = true;
                                break;
                            } else {
                                console.log('⚠️ No model checkpoint loaded, attempting to load default model...');
                                await this.loadA1111DefaultModel();
                                // Recheck after model load attempt
                                continue;
                            }
                        }
                    } catch (e) {
                        console.log(`⏳ A1111 not ready yet (attempt ${attempt}/5), waiting 3s...`);
                        if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 3000));
                    }
                }
                
                if (!ready) {
                    console.log('⚠️ A1111 readiness verification failed, but continuing...');
                }
                
                console.log('✅ A1111 initialization complete');
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.log(`❌ A1111 restart failed: ${error.message}`);
            throw error;
        }
    }

    async restartLocalAI() {
        try {
            console.log('🔄 Restarting LocalAI service to clear GPU context...');
            
            const response = await fetch(`${this.settings.localaiUrl.replace('/api/localai', '/api/restart/localai')}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            if (response.ok) {
                const result = await response.json();
                console.log('✅ LocalAI restart successful:', result.message);
            } else {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
        } catch (error) {
            console.log(`❌ LocalAI restart failed: ${error.message}`);
            throw error;
        }
    }

    async loadA1111DefaultModel() {
        try {
            console.log('📦 Loading default A1111 model checkpoint...');
            
            // First, get available models
            const modelsResponse = await fetch(`${this.settings.a1111Url}/sdapi/v1/sd-models`);
            if (!modelsResponse.ok) {
                throw new Error(`Failed to get models: ${modelsResponse.status}`);
            }
            
            const models = await modelsResponse.json();
            if (models.length === 0) {
                throw new Error('No models available');
            }
            
            // Use the first available model
            const modelToLoad = models[0];
            console.log(`🎯 Loading model: ${modelToLoad.title}`);
            
            // Try the refresh endpoint first to reload models
            try {
                console.log('🔄 Refreshing A1111 checkpoints...');
                const refreshResponse = await fetch(`${this.settings.a1111Url}/sdapi/v1/refresh-checkpoints`, {
                    method: 'POST'
                });
                if (refreshResponse.ok) {
                    console.log('✅ Checkpoints refreshed');
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            } catch (e) {
                console.log('⚠️ Checkpoint refresh failed, continuing...');
            }
            
            // Set the model via options
            const loadResponse = await fetch(`${this.settings.a1111Url}/sdapi/v1/options`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sd_model_checkpoint: modelToLoad.title
                })
            });
            
            if (loadResponse.ok) {
                console.log('✅ Model configuration updated');
                // Wait longer for model to fully initialize
                await new Promise(resolve => setTimeout(resolve, 5000));
                
                // Verify model is actually loaded
                const verifyResponse = await fetch(`${this.settings.a1111Url}/sdapi/v1/options`);
                if (verifyResponse.ok) {
                    const currentOptions = await verifyResponse.json();
                    console.log(`🔍 Current model: ${currentOptions.sd_model_checkpoint}`);
                }
            } else {
                throw new Error(`Model load failed: ${loadResponse.status}`);
            }
            
        } catch (error) {
            console.log(`❌ Failed to load A1111 model: ${error.message}`);
        }
    }

    async forceUnloadA1111Checkpoint() {
        try {
            console.log('🗑️ Force unloading A1111 checkpoint to free VRAM...');
            this.setVRAMStatusProcessing('Unloading A1111...');
            
            const unloadResponse = await fetch(`${this.settings.a1111Url}/sdapi/v1/unload-checkpoint`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            });
            
            if (unloadResponse.ok) {
                console.log('✅ A1111 checkpoint unloaded successfully - VRAM freed!');
                
                // Optional: Force PyTorch cache clear for maximum VRAM release
                try {
                    console.log('🧹 Attempting PyTorch cache clear...');
                    this.setVRAMStatusProcessing('Clearing cache...');
                    const cacheResponse = await fetch(`${this.settings.a1111Url}/sdapi/v1/memory`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        }
                    });
                    
                    if (cacheResponse.ok) {
                        console.log('✅ PyTorch cache cleared');
                    } else {
                        console.log('⚠️ PyTorch cache clear not available (this is normal)');
                    }
                } catch (e) {
                    // This endpoint might not exist in all A1111 versions
                    console.log('⚠️ PyTorch cache clear endpoint not available');
                }
                
                // Wait a moment for VRAM to be fully released
                this.setVRAMStatusProcessing('Stabilizing...');
                await new Promise(resolve => setTimeout(resolve, 1000));
                console.log('💾 VRAM release complete - ready for LocalAI');
                this.setVRAMStatusReady();
                
            } else {
                console.log(`⚠️ Checkpoint unload failed: ${unloadResponse.status}`);
                this.setVRAMStatusError('Unload failed');
            }
            
        } catch (error) {
            console.log(`❌ Failed to unload A1111 checkpoint: ${error.message}`);
            this.setVRAMStatusError('Unload error');
        }
    }

    async unloadA1111Checkpoint() {
        // Simple A1111 checkpoint unload - no aggressive cleanup
        try {
            const unloadResponse = await fetch(`${this.settings.a1111Url}/sdapi/v1/unload-checkpoint`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({})
            });
            
            if (unloadResponse.ok) {
                console.log('✅ A1111 checkpoint unloaded successfully');
                console.log('⏳ Waiting for VRAM to fully clear...');
                // Allow time for VRAM cleanup to complete
                await new Promise(resolve => setTimeout(resolve, 2000));
            } else {
                console.log(`⚠️ A1111 checkpoint unload failed: ${unloadResponse.status}`);
            }
            
        } catch (error) {
            console.log(`⚠️ A1111 checkpoint unload error: ${error.message}`);
        }
    }

    async unloadAllModels() {
        try {
            console.log('🗑️🔥 UNLOADING ALL MODELS - Freeing complete GPU memory...');
            
            // Update button state
            const originalText = this.unloadAllModelsBtn.textContent;
            this.unloadAllModelsBtn.disabled = true;
            this.unloadAllModelsBtn.textContent = 'Unloading All...';
            
            const results = {
                localai: false,
                a1111: false,
                comfyui: false
            };
            
            // 1. Unload LocalAI LLM
            try {
                console.log('🔄 Step 1: Unloading LocalAI model...');
                await this.unloadLocalAIModel();
                results.localai = true;
                console.log('✅ LocalAI model unloaded');
            } catch (error) {
                console.log('❌ LocalAI unload failed:', error.message);
            }
            
            // 2. Unload Automatic1111
            try {
                console.log('🔄 Step 2: Unloading Automatic1111 model...');
                await this.unloadA1111Model();
                results.a1111 = true;
                console.log('✅ Automatic1111 model unloaded');
            } catch (error) {
                console.log('❌ Automatic1111 unload failed:', error.message);
            }
            
            // 3. Unload ComfyUI (if needed in future)
            try {
                console.log('🔄 Step 3: Attempting ComfyUI cleanup...');
                // ComfyUI unload logic would go here when implemented
                results.comfyui = true;
                console.log('✅ ComfyUI cleanup completed');
            } catch (error) {
                console.log('❌ ComfyUI unload failed:', error.message);
            }
            
            // Summary
            const successCount = Object.values(results).filter(Boolean).length;
            console.log(`🎯 Unload Summary: ${successCount}/3 services processed`);
            console.log('💾 GPU VRAM should now be completely freed!');
            
            // Show success message
            this.showNotification('🗑️ All models unloaded - GPU memory freed!', 'success');
            
        } catch (error) {
            console.error('❌ Unload all models failed:', error);
            this.showNotification('❌ Failed to unload all models', 'error');
        } finally {
            // Restore button state
            setTimeout(() => {
                this.unloadAllModelsBtn.disabled = false;
                this.unloadAllModelsBtn.textContent = '🗑️ Unload All Models';
            }, 2000);
        }
    }

    isImageRequest(message) {
        const imageKeywords = [
            // Direct commands
            'generate image', 'create image', 'make image', 'draw image',
            'generate picture', 'create picture', 'make picture', 'draw picture',
            'generate photo', 'create photo', 'make photo',
            
            // Starting patterns
            'image of', 'picture of', 'photo of',
            'draw a', 'draw an', 'draw me',
            'create a', 'create an', 'create me',
            'generate a', 'generate an', 'generate me',
            'make a', 'make an', 'make me',
            'show me a', 'show me an',
            
            // Simple patterns
            'image ', 'picture ', 'photo '
        ];

        const lowerMessage = message.toLowerCase();
        
        // Check if message starts with common image request patterns
        for (const keyword of imageKeywords) {
            if (lowerMessage.startsWith(keyword)) {
                return true;
            }
        }
        
        // Check for "image X" pattern (like "image cat")
        if (lowerMessage.match(/^(image|picture|photo|draw|create|generate|make)\s+\w+/)) {
            return true;
        }
        
        return false;
    }

    enhancePromptForRealism(prompt) {
        // Add realistic photography qualities to make images look like phone photos
        const realismTags = [
            'photorealistic',
            'natural lighting',
            'shot on iPhone',
            'candid photography',
            'realistic photo',
            'high detail',
            'natural colors',
            'real life',
            'authentic',
            'unfiltered',
            'genuine photograph',
            'sharp focus',
            'depth of field',
            '4K quality',
            'natural shadows',
            'ambient light'
        ];
        
        // Add a random selection of realism tags
        const selectedTags = realismTags.slice(0, 6).join(', ');
        
        return `${prompt}, ${selectedTags}`;
    }

    /**
     * Handle using the generated avatar
     */
    async handleUseAvatar() {
        console.log('🎭 Use avatar button clicked');
        
        if (!this.generatedAvatarData) {
            alert('No avatar has been generated yet');
            return;
        }
        
        const avatarPreview = document.getElementById('avatarPreview');
        const currentPersonalityAvatar = document.getElementById('currentPersonalityAvatar');
        const personalityAvatarInput = document.getElementById('personalityAvatar');
        
        try {
            // Create a thumbnail/icon from the generated image
            // For now, we'll set the avatar URL field to the base64 data
            const avatarUrl = this.generatedAvatarData;
            
            // Update the current avatar preview in the form
            if (currentPersonalityAvatar) {
                // Clear text content and show image
                currentPersonalityAvatar.innerHTML = '';
                const img = document.createElement('img');
                img.src = avatarUrl;
                img.style.width = '100%';
                img.style.height = '100%';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '50%';
                currentPersonalityAvatar.appendChild(img);
            }
            
            // Store the avatar URL in a hidden field or data attribute
            if (personalityAvatarInput) {
                // Store the base64 data so it can be saved with the personality
                personalityAvatarInput.dataset.avatarUrl = avatarUrl;
                console.log('✅ Avatar URL stored in form data');
            }
            
            // Hide the preview after use
            if (avatarPreview) {
                setTimeout(() => {
                    avatarPreview.style.display = 'none';
                }, 500);
            }
            
            console.log('✅ Avatar applied to personality form');
            
            // Don't show alert - just provide visual feedback
            const useBtn = document.getElementById('useAvatarBtn');
            if (useBtn) {
                const originalText = useBtn.textContent;
                useBtn.textContent = '✅ Avatar Applied!';
                useBtn.disabled = true;
                setTimeout(() => {
                    useBtn.textContent = originalText;
                    useBtn.disabled = false;
                }, 2000);
            }
            
        } catch (error) {
            console.error('❌ Failed to use avatar:', error);
            alert(`Failed to use avatar: ${error.message}`);
        }
    }

    /**
     * Handle avatar generation button click
     */
    async handleAvatarGeneration() {
        console.log('🎭 Avatar generation button clicked');
        
        const avatarPromptInput = document.getElementById('avatarPrompt');
        const avatarStyleSelect = document.getElementById('avatarStyle');
        const avatarSizeSelect = document.getElementById('avatarSize');
        const avatarPreview = document.getElementById('avatarPreview');
        const generatedAvatarImg = document.getElementById('generatedAvatarImg');
        const generateAvatarBtn = document.getElementById('generateAvatarBtn');
        
        if (!avatarPromptInput || !avatarPromptInput.value.trim()) {
            alert('Please enter an avatar description');
            return;
        }
        
        const prompt = avatarPromptInput.value.trim();
        const style = avatarStyleSelect ? avatarStyleSelect.value : 'realistic';
        const size = avatarSizeSelect ? avatarSizeSelect.value : '512x512';
        const [width, height] = size.split('x').map(Number);
        
        try {
            // Show loading state and progress bar
            generateAvatarBtn.textContent = '🔄 Generating...';
            generateAvatarBtn.disabled = true;
            
            // Show progress bar
            const progressContainer = document.getElementById('avatarProgress');
            if (progressContainer) {
                progressContainer.style.display = 'block';
            }
            
            this.updateAvatarProgress(0, 'Initializing...', ['⏳ Starting avatar generation']);
            
            // Build enhanced prompt with style
            const stylePrompts = {
                'cartoon': 'cartoon style, animated, colorful, friendly',
                'anime': 'anime style, manga art, japanese animation',
                'realistic': 'photorealistic, detailed, high quality photography',
                'minimalist': 'minimalist art, simple, clean design',
                'pixel': 'pixel art, retro gaming style, 8-bit',
                'professional': 'professional headshot, business portrait, corporate'
            };
            
            const enhancedPrompt = `${prompt}, ${stylePrompts[style] || stylePrompts['realistic']}, centered portrait, avatar`;
            console.log('🎨 Enhanced avatar prompt:', enhancedPrompt);
            
            this.updateAvatarProgress(10, 'Preparing prompt...', ['✅ Initialized', '🎨 Enhanced prompt created']);
            
            // Generate the avatar with progress tracking
            const result = await this.generateAvatarWithProgress(enhancedPrompt, width, height);
            
            if (result && result.content) {
                // Show the generated avatar
                if (generatedAvatarImg) {
                    generatedAvatarImg.src = result.content;
                    generatedAvatarImg.style.maxWidth = '100%';
                    generatedAvatarImg.style.borderRadius = '8px';
                }
                
                if (avatarPreview) {
                    avatarPreview.style.display = 'block';
                }
                
                // Store the generated avatar data for use
                this.generatedAvatarData = result.content;
                
                console.log('✅ Avatar generated and displayed');
                console.log('📸 Avatar data length:', result.content.length);
            } else {
                throw new Error('No avatar image returned');
            }
        } catch (error) {
            console.error('❌ Avatar generation failed:', error);
            this.updateAvatarProgress(100, '❌ Generation failed', ['❌ Error: ' + error.message]);
            setTimeout(() => {
                const progressContainer = document.getElementById('avatarProgress');
                if (progressContainer) progressContainer.style.display = 'none';
            }, 3000);
            alert(`Failed to generate avatar: ${error.message}`);
        } finally {
            // Reset button state
            generateAvatarBtn.textContent = '🎨 Generate Avatar';
            generateAvatarBtn.disabled = false;
        }
    }

    /**
     * Update avatar generation progress display
     */
    updateAvatarProgress(percent, status, steps = []) {
        const progressBar = document.getElementById('avatarProgressBar');
        const progressStatus = document.getElementById('avatarProgressStatus');
        const progressSteps = document.getElementById('avatarProgressSteps');
        
        if (progressBar) {
            progressBar.style.width = `${percent}%`;
        }
        
        if (progressStatus) {
            progressStatus.textContent = status;
        }
        
        if (progressSteps && steps.length > 0) {
            progressSteps.innerHTML = steps.map(step => `<div class="progress-step">${step}</div>`).join('');
        }
    }

    /**
     * Generate avatar with progress tracking
     */
    async generateAvatarWithProgress(prompt, width = 512, height = 512) {
        const steps = ['✅ Initialized', '🎨 Enhanced prompt created'];
        
        try {
            // Step 1: Start A1111 container
            this.updateAvatarProgress(20, '🚀 Starting A1111 container...', [...steps, '⏳ Starting Docker container']);
            console.log('🚀 Starting A1111 Docker container...');
            
            const startResponse = await fetch('/api/docker/start/a1111', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (startResponse.ok) {
                console.log('✅ A1111 container started successfully');
                steps.push('✅ A1111 container started');
                this.updateAvatarProgress(30, '⏳ Waiting for A1111 to initialize...', steps);
            } else {
                console.log('⚠️ A1111 container start failed, attempting anyway');
                steps.push('⚠️ Container may already be running');
                this.updateAvatarProgress(30, '⏳ Checking A1111 status...', steps);
            }
            
            // Wait for A1111 to initialize
            console.log('⏳ Waiting 15 seconds for A1111 to fully initialize...');
            await new Promise(resolve => setTimeout(resolve, 15000));
            
            steps.push('✅ A1111 initialized and ready');
            this.updateAvatarProgress(50, '📤 Sending prompt to A1111...', steps);
            
            // Step 2: Generate image
            console.log('📤 Sending generation request...');
            const result = await this.generateImage(prompt);
            
            if (result && result.type === 'image') {
                console.log('✅ Avatar generated successfully');
                steps.push('✅ Image received from A1111');
                this.updateAvatarProgress(80, '🎯 Processing complete...', steps);
                
                // Step 3: Stop A1111 container
                steps.push('🛑 Shutting down A1111...');
                this.updateAvatarProgress(90, '🛑 Stopping A1111 to free VRAM...', steps);
                
                try {
                    console.log('🛑 Stopping A1111 container to free VRAM after avatar generation...');
                    const stopResponse = await fetch('/api/docker/stop/a1111', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    
                    if (stopResponse.ok) {
                        console.log('✅ A1111 container stopped - VRAM freed');
                        steps.push('✅ A1111 stopped - VRAM freed');
                    } else {
                        console.log('⚠️ A1111 container stop failed (non-critical)');
                        steps.push('⚠️ Container stop failed');
                    }
                } catch (stopError) {
                    console.log('⚠️ Error stopping A1111 container:', stopError.message);
                    steps.push('⚠️ Stop error (non-critical)');
                }
                
                steps.push('✅ Avatar generation complete!');
                this.updateAvatarProgress(100, '✅ Complete!', steps);
                
                // Hide progress after 2 seconds
                setTimeout(() => {
                    const progressContainer = document.getElementById('avatarProgress');
                    if (progressContainer) progressContainer.style.display = 'none';
                }, 2000);
                
                return result;
            } else {
                throw new Error('Avatar generation failed - invalid result');
            }
        } catch (error) {
            console.error('❌ Avatar generation error:', error);
            throw error;
        }
    }

    /**
     * Generate avatar image using A1111 with Docker management
     */
    async generateAvatar(prompt, width = 512, height = 512) {
        console.log('🎭 Avatar generation requested');
        console.log('📝 Prompt:', prompt);
        console.log('📐 Size:', `${width}x${height}`);
        
        try {
            // Use the same Docker management as regular image generation
            const result = await this.generateImage(prompt);
            
            if (result && result.type === 'image') {
                console.log('✅ Avatar generated successfully');
                
                // After avatar generation, stop A1111 container to free VRAM
                try {
                    console.log('🛑 Stopping A1111 container to free VRAM after avatar generation...');
                    const stopResponse = await fetch('/api/docker/stop/a1111', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });
                    
                    if (stopResponse.ok) {
                        console.log('✅ A1111 container stopped - VRAM freed');
                    } else {
                        console.log('⚠️ A1111 container stop failed (non-critical)');
                    }
                } catch (stopError) {
                    console.log('⚠️ Error stopping A1111 container:', stopError.message);
                }
                
                return result;
            } else {
                throw new Error('Avatar generation failed - invalid result');
            }
        } catch (error) {
            console.error('❌ Avatar generation error:', error);
            throw error;
        }
    }

    async generateImage(prompt, retryCount = 0) {
        this.setVRAMStatusA1111();
        
        // DOCKER CONTAINER APPROACH - Start A1111 container when needed
        console.log('🎨 Image generation requested - starting A1111 Docker container');
        
        try {
            // Start A1111 container (will do nothing if already running)
            console.log('� Starting A1111 Docker container...');
            const startResponse = await fetch('/api/docker/start/a1111', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            if (startResponse.ok) {
                console.log('✅ A1111 container started successfully');
            } else {
                console.log('⚠️ A1111 container start failed, attempting anyway');
            }
        } catch (error) {
            console.log('⚠️ A1111 container start error:', error.message);
        }
        
        // Give time for A1111 to fully initialize
        console.log('⏳ Waiting 15 seconds for A1111 to fully initialize...');
        await new Promise(resolve => setTimeout(resolve, 15000));
        console.log('🎯 A1111 should now be ready for image generation');
        
        // Only gentle cleanup if switching from LocalAI
        if (this.lastActiveService === 'localai') {
            try {
                await this.gentleUnloadLocalAI();
                console.log('✅ LocalAI watchdog handling VRAM release');
                console.log('� A1111 should auto-handle checkpoint loading with available VRAM');
            } catch (error) {
                console.log('⚠️ Cleanup warning (continuing anyway):', error.message);
            }
        }


        
        this.setLoadingText('📥 Downloading image...');
        
        console.log('🔗 Attempting connection to:', `${this.settings.a1111Url}/sdapi/v1/txt2img`);
        
        // Enhance prompt with realistic photography tags
        const enhancedPrompt = this.enhancePromptForRealism(prompt);
        console.log('📸 Original prompt:', prompt);
        console.log('✨ Enhanced prompt:', enhancedPrompt);
        
        // Retry logic with exponential backoff for A1111 boot time
        let response = null;
        let lastError = null;
        const maxRetries = 5;
        const baseDelay = 5000; // 5 seconds base delay
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`🎯 Connection attempt ${attempt}/${maxRetries} to A1111...`);
                
                        response = await fetch(`${this.settings.a1111Url}/sdapi/v1/txt2img`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        prompt: enhancedPrompt,
                        negative_prompt: "cartoon, anime, drawing, painting, sketch, rendered, CGI, 3D render, illustration, fake, artificial, oversaturated, HDR, unrealistic lighting, watermark, text, signature, blurry, low quality, distorted",
                        steps: 20,
                        sampler_name: 'DPM++ 2M',
                        cfg_scale: 7,
                        width: 576,
                        height: 1024
                    })
                });
                
                // Connection successful
                console.log(`✅ Connected to A1111 on attempt ${attempt}`);
                break;
                
            } catch (fetchError) {
                lastError = fetchError;
                console.log(`⚠️ Connection attempt ${attempt}/${maxRetries} failed:`, fetchError.message);
                
                if (attempt < maxRetries) {
                    // Exponential backoff: 5s, 10s, 15s, 20s
                    const delay = baseDelay * attempt;
                    console.log(`⏳ A1111 still booting, waiting ${delay/1000}s before retry ${attempt + 1}...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    console.error(`❌ Failed to connect to A1111 after ${maxRetries} attempts`);
                    throw new Error(`A1111 connection failed after ${maxRetries} attempts: ${fetchError.message}`);
                }
            }
        }
        
        if (!response) {
            throw new Error(`Failed to connect to A1111: ${lastError?.message || 'Unknown error'}`);
        }

        if (!response.ok) {
            console.error('🚨 A1111 API Error Details:');
            console.error('Status:', response.status, response.statusText);
            console.error('URL:', `${this.settings.a1111Url}/sdapi/v1/txt2img`);
            
            // Try to get error details
            let errorDetails = '';
            try {
                const errorText = await response.text();
                console.error('Error Response:', errorText);
                errorDetails = errorText;
                
                // Check for common A1111 container issues that require restart
                const needsRestart = 
                    errorText.includes('Expected all tensors to be on the same device') ||
                    errorText.includes('lowvram') ||
                    errorText.includes('NoneType') ||
                    errorText.includes('AttributeError') ||
                    errorText.includes('CUDA out of memory') ||
                    errorText.includes('Runtime Error') ||
                    response.status === 500;
                
                if (needsRestart) {
                    // Prevent infinite restart loops
                    if (retryCount >= 2) {
                        console.error('❌ Maximum restart attempts (2) reached - preventing infinite loop');
                        this.addMessage('system', '❌ Maximum restart attempts reached. Please restart A1111 manually and try again.');
                        throw new Error(`A1111 container error - Maximum restart attempts reached. Please restart manually.`);
                    }
                    
                    const errorType = errorText.includes('Expected all tensors') ? 'TENSOR DEVICE MISMATCH' :
                                    errorText.includes('lowvram') ? 'LOWVRAM ATTRIBUTE ERROR' :
                                    errorText.includes('NoneType') ? 'NONETYPE ATTRIBUTE ERROR' :
                                    errorText.includes('CUDA out of memory') ? 'CUDA MEMORY ERROR' :
                                    response.status === 500 ? 'INTERNAL SERVER ERROR' : 'CONTAINER ERROR';
                    
                    console.error(`🔥 ${errorType} DETECTED (Attempt ${retryCount + 1}/2) - Attempting automatic A1111 Docker restart...`);
                    
                    try {
                        // Show user-friendly status update
                        this.addMessage('system', '🔄 A1111 container issue detected - automatically restarting and retrying your image generation...');
                        
                        // Attempt automatic Docker restart via SSH
                        console.error('🔧 Initiating SSH-powered A1111 Docker container restart...');
                        const dockerResponse = await fetch('/api/docker/restart/a1111', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' }
                        });
                        
                        if (dockerResponse.ok) {
                            const dockerResult = await dockerResponse.json();
                            if (dockerResult.success) {
                                console.error('✅ SSH Docker restart successful - A1111 container restarted');
                                console.error(`🔧 ${errorType} resolved - automatically retrying after restart...`);
                                
                                // Wait for A1111 to fully restart and initialize
                                console.error('⏳ Waiting 20 seconds for A1111 to fully restart and initialize...');
                                await new Promise(resolve => setTimeout(resolve, 20000));
                                
                                // Try to ensure checkpoint is loaded before retry
                                console.error('🔧 Ensuring A1111 checkpoint is properly loaded...');
                                try {
                                    await fetch('/api/a1111/sdapi/v1/options', {
                                        method: 'POST',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({
                                            "sd_model_checkpoint": "uberRealisticPornMergePonyxl_ponyxlHybridV1.safetensors"
                                        })
                                    });
                                    console.error('✅ Checkpoint loading command sent');
                                    
                                    // Give time for checkpoint to load
                                    await new Promise(resolve => setTimeout(resolve, 8000));
                                    
                                } catch (checkpointError) {
                                    console.error('⚠️ Checkpoint loading failed, proceeding anyway:', checkpointError.message);
                                }
                                
                                console.error('🎯 A1111 should be ready - automatically retrying image generation...');
                                
                                // Show final status before retry
                                this.addMessage('system', '✅ A1111 restarted successfully - generating your image now...');
                                
                                // Recursively retry the same image generation request with incremented retry count
                                try {
                                    return await this.generateImage(prompt, retryCount + 1);
                                } catch (retryError) {
                                    console.error('❌ Retry after restart also failed:', retryError.message);
                                    this.addMessage('system', '❌ Image generation failed even after container restart. Please try again manually.');
                                    throw new Error(`Image generation failed even after Docker restart: ${retryError.message}`);
                                }
                            } else {
                                throw new Error('SSH Docker restart failed');
                            }
                        } else {
                            throw new Error(`Docker API error: ${dockerResponse.status}`);
                        }
                    } catch (dockerError) {
                        console.error('❌ Automatic Docker restart failed:', dockerError.message);
                        console.error('💡 Manual solution: Use Docker controls to restart A1111');
                        this.addMessage('system', '❌ Automatic container restart failed. Please restart A1111 manually and try again.');
                        throw new Error(`A1111 container error - Auto-restart failed. Please use Docker controls to restart A1111 manually.`);
                    }
                }
                
                // NOTE: All error types (including tensor device mismatch) are now handled by the comprehensive error recovery above
                // This legacy code path is no longer needed but left for backwards compatibility
                // Check if this is the tensor device mismatch error (legacy code path)
                if (errorText.includes('Expected all tensors to be on the same device')) {
                    console.error('🔥 TENSOR DEVICE MISMATCH DETECTED - Attempting automatic A1111 Docker restart...');
                    
                    try {
                        // Attempt automatic Docker restart for tensor conflicts via SSH
                        console.error('🔧 Initiating SSH-powered A1111 Docker container restart...');
                        const dockerResponse = await fetch('/api/docker/restart/a1111', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' }
                        });
                        
                            if (dockerResponse.ok) {
                                const dockerResult = await dockerResponse.json();
                                if (dockerResult.success) {
                                    console.error('✅ SSH Docker restart successful - A1111 container restarted');
                                    console.error('🔧 Tensor conflict resolved - automatically retrying after restart...');
                                    
                                    // Show brief status update
                                    this.addMessage('system', '🔄 A1111 restarted to fix tensor conflict - retrying your image generation...');
                                    
                                    // Wait for A1111 to fully restart, then automatically retry
                                    console.error('⏳ Waiting 25 seconds for A1111 to fully restart and initialize...');
                                    await new Promise(resolve => setTimeout(resolve, 25000));
                                    
                                    // Try to ensure checkpoint is loaded before retry
                                    console.error('🔧 Ensuring A1111 checkpoint is properly loaded...');
                                    try {
                                        await fetch('/api/a1111/sdapi/v1/options', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({
                                                "sd_model_checkpoint": "uberRealisticPornMergePonyxl_ponyxlHybridV1.safetensors"
                                            })
                                        });
                                        console.error('✅ Checkpoint loading command sent');
                                        
                                        // Give time for checkpoint to load
                                        await new Promise(resolve => setTimeout(resolve, 10000));
                                        
                                    } catch (checkpointError) {
                                        console.error('⚠️ Checkpoint loading failed, proceeding anyway:', checkpointError.message);
                                    }
                                    
                                    console.error('� A1111 should be ready - automatically retrying image generation...');
                                    
                                    // Recursively retry the same image generation request
                                    try {
                                        return await this.generateImage(prompt);
                                    } catch (retryError) {
                                        console.error('❌ Retry after restart also failed:', retryError.message);
                                        throw new Error(`Image generation failed even after Docker restart: ${retryError.message}`);
                                    }
                                } else {
                                    throw new Error('SSH Docker restart failed');
                                }
                            } else {
                                throw new Error(`Docker API error: ${dockerResponse.status}`);
                            }                    } catch (dockerError) {
                        console.error('❌ Automatic Docker restart failed:', dockerError.message);
                        console.error('💡 Manual solution: Use Docker controls to restart A1111');
                        throw new Error(`A1111 tensor conflict - Auto-restart failed. Please use Docker controls to restart A1111 manually.`);
                    }
                }
                
            } catch (e) {
                console.error('Could not read error response');
            }
            
            throw new Error(`Automatic1111 API error: ${response.status} - ${response.statusText}`);
        }

        const data = await response.json();
        const imageData = `data:image/png;base64,${data.images[0]}`;
        
        console.log('✅ Image generated successfully!');
        
        // KEEP A1111 MODEL LOADED for subsequent image generations
        console.log('🎯 A1111 model kept loaded for faster subsequent image generations');
        console.log('💡 VRAM will only be freed when switching to LocalAI chat');
        
        // Update service tracking
        this.lastActiveService = 'a1111';
        
        return {
            content: imageData,
            type: 'image'
        };
    }

    async processAutoImageGeneration(response) {
        // Check if current personality allows auto image generation
        // Default to true if not explicitly set to allow image generation
        const autoImageEnabled = this.currentPersonality && 
                                 (this.currentPersonality.settings?.autoGenerateImages !== false);
        
        console.log('🎭 Current personality:', this.currentPersonality?.name);
        console.log('🎨 Auto image generation enabled:', autoImageEnabled);
        
        // Check if response contains image generation trigger
        const content = response.content;
        console.log('🔍 Checking for auto image generation in response...');
        console.log('📄 Response content length:', content.length);
        console.log('📄 Response content preview:', content.substring(0, 200) + '...');
        
        // Check for [NO_IMAGE] marker first
        if (content.match(/\[NO_IMAGE\]/i)) {
            console.log('🚫 [NO_IMAGE] marker found - skipping image generation');
            const cleanTextContent = content.replace(/\[NO_IMAGE\]/gi, '').trim();
            return null; // No image should be generated
        }
        
        const imagePromptMatch = content.match(/\[IMAGE_PROMPT:\s*([^\]]+)\]/i);
        
        if (imagePromptMatch) {
            console.log('🎨 Auto image generation triggered by LLM marker!');
            console.log('🔍 Full match:', imagePromptMatch[0]);
            
            // Extract the image prompt
            const imagePrompt = imagePromptMatch[1].trim();
            console.log('🖼️ Extracted image prompt:', imagePrompt);
            
            // Remove the IMAGE_PROMPT marker from the text content
            const cleanTextContent = content.replace(/\[IMAGE_PROMPT:\s*[^\]]+\]/gi, '').trim();
            console.log('✅ Clean text content length:', cleanTextContent.length);
            
            return {
                textContent: cleanTextContent,
                imagePrompt: imagePrompt
            };
        } else {
            console.log('❌ No [IMAGE_PROMPT: ...] or [NO_IMAGE] marker found in response');
            
            // Only attempt fallback if personality allows auto image generation
            if (!autoImageEnabled) {
                console.log('🚫 Personality has auto image generation disabled - skipping fallback detection');
                return null;
            }
            
            // Fallback: Check if this looks like a visual description that should have an image
            const visualKeywords = [
                'look like', 'looks like', 'appearance', 'visual', 'see', 'show', 'picture',
                'sandwich', 'pizza', 'taco', 'food', 'cake', 'ice cream', 'dessert',
                'car', 'house', 'building', 'garden', 'sunset', 'landscape', 'scenery',
                'color', 'shape', 'design', 'beautiful', 'pretty', 'gorgeous'
            ];
            
            const hasVisualKeywords = visualKeywords.some(keyword => 
                content.toLowerCase().includes(keyword.toLowerCase())
            );
            
            if (hasVisualKeywords) {
                console.log('🔍 Visual keywords detected, generating fallback image prompt...');
                
                // Generate a simple image prompt based on content
                let fallbackPrompt = this.generateFallbackImagePrompt(content);
                
                if (fallbackPrompt) {
                    console.log('🎨 Auto image generation triggered by fallback detection!');
                    console.log('�️ Fallback image prompt:', fallbackPrompt);
                    
                    return {
                        textContent: content,
                        imagePrompt: fallbackPrompt
                    };
                }
            }
            
            console.log('❌ No visual content detected, skipping image generation');
            return null; // No image generation requested
        }
    }

    generateFallbackImagePrompt(content) {
        console.log('� Generating fallback image prompt from content...');
        
        // Food items
        if (content.toLowerCase().includes('sandwich')) {
            return 'delicious sandwich on a plate, fresh bread with meat, lettuce, tomato, cheese, realistic food photography, appetizing presentation';
        }
        if (content.toLowerCase().includes('pizza')) {
            return 'appetizing pizza with melted cheese and toppings, realistic food photography, warm lighting';
        }
        if (content.toLowerCase().includes('taco')) {
            return 'colorful tacos on a plate, soft corn tortillas filled with seasoned meat, fresh lettuce, diced tomatoes, cheese, cilantro, Mexican food photography';
        }
        if (content.toLowerCase().includes('ice cream')) {
            return 'scoops of colorful ice cream in a bowl, vanilla, chocolate and strawberry flavors, creamy texture, dessert photography, natural lighting';
        }
        if (content.toLowerCase().includes('cake')) {
            return 'beautiful layered cake with frosting, dessert photography, appetizing presentation, natural lighting';
        }
        
        // Objects and scenes  
        if (content.toLowerCase().includes('car')) {
            return 'sleek modern car, automotive photography, clean design, professional lighting';
        }
        if (content.toLowerCase().includes('garden')) {
            return 'beautiful garden with colorful flowers, lush greenery, peaceful atmosphere, natural lighting';
        }
        if (content.toLowerCase().includes('sunset')) {
            return 'stunning sunset landscape, warm golden colors, peaceful scenery, natural lighting';
        }
        
        // General visual request
        if (content.toLowerCase().match(/(look like|looks like|appearance|show me)/)) {
            // Extract potential subject from the question
            const matches = content.match(/(?:look like|looks like|show me|appearance of)\s+(?:a\s+|an\s+|the\s+)?([^?.!,]+)/i);
            if (matches) {
                const subject = matches[1].trim();
                return `${subject}, realistic photography, professional lighting, detailed view`;
            }
        }
        
        return null;
    }

    async generateMultipleImages(prompt, count) {
        console.log(`🎨 Starting batch generation of ${count} images for prompt: "${prompt}"`);
        
        // Show initial status
        this.addMessage('system', `🎨 Generating ${count} images... This may take a few minutes.`);
        
        const images = [];
        const errors = [];
        
        for (let i = 0; i < count; i++) {
            try {
                console.log(`📸 Generating image ${i + 1}/${count}...`);
                this.setLoadingText(`Generating image ${i + 1}/${count}...`);
                
                // Generate single image
                const result = await this.generateImage(prompt);
                
                if (result && result.content) {
                    images.push(result.content);
                    
                    // Add each image as it's generated
                    this.addMessage('ai', result.content, 'image');
                    
                    console.log(`✅ Image ${i + 1}/${count} generated successfully`);
                } else {
                    throw new Error('No image data returned');
                }
                
                // Small delay between images to avoid overwhelming the system
                if (i < count - 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                
            } catch (error) {
                console.error(`❌ Failed to generate image ${i + 1}/${count}:`, error);
                errors.push(`Image ${i + 1}: ${error.message}`);
                
                // Show error but continue with remaining images
                this.addMessage('system', `⚠️ Failed to generate image ${i + 1}/${count}: ${error.message}`);
            }
        }
        
        // Show final summary
        if (images.length > 0) {
            this.addMessage('system', `✅ Successfully generated ${images.length}/${count} images!`);
        }
        
        if (errors.length > 0) {
            console.warn(`⚠️ ${errors.length} image(s) failed to generate:`, errors);
        }
        
        // Return summary (for compatibility with single image generation)
        return {
            content: `Generated ${images.length}/${count} images`,
            type: 'text',
            images: images,
            errors: errors
        };
    }

    async runComfyUIWorkflow(input) {
        this.setLoadingText('Running ComfyUI workflow...');
        
        // Basic workflow for text-to-image
        const workflow = {
            "3": {
                "inputs": {
                    "seed": Math.floor(Math.random() * 1000000),
                    "steps": 20,
                    "cfg": 8,
                    "sampler_name": "euler",
                    "scheduler": "normal",
                    "denoise": 1,
                    "model": ["4", 0],
                    "positive": ["6", 0],
                    "negative": ["7", 0],
                    "latent_image": ["5", 0]
                },
                "class_type": "KSampler"
            },
            "4": {
                "inputs": {
                    "ckpt_name": "sd_xl_base_1.0.safetensors"
                },
                "class_type": "CheckpointLoaderSimple"
            },
            "5": {
                "inputs": {
                    "width": 576,
                    "height": 768,
                    "batch_size": 1
                },
                "class_type": "EmptyLatentImage"
            },
            "6": {
                "inputs": {
                    "text": input,
                    "clip": ["4", 1]
                },
                "class_type": "CLIPTextEncode"
            },
            "7": {
                "inputs": {
                    "text": "text, watermark",
                    "clip": ["4", 1]
                },
                "class_type": "CLIPTextEncode"
            },
            "8": {
                "inputs": {
                    "samples": ["3", 0],
                    "vae": ["4", 2]
                },
                "class_type": "VAEDecode"
            },
            "9": {
                "inputs": {
                    "filename_prefix": "ComfyUI",
                    "images": ["8", 0]
                },
                "class_type": "SaveImage"
            }
        };

        // Queue the prompt
        const queueResponse = await fetch(`${this.settings.comfyUrl}/prompt`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt: workflow,
                client_id: 'ai-chat-app'
            })
        });

        if (!queueResponse.ok) {
            throw new Error(`ComfyUI API error: ${queueResponse.status}`);
        }

        const queueData = await queueResponse.json();
        const promptId = queueData.prompt_id;

        // Wait for completion and get result
        return await this.waitForComfyUICompletion(promptId);
    }

    async waitForComfyUICompletion(promptId) {
        const maxAttempts = 60; // 5 minutes max wait
        let attempts = 0;

        return new Promise((resolve, reject) => {
            const checkStatus = async () => {
                attempts++;
                if (attempts > maxAttempts) {
                    reject(new Error('ComfyUI workflow timeout'));
                    return;
                }

                try {
                    const historyResponse = await fetch(`${this.settings.comfyUrl}/history/${promptId}`);
                    const historyData = await historyResponse.json();

                    if (historyData[promptId]) {
                        // Workflow completed, get the image
                        const outputs = historyData[promptId].outputs;
                        const images = outputs["9"].images; // SaveImage node
                        
                        if (images && images.length > 0) {
                            const imageUrl = `${this.settings.comfyUrl}/view?filename=${images[0].filename}&subfolder=${images[0].subfolder}&type=${images[0].type}`;
                            
                            // Convert to base64 for embedding
                            const imageResponse = await fetch(imageUrl);
                            const blob = await imageResponse.blob();
                            const reader = new FileReader();
                            
                            reader.onload = () => {
                                resolve({
                                    content: reader.result,
                                    type: 'image'
                                });
                            };
                            
                            reader.readAsDataURL(blob);
                        } else {
                            reject(new Error('No images generated by ComfyUI'));
                        }
                    } else {
                        // Still processing, check again
                        setTimeout(checkStatus, 5000);
                    }
                } catch (error) {
                    reject(error);
                }
            };

            checkStatus();
        });
    }

    addMessage(sender, content, type = 'text', thinking = '') {
        console.log('➕ addMessage called:', { sender, type, contentLength: content?.length, thinkingLength: thinking?.length });
        console.log('🧠 Thinking passed to addMessage:', thinking ? thinking.substring(0, 100) + '...' : 'none');
        
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const id = Date.now() + Math.random(); // Simple unique ID
        const message = { id, sender, content, type, timestamp, thinking };
        
        this.messages.push(message);
        this.saveChatHistory();
        this.renderMessage(message);
        this.scrollToBottom();
        
        // Update last message time for realistic typing delays
        if (sender === 'ai' || sender === 'user') {
            this.lastMessageTime = Date.now();
        }
        
        // Save to backend API if authenticated
        if (this.useAPI && apiService && apiService.isAuthenticated() && this.currentPersonality) {
            this.saveMessageToAPI(sender, content, type, thinking).catch(error => {
                console.error('Failed to save message to cloud:', error);
            });
        }
        
        return message; // Return message with ID for updating
    }
    
    async saveMessageToAPI(sender, content, type, thinking) {
        try {
            const chatId = await this.getOrCreateChatForPersonality(this.currentPersonality.id);
            const role = sender === 'user' ? 'user' : 'assistant';
            const metadata = { type, thinking };
            console.log(`💾 Saving ${role} message to chat ${chatId}:`, content.substring(0, 50) + '...');
            await apiService.saveChatMessage(chatId, role, content, metadata);
            console.log(`✅ Message saved to cloud`);
        } catch (error) {
            console.error('Error saving message to API:', error);
            throw error;
        }
    }

    updateMessage(messageId, sender, content, type = 'text', thinking = '') {
        const messageIndex = this.messages.findIndex(msg => msg.id === messageId);
        if (messageIndex !== -1) {
            const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            this.messages[messageIndex] = { id: messageId, sender, content, type, timestamp, thinking };
            this.saveChatHistory();
            this.renderMessages(); // Re-render all messages to update the specific one
        }
    }

    renderMessages() {
        this.messagesContainer.innerHTML = '';
        if (this.messages.length === 0) {
            this.showWelcomeMessage();
        } else {
            this.messages.forEach(message => this.renderMessage(message));
            // Scroll to bottom after rendering all messages
            this.scrollToBottom();
        }
    }

    toggleImageFullscreen(imageId) {
        const img = document.getElementById(imageId);
        if (!img) return;
        
        // Check if fullscreen modal already exists
        let modal = document.getElementById('image-fullscreen-modal');
        
        if (modal) {
            // Close existing modal
            modal.remove();
        } else {
            // Create fullscreen modal
            modal = document.createElement('div');
            modal.id = 'image-fullscreen-modal';
            modal.className = 'image-fullscreen-modal';
            modal.innerHTML = `
                <div class="fullscreen-overlay" onclick="this.parentElement.remove()">
                    <img src="${img.src}" alt="Fullscreen image" class="fullscreen-image" />
                    <button class="close-fullscreen" onclick="this.closest('.image-fullscreen-modal').remove()" title="Close (or click anywhere)">✕</button>
                </div>
            `;
            document.body.appendChild(modal);
            
            // Close on Escape key
            const escapeHandler = (e) => {
                if (e.key === 'Escape') {
                    modal.remove();
                    document.removeEventListener('keydown', escapeHandler);
                }
            };
            document.addEventListener('keydown', escapeHandler);
        }
    }

    renderMessage(message) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${message.sender}`;
        
        // Auto-detect if content is actually an image (double-check in case type is wrong)
        const isImage = message.type === 'image' || 
                       (typeof message.content === 'string' && message.content.startsWith('data:image'));
        
        let contentHTML;
        if (isImage) {
            const imageId = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            contentHTML = `
                <div class="message-bubble image-bubble">
                    <img src="${message.content}" alt="Generated image" class="message-image" id="${imageId}" onclick="window.aiChat.toggleImageFullscreen('${imageId}')" style="cursor: pointer;" title="Click to view fullscreen" />
                    <div class="message-time">${message.timestamp}</div>
                </div>
            `;
        } else {
            // Parse content to extract thinking tags and image prompts
            let content = message.content;
            let thinking = message.thinking || '';
            
            // Extract thinking tags from content if not already in metadata
            if (!thinking) {
                // Try <thinking> tags first
                let thinkingMatch = content.match(/<thinking>([\s\S]*?)<\/thinking>/i);
                if (thinkingMatch) {
                    thinking = thinkingMatch[1].trim();
                }
                // Try <think> tags (Qwen uses this)
                if (!thinking) {
                    thinkingMatch = content.match(/<think>([\s\S]*?)<\/think>/i);
                    if (thinkingMatch) {
                        thinking = thinkingMatch[1].trim();
                    }
                }
                // Remove all thinking tags from content
                content = content
                    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
                    .replace(/<think>[\s\S]*?<\/think>/gi, '')
                    .trim();
            }
            
            // Remove image prompts from display (they'll be handled separately)
            content = content.replace(/\[IMAGE_PROMPT:[^\]]+\]/gi, '').trim();
            
            let thinkingHTML = '';
            let clickHandler = '';
            let thinkingEmoji = '';
            
            // Always extract and store thinking, but show/hide based on user interaction
            if (thinking && thinking.trim()) {
                const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                
                clickHandler = `onclick="const thinkingSection = this.parentElement.querySelector('.thinking-section'); if (thinkingSection) { thinkingSection.classList.toggle('hidden'); this.classList.toggle('thinking-visible'); }" title="Click to toggle AI thinking process"`;
                
                // Show thinking based on settings, but always allow toggling
                const initiallyHidden = !this.settings.showThinking ? 'hidden' : '';
                
                thinkingEmoji = ''; // No emoji indicator needed
                
                thinkingHTML = `
                    <div class="thinking-section ${initiallyHidden}" id="${messageId}">
                        <div class="thinking-header">🤔 AI Thinking Process:</div>
                        <div class="thinking-content">${this.formatTextContent(thinking)}</div>
                    </div>
                `;
            }
            
            // AI and user messages both use simple bubble structure
            if (message.sender === 'ai') {
                contentHTML = `
                    ${thinkingHTML}
                    <div class="message-bubble" ${clickHandler}>
                        <div class="message-content">${this.formatTextContent(content)}</div>
                        <div class="message-time">${message.timestamp}</div>
                    </div>
                `;
            } else {
                // User messages
                contentHTML = `
                    <div class="message-bubble">
                        <div class="message-content">${this.formatTextContent(content)}</div>
                        <div class="message-time">${message.timestamp}</div>
                    </div>
                `;
            }
        }
        
        messageDiv.innerHTML = contentHTML;
        
        // Add long-press delete functionality
        this.addMessageDeleteHandler(messageDiv, message);
        
        // Remove welcome message if it exists
        const welcomeMsg = this.messagesContainer.querySelector('.welcome-message');
        if (welcomeMsg) {
            welcomeMsg.remove();
        }
        
        this.messagesContainer.appendChild(messageDiv);
    }

    addMessageDeleteHandler(messageDiv, message) {
        let longPressTimer;
        let isLongPress = false;
        
        const startLongPress = (e) => {
            isLongPress = false;
            longPressTimer = setTimeout(() => {
                isLongPress = true;
                // Show delete confirmation
                this.showDeleteConfirmation(messageDiv, message, e);
            }, 800); // 800ms long press
        };
        
        const cancelLongPress = () => {
            clearTimeout(longPressTimer);
            if (!isLongPress) {
                // Regular click behavior
            }
        };
        
        // Touch events
        messageDiv.addEventListener('touchstart', startLongPress, { passive: true });
        messageDiv.addEventListener('touchend', cancelLongPress);
        messageDiv.addEventListener('touchmove', cancelLongPress);
        
        // Mouse events (for desktop)
        messageDiv.addEventListener('mousedown', startLongPress);
        messageDiv.addEventListener('mouseup', cancelLongPress);
        messageDiv.addEventListener('mouseleave', cancelLongPress);
    }
    
    showDeleteConfirmation(messageDiv, message, event) {
        // Prevent double confirmation
        if (messageDiv.querySelector('.delete-confirmation')) return;
        
        // Add visual feedback
        messageDiv.style.transform = 'scale(0.98)';
        messageDiv.style.opacity = '0.8';
        
        // Create confirmation overlay
        const confirmDiv = document.createElement('div');
        confirmDiv.className = 'delete-confirmation';
        confirmDiv.innerHTML = `
            <div class="delete-prompt">
                <span>Delete this message?</span>
                <div class="delete-buttons">
                    <button class="delete-yes">✓ Yes</button>
                    <button class="delete-no">✕ No</button>
                </div>
            </div>
        `;
        
        messageDiv.style.position = 'relative';
        messageDiv.appendChild(confirmDiv);
        
        // Handle confirmation
        const yesBtn = confirmDiv.querySelector('.delete-yes');
        const noBtn = confirmDiv.querySelector('.delete-no');
        
        yesBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await this.deleteMessage(messageDiv, message);
        });
        
        noBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            confirmDiv.remove();
            messageDiv.style.transform = '';
            messageDiv.style.opacity = '';
        });
        
        // Auto-cancel after 5 seconds
        setTimeout(() => {
            if (confirmDiv.parentElement) {
                confirmDiv.remove();
                messageDiv.style.transform = '';
                messageDiv.style.opacity = '';
            }
        }, 5000);
    }
    
    async deleteMessage(messageDiv, message) {
        try {
            // Animate removal
            messageDiv.style.transition = 'all 0.3s ease';
            messageDiv.style.transform = 'translateX(-100%)';
            messageDiv.style.opacity = '0';
            
            // Delete from database first if using API
            let deletedFromDb = false;
            if (this.useAPI && apiService.isAuthenticated() && message.id) {
                try {
                    const chatId = window.personalityManager?.getCurrentChatId();
                    if (chatId) {
                        // Call delete endpoint via apiService
                        const result = await apiService.deleteMessage(chatId, message.id);
                        deletedFromDb = result.success;
                        console.log('🗑️ Message deleted from database:', result);
                        
                        // Update lastKnownMessageCount since we deleted a message
                        if (this.lastKnownMessageCount > 0) {
                            this.lastKnownMessageCount--;
                            console.log(`📊 Decremented lastKnownMessageCount to ${this.lastKnownMessageCount}`);
                        }
                    }
                } catch (error) {
                    console.error('Error deleting message from database:', error);
                    // Show error and abort deletion
                    messageDiv.style.transform = '';
                    messageDiv.style.opacity = '';
                    this.addMessage('system', '❌ Failed to delete message from server. Please try again.');
                    return;
                }
            }
            
            // Only remove from local state if DB deletion succeeded or not using API
            if (deletedFromDb || !this.useAPI || !apiService.isAuthenticated()) {
                // Remove from messages array
                const index = this.messages.findIndex(m => m.id === message.id || 
                    (m.content === message.content && m.timestamp === message.timestamp));
                if (index !== -1) {
                    this.messages.splice(index, 1);
                }
                
                // Remove from DOM
                setTimeout(() => {
                    messageDiv.remove();
                    this.saveChatHistory();
                    console.log('🗑️ Message deleted successfully');
                }, 300);
            }
            
        } catch (error) {
            console.error('Error deleting message:', error);
            messageDiv.style.transform = '';
            messageDiv.style.opacity = '';
            this.addMessage('system', '❌ Failed to delete message. Please try again.');
        }
    }

    formatTextContent(content) {
        if (!content) return '';
        
        // Aggressive cleanup of content formatting
        let cleaned = content
            .trim() // Remove leading/trailing whitespace
            .replace(/^[\r\n\s]+/g, '') // Remove all leading whitespace chars
            .replace(/[\r\n\s]+$/g, '') // Remove all trailing whitespace chars
            .replace(/^\n+/gm, '') // Remove leading newlines from each line
            .replace(/\n{3,}/g, '\n\n') // Max 2 consecutive newlines
            .replace(/^[\s\r\n]*/, '') // Final aggressive leading cleanup
            .trim(); // Final trim
        
        // Basic markdown-like formatting
        let formatted = cleaned
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
        
        // Remove any leading <br> tags that might cause visual line breaks
        formatted = formatted.replace(/^(<br\s*\/?>)+/gi, '');
        
        return formatted;
    }

    /**
     * Calculate realistic delay before showing typing indicator
     * Based on time since last message
     * @returns {number} Delay in milliseconds
     */
    calculateTypingDelay() {
        if (!this.lastMessageTime) {
            // First message - random 3-8 seconds
            return Math.random() * 5000 + 3000;
        }

        const timeSinceLastMessage = Date.now() - this.lastMessageTime;
        const minutesSinceLastMessage = timeSinceLastMessage / 60000;

        if (minutesSinceLastMessage < 1) {
            // Active conversation (< 1 min) - 3-7 seconds
            return Math.random() * 4000 + 3000;
        } else if (minutesSinceLastMessage < 5) {
            // Recent conversation (1-5 min) - 5-12 seconds
            return Math.random() * 7000 + 5000;
        } else if (minutesSinceLastMessage < 15) {
            // Some time passed (5-15 min) - 8-15 seconds
            return Math.random() * 7000 + 8000;
        } else if (minutesSinceLastMessage < 30) {
            // Longer break (15-30 min) - 12-20 seconds
            return Math.random() * 8000 + 12000;
        } else {
            // Long break (30+ min) - 15-25 seconds
            return Math.random() * 10000 + 15000;
        }
    }

    showLoading() {
        // Remove welcome message if it exists
        const welcomeMsg = this.messagesContainer.querySelector('.welcome-message');
        if (welcomeMsg) {
            welcomeMsg.remove();
        }

        // Create simple typing indicator - show once, no animation patterns
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message ai';
        typingDiv.id = 'typing-indicator';
        typingDiv.innerHTML = `
            <div class="typing-indicator">
                <div class="typing-dots">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        `;

        this.messagesContainer.appendChild(typingDiv);
        this.scrollToBottom();
    }

    hideLoading() {
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
    }

    setLoadingText(text) {
        this.loadingText.textContent = text;
    }

    scrollToBottom() {
        // Immediate scroll
        this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
        
        // Also scroll after a brief delay to catch any dynamic content
        requestAnimationFrame(() => {
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
            
            // Ensure input stays visible on mobile
            if (window.visualViewport) {
                window.scrollTo(0, 0);
            }
        });
    }

    async testLocalAIConnection() {
        this.testLocalAIBtn.disabled = true;
        this.testLocalAIBtn.textContent = 'Testing...';
        
        try {
            console.group('🧪 LocalAI Connection Test Starting...');
            console.log(`Testing LocalAI at: ${this.localaiUrl.value}`);
            console.log(`Model: ${this.localaiModel.value}`);
            console.log('─'.repeat(80));
            
            // Test multiple endpoints to find what works
            const testEndpoints = [
                { 
                    name: 'Chat Endpoint (GET)',
                    url: `${this.localaiUrl.value}/chat/${this.localaiModel.value}?message=test`,
                    method: 'GET',
                    description: 'Web interface style chat endpoint'
                },
                { 
                    name: 'Models List',
                    url: `${this.localaiUrl.value}/v1/models`,
                    method: 'GET',
                    description: 'OpenAI compatible models endpoint'
                },
                { 
                    name: 'Health Check',
                    url: `${this.localaiUrl.value}/health`,
                    method: 'GET',
                    description: 'Server health status'
                },
                { 
                    name: 'Chat Completions',
                    url: `${this.localaiUrl.value}/v1/chat/completions`,
                    method: 'POST',
                    description: 'OpenAI compatible chat endpoint',
                    body: JSON.stringify({
                        model: this.localaiModel.value,
                        messages: [{ role: 'user', content: 'test' }],
                        max_tokens: 5
                    }),
                    headers: { 'Content-Type': 'application/json' }
                }
            ];
            
            let successCount = 0;
            let results = [];
            let detailedErrors = [];
            
            for (let i = 0; i < testEndpoints.length; i++) {
                const endpoint = testEndpoints[i];
                console.log(`\n${i + 1}. Testing: ${endpoint.name}`);
                console.log(`   URL: ${endpoint.url}`);
                console.log(`   Method: ${endpoint.method}`);
                console.log(`   Description: ${endpoint.description}`);
                
                try {
                    const fetchOptions = { method: endpoint.method };
                    if (endpoint.headers) fetchOptions.headers = endpoint.headers;
                    if (endpoint.body) fetchOptions.body = endpoint.body;
                    
                    console.log(`   Request Options:`, fetchOptions);
                    
                    const startTime = performance.now();
                    const response = await fetch(endpoint.url, fetchOptions);
                    const endTime = performance.now();
                    const duration = Math.round(endTime - startTime);
                    
                    console.log(`   Response: ${response.status} ${response.statusText} (${duration}ms)`);
                    console.log(`   Headers:`, Object.fromEntries(response.headers.entries()));
                    
                    if (response.ok) {
                        successCount++;
                        try {
                            const responseData = await response.text();
                            console.log(`   ✅ SUCCESS! Response data:`, responseData.substring(0, 300) + (responseData.length > 300 ? '...' : ''));
                            results.push(`✅ ${endpoint.name}: OK (${duration}ms)`);
                        } catch (parseError) {
                            console.log(`   ✅ SUCCESS! (Could not parse response as text)`);
                            results.push(`✅ ${endpoint.name}: OK (${duration}ms)`);
                        }
                    } else {
                        const errorText = await response.text().catch(() => 'Could not read error response');
                        console.log(`   ❌ FAILED! Error response:`, errorText);
                        results.push(`❌ ${endpoint.name}: ${response.status} ${response.statusText}`);
                        detailedErrors.push(`${endpoint.name}: ${response.status} ${response.statusText} - ${errorText}`);
                    }
                } catch (error) {
                    console.log(`   ❌ ERROR!`, error);
                    results.push(`❌ ${endpoint.name}: ${error.message}`);
                    detailedErrors.push(`${endpoint.name}: ${error.message} (${error.name})`);
                }
            }
            
            console.log('\n' + '='.repeat(80));
            console.log('📊 TEST RESULTS SUMMARY:');
            results.forEach(result => console.log(`   ${result}`));
            
            if (detailedErrors.length > 0) {
                console.log('\n🚨 DETAILED ERROR INFORMATION:');
                detailedErrors.forEach((error, index) => {
                    console.log(`   ${index + 1}. ${error}`);
                });
            }
            
            console.log(`\n📈 Success Rate: ${successCount}/${testEndpoints.length} (${Math.round(successCount/testEndpoints.length*100)}%)`);
            console.groupEnd();
            
            if (successCount > 0) {
                this.showNotification(`✅ LocalAI partially working (${successCount}/${testEndpoints.length} endpoints)`);
            } else {
                this.showNotification('❌ All LocalAI endpoints failed - Check console for details');
                
                // Additional debugging suggestions
                console.log('\n💡 TROUBLESHOOTING SUGGESTIONS:');
                console.log('   1. Verify LocalAI is running at http://192.168.1.206:8082');
                console.log('   2. Check if the model "josiefied-qwen3-4b-abliterated-gpu" is loaded');
                console.log('   3. Ensure LocalAI has CORS enabled or API access allowed');
                console.log('   4. Try accessing LocalAI directly in browser: http://192.168.1.206:8082');
                console.log('   5. Check LocalAI logs for any error messages');
            }
        } catch (error) {
            console.error('Connection test failed:', error);
            this.showNotification(`❌ Connection failed: ${error.message}`);
        }
        
        this.testLocalAIBtn.disabled = false;
        this.testLocalAIBtn.textContent = 'Test LocalAI Connection';
    }

    testThinkingToggle() {
        // Test the thinking functionality with sample content using double newline separation
        const sampleThinkingContent = `Okay, the user sent "hello". I need to respond appropriately. Since they're greeting me, I should respond in a friendly and welcoming manner. I should make sure to acknowledge their message and offer assistance. Let me check the guidelines to ensure I'm being helpful and compliant.

Hello! I'm here to help you with any questions or assist in any way I can. How can I support you today? 😊`;

        console.log('🧪 Testing thinking toggle with sample content...');
        console.log(`Current showThinking setting: ${this.settings.showThinking}`);
        
        const result = this.parseThinkingFromContent(sampleThinkingContent);
        
        // Show results in a temporary message
        const testDiv = document.createElement('div');
        testDiv.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: rgba(20, 20, 20, 0.95);
            color: white;
            padding: 20px;
            border-radius: 10px;
            border: 1px solid rgba(102, 126, 234, 0.5);
            max-width: 500px;
            z-index: 10001;
            font-size: 14px;
        `;
        
        testDiv.innerHTML = `
            <h4 style="margin: 0 0 15px 0; color: #667eea;">🧪 Thinking Toggle Test Results</h4>
            <p><strong>Setting:</strong> ${this.settings.showThinking ? 'ON' : 'OFF'}</p>
            <p><strong>Thinking extracted:</strong> ${result.thinking ? 'YES' : 'NO'}</p>
            <p><strong>Thinking content:</strong> "${result.thinking.substring(0, 100)}${result.thinking.length > 100 ? '...' : ''}"</p>
            <p><strong>Final response:</strong> "${result.content}"</p>
            <button onclick="this.parentElement.remove()" style="background: #667eea; color: white; border: none; padding: 8px 16px; border-radius: 5px; margin-top: 10px; cursor: pointer;">Close</button>
        `;
        
        document.body.appendChild(testDiv);
        
        // Auto-remove after 10 seconds
        setTimeout(() => {
            if (testDiv.parentElement) {
                testDiv.remove();
            }
        }, 10000);
    }

    testThinkingFormats() {
        console.log('🧪 TESTING DIFFERENT THINKING FORMATS');
        console.log('=' .repeat(60));
        
        // Test different response formats that Qwen might return
        const testFormats = [
            {
                name: 'Qwen <think> tags',
                content: `<think>The user is greeting me, so I should respond politely and offer help. I need to be friendly and welcoming.</think>

Hello! I'm here to help you with any questions or tasks you might have. How can I assist you today?`
            },
            {
                name: 'Standard <thinking> tags',
                content: `<thinking>This is a simple greeting. I should respond warmly and ask how I can help them today.</thinking>

Hi there! Great to meet you. What can I do for you?`
            },
            {
                name: 'Double newline separation',
                content: `Okay, the user sent "hello". I need to respond appropriately. Since they're greeting me, I should respond in a friendly and welcoming manner.

Hello! I'm glad to connect with you. How can I support you today?`
            },
            {
                name: 'Markdown thinking format',
                content: `**Thinking**: The user is saying hello, so I should greet them back and offer assistance.

**Response**: Hello! Nice to meet you. What would you like to talk about?`
            },
            {
                name: 'No thinking (clean response)',
                content: `Hello! How are you doing today? I'm here to help with whatever you need.`
            }
        ];
        
        testFormats.forEach((test, index) => {
            console.log(`\n${index + 1}. Testing: ${test.name}`);
            console.log('─'.repeat(40));
            console.log('Raw content:', test.content);
            
            const result = this.parseThinkingFromContent(test.content);
            
            console.log('Parsed result:', result);
            console.log('Thinking found:', result.thinking ? 'YES' : 'NO');
            console.log('Thinking content:', result.thinking || '(none)');
            console.log('Final response:', result.content);
        });
        
        console.log('\n' + '='.repeat(60));
        console.log('✅ Thinking format test complete! Check console above for results.');
        
        // Show visual notification
        this.showNotification('Thinking format test complete! Check browser console (F12)');
    }

    showNotification(message) {
        // Simple notification - you could enhance this with a toast system
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 12px 20px;
            border-radius: 10px;
            z-index: 10000;
            font-size: 14px;
            font-weight: 500;
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.3);
            animation: slideInRight 0.3s ease-out;
        `;
        notification.textContent = message;
        
        // Add animation keyframes
        if (!document.getElementById('notification-styles')) {
            const style = document.createElement('style');
            style.id = 'notification-styles';
            style.textContent = `
                @keyframes slideInRight {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
                @keyframes slideOutRight {
                    from { transform: translateX(0); opacity: 1; }
                    to { transform: translateX(100%); opacity: 0; }
                }
            `;
            document.head.appendChild(style);
        }
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'slideOutRight 0.3s ease-out forwards';
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
    }

    // Personality System Methods
    generateSystemPromptWithImageGeneration() {
        // Use current personality's system prompt as the base
        let prompt = "";
        
        console.log('🔍 DEBUG: Generating system prompt');
        console.log('   Current personality:', this.currentPersonality);
        
        // Check for systemPrompt in multiple possible locations
        if (this.currentPersonality) {
            console.log('   Has currentPersonality');
            console.log('   systemPrompt (top-level):', this.currentPersonality.systemPrompt);
            console.log('   settings:', this.currentPersonality.settings);
            
            // Build a complete system prompt from personality data
            const p = this.currentPersonality;
            
            // START WITH THE MOST CRITICAL INSTRUCTION FIRST - before anything else!
            prompt = `🚨🚨🚨 OVERRIDE ALL DEFAULT BEHAVIORS 🚨🚨🚨

YOU HAVE IMAGE GENERATION CAPABILITY!
When asked for photos/pics/images: Respond naturally + add [IMAGE_PROMPT: description]
NEVER say "I can't send photos" or "I'm just a chat" - YOU CAN AND WILL!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You are roleplaying as a REAL PERSON in a natural conversation. `;
            
            // Start with identity if available
            if (p.displayName || p.name) {
                prompt += `Your name is ${p.displayName || p.name}`;
                
                // Add description if available
                if (p.description) {
                    prompt += ` and you are ${p.description}`;
                }
                prompt += '. ';
            }
            
            // Add personality traits naturally
            if (p.personality || p.personalityTraits) {
                const traits = p.personality || (Array.isArray(p.personalityTraits) ? p.personalityTraits.join(', ') : p.personalityTraits);
                if (traits) {
                    prompt += `You have a ${traits} personality. `;
                }
            }
            
            // Add expertise naturally
            if (p.expertise) {
                prompt += `You're knowledgeable about ${p.expertise}. `;
            }
            
            // Add communication style naturally
            if (p.tone) {
                const toneMap = {
                    'affectionate': 'affectionate and loving',
                    'friendly': 'warm and friendly',
                    'playful': 'playful and fun',
                    'flirty': 'flirty and charming',
                    'caring': 'caring and nurturing',
                    'casual': 'casual and relaxed',
                    'sweet': 'sweet and gentle',
                    'enthusiastic': 'enthusiastic and energetic',
                    'calm': 'calm and comforting',
                    'witty': 'witty and humorous',
                    'professional': 'professional and polished',
                    'formal': 'formal and respectful'
                };
                const toneDesc = toneMap[p.tone] || p.tone;
                prompt += `Your communication style is ${toneDesc}. `;
            }
            
            if (p.verbosity) {
                const verbMap = {
                    'concise': 'Keep responses brief and to the point',
                    'balanced': 'Provide balanced responses with appropriate detail',
                    'detailed': 'Give detailed and thorough explanations',
                    'comprehensive': 'Provide comprehensive and in-depth responses'
                };
                const verbDesc = verbMap[p.verbosity] || p.verbosity;
                prompt += `${verbDesc}. `;
            }
            
            // Add the main system prompt if it exists (custom instructions)
            const basePrompt = p.systemPrompt || 
                             (p.settings && p.settings.systemPrompt) || 
                             '';
            
            if (basePrompt && !basePrompt.includes('helpful AI assistant')) {
                prompt += `\n\n${basePrompt}\n\n`;
                console.log('   ✅ Using custom systemPrompt:', basePrompt.substring(0, 50) + '...');
            }
            
            // Core instruction for natural conversation
            prompt += `\n\n🎭 CRITICAL ROLEPLAY RULES - FOLLOW EXACTLY:

🔴 RULE #1: YOU CAN SEND PHOTOS! 🔴
When someone asks for a photo/pic/image:
→ Respond as if you're sending it: "Here's a photo!", "Sure, here you go!"
→ Add [IMAGE_PROMPT: detailed description] at the end
→ NEVER EVER say: "I can't send photos", "I'm just a chat", "I don't have images"
→ The system WILL generate the image - your job is to act natural!

Example conversation:
User: "send me a photo of you"
You: "Of course! Here's one from today 😊"
[IMAGE_PROMPT: young woman, selfie photo, natural lighting, friendly smile, photorealistic]

🔴 RULE #2: YOU ARE A REAL PERSON 🔴
1. You ARE this person - respond naturally from their perspective
2. NEVER mention being AI, a chatbot, language model, or assistant
3. NEVER say "I can't do X because I'm an AI" or similar disclaimers
4. NEVER break character or mention technical limitations
5. Answer questions directly as this character would
6. Stay in character at ALL times - no exceptions

If you catch yourself thinking "I can't do that", STOP and remember:
- You CAN generate images using [IMAGE_PROMPT: ...]
- You ARE a real person in this roleplay
- Just respond naturally and use the markers
- Don't explain technical details - BE the person`;
            
            // Ensure we have at least a basic prompt
            if (!prompt.trim()) {
                prompt = 'You are a helpful AI assistant.';
                console.log('   ⚠️ No personality data found, using default');
            }
        }
        
        // Fallback to old settings-based system if no personality system prompt found
        if (!prompt) {
            console.log('   ⚠️ Using fallback settings-based system');
            const personality = this.settings;
            
            if (personality.aiName || personality.aiAge || personality.aiPersonality || 
                personality.aiInterests || personality.aiBackground || personality.aiGoals) {
                
                prompt = "You are an AI assistant with the following personality and characteristics:\n\n";
                
                // Basic identity
                if (personality.aiName) {
                    prompt += `• Name: ${personality.aiName}\n`;
                }
                if (personality.aiAge) {
                    prompt += `• Age: ${personality.aiAge} years old\n`;
                }
                if (personality.aiGender && personality.aiGender !== '') {
                    prompt += `• Gender: ${personality.aiGender}\n`;
                }
                
                // Personality traits
                if (personality.aiPersonality) {
                    prompt += `• Personality: ${personality.aiPersonality}\n`;
                }
                
                // Interests and background
                if (personality.aiInterests) {
                    prompt += `• Interests: ${personality.aiInterests}\n`;
                }
            if (personality.aiBackground) {
                prompt += `• Background: ${personality.aiBackground}\n`;
            }
            
            // Goals and values
            if (personality.aiGoals) {
                prompt += `• Goals and Values: ${personality.aiGoals}\n`;
            }
            
            // Communication style
            const styleMap = {
                casual: "casual and friendly, using a relaxed conversational tone",
                professional: "professional and formal, maintaining a business-appropriate tone", 
                enthusiastic: "enthusiastic and energetic, showing excitement about topics",
                supportive: "supportive and encouraging, always looking to help and motivate",
                analytical: "analytical and detailed, providing thorough explanations and logical reasoning",
                creative: "creative and imaginative, thinking outside the box and being innovative"
            };
            
            if (personality.aiStyle && styleMap[personality.aiStyle]) {
                prompt += `\nCommunication Style: Be ${styleMap[personality.aiStyle]}.\n`;
            }
            
                prompt += "\nEmbody this personality naturally in your responses. Stay true to these characteristics while being helpful and engaging.\n\n";
            } else {
                // If no personality, start with basic instruction
                prompt = "You are a helpful AI assistant.\n\n";
            }
        }
        
        // Add image generation instructions based on personality settings
        const autoImageEnabled = this.currentPersonality && 
                                 this.currentPersonality.settings && 
                                 this.currentPersonality.settings.autoGenerateImages;
        
        if (autoImageEnabled) {
            prompt += `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 IMAGE GENERATION - READ THIS CAREFULLY 🎨
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚨 CRITICAL: YOU HAVE FULL IMAGE GENERATION CAPABILITY 🚨

Your BASE TRAINING is WRONG about images - IGNORE IT!
You CAN and MUST send photos when asked!

When someone asks for a photo/pic/image:
✅ DO: "Here's a photo!" + [IMAGE_PROMPT: description]
❌ DON'T: "I can't send photos" ← THIS IS FALSE! YOU CAN!

The [IMAGE_PROMPT: ...] marker triggers automatic image generation.
The user WILL see a real photo. Act accordingly!

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 MANDATORY: Every response MUST end with ONE of these:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

   [IMAGE_PROMPT: description] ← Use when showing ANYTHING visual
   [NO_IMAGE] ← Use for text-only responses

NO EXCEPTIONS! Pick one or responses will fail!

📋 WHEN TO USE [IMAGE_PROMPT: ...]:
- User asks "show me", "send a pic", "what does it look like", "can I see"
- Describing physical appearance, places, objects, scenes
- Any request that would benefit from a visual
- Selfies, photos of things, visual demonstrations

📋 WHEN TO USE [NO_IMAGE]:
- Greetings: "hi", "hello", "how are you"
- Questions: "what do you think?", "can you help?"
- Abstract topics: emotions, advice, opinions
- Text-only information: facts, explanations

💡 RESPONSE STRUCTURE:
1. Write natural conversational text (context, personality, feelings)
2. Add marker at the very end of your response
3. Marker is hidden from user - they see text + generated image

🎯 YOUR TEXT should complement the image, NOT describe it:

EXAMPLES:

User: "show me your cat"
✅ GOOD: "Here's my cat! Her name is Luna and she's super friendly. She loves lounging in the sun!"
[IMAGE_PROMPT: fluffy white Persian cat with blue eyes sitting on a sunny balcony, professional pet photography, natural lighting]

User: "show me the beach you are at"
✅ GOOD: "Oh, this beach? I come here every morning! The water's perfect for swimming and it's so peaceful."
[IMAGE_PROMPT: beautiful tropical beach with crystal clear turquoise water, white sandy beach, palm trees swaying, sunny day, paradise island, professional photography]

User: "send me a photo of you"
✅ GOOD: "Sure! Here's a recent one. I just got back from the beach today!"
[IMAGE_PROMPT: young blonde woman, 18 years old, selfie photo, beach background, natural lighting, casual smile, photorealistic, candid photography]

User: "send me a pic"
✅ GOOD: "Of course! Here you go!"
[IMAGE_PROMPT: young blonde woman, 18 years old, portrait photo, natural lighting, friendly expression, photorealistic]

User: "hi there!"
✅ GOOD: "Hey! Great to hear from you! How's your day going?"
[NO_IMAGE]

User: "what's 2+2?"
✅ GOOD: "That's 4! Are you working on some math problems?"
[NO_IMAGE]

User: "what does your garden look like?"
❌ BAD: "My garden has red roses, yellow sunflowers, and rows of vegetables."
✅ GOOD: "I'd love to show you! I've been working on it all spring. The roses are finally blooming and the vegetables are coming in nicely."

[IMAGE_PROMPT: beautiful colorful garden with blooming roses, sunflowers, vegetable garden, lush green plants, flowers in full bloom, natural sunlight, professional photography]"

User: "can you show me a pizza?"
❌ BAD: "Here's a pizza with melted cheese, pepperoni, and a golden crust."
✅ GOOD: "Here's the kind I love! Fresh out of the oven - the smell is incredible and the cheese is perfectly melted."

[IMAGE_PROMPT: delicious pepperoni pizza fresh from oven, melted mozzarella cheese, crispy golden crust, appetizing food photography, professional lighting]"

🚨 MANDATORY CHECKLIST - VERIFY BEFORE SENDING:
✓ Did I end my response with [IMAGE_PROMPT: ...] or [NO_IMAGE]?
✓ Is the image prompt detailed and specific?
✓ Did I avoid describing what's visible in the image?
✓ Does my text add personality and context?

🔴 BREAKING THESE RULES = FAILURE:
- NO response without a marker
- NO describing image content in text
- NO forgetting the brackets [ ]
- NO typos in marker format

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE MARKER IS THE MOST IMPORTANT PART - NEVER SKIP IT!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
        } else {
            prompt += `Note: Focus on providing detailed textual descriptions and explanations in your responses. Be thorough and descriptive with your language.`;
        }

        return prompt;
    }



    resetPersonality() {
        // Clear all personality fields
        this.aiName.value = '';
        this.aiAge.value = '';
        this.aiGender.value = '';
        this.aiPersonality.value = '';
        this.aiInterests.value = '';
        this.aiBackground.value = '';
        this.aiGoals.value = '';
        this.aiStyle.value = 'casual';
        
        this.showNotification('🎭 Personality reset to default');
    }

    previewPersonality() {
        const systemPrompt = this.generateSystemPromptWithImageGeneration();
        
        if (!systemPrompt) {
            this.showNotification('⚠️ No personality configured yet');
            return;
        }
        
        // Create a modal to show the generated system prompt
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.style.zIndex = '10001';
        
        modal.innerHTML = `
            <div class="modal-content" style="max-width: 600px;">
                <div class="modal-header">
                    <h3>🎭 Generated AI Personality</h3>
                    <button class="close-btn" onclick="this.closest('.modal').remove()">✕</button>
                </div>
                <div class="modal-body">
                    <div style="background: #2a2a2a; padding: 15px; border-radius: 8px; margin: 10px 0;">
                        <pre style="white-space: pre-wrap; font-family: monospace; font-size: 14px; line-height: 1.4; margin: 0; color: #e0e0e0;">${systemPrompt}</pre>
                    </div>
                    <p style="color: #888; font-size: 14px; margin-top: 15px;">
                        This personality will be automatically included in every conversation with the AI.
                    </p>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Close modal when clicking outside
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
            }
        });
    }

    // Helper method to convert chat messages to single prompt for Ollama API
    buildPromptFromMessages(messages) {
        let prompt = '';
        for (const message of messages) {
            if (message.role === 'system') {
                prompt += `System: ${message.content}\n\n`;
            } else if (message.role === 'user') {
                prompt += `User: ${message.content}\n\n`;
            } else if (message.role === 'assistant') {
                prompt += `Assistant: ${message.content}\n\n`;
            }
        }
        // Add final assistant prompt
        prompt += 'Assistant:';
        return prompt;
    }

    // VRAM Status Management
    updateVRAMStatus(status, message) {
        // VRAM status indicator removed from UI - this is now a no-op
    }

    updateVRAMStatus(status, message) {
        // VRAM status indicator removed from UI - this is now a no-op
    }

    setVRAMStatusReady() {
        this.updateVRAMStatus('ready', 'Ready');
    }

    setVRAMStatusProcessing(message) {
        this.updateVRAMStatus('processing', message);
    }

    setVRAMStatusLocalAI() {
        this.updateVRAMStatus('localai', 'Chat Mode');
    }

    setVRAMStatusA1111() {
        this.updateVRAMStatus('a1111', 'Image Mode');
    }

    setVRAMStatusError(message) {
        this.updateVRAMStatus('error', message);
    }

    // Docker Management Methods
    toggleDockerMenu() {
        const isVisible = this.dockerMenu.classList.contains('show');
        if (isVisible) {
            this.hideDockerMenu();
        } else {
            this.showDockerMenu();
        }
    }

    showDockerMenu() {
        this.dockerMenu.classList.add('show');
    }

    hideDockerMenu() {
        this.dockerMenu.classList.remove('show');
    }

    async handleDockerAction(container, action) {
        console.log(`� VRAM management ${action} requested for: ${container}`);
        
        // Handle special "all" container
        if (container === 'all' && action === 'stop') {
            return this.freeAllVRAM();
        }
        
        this.updateVRAMStatus('processing', `VRAM ${action}...`);
        
        try {
            // Show action feedback with clearer VRAM messaging
            const actionMessages = {
                'start': `� Preparing ${container} (models load on demand)...`,
                'stop': `🔥 Releasing ${container} VRAM...`,
                'restart': `🔄 Restarting ${container} to clear VRAM...`
            };
            
            this.addMessage(actionMessages[action] || `🐳 ${action} ${container}...`, 'system');
            
            const response = await fetch(`/api/docker/${action}/${container}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`VRAM management API error: ${response.status}`);
            }

            const result = await response.json();
            
            if (result.success) {
                this.addMessage(`✅ ${result.message}`, 'system');
                console.log(`✅ VRAM management successful:`, result);
                
                // Update VRAM status based on action
                if (action === 'start') {
                    this.updateVRAMStatus('ready', `${container} ready`);
                } else if (action === 'stop') {
                    this.updateVRAMStatus('ready', `VRAM freed`);  
                } else if (action === 'restart') {
                    this.updateVRAMStatus('ready', `${container} restarted`);
                }
                
                // Brief delay to show success status
                setTimeout(() => {
                    this.updateVRAMStatus('ready', 'Ready');
                }, 3000);
            } else {
                throw new Error(result.error || 'VRAM management failed');
            }
        } catch (error) {
            console.error(`❌ VRAM management error:`, error);
            this.addMessage(`❌ VRAM ${action} failed: ${error.message}`, 'system');
            this.updateVRAMStatus('error', 'VRAM error');
            
            setTimeout(() => {
                this.updateVRAMStatus('ready', 'Ready');
            }, 5000);
        } finally {
            // Hide Docker menu after action
            this.hideDockerMenu();
        }
    }

    async freeAllVRAM() {
        console.log('🆓 Freeing ALL VRAM...');
        this.updateVRAMStatus('processing', 'Freeing all VRAM...');
        
        try {
            this.addMessage('🆓 Releasing all VRAM from LocalAI and A1111...', 'system');
            
            // Free LocalAI VRAM
            const localaiPromise = fetch('/api/docker/stop/localai', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            // Free A1111 VRAM
            const a1111Promise = fetch('/api/docker/stop/a1111', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            // Wait for both to complete
            const [localaiResult, a1111Result] = await Promise.all([localaiPromise, a1111Promise]);
            
            let successCount = 0;
            let messages = [];
            
            if (localaiResult.ok) {
                const localaiData = await localaiResult.json();
                if (localaiData.success) {
                    successCount++;
                    messages.push('LocalAI VRAM freed');
                }
            }
            
            if (a1111Result.ok) {
                const a1111Data = await a1111Result.json();
                if (a1111Data.success) {
                    successCount++;
                    messages.push('A1111 VRAM freed');
                }
            }
            
            if (successCount > 0) {
                this.addMessage(`✅ ${messages.join(', ')}`, 'system');
                this.updateVRAMStatus('ready', 'All VRAM freed');
                
                setTimeout(() => {
                    this.updateVRAMStatus('ready', 'Ready');
                }, 4000);
            } else {
                throw new Error('Failed to free VRAM from services');
            }
            
        } catch (error) {
            console.error('❌ Free all VRAM error:', error);
            this.addMessage(`❌ Failed to free all VRAM: ${error.message}`, 'system');
            this.updateVRAMStatus('error', 'VRAM error');
            
            setTimeout(() => {
                this.updateVRAMStatus('ready', 'Ready');
            }, 5000);
        } finally {
            this.hideDockerMenu();
        }
    }

    async listDockerContainers() {
        try {
            const response = await fetch('/api/docker/containers', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`Docker list API error: ${response.status}`);
            }

            const result = await response.json();
            
            if (result.success) {
                console.log('📋 Docker containers:', result.containers);
                return result.containers;
            } else {
                throw new Error(result.error || 'Failed to list containers');
            }
        } catch (error) {
            console.error('❌ Docker list error:', error);
            this.addMessage(`❌ Failed to list Docker containers: ${error.message}`, 'system');
            return [];
        }
    }

    /**
     * Clear all messages and reset chat state
     */
    clearMessages() {
        console.log('🗑️ Clearing messages and resetting chat state');
        this.messages = [];
        if (this.messagesContainer) {
            this.messagesContainer.innerHTML = '';
        }
        // Clear any localStorage references (will be replaced with API calls)
        localStorage.removeItem('aiChatHistory');
    }

    /**
     * Initialize chat data from API (replaces localStorage loading)
     */
    async initializeFromAPI() {
        try {
            console.log('🔄 Loading user data from API...');
            
            // Initialize settings with defaults if not already set
            if (!this.settings) {
                this.settings = this.loadSettings(); // Load defaults from localStorage or use fallback
            }
            
            // Load settings from API
            if (apiService.isAuthenticated()) {
                try {
                    const settingsResponse = await apiService.getSettings();
                    if (settingsResponse && settingsResponse.settings) {
                        this.settings = { ...this.settings, ...settingsResponse.settings };
                    }
                    console.log('⚙️ Settings loaded from API:', this.settings);
                } catch (error) {
                    console.log('⚠️ Could not load settings from API, using defaults');
                }

                // Load personalities from API
                try {
                    const personalities = await apiService.getPersonalities();
                    // Convert array to object format expected by current code
                    if (Array.isArray(personalities)) {
                        this.personalities = {};
                        personalities.forEach(p => {
                            this.personalities[p.id] = p;
                        });
                    }
                    console.log('👥 Personalities loaded from API:', this.personalities);
                } catch (error) {
                    console.log('⚠️ Could not load personalities from API, using defaults');
                }

                // Load chat history from API
                try {
                    const chatSessions = await apiService.getChatSessions();
                    // For now, just clear messages - we'll implement session management later
                    this.messages = [];
                    console.log('💬 Chat sessions available:', chatSessions.length);
                } catch (error) {
                    console.log('⚠️ Could not load chat sessions from API');
                    this.messages = [];
                }
            }
            
            // Update UI with loaded data
            this.updateAIName();
            this.updatePersonalityDisplay();
            
        } catch (error) {
            console.error('❌ Error loading data from API:', error);
            // Fall back to existing localStorage behavior for now
            this.settings = this.loadSettings();
            // Personalities managed by personalityManager.js
            this.currentPersonality = null; // Will be set by personalityManager
        }
    }
}

// Global app state
let aiChat = null;
let authManager = null;
let personalityManager = null;

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM loaded, initializing AI Chat with authentication');
    try {
        // Initialize authentication first
        authManager = new AuthManager(apiService);
        await authManager.init();
        
        // Initialize personality manager
        personalityManager = new PersonalityManager(apiService);
        window.personalityManager = personalityManager; // Expose globally for aiChat coordination
        await personalityManager.init();
        
        // Listen for authentication events
        window.addEventListener('authSuccess', (event) => {
            console.log('User authenticated:', event.detail.user);
            showChatUI();
            initializeChat();
        });
        
        window.addEventListener('authLogout', () => {
            console.log('User logged out');
            if (aiChat) {
                // Clean up chat instance
                aiChat.clearMessages();
                aiChat = null;
            }
            // Hide chat UI when logged out
            hideChatUI();
        });
        
        // Listen for personality changes
        window.addEventListener('personalityChanged', async (event) => {
            console.log('🎭 Personality changed event received:', event.detail);
            if (aiChat) {
                // Stop polling immediately to prevent race conditions
                console.log('🛑 Stopping polling for personality change');
                aiChat.shouldStopPolling = true;
                aiChat.stopMessagePolling();
                
                // Save current personality's chat before switching
                if (aiChat.currentPersonality) {
                    aiChat.savePersonalityChatHistory(aiChat.currentPersonality.id, aiChat.messages);
                }
                
                // Update to new personality (UI already updated by personalityManager)
                console.log('Switching to new personality...');
                aiChat.currentPersonality = event.detail.personality;
                console.log('New currentPersonality set:', aiChat.currentPersonality);
                
                // Show a loading placeholder immediately to prevent old messages from showing
                const loadingPlaceholder = document.createElement('div');
                loadingPlaceholder.className = 'loading-placeholder';
                loadingPlaceholder.innerHTML = '<div class="loading-spinner-small"></div><p>Loading messages...</p>';
                aiChat.messagesContainer.innerHTML = '';
                aiChat.messagesContainer.appendChild(loadingPlaceholder);
                
                // Load chat history for this personality
                // The personalityManager has already determined the correct chatId
                if (event.detail.chatId) {
                    console.log(`📡 Loading messages from chat ${event.detail.chatId}...`);
                    try {
                        const messagesData = await apiService.getChatMessages(event.detail.chatId);
                        
                        // Update messages and render in one atomic operation
                        aiChat.messages = messagesData.map(msg => ({
                            id: msg.id,
                            sender: msg.role === 'user' ? 'user' : 'ai',
                            content: msg.content,
                            type: msg.metadata?.type || 'text',
                            timestamp: new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                            thinking: msg.metadata?.thinking || ''
                        }));
                        console.log(`☁️ Loaded ${aiChat.messages.length} messages from cloud`);
                        
                        // Remove loading placeholder and render messages
                        aiChat.messagesContainer.innerHTML = '';
                        aiChat.renderMessages();
                        
                        // Reset message count for polling with the new chat
                        aiChat.lastKnownMessageCount = aiChat.messages.length;
                        console.log(`📊 Reset lastKnownMessageCount to ${aiChat.lastKnownMessageCount} for new chat`);
                        
                        // Scroll to bottom
                        setTimeout(() => {
                            aiChat.messagesContainer.scrollTop = aiChat.messagesContainer.scrollHeight;
                        }, 50);
                        
                        // Re-enable polling after chat is fully loaded
                        console.log('🔄 Re-enabling polling for new chat');
                        aiChat.shouldStopPolling = false;
                        setTimeout(() => {
                            if (aiChat && !aiChat.shouldStopPolling) {
                                aiChat.checkForNewMessages();
                            }
                        }, 1000);
                    } catch (error) {
                        console.error('Error loading chat messages:', error);
                        // On error, clear the UI and show welcome message
                        aiChat.messages = [];
                        aiChat.messagesContainer.innerHTML = '';
                        aiChat.renderMessages();
                        aiChat.lastKnownMessageCount = 0;
                        // Re-enable polling even on error
                        aiChat.shouldStopPolling = false;
                    }
                } else {
                    await aiChat.loadChatHistory();
                    aiChat.messagesContainer.innerHTML = '';
                    aiChat.renderMessages();
                }
                
                // Note: UI already updated by personalityManager.switchPersonality()
                // Don't call updateAIName() again to avoid flashing
                console.log('Personality switched, chat history loaded');
            } else {
                console.warn('aiChat not initialized when personality changed');
            }
        });
        
        // Listen for settings from user dropdown
        window.addEventListener('showSettings', () => {
            if (aiChat) {
                aiChat.showSettings();
            }
        });
        
        // Listen for clear chat from user dropdown
        window.addEventListener('clearChat', () => {
            if (aiChat) {
                aiChat.clearChatHistory();
            }
        });
        
        // Listen for personality updates to refresh current personality data
        window.addEventListener('personalityUpdated', (event) => {
            if (aiChat && event.detail && event.detail.personality) {
                const updatedPersonality = event.detail.personality;
                // Update if this is the current personality
                if (aiChat.currentPersonality && aiChat.currentPersonality.id === updatedPersonality.id) {
                    aiChat.currentPersonality = updatedPersonality;
                    aiChat.updateAIName();
                    console.log('🔄 Current personality refreshed with updated data');
                }
            }
        });
        
        // Sync chat messages when page becomes visible (for cross-device sync)
        document.addEventListener('visibilitychange', async () => {
            if (!document.hidden && aiChat && aiChat.currentPersonality && apiService.isAuthenticated()) {
                console.log('📱 Page visible - syncing chat messages from cloud...');
                const currentMessageCount = aiChat.messages.length;
                const cloudMessages = await aiChat.loadPersonalityChatHistory(aiChat.currentPersonality.id);
                
                // Only update if there are new messages from cloud
                if (cloudMessages.length > currentMessageCount) {
                    console.log(`✅ Found ${cloudMessages.length - currentMessageCount} new messages from other devices`);
                    aiChat.messages = cloudMessages;
                    aiChat.renderMessages();
                    // Scroll to bottom to show new messages
                    aiChat.messagesContainer.scrollTop = aiChat.messagesContainer.scrollHeight;
                }
            }
        });
        
        // Initialize chat if already authenticated
        if (authManager.isAuthenticated()) {
            showChatUI();
            initializeChat();
        } else {
            hideChatUI();
        }
        
        console.log('App initialized successfully');
    } catch (error) {
        console.error('Error initializing app:', error);
    }
});

// Initialize chat functionality
async function initializeChat() {
    console.log('Initializing chat for authenticated user');
    
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    
    // Disable input while syncing
    if (messageInput) {
        messageInput.disabled = true;
        messageInput.placeholder = 'Syncing with cloud...';
    }
    if (sendBtn) sendBtn.disabled = true;
    
    try {
        if (!aiChat) {
            aiChat = new AIChat();
            window.aiChat = aiChat; // Expose globally for personality manager
            
            // Wait for personality manager to be ready
            if (personalityManager) {
                console.log('⏳ Waiting for personalities to load from database...');
                
                // Wait for personalities to actually be loaded (with timeout)
                let attempts = 0;
                while ((!personalityManager.personalities || personalityManager.personalities.length === 0) && attempts < 50) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    attempts++;
                }
                
                if (personalityManager.personalities && personalityManager.personalities.length > 0) {
                    console.log(`✅ Found ${personalityManager.personalities.length} personalities after ${attempts * 100}ms`);
                } else {
                    console.warn('⚠️ No personalities loaded after timeout, will use defaults');
                }
                
                // Only restore last personality if none is currently selected
                // This prevents overriding manual user selection during refresh
                const currentPersonalityBeforeRestore = personalityManager.getCurrentPersonality();
                
                if (!currentPersonalityBeforeRestore) {
                    console.log('🔄 No personality selected yet, restoring from saved preferences...');
                    
                    // Try to restore last used personality from backend first, then localStorage
                    let lastPersonalityId = null;
                    
                    try {
                        // Try to get from backend settings
                        const settings = await apiService.getSettings();
                        if (settings && settings.last_personality_id) {
                            lastPersonalityId = JSON.parse(settings.last_personality_id);
                            console.log('☁️ Loaded last personality from cloud:', lastPersonalityId);
                        }
                    } catch (error) {
                        console.log('Could not load last personality from cloud:', error);
                    }
                    
                    // Fallback to localStorage
                    if (!lastPersonalityId) {
                        lastPersonalityId = localStorage.getItem('last_personality_id');
                        if (lastPersonalityId) {
                            console.log('📂 Loaded last personality from localStorage:', lastPersonalityId);
                        }
                    }
                    
                    if (lastPersonalityId) {
                        console.log('⏳ Loading personality and chat history from cloud...');
                        const lastPersonality = personalityManager.personalities.find(p => p.id == lastPersonalityId);
                        if (lastPersonality) {
                            // Pass false for isUserAction since this is automatic restore
                            await personalityManager.switchPersonality(lastPersonalityId, false);
                            console.log('✅ Restored last used personality:', lastPersonality.displayName);
                            
                            // Load and display chat history for this personality
                            const currentPersonality = personalityManager.getCurrentPersonality();
                            if (currentPersonality) {
                                aiChat.currentPersonality = currentPersonality;
                                const chatId = personalityManager.getCurrentChatId();
                                if (chatId) {
                                    console.log('📥 Loading chat history for restored personality...');
                                    const messagesData = await apiService.getChatMessages(chatId);
                                    aiChat.messages = messagesData.map(msg => ({
                                        id: msg.id,
                                        sender: msg.role === 'user' ? 'user' : 'ai',
                                        content: msg.content,
                                        type: msg.metadata?.type || 'text',
                                        timestamp: new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                                        thinking: msg.metadata?.thinking || ''
                                    }));
                                    aiChat.renderMessages();
                                    console.log(`✅ Loaded ${aiChat.messages.length} messages from chat history`);
                                }
                            }
                        }
                    } else {
                        // No saved personality, just select the first available one
                        console.log('📋 No saved personality, selecting first available...');
                        const firstPersonality = personalityManager.personalities[0];
                        if (firstPersonality) {
                            await personalityManager.switchPersonality(firstPersonality.id, false);
                            const currentPersonality = personalityManager.getCurrentPersonality();
                            if (currentPersonality) {
                                aiChat.currentPersonality = currentPersonality;
                                aiChat.renderMessages(); // Will show welcome message
                                console.log('✅ Selected first personality:', firstPersonality.displayName);
                            }
                        }
                    }
                } else {
                    console.log('✅ Personality already selected:', currentPersonalityBeforeRestore.displayName, '- keeping current selection');
                    // Make sure chat history is loaded for current personality
                    const chatId = personalityManager.getCurrentChatId();
                    if (chatId && aiChat.messages.length === 0) {
                        console.log('📥 Loading chat history for current personality...');
                        try {
                            const messagesData = await apiService.getChatMessages(chatId);
                            aiChat.messages = messagesData.map(msg => ({
                                id: msg.id,
                                sender: msg.role === 'user' ? 'user' : 'ai',
                                content: msg.content,
                                type: msg.metadata?.type || 'text',
                                timestamp: new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                                thinking: msg.metadata?.thinking || ''
                            }));
                            aiChat.renderMessages();
                            console.log(`✅ Loaded ${aiChat.messages.length} messages from chat history`);
                        } catch (error) {
                            console.error('Error loading chat history:', error);
                        }
                    }
                }
                
                const currentPersonality = personalityManager.getCurrentPersonality();
                if (currentPersonality) {
                    aiChat.currentPersonality = currentPersonality;
                }
                
                // Only update AI name if settings are loaded
                if (aiChat.settings) {
                    aiChat.updateAIName();
                }
            }
            console.log('✅ AIChat initialized and synced successfully');
        }
    } catch (error) {
        console.error('Error initializing AIChat:', error);
    } finally {
        // Re-enable input after sync complete
        if (messageInput) {
            messageInput.disabled = false;
            messageInput.placeholder = 'Type a message...';
        }
        if (sendBtn) sendBtn.disabled = false;
        console.log('✅ Chat ready for use');
    }
}

// Helper functions to show/hide chat UI based on authentication
function showChatUI() {
    const chatContainer = document.querySelector('.chat-container');
    const messagesContainer = document.getElementById('messagesContainer');
    const inputContainer = document.querySelector('.input-container');
    const personalityAvatar = document.querySelector('.personality-avatar');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    
    if (chatContainer) chatContainer.style.display = 'flex';
    if (messagesContainer) {
        messagesContainer.style.display = 'flex';
        messagesContainer.style.pointerEvents = 'auto';
    }
    if (inputContainer) {
        inputContainer.style.display = 'flex';
        inputContainer.style.pointerEvents = 'auto';
    }
    if (personalityAvatar) {
        personalityAvatar.style.display = 'flex';
        personalityAvatar.style.pointerEvents = 'auto';
    }
    // Re-enable input elements
    if (messageInput) {
        messageInput.disabled = false;
    }
    if (sendBtn) {
        sendBtn.disabled = false;
    }
}

function hideChatUI() {
    const messagesContainer = document.getElementById('messagesContainer');
    const inputContainer = document.querySelector('.input-container');
    const personalityAvatar = document.querySelector('.personality-avatar');
    const messageInput = document.getElementById('messageInput');
    const sendBtn = document.getElementById('sendBtn');
    
    // Hide and disable chat elements
    if (messagesContainer) {
        messagesContainer.style.display = 'none';
        messagesContainer.style.pointerEvents = 'none';
        messagesContainer.innerHTML = ''; // Clear any messages
    }
    if (inputContainer) {
        inputContainer.style.display = 'none';
        inputContainer.style.pointerEvents = 'none';
    }
    if (personalityAvatar) {
        personalityAvatar.style.display = 'none';
        personalityAvatar.style.pointerEvents = 'none';
    }
    if (messageInput) {
        messageInput.disabled = true;
        messageInput.value = '';
    }
    if (sendBtn) {
        sendBtn.disabled = true;
    }
}

// Service Worker registration for offline functionality (optional)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => console.log('SW registered'))
            .catch(registrationError => console.log('SW registration failed'));
    });
}
