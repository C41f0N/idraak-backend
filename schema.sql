-- DROP SCHEMA public;

CREATE SCHEMA public AUTHORIZATION pg_database_owner;
-- public."admin" definition

-- Drop table

-- DROP TABLE public."admin";

CREATE TABLE public."admin" (
	admin_id uuid DEFAULT gen_random_uuid() NOT NULL,
	first_name varchar(50) NOT NULL,
	last_name varchar(50) NOT NULL,
	CONSTRAINT admin_pkey PRIMARY KEY (admin_id)
);


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
	CONSTRAINT users_email_key UNIQUE (email),
	CONSTRAINT users_pkey PRIMARY KEY (user_id),
	CONSTRAINT users_username_key UNIQUE (username),
	CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(role_id)
);


-- public."groups" definition

-- Drop table

-- DROP TABLE public."groups";

CREATE TABLE public."groups" (
	group_id uuid DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	description text NULL,
	owner_id uuid NOT NULL,
	created_at timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT groups_pkey PRIMARY KEY (group_id),
	CONSTRAINT groups_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(user_id) ON DELETE CASCADE
);


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
	CONSTRAINT issues_pkey PRIMARY KEY (issue_id),
	CONSTRAINT issues_group_id_fkey FOREIGN KEY (group_id) REFERENCES public."groups"(group_id) ON DELETE SET NULL,
	CONSTRAINT issues_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE
);


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


-- public.group_upvotes definition

-- Drop table

-- DROP TABLE public.group_upvotes;

CREATE TABLE public.group_upvotes (
	group_upvote_id uuid DEFAULT gen_random_uuid() NOT NULL,
	group_id uuid NOT NULL,
	user_id uuid NOT NULL,
	made_at timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT group_upvotes_group_id_user_id_key UNIQUE (group_id, user_id),
	CONSTRAINT group_upvotes_pkey PRIMARY KEY (group_upvote_id),
	CONSTRAINT group_upvotes_group_id_fkey FOREIGN KEY (group_id) REFERENCES public."groups"(group_id) ON DELETE CASCADE,
	CONSTRAINT group_upvotes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE
);


-- public.issue_upvotes definition

-- Drop table

-- DROP TABLE public.issue_upvotes;

CREATE TABLE public.issue_upvotes (
	upvote_id uuid DEFAULT gen_random_uuid() NOT NULL,
	issue_id uuid NOT NULL,
	user_id uuid NOT NULL,
	made_at timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT issue_upvotes_issue_id_user_id_key UNIQUE (issue_id, user_id),
	CONSTRAINT issue_upvotes_pkey PRIMARY KEY (upvote_id),
	CONSTRAINT issue_upvotes_issue_id_fkey FOREIGN KEY (issue_id) REFERENCES public.issues(issue_id) ON DELETE CASCADE,
	CONSTRAINT issue_upvotes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(user_id) ON DELETE CASCADE
);



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

-- DROP FUNCTION public.cancel_group_join_request(uuid, uuid);

CREATE OR REPLACE FUNCTION public.cancel_group_join_request(p_req_id uuid, p_performer_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_issue_id UUID;
    v_group_id UUID;
    v_requested_by_user BOOLEAN;
    v_issue_author UUID;
    v_group_owner UUID;
BEGIN
    SELECT issue_id, group_id, requested_by_user
    INTO v_issue_id, v_group_id, v_requested_by_user
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
    IF v_requested_by_user THEN
        -- Request made by issue author; allow issue author or group owner to cancel
        IF p_performer_user_id <> v_issue_author AND p_performer_user_id <> v_group_owner THEN
            RAISE EXCEPTION 'user % not authorized to cancel request %', p_performer_user_id, p_req_id;
        END IF;
    ELSE
        -- Request made by group owner; allow group owner or issue author to cancel
        IF p_performer_user_id <> v_group_owner AND p_performer_user_id <> v_issue_author THEN
            RAISE EXCEPTION 'user % not authorized to cancel request %', p_performer_user_id, p_req_id;
        END IF;
    END IF;

    UPDATE group_join_request
    SET status = 'cancelled',
        handled_at = NOW()
    WHERE req_id = p_req_id;
END;
$function$
;

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

-- DROP FUNCTION public.process_group_join_request(uuid, varchar);

CREATE OR REPLACE FUNCTION public.process_group_join_request(p_req_id uuid, p_status character varying)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_issue_id UUID;
    v_group_id UUID;
BEGIN
    -- Get issue_id and group_id for the request
    SELECT issue_id, group_id
    INTO v_issue_id, v_group_id
    FROM group_join_request
    WHERE req_id = p_req_id;

    -- Update request status and processed timestamp
    UPDATE group_join_request
    SET status = p_status,
        processed_at = NOW()
    WHERE req_id = p_req_id;

    -- If approved, add the post to the group
    IF p_status = 'approved' THEN
        INSERT INTO group_posts(group_id, post_id)
        VALUES (v_group_id, v_issue_id)
        ON CONFLICT (group_id, post_id) DO NOTHING;
    END IF;
END;
$function$
;

-- DROP FUNCTION public.process_role_change_request(uuid, text);

CREATE OR REPLACE FUNCTION public.process_role_change_request(p_req_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_user_id UUID;
    v_role_id UUID;
BEGIN
    SELECT user_id, requested_role_id
    INTO v_user_id, v_role_id
    FROM role_change_request
    WHERE req_id = p_req_id;

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
$function$
;

-- DROP FUNCTION public.remove_group_upvote(uuid, uuid);

CREATE OR REPLACE FUNCTION public.remove_group_upvote(p_group_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
    DELETE FROM group_upvotes
    WHERE group_id = p_group_id
      AND user_id = p_user_id;
END;
$function$
;

-- DROP FUNCTION public.remove_post_upvote(uuid, uuid);

CREATE OR REPLACE FUNCTION public.remove_post_upvote(p_issue_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Delete the upvote record
    DELETE FROM issue_upvotes
    WHERE issue_id = p_issue_id
      AND user_id = p_user_id;

    -- Decrement the upvote count on the post
    UPDATE issues
    SET upvote_count = GREATEST(upvote_count - 1, 0)
    WHERE issue_id = p_issue_id;
END;
$function$
;

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

-- DROP FUNCTION public.upvote_group(uuid, uuid);

CREATE OR REPLACE FUNCTION public.upvote_group(p_group_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
    INSERT INTO group_upvotes(group_id, user_id)
    VALUES (p_group_id, p_user_id)
    ON CONFLICT (group_id, user_id) DO NOTHING;
END;
$function$
;

-- DROP FUNCTION public.upvote_issue(uuid, uuid);

CREATE OR REPLACE FUNCTION public.upvote_issue(p_issue_id uuid, p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
    INSERT INTO issue_upvotes(issue_id, user_id)
    VALUES (p_issue_id, p_user_id)
    ON CONFLICT (issue_id, user_id) DO NOTHING;

    UPDATE issues
    SET upvote_count = upvote_count + 1
    WHERE issue_id = p_issue_id;
END;
$function$
;