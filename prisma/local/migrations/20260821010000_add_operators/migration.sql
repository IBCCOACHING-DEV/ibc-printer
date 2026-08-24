-- CreateTable
CREATE TABLE "operators" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "remote_user_id" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 3,
    "course_type" INTEGER NOT NULL DEFAULT 0,
    "authentication_token" TEXT,
    "synced_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "operators_remote_user_id_key" ON "operators"("remote_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "operators_email_key" ON "operators"("email");
