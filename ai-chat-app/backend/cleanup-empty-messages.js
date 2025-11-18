/**
 * Cleanup Script - Remove Empty Messages from Database
 * Run this once to clean up any existing empty messages that may have been saved
 */

const mysql = require('mysql2/promise');

async function cleanupEmptyMessages() {
    console.log('🧹 Starting empty message cleanup...\n');
    
    let connection;
    
    try {
        // Connect to database
        connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'Homelab-p',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || 'R20302',
            database: process.env.DB_NAME || 'ChatterRave'
        });
        
        console.log('✅ Connected to MariaDB database\n');
        
        // Find empty messages
        const [emptyMessages] = await connection.execute(
            `SELECT id, chat_session_id, role, content, created_at 
             FROM messages 
             WHERE content = '' OR content IS NULL OR TRIM(content) = ''
             ORDER BY created_at DESC`
        );
        
        if (emptyMessages.length === 0) {
            console.log('✅ No empty messages found! Database is clean.\n');
            return;
        }
        
        console.log(`📊 Found ${emptyMessages.length} empty messages:\n`);
        
        // Group by chat
        const byChatId = {};
        emptyMessages.forEach(msg => {
            if (!byChatId[msg.chat_session_id]) {
                byChatId[msg.chat_session_id] = [];
            }
            byChatId[msg.chat_session_id].push(msg);
        });
        
        console.log('Empty messages by chat:');
        for (const [chatId, messages] of Object.entries(byChatId)) {
            console.log(`  Chat ${chatId}: ${messages.length} empty messages`);
            messages.forEach(msg => {
                console.log(`    - Message ${msg.id} (${msg.role}) at ${msg.created_at}`);
            });
        }
        
        console.log('\n⚠️  This will DELETE these empty messages from the database!');
        console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Delete empty messages
        const [result] = await connection.execute(
            `DELETE FROM messages 
             WHERE content = '' OR content IS NULL OR TRIM(content) = ''`
        );
        
        console.log(`✅ Deleted ${result.affectedRows} empty messages\n`);
        console.log('🎉 Cleanup complete!\n');
        
    } catch (error) {
        console.error('❌ Error during cleanup:', error.message);
        throw error;
    } finally {
        if (connection) {
            await connection.end();
            console.log('📊 Database connection closed\n');
        }
    }
}

// Run the cleanup
cleanupEmptyMessages()
    .then(() => {
        console.log('Script finished successfully');
        process.exit(0);
    })
    .catch(error => {
        console.error('Script failed:', error);
        process.exit(1);
    });
