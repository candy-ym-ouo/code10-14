<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { apiFetch, ApiError } from "../api/client.js";
import EmptyState from "../components/EmptyState.vue";
import LoadingBlock from "../components/LoadingBlock.vue";
import {
  formatDateTime,
  formatDifficulty,
  formatKeySignature,
  keySignatureOptions,
  pieceStatusLabels,
} from "../utils/format.js";

interface Piece {
  id: string;
  title: string;
  composer: string | null;
  movement: string | null;
  keySignature: string;
  difficulty: number | null;
  instrument: string | null;
  status: keyof typeof pieceStatusLabels;
  lastPracticedAt: string | null;
  version: number;
  mergedIntoId: string | null;
  mergedInto: { id: string; title: string } | null;
  tags: Array<{ id: string; name: string }>;
  _count: { practiceSessions: number };
}
interface TagOption { id: string; name: string; _count: { pieces: number } }
interface MergeConflict { field: string; targetValue: string | null; sourceValue: string | null }
interface MergeRecord {
  id: string;
  targetPiece: { id: string; title: string };
  sourcePiece: { id: string; title: string };
  conflicts: MergeConflict[];
}

const pieces = ref<Piece[]>([]);
const tags = ref<TagOption[]>([]);
const pendingMerges = ref<MergeRecord[]>([]);
const loading = ref(true);
const error = ref("");
const creating = ref(false);
const statusFilter = ref<"ACTIVE" | "ARCHIVED" | "MERGED">("ACTIVE");
const filters = reactive({ q: "", keySignature: "", difficulty: "", tag: "" });
const form = reactive({ title: "", composer: "", movement: "", keySignature: "UNKNOWN", difficulty: "", instrument: "", tags: "", notes: "" });

const fieldLabels: Record<string, string> = {
  composer: "作曲家",
  keySignature: "调性",
  difficulty: "难度",
  notes: "备注",
};

const pendingCount = computed(() => pendingMerges.value.length);

function buildQuery(): string {
  const params = new URLSearchParams({ status: statusFilter.value, limit: "100" });
  if (filters.q.trim()) params.set("q", filters.q.trim());
  if (filters.keySignature) params.set("keySignature", filters.keySignature);
  if (filters.difficulty) params.set("difficulty", filters.difficulty);
  if (filters.tag) params.set("tag", filters.tag);
  return `?${params.toString()}`;
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const [pieceResult, tagResult, mergeResult] = await Promise.all([
      apiFetch<{ data: Piece[] }>(`/api/v1/pieces${buildQuery()}`),
      apiFetch<{ data: TagOption[] }>("/api/v1/pieces/tags"),
      apiFetch<{ data: MergeRecord[] }>("/api/v1/pieces/merges"),
    ]);
    pieces.value = pieceResult.data;
    tags.value = tagResult.data;
    pendingMerges.value = mergeResult.data;
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "曲目资料加载失败";
  } finally {
    loading.value = false;
  }
}

async function createPiece(): Promise<void> {
  error.value = "";
  try {
    await apiFetch("/api/v1/pieces", {
      method: "POST",
      body: JSON.stringify({
        title: form.title,
        composer: form.composer || null,
        movement: form.movement || null,
        keySignature: form.keySignature,
        difficulty: form.difficulty === "" ? null : Number(form.difficulty),
        instrument: form.instrument || null,
        tags: form.tags.split(/[,，、\s]+/).map((item) => item.trim()).filter(Boolean),
        notes: form.notes || null,
      }),
    });
    creating.value = false;
    Object.assign(form, { title: "", composer: "", movement: "", keySignature: "UNKNOWN", difficulty: "", instrument: "", tags: "", notes: "" });
    await load();
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "创建曲目失败";
  }
}

async function mergeInto(target: Piece): Promise<void> {
  const sourceId = window.prompt(`输入要合并进《${target.title}》的重复曲目 ID：`);
  if (!sourceId) return;
  try {
    const result = await apiFetch<{ merge: MergeRecord }>(`/api/v1/pieces/${target.id}/merge`, {
      method: "POST",
      body: JSON.stringify({ sourcePieceId: sourceId.trim() }),
    });
    if (result.merge.conflicts.length > 0) {
      window.alert(`已完成练习记录与标签迁移，另有 ${result.merge.conflicts.length} 个字段冲突需要处理，请前往页面顶部“待处理合并”。`);
    }
    await load();
  } catch (reason) {
    window.alert(reason instanceof ApiError ? reason.message : "合并失败");
  }
}

async function archive(piece: Piece): Promise<void> {
  await apiFetch(`/api/v1/pieces/${piece.id}/archive`, { method: "POST", body: "{}" });
  await load();
}
async function restore(piece: Piece): Promise<void> {
  await apiFetch(`/api/v1/pieces/${piece.id}/restore`, { method: "POST", body: "{}" });
  await load();
}

onMounted(load);
</script>

<template>
  <section class="page">
    <header class="page-header">
      <div>
        <h1>曲目资料库</h1>
        <p>维护每首曲目的调性、难度与问题标签，历史练习自动归集；重复条目可合并，字段冲突保留为待处理项。</p>
      </div>
      <button class="button" @click="creating = !creating">{{ creating ? "收起" : "新增曲目" }}</button>
    </header>

    <div v-if="pendingCount" class="alert warning" style="margin-bottom: 18px">
      有 <strong>{{ pendingCount }}</strong> 个合并存在待处理冲突：
      <RouterLink v-for="merge in pendingMerges" :key="merge.id" :to="`/repertoire/merges/${merge.id}`" class="button small ghost" style="margin: 0 6px">
        《{{ merge.sourcePiece.title }}》→《{{ merge.targetPiece.title }}》（{{ merge.conflicts.length }} 项）
      </RouterLink>
    </div>

    <form v-if="creating" class="card form-grid" style="margin-bottom: 18px" @submit.prevent="createPiece">
      <label class="field full"><span>曲目名称</span><input v-model="form.title" required maxlength="160" placeholder="例如：小提琴协奏曲" /></label>
      <label class="field"><span>作曲家</span><input v-model="form.composer" maxlength="160" /></label>
      <label class="field"><span>乐章 / 片段</span><input v-model="form.movement" maxlength="200" placeholder="例如：第二乐章 17-24 小节" /></label>
      <label class="field">
        <span>调性</span>
        <select v-model="form.keySignature">
          <option v-for="option in keySignatureOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
      <label class="field">
        <span>难度</span>
        <select v-model="form.difficulty">
          <option value="">未评级</option>
          <option v-for="level in [1, 2, 3, 4, 5]" :key="level" :value="level">{{ level }}</option>
        </select>
      </label>
      <label class="field"><span>乐器</span><input v-model="form.instrument" maxlength="60" list="piece-instruments" /></label>
      <label class="field"><span>问题标签</span><input v-model="form.tags" maxlength="200" placeholder="逗号分隔，如：换把, 节奏, 颤音" /></label>
      <label class="field full"><span>备注</span><textarea v-model="form.notes" maxlength="3000" /></label>
      <div class="row end full"><button class="button ghost" type="button" @click="creating = false">取消</button><button class="button" type="submit">保存曲目</button></div>
    </form>

    <div class="tabs" style="margin-bottom: 14px">
      <button class="tab" :class="{ active: statusFilter === 'ACTIVE' }" @click="statusFilter = 'ACTIVE'; load()">在练</button>
      <button class="tab" :class="{ active: statusFilter === 'ARCHIVED' }" @click="statusFilter = 'ARCHIVED'; load()">已归档</button>
      <button class="tab" :class="{ active: statusFilter === 'MERGED' }" @click="statusFilter = 'MERGED'; load()">已合并</button>
    </div>

    <div class="card flat form-grid" style="margin-bottom: 18px; padding: 14px">
      <label class="field"><span>搜索</span><input v-model="filters.q" placeholder="曲名 / 作曲家 / 片段" @change="load" /></label>
      <label class="field">
        <span>调性</span>
        <select v-model="filters.keySignature" @change="load"><option value="">全部</option><option v-for="option in keySignatureOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select>
      </label>
      <label class="field">
        <span>难度</span>
        <select v-model="filters.difficulty" @change="load"><option value="">全部</option><option v-for="level in [1, 2, 3, 4, 5]" :key="level" :value="level">{{ level }}</option></select>
      </label>
      <label class="field">
        <span>问题标签</span>
        <select v-model="filters.tag" @change="load"><option value="">全部</option><option v-for="tag in tags" :key="tag.id" :value="tag.name">{{ tag.name }}（{{ tag._count.pieces }}）</option></select>
      </label>
    </div>

    <LoadingBlock v-if="loading" />
    <div v-else-if="error" class="alert">{{ error }} <button class="button small ghost" @click="load">重试</button></div>
    <EmptyState v-else-if="!pieces.length" title="还没有曲目" description="先建立曲目档案，之后的每次练习都可以归集到对应曲目。" action-label="新增曲目" @action="creating = true" />
    <div v-else class="piece-grid">
      <article v-for="piece in pieces" :key="piece.id" class="card stack piece-card">
        <div class="row between">
          <small>{{ pieceStatusLabels[piece.status] }}{{ piece.instrument ? ` · ${piece.instrument}` : "" }}</small>
          <small>上次练习 {{ piece.lastPracticedAt ? formatDateTime(piece.lastPracticedAt) : "未练习" }}</small>
        </div>
        <RouterLink :to="`/repertoire/${piece.id}`" class="piece-title">
          <h2>{{ piece.title }}</h2>
          <p class="muted">{{ piece.composer ?? "作曲家未记录" }}<template v-if="piece.movement"> · {{ piece.movement }}</template></p>
        </RouterLink>
        <div class="row" style="gap: 8px; flex-wrap: wrap">
          <span class="chip">{{ formatKeySignature(piece.keySignature) }}</span>
          <span class="chip">{{ formatDifficulty(piece.difficulty) }}</span>
          <span v-for="tag in piece.tags" :key="tag.id" class="chip tag">🏷 {{ tag.name }}</span>
        </div>
        <p v-if="piece.status === 'MERGED'" class="muted">
          已合并到 <RouterLink :to="`/repertoire/${piece.mergedIntoId}`">{{ piece.mergedInto?.title ?? "目标曲目" }}</RouterLink>
        </p>
        <div class="row between">
          <small>{{ piece._count.practiceSessions }} 次练习记录</small>
          <span class="row" style="gap: 6px">
            <RouterLink class="button small ghost" :to="`/repertoire/${piece.id}`">详情</RouterLink>
            <button v-if="piece.status === 'ACTIVE'" class="button small ghost" @click="mergeInto(piece)">合并重复</button>
            <button v-if="piece.status === 'ACTIVE'" class="button small ghost" @click="archive(piece)">归档</button>
            <button v-if="piece.status === 'ARCHIVED'" class="button small secondary" @click="restore(piece)">恢复</button>
          </span>
        </div>
      </article>
    </div>
  </section>
</template>

<style scoped>
.piece-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 17px; }
.piece-card { align-content: start; }
.piece-title { text-decoration: none; color: inherit; display: block; }
.piece-title h2 { margin: 0 0 4px; font-size: 1.25rem; }
.chip { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; background: var(--surface-soft); font-size: .82rem; color: #43514c; }
.chip.tag { background: var(--primary-soft); color: var(--primary-strong); }
@media (max-width: 900px) { .piece-grid { grid-template-columns: 1fr; } }
</style>
