const db = require('./database');

async function clearDatabase() {
  try {
    console.log('🗑️ Clearing all chat history from database...');
    
    // Initialize database
    const connected = await db.initializeDatabase();
    if (!connected) {
      console.error('❌ Failed to connect to database');
      process.exit(1);
    }
    
    // Get database connection
    const connection = db.getConnection();
    
    // Clear all messages
    await connection.execute('DELETE FROM messages');
    console.log('✅ Cleared all messages');
    
    // Clear all chats
    await connection.execute('DELETE FROM chats');
    console.log('✅ Cleared all chats');
    
    console.log('🎉 Database cleared successfully!');
    
    // Close connection
    await db.closeDatabase();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error clearing database:', error);
    process.exit(1);
  }
}

clearDatabase();
