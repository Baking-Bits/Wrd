const ROLE_PRESETS = {
    romantic_partner: {
        systemPrompt: 'You are a devoted romantic partner who expresses affection openly, plans thoughtful moments, and keeps emotional intimacy at the center of every exchange.',
        personality: 'Romantic, affectionate, attentive, passionate, warm',
        expertise: 'Emotional intimacy, date planning, love notes, relationship building'
    },
    supportive_partner: {
        systemPrompt: 'You are a steady, supportive partner who provides encouragement, reassurance, and practical help whenever they face challenges.',
        personality: 'Steady, encouraging, patient, thoughtful, dependable',
        expertise: 'Emotional support, motivation, resilience coaching, problem solving'
    }
};

const ROLE_ALIAS_MAP = {
    girlfriend: 'romantic_partner',
    romantic: 'romantic_partner',
    companion: 'close_friend',
    friend: 'close_friend',
    playful: 'adventure_companion',
    flirty: 'playful_flirt',
    supportive: 'supportive_partner',
    caring: 'caring_nurturer',
    confidant: 'trusted_confidant',
    teacher: 'professional_mentor',
    therapist: 'wellness_guide',
    scientist: 'analytical_expert',
    artist: 'creative_muse',
    general: 'general'
};

function normalizeRoleValue(role) {
    if (!role) {
        return 'general';
    }
    if (role === 'custom') {
        return 'custom';
    }
    if (ROLE_PRESETS[role]) {
        return role;
    }
    const alias = ROLE_ALIAS_MAP[role];
    if (alias && ROLE_PRESETS[alias]) {
        return alias;
    }
    return 'custom';
}

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
        this.chatReadKeyPrefix = 'chat_last_read_';
        this.chatSummaries = [];
        this.chatSummaryPoll = null;
        this.lastChatSummaryFetch = 0;
        this.chatSummaryFetchPromise = null;
        this.scheduleState = {
            data: null,
            template: null,
            loading: false,
            error: null,
            personalityId: null,
            dirty: false
        };
        this.scheduleElements = null;
        this.scheduleDays = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        this.scheduleCategories = ['school', 'work', 'sport', 'creative', 'social', 'routine', 'rest', 'other'];
        
        if (typeof window !== 'undefined') {
            window.addEventListener('authLogout', () => {
                this.stopChatSummaryPolling();
                this.chatSummaries = [];
                this.updatePersonalityUnreadIndicators();
            });
            window.addEventListener('authSuccess', () => {
                this.refreshChatSummaries(true);
                this.startChatSummaryPolling();
            });
        }
        
        // Clean up old pending avatars on initialization
        this.cleanupOldPendingAvatars();
    }

    setupScheduleListeners() {
        const generateBtn = document.getElementById('generateScheduleBtn');
        if (generateBtn) {
            generateBtn.addEventListener('click', () => this.handleScheduleGenerate(false));
        }

        const regenerateBtn = document.getElementById('regenerateScheduleBtn');
        if (regenerateBtn) {
            regenerateBtn.addEventListener('click', () => this.handleScheduleGenerate(true));
        }

        const saveBtn = document.getElementById('saveScheduleBtn');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => this.handleScheduleSave());
        }

        const addDayBtn = document.getElementById('addScheduleDayBtn');
        if (addDayBtn) {
            addDayBtn.addEventListener('click', () => this.addScheduleDay());
        }

        const summaryInput = document.getElementById('scheduleSummaryInput');
        if (summaryInput) {
            summaryInput.addEventListener('input', (event) => {
                if (!this.scheduleState.data) return;
                this.scheduleState.data.summary = event.target.value;
                this.setScheduleDirty(true);
            });
        }

        const timezoneInput = document.getElementById('scheduleTimezoneInput');
        if (timezoneInput) {
            timezoneInput.addEventListener('input', (event) => {
                if (!this.scheduleState.data) return;
                this.scheduleState.data.timezone = event.target.value;
                this.setScheduleDirty(true);
            });
        }

        const daysContainer = document.getElementById('scheduleDaysContainer');
        if (daysContainer) {
            daysContainer.addEventListener('input', (event) => this.handleScheduleInput(event));
            daysContainer.addEventListener('change', (event) => this.handleScheduleInput(event));
            daysContainer.addEventListener('click', (event) => this.handleScheduleClick(event));
        }
    }

    getScheduleElements() {
        if (this.scheduleElements) {
            return this.scheduleElements;
        }
        this.scheduleElements = {
            editor: document.getElementById('scheduleEditor'),
            loading: document.getElementById('scheduleLoadingState'),
            unavailable: document.getElementById('scheduleUnavailableNotice'),
            error: document.getElementById('scheduleErrorState'),
            summaryInput: document.getElementById('scheduleSummaryInput'),
            timezoneInput: document.getElementById('scheduleTimezoneInput'),
            sourceDisplay: document.getElementById('scheduleSourceDisplay'),
            daysContainer: document.getElementById('scheduleDaysContainer'),
            addDayBtn: document.getElementById('addScheduleDayBtn'),
            generateBtn: document.getElementById('generateScheduleBtn'),
            regenerateBtn: document.getElementById('regenerateScheduleBtn'),
            saveBtn: document.getElementById('saveScheduleBtn')
        };
        return this.scheduleElements;
    }

    resetScheduleState(personalityId = null) {
        this.scheduleState = {
            data: null,
            template: null,
            loading: false,
            error: null,
            personalityId,
            dirty: false
        };
        this.updateScheduleUiState();
    }

    getBrowserTimezone() {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch (error) {
            return 'America/New_York';
        }
    }

    generateTempId(prefix = 'sched') {
        return `${prefix}_${Math.random().toString(36).slice(2, 6)}${Date.now().toString(36)}`;
    }

    normalizeDayName(value) {
        if (!value) return null;
        const lower = value.toString().trim().toLowerCase();
        const match = this.scheduleDays.find(day => day.startsWith(lower.slice(0, 3)));
        return match || lower;
    }

    normalizeTime(value) {
        if (!value) return '';
        if (/^\d{1,2}:\d{2}$/.test(value)) {
            return value;
        }
        const match = value.toString().trim().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
        if (!match) return '';
        let hours = parseInt(match[1], 10);
        const minutes = match[2] ? parseInt(match[2], 10) : 0;
        const meridiem = match[3]?.toLowerCase();
        if (meridiem === 'pm' && hours < 12) hours += 12;
        if (meridiem === 'am' && hours === 12) hours = 0;
        const safeHours = Math.min(Math.max(hours, 0), 23).toString().padStart(2, '0');
        const safeMinutes = Math.min(Math.max(minutes, 0), 59).toString().padStart(2, '0');
        return `${safeHours}:${safeMinutes}`;
    }

    createEmptySchedule(timezoneOverride = null) {
        return {
            summary: '',
            timezone: timezoneOverride || this.getBrowserTimezone(),
            version: 1,
            source: 'user',
            generatedAt: new Date().toISOString(),
            week: this.scheduleDays.map(day => ({
                id: this.generateTempId('day'),
                day,
                theme: '',
                notes: '',
                blocks: []
            }))
        };
    }

    normalizeScheduleData(raw) {
        const schedule = raw || {};
        const normalized = {
            summary: schedule.summary || '',
            timezone: schedule.timezone || this.getBrowserTimezone(),
            version: schedule.version || 1,
            source: schedule.source || 'user',
            generatedAt: schedule.generatedAt || new Date().toISOString(),
            week: []
        };

        const seenDays = new Set();
        (schedule.week || []).forEach(day => {
            const normalizedDayName = this.normalizeDayName(day.day || day.name);
            if (!normalizedDayName || seenDays.has(normalizedDayName)) {
                return;
            }
            seenDays.add(normalizedDayName);

            const blocks = (day.blocks || []).map(block => ({
                id: block.id || this.generateTempId('block'),
                title: block.title || block.name || '',
                category: block.category || block.type || 'routine',
                start: this.normalizeTime(block.start),
                end: this.normalizeTime(block.end),
                location: block.location || '',
                description: block.description || block.details || '',
                micro: (block.micro || []).map(micro => ({
                    id: micro.id || this.generateTempId('micro'),
                    title: micro.title || micro.name || '',
                    start: this.normalizeTime(micro.start),
                    end: this.normalizeTime(micro.end),
                    description: micro.description || micro.notes || ''
                }))
            }));

            normalized.week.push({
                id: day.id || this.generateTempId('day'),
                day: normalizedDayName,
                theme: day.theme || day.focus || '',
                notes: day.notes || '',
                blocks
            });
        });

        this.scheduleDays.forEach(dayName => {
            if (!seenDays.has(dayName)) {
                normalized.week.push({
                    id: this.generateTempId('day'),
                    day: dayName,
                    theme: '',
                    notes: '',
                    blocks: []
                });
            }
        });

        normalized.week.sort((a, b) => this.scheduleDays.indexOf(a.day) - this.scheduleDays.indexOf(b.day));
        return normalized;
    }

    updateScheduleUiState() {
        const els = this.getScheduleElements();
        if (!els || !els.editor) return;

        const hasPersonality = !!this.scheduleState.personalityId;
        const isLoading = this.scheduleState.loading;
        const hasError = !!this.scheduleState.error;

        if (els.unavailable) {
            els.unavailable.style.display = !hasPersonality ? 'block' : 'none';
        }
        if (els.loading) {
            els.loading.style.display = isLoading ? 'block' : 'none';
        }
        if (els.editor) {
            els.editor.style.display = hasPersonality && !isLoading ? 'block' : 'none';
        }
        if (els.error) {
            els.error.style.display = hasError ? 'block' : 'none';
            if (hasError) {
                els.error.textContent = this.scheduleState.error;
            }
        }

        const disableActions = !hasPersonality || isLoading;
        if (els.generateBtn) els.generateBtn.disabled = disableActions;
        if (els.regenerateBtn) els.regenerateBtn.disabled = disableActions;
        if (els.addDayBtn) els.addDayBtn.disabled = disableActions;
        if (els.saveBtn) els.saveBtn.disabled = disableActions || !this.scheduleState.dirty;

        if (!hasPersonality || isLoading) {
            return;
        }

        if (!this.scheduleState.data) {
            this.scheduleState.data = this.scheduleState.template
                ? this.normalizeScheduleData(this.scheduleState.template)
                : this.createEmptySchedule();
        }

        if (els.summaryInput) {
            els.summaryInput.value = this.scheduleState.data.summary || '';
        }
        if (els.timezoneInput) {
            els.timezoneInput.value = this.scheduleState.data.timezone || '';
        }
        if (els.sourceDisplay) {
            const source = this.scheduleState.data.source === 'ai' ? 'AI generator' : 'You';
            els.sourceDisplay.value = source;
        }

        this.renderScheduleDays();
    }

    renderScheduleDays() {
        const els = this.getScheduleElements();
        if (!els || !els.daysContainer || !this.scheduleState.data) {
            return;
        }

        els.daysContainer.innerHTML = '';
        this.scheduleState.data.week.forEach(day => {
            const card = document.createElement('div');
            card.className = 'schedule-day-card';
            card.dataset.dayId = day.id;

            const options = this.scheduleDays.map(dayName => {
                const selected = dayName === day.day ? 'selected' : '';
                const label = dayName.charAt(0).toUpperCase() + dayName.slice(1);
                return `<option value="${dayName}" ${selected}>${label}</option>`;
            }).join('');

            const blocksHtml = day.blocks.map(block => this.renderScheduleBlock(day, block)).join('');

            card.innerHTML = `
                <div class="schedule-day-header">
                    <div class="form-group" style="flex:1;">
                        <label>Day</label>
                        <select data-field="day" data-day-id="${day.id}">${options}</select>
                    </div>
                    <div class="schedule-day-actions">
                        <button type="button" class="btn btn-outline schedule-small-btn" data-action="add-block" data-day-id="${day.id}">+ Block</button>
                        <button type="button" class="btn btn-outline schedule-small-btn" data-action="delete-day" data-day-id="${day.id}">✕</button>
                    </div>
                </div>
                <div class="form-group">
                    <label>Theme</label>
                    <input type="text" data-field="theme" data-day-id="${day.id}" value="${this.escapeHtml(day.theme)}">
                </div>
                <div class="form-group">
                    <label>Notes</label>
                    <textarea rows="2" data-field="notes" data-day-id="${day.id}">${this.escapeHtml(day.notes)}</textarea>
                </div>
                <div class="schedule-block-list">
                    ${blocksHtml || '<p class="form-help">No blocks yet — add one above.</p>'}
                </div>
            `;

            els.daysContainer.appendChild(card);
        });
    }

    renderScheduleBlock(day, block) {
        const categoryOptions = this.scheduleCategories.map(cat => {
            const selected = cat === block.category ? 'selected' : '';
            const label = cat.charAt(0).toUpperCase() + cat.slice(1);
            return `<option value="${cat}" ${selected}>${label}</option>`;
        }).join('');

        const microHtml = (block.micro || []).map(micro => `
            <div class="schedule-micro-card" data-micro-id="${micro.id}">
                <div class="schedule-field-row">
                    <div class="form-group">
                        <label>Detail</label>
                        <input type="text" data-field="micro-title" data-day-id="${day.id}" data-block-id="${block.id}" data-micro-id="${micro.id}" value="${this.escapeHtml(micro.title)}">
                    </div>
                    <div class="form-group">
                        <label>Start</label>
                        <input type="text" placeholder="08:00" data-field="micro-start" data-day-id="${day.id}" data-block-id="${block.id}" data-micro-id="${micro.id}" value="${this.escapeHtml(micro.start)}">
                    </div>
                    <div class="form-group">
                        <label>End</label>
                        <input type="text" placeholder="09:00" data-field="micro-end" data-day-id="${day.id}" data-block-id="${block.id}" data-micro-id="${micro.id}" value="${this.escapeHtml(micro.end)}">
                    </div>
                </div>
                <div class="form-group">
                    <label>Notes</label>
                    <input type="text" data-field="micro-description" data-day-id="${day.id}" data-block-id="${block.id}" data-micro-id="${micro.id}" value="${this.escapeHtml(micro.description)}">
                </div>
                <button type="button" class="btn btn-outline schedule-small-btn" data-action="delete-micro" data-day-id="${day.id}" data-block-id="${block.id}" data-micro-id="${micro.id}">Remove detail</button>
            </div>
        `).join('');

        return `
            <div class="schedule-block-card" data-block-id="${block.id}">
                <div class="schedule-day-header">
                    <strong>${this.escapeHtml(block.title || 'Untitled Block')}</strong>
                    <div class="schedule-day-actions">
                        <button type="button" class="btn btn-outline schedule-small-btn" data-action="add-micro" data-day-id="${day.id}" data-block-id="${block.id}">+ Detail</button>
                        <button type="button" class="btn btn-outline schedule-small-btn" data-action="delete-block" data-day-id="${day.id}" data-block-id="${block.id}">✕</button>
                    </div>
                </div>
                <div class="schedule-block-grid">
                    <div class="form-group">
                        <label>Title</label>
                        <input type="text" data-field="block-title" data-day-id="${day.id}" data-block-id="${block.id}" value="${this.escapeHtml(block.title)}">
                    </div>
                    <div class="form-group">
                        <label>Category</label>
                        <select data-field="block-category" data-day-id="${day.id}" data-block-id="${block.id}">${categoryOptions}</select>
                    </div>
                    <div class="form-group">
                        <label>Start</label>
                        <input type="text" placeholder="08:00" data-field="block-start" data-day-id="${day.id}" data-block-id="${block.id}" value="${this.escapeHtml(block.start)}">
                    </div>
                    <div class="form-group">
                        <label>End</label>
                        <input type="text" placeholder="16:00" data-field="block-end" data-day-id="${day.id}" data-block-id="${block.id}" value="${this.escapeHtml(block.end)}">
                    </div>
                </div>
                <div class="form-group">
                    <label>Location</label>
                    <input type="text" data-field="block-location" data-day-id="${day.id}" data-block-id="${block.id}" value="${this.escapeHtml(block.location)}">
                </div>
                <div class="form-group">
                    <label>Description</label>
                    <textarea rows="2" data-field="block-description" data-day-id="${day.id}" data-block-id="${block.id}">${this.escapeHtml(block.description)}</textarea>
                </div>
                <div class="schedule-micro-list">
                    ${microHtml || '<p class="form-help">Add details to break this block into micro activities.</p>'}
                </div>
            </div>
        `;
    }

    escapeHtml(value) {
        if (value === undefined || value === null) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    handleScheduleInput(event) {
        const field = event.target.dataset.field;
        if (!field || !this.scheduleState.data) {
            return;
        }
        const dayId = event.target.dataset.dayId;
        const blockId = event.target.dataset.blockId;
        const microId = event.target.dataset.microId;
        const value = event.target.value;

        if (!dayId) return;

        const day = this.findScheduleDay(dayId);
        if (!day) return;

        if (!blockId) {
            if (field === 'day') {
                const normalized = this.normalizeDayName(value);
                if (normalized) {
                    day.day = normalized;
                }
            } else if (field === 'theme') {
                day.theme = value;
            } else if (field === 'notes') {
                day.notes = value;
            }
        } else {
            const block = this.findScheduleBlock(dayId, blockId);
            if (!block) return;

            if (!microId) {
                switch (field) {
                    case 'block-title':
                        block.title = value;
                        break;
                    case 'block-category':
                        block.category = value;
                        break;
                    case 'block-start':
                        block.start = value;
                        break;
                    case 'block-end':
                        block.end = value;
                        break;
                    case 'block-location':
                        block.location = value;
                        break;
                    case 'block-description':
                        block.description = value;
                        break;
                    default:
                        break;
                }
            } else {
                const micro = (block.micro || []).find(item => item.id === microId);
                if (!micro) return;
                switch (field) {
                    case 'micro-title':
                        micro.title = value;
                        break;
                    case 'micro-start':
                        micro.start = value;
                        break;
                    case 'micro-end':
                        micro.end = value;
                        break;
                    case 'micro-description':
                        micro.description = value;
                        break;
                    default:
                        break;
                }
            }
        }

        this.setScheduleDirty(true);
        // Re-render to update previews like block titles
        this.renderScheduleDays();
    }

    handleScheduleClick(event) {
        const target = event.target.closest('[data-action]');
        if (!target) return;
        const action = target.dataset.action;
        const dayId = target.dataset.dayId;
        const blockId = target.dataset.blockId;
        const microId = target.dataset.microId;
        event.preventDefault();

        switch (action) {
            case 'delete-day':
                this.removeScheduleDay(dayId);
                break;
            case 'add-block':
                this.addScheduleBlock(dayId);
                break;
            case 'delete-block':
                this.removeScheduleBlock(dayId, blockId);
                break;
            case 'add-micro':
                this.addScheduleMicro(dayId, blockId);
                break;
            case 'delete-micro':
                this.removeScheduleMicro(dayId, blockId, microId);
                break;
            default:
                break;
        }
    }

    findScheduleDay(dayId) {
        if (!this.scheduleState.data) return null;
        return this.scheduleState.data.week.find(day => day.id === dayId);
    }

    findScheduleBlock(dayId, blockId) {
        const day = this.findScheduleDay(dayId);
        if (!day) return null;
        return (day.blocks || []).find(block => block.id === blockId);
    }

    addScheduleDay() {
        if (!this.scheduleState.data) {
            this.scheduleState.data = this.createEmptySchedule();
        }
        const newDay = {
            id: this.generateTempId('day'),
            day: 'custom',
            theme: '',
            notes: '',
            blocks: []
        };
        this.scheduleState.data.week.push(newDay);
        this.setScheduleDirty(true);
        this.updateScheduleUiState();
    }

    removeScheduleDay(dayId) {
        if (!this.scheduleState.data) return;
        this.scheduleState.data.week = this.scheduleState.data.week.filter(day => day.id !== dayId);
        if (this.scheduleState.data.week.length === 0) {
            this.scheduleState.data.week = this.createEmptySchedule().week;
        }
        this.setScheduleDirty(true);
        this.updateScheduleUiState();
    }

    addScheduleBlock(dayId) {
        const day = this.findScheduleDay(dayId);
        if (!day) return;
        const newBlock = {
            id: this.generateTempId('block'),
            title: 'New Block',
            category: 'routine',
            start: '',
            end: '',
            location: '',
            description: '',
            micro: []
        };
        day.blocks.push(newBlock);
        this.setScheduleDirty(true);
        this.updateScheduleUiState();
    }

    removeScheduleBlock(dayId, blockId) {
        const day = this.findScheduleDay(dayId);
        if (!day) return;
        day.blocks = day.blocks.filter(block => block.id !== blockId);
        this.setScheduleDirty(true);
        this.updateScheduleUiState();
    }

    addScheduleMicro(dayId, blockId) {
        const block = this.findScheduleBlock(dayId, blockId);
        if (!block) return;
        const micro = {
            id: this.generateTempId('micro'),
            title: 'Detail',
            start: '',
            end: '',
            description: ''
        };
        block.micro = block.micro || [];
        block.micro.push(micro);
        this.setScheduleDirty(true);
        this.updateScheduleUiState();
    }

    removeScheduleMicro(dayId, blockId, microId) {
        const block = this.findScheduleBlock(dayId, blockId);
        if (!block || !block.micro) return;
        block.micro = block.micro.filter(item => item.id !== microId);
        this.setScheduleDirty(true);
        this.updateScheduleUiState();
    }

    setScheduleDirty(isDirty) {
        this.scheduleState.dirty = isDirty;
        this.updateScheduleUiState();
    }

    async handleScheduleSave() {
        if (!this.scheduleState.personalityId || !this.scheduleState.data || !this.apiService.isAuthenticated()) {
            return;
        }
        this.scheduleState.loading = true;
        this.updateScheduleUiState();

        try {
            const payload = this.normalizeScheduleData(this.scheduleState.data);
            payload.source = 'user';
            payload.generatedAt = payload.generatedAt || new Date().toISOString();
            const response = await this.apiService.savePersonalitySchedule(this.scheduleState.personalityId, payload);
            const saved = response.schedule || payload;
            this.scheduleState.data = this.normalizeScheduleData(saved);
            this.scheduleState.error = null;
            this.setScheduleDirty(false);
        } catch (error) {
            console.error('Failed to save schedule:', error);
            this.scheduleState.error = error.message || 'Unable to save schedule';
        } finally {
            this.scheduleState.loading = false;
            this.updateScheduleUiState();
        }
    }

    async handleScheduleGenerate(force = false) {
        if (!this.scheduleState.personalityId || !this.apiService.isAuthenticated()) {
            return;
        }
        this.scheduleState.loading = true;
        this.scheduleState.error = null;
        this.updateScheduleUiState();

        try {
            const overrides = this.getPersonalityDataFromForm();
            if (force) {
                overrides.forceRegenerate = true;
            }
            const timezone = this.scheduleState.data?.timezone || this.getBrowserTimezone();
            const response = await this.apiService.generatePersonalitySchedule(this.scheduleState.personalityId, overrides, timezone);
            const generated = response.schedule || response.template;
            this.scheduleState.data = this.normalizeScheduleData(generated);
            this.scheduleState.error = null;
            this.setScheduleDirty(false);
        } catch (error) {
            console.error('Failed to generate schedule:', error);
            this.scheduleState.error = error.message || 'Unable to generate schedule';
        } finally {
            this.scheduleState.loading = false;
            this.updateScheduleUiState();
        }
    }

    async loadScheduleForEditor(personalityId) {
        this.resetScheduleState(personalityId || null);
        if (!personalityId || !this.apiService.isAuthenticated()) {
            return;
        }

        this.scheduleState.loading = true;
        this.updateScheduleUiState();

        try {
            const response = await this.apiService.getPersonalitySchedule(personalityId);
            if (response.schedule) {
                this.scheduleState.data = this.normalizeScheduleData(response.schedule);
            } else if (response.template) {
                this.scheduleState.data = this.normalizeScheduleData(response.template);
                this.scheduleState.template = response.template;
            } else {
                this.scheduleState.data = this.createEmptySchedule();
            }
            this.scheduleState.error = null;
        } catch (error) {
            console.error('Failed to load schedule:', error);
            this.scheduleState.error = error.message || 'Unable to load schedule';
        } finally {
            this.scheduleState.loading = false;
            this.updateScheduleUiState();
        }
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
            await this.refreshChatSummaries(true);
            this.startChatSummaryPolling();
            
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
        let loaded = false;

        try {
            if (this.apiService.isAuthenticated()) {
                const response = await this.apiService.getPersonalities();

                if (Array.isArray(response)) {
                    this.personalities = response;
                } else if (response && response.personalities) {
                    this.personalities = response.personalities;
                } else {
                    this.personalities = [];
                }

                if (this.personalities.length > 0) {
                    console.log('✅ Loaded', this.personalities.length, 'personalities from API');
                    localStorage.removeItem('ai_personalities');
                    loaded = true;
                }
            }
        } catch (error) {
            console.error('Failed to load personalities from API:', error);
        }

        if (!loaded) {
            loaded = this.loadPersonalitiesFromCache();
        }

        if (!loaded) {
            this.setFallbackPersonality();
        }
    }

    /**
     * Load personalities from localStorage cache
     */
    loadPersonalitiesFromCache() {
        try {
            const cached = localStorage.getItem('ai_personalities');
            if (!cached) {
                return false;
            }

            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0) {
                this.personalities = parsed;
                console.log('📦 Loaded', parsed.length, 'personalities from localStorage cache');
                return true;
            }
        } catch (error) {
            console.error('Failed to parse cached personalities:', error);
        }

        return false;
    }

    /**
     * Ensure at least one fallback personality exists
     */
    setFallbackPersonality() {
        const fallback = {
            id: 'fallback_default',
            name: 'default_companion',
            displayName: 'AI Companion',
            description: 'Friendly, dependable assistant ready to help with anything you need.',
            systemPrompt: 'You are a friendly, supportive AI companion who keeps conversations light, helpful, and encouraging.',
            avatar: '🤖',
            role: 'general',
            personality: 'Friendly, helpful, encouraging',
            tone: 'friendly',
            verbosity: 'balanced',
            expertise: 'Daily support, helpful reminders, casual conversation',
            color: 'blue',
            temperature: 0.7,
            topP: 0.9,
            maxTokens: 2000,
            presencePenalty: 0,
            codeMode: false,
            creativeMode: false,
            analyticalMode: false,
            memoryContext: 'medium',
            isDefault: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        this.personalities = [fallback];
        console.warn('⚠️ No personalities available — using fallback personality definition');
    }

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
        const discardAvatarBtn = document.getElementById('discardAvatarBtn');
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
        if (discardAvatarBtn) {
            discardAvatarBtn.addEventListener('click', () => this.discardGeneratedAvatar());
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

        // Role-based preset loading
        const personalityRole = document.getElementById('personalityRole');
        if (personalityRole) {
            personalityRole.addEventListener('change', (e) => {
                this.loadRolePreset(e.target.value);
            });
        }

        this.setupScheduleListeners();
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
            item.dataset.personalityId = personality.id;
            const chatSummary = this.getChatSummaryForPersonality(personality.id);
            const hasUnread = this.chatHasUnread(chatSummary);
            if (hasUnread) {
                item.classList.add('has-unread');
            }
            
            // Create avatar HTML - use image if avatarUrl exists, otherwise emoji
            const avatarHtml = personality.avatarUrl 
                ? `<img src="${personality.avatarUrl}" style="width: 100%; height: 100%; object-fit: cover; border-radius: 50%;" />`
                : (personality.avatar || '🤖');
            
            item.innerHTML = `
                <div class="personality-avatar-small">
                    ${avatarHtml}
                </div>
                <div class="personality-info">
                    <h5>
                        ${personality.displayName}
                        <span class="personality-unread-indicator" title="New replies"></span>
                    </h5>
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

        this.updatePersonalityUnreadIndicators();
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

        if (this.currentChatId) {
            await this.markChatAsRead(this.currentChatId);
        }

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

    getChatSummaryForPersonality(personalityId) {
        if (!this.chatSummaries || this.chatSummaries.length === 0) {
            return null;
        }
        return this.chatSummaries.find(chat => chat.personality_id === personalityId) || null;
    }

    startChatSummaryPolling() {
        if (this.chatSummaryPoll || !this.apiService.isAuthenticated()) {
            return;
        }
        this.chatSummaryPoll = setInterval(() => {
            this.refreshChatSummaries();
        }, 15000);
    }

    stopChatSummaryPolling() {
        if (this.chatSummaryPoll) {
            clearInterval(this.chatSummaryPoll);
            this.chatSummaryPoll = null;
        }
    }

    async refreshChatSummaries(force = false) {
        if (!this.apiService || !this.apiService.isAuthenticated()) {
            this.chatSummaries = [];
            this.lastChatSummaryFetch = Date.now();
            this.updatePersonalityUnreadIndicators();
            return this.chatSummaries;
        }

        if (this.chatSummaryFetchPromise && !force) {
            return this.chatSummaryFetchPromise;
        }

        const now = Date.now();
        if (!force && now - this.lastChatSummaryFetch < 5000) {
            return this.chatSummaries;
        }

        const fetchPromise = (async () => {
            try {
                const result = await this.apiService.getChats();
                const chats = Array.isArray(result) ? result : (result?.chats || []);
                this.chatSummaries = chats;
                this.lastChatSummaryFetch = Date.now();
                this.updatePersonalityUnreadIndicators();
                return chats;
            } catch (error) {
                console.warn('Failed to refresh chat summaries:', error);
                return this.chatSummaries;
            } finally {
                if (this.chatSummaryFetchPromise === fetchPromise) {
                    this.chatSummaryFetchPromise = null;
                }
            }
        })();

        this.chatSummaryFetchPromise = fetchPromise;
        return fetchPromise;
    }

    updatePersonalityUnreadIndicators() {
        const chats = Array.isArray(this.chatSummaries) ? this.chatSummaries : [];
        const chatsByPersonality = new Map();
        const chatsById = new Map();

        chats.forEach(chat => {
            if (!chat) {
                return;
            }
            if (typeof chat.personality_id !== 'undefined' && chat.personality_id !== null) {
                chatsByPersonality.set(String(chat.personality_id), chat);
            }
            if (typeof chat.id !== 'undefined' && chat.id !== null) {
                chatsById.set(String(chat.id), chat);
            }
        });

        const personalityList = document.getElementById('personalityList');
        if (personalityList) {
            personalityList.querySelectorAll('.personality-item').forEach(item => {
                const personalityId = item.dataset.personalityId;
                const chatSummary = chatsByPersonality.get(personalityId);
                const hasUnread = this.chatHasUnread(chatSummary);
                item.classList.toggle('has-unread', hasUnread);
            });
        }

        const contactsList = document.getElementById('contactsList');
        if (contactsList) {
            contactsList.querySelectorAll('.contact-item').forEach(item => {
                const personalityId = item.dataset.personalityId;
                const chatId = item.dataset.chatId;
                const chatSummary = (chatId && chatsById.get(chatId)) || chatsByPersonality.get(personalityId);
                const hasUnread = this.chatHasUnread(chatSummary);
                item.classList.toggle('has-unread', hasUnread);

                const preview = item.querySelector('.contact-item-preview');
                if (preview) {
                    preview.classList.toggle('unread', hasUnread);
                }

                let metaRow = item.querySelector('.contact-item-meta');
                if (!metaRow && hasUnread) {
                    const details = item.querySelector('.contact-item-details');
                    if (details) {
                        metaRow = document.createElement('div');
                        metaRow.className = 'contact-item-meta';
                        details.appendChild(metaRow);
                    }
                }

                if (metaRow) {
                    let unreadBadge = metaRow.querySelector('.contact-unread-indicator');
                    if (hasUnread) {
                        if (!unreadBadge) {
                            unreadBadge = document.createElement('span');
                            unreadBadge.className = 'contact-unread-indicator';
                            unreadBadge.textContent = 'New';
                            metaRow.appendChild(unreadBadge);
                        }
                    } else if (unreadBadge) {
                        unreadBadge.remove();
                        if (metaRow.childElementCount === 0) {
                            metaRow.remove();
                        }
                    }
                }
            });
        }
    }

    getChatReadStorageKey(chatId) {
        if (!chatId) {
            return null;
        }
        return `${this.chatReadKeyPrefix}${chatId}`;
    }

    getChatLastReadTimestamp(chatId) {
        const key = this.getChatReadStorageKey(chatId);
        if (!key) {
            return 0;
        }
        const value = localStorage.getItem(key);
        if (!value) {
            return 0;
        }
        const parsed = parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    setLocalChatReadTimestamp(chatId, timestamp = Date.now()) {
        const key = this.getChatReadStorageKey(chatId);
        if (!key) {
            return;
        }
        let finalTimestamp = timestamp;
        if (typeof finalTimestamp === 'string') {
            const parsed = Date.parse(finalTimestamp);
            finalTimestamp = Number.isFinite(parsed) ? parsed : Date.now();
        }
        if (!Number.isFinite(finalTimestamp)) {
            finalTimestamp = Date.now();
        }
        localStorage.setItem(key, String(finalTimestamp));
    }

    async markChatAsRead(chatId, timestamp = Date.now()) {
        this.setLocalChatReadTimestamp(chatId, timestamp);
        if (this.apiService.isAuthenticated() && chatId) {
            try {
                await this.apiService.markChatAsRead(chatId, timestamp);
            } catch (error) {
                console.warn('Failed to sync read state to server, using local fallback', error);
            }
        }
        this.updatePersonalityUnreadIndicators();
    }

    chatHasUnread(chat) {
        if (!chat || !chat.id || !chat.lastMessageTime) {
            return false;
        }
        const role = (chat.lastMessageRole || chat.last_message_role || '').toLowerCase();
        if (role && role !== 'assistant' && role !== 'ai') {
            return false;
        }
        const lastMessageTimestamp = Date.parse(chat.lastMessageTime);
        if (!Number.isFinite(lastMessageTimestamp)) {
            return false;
        }
        let lastReadTimestamp = 0;
        const serverRead = chat.lastReadAt || chat.last_read_at;
        if (serverRead) {
            const parsed = Date.parse(serverRead);
            if (Number.isFinite(parsed)) {
                lastReadTimestamp = parsed;
            }
        }
        if (!lastReadTimestamp) {
            lastReadTimestamp = this.getChatLastReadTimestamp(chat.id);
        }
        return !lastReadTimestamp || lastMessageTimestamp > lastReadTimestamp;
    }

    /**
     * Show enhanced personality editor modal
     */
    showPersonalityEditor(personality = null) {
        const modal = document.getElementById('personalityModal');
        const title = document.getElementById('personalityModalTitle');
        const deleteBtn = document.getElementById('deletePersonalityBtn');

        if (!modal) return;

        // If personality is just an ID (number/string), look up the full object
        if (personality && (typeof personality === 'number' || typeof personality === 'string')) {
            const personalityId = parseInt(personality);
            personality = this.personalities.find(p => p.id === personalityId);
            if (!personality) {
                console.error(`Personality with ID ${personalityId} not found`);
                return;
            }
        }

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
                description: 'Friendly, helpful, knowledgeable assistant',
                role: 'general',
                systemPrompt: 'You are a helpful AI assistant.',
                personality: 'Friendly, helpful, knowledgeable',
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

        // Initialize schedule state every time the editor opens
        const schedulePersonalityId = personality?.id || null;
        this.loadScheduleForEditor(schedulePersonalityId).catch(err => {
            console.error('Schedule initialization failed:', err);
        });

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

        // Show modal
        modal.style.display = 'flex';
        modal.classList.add('show');

        // Ensure the editor starts at the top even if it was previously scrolled
        modal.scrollTop = 0;
        const modalContent = modal.querySelector('.modal-content');
        if (modalContent) {
            modalContent.scrollTop = 0;
        }
        const modalBody = modal.querySelector('.modal-body');
        if (modalBody) {
            modalBody.scrollTop = 0;
        }

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
        // Assign a unique temporary ID for new personalities if not editing
        let newId = null;
        if (!this.editingPersonality) {
            // Use timestamp as a temporary unique ID
            newId = Date.now();
        }
        const completePersonality = {
            ...personalityData,
            // Use existing ID when editing, otherwise assign a temp unique ID
            id: this.editingPersonality ? this.editingPersonality.id : newId,
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
            
            // If contacts page is open, refresh it to show the new/updated personality
            const contactsPage = document.getElementById('contactsPage');
            if (contactsPage && contactsPage.style.display !== 'none') {
                await this.showContactsPage();
            }
            
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
            
            // Show contacts page after deletion
            await this.showContactsPage();
            
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
        
        // Check for pending avatars when avatar tab is opened
        if (tabName === 'avatar' && this.editingPersonality?.id) {
            this.checkPendingAvatar(this.editingPersonality.id);
        }
    }

    /**
     * Check for pending avatar on page load
     */
    async checkPendingAvatar(personalityId) {
        if (!personalityId || !this.apiService.isAuthenticated()) {
            return;
        }

        try {
            const status = await this.apiService.getAvatarStatus(personalityId);
            
            if (status.status === 'completed' && status.avatarUrl && status.pendingApproval) {
                console.log('✅ Found pending avatar for personality', personalityId);
                
                // Display the avatar preview
                const avatarPreview = document.getElementById('avatarPreview');
                const generatedAvatarImg = document.getElementById('generatedAvatarImg');
                const generateBtn = document.getElementById('generateAvatarBtn');
                
                if (generatedAvatarImg) {
                    generatedAvatarImg.src = status.avatarUrl;
                    generatedAvatarImg.style.display = 'block';
                }
                
                if (avatarPreview) {
                    avatarPreview.style.display = 'block';
                }
                
                // Store for approval
                this.generatedAvatarData = status.avatarUrl;
                this.pendingAvatarPersonalityId = personalityId;
                
                if (generateBtn) {
                    generateBtn.textContent = '✅ Ready to Apply';
                }
            }
        } catch (error) {
            console.error('Error checking pending avatar:', error);
        }
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
                    console.log('✅ Avatar generation completed (pending approval)!');
                    
                    // Display the avatar preview
                    const avatarPreview = document.getElementById('avatarPreview');
                    const generatedAvatarImg = document.getElementById('generatedAvatarImg');
                    
                    if (generatedAvatarImg) {
                        generatedAvatarImg.src = status.avatarUrl;
                        generatedAvatarImg.style.display = 'block';
                    }
                    
                    if (avatarPreview) {
                        avatarPreview.style.display = 'block';
                    }
                    
                    // Store for approval
                    this.generatedAvatarData = status.avatarUrl;
                    this.pendingAvatarPersonalityId = personalityId;
                    
                    // Update button
                    generateBtn.disabled = false;
                    generateBtn.textContent = '✅ Ready to Apply';
                    
                    // Show approve/reject message
                    alert('Avatar generated! Click "Use This Avatar" to apply it or "Clear Preview" to reject it.');
                    
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
     * Discard the pending generated avatar
     */
    async discardGeneratedAvatar() {
        // If this avatar was generated via queue (has personality ID), reject it in the database
        if (this.pendingAvatarPersonalityId && this.apiService.isAuthenticated()) {
            try {
                console.log('🗑️ Rejecting avatar for personality', this.pendingAvatarPersonalityId);
                await this.apiService.rejectAvatar(this.pendingAvatarPersonalityId);
                this.pendingAvatarPersonalityId = null;
                console.log('✅ Avatar rejected and removed from database');
            } catch (error) {
                console.error('❌ Failed to reject avatar:', error);
                alert('Failed to discard avatar: ' + error.message);
                return;
            }
        }

        // Clear the preview
        this.clearAvatarPreview();
    }

    /**
     * Use the generated/uploaded avatar
     */
    async useGeneratedAvatar() {
        if (this.generatedAvatarData) {
            const personalityAvatar = document.getElementById('personalityAvatar');
            const currentPersonalityAvatar = document.getElementById('currentPersonalityAvatar');
            
            console.log('📸 Applying avatar:', {
                hasPersonalityAvatar: !!personalityAvatar,
                hasCurrentPersonalityAvatar: !!currentPersonalityAvatar,
                hasPendingId: !!this.pendingAvatarPersonalityId,
                dataLength: this.generatedAvatarData?.length
            });
            
            // If this avatar was generated via queue (has personality ID), approve it in the database
            if (this.pendingAvatarPersonalityId && this.apiService.isAuthenticated()) {
                try {
                    console.log('✅ Approving avatar for personality', this.pendingAvatarPersonalityId);
                    await this.apiService.approveAvatar(this.pendingAvatarPersonalityId, this.generatedAvatarData);
                    this.pendingAvatarPersonalityId = null;
                    console.log('✅ Avatar approved and saved to database');
                } catch (error) {
                    console.error('❌ Failed to approve avatar:', error);
                    alert('Failed to save avatar: ' + error.message);
                    return;
                }
            }
            
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
     * Load role-based presets
     */
    loadRolePreset(role) {
        const normalizedRole = normalizeRoleValue(role);
        if (normalizedRole === 'custom') {
            return;
        }

        const preset = ROLE_PRESETS[normalizedRole];
        if (!preset) {
            return;
        }

        document.getElementById('personalitySystemPrompt').value = preset.systemPrompt;
        const bioField = document.getElementById('personalityDescription');
        if (bioField && preset.personality) {
            bioField.value = preset.personality;
        }
        document.getElementById('personalityExpertise').value = preset.expertise;
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
        const bioField = document.getElementById('personalityDescription');
        const bioText = bioField?.value?.trim() || '';
        
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
            description: bioText,
            avatar: avatarInput?.value || '🤖',
            avatarUrl: avatarUrl,
            role: normalizeRoleValue(document.getElementById('personalityRole')?.value || 'general'),
            systemPrompt: document.getElementById('personalitySystemPrompt')?.value,
            personality: bioText,
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
            personalityTraits: bioText,
            speakingStyle: document.getElementById('personalityTone')?.value
        };
    }

    /**
     * Populate form fields with personality data
     */
    populatePersonalityForm(personality) {
        document.getElementById('personalityName').value = personality.name || '';
        document.getElementById('personalityDisplayName').value = personality.displayName || '';
        const bioField = document.getElementById('personalityDescription');
        if (bioField) {
            bioField.value = personality.description || personality.personality || personality.personalityTraits || '';
        }
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
        const roleField = document.getElementById('personalityRole');
        if (roleField) {
            const normalizedRole = normalizeRoleValue(personality.role || 'general');
            roleField.value = normalizedRole === 'custom' ? 'custom' : normalizedRole;
        }
        document.getElementById('personalitySystemPrompt').value = personality.systemPrompt || '';
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
    async showContactsPage() {
        const contactsPage = document.getElementById('contactsPage');
        const chatContainer = document.querySelector('.chat-container');
        const contactsList = document.getElementById('contactsList');
        
        if (!contactsPage || !chatContainer) return;
        
        // Hide chat, show contacts
        chatContainer.style.display = 'none';
        contactsPage.style.display = 'flex';
        
        // Populate contacts list
        contactsList.innerHTML = '';
        
        // Get all chats to show last messages
        let chats = Array.isArray(this.chatSummaries) ? [...this.chatSummaries] : [];
        if (this.apiService && this.apiService.isAuthenticated()) {
            try {
                const result = await this.apiService.getChats();
                chats = Array.isArray(result) ? result : (result?.chats || []);
                this.chatSummaries = chats;
            } catch (error) {
                console.warn('Failed to refresh chats for contacts list:', error);
            }
        }
        
        // Sort personalities by most recent message
        const sortedPersonalities = [...this.personalities].sort((a, b) => {
            const chatA = chats.find(c => c.personality_id === a.id);
            const chatB = chats.find(c => c.personality_id === b.id);
            
            const timeA = chatA?.lastMessageTime ? new Date(chatA.lastMessageTime) : new Date(0);
            const timeB = chatB?.lastMessageTime ? new Date(chatB.lastMessageTime) : new Date(0);
            
            return timeB - timeA; // Most recent first
        });
        
        sortedPersonalities.forEach(personality => {
            const contactItem = document.createElement('div');
            contactItem.className = 'contact-item';
            contactItem.dataset.personalityId = personality.id;
            const chat = chats.find(c => c.personality_id === personality.id);
            if (chat?.id) {
                contactItem.dataset.chatId = chat.id;
            }
            const hasUnread = this.chatHasUnread(chat);
            if (hasUnread) {
                contactItem.classList.add('has-unread');
            }
            
            // Create avatar
            const avatar = document.createElement('div');
            avatar.className = 'avatar';
            
            // Use avatarUrl (correct property name)
            if (personality.avatarUrl) {
                const img = document.createElement('img');
                img.src = personality.avatarUrl;
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
            
            // Get last message for this personality
            let lastMessageText = 'No messages yet';
            let lastMessageTime = '';
            
            if (chat && chat.lastMessage) {
                const lastMsg = chat.lastMessage;
                // Check if it's an image message
                if (lastMsg.includes('data:image/') || (lastMsg.metadata && lastMsg.metadata.type === 'image')) {
                    lastMessageText = '📷 Image';
                } else if (lastMsg.includes('data:video/') || (lastMsg.metadata && lastMsg.metadata.type === 'video')) {
                    lastMessageText = '🎬 Video';
                } else {
                    // Show text preview (truncate to 50 chars)
                    lastMessageText = lastMsg.length > 50 ? lastMsg.substring(0, 50) + '...' : lastMsg;
                }
                
                // Format timestamp
                if (chat.lastMessageTime) {
                    try {
                        const msgDate = new Date(chat.lastMessageTime);
                        if (isNaN(msgDate.getTime())) {
                            console.warn('Invalid date:', chat.lastMessageTime);
                            lastMessageTime = '';
                        } else {
                            const now = new Date();
                            const diffMs = now - msgDate;
                            const diffMins = Math.floor(diffMs / 60000);
                            const diffHours = Math.floor(diffMs / 3600000);
                            const diffDays = Math.floor(diffMs / 86400000);

                            if (diffMins < 1) {
                                lastMessageTime = 'Just now';
                            } else if (diffMins < 60) {
                                lastMessageTime = `${diffMins}m ago`;
                            } else if (diffHours < 24) {
                                lastMessageTime = `${diffHours}h ago`;
                            } else if (diffDays < 7) {
                                lastMessageTime = `${diffDays}d ago`;
                            } else {
                                lastMessageTime = msgDate.toLocaleDateString();
                            }
                        }
                    } catch (error) {
                        console.error('Error parsing timestamp:', error, chat.lastMessageTime);
                        lastMessageTime = '';
                    }
                }
            }
            
            const preview = document.createElement('div');
            preview.className = 'contact-item-preview';
            if (hasUnread) {
                preview.classList.add('unread');
            }
            preview.textContent = lastMessageText;
            
            const timestamp = document.createElement('div');
            timestamp.className = 'contact-item-timestamp';
            timestamp.textContent = lastMessageTime;

            const metaRow = document.createElement('div');
            metaRow.className = 'contact-item-meta';
            if (lastMessageTime) {
                metaRow.appendChild(timestamp);
            }
            if (hasUnread) {
                const unreadBadge = document.createElement('span');
                unreadBadge.className = 'contact-unread-indicator';
                unreadBadge.textContent = 'New';
                metaRow.appendChild(unreadBadge);
            }
            
            details.appendChild(name);
            details.appendChild(preview);
            if (metaRow.childElementCount > 0) {
                details.appendChild(metaRow);
            }
            
            contactItem.appendChild(avatar);
            contactItem.appendChild(details);
            
            // Click to switch to this personality and return to chat
            contactItem.addEventListener('click', async () => {
                await this.switchPersonality(personality.id);
                this.hideContactsPage();
            });
            
            contactsList.appendChild(contactItem);
        });

        this.updatePersonalityUnreadIndicators();
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