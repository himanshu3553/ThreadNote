-- CreateTable
CREATE TABLE "installations" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "team_name" TEXT,
    "bot_token" TEXT NOT NULL,
    "bot_user_id" TEXT,
    "bot_id" TEXT,
    "app_id" TEXT,
    "installed_by_user_id" TEXT,
    "installed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "installations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "installations_team_id_key" ON "installations"("team_id");
