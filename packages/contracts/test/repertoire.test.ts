import { describe, expect, it } from "vitest";
import {
  isDuplicatePiece,
  normalizeKeySignature,
  normalizePieceText,
  planPieceMerge,
  resolveMergeConflict,
} from "../src/index.js";

describe("normalizeKeySignature", () => {
  it("canonicalizes enharmonic and mode spelling", () => {
    expect(normalizeKeySignature("bb min")).toBe("Bbmin");
    expect(normalizeKeySignature("  G#  minor ")).toBe("G#min");
    expect(normalizeKeySignature("c")).toBe("C");
    expect(normalizeKeySignature("")).toBeNull();
    expect(normalizeKeySignature(null)).toBeNull();
  });
});

describe("isDuplicatePiece", () => {
  it("matches on normalized title or alias and ignores punctuation/whitespace", () => {
    expect(
      isDuplicatePiece(
        { title: "《月光》 奏鸣曲", composer: "贝多芬" },
        { title: "月光奏鸣曲", composer: "Beethoven" },
      ),
    ).toBe(false);
    expect(
      isDuplicatePiece(
        { title: "《月光》 奏鸣曲", composer: "贝多芬" },
        { title: "月光奏鸣曲", composer: "贝多芬", aliases: [] },
      ),
    ).toBe(true);
  });

  it("matches via alias when composers agree or are missing", () => {
    expect(
      isDuplicatePiece(
        { title: "Ave Maria", aliases: ["圣母颂"] },
        { title: " unrelated ", aliases: ["圣母颂"] },
      ),
    ).toBe(true);
    expect(isDuplicatePiece({ title: "练习曲", composer: "肖邦" }, { title: "练习曲", composer: "李斯特" })).toBe(
      false,
    );
  });

  it("normalizes text without throwing on zero-width characters", () => {
    expect(normalizePieceText("  Moon​  light  ")).toBe("moon light");
  });
});

describe("planPieceMerge", () => {
  const base = {
    title: "保留曲目",
    composer: null as string | null,
    key: null as string | null,
    difficulty: null as number | null,
    aliases: [] as string[],
    tags: [] as string[],
    notes: null as string | null,
  };

  it("migrates sessions-safe metadata and unions aliases/tags/notes without conflict", () => {
    const plan = planPieceMerge(
      { ...base, title: "旧名", aliases: ["别名甲"], tags: ["音准"], notes: "旧备注" },
      { ...base, title: "保留曲目", aliases: ["别名乙"], tags: ["节奏"], notes: "新备注" },
    );
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.aliases.sort()).toEqual(["别名甲", "别名乙", "旧名"].sort());
    expect(plan.tags).toEqual(["节奏", "音准"]);
    expect(plan.notes).toContain("旧备注");
    expect(plan.notes).toContain("新备注");
    expect(plan.title).toBe("保留曲目");
  });

  it("keeps pending conflicts for key, difficulty and composer when both sides differ", () => {
    const plan = planPieceMerge(
      { ...base, key: "Amin", difficulty: 2, composer: "Bach" },
      { ...base, key: "Cmaj", difficulty: 4, composer: "Chopin" },
    );
    expect(plan.conflicts.map((item) => item.field).sort()).toEqual(["COMPOSER", "DIFFICULTY", "KEY"]);
    // 冲突未决前采用目标侧（保留曲目）的值，不静默覆盖为来源值。
    expect(plan.key).toBe("Cmaj");
    expect(plan.difficulty).toBe(4);
    expect(plan.composer).toBe("Chopin");
  });

  it("does not raise a conflict when one side is empty or values agree", () => {
    const plan = planPieceMerge(
      { ...base, key: "Am", difficulty: null, composer: "Bach" },
      { ...base, key: "a min", difficulty: 3, composer: null },
    );
    expect(plan.conflicts).toHaveLength(0);
    expect(plan.key).toBe("Amin");
    expect(plan.difficulty).toBe(3);
    expect(plan.composer).toBe("Bach");
  });
});

describe("resolveMergeConflict", () => {
  const current = { composer: "Chopin", key: "Cmaj", difficulty: 4 };

  it("applies source value for USE_SOURCE", () => {
    const conflict = { field: "KEY" as const, sourceValue: "Am", targetValue: "Cmaj" };
    expect(resolveMergeConflict(current, conflict, "USE_SOURCE").key).toBe("Amin");
  });

  it("validates custom difficulty range", () => {
    const conflict = { field: "DIFFICULTY" as const, sourceValue: "2", targetValue: "4" };
    expect(() => resolveMergeConflict(current, conflict, "USE_CUSTOM", "9")).toThrow();
    expect(resolveMergeConflict(current, conflict, "USE_CUSTOM", "5").difficulty).toBe(5);
  });

  it("dismiss keeps the current target value", () => {
    const conflict = { field: "COMPOSER" as const, sourceValue: "Bach", targetValue: "Chopin" };
    expect(resolveMergeConflict(current, conflict, "DISMISSED").composer).toBe("Chopin");
  });
});
