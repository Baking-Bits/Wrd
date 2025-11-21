-- Migration: Add is_admin to users and set admin for patheinecke@gmail.com
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT false;
UPDATE users SET is_admin = true WHERE email = 'patheinecke@gmail.com';
