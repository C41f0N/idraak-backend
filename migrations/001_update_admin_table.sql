-- Migration script to update admin table
-- Run this if you have an existing admin table without the new columns

-- Add new columns if they don't exist
ALTER TABLE admin ADD COLUMN IF NOT EXISTS email varchar(255);
ALTER TABLE admin ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE admin ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

-- Add unique constraint on email if it doesn't exist
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint 
        WHERE conname = 'admin_email_key'
    ) THEN
        ALTER TABLE admin ADD CONSTRAINT admin_email_key UNIQUE (email);
    END IF;
END $$;

-- After adding the columns, you may want to update them to NOT NULL
-- But first make sure all existing records have values
-- ALTER TABLE admin ALTER COLUMN email SET NOT NULL;
-- ALTER TABLE admin ALTER COLUMN password_hash SET NOT NULL;
