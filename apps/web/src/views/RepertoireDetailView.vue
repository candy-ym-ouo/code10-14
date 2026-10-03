<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiFetch, ApiError } from "../api/client.js";
import LoadingBlock from "../components/LoadingBlock.vue";
import {
  annotationLabels,
  formatDateTime,
  formatDifficulty,
  formatDuration,
  formatKeySignature,
  keySignatureOptions,
  pieceStatusLabels,
} from "../utils/format.js";

interface Hotspot { title: string; severity: number; type: keyof typeof annotationLabels; sessionId: string }
interface HistorySession {
  id: string; title: string; instrument: string; startedAt: string; actualDurationMs: string | number; status: string;
  annotations: Array<{ type: keyof typeof annotationLabels; severity: number; title: string }>;
  review: { mainIssues: string | null; nextFocus: string | null } | null;
}
interface Piece {
  id: string; title: string; composer: string | null; movement: string | null; keySignature: string;
  difficulty: number | null; instrument: string | null; notes: string | null; status: keyof typeof pieceStatusLabels;
  lastPracticedAt: string | null; version: number; mergedIntoId: string | null;
  tags: Array<{ id: string; name: string }>;
  practiceSessions: HistorySession[];
  historyCount: number;
  totalPracticeMs: string | number;
  issueCounts: Record<keyof typeof annotationLabels, number>;
  hotspots: Hotspot[];
  pendingMerges: Array<{ id: string; sourcePiece: { id: string; title: string }; conflicts: Array<{ id: string; field: string }> }>;
}
interface SessionOption { id: string; title: string; instrument: string; status: string; startedAt: string; piece: { id: string; title: string } | null }

const route = useRoute();
const router = useRouter();
const pieceId = String(route.params.id);
const piece = ref<Piece | null>(null);
const sessions = ref<SessionOption[]>([]);
const loading = ref(true);
const error = ref("");
const editing = ref(false);
const saving = ref(false);
const linkSessionId = ref("");
const form = reactive({
  title: "", composer: "", movement: "", keySignature: "UNKNOWN", difficulty: "", instrument: "", tags: "", notes: "", version: 0,
});

async function load(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    const [pieceResult, sessionResult] = await Promise.all([
      apiFetch<{ piece: Piece }>(`/api/v1/pieces/${pieceId}`),
      apiFetch<{ data: SessionOption[] }>("/api/v1/sessions?status=ALL&limit=100&sortBy=startedAt&sortOrder=desc"),
    ]);
    piece.value = pieceResult.piece;
    sessions.value = sessionResult.data;
    Object.assign(form, {
      title: piece.value.title,
      composer: piece.value.composer ?? "",
      movement: piece.value.movement ?? "",
      keySignature: piece.value.keySignature,
      difficulty: piece.value.difficulty == null ? "" : String(piece.value.difficulty),
      instrument: piece.value.instrument ?? "",
      tags: piece.value.tags.map((tag) => tag.name).join(", "),
      notes: piece.value.notes ?? "",
      version: piece.value.version,
    });
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "曲目加载失败";
  } finally {
    loading.value = false;
  }
}

function startEdit(): void {
  if (!piece.value) return;
  editing.value = true;
}

async function save(): Promise<void> {
  if (!piece.value) return;
  saving.value = true;
  error.value = "";
  try {
    const result = await apiFetch<{ piece: Piece }>(`/api/v1/pieces/${pieceId}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: form.title,
        composer: form.composer || null,
        movement: form.movement || null,
        keySignature: form.keySignature,
        difficulty: form.difficulty === "" ? null : Number(form.difficulty),
        instrument: form.instrument || null,
        tags: form.tags.split(/[,，、\s]+/).map((item) => item.trim()).filter(Boolean),
        notes: form.notes || null,
        version: form.version,
      }),
    });
    piece.value = result.piece;
    editing.value = false;
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "保存失败";
  } finally {
    saving.value = false;
  }
}

async function linkSession(): Promise<void> {
  if (!linkSessionId.value) return;
  try {
    const result = await apiFetch<{ piece: Piece }>(`/api/v1/pieces/${pieceId}/sessions`, {
      method: "POST",
      body: JSON.stringify({ sessionId: linkSessionId.value }),
    });
    piece.value = result.piece;
    linkSessionId.value = "";
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "关联练习失败";
  }
}

async function unlinkSession(session: HistorySession): Promise<void> {
  if (!window.confirm(`将《${session.title}》从本曲目的历史练习中移除？练习本身不会删除。`)) return;
  const result = await apiFetch<{ piece: Piece }>(`/api/v1/pieces/${pieceId}/sessions/${session.id}`, { method: "DELETE" });
  piece.value = result.piece;
}

async function archive(): Promise<void> {
  if (!piece.value) return;
  await apiFetch(`/api/v1/pieces/${pieceId}/archive`, { method: "POST", body: "{}" });
  await load();
}
async function restore(): Promise<void> {
  await apiFetch(`/api/v1/pieces/${pieceId}/restore`, { method: "POST", body: "{}" });
  await load();
}

async function mergeDuplicate(): Promise<void> {
  const sourceId = window.prompt("输入要合并的重复曲目 ID（其历史练习与标签将原子迁移到本曲目）：");
  if (!sourceId) return;
  try {
    const result = await apiFetch<{ merge: { id: string; conflicts: Array<{ id: string }> } }>(`/api/v1/pieces/${pieceId}/merge`, {
      method: "POST",
      body: JSON.stringify({ sourcePieceId: sourceId.trim() }),
    });
    if (result.merge.conflicts.length > 0) {
      await router.push(`/repertoire/merges/${result.merge.id}`);
      return;
    }
    await load();
  } catch (reason) {
    window.alert(reason instanceof ApiError ? reason.message : "合并失败");
  }
}

onMounted(load);
</script>

<template>
  <section class="page">
    <LoadingBlock v-if="loading" />
    <div v-else-if="error || !piece" class="alert">{{ error || "曲目不存在" }} <button class="button small ghost" @click="router.push('/repertoire')">返回列表</button></div>
    <template v-else>
      <header class="page-header">
        <div>
          <RouterLink to="/repertoire" class="muted">← 曲目资料库</RouterLink>
          <h1>{{ piece.title }}</h1>
          <p>{{ piece.composer ?? "作曲家未记录" }}<template v-if="piece.movement"> · {{ piece.movement }}</template></p>
        </div>
        <div class="row" style="gap: 8px">
          <button v-if="piece.status === 'ACTIVE'" class="button ghost" @click="mergeDuplicate">合并重复条目</button>
          <button v-if="piece.status === 'ACTIVE'" class="button ghost" @click="archive">归档</button>
          <button v-if="piece.status === 'ARCHIVED'" class="button secondary" @click="restore">恢复</button>
          <button v-if="piece.status !== 'MERGED'" class="button" @click="startEdit">编辑资料</button>
        </div>
      </header>

      <div v-if="piece.status === 'MERGED'" class="alert info" style="margin-bottom: 18px">
        本条目已合并到 <RouterLink :to="`/repertoire/${piece.mergedIntoId}`">保留曲目</RouterLink>，历史练习已迁移，原条目保留用于审计。
      </div>

      <div v-for="merge in piece.pendingMerges" :key="merge.id" class="alert warning" style="margin-bottom: 18px">
        来自《{{ merge.sourcePiece.title }}》的合并存在 {{ merge.conflicts.length }} 个待处理冲突：
        <RouterLink class="button small" :to="`/repertoire/merges/${merge.id}`">前往处理</RouterLink>
      </div>

      <form v-if="editing" class="card form-grid" style="margin-bottom: 18px" @submit.prevent="save">
        <label class="field full"><span>曲目名称</span><input v-model="form.title" required maxlength="160" /></label>
        <label class="field"><span>作曲家</span><input v-model="form.composer" maxlength="160" /></label>
        <label class="field"><span>乐章 / 片段</span><input v-model="form.movement" maxlength="200" /></label>
        <label class="field">
          <span>调性</span>
          <select v-model="form.keySignature"><option v-for="option in keySignatureOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select>
        </label>
        <label class="field">
          <span>难度</span>
          <select v-model="form.difficulty"><option value="">未评级</option><option v-for="level in [1, 2, 3, 4, 5]" :key="level" :value="level">{{ level }}</option></select>
        </label>
        <label class="field"><span>乐器</span><input v-model="form.instrument" maxlength="60" /></label>
        <label class="field"><span>问题标签（逗号分隔）</span><input v-model="form.tags" maxlength="300" /></label>
        <label class="field full"><span>备注</span><textarea v-model="form.notes" maxlength="3000" /></label>
        <div class="row end full">
          <button class="button ghost" type="button" @click="editing = false">取消</button>
          <button class="button" type="submit" :disabled="saving">{{ saving ? "保存中…" : "保存" }}</button>
        </div>
      </form>

      <div class="detail-grid">
        <div class="card stack">
          <h2>曲目档案</h2>
          <dl class="meta">
            <div><dt>调性</dt><dd>{{ formatKeySignature(piece.keySignature) }}</dd></div>
            <div><dt>难度</dt><dd>{{ formatDifficulty(piece.difficulty) }}</dd></div>
            <div><dt>乐器</dt><dd>{{ piece.instrument ?? "未记录" }}</dd></div>
            <div><dt>状态</dt><dd>{{ pieceStatusLabels[piece.status] }}</dd></div>
          </dl>
          <div class="row" style="gap: 6px; flex-wrap: wrap">
            <strong style="font-size: .9rem">问题标签：</strong>
            <span v-for="tag in piece.tags" :key="tag.id" class="chip tag">🏷 {{ tag.name }}</span>
            <span v-if="!piece.tags.length" class="muted">暂无标签</span>
          </div>
          <p v-if="piece.notes" class="muted" style="white-space: pre-wrap">{{ piece.notes }}</p>
        </div>

        <div class="card stack">
          <h2>练习概况</h2>
          <div class="metric-line">
            <div class="metric"><strong>{{ piece.historyCount }}</strong><span>历史练习</span></div>
            <div class="metric"><strong>{{ formatDuration(Number(piece.totalPracticeMs)) }}</strong><span>累计时长</span></div>
            <div class="metric"><strong>{{ piece.issueCounts.RHYTHM }}</strong><span>节奏问题</span></div>
            <div class="metric"><strong>{{ piece.issueCounts.FINGERING }}</strong><span>指法问题</span></div>
            <div class="metric"><strong>{{ piece.issueCounts.EMOTION }}</strong><span>情绪问题</span></div>
          </div>
          <div v-if="piece.status !== 'MERGED'" class="row" style="gap: 8px">
            <select v-model="linkSessionId" style="flex: 1">
              <option value="">选择一次练习归入本曲目…</option>
              <option v-for="session in sessions.filter((item) => !item.piece)" :key="session.id" :value="session.id">
                {{ formatDateTime(session.startedAt) }} · {{ session.title }}
              </option>
            </select>
            <button class="button small secondary" :disabled="!linkSessionId" @click="linkSession">归入</button>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top: 18px">
        <div class="card-title"><h2>困难片段（高严重度标记）</h2></div>
        <p v-if="!piece.hotspots.length" class="muted">还没有严重度 ≥ 4 的问题标记。</p>
        <ul v-else class="hotspot-list">
          <li v-for="(hotspot, index) in piece.hotspots" :key="`${hotspot.sessionId}-${index}`">
            <span class="chip tag">{{ annotationLabels[hotspot.type] }}</span>
            <strong>{{ hotspot.title }}</strong>
            <small>严重度 {{ hotspot.severity }}/5 · <RouterLink :to="`/sessions/${hotspot.sessionId}`">查看练习</RouterLink></small>
          </li>
        </ul>
      </div>

      <div class="card" style="margin-top: 18px">
        <div class="card-title"><h2>历史练习</h2><small>最近 {{ piece.practiceSessions.length }} 条</small></div>
        <p v-if="!piece.practiceSessions.length" class="muted">暂无已完成练习。新建练习时选择本曲目，或从上方把已有练习归入。</p>
        <table v-else class="table">
          <thead><tr><th>日期</th><th>练习</th><th>时长</th><th>问题</th><th>下次重点</th><th></th></tr></thead>
          <tbody>
            <tr v-for="session in piece.practiceSessions" :key="session.id">
              <td>{{ formatDateTime(session.startedAt) }}</td>
              <td><RouterLink :to="`/sessions/${session.id}`">{{ session.title }}</RouterLink><br /><small class="muted">{{ session.instrument }}</small></td>
              <td>{{ formatDuration(Number(session.actualDurationMs)) }}</td>
              <td>
                <small v-if="session.annotations.length">
                  {{ session.annotations.length }} 个标记
                  （{{ session.annotations.filter((item) => item.type === "RHYTHM").length }} 节奏 /
                  {{ session.annotations.filter((item) => item.type === "FINGERING").length }} 指法 /
                  {{ session.annotations.filter((item) => item.type === "EMOTION").length }} 情绪）
                </small>
                <small v-else class="muted">无</small>
              </td>
              <td><small>{{ session.review?.nextFocus ?? "—" }}</small></td>
              <td>
                <button v-if="piece.status !== 'MERGED'" class="button small ghost" @click="unlinkSession(session)">移出</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>

<style scoped>
.detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 17px; }
.meta { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin: 0; }
.meta dt { color: var(--muted); font-size: .85rem; }
.meta dd { margin: 2px 0 0; font-weight: 700; }
.metric-line { display: flex; gap: 14px; flex-wrap: wrap; }
.metric { display: grid; gap: 2px; }
.metric strong { font-size: 1.4rem; }
.metric span { color: var(--muted); font-size: .84rem; }
.chip { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; background: var(--surface-soft); font-size: .82rem; }
.chip.tag { background: var(--primary-soft); color: var(--primary-strong); }
.hotspot-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.hotspot-list li { display: flex; align-items: center; gap: 10px; }
.hotspot-list small { margin-left: auto; color: var(--muted); }
@media (max-width: 900px) { .detail-grid { grid-template-columns: 1fr; } }
</style>
