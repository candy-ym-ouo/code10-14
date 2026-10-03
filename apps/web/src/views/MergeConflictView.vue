<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { apiFetch, ApiError } from "../api/client.js";
import LoadingBlock from "../components/LoadingBlock.vue";
import { formatDifficulty, formatKeySignature, keySignatureLabels } from "../utils/format.js";

interface Conflict {
  id: string;
  field: "composer" | "keySignature" | "difficulty" | "notes";
  targetValue: string | null;
  sourceValue: string | null;
  status: "PENDING" | "RESOLVED";
  resolvedValue: string | null;
}
interface Merge {
  id: string;
  status: "PENDING" | "RESOLVED";
  autoFillData: Record<string, string | number | null> | null;
  migratedCounts: { sessions: number; tags: number; autoFilledFields: number } | null;
  sourcePiece: { id: string; title: string; composer: string | null; movement: string | null };
  targetPiece: { id: string; title: string; composer: string | null; movement: string | null };
  conflicts: Conflict[];
}

const route = useRoute();
const router = useRouter();
const mergeId = String(route.params.mergeId);
const merge = ref<Merge | null>(null);
const loading = ref(true);
const saving = ref(false);
const error = ref("");

const fieldLabels: Record<Conflict["field"], string> = {
  composer: "作曲家",
  keySignature: "调性",
  difficulty: "难度",
  notes: "备注",
};

const choices = reactive<Record<string, string>>({});
const customValues = reactive<Record<string, string>>({});

function displayValue(field: Conflict["field"], raw: string | null): string {
  if (raw == null || raw === "") return "（空）";
  if (field === "keySignature") return keySignatureLabels[raw] ?? raw;
  if (field === "difficulty") return formatDifficulty(Number(raw));
  return raw;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const result = await apiFetch<{ merge: Merge }>(`/api/v1/pieces/merges/${mergeId}`);
    merge.value = result.merge;
    for (const conflict of result.merge.conflicts) {
      if (conflict.status === "PENDING") choices[conflict.id] = "target";
    }
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "合并记录加载失败";
  } finally {
    loading.value = false;
  }
}

function chosenValue(conflict: Conflict): unknown {
  const choice = choices[conflict.id] ?? "target";
  if (choice === "target") return conflict.targetValue;
  if (choice === "source") return conflict.sourceValue;
  return customValues[conflict.id] ?? "";
}

async function submit(): Promise<void> {
  if (!merge.value) return;
  saving.value = true;
  error.value = "";
  try {
    const payload: Record<string, unknown> = {};
    for (const conflict of merge.value.conflicts) {
      if (conflict.status !== "PENDING") continue;
      const value = chosenValue(conflict);
      if (conflict.field === "difficulty") payload.difficulty = value === "" ? null : Number(value);
      else payload[conflict.field] = value === "" ? null : value;
    }
    const result = await apiFetch<{ merge: Merge }>(`/api/v1/pieces/merges/${mergeId}/resolve`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    merge.value = result.merge;
    if (result.merge.status === "RESOLVED") {
      window.alert("全部冲突已处理，合并完成。");
      await router.push(`/repertoire/${result.merge.targetPiece.id}`);
    }
  } catch (reason) {
    error.value = reason instanceof ApiError ? reason.message : "保存冲突处理结果失败";
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <section class="page" style="max-width: 980px">
    <LoadingBlock v-if="loading" />
    <div v-else-if="error || !merge" class="alert">{{ error || "合并记录不存在" }} <button class="button small ghost" @click="router.push('/repertoire')">返回资料库</button></div>
    <template v-else>
      <header class="page-header">
        <div>
          <RouterLink to="/repertoire" class="muted">← 曲目资料库</RouterLink>
          <h1>处理合并冲突</h1>
          <p>重复条目《{{ merge.sourcePiece.title }}》合并进保留曲目《{{ merge.targetPiece.title }}》。历史练习与标签已在一个事务中完成原子迁移，下列字段存在不一致，需要逐项保留。</p>
        </div>
      </header>

      <div class="alert success" style="margin-bottom: 18px">
        已原子迁移：{{ merge.migratedCounts?.sessions ?? 0 }} 条历史练习、{{ merge.migratedCounts?.tags ?? 0 }} 个来源标签，
        自动补齐 {{ merge.migratedCounts?.autoFilledFields ?? 0 }} 个保留曲目原本为空的字段：
        {{ merge.autoFillData && Object.keys(merge.autoFillData).length
          ? Object.keys(merge.autoFillData).map((field) => fieldLabels[field as Conflict["field"]] ?? field).join("、")
          : "无" }}。
      </div>

      <div v-if="merge.status === 'RESOLVED'" class="alert info" style="margin-bottom: 18px">
        所有冲突均已处理完毕。<RouterLink class="button small secondary" :to="`/repertoire/${merge.targetPiece.id}`">查看保留曲目</RouterLink>
      </div>

      <div v-for="conflict in merge.conflicts" :key="conflict.id" class="card stack" style="margin-bottom: 14px">
        <div class="row between">
          <h2>{{ fieldLabels[conflict.field] }}</h2>
          <span v-if="conflict.status === 'RESOLVED'" class="chip tag">已处理：{{ displayValue(conflict.field, conflict.resolvedValue) }}</span>
        </div>
        <template v-if="conflict.status === 'PENDING'">
          <label class="option">
            <input type="radio" :name="conflict.id" value="target" v-model="choices[conflict.id]" />
            <span>保留曲目（{{ merge.targetPiece.title }}）</span>
            <strong>{{ displayValue(conflict.field, conflict.targetValue) }}</strong>
          </label>
          <label class="option">
            <input type="radio" :name="conflict.id" value="source" v-model="choices[conflict.id]" />
            <span>来源条目（{{ merge.sourcePiece.title }}）</span>
            <strong>{{ displayValue(conflict.field, conflict.sourceValue) }}</strong>
          </label>
          <label v-if="conflict.field !== 'keySignature'" class="option custom">
            <input type="radio" :name="conflict.id" value="custom" v-model="choices[conflict.id]" />
            <span>自定义</span>
            <textarea
              v-if="conflict.field === 'notes'"
              :value="customValues[conflict.id] ?? ''"
              @input="customValues[conflict.id] = ($event.target as HTMLTextAreaElement).value"
              :disabled="choices[conflict.id] !== 'custom'"
              rows="3"
            />
            <input
              v-else
              :type="conflict.field === 'difficulty' ? 'number' : 'text'"
              min="1" max="5"
              :value="customValues[conflict.id] ?? ''"
              @input="customValues[conflict.id] = ($event.target as HTMLInputElement).value"
              :disabled="choices[conflict.id] !== 'custom'"
            />
          </label>
          <label v-else class="option custom">
            <input type="radio" :name="conflict.id" value="custom" v-model="choices[conflict.id]" />
            <span>自定义调性</span>
            <select :value="customValues[conflict.id] ?? 'C_MAJOR'" @change="customValues[conflict.id] = ($event.target as HTMLSelectElement).value" :disabled="choices[conflict.id] !== 'custom'">
              <option v-for="option in Object.entries(keySignatureLabels)" :key="option[0]" :value="option[0]">{{ option[1] }}</option>
            </select>
          </label>
        </template>
      </div>

      <div v-if="merge.status === 'PENDING'" class="row end">
        <button class="button ghost" type="button" @click="router.push('/repertoire')">稍后处理</button>
        <button class="button" :disabled="saving" @click="submit">{{ saving ? "保存中…" : "保存处理结果" }}</button>
      </div>
    </template>
  </section>
</template>

<style scoped>
.option { display: grid; grid-template-columns: 20px 200px 1fr; gap: 10px; align-items: center; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; }
.option.custom { grid-template-columns: 20px 200px 1fr; }
.option span { color: var(--muted); }
.option strong { white-space: pre-wrap; }
.chip { display: inline-flex; padding: 3px 10px; border-radius: 999px; background: var(--primary-soft); color: var(--primary-strong); font-size: .82rem; }
@media (max-width: 700px) { .option, .option.custom { grid-template-columns: 20px 1fr; } }
</style>
