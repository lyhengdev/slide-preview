/*
  Warnings:

  - You are about to drop the `Score` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ScoreCriterion` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Score" DROP CONSTRAINT "Score_criterionId_fkey";

-- DropForeignKey
ALTER TABLE "Score" DROP CONSTRAINT "Score_eventId_fkey";

-- DropForeignKey
ALTER TABLE "Score" DROP CONSTRAINT "Score_judgeId_fkey";

-- DropForeignKey
ALTER TABLE "Score" DROP CONSTRAINT "Score_startupId_fkey";

-- DropForeignKey
ALTER TABLE "ScoreCriterion" DROP CONSTRAINT "ScoreCriterion_eventId_fkey";

-- AlterTable
ALTER TABLE "Slide" ADD COLUMN     "previewPath" TEXT,
ADD COLUMN     "standardPath" TEXT;

-- DropTable
DROP TABLE "Score";

-- DropTable
DROP TABLE "ScoreCriterion";
