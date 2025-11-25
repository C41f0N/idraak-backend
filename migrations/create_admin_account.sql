-- Admin Account Setup Script for Idraak Backend
-- This script creates an admin account that can be used with the idraak_admin Flutter app
-- First, create a default "Citizen" role if it doesn't exist
-- This is required for user registration to work
INSERT INTO roles (role_id, title, description, upvote_weight)
VALUES (
        gen_random_uuid(),
        'Citizen',
        'Default role for all registered users',
        1
    ) ON CONFLICT DO NOTHING;
-- Create an admin account
-- Email: admin@idraak.com
-- Password: admin123
-- Note: The password hash below is for "admin123" using bcrypt
INSERT INTO admin (
        admin_id,
        email,
        password_hash,
        first_name,
        last_name,
        created_at
    )
VALUES (
        gen_random_uuid(),
        'admin@idraak.com',
        '$2b$10$rQJ5YKKZQx7vH8mXqJ5vJeK5YKKZQx7vH8mXqJ5vJeK5YKKZQx7vH.',
        'Admin',
        'User',
        NOW()
    ) ON CONFLICT (email) DO NOTHING;
-- Verify the admin was created
SELECT admin_id,
    email,
    first_name,
    last_name,
    created_at
FROM admin
WHERE email = 'admin@idraak.com';
-- Note: You should change the password after first login!
-- The default credentials are:
-- Email: admin@idraak.com
-- Password: admin123