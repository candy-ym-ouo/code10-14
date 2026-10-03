import type { FastifyPluginAsync } from "fastify";
import {
  mergeConflictResolveSchema,
  pieceCreateSchema,
  pieceListQuerySchema,
  pieceMergeSchema,
  pieceSessionLinkSchema,
  pieceSessionListQuerySchema,
  pieceTagsSchema,
  pieceUpdateSchema,
} from "@practice/contracts";
import { AppError } from "../lib/errors.js";
import { parseOrThrow } from "../lib/validation.js";
import { audit } from "../lib/audit.js";
import {
  createPiece,
  getPieceForUser,
  getMergeForUser,
  linkSession,
  listPendingMerges,
  listPieceSessions,
  listPieces,
  listTags,
  mergePieces,
  resolveMergeConflicts,
  setPieceArchived,
  setPieceTags,
  unlinkSession,
  updatePiece,
} from "../services/repertoire-service.js";

const repertoireRoutes: FastifyPluginAsync = async (app) => {
  app.addHook("preHandler", app.authenticate);

  app.get("/pieces/tags", async (request) => {
    return { data: await listTags(request.authUser!.id) };
  });

  app.get("/pieces/merges", async (request) => {
    return { data: await listPendingMerges(request.authUser!.id) };
  });

  app.get("/pieces/merges/:mergeId", async (request) => {
    const { mergeId } = request.params as { mergeId: string };
    return { merge: await getMergeForUser(request.authUser!.id, mergeId) };
  });

  app.post("/pieces/merges/:mergeId/resolve", async (request) => {
    const { mergeId } = request.params as { mergeId: string };
    const input = parseOrThrow(mergeConflictResolveSchema, request.body);
    const merge = await resolveMergeConflicts(request.authUser!.id, mergeId, input);
    await audit(request, "PIECE_MERGE_RESOLVED", "PIECE_MERGE", mergeId, "SUCCESS", {
      remainingConflicts: merge.conflicts.filter((item) => item.status === "PENDING").length,
    });
    return { merge };
  });

  app.get("/pieces", async (request) => {
    const query = parseOrThrow(pieceListQuerySchema, request.query);
    return listPieces(request.authUser!.id, query);
  });

  app.post("/pieces", async (request, reply) => {
    const input = parseOrThrow(pieceCreateSchema, request.body);
    const piece = await createPiece(request.authUser!.id, input);
    await audit(request, "PIECE_CREATED", "REPERTOIRE_PIECE", piece.id, "SUCCESS");
    return reply.status(201).send({ piece });
  });

  app.get("/pieces/:id", async (request) => {
    const { id } = request.params as { id: string };
    return { piece: await getPieceForUser(request.authUser!.id, id) };
  });

  app.patch("/pieces/:id", async (request) => {
    const { id } = request.params as { id: string };
    const input = parseOrThrow(pieceUpdateSchema, request.body);
    return { piece: await updatePiece(request.authUser!.id, id, input) };
  });

  app.put("/pieces/:id/tags", async (request) => {
    const { id } = request.params as { id: string };
    const input = parseOrThrow(pieceTagsSchema, request.body);
    return { piece: await setPieceTags(request.authUser!.id, id, input) };
  });

  app.post("/pieces/:id/archive", async (request) => {
    const { id } = request.params as { id: string };
    return { piece: await setPieceArchived(request.authUser!.id, id, true) };
  });

  app.post("/pieces/:id/restore", async (request) => {
    const { id } = request.params as { id: string };
    return { piece: await setPieceArchived(request.authUser!.id, id, false) };
  });

  app.post("/pieces/:id/merge", async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = parseOrThrow(pieceMergeSchema, request.body);
    if (input.sourcePieceId === id) throw new AppError(400, "VALIDATION_ERROR", "不能将曲目合并到自身");
    const merge = await mergePieces(request.authUser!.id, id, input.sourcePieceId);
    await audit(request, "PIECE_MERGED", "REPERTOIRE_PIECE", id, "SUCCESS", {
      sourcePieceId: input.sourcePieceId,
      conflictCount: merge.conflicts.length,
    });
    return reply.status(201).send({ merge });
  });

  app.get("/pieces/:id/sessions", async (request) => {
    const { id } = request.params as { id: string };
    const query = parseOrThrow(pieceSessionListQuerySchema, request.query);
    return listPieceSessions(request.authUser!.id, id, query.limit, query.cursor);
  });

  app.post("/pieces/:id/sessions", async (request, reply) => {
    const { id } = request.params as { id: string };
    const input = parseOrThrow(pieceSessionLinkSchema, request.body);
    const piece = await linkSession(request.authUser!.id, id, input.sessionId);
    await audit(request, "PIECE_SESSION_LINKED", "REPERTOIRE_PIECE", id, "SUCCESS", { sessionId: input.sessionId });
    return reply.status(201).send({ piece });
  });

  app.delete("/pieces/:id/sessions/:sessionId", async (request) => {
    const { id, sessionId } = request.params as { id: string; sessionId: string };
    return { piece: await unlinkSession(request.authUser!.id, id, sessionId) };
  });
};

export default repertoireRoutes;
