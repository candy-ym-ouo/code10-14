-- CreateEnum
CREATE TYPE "PieceStatus" AS ENUM ('ACTIVE', 'MERGED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PieceMergeStatus" AS ENUM ('CONFLICTS_PENDING', 'RESOLVED');

-- CreateEnum
CREATE TYPE "MergeConflictField" AS ENUM ('KEY', 'DIFFICULTY', 'COMPOSER');

-- CreateEnum
CREATE TYPE "MergeConflictStatus" AS ENUM ('PENDING', 'KEEP_TARGET', 'USE_SOURCE', 'USE_CUSTOM', 'DISMISSED');

-- AlterTable
ALTER TABLE "practice_sessions" ADD COLUMN "piece_id" UUID;

-- CreateTable
CREATE TABLE "repertoire_pieces" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "composer" VARCHAR(160),
    "normalized_title" VARCHAR(160) NOT NULL,
    "normalized_composer" VARCHAR(160),
    "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "key_signature" VARCHAR(40),
    "difficulty" SMALLINT,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "status" "PieceStatus" NOT NULL DEFAULT 'ACTIVE',
    "merged_into_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 0,
    "practice_count" INTEGER NOT NULL DEFAULT 0,
    "total_practice_ms" BIGINT NOT NULL DEFAULT 0,
    "last_practiced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "repertoire_pieces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "piece_merge_jobs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "source_piece_id" UUID NOT NULL,
    "target_piece_id" UUID NOT NULL,
    "status" "PieceMergeStatus" NOT NULL DEFAULT 'CONFLICTS_PENDING',
    "migrated_sessions" INTEGER NOT NULL DEFAULT 0,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "piece_merge_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "piece_merge_conflicts" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "merge_job_id" UUID NOT NULL,
    "field" "MergeConflictField" NOT NULL,
    "source_value" VARCHAR(160),
    "target_value" VARCHAR(160),
    "status" "MergeConflictStatus" NOT NULL DEFAULT 'PENDING',
    "resolution" VARCHAR(160),
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "piece_merge_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "practice_sessions_piece_id_idx" ON "practice_sessions"("piece_id");

-- CreateIndex
CREATE INDEX "repertoire_pieces_user_id_status_updated_at_idx" ON "repertoire_pieces"("user_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "repertoire_pieces_user_id_difficulty_idx" ON "repertoire_pieces"("user_id", "difficulty");

-- CreateIndex
CREATE INDEX "repertoire_pieces_user_id_key_signature_idx" ON "repertoire_pieces"("user_id", "key_signature");

-- CreateIndex
CREATE INDEX "repertoire_pieces_user_id_last_practiced_at_idx" ON "repertoire_pieces"("user_id", "last_practiced_at" DESC);

-- CreateIndex
CREATE INDEX "repertoire_pieces_merged_into_id_idx" ON "repertoire_pieces"("merged_into_id");

-- CreateIndex
CREATE INDEX "piece_merge_jobs_user_id_status_created_at_idx" ON "piece_merge_jobs"("user_id", "status", "created_at" DESC);

-- CreateIndex
CREATE INDEX "piece_merge_jobs_target_piece_id_idx" ON "piece_merge_jobs"("target_piece_id");

-- CreateIndex
CREATE INDEX "piece_merge_conflicts_user_id_status_idx" ON "piece_merge_conflicts"("user_id", "status");

-- CreateIndex
CREATE INDEX "piece_merge_conflicts_merge_job_id_status_idx" ON "piece_merge_conflicts"("merge_job_id", "status");

-- AddForeignKey
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_piece_id_fkey" FOREIGN KEY ("piece_id") REFERENCES "repertoire_pieces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repertoire_pieces" ADD CONSTRAINT "repertoire_pieces_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repertoire_pieces" ADD CONSTRAINT "repertoire_pieces_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "repertoire_pieces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_merge_jobs" ADD CONSTRAINT "piece_merge_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_merge_jobs" ADD CONSTRAINT "piece_merge_jobs_source_piece_id_fkey" FOREIGN KEY ("source_piece_id") REFERENCES "repertoire_pieces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_merge_jobs" ADD CONSTRAINT "piece_merge_jobs_target_piece_id_fkey" FOREIGN KEY ("target_piece_id") REFERENCES "repertoire_pieces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_merge_conflicts" ADD CONSTRAINT "piece_merge_conflicts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_merge_conflicts" ADD CONSTRAINT "piece_merge_conflicts_merge_job_id_fkey" FOREIGN KEY ("merge_job_id") REFERENCES "piece_merge_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
