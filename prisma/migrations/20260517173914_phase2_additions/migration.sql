-- AlterTable
ALTER TABLE "thread_notes" ADD COLUMN     "thread_url" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "daily_digest_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "last_daily_digest_at" TIMESTAMP(3),
ADD COLUMN     "last_weekly_digest_at" TIMESTAMP(3),
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
ADD COLUMN     "weekly_digest_enabled" BOOLEAN NOT NULL DEFAULT true;
