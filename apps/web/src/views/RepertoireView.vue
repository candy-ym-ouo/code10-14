<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { apiFetch, ApiError } from "../api/client.js";
import EmptyState from "../components/EmptyState.vue";
import LoadingBlock from "../components/LoadingBlock.vue";
import {
  formatDateTime,
  formatDuration,
  mergeFieldLabels,
  mergeResolutionLabels,
  mergeStatusLabels,
  pieceStatusLabels,
} from "../utils/format.js";

interface Piece {
  id: string;
  title: string;
  composer: string | null;
  key: string | null;
  difficulty: number | null;
  tags: string[];
  aliases: string[];
  notes: string | null;
  status: "ACTIVE" | "MERGED" | "ARCHIVED";
  version: number;
  practiceCount: number;
  totalPracticeMs: number;
  lastPracticedAt: string | null;
  mergedInto: { id: string; title: string } | null;
  _count?: { sessions: number };
}
interface MergeConflict {
  id: string;
  field: "KEY" | "DIFFICULTY" | "COMPOSER";
  sourceValue: string | null;
  targetValue: string | null;
  status: "PENDING" | "KEEP_TARGET" | "USE_SOURCE" | "USE_CUSTOM" | "DISMISSED";
}
interface PieceDetail extends Piece {
  sessions: Array<{ id: string; title: string; instrument: string; startedAt: string; actualDurationMs: number; status: string }>;
  absorbedPieces?: unknown[];
}
interface MergeJob {
  id: string;
  status: "CONFLICTS_PENDING" | "RESOLVED";
  migratedSessions: number;
  createdAt: string;
  sourcePiece: { id: string; title: string; composer: string | null; key: string | null; difficulty: number | null; tags: string[] };
  targetPiece: { id: string; title: string; composer: string | null; key: string | null; difficulty: number | null; tags: string[] };
  conflicts: MergeConflict[];
}

const pieces = ref<Piece[]>([]);
const merges = ref<MergeJob[]>([]);
const loading = ref(true);
const error = ref("");
const formError = ref("");
const successMessage = ref("");
const statusFilter = ref<"ACTIVE" | "MERGED" | "ARCHIVED">("ACTIVE");
const search = ref("");
const tagFilter = ref("");
const difficultyFilter = ref("");
const tagOptions = ref<Array<{ tag: string; count: number }>>([]);
const editingId = ref<string | null>(null);
const mergeTarget = ref<Piece | null>(null);
const mergeCandidates = ref<Piece[]>([]);
const mergeModalOpen = ref(false);
const selectedSourceId = ref("");
const detailPiece = ref<PieceDetail | null>(null);

const emptyForm = () => ({
  title: "",
  composer: "",
  key: "",
  difficulty: "",
  tagsText: "",
  aliasesText: "",
  notes: "",
  version: 0,
});
const form = reactive(emptyForm());
const showForm = ref(false);

const pendingConflictCount = computed(() =>
  merges.value.reduce((total, job) => total + job.conflicts.filter((item) => item.status === "PENDING").length, 0),
);

function toTagList(text: string): string[] {
  return [...new Set(text.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean))];
}
function fillForm(piece: Piece): void {
  form.title = piece.title;
  form.composer = piece.composer ?? "";
  form.key = piece.key ?? "";
  form.difficulty = piece.difficulty == null ? "" : String(piece.difficulty);
  form.tagsText = piece.tags.join(", ");
  form.aliasesText = piece.aliases.join(", ");
  form.notes = piece.notes ?? "";
  form.version = piece.version;
}
function resetForm(): void {
  Object.assign(form, emptyForm());
  editingId.value = null;
  formError.value = "";
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const params = new URLSearchParams({ status: statusFilter.value, limit: "100" });
    if (search.value.trim()) params.set("q", search.value.trim());
    if (tagFilter.value) params.set("tag", tagFilter.value);
    if (difficultyFilter.value) params.set("difficulty", difficultyFilter.value);
    const [pieceResult, mergeResult, tagResult] = await Promise.all([
      apiFetch<{ data: Piece[] }>(`/api/v1/repertoire/pieces?${params.toString()}`),
      apiFetch<{ data: MergeJob[] }>("/api/v1/repertoire/merges?status=ALL"),
      apiFetch<{ data: Array<{ tag: string; count: number }> }>("/api/v1/repertoire/pieces/tags"),
    ]);
    pieces.value = pieceResult.data;
    merges.value = mergeResult.data;
    tagOptions.value = tagResult.data;
    for (const job of mergeResult.data) {
      for (const conflict of job.conflicts) {
        if (conflict.status === "PENDING") ensureDraft(conflict.id);
      }
    }
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "曲目库加载失败";
  } finally {
    loading.value = false;
  }
}

async function submitPiece(): Promise<void> {
  formError.value = "";
  const body = {
    title: form.title,
    composer: form.composer || null,
    key: form.key || null,
    difficulty: form.difficulty === "" ? null : Number(form.difficulty),
    tags: toTagList(form.tagsText),
    aliases: toTagList(form.aliasesText),
    notes: form.notes || null,
    allowDuplicate: false,
  };
  try {
    if (editingId.value) {
      await apiFetch(`/api/v1/repertoire/pieces/${editingId.value}`, {
        method: "PATCH",
        body: JSON.stringify({ ...body, version: form.version }),
      });
    } else {
      await apiFetch("/api/v1/repertoire/pieces", { method: "POST", body: JSON.stringify(body) });
    }
    showForm.value = false;
    resetForm();
    await load();
  } catch (reason) {
    if (reason instanceof ApiError && reason.code === "PIECE_DUPLICATE") {
      formError.value = `${reason.message}。仍要保存请勾选“确认重复仍保存”，或前往合并。`;
    } else {
      formError.value = reason instanceof ApiError ? reason.message : "保存失败";
    }
  }
}
async function forceSubmitPiece(): Promise<void> {
  if (!window.confirm("确认这不是重复条目并继续保存？")) return;
  formError.value = "";
  const body = {
    title: form.title,
    composer: form.composer || null,
    key: form.key || null,
    difficulty: form.difficulty === "" ? null : Number(form.difficulty),
    tags: toTagList(form.tagsText),
    aliases: toTagList(form.aliasesText),
    notes: form.notes || null,
    allowDuplicate: true,
    ...(editingId.value ? { version: form.version } : {}),
  };
  const path = editingId.value ? `/api/v1/repertoire/pieces/${editingId.value}` : "/api/v1/repertoire/pieces";
  const method = editingId.value ? "PATCH" : "POST";
  await apiFetch(path, { method, body: JSON.stringify(body) });
  showForm.value = false;
  resetForm();
  await load();
}

function startCreate(): void {
  resetForm();
  showForm.value = true;
}
function startEdit(piece: Piece): void {
  fillForm(piece);
  editingId.value = piece.id;
  showForm.value = true;
}

async function openMerge(piece: Piece): Promise<void> {
  mergeTarget.value = piece;
  selectedSourceId.value = "";
  mergeModalOpen.value = true;
  try {
    mergeCandidates.value = (
      await apiFetch<{ data: Piece[] }>(`/api/v1/repertoire/pieces/${piece.id}/duplicates`)
    ).data;
  } catch {
    mergeCandidates.value = [];
  }
}
function closeMerge(): void {
  mergeModalOpen.value = false;
  mergeTarget.value = null;
  mergeCandidates.value = [];
  selectedSourceId.value = "";
}
async function confirmMerge(): Promise<void> {
  if (!mergeTarget.value || !selectedSourceId.value) return;
  if (!window.confirm(`将“${mergeCandidates.value.find((p) => p.id === selectedSourceId.value)?.title}”合并入“${mergeTarget.value.title}”？练习记录会原子迁移，无法撤销。`)) return;
  const targetId = mergeTarget.value.id;
  const sourceId = selectedSourceId.value;
  await apiFetch(`/api/v1/repertoire/pieces/${targetId}/merge`, {
    method: "POST",
    body: JSON.stringify({ sourcePieceId: sourceId }),
  });
  closeMerge();
  successMessage.value = "合并完成，练习引用已迁移；如有冲突请在待处理事项中逐项确认。";
  await load();
}

const resolveDraft = reactive<Record<string, { choice: string; custom: string; busy: boolean; error: string }>>({});
function ensureDraft(conflictId: string): void {
  if (!resolveDraft[conflictId]) resolveDraft[conflictId] = { choice: "", custom: "", busy: false, error: "" };
}
function draftOf(conflictId: string): { choice: string; custom: string; busy: boolean; error: string } {
  ensureDraft(conflictId);
  return resolveDraft[conflictId]!;
}
async function resolve(job: MergeJob, conflict: MergeConflict): Promise<void> {
  ensureDraft(conflict.id);
  const draft = resolveDraft[conflict.id]!;
  if (!draft.choice) {
    draft.error = "请先选择处理方式";
    return;
  }
  draft.busy = true;
  draft.error = "";
  try {
    await apiFetch(`/api/v1/repertoire/merges/${job.id}/conflicts/${conflict.id}/resolve`, {
      method: "POST",
      body: JSON.stringify({
        resolution: draft.choice,
        ...(draft.choice === "USE_CUSTOM" ? { customValue: draft.custom } : {}),
      }),
    });
    await load();
  } catch (reason) {
    draft.error = reason instanceof ApiError ? reason.message : "处理失败";
  } finally {
    draft.busy = false;
  }
}

async function archive(piece: Piece): Promise<void> {
  if (!window.confirm(`归档“${piece.title}”？历史练习仍会保留。`)) return;
  await apiFetch(`/api/v1/repertoire/pieces/${piece.id}/archive`, { method: "POST", body: "{}" });
  await load();
}
async function restore(piece: Piece): Promise<void> {
  await apiFetch(`/api/v1/repertoire/pieces/${piece.id}/restore`, { method: "POST", body: "{}" });
  await load();
}

async function openDetail(piece: Piece): Promise<void> {
  detailPiece.value = (await apiFetch<{ piece: PieceDetail }>(`/api/v1/repertoire/pieces/${piece.id}`)).piece;
}

onMounted(load);
</script>

<template>
  <section class="page">
    <header class="page-header">
      <div>
        <h1>曲目资料库</h1>
        <p>维护每首曲目的调性、难度、问题标签和历史练习；重复条目可以原子合并，冲突字段保留为待处理事项。</p>
      </div>
      <button class="button" @click="startCreate">＋ 新建曲目</button>
    </header>

    <div v-if="successMessage" class="alert success" style="margin-bottom: 16px">{{ successMessage }}</div>

    <div class="card stack" v-if="showForm">
      <div class="row between"><h2 style="margin: 0">{{ editingId ? "编辑曲目" : "新建曲目" }}</h2><button class="button small ghost" @click="showForm = false; resetForm()">取消</button></div>
      <div v-if="formError" class="alert">
        {{ formError }}
        <button class="button small danger" style="margin-left: 10px" @click="forceSubmitPiece">确认重复仍保存</button>
      </div>
      <form class="form-grid" @submit.prevent="submitPiece">
        <label class="field full"><span>曲目名称</span><input v-model="form.title" required maxlength="160" placeholder="例如：月光奏鸣曲 第一乐章" /></label>
        <label class="field"><span>作曲家</span><input v-model="form.composer" maxlength="160" placeholder="例如：贝多芬" /></label>
        <label class="field"><span>调性</span><input v-model="form.key" maxlength="40" placeholder="例如 C、Am、Bb major" /></label>
        <label class="field">
          <span>难度（1–5）</span>
          <select v-model="form.difficulty">
            <option value="">未评估</option>
            <option v-for="n in 5" :key="n" :value="String(n)">{{ n }} {{ ["", "入门", "初级", "中级", "进阶", "高难"][n] }}</option>
          </select>
        </label>
        <label class="field"><span>问题标签（逗号分隔）</span><input v-model="form.tagsText" maxlength="600" placeholder="音准, 换把, 力度" /></label>
        <label class="field full"><span>别名 / 其他写法（逗号分隔，用于识别重复）</span><input v-model="form.aliasesText" maxlength="600" placeholder="例如：Moonlight Sonata, 第十四钢琴奏鸣曲" /></label>
        <label class="field full"><span>曲目备注</span><textarea v-model="form.notes" maxlength="3000" rows="3" placeholder="常见难点、版本、练习笔记"></textarea></label>
        <div class="row end full"><button class="button" type="submit">{{ editingId ? "保存修改" : "创建曲目" }}</button></div>
      </form>
    </div>

    <div class="card stack" style="margin: 16px 0">
      <div class="row wrap">
        <input v-model="search" class="search-input" placeholder="搜索名称、作曲家、别名或标签" @keyup.enter="load" />
        <select v-model="tagFilter" @change="load">
          <option value="">全部标签</option>
          <option v-for="item in tagOptions" :key="item.tag" :value="item.tag">{{ item.tag }}（{{ item.count }}）</option>
        </select>
        <select v-model="difficultyFilter" @change="load">
          <option value="">全部难度</option>
          <option v-for="n in 5" :key="n" :value="String(n)">难度 {{ n }}</option>
        </select>
        <button class="button small ghost" @click="search = ''; tagFilter = ''; difficultyFilter = ''; load()">重置</button>
        <button class="button small" @click="load">搜索</button>
      </div>
      <div class="tabs">
        <button v-for="item in ['ACTIVE', 'MERGED', 'ARCHIVED']" :key="item" class="tab" :class="{ active: statusFilter === item }" @click="statusFilter = item as 'ACTIVE' | 'MERGED' | 'ARCHIVED'; load()">{{ pieceStatusLabels[item] }}</button>
      </div>
    </div>

    <LoadingBlock v-if="loading" />
    <div v-else-if="error" class="alert">{{ error }} <button class="button small ghost" @click="load">重试</button></div>
    <EmptyState v-else-if="!pieces.length" title="还没有曲目" description="新建第一首曲目，或先在练习中选择关联曲目。" />
    <div v-else class="piece-grid">
      <article v-for="piece in pieces" :key="piece.id" class="card stack piece-card">
        <div class="row between">
          <button class="piece-title" @click="openDetail(piece)">{{ piece.title }}</button>
          <span class="status-pill" :class="piece.status.toLowerCase()">{{ pieceStatusLabels[piece.status] }}</span>
        </div>
        <div class="muted small-line">
          {{ piece.composer || "作曲家未填写" }} · 调性 {{ piece.key || "—" }} · 难度
          <span class="difficulty">{{ piece.difficulty ? "★".repeat(piece.difficulty) : "未评估" }}</span>
        </div>
        <div v-if="piece.tags.length" class="tag-row">
          <span v-for="tag in piece.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>
        <dl class="piece-meta">
          <div><dt>历史练习</dt><dd>{{ piece.practiceCount }} 次 · {{ formatDuration(piece.totalPracticeMs) }}</dd></div>
          <div><dt>最近练习</dt><dd>{{ formatDateTime(piece.lastPracticedAt) }}</dd></div>
        </dl>
        <small v-if="piece.mergedInto" class="muted">已合并入：<strong>{{ piece.mergedInto.title }}</strong>（练习记录已迁移）</small>
        <div class="row wrap">
          <button class="button small secondary" @click="openDetail(piece)">详情/历史</button>
          <template v-if="piece.status === 'ACTIVE'">
            <button class="button small ghost" @click="startEdit(piece)">编辑</button>
            <button class="button small ghost" @click="openMerge(piece)">合并重复</button>
            <button class="button small ghost" @click="archive(piece)">归档</button>
          </template>
          <button v-else-if="piece.status === 'ARCHIVED'" class="button small ghost" @click="restore(piece)">恢复</button>
        </div>
      </article>
    </div>

    <section style="margin-top: 30px">
      <header class="row between" style="margin-bottom: 12px">
        <h2>合并记录与待处理冲突 <span v-if="pendingConflictCount" class="conflict-badge">{{ pendingConflictCount }} 待处理</span></h2>
      </header>
      <EmptyState v-if="!merges.length" title="还没有合并记录" description="在曲目卡片上点击“合并重复”即可把重复条目的练习记录原子迁移过来。" />
      <div v-else class="stack">
        <article v-for="job in merges" :key="job.id" class="card stack merge-card">
          <div class="row between wrap">
            <div>
              <strong>{{ job.sourcePiece.title }}</strong>
              <span class="muted"> → 合并入 → </span>
              <strong>{{ job.targetPiece.title }}</strong>
            </div>
            <div class="row">
              <span class="status-pill" :class="job.status === 'RESOLVED' ? 'active' : 'merged'">{{ mergeStatusLabels[job.status] }}</span>
              <small class="muted">迁移练习 {{ job.migratedSessions }} 次 · {{ formatDateTime(job.createdAt) }}</small>
            </div>
          </div>
          <div v-if="job.conflicts.length" class="stack">
            <div v-for="conflict in job.conflicts" :key="conflict.id" class="conflict-row">
              <div class="conflict-values">
                <strong>{{ mergeFieldLabels[conflict.field] }}</strong>
                <small>来源：{{ conflict.sourceValue || "（空）" }}</small>
                <small>保留条目：{{ conflict.targetValue || "（空）" }}</small>
                <small v-if="conflict.status !== 'PENDING'" class="muted">已处理：{{ mergeResolutionLabels[conflict.status as keyof typeof mergeResolutionLabels] ?? conflict.status }}</small>
              </div>
              <template v-if="conflict.status === 'PENDING'">
                <div class="conflict-actions">
                  <select v-model="draftOf(conflict.id).choice">
                    <option value="" disabled>选择处理方式</option>
                    <option value="KEEP_TARGET">保留当前值（{{ conflict.targetValue || "空" }}）</option>
                    <option value="USE_SOURCE">采用来源值（{{ conflict.sourceValue || "空" }}）</option>
                    <option value="USE_CUSTOM">使用自定义值</option>
                    <option value="DISMISSED">暂不处理</option>
                  </select>
                  <input
                    v-if="draftOf(conflict.id).choice === 'USE_CUSTOM'"
                    v-model="draftOf(conflict.id).custom"
                    :placeholder="conflict.field === 'DIFFICULTY' ? '输入 1–5 的整数' : '输入自定义值'"
                  />
                  <small v-if="draftOf(conflict.id).error" class="conflict-error">{{ draftOf(conflict.id).error }}</small>
                  <button class="button small" :disabled="draftOf(conflict.id).busy" @click="resolve(job, conflict)">
                    {{ draftOf(conflict.id).busy ? "处理中…" : "确认" }}
                  </button>
                </div>
              </template>
            </div>
          </div>
        </article>
      </div>
    </section>
  </section>

  <div v-if="mergeModalOpen && mergeTarget" class="modal-backdrop" @click.self="closeMerge">
    <div class="card stack modal">
      <div class="row between"><h2 style="margin: 0">合并重复条目到“{{ mergeTarget.title }}”</h2><button class="button small ghost" @click="closeMerge">关闭</button></div>
      <p class="muted" style="margin: 0">被选中的来源条目将保留可追溯记录，其全部练习、别名与标签会在单个事务中迁移；调性、难度、作曲家不一致时不会覆盖，而是生成待处理冲突。</p>
      <EmptyState v-if="!mergeCandidates.length" title="没有检测到疑似重复" description="可以调整名称或别名后重试，系统按归一化名称和别名匹配。" />
      <label v-else class="field">
        <span>选择来源条目</span>
        <select v-model="selectedSourceId">
          <option value="" disabled>请选择…</option>
          <option v-for="candidate in mergeCandidates" :key="candidate.id" :value="candidate.id">
            {{ candidate.title }}{{ candidate.composer ? ` · ${candidate.composer}` : "" }} · {{ candidate.practiceCount }} 次练习
          </option>
        </select>
      </label>
      <div class="row end">
        <button class="button ghost" @click="closeMerge">取消</button>
        <button class="button danger" :disabled="!selectedSourceId" @click="confirmMerge">确认原子合并</button>
      </div>
    </div>
  </div>

  <div v-if="detailPiece" class="modal-backdrop" @click.self="detailPiece = null">
    <div class="card stack modal modal-wide">
      <div class="row between">
        <h2 style="margin: 0">{{ detailPiece.title }}</h2>
        <button class="button small ghost" @click="detailPiece = null">关闭</button>
      </div>
      <div class="muted">{{ detailPiece.composer || "作曲家未填写" }} · 调性 {{ detailPiece.key || "—" }} · 难度 {{ detailPiece.difficulty ?? "未评估" }}</div>
      <div v-if="detailPiece.tags.length" class="tag-row"><span v-for="tag in detailPiece.tags" :key="tag" class="tag">{{ tag }}</span></div>
      <p v-if="detailPiece.notes" style="white-space: pre-wrap; margin: 0">{{ detailPiece.notes }}</p>
      <h3 style="margin: 0">历史练习</h3>
      <EmptyState v-if="!detailPiece.sessions.length" title="还没有关联练习" description="在新建或编辑练习时选择这首曲目即可累计历史。" />
      <ul v-else class="session-history">
        <li v-for="entry in detailPiece.sessions" :key="entry.id">
          <RouterLink :to="`/sessions/${entry.id}`">{{ entry.title }}</RouterLink>
          <small class="muted">{{ entry.instrument }} · {{ formatDateTime(entry.startedAt) }} · {{ formatDuration(entry.actualDurationMs) }}</small>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.piece-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.piece-card { align-content: start; }
.piece-title { border: 0; background: none; padding: 0; font-size: 1.08rem; font-weight: 800; text-align: left; color: var(--ink); cursor: pointer; }
.small-line { font-size: .88rem; }
.difficulty { color: #b07d12; letter-spacing: 1px; }
.tag-row { display: flex; flex-wrap: wrap; gap: 6px; }
.tag { padding: 2px 9px; border-radius: 999px; background: var(--primary-soft); color: var(--primary-strong); font-size: .8rem; font-weight: 650; }
.piece-meta { display: grid; gap: 6px; margin: 0; font-size: .88rem; }
.piece-meta dt { color: var(--muted); display: inline; }
.piece-meta dd { display: inline; margin: 0 0 0 6px; }
.status-pill { padding: 3px 10px; border-radius: 999px; font-size: .78rem; font-weight: 700; background: #e7ece9; color: #46524d; white-space: nowrap; }
.status-pill.active { background: #ddefe7; color: #1d6b4c; }
.status-pill.merged { background: #fdeed7; color: #8a5510; }
.status-pill.archived { background: #ece9e4; color: #6a625a; }
.search-input { flex: 1; min-width: 220px; padding: 9px 12px; border: 1px solid var(--line); border-radius: 10px; }
.conflict-badge { margin-left: 8px; padding: 2px 10px; border-radius: 999px; background: #fde2cf; color: #8c3f10; font-size: .8rem; }
.conflict-row { display: grid; grid-template-columns: 1fr minmax(260px, 1.2fr); gap: 14px; padding: 12px 0; border-top: 1px solid var(--line); }
.conflict-values { display: grid; gap: 3px; }
.conflict-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.conflict-actions select, .conflict-actions input { padding: 8px 10px; border: 1px solid var(--line); border-radius: 9px; min-width: 150px; }
.conflict-error { width: 100%; color: var(--danger); }
.modal-backdrop { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; padding: 24px; background: rgb(20 30 27 / 45%); }
.modal { width: min(560px, 100%); max-height: 86vh; overflow: auto; }
.modal-wide { width: min(720px, 100%); }
.session-history { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.session-history li { display: grid; gap: 2px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; }
@media (max-width: 800px) { .conflict-row { grid-template-columns: 1fr; } }
</style>
