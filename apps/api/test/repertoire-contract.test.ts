import { describe, expect, it } from "vitest";
import {
  mergeConflictResolveSchema,
  pieceCreateSchema,
  pieceListQuerySchema,
  pieceMergeSchema,
  pieceUpdateSchema,
} from "@practice/contracts";

describe("repertoire contract schemas", () => {
  it("accepts a minimal piece with unknown key and unrated difficulty", () => {
    const parsed = pieceCreateSchema.parse({ title: "练习曲", difficulty: null });
    expect(parsed.keySignature).toBe("UNKNOWN");
    expect(parsed.difficulty).toBeNull();
    expect(parsed.tags).toEqual([]);
  });

  it("rejects difficulty outside 1-5 and overlong tags", () => {
    expect(pieceCreateSchema.safeParse({ title: "x", difficulty: 6 }).success).toBe(false);
    expect(
      pieceCreateSchema.safeParse({ title: "x", tags: Array.from({ length: 21 }, (_, i) => `tag${i}`) }).success,
    ).toBe(false);
  });

  it("requires version on update and rejects blank conflict resolutions", () => {
    expect(pieceUpdateSchema.safeParse({ title: "新名字" }).success).toBe(false);
    expect(pieceUpdateSchema.safeParse({ title: "新名字", version: 0 }).success).toBe(true);
    expect(mergeConflictResolveSchema.safeParse({}).success).toBe(false);
    expect(mergeConflictResolveSchema.safeParse({ difficulty: 3 }).success).toBe(true);
  });

  it("defaults list query to active pieces with cursor pagination", () => {
    const parsed = pieceListQuerySchema.parse({});
    expect(parsed.status).toBe("ACTIVE");
    expect(parsed.limit).toBe(30);
  });

  it("requires a uuid source piece for merges", () => {
    expect(pieceMergeSchema.safeParse({ sourcePieceId: "not-a-uuid" }).success).toBe(false);
    expect(pieceMergeSchema.safeParse({ sourcePieceId: "123e4567-e89b-12d3-a456-426614174000" }).success).toBe(true);
  });
});
