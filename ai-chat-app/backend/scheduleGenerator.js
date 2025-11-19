const { jsonrepair } = require('jsonrepair');

const DEFAULT_TIMEZONE = process.env.SCHEDULE_DEFAULT_TIMEZONE || process.env.TZ || 'America/New_York';
const DEFAULT_SCHEDULE_TEMPERATURE = parseFloat(process.env.SCHEDULE_TEMPERATURE || '0.35');
const DEFAULT_SCHEDULE_MAX_TOKENS = parseInt(process.env.SCHEDULE_MAX_TOKENS || '2800', 10);
const DAYS_OF_WEEK = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function makeId(prefix = 'sched') {
    return `${prefix}_${Math.random().toString(36).slice(2, 6)}${Date.now().toString(36)}`;
}

function sanitizeTime(value) {
    if (!value) {
        return null;
    }
    if (/^\d{1,2}:\d{2}$/.test(value)) {
        const [hours, minutes] = value.split(':').map(Number);
        const safeHours = Math.min(Math.max(hours, 0), 23).toString().padStart(2, '0');
        const safeMinutes = Math.min(Math.max(minutes, 0), 59).toString().padStart(2, '0');
        return `${safeHours}:${safeMinutes}`;
    }
    // Attempt to parse natural language times like "8am", "4 PM"
    const match = value.toString().trim().match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!match) {
        return null;
    }
    let hours = parseInt(match[1], 10);
    let minutes = match[2] ? parseInt(match[2], 10) : 0;
    const meridiem = match[3]?.toLowerCase();
    if (meridiem === 'pm' && hours < 12) {
        hours += 12;
    }
    if (meridiem === 'am' && hours === 12) {
        hours = 0;
    }
    const safeHours = Math.min(Math.max(hours, 0), 23).toString().padStart(2, '0');
    const safeMinutes = Math.min(Math.max(minutes, 0), 59).toString().padStart(2, '0');
    return `${safeHours}:${safeMinutes}`;
}

function normalizeDayName(value) {
    if (!value) return null;
    const lower = value.toString().trim().toLowerCase();
    const match = DAYS_OF_WEEK.find(day => day.startsWith(lower.slice(0, 3)));
    return match || lower;
}

function ensureArray(value) {
    if (!value) return [];
    return Array.isArray(value) ? value : [value];
}

function normalizeSchedule(schedule = {}) {
    const normalized = {
        summary: schedule.summary || schedule.overview || '',
        timezone: schedule.timezone || DEFAULT_TIMEZONE,
        version: schedule.version || 1,
        source: schedule.source || 'ai',
        generatedAt: schedule.generatedAt || new Date().toISOString(),
        week: []
    };

    const seenDays = new Set();
    ensureArray(schedule.week).forEach(day => {
        const normalizedDayName = normalizeDayName(day.day) || normalizeDayName(day.name);
        if (!normalizedDayName || seenDays.has(normalizedDayName)) {
            return;
        }
        seenDays.add(normalizedDayName);

        const dayBlocks = ensureArray(day.blocks || day.activities).map(block => {
            const micro = ensureArray(block.micro || block.details || block.subtasks).map(microBlock => ({
                id: microBlock.id || makeId('micro'),
                title: microBlock.title || microBlock.name || 'Untitled block',
                start: sanitizeTime(microBlock.start) || null,
                end: sanitizeTime(microBlock.end) || null,
                description: microBlock.description || microBlock.notes || ''
            }));

            return {
                id: block.id || makeId('block'),
                title: block.title || block.name || 'Untitled',
                category: block.category || block.type || 'general',
                start: sanitizeTime(block.start) || null,
                end: sanitizeTime(block.end) || null,
                location: block.location || '',
                description: block.description || block.details || '',
                micro
            };
        });

        normalized.week.push({
            id: day.id || makeId('day'),
            day: normalizedDayName,
            theme: day.theme || day.focus || '',
            notes: day.notes || '',
            blocks: dayBlocks
        });
    });

    // Ensure we have every day represented (even if empty)
    DAYS_OF_WEEK.forEach(day => {
        if (seenDays.has(day)) {
            return;
        }
        normalized.week.push({
            id: makeId('day'),
            day,
            theme: '',
            notes: '',
            blocks: []
        });
    });

    // Preserve chronological order
    normalized.week.sort((a, b) => DAYS_OF_WEEK.indexOf(a.day) - DAYS_OF_WEEK.indexOf(b.day));

    return normalized;
}

function sanitizeModelOutput(text) {
    if (!text) {
        return '';
    }
    const raw = typeof text === 'string' ? text : String(text);
    return raw
        .replace(/```(?:json)?/gi, '')
        .replace(/```/g, '')
        .replace(/<\/?think>/gi, '')
        .trim();
}

function parseJsonCandidate(candidate) {
    if (!candidate) {
        return null;
    }
    try {
        return JSON.parse(candidate);
    } catch (error) {
        try {
            const repaired = jsonrepair(candidate);
            console.warn('Schedule generator repaired malformed JSON response:', error.message);
            return JSON.parse(repaired);
        } catch (repairError) {
            console.error('Failed to repair schedule JSON response:', repairError.message);
            return null;
        }
    }
}

function extractJsonFromText(text) {
    if (!text) return null;
    const cleaned = sanitizeModelOutput(text);
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        return null;
    }
    const candidate = cleaned.slice(firstBrace, lastBrace + 1);
    return parseJsonCandidate(candidate);
}

function looksLikeScheduleShape(parsed) {
    return Boolean(
        parsed &&
        typeof parsed === 'object' &&
        Array.isArray(parsed.week) &&
        parsed.week.length > 0
    );
}

function buildIdentitySummary(personality = {}, overrides = {}) {
    const details = [];
    const displayName = overrides.displayName || personality.displayName || personality.display_name || personality.name || 'the AI partner';
    details.push(`Name: ${displayName}`);
    const description = overrides.description || personality.description;
    if (description) {
        details.push(`Bio: ${description}`);
    }
    const role = overrides.role || personality.role;
    if (role) {
        details.push(`Role: ${role}`);
    }
    const traits = overrides.personalityTraits || personality.personalityTraits || personality.personality_traits;
    if (traits) {
        details.push(`Traits: ${traits}`);
    }
    const tone = overrides.speakingStyle || personality.speakingStyle || personality.speaking_style;
    if (tone) {
        details.push(`Speaking Style: ${tone}`);
    }
    const hobbies = overrides.hobbies || overrides.interests || personality.hobbies;
    if (hobbies) {
        details.push(`Hobbies: ${Array.isArray(hobbies) ? hobbies.join(', ') : hobbies}`);
    }
    return details.join('\n');
}

function buildSchedulePrompt({ personality, overrides, timezone }) {
    const header = `You are an elite lifestyle coordinator building a realistic weekly schedule for a close companion. Every day must feel lived-in and specific to their identity.`;
    const identity = buildIdentitySummary(personality, overrides);
    const timezoneText = timezone || DEFAULT_TIMEZONE;
    const baseFormat = `Respond ONLY with JSON that matches this shape. Absolutely no <think>, <thinking>, Markdown fences, or commentary. The first character must be { and the last must be }.
{
    "summary": "One-sentence overview of their week",
    "timezone": "Continent/City",
    "week": [
        {
            "day": "monday",
            "theme": "High-level intent for the day",
            "notes": "Optional reminders",
            "blocks": [
                {
                    "title": "Macro activity (e.g., School Day, Studio Session)",
                    "category": "school|work|sport|creative|social|routine|rest",
                    "start": "08:00",
                    "end": "16:00",
                    "location": "Where it happens",
                    "description": "Color commentary for the block",
                    "micro": [
                        {
                            "title": "Micro task inside the block",
                            "start": "10:15",
                            "end": "11:00",
                            "description": "Specific focus"
                        }
                    ]
                }
            ]
        }
    ]
}`;
        const formatInstruction = `${baseFormat}
- Reply with compact JSON only (no code fences).
- Include 2-4 macro blocks per weekday and at least 1-2 blocks on weekends.
- Nested micro schedules MUST exist for structured blocks like school, work, sports, or creative sessions.
- Times must use 24-hour HH:MM format.
- Reflect commitments implied by their persona (school 8-4, soccer 4-6, jobs, hobbies, social time, rest).
- Leave no day empty, but allow lighter weekends.`;

    return `${header}\n\n${identity}\n\nTimezone to use: ${timezoneText}.\n\n${formatInstruction}`;
}

async function generateScheduleWithAI({ personality, overrides = {}, aiProcessor, timezone, existingSchedule = null }) {
    if (!aiProcessor || typeof aiProcessor.callLocalAI !== 'function') {
        throw new Error('AI processor is not available for schedule generation');
    }

    const prompt = buildSchedulePrompt({ personality, overrides, timezone });
    const messages = [
        {
            role: 'system',
            content: 'You are a meticulous lifestyle strategist. Always return valid JSON. Include rich detail and believable structure.'
        },
        {
            role: 'user',
            content: prompt
        }
    ];

    const targetMaxTokens = Number.isFinite(DEFAULT_SCHEDULE_MAX_TOKENS) ? DEFAULT_SCHEDULE_MAX_TOKENS : 2800;
    const temperature = Number.isFinite(DEFAULT_SCHEDULE_TEMPERATURE) ? DEFAULT_SCHEDULE_TEMPERATURE : 0.35;
    const maxAttempts = 2;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const response = await aiProcessor.callLocalAI(messages, temperature, targetMaxTokens);
        const parsed = extractJsonFromText(response);
        if (parsed && looksLikeScheduleShape(parsed)) {
            return normalizeSchedule(parsed);
        }

        console.warn(`Schedule generation attempt ${attempt} returned invalid or incomplete JSON. ${attempt < maxAttempts ? 'Retrying…' : ''}`);
        messages.push({
            role: 'system',
            content: 'Your last reply was not valid JSON. Resend the entire schedule now as strict JSON with no commentary. Start with { and end with }.'
        });
    }

    throw new Error('AI did not return valid schedule JSON');
}

function createEmptySchedule(personality = {}) {
    return {
        summary: `Weekly rhythm for ${personality.displayName || personality.display_name || personality.name || 'your AI companion'}`,
        timezone: DEFAULT_TIMEZONE,
        version: 1,
        source: 'user',
        generatedAt: new Date().toISOString(),
        week: DAYS_OF_WEEK.map(day => ({
            id: makeId('day'),
            day,
            theme: '',
            notes: '',
            blocks: []
        }))
    };
}

function formatScheduleForPrompt(schedule) {
    if (!schedule || !Array.isArray(schedule.week)) {
        return '';
    }
    const lines = [];
    if (schedule.summary) {
        lines.push(`Overall: ${schedule.summary}`);
    }
    lines.push(`Timezone: ${schedule.timezone || DEFAULT_TIMEZONE}`);
    schedule.week.forEach(day => {
        const dayTitle = day.day ? day.day.charAt(0).toUpperCase() + day.day.slice(1) : 'Day';
        const theme = day.theme ? ` — ${day.theme}` : '';
        lines.push(`${dayTitle}${theme}`);
        ensureArray(day.blocks).forEach(block => {
            const timeRange = block.start && block.end ? `${block.start}-${block.end}` : 'All day';
            const category = block.category ? ` [${block.category}]` : '';
            lines.push(`  • ${timeRange}: ${block.title || 'Activity'}${category} (${block.description || 'No details'})`);
            ensureArray(block.micro).forEach(micro => {
                const microRange = micro.start && micro.end ? `${micro.start}-${micro.end}` : '';
                lines.push(`      ◦ ${microRange} ${micro.title || 'Focus'} — ${micro.description || ''}`.trim());
            });
        });
        if (day.notes) {
            lines.push(`    Notes: ${day.notes}`);
        }
    });
    return lines.join('\n');
}

module.exports = {
    DEFAULT_TIMEZONE,
    DAYS_OF_WEEK,
    makeId,
    normalizeSchedule,
    generateScheduleWithAI,
    createEmptySchedule,
    formatScheduleForPrompt
};
