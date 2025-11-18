# Debug Logging Guide

## Overview
Comprehensive logging has been added to track message delivery and "view thought" visibility issues.

## What Was Added

### 1. API Service Layer Logging (`apiService.js`)

#### `sendMessageQueued()`
- **When**: Message is queued for background AI processing
- **What to look for**: `📤 sendMessageQueued called` → `✅ sendMessageQueued result`
- **Key info**: chatId, message length, personality name, returned jobId

#### `getChatMessages()`
- **When**: Polling for new messages from server
- **What to look for**: `📥 getChatMessages called` → `✅ getChatMessages returned N messages`
- **Key info**: Number of messages, preview of last 3 messages showing role, content length, and thinking presence

#### `saveChatMessage()`
- **When**: Saving a message to the database
- **What to look for**: `💾 saveChatMessage called` → `✅ saveChatMessage result`
- **Key info**: Role, content length, metadata including thinking content preview

### 2. App.js Message Flow Logging

#### `addMessage()`
Already has logging:
- `➕ addMessage called` - Shows sender, type, content length, thinking length
- `🧠 Thinking passed to addMessage` - Preview of thinking content (first 100 chars)

#### `renderSingleMessage()`
Already has logging:
- `📄 Rendering message` - Content length and thinking presence
- `🎯 Final thinking check before rendering` - All conditions for showing thinking
- `✅ Adding thinking section to message bubble` - Confirms thinking div was created

#### `parseThinkingFromContent()`
Already has extensive logging:
- Shows raw content analysis
- Pattern detection (<think>, <thinking>, [THINKING], **Thinking:**)
- Extracted thinking content
- Final clean content

#### `sendToLocalAI()`
Already has comprehensive logging:
- `🔍📋 COMPLETE AI RESPONSE ANALYSIS` - Full JSON response
- `📝 Raw Content Extraction` - Raw content analysis
- `🔍 Thinking Pattern Detection` - Checks for all thinking patterns
- `🧠 THINKING EXTRACTION RESULTS` - Shows extracted thinking and final content
- `🎯 FINAL RESULTS` - Summary of what will be displayed

#### `checkForNewMessages()` (Polling)
Already has logging:
- `🔄 Poll: Server has N msgs, we have N` - Message count comparison
- `📬 Found N new messages` - New message detection
- `🔍 Message check` - Existence check for each message
- `➕ Adding new message to array` - Message addition confirmation
- `🎨 Calling renderSingleMessage` - Rendering confirmation

## How to Debug

### Problem: Messages Not Appearing

1. **Check if message was sent**:
   - Look for `📤 sendMessageQueued called` with chatId and message
   - Verify `✅ sendMessageQueued result` shows success

2. **Check if message was saved**:
   - Look for `💾 saveChatMessage called` with role='user'
   - Look for `💾 saveChatMessage called` with role='assistant' (AI response)
   - Verify both have `✅ saveChatMessage result`

3. **Check if polling detected new messages**:
   - Look for `🔄 Poll: Server has N msgs` - should increase after message sent
   - Look for `📬 Found N new messages`
   - If no new messages detected, server may not have saved them

4. **Check if messages were rendered**:
   - Look for `🎨 Calling renderSingleMessage` for each message
   - Look for `✅ Message rendered, total DOM messages: N`

### Problem: "View Thought" Option Not Showing

1. **Check if thinking was extracted from AI response**:
   ```
   🔍 Thinking Pattern Detection:
      • Contains <think>: true/false
      • Contains <thinking>: true/false
   ```

2. **Check thinking extraction results**:
   ```
   🧠 THINKING EXTRACTION RESULTS:
   📊 Extracted Thinking (N chars)
   ```
   - If N = 0, thinking wasn't found in response
   - If N > 0, thinking was extracted

3. **Check if thinking was passed to addMessage**:
   ```
   🧠 Thinking passed to addMessage: [content preview]
   ```
   - Should show first 100 chars of thinking

4. **Check rendering conditions**:
   ```
   🎯 Final thinking check before rendering:
      - thinking exists: true/false
      - thinking trimmed: [content or 'none']
      - sender is ai: true/false
      - showThinking setting: true/false
   ```
   - ALL must be true for thinking div to be created

5. **Verify thinking div creation**:
   ```
   ✅ Adding thinking section to message bubble
   ```
   - If you don't see this, one of the above conditions failed

### Problem: Thinking Extracted But Not Visible

If thinking is extracted but you don't see the toggle:

1. **Check CSS**: Thinking div has `style.display = 'none'` by default
2. **Click the message bubble**: Should toggle visibility
3. **Check console for click events**: May be blocked by other elements

## Expected Log Flow for Successful Message

### User sends message:
```
📤 sendMessageQueued called: {chatId: X, messageLength: Y, personality: "Name"}
✅ sendMessageQueued result: {jobId: "..."}
💾 saveChatMessage called: {chatId: X, role: "user", contentLength: Y}
✅ saveChatMessage result: {messageId: X}
```

### AI processes message:
```
🚀 Sending message to LocalAI...
🔍📋 COMPLETE AI RESPONSE ANALYSIS
📝 Raw Content Extraction: Length: N characters
🔍 Thinking Pattern Detection: Contains <think>: true
🧠 THINKING EXTRACTION RESULTS: Extracted Thinking (N chars)
💬 Final Response Content (M chars)
```

### Polling detects new AI response:
```
🔄 Poll: Server has 2 msgs, we have 1
📬 Found 1 new messages
🆕 Processing 1 new messages from server
🔍 Message check - Sender: ai, Exists: false
➕ Adding new ai message to array
🧠 Thinking passed to addMessage: [preview...]
🎨 Calling renderSingleMessage for ai (thinking: true)
🎯 Final thinking check before rendering:
   - thinking exists: true
   - sender is ai: true
✅ Adding thinking section to message bubble
✅ Message rendered, total DOM messages: 2
```

## Troubleshooting Tips

### No Messages at All
- Check backend server is running
- Check `📥 getChatMessages called` returns messages
- Check browser console for network errors

### User Message Shows, AI Response Doesn't
- Check `🚀 Sending message to LocalAI` is followed by success
- Check `💾 saveChatMessage called` for role='assistant'
- Check polling is running (`🔄 Poll:` should appear every 2 seconds)

### Thinking Extracted But Never Displayed
- Check `🎯 Final thinking check` - all conditions must be true
- Verify `✅ Adding thinking section to message bubble` appears
- Check if `showThinking` setting is enabled in settings

### Duplicate Messages
- Look for `⏭️ Skipping duplicate` messages in polling logs
- If not appearing, message deduplication may be failing

## Key Console Log Emojis

- 📤 = Sending message (outgoing)
- 📥 = Receiving messages (incoming)
- 💾 = Saving to database
- 🧠 = Thinking content
- 🎨 = Rendering UI
- 🔍 = Searching/detecting patterns
- ✅ = Success
- ❌ = Error
- ⚠️ = Warning
- 🔄 = Polling/refresh
- 📬 = New messages detected
- 🎯 = Final decision point
