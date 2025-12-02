-- DROP SCHEMA public;

CREATE SCHEMA public AUTHORIZATION pg_database_owner;

-- Begin transaction for schema creation
BEGIN;

-- public."admin" definition

-- Drop table

-- DROP TABLE public."admin";

CREATE TABLE public."admin" (
	admin_id uuid DEFAULT gen_random_uuid() NOT NULL,
	email varchar(255) NOT NULL,
	password_hash text NOT NULL,
	first_name varchar(50) NOT NULL,
	last_name varchar(50) NOT NULL,
	created_at timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT admin_email_key UNIQUE (email),
	CONSTRAINT admin_pkey PRIMARY KEY (admin_id)
);

-- Permissions

ALTER TABLE public."admin" OWNER TO postgres;
GRANT ALL ON TABLE public."admin" TO postgres;


-- public.roles definition

-- Drop table

-- DROP TABLE public.roles;

CREATE TABLE public.roles (
	role_id uuid DEFAULT gen_random_uuid() NOT NULL,
	title text NOT NULL,
	description text NULL,
	upvote_weight int4 DEFAULT 1 NOT NULL,
	CONSTRAINT roles_pkey PRIMARY KEY (role_id)
);

-- Permissions

ALTER TABLE public.roles OWNER TO postgres;
GRANT ALL ON TABLE public.roles TO postgres;


-- public.users definition

-- Drop table

-- DROP TABLE public.users;

CREATE TABLE public.users (
	user_id uuid NOT NULL,
	email text NOT NULL,
	full_name text NOT NULL,
	role_id uuid NOT NULL,
	created_at timestamptz DEFAULT now() NOT NULL,
	username text NOT NULL,
	password_hash text DEFAULT ''::text NOT NULL,
	profile_picture_url varchar NULL,
	CONSTRAINT users_email_key UNIQUE (email),
	CONSTRAINT users_pkey PRIMARY KEY (user_id),
	CONSTRAINT users_username_key UNIQUE (username),
	CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(role_id)
);

-- Permissions

ALTER TABLE public.users OWNER TO postgres;
GRANT ALL ON TABLE public.users TO postgres;


-- public."groups" definition

-- Drop table

-- DROP TABLE public."groups";

CREATE TABLE public."groups" (
	group_id uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	description text NULL,
	owner_id uuid NOT NULL,
	created_at timestamptz DEFAULT now() NOT NULL,
	upvote_count int4 DEFAULT 0 NOT NULL,
	comment_count int4 DEFAULT 0 NOT NULL,
	display_picture_url text NULL,
	issue_count int4 DEFAULT 0 NULL,
	CONSTRAINT groups_pkey PRIMARY KEY (group_id),
	CONSTRAINT groups_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(user_id) ON DELETE CASCADE
);

-- Permissions

ALTER TABLE public."groups" OWNER TO postgres;
GRANT ALL ON TABLE public."groups" TO postgres;


-- public.issues definition

-- Drop table

-- DROP TABLE public.issues;

CREATE TABLE public.issues (
	issue_id uuid DEFAULT gen_random_uuid() NOT NULL,
	title text NOT NULL,
	description text NOT NULL,
	posted_at timestamptz DEFAULT now() NOT NULL,
	user_id uuid NOT NULL,
	group_id uuid NULL,
	upvote_count int4 DEFAULT 0 NOT NULL,
	display_picture_url text NULL,
	comment_count int4 DEFAULT 0 NULL,
	CONSTRAINT issues_pkey PRIMARY KEY (issue_id),
	CONSTRAINT issues_group_id_fkey FOREIGN KEY (group_id) REFERENCES public."groups"(group_id) ON DELETE SET NULL,
	CONSTRAINT issues_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE
);
CREATE INDEX idx_issues_group_id ON public.issues USING btree (group_id);
CREATE INDEX idx_issues_posted_at ON public.issues USING btree (posted_at DESC);
CREATE INDEX idx_issues_user_id ON public.issues USING btree (user_id);

-- Table Triggers

create trigger trg_issue_delete_group_count after
delete
    on
    public.issues for each row execute function trg_delete_issue_group_count();
create trigger trg_issue_insert_group_count after
insert
    on
    public.issues for each row execute function trg_inc_group_issue_count_on_insert();
create trigger trg_issue_update_group_count after
update
    of group_id on
    public.issues for each row
    when ((old.group_id is distinct
from
    new.group_id)) execute function trg_update_issue_group_count();

-- Permissions

ALTER TABLE public.issues OWNER TO postgres;
GRANT ALL ON TABLE public.issues TO postgres;


-- public.post_attachments definition

-- Drop table

-- DROP TABLE public.post_attachments;

CREATE TABLE public.post_attachments (
	attachment_id uuid DEFAULT gen_random_uuid() NOT NULL,
	issue_id uuid NOT NULL,
	uploaded_by uuid NOT NULL,
	file_path text NOT NULL,
	created_at timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT post_attachments_pkey PRIMARY KEY (attachment_id),
	CONSTRAINT post_attachments_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.issues(issue_id) ON DELETE CASCADE,
	CONSTRAINT post_attachments_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(user_id) ON DELETE CASCADE
);

-- Permissions

ALTER TABLE public.post_attachments OWNER TO postgres;
GRANT ALL ON TABLE public.post_attachments TO postgres;


-- public.role_change_request definition

-- Drop table

-- DROP TABLE public.role_change_request;

CREATE TABLE public.role_change_request (
	req_id uuid DEFAULT gen_random_uuid() NOT NULL,
	user_id uuid NOT NULL,
	requested_role_id uuid NOT NULL,
	status text DEFAULT 'pending'::text NOT NULL,
	submitted_at timestamptz DEFAULT now() NOT NULL,
	reviewed_by_admin uuid NULL,
	reviewed_at timestamptz NULL,
	CONSTRAINT role_change_request_pkey PRIMARY KEY (req_id),
	CONSTRAINT role_change_request_requested_role_id_fkey FOREIGN KEY (requested_role_id) REFERENCES public.roles(role_id),
	CONSTRAINT role_change_request_reviewed_by_admin_fkey FOREIGN KEY (reviewed_by_admin) REFERENCES public.users(user_id),
	CONSTRAINT role_change_request_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE
);

-- Permissions

ALTER TABLE public.role_change_request OWNER TO postgres;
GRANT ALL ON TABLE public.role_change_request TO postgres;


-- public."comments" definition

-- Drop table

-- DROP TABLE public."comments";

CREATE TABLE public."comments" (
	comment_id uuid DEFAULT gen_random_uuid() NOT NULL,
	issue_id uuid NOT NULL,
	user_id uuid NOT NULL,
	"content" text NOT NULL,
	posted_at timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT comments_pkey PRIMARY KEY (comment_id),
	CONSTRAINT comments_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.issues(issue_id) ON DELETE CASCADE,
	CONSTRAINT comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE
);

-- Table Triggers

create trigger trg_after_delete_comment after
delete
    on
    public.comments for each row execute function trg_dec_issue_comment_count();
create trigger trg_after_insert_comment after
insert
    on
    public.comments for each row execute function trg_inc_issue_comment_count();

-- Permissions

ALTER TABLE public."comments" OWNER TO postgres;
GRANT ALL ON TABLE public."comments" TO postgres;


-- public.group_comments definition

-- Drop table

-- DROP TABLE public.group_comments;

CREATE TABLE public.group_comments (
	comment_id uuid DEFAULT gen_random_uuid() NOT NULL,
	group_id uuid NOT NULL,
	user_id uuid NOT NULL,
	"content" text NOT NULL,
	posted_at timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT group_comments_pkey PRIMARY KEY (comment_id),
	CONSTRAINT group_comments_group_id_fkey FOREIGN KEY (group_id) REFERENCES public."groups"(group_id) ON DELETE CASCADE,
	CONSTRAINT group_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE
);

-- Table Triggers

create trigger trg_after_delete_group_comment after
delete
    on
    public.group_comments for each row execute function trg_dec_group_comment_count();
create trigger trg_after_insert_group_comment after
insert
    on
    public.group_comments for each row execute function trg_inc_group_comment_count();

-- Permissions

ALTER TABLE public.group_comments OWNER TO postgres;
GRANT ALL ON TABLE public.group_comments TO postgres;


-- public.group_join_request definition

-- Drop table

-- DROP TABLE public.group_join_request;

CREATE TABLE public.group_join_request (
	req_id uuid DEFAULT gen_random_uuid() NOT NULL,
	issue_id uuid NOT NULL,
	group_id uuid NOT NULL,
	requested_by_group bool NOT NULL,
	status text DEFAULT 'pending'::text NOT NULL,
	handled_at timestamptz NULL,
	requested_at timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT group_join_request_issue_id_group_id_key UNIQUE (issue_id, group_id),
	CONSTRAINT group_join_request_pkey PRIMARY KEY (req_id),
	CONSTRAINT group_join_request_group_id_fkey FOREIGN KEY (group_id) REFERENCES public."groups"(group_id) ON DELETE CASCADE,
	CONSTRAINT group_join_request_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.issues(issue_id) ON DELETE CASCADE
);

-- Permissions

ALTER TABLE public.group_join_request OWNER TO postgres;
GRANT ALL ON TABLE public.group_join_request TO postgres;


-- public.group_upvotes definition

-- Drop table

-- DROP TABLE public.group_upvotes;

CREATE TABLE public.group_upvotes (
	group_upvote_id uuid DEFAULT gen_random_uuid() NOT NULL,
	group_id uuid NOT NULL,
	user_id uuid NOT NULL,
	made_at timestamptz DEFAULT now() NOT NULL,
	upvote_weight int4 DEFAULT 1 NULL,
	CONSTRAINT group_upvotes_group_id_user_id_key UNIQUE (group_id, user_id),
	CONSTRAINT group_upvotes_pkey PRIMARY KEY (group_upvote_id),
	CONSTRAINT group_upvotes_group_id_fkey FOREIGN KEY (group_id) REFERENCES public."groups"(group_id) ON DELETE CASCADE,
	CONSTRAINT group_upvotes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE
);

-- Table Triggers

create trigger trg_after_delete_group_upvote after
delete
    on
    public.group_upvotes for each row execute function trg_group_upvote_after_delete();
create trigger trg_after_insert_group_upvote before
insert
    on
    public.group_upvotes for each row execute function trg_group_upvote_after_insert();

-- Permissions

ALTER TABLE public.group_upvotes OWNER TO postgres;
GRANT ALL ON TABLE public.group_upvotes TO postgres;


-- public.issue_upvotes definition

-- Drop table

-- DROP TABLE public.issue_upvotes;

CREATE TABLE public.issue_upvotes (
	upvote_id uuid DEFAULT gen_random_uuid() NOT NULL,
	issue_id uuid NOT NULL,
	user_id uuid NOT NULL,
	made_at timestamptz DEFAULT now() NOT NULL,
	upvote_weight int4 DEFAULT 1 NULL,
	CONSTRAINT issue_upvotes_issue_id_user_id_key UNIQUE (issue_id, user_id),
	CONSTRAINT issue_upvotes_pkey PRIMARY KEY (upvote_id),
	CONSTRAINT issue_upvotes_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.issues(issue_id) ON DELETE CASCADE,
	CONSTRAINT issue_upvotes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE
);

-- Table Triggers

create trigger trg_after_delete_issue_upvote after
delete
    on
    public.issue_upvotes for each row execute function trg_issue_upvote_after_delete();
create trigger trg_after_insert_issue_upvote before
insert
    on
    public.issue_upvotes for each row execute function trg_issue_upvote_after_insert();

-- Permissions

ALTER TABLE public.issue_upvotes OWNER TO postgres;
GRANT ALL ON TABLE public.issue_upvotes TO postgres;


-- ============================================================================
-- VIEWS
-- ============================================================================

-- View: Issues with user and group information
CREATE OR REPLACE VIEW v_issues_detailed AS
SELECT 
    i.issue_id,
    i.title,
    i.description,
    i.posted_at,
    i.upvote_count,
    i.comment_count,
    i.display_picture_url,
    i.user_id,
    u.username,
    u.full_name,
    u.profile_picture_url AS user_profile_picture,
    i.group_id,
    g.name AS group_name,
    g.owner_id AS group_owner_id,
    (SELECT COUNT(*) FROM post_attachments pa WHERE pa.issue_id = i.issue_id) AS attachment_count
FROM issues i
JOIN users u ON i.user_id = u.user_id
LEFT JOIN groups g ON i.group_id = g.group_id;

-- View: Groups with owner and statistics
CREATE OR REPLACE VIEW v_groups_detailed AS
SELECT 
    g.group_id,
    g.name,
    g.description,
    g.created_at,
    g.upvote_count,
    g.comment_count,
    g.display_picture_url,
    g.issue_count,
    g.owner_id,
    u.username AS owner_username,
    u.full_name AS owner_full_name,
    u.profile_picture_url AS owner_profile_picture
FROM groups g
JOIN users u ON g.owner_id = u.user_id;

-- View: Users with role information
CREATE OR REPLACE VIEW v_users_with_roles AS
SELECT 
    u.user_id,
    u.email,
    u.username,
    u.full_name,
    u.profile_picture_url,
    u.created_at,
    u.role_id,
    r.title AS role_title,
    r.description AS role_description,
    r.upvote_weight,
    (SELECT COUNT(*) FROM issues WHERE user_id = u.user_id) AS issues_created,
    (SELECT COUNT(*) FROM groups WHERE owner_id = u.user_id) AS groups_owned,
    (SELECT COUNT(*) FROM comments WHERE user_id = u.user_id) AS comments_made
FROM users u
JOIN roles r ON u.role_id = r.role_id;

-- View: Comments with user information
CREATE OR REPLACE VIEW v_comments_detailed AS
SELECT 
    c.comment_id,
    c.issue_id,
    c.content,
    c.posted_at,
    c.user_id,
    u.username,
    u.full_name,
    u.profile_picture_url,
    i.title AS issue_title
FROM comments c
JOIN users u ON c.user_id = u.user_id
JOIN issues i ON c.issue_id = i.issue_id;

-- View: Group comments with user information
CREATE OR REPLACE VIEW v_group_comments_detailed AS
SELECT 
    gc.comment_id,
    gc.group_id,
    gc.content,
    gc.posted_at,
    gc.user_id,
    u.username,
    u.full_name,
    u.profile_picture_url,
    g.name AS group_name
FROM group_comments gc
JOIN users u ON gc.user_id = u.user_id
JOIN groups g ON gc.group_id = g.group_id;

-- View: Pending role change requests
CREATE OR REPLACE VIEW v_pending_role_requests AS
SELECT 
    rcr.req_id,
    rcr.user_id,
    u.username,
    u.full_name,
    u.email,
    rcr.requested_role_id,
    r.title AS requested_role_title,
    current_r.title AS current_role_title,
    rcr.status,
    rcr.submitted_at,
    rcr.reviewed_at,
    rcr.reviewed_by_admin
FROM role_change_request rcr
JOIN users u ON rcr.user_id = u.user_id
JOIN roles r ON rcr.requested_role_id = r.role_id
JOIN roles current_r ON u.role_id = current_r.role_id
WHERE rcr.status = 'pending'
ORDER BY rcr.submitted_at DESC;

-- View: Pending group join requests
CREATE OR REPLACE VIEW v_pending_group_join_requests AS
SELECT 
    gjr.req_id,
    gjr.issue_id,
    i.title AS issue_title,
    i.user_id AS issue_author_id,
    issue_author.username AS issue_author_username,
    gjr.group_id,
    g.name AS group_name,
    g.owner_id AS group_owner_id,
    group_owner.username AS group_owner_username,
    gjr.requested_by_group,
    gjr.status,
    gjr.requested_at,
    gjr.handled_at
FROM group_join_request gjr
JOIN issues i ON gjr.issue_id = i.issue_id
JOIN users issue_author ON i.user_id = issue_author.user_id
JOIN groups g ON gjr.group_id = g.group_id
JOIN users group_owner ON g.owner_id = group_owner.user_id
WHERE gjr.status = 'pending'
ORDER BY gjr.requested_at DESC;

-- View: Popular issues (by upvote count)
CREATE OR REPLACE VIEW v_popular_issues AS
SELECT 
    i.issue_id,
    i.title,
    i.description,
    i.upvote_count,
    i.comment_count,
    i.posted_at,
    i.display_picture_url,
    u.username,
    u.full_name,
    g.name AS group_name
FROM issues i
JOIN users u ON i.user_id = u.user_id
LEFT JOIN groups g ON i.group_id = g.group_id
WHERE i.upvote_count > 0
ORDER BY i.upvote_count DESC, i.posted_at DESC;

-- View: Recent activity feed (issues and groups combined)
CREATE OR REPLACE VIEW v_recent_activity AS
SELECT 
    issue_id AS id,
    title,
    description,
    posted_at AS activity_date,
    'issue' AS activity_type,
    user_id,
    username,
    full_name,
    upvote_count,
    comment_count,
    display_picture_url
FROM v_issues_detailed
WHERE group_id IS NULL
UNION ALL
SELECT 
    group_id AS id,
    name AS title,
    description,
    created_at AS activity_date,
    'group' AS activity_type,
    owner_id AS user_id,
    owner_username AS username,
    owner_full_name AS full_name,
    upvote_count,
    comment_count,
    display_picture_url
FROM v_groups_detailed
ORDER BY activity_date DESC;

-- View: User activity summary
CREATE OR REPLACE VIEW v_user_activity_summary AS
SELECT 
    u.user_id,
    u.username,
    u.full_name,
    COUNT(DISTINCT i.issue_id) AS total_issues,
    COUNT(DISTINCT g.group_id) AS total_groups,
    COUNT(DISTINCT c.comment_id) AS total_comments,
    COUNT(DISTINCT iu.upvote_id) AS total_issue_upvotes,
    COUNT(DISTINCT gu.group_upvote_id) AS total_group_upvotes,
    COALESCE(SUM(i.upvote_count), 0) AS total_upvotes_received_on_issues,
    COALESCE(SUM(g.upvote_count), 0) AS total_upvotes_received_on_groups
FROM users u
LEFT JOIN issues i ON u.user_id = i.user_id
LEFT JOIN groups g ON u.user_id = g.owner_id
LEFT JOIN comments c ON u.user_id = c.user_id
LEFT JOIN issue_upvotes iu ON u.user_id = iu.user_id
LEFT JOIN group_upvotes gu ON u.user_id = gu.user_id
GROUP BY u.user_id, u.username, u.full_name;

-- Permissions for views
ALTER VIEW v_issues_detailed OWNER TO postgres;
ALTER VIEW v_groups_detailed OWNER TO postgres;
ALTER VIEW v_users_with_roles OWNER TO postgres;
ALTER VIEW v_comments_detailed OWNER TO postgres;
ALTER VIEW v_group_comments_detailed OWNER TO postgres;
ALTER VIEW v_pending_role_requests OWNER TO postgres;
ALTER VIEW v_pending_group_join_requests OWNER TO postgres;
ALTER VIEW v_popular_issues OWNER TO postgres;
ALTER VIEW v_recent_activity OWNER TO postgres;
ALTER VIEW v_user_activity_summary OWNER TO postgres;

GRANT ALL ON v_issues_detailed TO postgres;
GRANT ALL ON v_groups_detailed TO postgres;
GRANT ALL ON v_users_with_roles TO postgres;
GRANT ALL ON v_comments_detailed TO postgres;
GRANT ALL ON v_group_comments_detailed TO postgres;
GRANT ALL ON v_pending_role_requests TO postgres;
GRANT ALL ON v_pending_group_join_requests TO postgres;
GRANT ALL ON v_popular_issues TO postgres;
GRANT ALL ON v_recent_activity TO postgres;
GRANT ALL ON v_user_activity_summary TO postgres;


-- ============================================================================
-- STORED PROCEDURES AND FUNCTIONS
-- ============================================================================

-- DROP FUNCTION public.add_comment(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.add_comment(p_issue_id uuid, p_user_id uuid, p_content text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
    new_comment_id UUID;
BEGIN
    INSERT INTO comments(issue_id, user_id, content)
    VALUES (p_issue_id, p_user_id, p_content)
    RETURNING comment_id INTO new_comment_id;

    RETURN new_comment_id;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.add_comment(uuid, uuid, text) OWNER TO postgres;
GRANT ALL ON FUNCTION public.add_comment(uuid, uuid, text) TO postgres;

-- DROP FUNCTION public.add_post_attachment(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.add_post_attachment(p_issue_id uuid, p_uploaded_by uuid, p_file_path text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
    new_attachment_id UUID;
BEGIN
    INSERT INTO post_attachments(issue_id, uploaded_by, file_path)
    VALUES (p_issue_id, p_uploaded_by, p_file_path)
    RETURNING attachment_id INTO new_attachment_id;

    RETURN new_attachment_id;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.add_post_attachment(uuid, uuid, text) OWNER TO postgres;
GRANT ALL ON FUNCTION public.add_post_attachment(uuid, uuid, text) TO postgres;

-- DROP PROCEDURE public.cancel_group_join_request(uuid, uuid);

CREATE OR REPLACE PROCEDURE public.cancel_group_join_request(p_req_id uuid, p_performer_user_id uuid)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
    v_issue_id UUID;
    v_group_id UUID;
    v_requested_by_group BOOLEAN;
    v_issue_author UUID;
    v_group_owner UUID;
BEGIN
    -- Use view for request details
    SELECT issue_id, group_id, requested_by_group
    INTO v_issue_id, v_group_id, v_requested_by_group
    FROM group_join_request
    WHERE req_id = p_req_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'group_join_request % not found', p_req_id;
    END IF;

    SELECT user_id INTO v_issue_author FROM issues WHERE issue_id = v_issue_id;
    SELECT owner_id INTO v_group_owner FROM groups WHERE group_id = v_group_id;

    IF p_performer_user_id IS NULL THEN
        RAISE EXCEPTION 'performer user id is required';
    END IF;

    -- Authorization: allow the issue author or group owner to cancel (either side)
    IF v_requested_by_group THEN
        -- Request made by group owner; allow group owner or issue author to cancel
        IF p_performer_user_id <> v_issue_author AND p_performer_user_id <> v_group_owner THEN
            RAISE EXCEPTION 'user % not authorized to cancel request %', p_performer_user_id, p_req_id;
        END IF;
    ELSE
        -- Request made by issue author; allow issue author or group owner to cancel
        IF p_performer_user_id <> v_group_owner AND p_performer_user_id <> v_issue_author THEN
            RAISE EXCEPTION 'user % not authorized to cancel request %', p_performer_user_id, p_req_id;
        END IF;
    END IF;

    UPDATE group_join_request
    SET status = 'cancelled',
        handled_at = NOW()
    WHERE req_id = p_req_id;
END;
$procedure$
;

-- Permissions

ALTER PROCEDURE public.cancel_group_join_request(uuid, uuid) OWNER TO postgres;
GRANT ALL ON PROCEDURE public.cancel_group_join_request(uuid, uuid) TO postgres;

-- DROP FUNCTION public.create_group(uuid, text, text);

CREATE OR REPLACE FUNCTION public.create_group(p_owner_id uuid, p_name text, p_description text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
    new_group_id UUID;
BEGIN
    INSERT INTO groups(owner_id, name, description)
    VALUES (p_owner_id, p_name, p_description)
    RETURNING group_id INTO new_group_id;

    RETURN new_group_id;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.create_group(uuid, text, text) OWNER TO postgres;
GRANT ALL ON FUNCTION public.create_group(uuid, text, text) TO postgres;

-- DROP FUNCTION public.create_issue(uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION public.create_issue(p_user_id uuid, p_title text, p_description text, p_group_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
    new_issue_id UUID;
BEGIN
    INSERT INTO issues(user_id, title, description, group_id)
    VALUES (p_user_id, p_title, p_description, p_group_id)
    RETURNING issue_id INTO new_issue_id;

    RETURN new_issue_id;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.create_issue(uuid, text, text, uuid) OWNER TO postgres;
GRANT ALL ON FUNCTION public.create_issue(uuid, text, text, uuid) TO postgres;

-- DROP FUNCTION public.create_issue_with_attachments(uuid, text, text, uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public.create_issue_with_attachments(p_user_id uuid, p_title text, p_description text, p_group_id uuid DEFAULT NULL::uuid, p_display_picture_url text DEFAULT NULL::text, p_attachments jsonb DEFAULT '[]'::jsonb)
 RETURNS TABLE(issue_id uuid, title text, description text, user_id uuid, group_id uuid, display_picture_url text, upvote_count integer, comment_count integer, posted_at timestamp with time zone, attachments jsonb)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_issue_id uuid;
  att jsonb;
  v_attachments jsonb := '[]'::jsonb;
  v_attachment record;
BEGIN
  -- Create the issue
  INSERT INTO issues(user_id, title, description, group_id, display_picture_url, upvote_count, comment_count)
  VALUES (p_user_id, p_title, p_description, p_group_id, p_display_picture_url, 0, 0)
  RETURNING issues.issue_id INTO v_issue_id;

  -- Insert attachments if any
  FOR att IN SELECT * FROM jsonb_array_elements(p_attachments)
  LOOP
    INSERT INTO post_attachments (issue_id, uploaded_by, file_path)
    VALUES (
      v_issue_id, 
      (att->>'uploaded_by')::uuid, 
      att->>'file_path'
    )
    RETURNING 
      post_attachments.attachment_id,
      post_attachments.file_path,
      post_attachments.created_at
    INTO v_attachment;
    
    -- Build attachments array
    v_attachments := v_attachments || jsonb_build_object(
      'attachment_id', v_attachment.attachment_id,
      'file_path', v_attachment.file_path,
      'created_at', v_attachment.created_at
    );
  END LOOP;

  -- Return the created issue with attachments
  RETURN QUERY 
  SELECT 
    v_issue_id,
    p_title,
    p_description,
    p_user_id,
    p_group_id,
    p_display_picture_url,
    0::int,
    0::int,
    NOW(),
    v_attachments;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.create_issue_with_attachments(uuid, text, text, uuid, text, jsonb) OWNER TO postgres;
GRANT ALL ON FUNCTION public.create_issue_with_attachments(uuid, text, text, uuid, text, jsonb) TO postgres;

-- DROP FUNCTION public.create_role(text, text, int4);

CREATE OR REPLACE FUNCTION public.create_role(p_title text, p_description text, p_upvote_weight integer DEFAULT 1)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
    new_role_id UUID;
BEGIN
    INSERT INTO roles(title, description, upvote_weight)
    VALUES (p_title, p_description, p_upvote_weight)
    RETURNING role_id INTO new_role_id;

    RETURN new_role_id;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.create_role(text, text, int4) OWNER TO postgres;
GRANT ALL ON FUNCTION public.create_role(text, text, int4) TO postgres;

-- DROP FUNCTION public.create_user(uuid, text, text, uuid, text);

CREATE OR REPLACE FUNCTION public.create_user(p_user_id uuid, p_email text, p_full_name text, p_role_id uuid, p_username text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
    new_user_id UUID;
BEGIN
    INSERT INTO users(user_id, email, full_name, role_id, username)
    VALUES (p_user_id, p_email, p_full_name, p_role_id, p_username)
    RETURNING user_id INTO new_user_id;

    RETURN new_user_id;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.create_user(uuid, text, text, uuid, text) OWNER TO postgres;
GRANT ALL ON FUNCTION public.create_user(uuid, text, text, uuid, text) TO postgres;

-- DROP FUNCTION public.delete_attachment(uuid);

CREATE OR REPLACE FUNCTION public.delete_attachment(p_attachment_id uuid)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  deleted_path TEXT;
BEGIN
  SELECT file_path INTO deleted_path FROM post_attachments WHERE attachment_id = p_attachment_id;
  DELETE FROM post_attachments WHERE attachment_id = p_attachment_id;
  RETURN deleted_path;  -- Edge function will use this to delete from storage
END;
$function$
;

-- Permissions

ALTER FUNCTION public.delete_attachment(uuid) OWNER TO postgres;
GRANT ALL ON FUNCTION public.delete_attachment(uuid) TO postgres;

-- DROP FUNCTION public.get_attachment(uuid);

CREATE OR REPLACE FUNCTION public.get_attachment(p_attachment_id uuid)
 RETURNS TABLE(attachment_id uuid, issue_id uuid, uploaded_by uuid, file_path text, created_at timestamp with time zone)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
    SELECT attachment_id, issue_id, uploaded_by, file_path, created_at
    FROM post_attachments
    WHERE attachment_id = p_attachment_id;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.get_attachment(uuid) OWNER TO postgres;
GRANT ALL ON FUNCTION public.get_attachment(uuid) TO postgres;

-- DROP FUNCTION public.is_username_taken(text);

CREATE OR REPLACE FUNCTION public.is_username_taken(p_username text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
DECLARE
    exists_bool BOOLEAN;
BEGIN
    SELECT EXISTS(
        SELECT 1 FROM users WHERE username = p_username
    ) INTO exists_bool;

    RETURN exists_bool;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.is_username_taken(text) OWNER TO postgres;
GRANT ALL ON FUNCTION public.is_username_taken(text) TO postgres;

-- DROP FUNCTION public.owner_requests_issue_to_add(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.owner_requests_issue_to_add(p_issue_id uuid, p_group_id uuid, p_group_owner_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
    new_req_id UUID;
BEGIN
    INSERT INTO group_join_request(issue_id, group_id, requester_id)
    VALUES (p_issue_id, p_group_id, p_group_owner_id)
    RETURNING req_id INTO new_req_id;

    RETURN new_req_id;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.owner_requests_issue_to_add(uuid, uuid, uuid) OWNER TO postgres;
GRANT ALL ON FUNCTION public.owner_requests_issue_to_add(uuid, uuid, uuid) TO postgres;

-- DROP PROCEDURE public.process_group_join_request(uuid, varchar);

CREATE OR REPLACE PROCEDURE public.process_group_join_request(p_req_id uuid, p_status character varying)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
    v_issue_id UUID;
    v_group_id UUID;
BEGIN
    -- Get issue_id and group_id for the request
    SELECT issue_id, group_id
    INTO v_issue_id, v_group_id
    FROM group_join_request
    WHERE req_id = p_req_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request % not found', p_req_id;
    END IF;

    -- Update request status and processed timestamp
    UPDATE group_join_request
    SET status = p_status,
        handled_at = NOW()
    WHERE req_id = p_req_id;

    -- If approved, update the issue's group_id
    IF p_status = 'approved' THEN
        UPDATE issues
        SET group_id = v_group_id
        WHERE issue_id = v_issue_id;
    END IF;
END;
$procedure$
;

-- Permissions

ALTER PROCEDURE public.process_group_join_request(uuid, varchar) OWNER TO postgres;
GRANT ALL ON PROCEDURE public.process_group_join_request(uuid, varchar) TO postgres;

-- DROP PROCEDURE public.process_role_change_request(uuid, text);

CREATE OR REPLACE PROCEDURE public.process_role_change_request(p_req_id uuid, p_status text)
 LANGUAGE plpgsql
AS $procedure$
DECLARE
    v_user_id UUID;
    v_role_id UUID;
BEGIN
    -- Use view to get request details
    SELECT user_id, requested_role_id
    INTO v_user_id, v_role_id
    FROM v_pending_role_requests
    WHERE req_id = p_req_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Role change request % not found', p_req_id;
    END IF;

    UPDATE role_change_request
    SET status = p_status,
        reviewed_at = NOW()
    WHERE req_id = p_req_id;

    IF p_status = 'approved' THEN
        UPDATE users
        SET role_id = v_role_id
        WHERE user_id = v_user_id;
    END IF;
END;
$procedure$
;

-- Permissions

ALTER PROCEDURE public.process_role_change_request(uuid, text) OWNER TO postgres;
GRANT ALL ON PROCEDURE public.process_role_change_request(uuid, text) TO postgres;

-- DROP PROCEDURE public.remove_group_upvote(uuid, uuid);

CREATE OR REPLACE PROCEDURE public.remove_group_upvote(p_group_id uuid, p_user_id uuid)
 LANGUAGE plpgsql
AS $procedure$
BEGIN
    -- Just delete the upvote; trigger will handle count decrement
    DELETE FROM group_upvotes
    WHERE group_id = p_group_id
      AND user_id = p_user_id;
END;
$procedure$
;

-- Permissions

ALTER PROCEDURE public.remove_group_upvote(uuid, uuid) OWNER TO postgres;
GRANT ALL ON PROCEDURE public.remove_group_upvote(uuid, uuid) TO postgres;

-- DROP PROCEDURE public.remove_post_upvote(uuid, uuid);

CREATE OR REPLACE PROCEDURE public.remove_post_upvote(p_issue_id uuid, p_user_id uuid)
 LANGUAGE plpgsql
AS $procedure$
BEGIN
    -- Just delete the upvote; trigger will handle count decrement
    DELETE FROM issue_upvotes
    WHERE issue_id = p_issue_id
      AND user_id = p_user_id;
    -- Note: upvote_count update removed - trigger handles it now
END;
$procedure$
;

-- Permissions

ALTER PROCEDURE public.remove_post_upvote(uuid, uuid) OWNER TO postgres;
GRANT ALL ON PROCEDURE public.remove_post_upvote(uuid, uuid) TO postgres;

-- DROP FUNCTION public.submit_group_join_request(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.submit_group_join_request(p_issue_id uuid, p_group_id uuid, p_requester_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
    new_req_id UUID;
BEGIN
    INSERT INTO group_join_request(issue_id, group_id, requester_id)
    VALUES (p_issue_id, p_group_id, p_requester_id)
    RETURNING req_id INTO new_req_id;

    RETURN new_req_id;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.submit_group_join_request(uuid, uuid, uuid) OWNER TO postgres;
GRANT ALL ON FUNCTION public.submit_group_join_request(uuid, uuid, uuid) TO postgres;

-- DROP FUNCTION public.submit_role_change_request(uuid, uuid, uuid);

CREATE OR REPLACE FUNCTION public.submit_role_change_request(p_user_id uuid, p_requested_role_id uuid, p_admin_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
    new_req_id UUID;
BEGIN
    INSERT INTO role_change_request(user_id, requested_role_id, reviewed_by_admin)
    VALUES (p_user_id, p_requested_role_id, p_admin_id)
    RETURNING req_id INTO new_req_id;

    RETURN new_req_id;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.submit_role_change_request(uuid, uuid, uuid) OWNER TO postgres;
GRANT ALL ON FUNCTION public.submit_role_change_request(uuid, uuid, uuid) TO postgres;

-- DROP FUNCTION public.toggle_group_upvote(uuid, uuid);

CREATE OR REPLACE FUNCTION public.toggle_group_upvote(p_group_id uuid, p_user_id uuid)
 RETURNS TABLE(upvoted boolean, upvote_count integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  existing_upvote_id uuid;
  final_count int;
BEGIN
  -- Check if upvote already exists
  SELECT group_upvote_id INTO existing_upvote_id 
  FROM group_upvotes 
  WHERE group_id = p_group_id AND user_id = p_user_id;

  IF existing_upvote_id IS NOT NULL THEN
    -- Remove upvote (trigger will decrement count)
    DELETE FROM group_upvotes WHERE group_upvote_id = existing_upvote_id;
    
    -- Get updated count
    SELECT g.upvote_count INTO final_count FROM groups g WHERE g.group_id = p_group_id;
    
    -- Return false (not upvoted) and new count
    RETURN QUERY SELECT false, COALESCE(final_count, 0);
  ELSE
    -- Add upvote (trigger will set weight and increment count)
    INSERT INTO group_upvotes (group_id, user_id) 
    VALUES (p_group_id, p_user_id);
    
    -- Get updated count
    SELECT g.upvote_count INTO final_count FROM groups g WHERE g.group_id = p_group_id;
    
    -- Return true (upvoted) and new count
    RETURN QUERY SELECT true, COALESCE(final_count, 0);
  END IF;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.toggle_group_upvote(uuid, uuid) OWNER TO postgres;
GRANT ALL ON FUNCTION public.toggle_group_upvote(uuid, uuid) TO postgres;

-- DROP FUNCTION public.toggle_issue_upvote(uuid, uuid);

CREATE OR REPLACE FUNCTION public.toggle_issue_upvote(p_issue_id uuid, p_user_id uuid)
 RETURNS TABLE(upvoted boolean, upvote_count integer)
 LANGUAGE plpgsql
AS $function$
DECLARE
  existing_upvote_id uuid;
  final_count int;
BEGIN
  -- Check if upvote already exists
  SELECT upvote_id INTO existing_upvote_id 
  FROM issue_upvotes 
  WHERE issue_id = p_issue_id AND user_id = p_user_id;

  IF existing_upvote_id IS NOT NULL THEN
    -- Remove upvote (trigger will decrement count)
    DELETE FROM issue_upvotes WHERE upvote_id = existing_upvote_id;
    
    -- Get updated count
    SELECT i.upvote_count INTO final_count FROM issues i WHERE i.issue_id = p_issue_id;
    
    -- Return false (not upvoted) and new count
    RETURN QUERY SELECT false, COALESCE(final_count, 0);
  ELSE
    -- Add upvote (trigger will set weight and increment count)
    INSERT INTO issue_upvotes (issue_id, user_id) 
    VALUES (p_issue_id, p_user_id);
    
    -- Get updated count
    SELECT i.upvote_count INTO final_count FROM issues i WHERE i.issue_id = p_issue_id;
    
    -- Return true (upvoted) and new count
    RETURN QUERY SELECT true, COALESCE(final_count, 0);
  END IF;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.toggle_issue_upvote(uuid, uuid) OWNER TO postgres;
GRANT ALL ON FUNCTION public.toggle_issue_upvote(uuid, uuid) TO postgres;

-- DROP FUNCTION public.trg_dec_group_comment_count();

CREATE OR REPLACE FUNCTION public.trg_dec_group_comment_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE groups SET comment_count = GREATEST(COALESCE(comment_count, 0) - 1, 0)
  WHERE group_id = OLD.group_id;
  RETURN OLD;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.trg_dec_group_comment_count() OWNER TO postgres;
GRANT ALL ON FUNCTION public.trg_dec_group_comment_count() TO postgres;

-- DROP FUNCTION public.trg_dec_issue_comment_count();

CREATE OR REPLACE FUNCTION public.trg_dec_issue_comment_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE issues SET comment_count = GREATEST(COALESCE(comment_count, 0) - 1, 0)
  WHERE issue_id = OLD.issue_id;
  RETURN OLD;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.trg_dec_issue_comment_count() OWNER TO postgres;
GRANT ALL ON FUNCTION public.trg_dec_issue_comment_count() TO postgres;

-- DROP FUNCTION public.trg_delete_issue_group_count();

CREATE OR REPLACE FUNCTION public.trg_delete_issue_group_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.group_id IS NOT NULL THEN
    UPDATE groups 
    SET issue_count = GREATEST(issue_count - 1, 0) 
    WHERE group_id = OLD.group_id;
  END IF;
  RETURN OLD;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.trg_delete_issue_group_count() OWNER TO postgres;
GRANT ALL ON FUNCTION public.trg_delete_issue_group_count() TO postgres;

-- DROP FUNCTION public.trg_group_upvote_after_delete();

CREATE OR REPLACE FUNCTION public.trg_group_upvote_after_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  w int := COALESCE(OLD.upvote_weight, 1);
BEGIN
  -- Decrement the group's upvote count
  UPDATE groups 
  SET upvote_count = GREATEST(COALESCE(upvote_count, 0) - w, 0)
  WHERE group_id = OLD.group_id;
  
  RETURN OLD;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.trg_group_upvote_after_delete() OWNER TO postgres;
GRANT ALL ON FUNCTION public.trg_group_upvote_after_delete() TO postgres;

-- DROP FUNCTION public.trg_group_upvote_after_insert();

CREATE OR REPLACE FUNCTION public.trg_group_upvote_after_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  w int;
BEGIN
  -- Get the user's current role weight
  SELECT r.upvote_weight INTO w
  FROM users u 
  JOIN roles r ON u.role_id = r.role_id
  WHERE u.user_id = NEW.user_id;
  
  -- Default to 1 if role not found
  IF w IS NULL THEN 
    w := 1; 
  END IF;
  
  -- Store the weight on the upvote record
  NEW.upvote_weight := w;

  -- Increment the group's upvote count
  UPDATE groups 
  SET upvote_count = COALESCE(upvote_count, 0) + w
  WHERE group_id = NEW.group_id;

  RETURN NEW;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.trg_group_upvote_after_insert() OWNER TO postgres;
GRANT ALL ON FUNCTION public.trg_group_upvote_after_insert() TO postgres;

-- DROP FUNCTION public.trg_inc_group_comment_count();

CREATE OR REPLACE FUNCTION public.trg_inc_group_comment_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE groups SET comment_count = COALESCE(comment_count, 0) + 1
  WHERE group_id = NEW.group_id;
  RETURN NEW;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.trg_inc_group_comment_count() OWNER TO postgres;
GRANT ALL ON FUNCTION public.trg_inc_group_comment_count() TO postgres;

-- DROP FUNCTION public.trg_inc_group_issue_count_on_insert();

CREATE OR REPLACE FUNCTION public.trg_inc_group_issue_count_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.group_id IS NOT NULL THEN
    UPDATE groups 
    SET issue_count = issue_count + 1 
    WHERE group_id = NEW.group_id;
  END IF;
  RETURN NEW;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.trg_inc_group_issue_count_on_insert() OWNER TO postgres;
GRANT ALL ON FUNCTION public.trg_inc_group_issue_count_on_insert() TO postgres;

-- DROP FUNCTION public.trg_inc_issue_comment_count();

CREATE OR REPLACE FUNCTION public.trg_inc_issue_comment_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE issues SET comment_count = COALESCE(comment_count, 0) + 1
  WHERE issue_id = NEW.issue_id;
  RETURN NEW;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.trg_inc_issue_comment_count() OWNER TO postgres;
GRANT ALL ON FUNCTION public.trg_inc_issue_comment_count() TO postgres;

-- DROP FUNCTION public.trg_issue_upvote_after_delete();

CREATE OR REPLACE FUNCTION public.trg_issue_upvote_after_delete()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  w int := COALESCE(OLD.upvote_weight, 1);
BEGIN
  -- Decrement the issue's upvote count
  UPDATE issues 
  SET upvote_count = GREATEST(COALESCE(upvote_count, 0) - w, 0)
  WHERE issue_id = OLD.issue_id;
  
  RETURN OLD;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.trg_issue_upvote_after_delete() OWNER TO postgres;
GRANT ALL ON FUNCTION public.trg_issue_upvote_after_delete() TO postgres;

-- DROP FUNCTION public.trg_issue_upvote_after_insert();

CREATE OR REPLACE FUNCTION public.trg_issue_upvote_after_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  w int;
BEGIN
  -- Get the user's current role weight
  SELECT r.upvote_weight INTO w
  FROM users u 
  JOIN roles r ON u.role_id = r.role_id
  WHERE u.user_id = NEW.user_id;
  
  -- Default to 1 if role not found
  IF w IS NULL THEN 
    w := 1; 
  END IF;
  
  -- Store the weight on the upvote record
  NEW.upvote_weight := w;

  -- Increment the issue's upvote count
  UPDATE issues 
  SET upvote_count = COALESCE(upvote_count, 0) + w
  WHERE issue_id = NEW.issue_id;

  RETURN NEW;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.trg_issue_upvote_after_insert() OWNER TO postgres;
GRANT ALL ON FUNCTION public.trg_issue_upvote_after_insert() TO postgres;

-- DROP FUNCTION public.trg_update_issue_group_count();

CREATE OR REPLACE FUNCTION public.trg_update_issue_group_count()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Decrement old group if it exists
  IF OLD.group_id IS NOT NULL THEN
    UPDATE groups 
    SET issue_count = GREATEST(issue_count - 1, 0) 
    WHERE group_id = OLD.group_id;
  END IF;
  
  -- Increment new group if it exists
  IF NEW.group_id IS NOT NULL THEN
    UPDATE groups 
    SET issue_count = issue_count + 1 
    WHERE group_id = NEW.group_id;
  END IF;
  
  RETURN NEW;
END;
$function$
;

-- Permissions

ALTER FUNCTION public.trg_update_issue_group_count() OWNER TO postgres;
GRANT ALL ON FUNCTION public.trg_update_issue_group_count() TO postgres;

-- DROP PROCEDURE public.upvote_group(uuid, uuid);

CREATE OR REPLACE PROCEDURE public.upvote_group(p_group_id uuid, p_user_id uuid)
 LANGUAGE plpgsql
AS $procedure$
BEGIN
    -- Just insert the upvote; trigger will handle count increment
    INSERT INTO group_upvotes(group_id, user_id)
    VALUES (p_group_id, p_user_id)
    ON CONFLICT (group_id, user_id) DO NOTHING;
END;
$procedure$
;

-- Permissions

ALTER PROCEDURE public.upvote_group(uuid, uuid) OWNER TO postgres;
GRANT ALL ON PROCEDURE public.upvote_group(uuid, uuid) TO postgres;

-- DROP PROCEDURE public.upvote_issue(uuid, uuid);

CREATE OR REPLACE PROCEDURE public.upvote_issue(p_issue_id uuid, p_user_id uuid)
 LANGUAGE plpgsql
AS $procedure$
BEGIN
    -- Just insert the upvote; trigger will handle count increment
    INSERT INTO issue_upvotes(issue_id, user_id)
    VALUES (p_issue_id, p_user_id)
    ON CONFLICT (issue_id, user_id) DO NOTHING;
    -- Note: upvote_count update removed - trigger handles it now
END;
$procedure$
;

-- Permissions

ALTER PROCEDURE public.upvote_issue(uuid, uuid) OWNER TO postgres;
GRANT ALL ON PROCEDURE public.upvote_issue(uuid, uuid) TO postgres;


-- ============================================================================
-- COMMIT TRANSACTION
-- ============================================================================

-- Commit all schema changes
COMMIT;

-- Permissions;