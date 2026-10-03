import { z } from "zod";

export const SESSION_STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "COMPLETED",
  "ARCHIVED",
  "DELETING",
  "DELETE_FAILED",
] as const;
export const MEDIA_STATUSES = [
  "PENDING_UPLOAD",
  "UPLOADING",
  "UPLOADED",
  "PROCESSING",
  "READY",
  "FAILED",
  "CANCELLED",
] as const;
export const ANNOTATION_TYPES = ["RHYTHM", "FINGERING", "EMOTION"] as const;
export const GOAL_CATEGORIES = [
  "RHYTHM",
  "FINGERING",
  "EMOTION",
  "CONTINUITY",
  "PITCH",
  "SPEED",
  "REPERTOIRE",
  "OTHER",
] as const;
export const METRIC_TYPES = [
  "DURATION",
  "COUNT",
  "SPEED",
  "ACCURACY",
  "SUBJECTIVE_SCORE",
  "CUSTOM",
] as const;
export const EVIDENCE_REQUIREMENTS = ["NONE", "AUDIO", "SELF_REVIEW", "AUDIO_AND_SELF_REVIEW"] as const;
export const GOAL_STATUSES = ["OPEN", "IN_PROGRESS", "ACHIEVED", "MISSED", "CANCELLED"] as const;
export const PIECE_STATUSES = ["ACTIVE", "MERGED", "ARCHIVED"] as const;
export const MERGE_CONFLICT_FIELDS = ["KEY", "DIFFICULTY", "COMPOSER"] as const;
export const MERGE_CONFLICT_RESOLUTIONS = [
  "KEEP_TARGET",
  "USE_SOURCE",
  "USE_CUSTOM",
  "DISMISSED",
] as const;

const requiredText = (label: string, max: number) =>
  z.string().trim().min(1, `${label}不能为空`).max(max, `${label}不能超过 ${max} 个字符`);
const optionalText = (max: number, label: string) =>
  z.string().trim().max(max, `${label}不能超过 ${max} 个字符`).optional().nullable();

export const emailSchema = z.string().trim().toLowerCase().email("邮箱格式不正确").max(254);
export const passwordSchema = z
  .string()
  .min(10, "密码至少 10 位")
  .max(128, "密码不能超过 128 位")
  .regex(/[A-Za-z]/, "密码必须包含字母")
  .regex(/[0-9]/, "密码必须包含数字");

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: requiredText("展示名", 80),
});
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "请输入密码").max(128),
});
export const updateProfileSchema = z.object({
  displayName: requiredText("展示名", 80).optional(),
  defaultInstrument: optionalText(60, "默认乐器"),
  timezone: z.string().trim().min(1).max(64).optional(),
  locale: z.string().trim().min(2).max(16).optional(),
});
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const sessionCreateSchema = z.object({
  title: requiredText("练习标题", 120),
  instrument: requiredText("乐器", 60),
  pieceId: z.string().uuid().optional().nullable(),
  startedAt: z.coerce.date(),
  focus: optionalText(500, "本次重点"),
  location: optionalText(120, "练习地点"),
  notes: optionalText(5000, "总体备注"),
  actualDurationMs: z.coerce.number().int().positive().max(86_400_000).optional().nullable(),
});
export const sessionUpdateSchema = sessionCreateSchema
  .partial()
  .extend({ version: z.coerce.number().int().nonnegative() });
export const sessionBatchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});
export const sessionListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum([...SESSION_STATUSES, "ALL"]).default("COMPLETED"),
  instrument: z.string().trim().max(60).optional(),
  pieceId: z.string().uuid().optional(),
  tag: z.string().trim().max(40).optional(),
  annotationType: z.enum(ANNOTATION_TYPES).optional(),
  goalStatus: z.enum(GOAL_STATUSES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sortBy: z.enum(["startedAt", "actualDurationMs", "annotationCount", "updatedAt"]).default("startedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const annotationCreateBaseSchema = z.object({
  mediaId: z.string().uuid(),
  type: z.enum(ANNOTATION_TYPES),
  severity: z.coerce.number().int().min(1).max(5),
  startMs: z.coerce.number().int().nonnegative(),
  endMs: z.coerce.number().int().positive(),
  title: requiredText("短标题", 80),
  description: optionalText(2000, "详细描述"),
  nextAction: optionalText(1000, "建议动作"),
});

export const annotationCreateSchema = annotationCreateBaseSchema
  .refine((value) => value.endMs > value.startMs, {
    path: ["endMs"],
    message: "结束时间必须晚于开始时间",
  })
  .refine((value) => value.endMs - value.startMs >= 100, {
    path: ["endMs"],
    message: "标记区间至少 100 毫秒",
  });
export const annotationUpdateSchema = annotationCreateBaseSchema.partial().omit({ mediaId: true });
export const annotationListQuerySchema = z.object({
  mediaId: z.string().uuid().optional(),
  type: z.enum(ANNOTATION_TYPES).optional(),
});

export const reviewDraftSchema = z.object({
  goodPoints: optionalText(3000, "做得好的地方"),
  mainIssues: optionalText(3000, "主要问题"),
  nextFocus: optionalText(500, "下次练习重点"),
  noIssues: z.boolean().default(false),
  suggestedNextPracticeAt: z.coerce.date().optional().nullable(),
});
export const reviewSaveSchema = reviewDraftSchema.extend({
  version: z.coerce.number().int().nonnegative(),
});

export const goalCreateSchema = z.object({
  sourceSessionId: z.string().uuid(),
  annotationId: z.string().uuid().optional().nullable(),
  title: requiredText("目标标题", 160),
  category: z.enum(GOAL_CATEGORIES),
  metricType: z.enum(METRIC_TYPES),
  baselineValue: z.coerce.number().finite().optional().nullable(),
  targetValue: z.coerce.number().finite(),
  unit: requiredText("单位", 24),
  dueDate: z.coerce.date(),
  method: optionalText(3000, "练习方法"),
  evidenceRequirement: z.enum(EVIDENCE_REQUIREMENTS),
});
export const goalUpdateSchema = goalCreateSchema
  .omit({ sourceSessionId: true })
  .partial()
  .extend({ version: z.coerce.number().int().nonnegative() });
export const goalListQuerySchema = z.object({
  status: z.enum(GOAL_STATUSES).optional(),
  category: z.enum(GOAL_CATEGORIES).optional(),
  instrument: z.string().trim().max(60).optional(),
  dueBefore: z.coerce.date().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const goalProgressCreateSchema = z.object({
  sessionId: z.string().uuid(),
  actualValue: z.coerce.number().finite(),
  note: optionalText(1000, "进度备注"),
  evidenceMediaId: z.string().uuid().optional().nullable(),
  recordedAt: z.coerce.date().optional(),
});
export const goalCancelSchema = z.object({ reason: requiredText("取消原因", 1000) });
export const goalActivateSchema = z.object({
  dueDate: z.coerce.date().optional(),
  targetValue: z.coerce.number().finite().optional(),
});

export const completionGoalProgressSchema = goalProgressCreateSchema.omit({ sessionId: true }).extend({
  goalId: z.string().uuid(),
});

const pieceTagSchema = z.string().trim().min(1, "标签不能为空").max(40, "标签不能超过 40 个字符");
const pieceKeySchema = z
  .string()
  .trim()
  .min(1, "调性不能为空")
  .max(40, "调性不能超过 40 个字符")
  .regex(/^[A-G](?:#|b)?(?:\s?(?:maj|min|m|major|minor|dorian|mixolydian))?$/i, "调性格式不正确，例如 C、Am、Bb major、G#min");
const pieceDifficultySchema = z.coerce.number().int().min(1, "难度最低为 1").max(5, "难度最高为 5");

export const pieceCreateSchema = z.object({
  title: requiredText("曲目名称", 160),
  composer: optionalText(160, "作曲家"),
  key: pieceKeySchema.optional().nullable(),
  difficulty: pieceDifficultySchema.optional().nullable(),
  tags: z.array(pieceTagSchema).max(30).default([]),
  aliases: z.array(requiredText("别名", 160)).max(20).default([]),
  notes: optionalText(3000, "曲目备注"),
  allowDuplicate: z.coerce.boolean().default(false),
});
export const pieceUpdateSchema = pieceCreateSchema
  .omit({ allowDuplicate: true })
  .partial()
  .extend({ version: z.coerce.number().int().nonnegative(), allowDuplicate: z.coerce.boolean().optional() });
export const pieceListQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  composer: z.string().trim().max(160).optional(),
  key: z.string().trim().max(40).optional(),
  difficulty: z.coerce.number().int().min(1).max(5).optional(),
  tag: pieceTagSchema.optional(),
  status: z.enum(PIECE_STATUSES).default("ACTIVE"),
  sortBy: z.enum(["updatedAt", "lastPracticedAt", "practiceCount", "difficulty", "title"]).default("updatedAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export const pieceMergeSchema = z.object({
  sourcePieceId: z.string().uuid(),
});
export const pieceMergeListQuerySchema = z.object({
  status: z.enum(["CONFLICTS_PENDING", "RESOLVED", "ALL"]).default("CONFLICTS_PENDING"),
});
export const mergeConflictResolveSchema = z.object({
  resolution: z.enum(MERGE_CONFLICT_RESOLUTIONS),
  customValue: z.string().trim().max(160).optional(),
});
export const sessionLinkPieceSchema = z.object({
  pieceId: z.string().uuid().nullable(),
  version: z.coerce.number().int().nonnegative().optional(),
});

export const completionSchema = z.object({
  version: z.coerce.number().int().nonnegative(),
  review: reviewDraftSchema.extend({ nextFocus: requiredText("下次练习重点", 500) }),
  goalCreates: z.array(goalCreateSchema.omit({ sourceSessionId: true })).default([]),
  goalProgressUpdates: z.array(completionGoalProgressSchema).default([]),
  annotationVersion: z.coerce.number().int().nonnegative().optional(),
});

export const statisticsRangeSchema = z.object({
  from: z.coerce.date(),
  to: z.coerce.date(),
  timezone: z.string().trim().min(1).max(64).default("Asia/Shanghai"),
  instrument: z.string().trim().max(60).optional(),
});

export const createExportSchema = z.object({
  format: z.enum(["json", "csv"]).default("json"),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const idSchema = z.string().uuid();

export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type MediaStatus = (typeof MEDIA_STATUSES)[number];
export type AnnotationType = (typeof ANNOTATION_TYPES)[number];
export type GoalCategory = (typeof GOAL_CATEGORIES)[number];
export type MetricType = (typeof METRIC_TYPES)[number];
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export type EvidenceRequirement = (typeof EVIDENCE_REQUIREMENTS)[number];
export type PieceStatus = (typeof PIECE_STATUSES)[number];
export type MergeConflictField = (typeof MERGE_CONFLICT_FIELDS)[number];
export type MergeConflictResolution = (typeof MERGE_CONFLICT_RESOLUTIONS)[number];

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    traceId?: string;
  };
}

const allowedTransitions: Record<SessionStatus, SessionStatus[]> = {
  DRAFT: ["IN_REVIEW", "DELETING"],
  IN_REVIEW: ["DRAFT", "COMPLETED", "DELETING"],
  COMPLETED: ["ARCHIVED", "DELETING", "COMPLETED"],
  ARCHIVED: ["COMPLETED", "DELETING"],
  DELETING: ["DELETE_FAILED"],
  DELETE_FAILED: ["DELETING"],
};

export function canTransitionSession(from: SessionStatus, to: SessionStatus): boolean {
  return from === to || allowedTransitions[from].includes(to);
}

export function validateAnnotationRange(
  startMs: number,
  endMs: number,
  durationMs?: number | null,
): { ok: true } | { ok: false; code: string; message: string } {
  if (!Number.isInteger(startMs) || startMs < 0) {
    return { ok: false, code: "AUDIO_RANGE_INVALID", message: "开始时间必须是非负整数毫秒值" };
  }
  if (!Number.isInteger(endMs) || endMs <= startMs) {
    return { ok: false, code: "AUDIO_RANGE_INVALID", message: "结束时间必须晚于开始时间" };
  }
  if (endMs - startMs < 100) {
    return { ok: false, code: "AUDIO_RANGE_INVALID", message: "标记区间至少 100 毫秒" };
  }
  if (durationMs != null && endMs > durationMs) {
    return { ok: false, code: "AUDIO_RANGE_INVALID", message: "标记结束时间不能超出音频时长" };
  }
  return { ok: true };
}

export function isGoalProgressValid(actualValue: number, targetValue: number): boolean {
  return Number.isFinite(actualValue) && Number.isFinite(targetValue) && actualValue >= targetValue;
}

export function calculateSessionDuration(mediaDurationsMs: Array<number | null | undefined>): number {
  return mediaDurationsMs.reduce<number>((total, duration) => total + (duration && duration > 0 ? duration : 0), 0);
}

export function describeMissingReview(input: {
  readyMediaCount: number;
  annotationCount: number;
  noIssues: boolean;
  nextFocus?: string | null;
  openGoalCount: number;
  newGoalCount: number;
  progressUpdateCount: number;
}): string[] {
  const missing: string[] = [];
  if (input.readyMediaCount < 1) missing.push("至少需要一段已解析完成的音频");
  if (input.annotationCount < 1 && !input.noIssues) missing.push("请至少添加一个问题标记，或声明本次无异常");
  if (!input.nextFocus?.trim()) missing.push("请填写下次练习重点");
  if (input.openGoalCount < 1 && input.newGoalCount < 1) missing.push("请至少创建一个可执行目标");
  if (input.openGoalCount > 0 && input.progressUpdateCount < 1) {
    missing.push("已有未关闭目标时，本次至少记录一次目标进度");
  }
  return missing;
}

const KEY_ALIASES: Record<string, string> = {
  maj: "maj",
  min: "min",
  major: "maj",
  minor: "min",
  m: "min",
  dorian: "dorian",
  mixolydian: "mixolydian",
};

/** 规范化调性写法，用于比较与存储，例如 "bb min" -> "Bbmin"。 */
export function normalizeKeySignature(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const match = /^([a-g])(#|b)?(?:\s*(maj|min|m|major|minor|dorian|mixolydian))?$/i.exec(trimmed);
  if (!match) {
    // 无法解析的写法原样保留并压缩空白，避免误判用户自定义调式。
    return trimmed.replace(/\s+/g, " ");
  }
  const letter = match[1]!.toUpperCase();
  const accidental = match[2] ?? "";
  const modeRaw = match[3]?.toLowerCase();
  const mode = modeRaw ? (KEY_ALIASES[modeRaw] ?? "") : "";
  return `${letter}${accidental}${mode}`;
}

/** 去除首尾空白、连续空白、大小写与常见标点差异，作为重复曲目的归一比较键。 */
export function normalizePieceText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .replace(/[​‌‍﻿]/g, "")
    .replace(/[【】《》「」『』]/g, "")
    .replace(/[[\]()（）"'`.,，。;:：;!！?？]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/(?<=[一-鿿])\s+(?=[一-鿿])/g, "")
    .trim()
    .toLowerCase();
}

function uniqueMerge(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = value?.trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}

export interface MergeCandidateSummary {
  title: string;
  composer?: string | null;
  aliases?: string[];
}

/** 判断新曲目是否与已有条目疑似重复：标题/别名相等且作曲家未冲突。 */
export function isDuplicatePiece(candidate: MergeCandidateSummary, existing: MergeCandidateSummary): boolean {
  const candidateTitles = uniqueMerge([candidate.title, ...(candidate.aliases ?? [])]).map((item) =>
    normalizePieceText(item),
  );
  const existingTitles = uniqueMerge([existing.title, ...(existing.aliases ?? [])]).map((item) =>
    normalizePieceText(item),
  );
  if (!candidateTitles.some((item) => existingTitles.includes(item))) return false;
  const candidateComposer = normalizePieceText(candidate.composer ?? null);
  const existingComposer = normalizePieceText(existing.composer ?? null);
  return candidateComposer === "" || existingComposer === "" || candidateComposer === existingComposer;
}

export interface PieceMergeInput {
  title: string | null;
  composer: string | null;
  key: string | null;
  difficulty: number | null;
  aliases: string[];
  tags: string[];
  notes: string | null;
}

export interface PlannedMergeConflict {
  field: MergeConflictField;
  sourceValue: string | null;
  targetValue: string | null;
}

export interface PieceMergePlan {
  title: string | null;
  composer: string | null;
  key: string | null;
  difficulty: number | null;
  aliases: string[];
  tags: string[];
  notes: string | null;
  conflicts: PlannedMergeConflict[];
}

/**
 * 规划原子迁移：练习、别名、标签和备注可无冲突合并；
 * 调性、难度、作曲家在两侧均有值且不一致时保留为待处理冲突，不自动覆盖。
 */
export function planPieceMerge(source: PieceMergeInput, target: PieceMergeInput): PieceMergePlan {
  const conflicts: PlannedMergeConflict[] = [];
  const addConflict = (
    field: MergeConflictField,
    sourceValue: string | number | null,
    targetValue: string | number | null,
  ): void => {
    conflicts.push({
      field,
      sourceValue: sourceValue == null ? null : String(sourceValue),
      targetValue: targetValue == null ? null : String(targetValue),
    });
  };

  const sourceKey = normalizeKeySignature(source.key);
  const targetKey = normalizeKeySignature(target.key);
  if (sourceKey && targetKey && sourceKey !== targetKey) addConflict("KEY", sourceKey, targetKey);

  if (source.difficulty != null && target.difficulty != null && source.difficulty !== target.difficulty) {
    addConflict("DIFFICULTY", source.difficulty, target.difficulty);
  }

  const sourceComposer = source.composer?.trim() || null;
  const targetComposer = target.composer?.trim() || null;
  if (sourceComposer && targetComposer && normalizePieceText(sourceComposer) !== normalizePieceText(targetComposer)) {
    addConflict("COMPOSER", sourceComposer, targetComposer);
  }

  const title = target.title?.trim() || source.title;
  const resolvedKey = targetKey ?? sourceKey;
  const resolvedDifficulty = target.difficulty ?? source.difficulty;
  const resolvedComposer = targetComposer ?? sourceComposer;
  const aliases = uniqueMerge([
    ...target.aliases,
    ...source.aliases,
    source.title,
    sourceComposer !== resolvedComposer ? sourceComposer : null,
  ]).filter((alias) => normalizePieceText(alias) !== normalizePieceText(title));
  const tags = uniqueMerge([...target.tags, ...source.tags]);
  const notes = uniqueMerge([target.notes, source.notes]).join("\n\n---\n\n") || null;

  return {
    title,
    composer: resolvedComposer,
    key: resolvedKey,
    difficulty: resolvedDifficulty,
    aliases,
    tags,
    notes,
    conflicts,
  };
}

/** 应用某条冲突的处理决定，返回新的目标字段值；未涉及字段保持原值。 */
export function resolveMergeConflict(
  current: Pick<PieceMergePlan, "composer" | "key" | "difficulty">,
  conflict: PlannedMergeConflict,
  resolution: MergeConflictResolution,
  customValue?: string | null,
): { composer: string | null; key: string | null; difficulty: number | null } {
  const next = { composer: current.composer, key: current.key, difficulty: current.difficulty };
  const applyValue = (value: string | null): void => {
    if (conflict.field === "KEY") next.key = value ? normalizeKeySignature(value) : null;
    if (conflict.field === "COMPOSER") next.composer = value;
    if (conflict.field === "DIFFICULTY") {
      next.difficulty = value == null ? null : Number(value);
    }
  };
  if (resolution === "DISMISSED" || resolution === "KEEP_TARGET") {
    if (resolution === "KEEP_TARGET") applyValue(conflict.targetValue);
    return next;
  }
  if (resolution === "USE_SOURCE") {
    applyValue(conflict.sourceValue);
    return next;
  }
  const custom = customValue?.trim() || null;
  if (conflict.field === "KEY") next.key = custom ? normalizeKeySignature(custom) : null;
  if (conflict.field === "COMPOSER") next.composer = custom;
  if (conflict.field === "DIFFICULTY") {
    const parsed = custom == null ? NaN : Number(custom);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
      throw new Error("自定义难度必须是 1 到 5 的整数");
    }
    next.difficulty = parsed;
  }
  return next;
}
