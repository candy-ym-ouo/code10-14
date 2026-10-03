import type { FastifyPluginAsync } from "fastify";
import {
  mergeConflictResolveSchema,
  pieceCreateSchema,
  pieceListQuerySchema,
  pieceMergeListQuerySchema,
  pieceMergeSchema,
  pieceUpdateSchema,
} from "@practice/contracts";
import { AppError } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { prisma } from "../lib/prisma.js";
import { parseOrThrow } from "../lib/validation.js";
import {
  MERGE_RESOURCE,
  PIECE_RESOURCE,
  archivePiece,
  createPiece,
  findPotentialDuplicates,
  getMergeForUser,
  getPieceForUser,
  listMerges,
  listPieces,
  mergePieces,
  resolveConflict,
  updatePiece,
} from "../services/piece-service.js";

const repertoireRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/pieces", async (request) => {
    const query = parseOrThrow(pieceListQuerySchema, request.query);
    return listPieces(request.authUser!.id, query);
  });

  app.post("/pieces", async (request, reply) => {
    const input = parseOrThrow(pieceCreateSchema, request.body);
    const piece = await createPiece(request.authUser!.id, input);
    await audit(request, "PIECE_CREATED", PIECE_RESOURCE, piece.id, "SUCCESS");
    return reply.status(201).send({ piece });
  });

  app.get("/pieces/tags", async (request) => {
    const rows = await prisma.repertoirePiece.findMany({
      where: { userId: request.authUser!.id, status: { in: ["ACTIVE", "ARCHIVED"] } },
      select: { tags: true },
    });
    const counts = new Map<string, number>();
    for (const row of rows) for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return { data: [...counts.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count) };
  });

  app.get("/pieces/:id", async (request) => {
    const { id } = request.params as { id: string };
    return { piece: await getPieceForUser(request.authUser!.id, id) };
  });

  app.patch("/pieces/:id", async (request) => {
    const { id } = request.params as { id: string };
    const input = parseOrThrow(pieceUpdateSchema, request.body);
    const piece = await updatePiece(request.authUser!.id, id, input);
    await audit(request, "PIECE_UPDATED", PIECE_RESOURCE, id, "SUCCESS");
    return { piece };
  });

  app.post("/pieces/:id/archive", async (request) => {
    const { id } = request.params as { id: string };
    const piece = await archivePiece(request.authUser!.id, id);
    await audit(request, "PIECE_ARCHIVED", PIECE_RESOURCE, id, "SUCCESS");
    return { piece };
  });

  app.post("/pieces/:id/restore", async (request) => {
    const { id } = request.params as { id: string };
    return { piece: await archivePiece(request.authUser!.id, id, true) };
  });

  app.get("/pieces/:id/duplicates", async (request) => {
    const { id } = request.params as { id: string };
    return { data: await findPotentialDuplicates(request.authUser!.id, id) };
  });

  app.post("/pieces/:id/merge", async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = parseOrThrow(pieceMergeSchema, request.body);
    const result = await mergePieces(request.authUser!.id, input.sourcePieceId, id);
    await audit(request, "PIECES_MERGED", MERGE_RESOURCE, result.mergeJob.id, "SUCCESS", {
      sourcePieceId: input.sourcePieceId,
      targetPieceId: id,
      migratedSessions: result.migratedSessions,
      pendingConflictCount: result.pendingConflictCount,
    });
    return reply.status(201).send(result);
  });

  app.get("/merges", async (request) => {
    const query = parseOrThrow(pieceMergeListQuerySchema, request.query);
    const data = await listMerges(
      request.authUser!.id,
      query.status === "ALL" ? undefined : query.status,
    );
    return { data };
  });

  app.get("/merges/:id", async (request) => {
    const { id } = request.params as { id: string };
    return { merge: await getMergeForUser(request.authUser!.id, id) };
  });

  app.post("/merges/:id/conflicts/:conflictId/resolve", async (request) => {
    const { id, conflictId } = request.params as { id: string; conflictId: string };
    const input = parseOrThrow(mergeConflictResolveSchema, request.body);
    if (input.resolution === "USE_CUSTOM" && !input.customValue?.trim()) {
      throw new AppError(400, "VALIDATION_ERROR", "采用自定义值时必须填写 customValue");
    }
    const merge = await resolveConflict(
      request.authUser!.id,
      id,
      conflictId,
      input.resolution,
      input.customValue,
    );
    await audit(request, "MERGE_CONFLICT_RESOLVED", MERGE_RESOURCE, id, "SUCCESS", {
      conflictId,
      resolution: input.resolution,
    });
    return { merge };
  });
};

export default repertoireRoutes;
