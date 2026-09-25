-- "View as" role preview: a super admin can lower their own session's
-- effective role (never raise it) to test what managers/admins see.
ALTER TABLE sessions ADD COLUMN act_role TEXT;
