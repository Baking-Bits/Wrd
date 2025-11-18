const mysql = require('mysql2/promise');
const config = require('../config');

let pool;

/**
 * Initialize database connection pool
 */
const initializeDatabase = async () => {
  pool = mysql.createPool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.database,
    user: config.database.user,
    password: config.database.password,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: '+00:00'
  });

  // Test connection
  try {
    const connection = await pool.getConnection();
    console.log('✅ MariaDB connected successfully');
    connection.release();
  } catch (err) {
    console.error('❌ MariaDB connection failed:', err);
    throw err;
  }

  return pool;
};

/**
 * Get database pool instance
 */
const getPool = () => {
  if (!pool) {
    return initializeDatabase();
  }
  return pool;
};

/**
 * Execute a query with error handling
 */
const query = async (text, params = []) => {
  const client = getPool();
  
  try {
    const start = Date.now();
    const [rows, fields] = await client.query(text, params);
    const duration = Date.now() - start;
    
    if (config.nodeEnv === 'development') {
      console.log(`🔍 Query executed: ${duration}ms`);
    }
    
    // Return in PostgreSQL-like format for compatibility
    return { rows, fields };
  } catch (error) {
    console.error('💥 Database query error:', error);
    throw error;
  }
};

/**
 * Execute a transaction
 */
const transaction = async (callback) => {
  const connection = await getPool().getConnection();
  
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

/**
 * Close database connections
 */
const closeDatabase = async () => {
  if (pool) {
    console.log('🔌 Closing database connections...');
    await pool.end();
    pool = null;
  }
};

module.exports = {
  initializeDatabase,
  getPool,
  query,
  transaction,
  closeDatabase
};