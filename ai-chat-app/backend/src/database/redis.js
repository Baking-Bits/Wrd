/**
 * MariaDB-backed Redis-like cache/storage
 * Replaces Redis dependency with database tables
 */
const { query } = require('./postgres');

let isInitialized = false;

/**
 * Initialize cache tables (replaces Redis)
 */
const initializeRedis = async () => {
  try {
    // Create cache table for key-value storage (replaces Redis)
    await query(`
      CREATE TABLE IF NOT EXISTS cache_store (
        \`key\` VARCHAR(255) PRIMARY KEY,
        \`value\` TEXT NOT NULL,
        expires_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Create index for expiration cleanup
    await query(`
      CREATE INDEX IF NOT EXISTS idx_cache_expires_at 
      ON cache_store(expires_at)
    `);

    // Clean up expired entries on startup
    await query('DELETE FROM cache_store WHERE expires_at IS NOT NULL AND expires_at < NOW()');

    isInitialized = true;
    console.log('✅ Cache storage initialized (using MariaDB)');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize cache storage:', error);
    throw error;
  }
};

/**
 * Get Redis client instance (compatibility stub)
 */
const getRedisClient = () => {
  return isInitialized ? true : null;
};

/**
 * Set a key-value pair with optional expiration
 */
const setKey = async (key, value, expirationSeconds = null) => {
  if (!isInitialized) return null;
  
  try {
    const serializedValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
    
    const expiresAt = expirationSeconds 
      ? new Date(Date.now() + expirationSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ')
      : null;

    await query(`
      INSERT INTO cache_store (\`key\`, \`value\`, expires_at)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), expires_at = VALUES(expires_at), created_at = NOW()
    `, [key, serializedValue, expiresAt]);

    return true;
  } catch (error) {
    console.error('Cache setKey error:', error);
    throw error;
  }
};

/**
 * Get a value by key
 */
const getKey = async (key, parseJson = false) => {
  if (!isInitialized) return null;
  
  try {
    const result = await query(`
      SELECT \`value\` FROM cache_store 
      WHERE \`key\` = ? 
      AND (expires_at IS NULL OR expires_at > NOW())
    `, [key]);
    
    if (result.rows.length === 0) {
      return null;
    }
    
    const value = result.rows[0].value;
    
    if (parseJson) {
      try {
        return JSON.parse(value);
      } catch (e) {
        console.warn('Failed to parse JSON from cache:', e);
        return value;
      }
    }
    
    return value;
  } catch (error) {
    console.error('Cache getKey error:', error);
    throw error;
  }
};

/**
 * Delete a key
 */
const deleteKey = async (key) => {
  if (!isInitialized) return null;
  
  try {
    await query('DELETE FROM cache_store WHERE `key` = ?', [key]);
    return true;
  } catch (error) {
    console.error('Cache deleteKey error:', error);
    throw error;
  }
};

/**
 * Check if a key exists
 */
const keyExists = async (key) => {
  if (!isInitialized) return false;
  
  try {
    const result = await query(`
      SELECT COUNT(*) as count FROM cache_store 
      WHERE \`key\` = ? 
      AND (expires_at IS NULL OR expires_at > NOW())
    `, [key]);
    
    return result.rows[0].count > 0;
  } catch (error) {
    console.error('Cache keyExists error:', error);
    throw error;
  }
};

/**
 * Set expiration on a key
 */
const expireKey = async (key, seconds) => {
  if (!isInitialized) return null;
  
  try {
    const expiresAt = new Date(Date.now() + seconds * 1000).toISOString().slice(0, 19).replace('T', ' ');
    
    await query(`
      UPDATE cache_store 
      SET expires_at = ? 
      WHERE \`key\` = ?
    `, [expiresAt, key]);
    
    return true;
  } catch (error) {
    console.error('Cache expireKey error:', error);
    throw error;
  }
};

/**
 * Increment a counter
 */
const incrementCounter = async (key, increment = 1) => {
  if (!isInitialized) return null;
  
  try {
    // First try to get current value
    const getResult = await query(`
      SELECT \`value\` FROM cache_store 
      WHERE \`key\` = ? 
      AND (expires_at IS NULL OR expires_at > NOW())
    `, [key]);
    
    let newValue;
    if (getResult.rows.length > 0) {
      // Increment existing value
      const currentValue = parseInt(getResult.rows[0].value) || 0;
      newValue = currentValue + increment;
      
      await query(`
        UPDATE cache_store 
        SET \`value\` = ? 
        WHERE \`key\` = ?
      `, [newValue.toString(), key]);
    } else {
      // Insert new value
      newValue = increment;
      await query(`
        INSERT INTO cache_store (\`key\`, \`value\`)
        VALUES (?, ?)
      `, [key, newValue.toString()]);
    }
    
    return newValue;
  } catch (error) {
    console.error('Cache incrementCounter error:', error);
    throw error;
  }
};

/**
 * Add to a set (stores as JSON array)
 */
const addToSet = async (key, ...members) => {
  if (!isInitialized) return null;
  
  try {
    // Get existing set
    const result = await query(`
      SELECT \`value\` FROM cache_store 
      WHERE \`key\` = ? 
      AND (expires_at IS NULL OR expires_at > NOW())
    `, [key]);
    
    let set = new Set();
    if (result.rows.length > 0) {
      try {
        set = new Set(JSON.parse(result.rows[0].value));
      } catch (e) {
        console.warn('Failed to parse set from cache:', e);
      }
    }
    
    // Add new members
    members.forEach(m => set.add(m));
    
    // Save back
    const serialized = JSON.stringify([...set]);
    await query(`
      INSERT INTO cache_store (\`key\`, \`value\`)
      VALUES (?, ?)
      ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), created_at = NOW()
    `, [key, serialized]);
    
    return set.size;
  } catch (error) {
    console.error('Cache addToSet error:', error);
    throw error;
  }
};

/**
 * Check if member exists in set
 */
const isInSet = async (key, member) => {
  if (!isInitialized) return false;
  
  try {
    const result = await query(`
      SELECT \`value\` FROM cache_store 
      WHERE \`key\` = ? 
      AND (expires_at IS NULL OR expires_at > NOW())
    `, [key]);
    
    if (result.rows.length === 0) {
      return false;
    }
    
    try {
      const set = new Set(JSON.parse(result.rows[0].value));
      return set.has(member);
    } catch (e) {
      console.warn('Failed to parse set from cache:', e);
      return false;
    }
  } catch (error) {
    console.error('Cache isInSet error:', error);
    throw error;
  }
};

/**
 * Remove from set
 */
const removeFromSet = async (key, ...members) => {
  if (!isInitialized) return null;
  
  try {
    const result = await query(`
      SELECT \`value\` FROM cache_store 
      WHERE \`key\` = ? 
      AND (expires_at IS NULL OR expires_at > NOW())
    `, [key]);
    
    if (result.rows.length === 0) {
      return 0;
    }
    
    let set = new Set();
    try {
      set = new Set(JSON.parse(result.rows[0].value));
    } catch (e) {
      console.warn('Failed to parse set from cache:', e);
      return 0;
    }
    
    // Remove members
    members.forEach(m => set.delete(m));
    
    // Save back
    const serialized = JSON.stringify([...set]);
    await query(`
      UPDATE cache_store 
      SET \`value\` = ?, created_at = NOW() 
      WHERE \`key\` = ?
    `, [serialized, key]);
    
    return members.length;
  } catch (error) {
    console.error('Cache removeFromSet error:', error);
    throw error;
  }
};

/**
 * Close Redis connection (no-op for database-backed cache)
 */
const closeRedis = async () => {
  // No action needed - using shared database connection pool
  console.log('✅ Cache storage closed');
};

module.exports = {
  initializeRedis,
  getRedisClient,
  setKey,
  getKey,
  deleteKey,
  keyExists,
  expireKey,
  incrementCounter,
  addToSet,
  isInSet,
  removeFromSet,
  closeRedis
};