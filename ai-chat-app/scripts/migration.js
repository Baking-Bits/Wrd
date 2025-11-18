#!/usr/bin/env node
/**
 * Migration script to convert localStorage data to database
 * This script helps users migrate from the old localStorage system to the new database system
 */

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { initializeDatabase, query, transaction, closeDatabase } = require('../backend/src/database/postgres');

// Sample localStorage data structure (users should provide their actual data)
const sampleLocalStorageData = {
  aiChatSettings: {
    localaIUrl: "http://192.168.1.206:8082",
    a1111Url: "http://192.168.1.206:7860",
    comfyuiUrl: "http://192.168.1.206:8188",
    currentPersonality: "Default Assistant"
  },
  aiChatPersonalities: {
    "Default Assistant": {
      name: "Default Assistant",
      systemPrompt: "You are a helpful AI assistant.",
      personalityTraits: ["helpful", "friendly", "knowledgeable"],
      backgroundInfo: {},
      avatarData: null
    }
  },
  aiChatCurrentPersonality: "Default Assistant",
  aiChatHistory: [
    {
      type: "user",
      content: "Hello!",
      timestamp: new Date().toISOString()
    }
  ]
};

/**
 * Create a migration user from localStorage data
 */
async function migrateLocalStorageData(localStorageData, userEmail, userPassword) {
  console.log('🔄 Starting localStorage migration...');
  
  try {
    await initializeDatabase();
    console.log('✅ Database connected');

    const result = await transaction(async (client) => {
      // 1. Create user account
      const passwordHash = await bcrypt.hash(userPassword, 12);
      
      const userResult = await client.query(
        `INSERT INTO users (email, password_hash, display_name, is_active) 
         VALUES ($1, $2, $3, true) 
         RETURNING id`,
        [userEmail, passwordHash, 'Migrated User']
      );
      
      const userId = userResult.rows[0].id;
      console.log(`✅ Created user account: ${userEmail} (ID: ${userId})`);

      // 2. Migrate settings
      const settings = localStorageData.aiChatSettings || {};
      await client.query(
        `INSERT INTO user_settings (
          user_id, localai_url, a1111_url, comfyui_url, 
          theme_preference, auto_generate_avatars
        ) VALUES ($1, $2, $3, $4, 'dark', true)`,
        [
          userId,
          settings.localaIUrl || null,
          settings.a1111Url || null,
          settings.comfyuiUrl || null
        ]
      );
      console.log('✅ Migrated user settings');

      // 3. Migrate personalities
      const personalities = localStorageData.aiChatPersonalities || {};
      const currentPersonality = localStorageData.aiChatCurrentPersonality;
      let defaultPersonalityId = null;

      for (const [name, personality] of Object.entries(personalities)) {
        const isDefault = name === currentPersonality;
        
        const personalityResult = await client.query(
          `INSERT INTO personalities (
            user_id, name, description, system_prompt, avatar_data, 
            personality_traits, background_info, is_default
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING id`,
          [
            userId,
            personality.name,
            personality.description || 'Migrated from localStorage',
            personality.systemPrompt,
            personality.avatarData || null,
            JSON.stringify(personality.personalityTraits || []),
            JSON.stringify(personality.backgroundInfo || {}),
            isDefault
          ]
        );

        const personalityId = personalityResult.rows[0].id;
        console.log(`✅ Migrated personality: ${personality.name} (ID: ${personalityId})`);

        if (isDefault) {
          defaultPersonalityId = personalityId;
        }
      }

      // 4. Update default personality in settings
      if (defaultPersonalityId) {
        await client.query(
          'UPDATE user_settings SET default_personality_id = $1 WHERE user_id = $2',
          [defaultPersonalityId, userId]
        );
      }

      // 5. Migrate chat history
      const history = localStorageData.aiChatHistory || [];
      
      if (history.length > 0) {
        // Create a chat session for the migrated history
        const sessionResult = await client.query(
          `INSERT INTO chat_sessions (user_id, personality_id, session_name)
           VALUES ($1, $2, 'Migrated Chat History')
           RETURNING id`,
          [userId, defaultPersonalityId]
        );
        
        const sessionId = sessionResult.rows[0].id;

        // Insert messages
        for (const message of history) {
          await client.query(
            `INSERT INTO chat_messages (session_id, message_type, content, created_at)
             VALUES ($1, $2, $3, $4)`,
            [
              sessionId,
              message.type === 'user' ? 'user' : 'assistant',
              message.content,
              message.timestamp ? new Date(message.timestamp) : new Date()
            ]
          );
        }
        
        console.log(`✅ Migrated ${history.length} chat messages`);
      }

      return userId;
    });

    console.log('🎉 Migration completed successfully!');
    console.log(`👤 User ID: ${result}`);
    console.log(`📧 Email: ${userEmail}`);
    console.log('🔑 You can now log in with your email and password');
    
    return result;

  } catch (error) {
    console.error('💥 Migration failed:', error);
    throw error;
  } finally {
    await closeDatabase();
  }
}

/**
 * Interactive migration process
 */
async function runInteractiveMigration() {
  console.log('🚀 AI Chat localStorage Migration Tool');
  console.log('=====================================');
  console.log();

  // Check for data file
  const dataFilePath = path.join(__dirname, 'localStorage-data.json');
  
  if (!fs.existsSync(dataFilePath)) {
    console.log('📄 Creating sample localStorage data file...');
    fs.writeFileSync(dataFilePath, JSON.stringify(sampleLocalStorageData, null, 2));
    
    console.log(`📝 Please edit the file: ${dataFilePath}`);
    console.log('   Add your actual localStorage data and run this script again.');
    console.log();
    console.log('💡 To export your localStorage data:');
    console.log('   1. Open your browser developer tools (F12)');
    console.log('   2. Go to Application/Storage -> Local Storage');
    console.log('   3. Copy the values for keys starting with "aiChat"');
    console.log('   4. Update the JSON file with your data');
    return;
  }

  // Load user data
  const localStorageData = JSON.parse(fs.readFileSync(dataFilePath, 'utf8'));
  
  console.log('📋 Found localStorage data:');
  console.log(`   Settings: ${localStorageData.aiChatSettings ? '✅' : '❌'}`);
  console.log(`   Personalities: ${Object.keys(localStorageData.aiChatPersonalities || {}).length} found`);
  console.log(`   Chat History: ${(localStorageData.aiChatHistory || []).length} messages`);
  console.log();

  // Get user credentials (in a real implementation, you'd use a CLI library like inquirer)
  const userEmail = process.argv[2] || 'user@localhost';
  const userPassword = process.argv[3] || 'password123';

  console.log(`📧 User Email: ${userEmail}`);
  console.log(`🔑 Password: ${'*'.repeat(userPassword.length)}`);
  console.log();

  if (userEmail === 'user@localhost' || userPassword === 'password123') {
    console.log('⚠️  Using default credentials!');
    console.log('   Run with: node migration.js your-email@example.com your-secure-password');
    console.log();
  }

  try {
    await migrateLocalStorageData(localStorageData, userEmail, userPassword);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

// Run migration if script is executed directly
if (require.main === module) {
  runInteractiveMigration();
}

module.exports = { migrateLocalStorageData };