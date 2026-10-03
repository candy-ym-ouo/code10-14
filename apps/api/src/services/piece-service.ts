import { Prisma } from "@prisma/client";
import {
  isDuplicatePiece,
  normalizeKeySignature,
  normalizePieceText,
  planPieceMerge,
  resolveMergeConflict,
  type MergeConflictResolution,
} from "@practice/contracts";
import type { z } from "zod";
import type { pieceListQuerySchema } from "@practice/contracts";
import { AppError, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

export const PIECE_RESOURCE = "REPERTOIRE_PIECE";
export const MERGE_RESOURCE = "PIECE_MERGE";

const pieceInclude = {
  mergedInto: { select: { id: true, title: true } },
  _count: { select: { sessions: true, outgoingMerges: true } },
} as const;

/** 重新统计曲目历史：练习次数、累计时长和最近练习时间。删除/迁移练习后也必须调用。 */
export async function recomputePieceStats(tx: Prisma.TransactionClient, pieceId: string): Promise<void> {
  const aggregate = await tx.practiceSession.aggregate({
    where: {
      pieceId,
      status: { notIn: ["DELETING", "DELETE_FAILED", "DRAFT"] },
    },
    _count: { _all: true },
    _sum: { actualDurationMs: true },
    _max: { startedAt: true },
  });
  await tx.repertoirePiece.update({
    where: { id: pieceId },
    data: {
      practiceCount: aggregate._count._all,
      totalPracticeMs: aggregate._sum.actualDurationMs ?? 0n,
      lastPracticedAt: aggregate._max.startedAt ?? null,
    },
  });
}

export async function listPieces(userId: string, query: z.infer<typeof pieceListQuerySchema>) {
  const where: Prisma.RepertoirePieceWhereInput = {
    userId,
    status: query.status,
    ...(query.difficulty ? { difficulty: query.difficulty } : {}),
    ...(query.key ? { key: { equals: query.key, mode: "insensitive" } } : {}),
    ...(query.composer
      ? { normalizedComposer: normalizePieceText(query.composer) }
      : {}),
    ...(query.tag ? { tags: { has: query.tag } } : {}),
    ...(query.q
      ? {
          OR: [
            { normalizedTitle: { contains: normalizePieceText(query.q), mode: "insensitive" } },
            { title: { contains: query.q, mode: "insensitive" } },
            { composer: { contains: query.q, mode: "insensitive" } },
            { aliases: { has: query.q } },
            { tags: { has: query.q } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.RepertoirePieceOrderByWithRelationInput[] =
    query.sortBy === "title"
      ? [{ normalizedTitle: query.sortOrder }]
      : [{ [query.sortBy]: query.sortOrder }, { id: "asc" }];

  const rows = await prisma.repertoirePiece.findMany({
    where,
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    orderBy,
    include: pieceInclude,
  });
  const hasMore = rows.length > query.limit;
  const data = hasMore ? rows.slice(0, query.limit) : rows;
  return { data, nextCursor: hasMore ? data.at(-1)?.id ?? null : null };
}

export async function getPieceForUser(userId: string, pieceId: string) {
  const piece = await prisma.repertoirePiece.findFirst({
    where: { id: pieceId, userId },
    include: {
      mergedInto: { select: { id: true, title: true } },
      sessions: {
        where: { status: { notIn: ["DELETING", "DELETE_FAILED"] } },
        orderBy: { startedAt: "desc" },
        take: 20,
        select: { id: true, title: true, instrument: true, startedAt: true, actualDurationMs: true, status: true },
      },
      _count: { select: { sessions: true, absorbedPieces: true } },
    },
  });
  if (!piece) throw notFound();
  return piece;
}

async function assertNoDuplicate(
  userId: string,
  input: { title: string; composer?: string | null; aliases?: string[] },
  excludeId?: string,
): Promise<void> {
  const candidates = await prisma.repertoirePiece.findMany({
    where: { userId, status: "ACTIVE", ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, title: true, composer: true, aliases: true },
  });
  const duplicate = candidates.find((candidate) =>
    isDuplicatePiece(
      { title: input.title, composer: input.composer ?? null, aliases: input.aliases ?? [] },
      { title: candidate.title, composer: candidate.composer, aliases: candidate.aliases },
    ),
  );
  if (duplicate) {
    throw new AppError(409, "PIECE_DUPLICATE", "已存在同名或同别名的曲目，疑似重复条目", {
      duplicatePieceId: duplicate.id,
      duplicateTitle: duplicate.title,
    });
  }
}

export async function createPiece(
  userId: string,
  input: {
    title: string;
    composer?: string | null;
    key?: string | null;
    difficulty?: number | null;
    tags: string[];
    aliases: string[];
    notes?: string | null;
    allowDuplicate: boolean;
  },
) {
  if (!input.allowDuplicate) await assertNoDuplicate(userId, input);
  return prisma.repertoirePiece.create({
    data: {
      userId,
      title: input.title.trim(),
      composer: input.composer?.trim() || null,
      normalizedTitle: normalizePieceText(input.title),
      normalizedComposer: normalizePieceText(input.composer) || null,
      key: normalizeKeySignature(input.key),
      difficulty: input.difficulty ?? null,
      tags: input.tags,
      aliases: input.aliases,
      notes: input.notes ?? null,
    },
    include: pieceInclude,
  });
}

export async function updatePiece(
  userId: string,
  pieceId: string,
  input: {
    version: number;
    title?: string;
    composer?: string | null;
    key?: string | null;
    difficulty?: number | null;
    tags?: string[];
    aliases?: string[];
    notes?: string | null;
    allowDuplicate?: boolean;
  },
) {
  const existing = await prisma.repertoirePiece.findFirst({ where: { id: pieceId, userId } });
  if (!existing) throw notFound();
  if (existing.status !== "ACTIVE") {
    throw new AppError(409, "INVALID_PIECE_STATE", "只有使用中的曲目可以编辑，已合并曲目请在保留条目上修改");
  }
  const nextTitle = input.title?.trim() ?? existing.title;
  const nextComposer = input.composer === undefined ? existing.composer : input.composer?.trim() || null;
  const nextAliases = input.aliases ?? existing.aliases;
  if (!input.allowDuplicate) {
    await assertNoDuplicate(userId, { title: nextTitle, composer: nextComposer, aliases: nextAliases }, pieceId);
  }
  const result = await prisma.repertoirePiece.updateMany({
    where: { id: pieceId, userId, version: input.version, status: "ACTIVE" },
    data: {
      ...(input.title === undefined ? {} : { title: nextTitle, normalizedTitle: normalizePieceText(nextTitle) }),
      ...(input.composer === undefined
        ? {}
        : { composer: nextComposer, normalizedComposer: normalizePieceText(nextComposer) || null }),
      ...(input.key === undefined ? {} : { key: normalizeKeySignature(input.key) }),
      ...(input.difficulty === undefined ? {} : { difficulty: input.difficulty }),
      ...(input.tags === undefined ? {} : { tags: input.tags }),
      ...(input.aliases === undefined ? {} : { aliases: input.aliases }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      version: { increment: 1 },
    },
  });
  if (result.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "曲目已在其他窗口被修改，请刷新后合并");
  return getPieceForUser(userId, pieceId);
}

export async function archivePiece(userId: string, pieceId: string, restore = false) {
  const piece = await prisma.repertoirePiece.findFirst({ where: { id: pieceId, userId } });
  if (!piece) throw notFound();
  if (restore && piece.status !== "ARCHIVED") {
    throw new AppError(409, "INVALID_PIECE_STATE", "只有已归档曲目可以恢复");
  }
  if (!restore && piece.status !== "ACTIVE") {
    throw new AppError(409, "INVALID_PIECE_STATE", "只有使用中的曲目可以归档");
  }
  return prisma.repertoirePiece.update({
    where: { id: pieceId },
    data: { status: restore ? "ACTIVE" : "ARCHIVED", version: { increment: 1 } },
    include: pieceInclude,
  });
}

export async function findPotentialDuplicates(userId: string, pieceId: string) {
  const piece = await prisma.repertoirePiece.findFirst({ where: { id: pieceId, userId } });
  if (!piece) throw notFound();
  const candidates = await prisma.repertoirePiece.findMany({
    where: { userId, status: "ACTIVE", id: { not: pieceId } },
    include: pieceInclude,
  });
  return candidates.filter((candidate) =>
    isDuplicatePiece(
      { title: piece.title, composer: piece.composer, aliases: piece.aliases },
      { title: candidate.title, composer: candidate.composer, aliases: candidate.aliases },
    ),
  );
}

/**
 * 原子合并：在单个数据库事务中迁移全部练习引用、联合别名/标签/备注，
 * 并把调性、难度、作曲家冲突持久化为待处理项。任一步失败整体回滚。
 */
export async function mergePieces(userId: string, sourcePieceId: string, targetPieceId: string) {
  if (sourcePieceId === targetPieceId) {
    throw new AppError(400, "VALIDATION_ERROR", "来源曲目与保留曲目不能相同");
  }
  const [source, target] = await Promise.all([
    prisma.repertoirePiece.findFirst({ where: { id: sourcePieceId, userId } }),
    prisma.repertoirePiece.findFirst({ where: { id: targetPieceId, userId } }),
  ]);
  if (!source || !target) throw notFound();
  if (source.status !== "ACTIVE" || target.status !== "ACTIVE") {
    throw new AppError(409, "INVALID_PIECE_STATE", "只有两条使用中的曲目可以合并");
  }

  const plan = planPieceMerge(
    {
      title: source.title,
      composer: source.composer,
      key: source.key,
      difficulty: source.difficulty,
      aliases: source.aliases,
      tags: source.tags,
      notes: source.notes,
    },
    {
      title: target.title,
      composer: target.composer,
      key: target.key,
      difficulty: target.difficulty,
      aliases: target.aliases,
      tags: target.tags,
      notes: target.notes,
    },
  );

  return prisma.$transaction(async (tx) => {
    // 原子迁移：所有练习引用改挂保留曲目。
    const migrated = await tx.practiceSession.updateMany({
      where: { pieceId: sourcePieceId, userId },
      data: { pieceId: targetPieceId },
    });

    const mergeJob = await tx.pieceMergeJob.create({
      data: {
        userId,
        sourcePieceId,
        targetPieceId,
        status: plan.conflicts.length > 0 ? "CONFLICTS_PENDING" : "RESOLVED",
        migratedSessions: migrated.count,
        ...(plan.conflicts.length > 0 ? {} : { resolvedAt: new Date() }),
        conflicts: {
          create: plan.conflicts.map((conflict) => ({
            userId,
            field: conflict.field,
            sourceValue: conflict.sourceValue,
            targetValue: conflict.targetValue,
          })),
        },
      },
      include: { conflicts: true },
    });

    await tx.repertoirePiece.update({
      where: { id: targetPieceId },
      data: {
        composer: plan.composer,
        key: plan.key,
        difficulty: plan.difficulty,
        aliases: plan.aliases,
        tags: plan.tags,
        notes: plan.notes,
        version: { increment: 1 },
      },
    });
    await tx.repertoirePiece.update({
      where: { id: sourcePieceId },
      data: { status: "MERGED", mergedIntoId: targetPieceId, version: { increment: 1 } },
    });
    await recomputePieceStats(tx, sourcePieceId);
    await recomputePieceStats(tx, targetPieceId);

    return {
      mergeJob,
      target: await tx.repertoirePiece.findUniqueOrThrow({ where: { id: targetPieceId }, include: pieceInclude }),
      migratedSessions: migrated.count,
      pendingConflictCount: plan.conflicts.length,
    };
  });
}

export async function listMerges(userId: string, status?: "CONFLICTS_PENDING" | "RESOLVED") {
  return prisma.pieceMergeJob.findMany({
    where: { userId, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    include: {
      sourcePiece: { select: { id: true, title: true, composer: true } },
      targetPiece: { select: { id: true, title: true, composer: true } },
      conflicts: { orderBy: { field: "asc" } },
    },
  });
}

export async function getMergeForUser(userId: string, mergeId: string) {
  const merge = await prisma.pieceMergeJob.findFirst({
    where: { id: mergeId, userId },
    include: {
      sourcePiece: { select: { id: true, title: true, composer: true, key: true, difficulty: true, tags: true } },
      targetPiece: { select: { id: true, title: true, composer: true, key: true, difficulty: true, tags: true } },
      conflicts: { orderBy: { field: "asc" } },
    },
  });
  if (!merge) throw notFound();
  return merge;
}

export async function resolveConflict(
  userId: string,
  mergeId: string,
  conflictId: string,
  resolution: MergeConflictResolution,
  customValue?: string,
) {
  const merge = await prisma.pieceMergeJob.findFirst({
    where: { id: mergeId, userId },
    include: { conflicts: true, targetPiece: true },
  });
  if (!merge) throw notFound();
  const conflict = merge.conflicts.find((item) => item.id === conflictId);
  if (!conflict) throw notFound();
  if (conflict.status !== "PENDING") {
    throw new AppError(409, "CONFLICT_ALREADY_RESOLVED", "该冲突项已处理");
  }

  return prisma.$transaction(async (tx) => {
    const next = resolveMergeConflict(
      { composer: merge.targetPiece.composer, key: merge.targetPiece.key, difficulty: merge.targetPiece.difficulty },
      { field: conflict.field, sourceValue: conflict.sourceValue, targetValue: conflict.targetValue },
      resolution,
      customValue,
    );

    await tx.pieceMergeConflict.update({
      where: { id: conflictId },
      data: {
        status: resolution,
        resolution:
          resolution === "USE_CUSTOM"
            ? customValue?.trim() || null
            : resolution === "USE_SOURCE"
              ? conflict.sourceValue
              : resolution === "KEEP_TARGET"
                ? conflict.targetValue
                : null,
        resolvedAt: new Date(),
      },
    });

    await tx.repertoirePiece.update({
      where: { id: merge.targetPieceId },
      data: {
        composer: next.composer,
        key: next.key,
        difficulty: next.difficulty,
        version: { increment: 1 },
      },
    });

    const pendingCount = await tx.pieceMergeConflict.count({
      where: { mergeJobId: mergeId, status: "PENDING" },
    });
    if (pendingCount === 0 && merge.status !== "RESOLVED") {
      await tx.pieceMergeJob.update({
        where: { id: mergeId },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
    }
    return tx.pieceMergeJob.findFirstOrThrow({
      where: { id: mergeId, userId },
      include: {
        sourcePiece: { select: { id: true, title: true, composer: true, key: true, difficulty: true, tags: true } },
        targetPiece: { select: { id: true, title: true, composer: true, key: true, difficulty: true, tags: true } },
        conflicts: { orderBy: { field: "asc" } },
      },
    });
  });
}

/** 将练习关联到曲目（或传 null 解除关联），并同步两侧曲目统计。 */
export async function linkSessionToPiece(
  userId: string,
  sessionId: string,
  pieceId: string | null,
  expectedVersion?: number,
) {
  const session = await prisma.practiceSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true, pieceId: true, version: true, status: true },
  });
  if (!session) throw notFound();
  if (["DELETING", "DELETE_FAILED"].includes(session.status)) {
    throw new AppError(409, "INVALID_SESSION_STATE", "正在删除的练习不能调整曲目");
  }
  if (pieceId) {
    const piece = await prisma.repertoirePiece.findFirst({
      where: { id: pieceId, userId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!piece) throw new AppError(400, "VALIDATION_ERROR", "关联曲目不存在或已合并/归档");
  }
  return prisma.$transaction(async (tx) => {
    const result = await tx.practiceSession.updateMany({
      where: {
        id: sessionId,
        userId,
        ...(expectedVersion === undefined ? {} : { version: expectedVersion }),
      },
      data: { pieceId, version: { increment: 1 } },
    });
    if (result.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "练习已在其他窗口被修改，请刷新后重试");
    if (session.pieceId) await recomputePieceStats(tx, session.pieceId);
    if (pieceId) await recomputePieceStats(tx, pieceId);
    return tx.practiceSession.findUniqueOrThrow({
      where: { id: sessionId },
      select: { id: true, pieceId: true, version: true },
    });
  });
}
