import { describe, expect, it } from "vitest";
import {
  planPieceMerge,
  type KeySignature,
  type MergeablePieceFields,
} from "../src/index.js";

const empty: MergeablePieceFields = {
  composer: null,
  keySignature: "UNKNOWN" as KeySignature,
  difficulty: null,
  notes: null,
};

describe("piece merge planning", () => {
  it("auto-fills target blanks from the source without producing conflicts", () => {
    const plan = planPieceMerge({
      target: { ...empty },
      source: { composer: "巴赫", keySignature: "D_MINOR", difficulty: 4, notes: "注意装饰音" },
      targetTags: [],
      sourceTags: ["装饰音"],
    });
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.autoFills.map((item) => item.field)).toEqual(["composer", "keySignature", "difficulty", "notes"]);
  });

  it("keeps disagreeing fields as pending conflicts instead of silently picking one", () => {
    const plan = planPieceMerge({
      target: { composer: "莫扎特", keySignature: "C_MAJOR", difficulty: 2, notes: "旧版备注" },
      source: { composer: "莫差特", keySignature: "G_MAJOR", difficulty: 4, notes: "新版备注" },
      targetTags: [],
      sourceTags: [],
    });
    expect(plan.conflicts.map((item) => item.field)).toEqual(["composer", "keySignature", "difficulty", "notes"]);
    expect(plan.conflicts[0]).toMatchObject({ field: "composer", targetValue: "莫扎特", sourceValue: "莫差特" });
    expect(plan.autoFills).toHaveLength(0);
  });

  it("treats blank strings as empty and merges only the populated side", () => {
    const plan = planPieceMerge({
      target: { composer: "   ", keySignature: "UNKNOWN", difficulty: null, notes: null },
      source: { composer: "肖邦", keySignature: "UNKNOWN", difficulty: 3, notes: null },
      targetTags: [],
      sourceTags: [],
    });
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.autoFills.map((item) => item.field)).toEqual(["composer", "difficulty"]);
  });

  it("unions tags with case/whitespace-insensitive deduplication", () => {
    const plan = planPieceMerge({
      target: { ...empty },
      source: { ...empty },
      targetTags: ["换把", " 节奏 "],
      sourceTags: ["节奏", "颤音"],
    });
    expect(plan.mergedTags).toEqual(["换把", "节奏", "颤音"]);
  });
});
