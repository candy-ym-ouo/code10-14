import fs from "node:fs";
import path from "node:path";

async function apiCall(apiUrl, method, route, body, token) {
  const response = await fetch(`${apiUrl}${route}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${route} -> ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function check(value, label) {
  if (!value) throw new Error(`验证失败：${label}`);
  return { kind: label, value: String(value).slice(0, 160), ok: true };
}

async function login(page, webUrl, email, password) {
  await page.goto(new URL("/login", webUrl).href, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.getByRole("button", { name: /登录/ }).click();
  await page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 15000 });
}

async function loginApi(apiUrl, email, password) {
  return (await apiCall(apiUrl, "POST", "/api/v1/auth/login", { email, password })).accessToken;
}

async function runA(page, webUrl, apiUrl, fixture) {
  await login(page, webUrl, fixture.email, fixture.password);
  await page.goto(new URL("/repertoire", webUrl).href, { waitUntil: "networkidle", timeout: 30000 });
  await page.getByRole("heading", { name: "曲目资料库" }).waitFor();
  await page.getByText("1 次练习记录").first().waitFor({ timeout: 15000 });
  check(await page.getByText(fixture.targetTag, { exact: true }).count(), "保留条目问题标签可见");
  check(await page.getByText(fixture.sourceTag, { exact: true }).count(), "来源条目问题标签可见");
  await page.waitForTimeout(1400);

  const targetCard = page.locator("article.piece-card").filter({ hasText: fixture.targetTag }).first();
  await targetCard.getByRole("button", { name: "合并重复" }).click();
  await page.waitForTimeout(1000);
  await page.getByText("个合并存在待处理冲突", { exact: false }).waitFor({ timeout: 15000 });
  await page.locator(".alert.warning a").first().click();
  await page.getByRole("heading", { name: "处理合并冲突" }).waitFor({ timeout: 15000 });
  check(await page.getByText("已原子迁移", { exact: false }).count(), "历史练习与标签已原子迁移");
  check(await page.getByText("1 条历史练习", { exact: false }).count(), "冲突页显示迁移练习数");
  await page.waitForTimeout(1800);

  const sourceRadios = page.locator("label.option").filter({ hasText: "来源条目" }).locator('input[type="radio"]');
  for (const radio of await sourceRadios.all()) await radio.check();
  await page.getByRole("button", { name: "保存处理结果" }).click();
  await page.getByText("所有冲突均已处理完毕", { exact: false }).waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForURL((url) => /^\/repertoire\/[0-9a-f-]{36}$/.test(url.pathname), { timeout: 15000 });
  await page.getByText("问题标签：", { exact: false }).waitFor({ timeout: 15000 });
  check(await page.getByText("C 大调", { exact: true }).count(), "采用来源调性后保留曲目已更新");
  check(await page.getByText("2 · 初级", { exact: true }).count(), "采用来源难度后保留曲目已更新");
  check(await page.getByText(fixture.sourceTag, { exact: true }).count(), "来源问题标签仍在保留曲目");

  const token = await loginApi(apiUrl, fixture.email, fixture.password);
  const detail = (await apiCall(apiUrl, "GET", `/api/v1/pieces/${fixture.targetId}`, undefined, token)).piece;
  check(detail.keySignature === "C_MAJOR", "API 确认调性已迁移");
  check(detail.difficulty === 2, "API 确认难度已迁移");
  check(detail.historyCount === 1, "API 确认历史练习已迁移");
  check(detail.tags.some((tag) => tag.name === fixture.sourceTag), "API 确认问题标签已合并");
  await page.waitForTimeout(1200);

  return {
    ok: true,
    bodyText: await page.locator("body").innerText(),
  };
}

async function runB(page, webUrl, apiUrl, fixture) {
  await login(page, webUrl, fixture.email, fixture.password);
  await page.goto(new URL("/repertoire", webUrl).href, { waitUntil: "networkidle", timeout: 30000 });
  await page.getByRole("heading", { name: "曲目资料库" }).waitFor();
  await page.getByText("1 次", { exact: false }).first().waitFor({ timeout: 15000 });
  check(await page.getByText(fixture.targetTag, { exact: true }).count(), "保留条目问题标签可见");
  check(await page.getByText(fixture.sourceTag, { exact: true }).count(), "来源条目问题标签可见");
  await page.waitForTimeout(1400);

  const targetCard = page.locator("article.piece-card").filter({ hasText: fixture.targetTag }).first();
  await targetCard.getByRole("button", { name: "合并重复" }).click();
  await page.getByRole("heading", { name: /合并重复条目到/ }).waitFor({ timeout: 15000 });
  await page.locator(".modal select").selectOption(fixture.sourceId);
  await page.getByRole("button", { name: "确认原子合并" }).click();
  await page.getByText("合并完成，练习引用已迁移", { exact: false }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(1800);

  const mergeCard = page.locator("article.merge-card").filter({ hasText: fixture.targetTitle }).first();
  await mergeCard.scrollIntoViewIfNeeded();
  check(await mergeCard.getByText("2 待处理", { exact: false }).count() || await page.getByText("2 待处理", { exact: false }).count(), "冲突项保留为待处理");
  check(await mergeCard.getByText("迁移练习 1 次", { exact: false }).count(), "迁移练习数可见");

  const keyRow = mergeCard.locator(".conflict-row").filter({ hasText: "调性" }).first();
  await keyRow.locator("select").selectOption("USE_SOURCE");
  await keyRow.getByRole("button", { name: "确认" }).click();
  await page.getByText("已处理：采用来源值", { exact: false }).first().waitFor({ timeout: 15000 });

  const difficultyRow = mergeCard.locator(".conflict-row").filter({ hasText: "难度" }).first();
  await difficultyRow.locator("select").selectOption("USE_SOURCE");
  await difficultyRow.getByRole("button", { name: "确认" }).click();
  await mergeCard.getByText("已解决", { exact: true }).waitFor({ timeout: 15000 });
  await page.waitForTimeout(1400);

  const resolvedCard = page.locator("article.piece-card").filter({ hasText: fixture.targetTag }).first();
  check(await resolvedCard.getByText("调性 C", { exact: false }).count(), "保留曲目调性已更新");
  check(await resolvedCard.getByText("★★", { exact: true }).count(), "保留曲目难度已更新");

  const token = await loginApi(apiUrl, fixture.email, fixture.password);
  const detail = (await apiCall(apiUrl, "GET", `/api/v1/repertoire/pieces/${fixture.targetId}`, undefined, token)).piece;
  check(detail.key === "C", "API 确认调性已迁移");
  check(detail.difficulty === 2, "API 确认难度已迁移");
  check(detail.practiceCount === 1, "API 确认历史练习已迁移");
  check(detail.tags.includes(fixture.sourceTag), "API 确认问题标签已合并");
  await page.waitForTimeout(1200);

  return {
    ok: true,
    bodyText: await page.locator("body").innerText(),
  };
}

export default async function verify({ page, webUrl, variant }) {
  const fixture = JSON.parse(fs.readFileSync(path.join(variant.stateDir, "repro-user.json"), "utf8"));
  const apiUrl = fs.readFileSync(path.join(variant.stateDir, "api-url"), "utf8").trim();
  const checks = [];

  page.on("dialog", async (dialog) => {
    if (dialog.type() === "prompt") await dialog.accept(fixture.sourceId);
    else await dialog.accept();
  });

  try {
    const outcome = variant.id === "B"
      ? await runB(page, webUrl, apiUrl, fixture)
      : await runA(page, webUrl, apiUrl, fixture);
    checks.push(...outcome.checks);
    return { ...outcome, checks };
  } catch (error) {
    return {
      ok: false,
      checks: [{ kind: "browser", value: error instanceof Error ? error.message : String(error), ok: false }],
      bodyText: await page.locator("body").innerText().catch(() => ""),
    };
  }
}
