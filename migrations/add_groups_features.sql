-- Add upvote_count and comment_count to groups table
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS upvote_count INT DEFAULT 0 NOT NULL;
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS comment_count INT DEFAULT 0 NOT NULL;

-- Add display_picture_url to groups table
ALTER TABLE "groups" ADD COLUMN IF NOT EXISTS display_picture_url TEXT;

-- Create group_comments table (similar to comments but for groups)
CREATE TABLE IF NOT EXISTS public.group_comments (
    comment_id uuid DEFAULT gen_random_uuid() NOT NULL,
    group_id uuid NOT NULL,
    user_id uuid NOT NULL,
    content text NOT NULL,
    posted_at timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT group_comments_pkey PRIMARY KEY (comment_id),
    CONSTRAINT group_comments_group_id_fkey FOREIGN KEY (group_id) REFERENCES public."groups"(group_id) ON DELETE CASCADE,
    CONSTRAINT group_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE
);
