# Database Migrations - SQL Features for Course Project

This directory contains SQL migrations that add advanced database features including **triggers**, **stored procedures**, and **transactions** to maximize SQL usage for your database course project.

## What's Included

### 1. **Comment Count Triggers** (`001_triggers_comment_counts.sql`)
- Automatically maintains `comment_count` on `issues` and `groups` tables
- Triggers fire on INSERT and DELETE of comments
- **SQL Features**: Triggers, automatic counter maintenance

### 2. **Upvote Weight System** (`002_upvote_weight_and_triggers.sql`)
- Adds `upvote_weight` column to `issue_upvotes` and `group_upvotes`
- Stores user's role weight at time of upvote (preserves historical accuracy)
- Triggers automatically calculate and apply weights
- Updates `upvote_count` on issues/groups automatically
- **SQL Features**: ALTER TABLE, BEFORE/AFTER triggers, role-based weighting

### 3. **Toggle Upvote Functions** (`003_toggle_upvote_functions.sql`)
- `toggle_issue_upvote(issue_id, user_id)` - atomic upvote toggle
- `toggle_group_upvote(group_id, user_id)` - atomic group upvote toggle
- Single function call replaces multiple queries
- **SQL Features**: Stored procedures, RETURNS TABLE, atomic operations

### 4. **Create Issue with Attachments** (`004_create_issue_with_attachments.sql`)
- `create_issue_with_attachments()` - creates issue and attachments in one transaction
- Accepts JSONB array of attachments
- All-or-nothing operation (transaction rollback on error)
- **SQL Features**: Transactions, JSONB processing, complex stored procedures

### 5. **Group Issue Count** (`005_group_issue_count.sql`)
- Adds `issue_count` column to `groups` table
- Triggers maintain count when issues are added/removed/moved
- Eliminates expensive COUNT(*) queries
- **SQL Features**: Denormalized counters, UPDATE triggers with WHEN clause

## How to Apply Migrations

### Option 1: Run All at Once (Recommended)
```bash
cd idraak-backend
psql -h localhost -U your_username -d your_database -f apply_migrations.sql
```

### Option 2: Run Individually
```bash
cd idraak-backend/migrations

# Apply in order
psql -h localhost -U your_username -d your_database -f 001_triggers_comment_counts.sql
psql -h localhost -U your_username -d your_database -f 002_upvote_weight_and_triggers.sql
psql -h localhost -U your_username -d your_database -f 003_toggle_upvote_functions.sql
psql -h localhost -U your_username -d your_database -f 004_create_issue_with_attachments.sql
psql -h localhost -U your_username -d your_database -f 005_group_issue_count.sql
```

### Option 3: Using Environment Variables
```bash
cd idraak-backend

# Load your .env file or set these variables:
export DB_HOST=localhost
export DB_PORT=5432
export DB_USER=your_username
export DB_PASSWORD=your_password
export DB_NAME=your_database

# Run migrations
PGPASSWORD=$DB_PASSWORD psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -f apply_migrations.sql
```

## Backend Changes

The Node.js backend (`index.js`) has been updated to use these new SQL features:

1. **Upvote endpoints** now call `toggle_issue_upvote()` and `toggle_group_upvote()` functions
2. **Comment endpoints** no longer manually update counts (triggers handle it)
3. **Group queries** use the `issue_count` column instead of `COUNT(*)`

## SQL Features Demonstrated

This implementation showcases the following SQL concepts for your course:

- ✅ **Triggers** (BEFORE/AFTER INSERT/UPDATE/DELETE)
- ✅ **Stored Procedures/Functions** with RETURNS TABLE
- ✅ **Transactions** (implicit in stored procedures)
- ✅ **JSONB data type** and processing
- ✅ **Denormalized counters** with automatic maintenance
- ✅ **Role-based business logic** in database
- ✅ **Atomic operations** replacing multi-query patterns
- ✅ **ALTER TABLE** statements
- ✅ **Conditional triggers** (WHEN clause)
- ✅ **JOIN operations** in triggers

## Testing

After applying migrations:

1. **Test comment counts**: Create/delete comments and verify counts update automatically
2. **Test upvotes**: Toggle upvotes and verify weighted counts work correctly
3. **Test role changes**: Change a user's role and verify new upvotes use new weight
4. **Test group issue counts**: Add/remove issues from groups and verify counts
5. **Check triggers**: Query `pg_trigger` to see all active triggers

```sql
-- View all triggers
SELECT 
  trigger_name, 
  event_object_table, 
  action_timing, 
  event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table, trigger_name;

-- View all functions
SELECT 
  routine_name, 
  routine_type,
  data_type as return_type
FROM information_schema.routines
WHERE routine_schema = 'public'
AND routine_name LIKE '%trg_%' OR routine_name LIKE 'toggle_%' OR routine_name LIKE 'create_%'
ORDER BY routine_name;
```

## Rollback (if needed)

To remove these changes:

```sql
-- Drop triggers
DROP TRIGGER IF EXISTS trg_after_insert_comment ON comments;
DROP TRIGGER IF EXISTS trg_after_delete_comment ON comments;
DROP TRIGGER IF EXISTS trg_after_insert_group_comment ON group_comments;
DROP TRIGGER IF EXISTS trg_after_delete_group_comment ON group_comments;
DROP TRIGGER IF EXISTS trg_after_insert_issue_upvote ON issue_upvotes;
DROP TRIGGER IF EXISTS trg_after_delete_issue_upvote ON issue_upvotes;
DROP TRIGGER IF EXISTS trg_after_insert_group_upvote ON group_upvotes;
DROP TRIGGER IF EXISTS trg_after_delete_group_upvote ON group_upvotes;
DROP TRIGGER IF EXISTS trg_issue_insert_group_count ON issues;
DROP TRIGGER IF EXISTS trg_issue_update_group_count ON issues;
DROP TRIGGER IF EXISTS trg_issue_delete_group_count ON issues;

-- Drop functions
DROP FUNCTION IF EXISTS public.trg_inc_issue_comment_count();
DROP FUNCTION IF EXISTS public.trg_dec_issue_comment_count();
DROP FUNCTION IF EXISTS public.trg_inc_group_comment_count();
DROP FUNCTION IF EXISTS public.trg_dec_group_comment_count();
DROP FUNCTION IF EXISTS public.trg_issue_upvote_after_insert();
DROP FUNCTION IF EXISTS public.trg_issue_upvote_after_delete();
DROP FUNCTION IF EXISTS public.trg_group_upvote_after_insert();
DROP FUNCTION IF EXISTS public.trg_group_upvote_after_delete();
DROP FUNCTION IF EXISTS public.toggle_issue_upvote(uuid, uuid);
DROP FUNCTION IF EXISTS public.toggle_group_upvote(uuid, uuid);
DROP FUNCTION IF EXISTS public.create_issue_with_attachments(uuid, text, text, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.trg_inc_group_issue_count_on_insert();
DROP FUNCTION IF EXISTS public.trg_update_issue_group_count();
DROP FUNCTION IF EXISTS public.trg_delete_issue_group_count();

-- Remove columns
ALTER TABLE issue_upvotes DROP COLUMN IF EXISTS upvote_weight;
ALTER TABLE group_upvotes DROP COLUMN IF EXISTS upvote_weight;
ALTER TABLE groups DROP COLUMN IF EXISTS issue_count;
```

## Questions for Course Evaluation

When presenting this project, highlight:

1. **Why triggers?** - Maintain data integrity automatically, reduce application code
2. **Why stored procedures?** - Atomic operations, reduce network round-trips, centralize business logic
3. **Why denormalized counters?** - Performance optimization, avoid expensive aggregations
4. **Trade-offs** - Triggers add complexity, but ensure consistency even if DB is accessed outside the app

## Notes

- All migrations are idempotent where possible (use `IF NOT EXISTS`, `OR REPLACE`)
- Triggers use `COALESCE` to handle NULL values safely
- Functions return tables for easy integration with SELECT queries
- Weight values are stored to preserve historical accuracy
