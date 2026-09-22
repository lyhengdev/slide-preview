-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityEventType" ADD VALUE 'SCREENSHOT_BLOCKED';
ALTER TYPE "SecurityEventType" ADD VALUE 'SCREENSHOT_UNBLOCKED';
ALTER TYPE "SecurityEventType" ADD VALUE 'MULTI_TAB_OPEN';

-- AlterTable
ALTER TABLE "EventSecuritySettings" ADD COLUMN     "overrideDetectionAction" "DetectionAction";
