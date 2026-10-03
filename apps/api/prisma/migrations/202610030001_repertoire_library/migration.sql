-- CreateEnum
CREATE TYPE "PieceStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'MERGED');

-- CreateEnum
CREATE TYPE "KeySignature" AS ENUM ('C_MAJOR', 'G_MAJOR', 'D_MAJOR', 'A_MAJOR', 'E_MAJOR', 'B_MAJOR', 'F_SHARP_MAJOR', 'C_SHARP_MAJOR', 'F_MAJOR', 'B_FLAT_MAJOR', 'E_FLAT_MAJOR', 'A_FLAT_MAJOR', 'D_FLAT_MAJOR', 'G_FLAT_MAJOR', 'C_FLAT_MAJOR', 'A_MINOR', 'E_MINOR', 'B_MINOR', 'F_SHARP_MINOR', 'C_SHARP_MINOR', 'G_SHARP_MINOR', 'D_MINOR', 'G_MINOR', 'C_MINOR', 'F_MINOR', 'B_FLAT_MINOR', 'E_FLAT_MINOR', 'A_FLAT_MINOR', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MergeConflictStatus" AS ENUM ('PENDING', 'RESOLVED');

-- CreateTable
CREATE TABLE "repertoire_pieces" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "composer" VARCHAR(160),
    "movement" VARCHAR(200),
    "key_signature" "KeySignature" NOT NULL DEFAULT 'UNKNOWN',
    "difficulty" SMALLINT,
    "instrument" VARCHAR(60),
    "notes" TEXT,
    "status" "PieceStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_practiced_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 0,
    "merged_into_id" UUID,
    "merged_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "repertoire_pieces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repertoire_tags" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "repertoire_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "piece_merges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "target_piece_id" UUID NOT NULL,
    "source_piece_id" UUID NOT NULL,
    "status" "MergeConflictStatus" NOT NULL DEFAULT 'PENDING',
    "auto_fill_data" JSONB,
    "migrated_counts" JSONB,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "piece_merges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "piece_merge_conflicts" (
    "id" UUID NOT NULL,
    "merge_id" UUID NOT NULL,
    "field" VARCHAR(32) NOT NULL,
    "target_value" TEXT,
    "source_value" TEXT,
    "status" "MergeConflictStatus" NOT NULL DEFAULT 'PENDING',
    "resolved_value" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "piece_merge_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_RepertoirePieceToRepertoireTag" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_RepertoirePieceToRepertoireTag_AB_pkey" PRIMARY KEY ("A", "B")
);

-- AlterTable
ALTER TABLE "practice_sessions" ADD COLUMN "piece_id" UUID;

-- CreateIndex
CREATE INDEX "repertoire_pieces_user_id_status_updated_at_idx" ON "repertoire_pieces"("user_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "repertoire_pieces_user_id_key_signature_idx" ON "repertoire_pieces"("user_id", "key_signature");

-- CreateIndex
CREATE INDEX "repertoire_pieces_user_id_difficulty_idx" ON "repertoire_pieces"("user_id", "difficulty");

-- CreateIndex
CREATE INDEX "repertoire_pieces_user_id_last_practiced_at_idx" ON "repertoire_pieces"("user_id", "last_practiced_at" DESC);

-- CreateIndex
CREATE INDEX "repertoire_pieces_merged_into_id_idx" ON "repertoire_pieces"("merged_into_id");

-- CreateIndex
CREATE UNIQUE INDEX "repertoire_tags_user_id_name_key" ON "repertoire_tags"("user_id", "name");

-- CreateIndex
CREATE INDEX "repertoire_tags_user_id_name_idx" ON "repertoire_tags"("user_id", "name");

-- CreateIndex
CREATE INDEX "piece_merges_user_id_status_idx" ON "piece_merges"("user_id", "status");

-- CreateIndex
CREATE INDEX "piece_merges_target_piece_id_idx" ON "piece_merges"("target_piece_id");

-- CreateIndex
CREATE UNIQUE INDEX "piece_merges_source_piece_id_key" ON "piece_merges"("source_piece_id");

-- CreateIndex
CREATE INDEX "piece_merge_conflicts_merge_id_status_idx" ON "piece_merge_conflicts"("merge_id", "status");

-- CreateIndex
CREATE INDEX "practice_sessions_user_id_piece_id_started_at_idx" ON "practice_sessions"("user_id", "piece_id", "started_at" DESC);

-- CreateIndex
CREATE INDEX "_RepertoirePieceToRepertoireTag_B_index" ON "_RepertoirePieceToRepertoireTag"("B");

-- AddForeignKey
ALTER TABLE "repertoire_pieces" ADD CONSTRAINT "repertoire_pieces_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repertoire_pieces" ADD CONSTRAINT "repertoire_pieces_merged_into_id_fkey" FOREIGN KEY ("merged_into_id") REFERENCES "repertoire_pieces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repertoire_tags" ADD CONSTRAINT "repertoire_tags_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_merges" ADD CONSTRAINT "piece_merges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_merges" ADD CONSTRAINT "piece_merges_target_piece_id_fkey" FOREIGN KEY ("target_piece_id") REFERENCES "repertoire_pieces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_merges" ADD CONSTRAINT "piece_merges_source_piece_id_fkey" FOREIGN KEY ("source_piece_id") REFERENCES "repertoire_pieces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "piece_merge_conflicts" ADD CONSTRAINT "piece_merge_conflicts_merge_id_fkey" FOREIGN KEY ("merge_id") REFERENCES "piece_merges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_piece_id_fkey" FOREIGN KEY ("piece_id") REFERENCES "repertoire_pieces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RepertoirePieceToRepertoireTag" ADD CONSTRAINT "_RepertoirePieceToRepertoireTag_A_fkey" FOREIGN KEY ("A") REFERENCES "repertoire_pieces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RepertoirePieceToRepertoireTag" ADD CONSTRAINT "_RepertoirePieceToRepertoireTag_B_fkey" FOREIGN KEY ("B") REFERENCES "repertoire_tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;
