import { Prisma } from "@prisma/client";
import {
  planPieceMerge,
  type KeySignature,
  type MergeConflictField,
  type PieceStatus,
} from "@practice/contracts";
import type { z } from "zod";
import type {
  mergeConflictResolveSchema,
  pieceListQuerySchema,
  pieceTagsSchema,
  pieceUpdateSchema,
} from "@practice/contracts";
import { AppError, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";

const pieceListInclude = {
  tags: { select: { id: true, name: true }, orderBy: { name: "asc" } },
  mergedInto: { select: { id: true, title: true } },
  _count: { select: { practiceSessions: true } },
} satisfies Prisma.RepertoirePieceInclude;

const pieceDetailInclude = {
  tags: { orderBy: { name: "asc" } },
  mergedInto: { select: { id: true, title: true } },
  practiceSessions: {
    where: { status: { in: ["COMPLETED", "ARCHIVED"] as const } },
    orderBy: { startedAt: "desc" },
    take: 50,
    select: {
      id: true,
      title: true,
      instrument: true,
      startedAt: true,
      actualDurationMs: true,
      status: true,
      annotations: { select: { type: true, severity: true, title: true } },
      review: { select: { mainIssues: true, nextFocus: true } },
    },
  },
  _count: { select: { practiceSessions: true } },
  mergeRecordsAsTarget: {
    where: { status: "PENDING" },
    include: { sourcePiece: { select: { id: true, title: true } }, conflicts: true },
  },
} satisfies Prisma.RepertoirePieceInclude;

async function computePieceStats(pieceId: string) {
  const [grouped, totalAgg, latestSession] = await Promise.all([
    prisma.annotation.groupBy({
      by: ["type"],
      where: { session: { pieceId, status: { in: ["COMPLETED", "ARCHIVED"] } } },
      _count: { _all: true },
    }),
    prisma.practiceSession.aggregate({
      where: { pieceId, status: { in: ["COMPLETED", "ARCHIVED"] } },
      _sum: { actualDurationMs: true },
      _count: { _all: true },
    }),
    prisma.annotation.findMany({
      where: { session: { pieceId, status: { in: ["COMPLETED", "ARCHIVED"] } }, severity: { gte: 4 } },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: 10,
      select: { title: true, severity: true, type: true, sessionId: true },
    }),
  ]);
  const issueCounts = { RHYTHM: 0, FINGERING: 0, EMOTION: 0 };
  for (const row of grouped) issueCounts[row.type] = row._count._all;
  return {
    historyCount: totalAgg._count._all,
    totalPracticeMs: totalAgg._sum.actualDurationMs ?? 0n,
    issueCounts,
    hotspots: latestSession,
  };
}

function normalizeTagName(name: string): string {
  return name.trim().replaceAll(/\s+/g, " ");
}

async function resolveTagIds(
  tx: Prisma.TransactionClient,
  userId: string,
  names: string[],
): Promise<string[]> {
  const ids: string[] = [];
  for (const rawName of names) {
    const name = normalizeTagName(rawName);
    const existing = await tx.repertoireTag.findUnique({ where: { userId_name: { userId, name } } });
    if (existing) {
      ids.push(existing.id);
      continue;
    }
    const created = await tx.repertoireTag.create({ data: { userId, name } });
    ids.push(created.id);
  }
  return [...new Set(ids)];
}

export async function listPieces(userId: string, query: z.infer<typeof pieceListQuerySchema>) {
  const where: Prisma.RepertoirePieceWhereInput = {
    userId,
    status: query.status as PieceStatus,
    ...(query.keySignature ? { keySignature: query.keySignature as KeySignature } : {}),
    ...(query.difficulty ? { difficulty: query.difficulty } : {}),
    ...(query.instrument ? { instrument: { equals: query.instrument, mode: "insensitive" } } : {}),
    ...(query.tag ? { tags: { some: { name: { equals: normalizeTagName(query.tag), mode: "insensitive" } } } } : {}),
    ...(query.q
      ? {
          OR: [
            { title: { contains: query.q, mode: "insensitive" } },
            { composer: { contains: query.q, mode: "insensitive" } },
            { movement: { contains: query.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.RepertoirePieceOrderByWithRelationInput =
    query.sortBy === "title"
      ? { title: query.sortOrder }
      : { [query.sortBy]: query.sortOrder };

  const rows = await prisma.repertoirePiece.findMany({
    where,
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    orderBy: [orderBy, { id: "asc" }],
    include: pieceListInclude,
  });

  const hasMore = rows.length > query.limit;
  const data = hasMore ? rows.slice(0, query.limit) : rows;
  return { data, nextCursor: hasMore ? data.at(-1)?.id ?? null : null };
}

export async function createPiece(
  userId: string,
  input: {
    title: string;
    composer?: string | null;
    movement?: string | null;
    keySignature: KeySignature;
    difficulty?: number | null;
    instrument?: string | null;
    tags: string[];
    notes?: string | null;
  },
) {
  return prisma.$transaction(async (tx) => {
    const tagIds = await resolveTagIds(tx, userId, input.tags);
    return tx.repertoirePiece.create({
      data: {
        userId,
        title: input.title,
        composer: input.composer ?? null,
        movement: input.movement ?? null,
        keySignature: input.keySignature,
        difficulty: input.difficulty ?? null,
        instrument: input.instrument ?? null,
        notes: input.notes ?? null,
        tags: { connect: tagIds.map((id) => ({ id })) },
      },
      include: pieceListInclude,
    });
  });
}

export async function getPieceForUser(userId: string, pieceId: string) {
  const [piece, stats] = await Promise.all([
    prisma.repertoirePiece.findFirst({
      where: { id: pieceId, userId },
      include: pieceDetailInclude,
    }),
    computePieceStats(pieceId),
  ]);
  if (!piece) throw notFound();

  return {
    ...piece,
    ...stats,
    pendingMerges: piece.mergeRecordsAsTarget,
  };
}

export async function updatePiece(
  userId: string,
  pieceId: string,
  input: z.infer<typeof pieceUpdateSchema>,
) {
  const existing = await prisma.repertoirePiece.findFirst({
    where: { id: pieceId, userId },
    select: { id: true, status: true },
  });
  if (!existing) throw notFound();
  if (existing.status === "MERGED") {
    throw new AppError(409, "PIECE_MERGED", "已合并曲目不能编辑，请在保留曲目中修改");
  }

  await prisma.$transaction(async (tx) => {
    const result = await tx.repertoirePiece.updateMany({
      where: { id: pieceId, userId, version: input.version },
      data: {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.composer === undefined ? {} : { composer: input.composer }),
        ...(input.movement === undefined ? {} : { movement: input.movement }),
        ...(input.keySignature === undefined ? {} : { keySignature: input.keySignature }),
        ...(input.difficulty === undefined ? {} : { difficulty: input.difficulty }),
        ...(input.instrument === undefined ? {} : { instrument: input.instrument }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) throw new AppError(409, "VERSION_CONFLICT", "曲目已在其他窗口被修改，请刷新后合并");

    if (input.tags !== undefined) {
      const tagIds = await resolveTagIds(tx, userId, input.tags);
      await tx.repertoirePiece.update({ where: { id: pieceId }, data: { tags: { set: tagIds.map((id) => ({ id })) } } });
    }
  });
  return getPieceForUser(userId, pieceId);
}

export async function setPieceTags(
  userId: string,
  pieceId: string,
  input: z.infer<typeof pieceTagsSchema>,
) {
  const existing = await prisma.repertoirePiece.findFirst({ where: { id: pieceId, userId }, select: { id: true, status: true } });
  if (!existing) throw notFound();
  if (existing.status === "MERGED") throw new AppError(409, "PIECE_MERGED", "已合并曲目不能维护标签");

  await prisma.$transaction(async (tx) => {
    const tagIds = await resolveTagIds(tx, userId, input.tags);
    await tx.repertoirePiece.update({ where: { id: pieceId }, data: { tags: { set: tagIds.map((id) => ({ id })) } } });
  });
  return getPieceForUser(userId, pieceId);
}

export async function setPieceArchived(userId: string, pieceId: string, archived: boolean) {
  const piece = await prisma.repertoirePiece.findFirst({ where: { id: pieceId, userId }, select: { status: true } });
  if (!piece) throw notFound();
  if (archived && piece.status !== "ACTIVE") throw new AppError(409, "INVALID_PIECE_STATE", "只有在练曲目可以归档");
  if (!archived && piece.status !== "ARCHIVED") throw new AppError(409, "INVALID_PIECE_STATE", "只有已归档曲目可以恢复");
  await prisma.repertoirePiece.update({
    where: { id: pieceId },
    data: { status: archived ? "ARCHIVED" : "ACTIVE", version: { increment: 1 } },
  });
  return getPieceForUser(userId, pieceId);
}

export async function listTags(userId: string) {
  return prisma.repertoireTag.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, _count: { select: { pieces: true } } },
  });
}

async function refreshLastPracticedAt(tx: Prisma.TransactionClient, pieceId: string) {
  const latest = await tx.practiceSession.findFirst({
    where: { pieceId },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  });
  await tx.repertoirePiece.update({ where: { id: pieceId }, data: { lastPracticedAt: latest?.startedAt ?? null } });
}

export async function linkSession(userId: string, pieceId: string, sessionId: string) {
  const [piece, session] = await Promise.all([
    prisma.repertoirePiece.findFirst({ where: { id: pieceId, userId }, select: { id: true, status: true } }),
    prisma.practiceSession.findFirst({ where: { id: sessionId, userId }, select: { id: true, startedAt: true } }),
  ]);
  if (!piece) throw notFound();
  if (!session) throw new AppError(400, "VALIDATION_ERROR", "关联的练习不存在");
  if (piece.status === "MERGED") throw new AppError(409, "PIECE_MERGED", "已合并曲目不能关联练习");

  await prisma.$transaction(async (tx) => {
    await tx.practiceSession.update({ where: { id: sessionId }, data: { pieceId } });
    await refreshLastPracticedAt(tx, pieceId);
    await tx.repertoirePiece.update({ where: { id: pieceId }, data: { version: { increment: 1 } } });
  });
  return getPieceForUser(userId, pieceId);
}

export async function unlinkSession(userId: string, pieceId: string, sessionId: string) {
  const result = await prisma.practiceSession.updateMany({
    where: { id: sessionId, userId, pieceId },
    data: { pieceId: null },
  });
  if (result.count !== 1) throw new AppError(400, "VALIDATION_ERROR", "该练习不属于此曲目");
  await prisma.$transaction(async (tx) => {
    await refreshLastPracticedAt(tx, pieceId);
    await tx.repertoirePiece.update({ where: { id: pieceId }, data: { version: { increment: 1 } } });
  });
  return getPieceForUser(userId, pieceId);
}

export async function listPieceSessions(userId: string, pieceId: string, limit: number, cursor?: string) {
  const piece = await prisma.repertoirePiece.findFirst({ where: { id: pieceId, userId }, select: { id: true } });
  if (!piece) throw notFound();
  const rows = await prisma.practiceSession.findMany({
    where: { pieceId, userId },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: [{ startedAt: "desc" }, { id: "asc" }],
    select: {
      id: true,
      title: true,
      instrument: true,
      startedAt: true,
      actualDurationMs: true,
      status: true,
      _count: { select: { annotations: true, goals: true } },
    },
  });
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return { data, nextCursor: hasMore ? data.at(-1)?.id ?? null : null };
}

/**
 * 合并重复曲目：在单个数据库事务中原子迁移标签与历史练习等所有引用，
 * 字段冲突不做静默选择，全部落库为待处理项（piece_merge_conflicts）。
 */
export async function mergePieces(userId: string, targetPieceId: string, sourcePieceId: string) {
  if (targetPieceId === sourcePieceId) {
    throw new AppError(400, "VALIDATION_ERROR", "不能将曲目合并到自身");
  }
  const [target, source] = await Promise.all([
    prisma.repertoirePiece.findFirst({
      where: { id: targetPieceId, userId },
      include: { tags: true, _count: { select: { practiceSessions: true } } },
    }),
    prisma.repertoirePiece.findFirst({
      where: { id: sourcePieceId, userId },
      include: { tags: true, _count: { select: { practiceSessions: true } } },
    }),
  ]);
  if (!target || !source) throw notFound();
  if (target.status === "MERGED" || source.status === "MERGED") {
    throw new AppError(409, "PIECE_MERGED", "已合并曲目不能再次合并");
  }
  if (target.status === "ARCHIVED" || source.status === "ARCHIVED") {
    throw new AppError(409, "INVALID_PIECE_STATE", "已归档曲目不能直接合并，请先恢复到在练状态");
  }
  const existingMerge = await prisma.pieceMerge.findUnique({ where: { sourcePieceId } });
  if (existingMerge) {
    throw new AppError(409, "PIECE_ALREADY_MERGED", "来源曲目已合并到其他曲目，请先处理冲突或撤销合并");
  }

  const plan = planPieceMerge({
    target: {
      composer: target.composer,
      keySignature: target.keySignature,
      difficulty: target.difficulty,
      notes: target.notes,
    },
    source: {
      composer: source.composer,
      keySignature: source.keySignature,
      difficulty: source.difficulty,
      notes: source.notes,
    },
    targetTags: target.tags.map((tag) => tag.name),
    sourceTags: source.tags.map((tag) => tag.name),
  });

  return prisma.$transaction(async (tx) => {
    const autoFillData = Object.fromEntries(plan.autoFills.map((item) => [item.field, item.value]));
    const lockedTarget = await tx.repertoirePiece.updateMany({
      where: { id: targetPieceId, userId, status: "ACTIVE", version: target.version },
      data: {
        ...autoFillData,
        version: { increment: 1 },
      },
    });
    if (lockedTarget.count !== 1) {
      throw new AppError(409, "VERSION_CONFLICT", "保留曲目已在其他窗口被修改，请刷新后重试合并");
    }
    await tx.repertoirePiece.update({
      where: { id: targetPieceId },
      data: { tags: { connect: source.tags.map((tag) => ({ id: tag.id })) } },
    });

    const sessionMigration = await tx.practiceSession.updateMany({
      where: { pieceId: sourcePieceId, userId },
      data: { pieceId: targetPieceId },
    });

    const lockedSource = await tx.repertoirePiece.updateMany({
      where: { id: sourcePieceId, userId, status: "ACTIVE", version: source.version },
      data: { status: "MERGED", mergedIntoId: targetPieceId, mergedAt: new Date(), version: { increment: 1 } },
    });
    if (lockedSource.count !== 1) {
      throw new AppError(409, "VERSION_CONFLICT", "来源曲目已在其他窗口被修改，请刷新后重试合并");
    }
    await refreshLastPracticedAt(tx, targetPieceId);

    const merge = await tx.pieceMerge.create({
      data: {
        userId,
        targetPieceId,
        sourcePieceId,
        status: plan.conflicts.length > 0 ? "PENDING" : "RESOLVED",
        ...(plan.conflicts.length === 0 ? { resolvedAt: new Date() } : {}),
        autoFillData,
        migratedCounts: {
          sessions: sessionMigration.count,
          tags: source.tags.length,
          autoFilledFields: plan.autoFills.length,
        },
        conflicts: {
          create: plan.conflicts.map((conflict) => ({
            field: conflict.field,
            targetValue: conflict.targetValue == null ? null : String(conflict.targetValue),
            sourceValue: conflict.sourceValue == null ? null : String(conflict.sourceValue),
          })),
        },
      },
      include: {
        sourcePiece: { select: { id: true, title: true } },
        targetPiece: { select: { id: true, title: true } },
        conflicts: true,
      },
    });

    return merge;
  });
}

export async function listPendingMerges(userId: string) {
  return prisma.pieceMerge.findMany({
    where: { userId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    include: {
      sourcePiece: { select: { id: true, title: true, composer: true } },
      targetPiece: { select: { id: true, title: true, composer: true } },
      conflicts: { where: { status: "PENDING" }, orderBy: { field: "asc" } },
    },
  });
}

export async function getMergeForUser(userId: string, mergeId: string) {
  const merge = await prisma.pieceMerge.findFirst({
    where: { id: mergeId, userId },
    include: {
      sourcePiece: true,
      targetPiece: true,
      conflicts: { orderBy: { field: "asc" } },
    },
  });
  if (!merge) throw notFound();
  return merge;
}

const conflictFields: readonly MergeConflictField[] = ["composer", "keySignature", "difficulty", "notes"];

export async function resolveMergeConflicts(
  userId: string,
  mergeId: string,
  input: z.infer<typeof mergeConflictResolveSchema>,
) {
  const merge = await prisma.pieceMerge.findFirst({
    where: { id: mergeId, userId },
    include: { conflicts: { where: { status: "PENDING" } } },
  });
  if (!merge) throw notFound();
  if (merge.status !== "PENDING") throw new AppError(409, "MERGE_ALREADY_RESOLVED", "该合并没有待处理冲突");

  const provided = conflictFields.filter((field) => input[field] !== undefined);
  const pendingByField = new Map(merge.conflicts.map((conflict) => [conflict.field as MergeConflictField, conflict]));
  const unknown = provided.filter((field) => !pendingByField.has(field));
  if (unknown.length > 0) {
    throw new AppError(400, "VALIDATION_ERROR", `字段 ${unknown.join(", ")} 没有待处理冲突`);
  }

  const patch: Prisma.RepertoirePieceUpdateInput = {};
  for (const field of provided) {
    if (field === "difficulty") {
      patch.difficulty = input.difficulty ?? null;
    } else if (field === "keySignature") {
      if (input.keySignature) patch.keySignature = input.keySignature;
    } else {
      patch[field] = (input[field] as string | null) ?? null;
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.repertoirePiece.update({ where: { id: merge.targetPieceId }, data: patch });
    const now = new Date();
    for (const field of provided) {
      const conflict = pendingByField.get(field);
      if (!conflict) continue;
      const rawValue = input[field];
      await tx.pieceMergeConflict.update({
        where: { id: conflict.id },
        data: {
          status: "RESOLVED",
          resolvedValue: rawValue == null ? null : String(rawValue),
          resolvedAt: now,
        },
      });
    }
    await tx.repertoirePiece.update({ where: { id: merge.targetPieceId }, data: { version: { increment: 1 } } });

    const remaining = await tx.pieceMergeConflict.count({ where: { mergeId, status: "PENDING" } });
    if (remaining === 0) {
      await tx.pieceMerge.update({ where: { id: mergeId }, data: { status: "RESOLVED", resolvedAt: now } });
    }
  });

  return getMergeForUser(userId, mergeId);
}
