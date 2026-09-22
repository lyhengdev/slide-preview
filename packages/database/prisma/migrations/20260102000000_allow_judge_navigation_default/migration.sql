-- Align the migration default with the Prisma schema default so fresh
-- databases and new events both allow judges to browse slides by default.
ALTER TABLE "EventSecuritySettings" ALTER COLUMN "allowJudgeNavigation" SET DEFAULT true;