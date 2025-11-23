-- Add display_picture_url column to issues table
ALTER TABLE public.issues 
ADD COLUMN IF NOT EXISTS display_picture_url TEXT;

-- Add comment_count column to issues table for caching
ALTER TABLE public.issues 
ADD COLUMN IF NOT EXISTS comment_count INT DEFAULT 0;

-- Create index on posted_at for faster ordering
CREATE INDEX IF NOT EXISTS idx_issues_posted_at ON public.issues(posted_at DESC);

-- Create index on user_id for filtering by user
CREATE INDEX IF NOT EXISTS idx_issues_user_id ON public.issues(user_id);

-- Create index on group_id for filtering by group
CREATE INDEX IF NOT EXISTS idx_issues_group_id ON public.issues(group_id);
