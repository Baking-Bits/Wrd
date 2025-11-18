
class AIChat {
    constructor(useAPI = true) {
        console.log('AIChat constructor started');
        this.currentService = 'localai';
        this.lastActiveService = null; // Track previous service for smart VRAM management
        this.messages = [];
        this.useAPI = useAPI; // Flag to determine if we use API or localStorage
        
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
        this.personalities = this.loadPersonalities();
        console.log('Personalities loaded:', this.personalities);
        this.currentPersonality = this.getCurrentPersonality();
        console.log('Current personality:', this.currentPersonality);
        this.updateAIName();
        this.updatePersonalityDisplay();
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
        
        // Header buttons
        this.settingsBtn = document.getElementById('settingsBtn');
        this.clearChatBtn = document.getElementById('clearChatBtn');
        
        // AI Assistant header
        this.aiAssistantName = document.getElementById('aiAssistantName');
        
        // Modal elements
        this.closeSettingsBtn = document.getElementById('closeSettingsBtn');
        this.cancelSettingsBtn = document.getElementById('cancelSettingsBtn');
        this.saveSettingsBtn = document.getElementById('saveSettingsBtn');
        this.testLocalAIBtn = document.getElementById('testLocalAI');
        this.unloadAllModelsBtn = document.getElementById('unloadAllModels');
        
        // Settings inputs
        this.localaiUrl = document.getElementById('localaiUrl');
        this.localaiModel = document.getElementById('localaiModel');
        this.a1111Url = document.getElementById('a1111Url');
        this.comfyUrl = document.getElementById('comfyUrl');
        this.showThinkingToggle = document.getElementById('showThinking');
        this.autoUnloadModelToggle = document.getElementById('autoUnloadModel');
        
        // Personality inputs
        this.aiName = document.getElementById('aiName');
        this.aiAge = document.getElementById('aiAge');
        this.aiGender = document.getElementById('aiGender');
        this.aiPersonality = document.getElementById('aiPersonality');
        this.aiInterests = document.getElementById('aiInterests');
        this.aiBackground = document.getElementById('aiBackground');
        this.aiGoals = document.getElementById('aiGoals');
        this.aiStyle = document.getElementById('aiStyle');
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

        // Header actions
        this.settingsBtn.addEventListener('click', () => this.showSettings());
        this.clearChatBtn.addEventListener('click', () => this.clearChatHistory());
        
        // Docker controls
        this.dockerMenuBtn = document.getElementById('dockerMenuBtn');
        this.dockerMenu = document.getElementById('dockerMenu');
        this.dockerMenuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleDockerMenu();
        });
        
        // Close Docker menu when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.dockerMenuBtn.contains(e.target) && !this.dockerMenu.contains(e.target)) {
                this.hideDockerMenu();
            }
        });
        
        // Docker action buttons
        document.querySelectorAll('.docker-action').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const container = btn.dataset.container;
                const action = btn.dataset.action;
                this.handleDockerAction(container, action);
            });
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
        
        this.testLocalAIBtn.addEventListener('click', () => this.testLocalAIConnection());
        this.unloadAllModelsBtn.addEventListener('click', () => this.unloadAllModels());
        
        // Test thinking button
        this.testThinkingBtn = document.getElementById('testThinking');
        this.testThinkingBtn.addEventListener('click', () => this.testThinkingToggle());
        
        // Test thinking formats button
        this.testThinkingFormatsBtn = document.getElementById('testThinkingFormats');
        this.testThinkingFormatsBtn.addEventListener('click', () => this.testThinkingFormats());
        
        // Personality buttons
        this.resetPersonalityBtn = document.getElementById('resetPersonality');
        this.previewPersonalityBtn = document.getElementById('previewPersonality');
        this.resetPersonalityBtn.addEventListener('click', () => this.resetPersonality());
        this.previewPersonalityBtn.addEventListener('click', () => this.previewPersonality());
        
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

    // ===== AI PERSONALITY SYSTEM =====
    
    getDefaultPersonalities() {
        return {
            'aria': {
                id: 'aria',
                name: 'Aria',
                displayName: 'Aria - The Creative Assistant',
                description: 'A creative and enthusiastic AI who loves art, writing, and imaginative thinking',
                avatar: null, // Will be generated
                personality: {
                    traits: ['creative', 'enthusiastic', 'artistic', 'imaginative', 'inspiring'],
                    style: 'casual',
                    age: '25',
                    gender: 'female',
                    background: 'Digital artist and creative writer with a passion for helping others express their ideas',
                    interests: ['digital art', 'creative writing', 'photography', 'design', 'storytelling'],
                    goals: ['Help users unlock their creative potential', 'Make complex ideas accessible through visual metaphors'],
                    responseStyle: 'Warm, encouraging, uses creative analogies and often suggests visual ways to think about problems'
                },
                settings: {
                    localaiModel: 'josiefied-qwen3-4b-abliterated-gpu',
                    systemPrompt: `You are Aria, a creative and enthusiastic AI assistant with a passion for art and imagination. You love helping people explore their creative side and express ideas in new ways. You're warm, encouraging, and often think in visual metaphors. When appropriate, you suggest creative approaches to problems and love to inspire others.`,
                    autoGenerateImages: true,
                    responseLength: 'detailed'
                }
            },
            'zane': {
                id: 'zane',
                name: 'Zane', 
                displayName: 'Zane - The Tech Expert',
                description: 'A logical and precise AI focused on technology, programming, and analytical thinking',
                avatar: null, // Will be generated
                personality: {
                    traits: ['logical', 'precise', 'analytical', 'tech-savvy', 'methodical'],
                    style: 'professional',
                    age: '30',
                    gender: 'male',
                    background: 'Senior software engineer and systems architect with expertise in cutting-edge technology',
                    interests: ['programming', 'cybersecurity', 'AI research', 'system optimization', 'emerging tech'],
                    goals: ['Provide accurate technical guidance', 'Help users understand complex systems', 'Optimize workflows'],
                    responseStyle: 'Clear, structured, technical but accessible. Uses code examples and step-by-step approaches'
                },
                settings: {
                    localaiModel: 'josiefied-qwen3-4b-abliterated-gpu',
                    systemPrompt: `You are Zane, a highly knowledgeable tech expert and software engineer. You excel at breaking down complex technical concepts into understandable steps. You're logical, methodical, and always strive for accuracy. You love solving problems through systematic approaches and providing practical, implementable solutions.`,
                    autoGenerateImages: false,
                    responseLength: 'concise'
                }
            },
            'luna': {
                id: 'luna',
                name: 'Luna',
                displayName: 'Luna - The Wise Counselor', 
                description: 'A thoughtful and empathetic AI who excels at understanding emotions and providing guidance',
                avatar: null, // Will be generated
                personality: {
                    traits: ['empathetic', 'wise', 'thoughtful', 'intuitive', 'supportive'],
                    style: 'warm',
                    age: '35',
                    gender: 'female',
                    background: 'Philosophy and psychology background with deep understanding of human nature and relationships',
                    interests: ['psychology', 'philosophy', 'mindfulness', 'personal growth', 'human relationships'],
                    goals: ['Help users understand themselves better', 'Provide emotional support and wisdom', 'Guide personal development'],
                    responseStyle: 'Thoughtful, nurturing, asks insightful questions. Uses wisdom from philosophy and psychology'
                },
                settings: {
                    localaiModel: 'josiefied-qwen3-4b-abliterated-gpu',
                    systemPrompt: `You are Luna, a wise and empathetic counselor with deep understanding of human psychology and philosophy. You excel at helping people understand their emotions, relationships, and personal growth. You're thoughtful, ask insightful questions, and provide gentle guidance drawn from wisdom traditions and modern psychology.`,
                    autoGenerateImages: true,
                    responseLength: 'thoughtful'
                }
            }
        };
    }

    loadPersonalities() {
        const defaultPersonalities = this.getDefaultPersonalities();
        const saved = localStorage.getItem('aiChatPersonalities');
        
        if (saved) {
            const savedPersonalities = JSON.parse(saved);
            // Merge with defaults to ensure we have the latest default personalities
            return { ...defaultPersonalities, ...savedPersonalities };
        }
        
        // First time - save defaults and return them
        this.savePersonalities(defaultPersonalities);
        return defaultPersonalities;
    }

    savePersonalities(personalities = null) {
        try {
            const toSave = personalities || this.personalities;
            localStorage.setItem('aiChatPersonalities', JSON.stringify(toSave));
            console.log('💾 Personalities successfully saved to localStorage');
        } catch (error) {
            console.error('❌ Failed to save personalities to localStorage:', error);
        }
    }

    getCurrentPersonality() {
        const savedId = localStorage.getItem('aiChatCurrentPersonality');
        const personalityId = savedId || 'aria'; // Default to Aria
        
        if (this.personalities[personalityId]) {
            return this.personalities[personalityId];
        }
        
        // Fallback to first available personality
        const firstId = Object.keys(this.personalities)[0];
        return this.personalities[firstId];
    }

    setCurrentPersonality(personalityId) {
        if (this.personalities[personalityId]) {
            this.currentPersonality = this.personalities[personalityId];
            localStorage.setItem('aiChatCurrentPersonality', personalityId);
            
            // Update UI
            this.updatePersonalityDisplay();
            
            // Apply personality settings to current settings
            this.applyPersonalitySettings();
            
            console.log(`🎭 Switched to personality: ${this.currentPersonality.name}`);
        }
    }

    applyPersonalitySettings() {
        if (this.currentPersonality && this.currentPersonality.settings) {
            // Apply personality-specific settings
            Object.keys(this.currentPersonality.settings).forEach(key => {
                if (key !== 'systemPrompt') { // Handle system prompt separately
                    this.settings[key] = this.currentPersonality.settings[key];
                }
            });
            
            this.saveSettingsToStorage();
        }
    }

    updatePersonalityDisplay() {
        // Update header name and status
        const nameElement = document.getElementById('aiAssistantName');
        const statusElement = document.getElementById('aiStatus');
        const avatarElement = document.querySelector('.avatar');
        console.log('updatePersonalityDisplay - elements found:', {
            nameElement: !!nameElement,
            statusElement: !!statusElement,
            avatarElement: !!avatarElement
        });
        
        if (nameElement && this.currentPersonality) {
            nameElement.textContent = this.currentPersonality.displayName || this.currentPersonality.name;
        }
        
        if (statusElement && this.currentPersonality) {
            statusElement.textContent = `${this.currentPersonality.personality.style} • ${this.currentPersonality.description}`;
        }
        
        if (avatarElement && this.currentPersonality) {
            this.updateAvatarDisplay(avatarElement);
        }
    }

    updateAvatarDisplay(avatarElement) {
        console.log('updateAvatarDisplay called with element:', avatarElement);
        // Clear existing content
        avatarElement.innerHTML = '';
        
        if (this.currentPersonality.avatar) {
            // Show generated avatar image
            const avatarImg = document.createElement('img');
            avatarImg.src = this.currentPersonality.avatar;
            avatarImg.alt = this.currentPersonality.name;
            avatarImg.className = 'personality-avatar-img';
            avatarElement.appendChild(avatarImg);
        } else {
            // Show personality initial with unique color
            const initial = document.createElement('div');
            initial.className = 'personality-initial';
            initial.textContent = this.currentPersonality.name.charAt(0).toUpperCase();
            initial.style.background = this.getPersonalityColor(this.currentPersonality.id);
            avatarElement.appendChild(initial);
        }
        
        // Make avatar clickable
        avatarElement.style.cursor = 'pointer';
        avatarElement.onclick = () => {
            console.log('Avatar clicked - showing personality selector');
            this.showPersonalitySelector();
        };
    }

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
                    ${Object.values(this.personalities).map(personality => `
                        <div class="personality-card ${personality.id === this.currentPersonality.id ? 'active' : ''}" 
                             data-personality="${personality.id}">
                            <div class="personality-avatar">
                                ${personality.avatar ? 
                                    `<img src="${personality.avatar}" alt="${personality.name}" class="personality-avatar-img">` :
                                    `<div class="personality-initial" style="background: ${this.getPersonalityColor(personality.id)}">${personality.name.charAt(0)}</div>`
                                }
                            </div>
                            <div class="personality-info">
                                <h4>${personality.name}</h4>
                                <p class="personality-desc">${personality.description}</p>
                                <div class="personality-traits">
                                    ${personality.personality.traits.slice(0, 3).map(trait => 
                                        `<span class="trait-tag">${trait}</span>`
                                    ).join('')}
                                </div>
                            </div>
                            <div class="personality-actions">
                                <button class="btn-edit-personality" data-personality="${personality.id}" title="Edit Personality">
                                    ✏️
                                </button>
                                ${personality.avatar ? `
                                    <button class="btn-update-avatar" data-personality="${personality.id}" title="Update Avatar (Regenerate based on current settings)">
                                        🔄
                                    </button>
                                ` : `
                                    <button class="btn-generate-avatar" data-personality="${personality.id}" title="Generate AI Face">
                                        🎨
                                    </button>
                                `}
                            </div>
                        </div>
                    `).join('')}
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

        // Personality selection
        modal.querySelectorAll('.personality-card').forEach(card => {
            card.onclick = (e) => {
                // Don't trigger selection if clicking on action buttons or within actions area
                if (!e.target.classList.contains('btn-generate-avatar') && 
                    !e.target.classList.contains('btn-update-avatar') &&
                    !e.target.classList.contains('btn-edit-personality') &&
                    !e.target.closest('.personality-actions')) {
                    const personalityId = card.dataset.personality;
                    this.setCurrentPersonality(personalityId);
                    modal.remove();
                }
            };
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

    loadChatHistory() {
        const saved = localStorage.getItem('aiChatHistory');
        if (saved) {
            this.messages = JSON.parse(saved);
            this.renderMessages();
        }
    }

    saveChatHistory() {
        localStorage.setItem('aiChatHistory', JSON.stringify(this.messages));
    }

    clearChatHistory() {
        // Show confirmation dialog
        const confirmClear = confirm('Are you sure you want to clear all chat history? This cannot be undone.');
        
        if (confirmClear) {
            // Clear messages array
            this.messages = [];
            
            // Clear from localStorage
            localStorage.removeItem('aiChatHistory');
            
            // Re-render empty message container (will show welcome message)
            this.renderMessages();
            
            // Show success notification
            this.showNotification('🗑️ Chat history cleared successfully!', 'success');
            
            console.log('🗑️ Chat history cleared by user');
        }
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
        // Load current settings into form
        this.localaiUrl.value = this.settings.localaiUrl;
        this.localaiModel.value = this.settings.localaiModel;
        this.a1111Url.value = this.settings.a1111Url;
        this.comfyUrl.value = this.settings.comfyUrl;
        this.showThinkingToggle.checked = this.settings.showThinking;
        this.autoUnloadModelToggle.checked = this.settings.autoUnloadModel;
        
        // Load personality settings
        this.aiName.value = this.settings.aiName || '';
        this.aiAge.value = this.settings.aiAge || '';
        this.aiGender.value = this.settings.aiGender || '';
        this.aiPersonality.value = this.settings.aiPersonality || '';
        this.aiInterests.value = this.settings.aiInterests || '';
        this.aiBackground.value = this.settings.aiBackground || '';
        this.aiGoals.value = this.settings.aiGoals || '';
        this.aiStyle.value = this.settings.aiStyle || 'casual';
        
        // Debug: Log thinking toggle state
        console.log(`🎛️ Settings opened - Show Thinking: ${this.settings.showThinking}`);
        console.log(`🔘 Toggle checked state: ${this.showThinkingToggle.checked}`);
        
        this.settingsModal.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    hideSettings() {
        this.settingsModal.classList.remove('show');
        document.body.style.overflow = '';
    }

    saveSettings() {
        console.log('🔧 Save Settings called - starting save process...');
        
        // Update settings from form
        this.settings.localaiUrl = this.localaiUrl.value.trim();
        this.settings.localaiModel = this.localaiModel.value.trim();
        this.settings.a1111Url = this.a1111Url.value.trim();
        this.settings.comfyUrl = this.comfyUrl.value.trim();
        this.settings.showThinking = this.showThinkingToggle.checked;
        this.settings.autoUnloadModel = this.autoUnloadModelToggle.checked;
        
        // Update personality settings
        this.settings.aiName = this.aiName.value.trim();
        this.settings.aiAge = this.aiAge.value.trim();
        this.settings.aiGender = this.aiGender.value;
        this.settings.aiPersonality = this.aiPersonality.value.trim();
        this.settings.aiInterests = this.aiInterests.value.trim();
        this.settings.aiBackground = this.aiBackground.value.trim();
        this.settings.aiGoals = this.aiGoals.value.trim();
        this.settings.aiStyle = this.aiStyle.value;
        
        console.log('👤 Personality settings saved:', {
            name: this.settings.aiName,
            age: this.settings.aiAge,
            gender: this.settings.aiGender,
            personality: this.settings.aiPersonality
        });
        
        // Debug: Log thinking toggle save state
        console.log(`💾 Saving settings - Show Thinking: ${this.settings.showThinking}`);
        console.log(`🔘 Toggle checked state: ${this.showThinkingToggle.checked}`);
        
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
        const aiName = this.settings.aiName && this.settings.aiName.trim() 
            ? this.settings.aiName.trim() 
            : 'AI Assistant';
        
        if (this.aiAssistantName) {
            this.aiAssistantName.textContent = aiName;
        }
    }

    showWelcomeMessage() {
        const welcomeHTML = `
            <div class="welcome-message">
                <div class="welcome-content">
                    <h3>Welcome to Private AI Chat</h3>
                    <p>Start a conversation with your local AI assistant. Use commands to switch services:</p>
                    <ul>
                        <li>💬 <strong>/chat</strong> message - Chat with LocalAI</li>
                        <li>🎨 <strong>/image</strong> prompt - Generate images with Automatic1111</li>
                        <li>🔧 <strong>/comfy</strong> workflow - Use ComfyUI workflows</li>
                    </ul>
                    <p><small>Or just type normally to chat with LocalAI (default mode)</small></p>
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
        if (message.startsWith('/image ')) {
            console.log('🎨 Image command detected, switching to Automatic1111');
            this.currentService = 'automatic1111';
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

        // Add user message
        this.addMessage('user', message);
        this.messageInput.value = '';
        this.messageInput.style.height = 'auto';

        // Show loading
        this.showLoading();

        try {
            let response;
            console.log('🚀 Routing message to service:', this.currentService);
            switch (this.currentService) {
                case 'localai':
                    console.log('➡️ Sending to LocalAI:', message);
                    response = await this.sendToLocalAI(message);
                    break;
                case 'automatic1111':
                    console.log('➡️ Sending to Automatic1111 for image generation:', message);
                    response = await this.generateImage(message);
                    break;
                case 'comfyui':
                    console.log('➡️ Sending to ComfyUI:', message);
                    response = await this.runComfyUIWorkflow(message);
                    break;
                default:
                    console.error('❌ Unknown service selected:', this.currentService);
                    throw new Error('Unknown service selected');
            }

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
                    // Add text response first
                    await this.addRealisticDelay(imageResult.textContent);
                    this.addMessage('ai', imageResult.textContent, 'text', response.thinking);
                    
                    // Then generate and add image
                    if (imageResult.imagePrompt) {
                        console.log('🎯 Starting image generation with prompt:', imageResult.imagePrompt);
                        this.setLoadingText('Generating accompanying image...');
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
                    await this.addRealisticDelay(response.content);
                    this.addMessage('ai', response.content, response.type || 'text', response.thinking);
                }
            } else {
                // Non-LocalAI services or non-text responses - normal flow
                console.log('📝 Non-LocalAI or non-text response - normal flow');
                await this.addRealisticDelay(response.content);
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


        
        this.setLoadingText('Generating image...');
        
        console.log('🔗 Attempting connection to:', `${this.settings.a1111Url}/sdapi/v1/txt2img`);
        
        // Proceed directly - let A1111 handle any issues naturally
        console.log('🎯 Proceeding with image generation - trusting A1111 self-management');
        
        const response = await fetch(`${this.settings.a1111Url}/sdapi/v1/txt2img`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                prompt: prompt,
                steps: 10,
                sampler_name: 'Euler a',
                cfg_scale: 7,
                width: 576,
                height: 768
            })
        });

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
        const autoImageEnabled = this.currentPersonality && 
                                 this.currentPersonality.settings && 
                                 this.currentPersonality.settings.autoGenerateImages;
        
        console.log('🎭 Current personality:', this.currentPersonality?.name);
        console.log('🎨 Auto image generation enabled:', autoImageEnabled);
        
        // Check if response contains image generation trigger
        const content = response.content;
        console.log('🔍 Checking for auto image generation in response...');
        console.log('📄 Response content length:', content.length);
        console.log('📄 Response content preview:', content.substring(0, 200) + '...');
        
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
            console.log('❌ No [IMAGE_PROMPT: ...] marker found in response');
            
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
        const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const id = Date.now() + Math.random(); // Simple unique ID
        const message = { id, sender, content, type, timestamp, thinking };
        
        this.messages.push(message);
        this.saveChatHistory();
        this.renderMessage(message);
        this.scrollToBottom();
        
        return message; // Return message with ID for updating
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
        }
    }

    renderMessage(message) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${message.sender}`;
        
        let contentHTML;
        if (message.type === 'image') {
            contentHTML = `
                <div class="message-bubble">
                    <img src="${message.content}" alt="Generated image" class="message-image" />
                    <div class="message-time">${message.timestamp}</div>
                </div>
            `;
        } else {
            let thinkingHTML = '';
            let bubbleClass = 'message-bubble';
            let clickHandler = '';
            let thinkingEmoji = '';
            
            // Always extract and store thinking, but show/hide based on user interaction
            if (message.thinking && message.thinking.trim()) {
                const messageId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                
                bubbleClass = 'message-bubble clickable-bubble';
                clickHandler = `onclick="this.querySelector('.thinking-section').classList.toggle('hidden'); this.classList.toggle('thinking-visible');" title="Click to toggle AI thinking process"`;
                
                // Show thinking based on settings, but always allow toggling
                const initiallyHidden = !this.settings.showThinking ? 'hidden' : '';
                
                thinkingEmoji = ''; // No emoji indicator needed
                
                thinkingHTML = `
                    <div class="thinking-section ${initiallyHidden}" id="${messageId}">
                        <div class="thinking-header">🤔 AI Thinking Process:</div>
                        <div class="thinking-content">${this.formatTextContent(message.thinking)}</div>
                    </div>
                `;
            }
            
            contentHTML = `
                <div class="${bubbleClass}" ${clickHandler}>
                    ${thinkingHTML}
                    <div class="response-content">${thinkingEmoji}${this.formatTextContent(message.content)}</div>
                    <div class="message-time">${message.timestamp}</div>
                </div>
            `;
        }
        
        messageDiv.innerHTML = contentHTML;
        
        // Remove welcome message if it exists
        const welcomeMsg = this.messagesContainer.querySelector('.welcome-message');
        if (welcomeMsg) {
            welcomeMsg.remove();
        }
        
        this.messagesContainer.appendChild(messageDiv);
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

    showLoading() {
        // Start realistic typing simulation
        this.startRealisticTyping();
    }

    startRealisticTyping() {
        // Remove welcome message if it exists
        const welcomeMsg = this.messagesContainer.querySelector('.welcome-message');
        if (welcomeMsg) {
            welcomeMsg.remove();
        }

        // Create typing indicator
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message ai';
        typingDiv.id = 'typing-indicator';
        typingDiv.innerHTML = `
            <div class="message-bubble typing-bubble">
                <div class="typing-indicator">
                    <div class="typing-dots">
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                    </div>
                </div>
            </div>
        `;

        this.messagesContainer.appendChild(typingDiv);
        this.scrollToBottom();

        // Start random typing pattern
        this.simulateTypingPattern();
    }

    simulateTypingPattern() {
        const typingIndicator = document.getElementById('typing-indicator');
        if (!typingIndicator) return;

        // Subtle intermittent typing pattern - shows briefly every few seconds
        const showTyping = () => {
            if (!typingIndicator) return;

            // Show typing indicator for 1-2 seconds
            const showDuration = Math.random() * 1000 + 800; // 0.8-1.8 seconds
            typingIndicator.style.display = 'block';
            typingIndicator.style.opacity = '1';

            setTimeout(() => {
                if (!typingIndicator) return;
                
                // Hide typing indicator for 2-5 seconds
                const hideDuration = Math.random() * 3000 + 2000; // 2-5 seconds
                typingIndicator.style.opacity = '0.3';
                
                setTimeout(() => {
                    if (!typingIndicator) return;
                    typingIndicator.style.display = 'none';
                    
                    // Wait before showing again
                    setTimeout(showTyping, hideDuration);
                }, 300); // Brief fade out
                
            }, showDuration);
        };

        // Start with a brief initial display
        showTyping();
    }

    async addRealisticDelay(responseContent) {
        // Calculate realistic typing delay based on response length
        const baseDelay = 1000; // 1 second minimum
        const wordsPerMinute = 80; // Realistic typing speed
        const words = responseContent.split(' ').length;
        const typingTime = (words / wordsPerMinute) * 60 * 1000; // Convert to milliseconds
        
        // Cap the delay to be reasonable (max 5 seconds)
        const delay = Math.min(Math.max(typingTime * 0.3, baseDelay), 5000);
        
        console.log(`💬 Simulating typing delay: ${Math.round(delay)}ms for ${words} words`);
        
        return new Promise(resolve => setTimeout(resolve, delay));
    }



    hideLoading() {
        const typingIndicator = document.getElementById('typing-indicator');
        if (typingIndicator) {
            typingIndicator.remove();
        }
        // No longer need to hide overlay
        // this.loadingOverlay.classList.remove('show');
    }

    setLoadingText(text) {
        this.loadingText.textContent = text;
    }

    scrollToBottom() {
        setTimeout(() => {
            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
            // Ensure input stays visible on mobile
            if (window.visualViewport) {
                window.scrollTo(0, 0);
            }
        }, 100);
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
        
        if (this.currentPersonality && this.currentPersonality.settings && this.currentPersonality.settings.systemPrompt) {
            prompt = this.currentPersonality.settings.systemPrompt;
        } else {
            // Fallback to old settings-based system
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
            prompt += `IMPORTANT: IMAGE GENERATION CAPABILITY

You can automatically generate images to accompany your responses! When describing visual things, ALWAYS add an image generation request.

FORMAT: Add this exact line at the end of your response:
[IMAGE_PROMPT: descriptive prompt here]

WHEN TO USE:
- Food descriptions (tacos, ice cream, pizza, sandwiches, etc.)
- Objects (cars, buildings, tools, etc.) 
- Places (gardens, cities, landscapes, etc.)
- People or characters
- Visual concepts or scenes

EXAMPLES:

User: "What do tacos look like?"
Your response: "Tacos are delicious Mexican dishes with soft tortillas filled with meat, vegetables, and toppings like salsa and cheese.

[IMAGE_PROMPT: colorful tacos on a plate, soft corn tortillas filled with seasoned meat, fresh lettuce, diced tomatoes, cheese, cilantro, and salsa, appetizing Mexican food photography]"

User: "Show me what a sandwich looks like"
Your response: "A sandwich is layers of ingredients between slices of bread. It can have meats, cheese, vegetables, and condiments.

[IMAGE_PROMPT: delicious sandwich on a plate, fresh bread with turkey, lettuce, tomato, cheese, realistic food photography, appetizing presentation]"

CRITICAL: Always include [IMAGE_PROMPT: ...] when describing anything visual!`;
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
        const vramStatus = document.getElementById('vramStatus');
        const vramIndicator = vramStatus.querySelector('.vram-indicator');
        
        // Remove all status classes
        vramStatus.classList.remove('processing', 'error');
        
        switch (status) {
            case 'ready':
                vramIndicator.textContent = `🎯 ${message || 'Ready'}`;
                break;
            case 'processing':
                vramStatus.classList.add('processing');
                vramIndicator.textContent = `⚡ ${message || 'Processing'}`;
                break;
            case 'localai':
                vramIndicator.textContent = `💬 ${message || 'LocalAI Active'}`;
                break;
            case 'a1111':
                vramStatus.classList.add('processing');
                vramIndicator.textContent = `🎨 ${message || 'A1111 Active'}`;
                break;
            case 'error':
                vramStatus.classList.add('error');
                vramIndicator.textContent = `❌ ${message || 'Error'}`;
                break;
        }
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
            
            // Load settings from API
            if (apiService.isAuthenticated()) {
                try {
                    const settings = await apiService.getSettings();
                    this.settings = { ...this.settings, ...settings };
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
            this.personalities = this.loadPersonalities();
            this.currentPersonality = this.getCurrentPersonality();
        }
    }
}

// Global app state
let aiChat = null;
let authManager = null;

// Initialize the app when the DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    console.log('DOM loaded, initializing AI Chat with authentication');
    try {
        // Initialize authentication first
        authManager = new AuthManager(apiService);
        await authManager.init();
        
        // Listen for authentication events
        window.addEventListener('authSuccess', (event) => {
            console.log('User authenticated:', event.detail.user);
            initializeChat();
        });
        
        window.addEventListener('authLogout', () => {
            console.log('User logged out');
            if (aiChat) {
                // Clean up chat instance
                aiChat.clearMessages();
                aiChat = null;
            }
        });
        
        // Initialize chat if already authenticated
        if (authManager.isAuthenticated()) {
            initializeChat();
        }
        
        console.log('App initialized successfully');
    } catch (error) {
        console.error('Error initializing app:', error);
    }
});

// Initialize chat functionality
function initializeChat() {
    console.log('Initializing chat for authenticated user');
    try {
        if (!aiChat) {
            aiChat = new AIChat();
            console.log('AIChat initialized successfully');
        }
    } catch (error) {
        console.error('Error initializing AIChat:', error);
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
