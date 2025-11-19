const mysql = require('mysql2/promise');

async function addPendingAvatarsTable() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST || 'Homelab-p',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || 'oOc1992',
        database: process.env.DB_NAME || 'ChatterRave'
    });

    try {
        console.log('🗄️ Adding pending_avatars table...');
        
        await connection.execute(`
            CREATE TABLE IF NOT EXISTS pending_avatars (
                id INT AUTO_INCREMENT PRIMARY KEY,
                personality_id INT NOT NULL,
                user_id INT NOT NULL,
                avatar_url TEXT NOT NULL,
                prompt TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL 24 HOUR),
                FOREIGN KEY (personality_id) REFERENCES personalities(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_personality_user (personality_id, user_id),
                INDEX idx_expires (expires_at)
            )
        `);
        
        console.log('✅ pending_avatars table created successfully');
        
        // Check if table exists and show structure
        const [tables] = await connection.execute("SHOW TABLES LIKE 'pending_avatars'");
        if (tables.length > 0) {
            console.log('✅ Table verified in database');
            const [columns] = await connection.execute('DESCRIBE pending_avatars');
            console.log('📋 Table structure:');
            columns.forEach(col => {
                console.log(`   - ${col.Field}: ${col.Type}`);
            });
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        throw error;
    } finally {
        await connection.end();
    }
}

addPendingAvatarsTable()
    .then(() => {
        console.log('✅ Migration complete');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Migration failed:', error);
        process.exit(1);
    });
