const mysql = require('mysql2/promise');
const config = require('./config');

async function migrate() {
    let connection;
    try {
        console.log('🔄 Connecting to MariaDB...');
        connection = await mysql.createConnection({
            host: config.database.host,
            port: config.database.port,
            user: config.database.user,
            password: config.database.password,
            database: config.database.database
        });
        
        console.log('✅ Connected to database');
        console.log('🔄 Altering messages table: changing content from TEXT to MEDIUMTEXT...');
        
        await connection.execute('ALTER TABLE messages MODIFY COLUMN content MEDIUMTEXT NOT NULL');
        
        console.log('✅ Migration complete! Messages table can now store large images.');
        
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

migrate();
