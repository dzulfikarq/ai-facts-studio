import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { visualApprovalFingerprint, type VisualStoryboardScene } from "../src/domain/visual-storyboard";
import { parseResearchPackage } from "../src/domain/research";
import { buildManualResearchPackage } from "../src/domain/manual-project";
import { RENDERER_VERSION } from "../src/video/renderer-version";

const execFileAsync = promisify(execFile);
const tempDir = await mkdtemp(path.join(os.tmpdir(), "ai-facts-api-smoke-"));
const dataPath = path.join(tempDir, "data");
const databasePath = path.join(dataPath, "ai-facts-studio.sqlite");
const legacyProjectId = "legacy-project-v1";
const legacyJobId = "legacy-job-v1";
await mkdir(path.join(dataPath, "jobs", legacyJobId), { recursive: true });
const legacyPackage = JSON.parse(await readFile("samples/mountain-formation.json", "utf8"));
const legacyNow = new Date().toISOString();
const legacySnapshotPath = path.join(dataPath, "jobs", legacyJobId, "snapshot.json");
await writeFile(legacySnapshotPath, JSON.stringify({ research: legacyPackage, audio: null }));
const oldDb = new DatabaseSync(path.join(dataPath, "ai-facts-studio.sqlite"));
oldDb.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE projects (id TEXT PRIMARY KEY, title TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE jobs (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), source_sha256 TEXT NOT NULL, snapshot_path TEXT NOT NULL,
    state TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, error TEXT, progress INTEGER NOT NULL DEFAULT 0,
    attempt_count INTEGER NOT NULL DEFAULT 0, output_path TEXT, manifest_json TEXT, UNIQUE(project_id, source_sha256)
  );
  CREATE TABLE render_attempts (id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES jobs(id), attempt INTEGER NOT NULL, state TEXT NOT NULL, requested_at TEXT NOT NULL, finished_at TEXT, error TEXT, manifest_json TEXT);
  CREATE TABLE ai_generation_attempts (
    id TEXT PRIMARY KEY, requested_at TEXT NOT NULL, task TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
    state TEXT NOT NULL, error_code TEXT
  );
`);
const legacyProject = { researchPackage: legacyPackage, audio: null, researchReviewStatus: "needs-review" };
oldDb.prepare("INSERT INTO projects (id,title,data_json,created_at,updated_at) VALUES (?,?,?,?,?)")
  .run(legacyProjectId, legacyPackage.title, JSON.stringify(legacyProject), legacyNow, legacyNow);
oldDb.prepare("INSERT INTO jobs (id,project_id,source_sha256,snapshot_path,state,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
  .run(legacyJobId, legacyProjectId, "legacy-source", legacySnapshotPath, "preview-ready", legacyNow, legacyNow);
oldDb.close();

async function freePort() {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  return port;
}

const port = await freePort();
const vitePort = await freePort();
const baseUrl = `http://127.0.0.1:${port}`;
const viteUrl = `http://127.0.0.1:${vitePort}`;
function setPersistedAiMode(mode: "development" | "production") {
  // ponytail: switch SQLite mode directly to test production quota without making Gemini calls.
  const settingsDb = new DatabaseSync(databasePath);
  settingsDb.prepare("UPDATE ai_generation_settings SET mode = ? WHERE id = 1").run(mode);
  settingsDb.close();
}
const server = spawn(process.execPath, ["--import", "tsx", "src/server/index.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "test", STORY_GENERATION_TEST_MOCK_AI: "true", TTS_MOCK_PROVIDER: "0", GEMINI_API_KEY: "", GEMINI_TTS_FREE_TIER_ONLY: "false", GEMINI_TEXT_MODEL: "", GEMINI_TEXT_FREE_TIER_ONLY: "false", HF_TOKEN: "", HF_IMAGE_GENERATION_ENABLED: "false", HF_IMAGE_ALLOW_PAID: "false", AI_GENERATION_DAILY_REQUEST_LIMIT: "2", OPENCODE_SERVER_URL: "http://localhost:4096", OPENCODE_SERVER_PASSWORD: "smoke-password", DAILY_JOB_LIMIT: "3", HOST: "127.0.0.1", PORT: String(port), VITE_PORT: String(vitePort), DATA_DIR: dataPath },
  stdio: "pipe",
});
server.stdout?.pipe(process.stdout);
server.stderr?.pipe(process.stderr);
let serverExit: string | null = null;
server.on("exit", (code, signal) => { serverExit = `exit ${code ?? "null"} signal ${signal ?? "null"}`; });
server.on("error", (error) => { serverExit = error.message; });
let viteServer: ReturnType<typeof spawn> | undefined;
let projectId: string | undefined;
let assetProjectId: string | undefined;
let reusableTargetId: string | undefined;
let jobAudioPath: string | undefined;
let jobSnapshotPath: string | undefined;
let projectUploadPath: string | undefined;
let assetUploadPath: string | undefined;
let flowAssetPath: string | undefined;
const outroAssetIds: string[] = [];
const outroProjectIds: string[] = [];
let jobId: string | undefined;
let renderOutputPath: string | undefined;

try {
  let ready = false;
  let lastStartupResponse = "no response";
  // ponytail: Windows TSX cold start can exceed ten seconds; keep readiness wait bounded at 30s.
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(`${baseUrl}/api/status`);
      if (response.ok) { ready = true; break; }
      lastStartupResponse = `HTTP ${response.status}`;
    } catch (error) { lastStartupResponse = error instanceof Error ? error.message : "network error"; /* API still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(ready, true, `local API should start (${serverExit ?? "running"}; ${lastStartupResponse})`);
  const storyPackage = JSON.parse(await readFile("fixtures/story-series/bilik-empat-episode-01.json", "utf8"));
  const importStorySeries = async (value: unknown, requestId: string) => {
    const response = await fetch(`${baseUrl}/api/story-series/import`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ package: value, requestId }),
    });
    return { status: response.status, body: await response.json() };
  };
  const queryCount = (sql: string, ...params: string[]) => {
    const smokeDb = new DatabaseSync(databasePath);
    try { return (smokeDb.prepare(sql).get(...params) as { count: number }).count; }
    finally { smokeDb.close(); }
  };
  const aiAttemptsBeforeStoryImport = queryCount("SELECT COUNT(*) AS count FROM ai_generation_attempts");
  const storyRequestId = randomUUID();
  const concurrentImports = await Promise.all([
    importStorySeries(storyPackage, storyRequestId),
    importStorySeries(storyPackage, storyRequestId),
  ]);
  assert.deepEqual(concurrentImports.map((result) => result.status).sort(), [200, 201], "concurrent idempotent imports create one episode and replay once");
  const importedStory = concurrentImports.find((result) => result.status === 201)!;
  const replayedStory = concurrentImports.find((result) => result.status === 200)!;
  assert.equal(replayedStory.body.replay, true);
  assert.equal(importedStory.body.project.id, replayedStory.body.project.id, "concurrent replay returns original project");
  const storyProjectId = importedStory.body.project.id as string;
  const storySeriesId = importedStory.body.seriesId as string;
  assert.equal(importedStory.body.project.researchPackage.category, "Fiksi", "Story Series imports use dedicated fiction category");
  assert.equal(importedStory.body.project.storySeries.episodeId, importedStory.body.episodeId);
  assert.equal(importedStory.body.project.researchPackage.scenes.length, storyPackage.episode.scenes.length);
  assert.equal(importedStory.body.project.visualStoryboard.scenes.length, 8, "import API creates prompts for every episode scene");
  assert.ok(importedStory.body.project.visualStoryboard.scenes.every((scene: { flowPrompt: string; flowPromptAnimationStyleId: string }) => scene.flowPrompt.includes("Traditional flat 2D hand-painted horror animation") && scene.flowPrompt.includes("Absolutely no 3D rendering, CGI") && scene.flowPromptAnimationStyleId === "cinematic-2d-motion-comic"), "import API applies one non-3D hand-painted style lock to all scenes");
  assert.equal(importedStory.body.project.visualStoryboard.scenes[0].storySeries.googleFlow.authoredPrompt, storyPackage.episode.scenes[0].googleFlow.prompt, "import API preserves authored scene direction separately from generated prompt");
  assert.deepEqual(importedStory.body.project.visualStoryboard.scenes[0].storySeries.audio, storyPackage.episode.scenes[0].audio, "import API preserves audio cues");
  const storyDetail = await fetch(`${baseUrl}/api/story-series/${storySeriesId}`).then((response) => response.json());
  assert.equal(storyDetail.episodeCount, 1, "series detail reports imported episode count");
  assert.equal(storyDetail.episodes[0].projectId, storyProjectId);
  const exactReplay = await importStorySeries(storyPackage, storyRequestId);
  assert.equal(exactReplay.status, 200);
  assert.equal(exactReplay.body.project.id, storyProjectId, "same request ID is durably idempotent");

  const changedEpisode = structuredClone(storyPackage);
  changedEpisode.episode.scenes[0].narration += " Perubahan smoke.";
  const idempotencyConflict = await importStorySeries(changedEpisode, storyRequestId);
  assert.equal(idempotencyConflict.status, 409);
  assert.equal(idempotencyConflict.body.code, "idempotency-conflict", "reused request ID with changed package conflicts");
  const episodeConflict = await importStorySeries(changedEpisode, randomUUID());
  assert.equal(episodeConflict.status, 409);
  assert.equal(episodeConflict.body.code, "episode-conflict", "different content cannot overwrite an existing episode");
  const changedBible = structuredClone(storyPackage);
  changedBible.series.title += " Altered";
  const seriesConflict = await importStorySeries(changedBible, randomUUID());
  assert.equal(seriesConflict.status, 409);
  assert.equal(seriesConflict.body.code, "series-conflict", "different Story Bible cannot overwrite an existing slug");
  assert.equal((await fetch(`${baseUrl}/api/story-series/${storySeriesId}`).then((response) => response.json())).title, storyPackage.series.title, "conflicts leave saved Story Bible untouched");

  const episodeTwo = structuredClone(storyPackage);
  const episodeTwoOutline = episodeTwo.series.storyBible.episodeOutlines.find((outline: { episodeNumber: number }) => outline.episodeNumber === 2);
  assert.ok(episodeTwoOutline, "acceptance Story Bible contains later episode outline");
  episodeTwo.episode.episodeNumber = 2;
  episodeTwo.episode.title = episodeTwoOutline.title;
  episodeTwo.episode.synopsis = episodeTwoOutline.summary;
  episodeTwo.episode.previousEpisodeSummary = storyPackage.episode.synopsis;
  episodeTwo.episode.openingHook = episodeTwoOutline.summary;
  episodeTwo.episode.endingCliffhanger = episodeTwoOutline.endingHook;
  episodeTwo.episode.scenes = episodeTwo.episode.scenes.map((scene: { order: number }) => ({ ...scene, sceneId: `ep02-sc${String(scene.order).padStart(2, "0")}` }));
  const secondEpisodeImport = await importStorySeries(episodeTwo, randomUUID());
  assert.equal(secondEpisodeImport.status, 201, "later episode imports under existing Story Bible");
  const continuedSeries = await fetch(`${baseUrl}/api/story-series/${storySeriesId}`).then((response) => response.json());
  assert.equal(continuedSeries.episodeCount, 2);
  assert.equal(continuedSeries.episodes[1].episodeNumber, 2);

  const rollbackPackage = structuredClone(storyPackage);
  rollbackPackage.series.slug = "rollback-smoke";
  const rollbackRequestId = randomUUID();
  const triggerDb = new DatabaseSync(databasePath);
  triggerDb.exec("CREATE TRIGGER story_series_rollback_smoke BEFORE INSERT ON projects WHEN json_extract(NEW.data_json, '$.storySeries.slug') = 'rollback-smoke' BEGIN SELECT RAISE(ABORT, 'story import rollback smoke'); END;");
  triggerDb.close();
  const failedImport = await importStorySeries(rollbackPackage, rollbackRequestId);
  assert.equal(failedImport.status, 500, "injected project insert failure surfaces without partial success");
  assert.equal(queryCount("SELECT COUNT(*) AS count FROM story_series WHERE slug = ?", "rollback-smoke"), 0, "failed import rolls back new series row");
  assert.equal(queryCount("SELECT COUNT(*) AS count FROM story_series_episodes e JOIN story_series s ON s.id = e.series_id WHERE s.slug = ?", "rollback-smoke"), 0, "failed import rolls back episode row");
  assert.equal(queryCount("SELECT COUNT(*) AS count FROM story_series_import_requests WHERE request_id = ?", rollbackRequestId), 0, "failed import rolls back idempotency row");
  assert.equal(queryCount("SELECT COUNT(*) AS count FROM projects WHERE json_extract(data_json, '$.storySeries.slug') = ?", "rollback-smoke"), 0, "failed import leaves no orphan project");
  const removeTriggerDb = new DatabaseSync(databasePath);
  removeTriggerDb.exec("DROP TRIGGER story_series_rollback_smoke");
  removeTriggerDb.close();
  const rollbackRetry = await importStorySeries(rollbackPackage, rollbackRequestId);
  assert.equal(rollbackRetry.status, 201, "same request can retry after transaction rollback");
  assert.equal(queryCount("SELECT COUNT(*) AS count FROM ai_generation_attempts"), aiAttemptsBeforeStoryImport, "Story Series import makes no AI calls");

  const storySource = {
    title: "The Long House",
    storyText: "Exact source line one.\r\nLong story EP2: the final door opens.\nKeep punctuation — and spacing.",
    language: "id-ID",
    targetDurationSeconds: 62,
    dailyCreditsAvailable: 100,
    animationStyleId: "cinematic-2d-motion-comic",
    additionalInstructions: "Preserve the source ending.",
    sourceUrl: "https://example.test/story",
    rightsNotes: "Test fixture; rights review required.",
  };
  const storyDraftRequestId = randomUUID();
  const createStoryDraft = async (source: unknown, requestId = storyDraftRequestId) => {
    const response = await fetch(`${baseUrl}/api/story-generation/drafts`, { method: "POST", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify({ requestId, source }) });
    return { status: response.status, body: await response.json() };
  };
  const createdStoryDraft = await createStoryDraft(storySource);
  assert.equal(createdStoryDraft.status, 201, "source story saves before any AI action");
  const storyDraftId = createdStoryDraft.body.id as string;
  assert.equal(createdStoryDraft.body.source.storyText, storySource.storyText, "source story text is preserved byte-for-byte as a JS string");
  const createReplay = await createStoryDraft(storySource);
  assert.equal(createReplay.status, 200);
  assert.equal(createReplay.body.id, storyDraftId, "source create retry returns the durable draft");
  const createConflict = await createStoryDraft({ ...storySource, storyText: `${storySource.storyText} changed` });
  assert.equal(createConflict.status, 409, "source request ID cannot be reused with changed story");
  const setLongerTarget = await fetch(`${baseUrl}/api/story-generation/drafts/${storyDraftId}/production-settings`, { method: "PUT", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify({ targetDurationSeconds: 70, dailyCreditsAvailable: 100 }) });
  assert.equal(setLongerTarget.status, 200, "production target can be corrected before analysis");
  const changedTargetDraft = await fetch(`${baseUrl}/api/story-generation/drafts/${storyDraftId}`).then((response) => response.json());
  assert.equal(changedTargetDraft.source.targetDurationSeconds, 70);
  assert.equal(changedTargetDraft.source.storyText, storySource.storyText, "target adjustment never changes source story text");
  const restoreTarget = await fetch(`${baseUrl}/api/story-generation/drafts/${storyDraftId}/production-settings`, { method: "PUT", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify({ targetDurationSeconds: 62, dailyCreditsAvailable: 100 }) });
  assert.equal(restoreTarget.status, 200);

  const storyAiPostFor = async (draftId: string, route: string, body: unknown) => {
    const response = await fetch(`${baseUrl}/api/story-generation/drafts/${draftId}/${route}`, { method: "POST", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  const storyAiPost = (route: string, body: unknown) => storyAiPostFor(storyDraftId, route, body);
  const storyAiAttemptsBefore = queryCount("SELECT COUNT(*) AS count FROM ai_generation_attempts");
  const analysisRequestId = randomUUID();
  const analysisRequest = { requestId: analysisRequestId, model: "mock/story-model" };
  const analysisResponse = await storyAiPost("analyze", analysisRequest);
  assert.equal(analysisResponse.status, 200, "test-only mock AI produces a validated story analysis");
  assert.equal(analysisResponse.body.analysis.schemaVersion, "story-analysis.v1");
  assert.equal(analysisResponse.body.analysis.recommendedEpisodeCount, 2, "mock recommends story-structure episode count");
  assert.equal(analysisResponse.body.plan.length, 2);
  const analysisRetry = await storyAiPost("analyze", analysisRequest);
  assert.equal(analysisRetry.body.analysis.schemaVersion, "story-analysis.v1", "analysis retry returns stored result");

  const reviewedPlan = analysisResponse.body.plan as Array<Record<string, unknown>>;
  reviewedPlan[0] = { ...reviewedPlan[0], title: "The Long House · Revised", synopsis: "User-reviewed episode one synopsis." };
  const savePlanResponse = await fetch(`${baseUrl}/api/story-generation/drafts/${storyDraftId}/plan`, { method: "PUT", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify({ episodes: reviewedPlan }) });
  assert.equal(savePlanResponse.status, 200, "user can edit and persist the episode recommendation");
  const approvePlanResponse = await fetch(`${baseUrl}/api/story-generation/drafts/${storyDraftId}/approve-plan`, { method: "POST", headers: { "content-type": "application/json", origin: baseUrl } });
  assert.equal(approvePlanResponse.status, 200, "user approval locks reviewed plan");
  const lockedPlanEdit = await fetch(`${baseUrl}/api/story-generation/drafts/${storyDraftId}/plan`, { method: "PUT", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify({ episodes: reviewedPlan }) });
  assert.equal(lockedPlanEdit.status, 409, "approved episode plan cannot be silently overwritten");

  const bibleResponse = await storyAiPost("story-bible/generate", { requestId: randomUUID(), model: "mock/story-model" });
  assert.equal(bibleResponse.status, 200, "test-only mock AI generates a validated Story Bible draft");
  assert.equal(bibleResponse.body.bibleDraft.schemaVersion, "story-bible.v1");
  assert.equal(bibleResponse.body.bibleDraft.series.visualStyle.presetId, "cinematic-2d-motion-comic", "default generated Story Bible keeps 2D horror preset");
  const reviewedBible = structuredClone(bibleResponse.body.bibleDraft);
  reviewedBible.series.synopsis += " Human-reviewed note.";
  const saveBibleResponse = await fetch(`${baseUrl}/api/story-generation/drafts/${storyDraftId}/story-bible`, { method: "PUT", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify({ draft: reviewedBible }) });
  assert.equal(saveBibleResponse.status, 200, "Story Bible edits persist before approval");
  const approveBibleResponse = await fetch(`${baseUrl}/api/story-generation/drafts/${storyDraftId}/story-bible/approve`, { method: "POST", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify({ draft: reviewedBible }) });
  assert.equal(approveBibleResponse.status, 201, "approved Bible is durably saved to reusable Story Series Library");
  const approvedBibleResult = await approveBibleResponse.json();
  const generatedSeriesId = approvedBibleResult.seriesId as string;
  const savedSourceDetail = await fetch(`${baseUrl}/api/story-series/${generatedSeriesId}`).then((response) => response.json());
  assert.equal(savedSourceDetail.sourceStory.storyText, storySource.storyText, "series reload retains exact original source separately");
  assert.equal(savedSourceDetail.sourceStory.sourceUrl, storySource.sourceUrl);
  assert.equal(savedSourceDetail.sourceStory.rightsNotes, storySource.rightsNotes);

  const episodeOneRequestId = randomUUID();
  const episodeOne = await storyAiPost("episodes/1/generate", { requestId: episodeOneRequestId, model: "mock/story-model" });
  assert.equal(episodeOne.status, 200, "selected episode generates through mocked AI");
  assert.equal(episodeOne.body.package.schemaVersion, "story-series.v1", "episode production uses existing story-series.v1 contract");
  assert.equal(episodeOne.body.package.episode.scenes.length, 8, "generated episode stays within eight clips");
  assert.equal(episodeOne.body.package.episode.scenes.reduce((sum: number, scene: { durationSeconds: number }) => sum + scene.durationSeconds, 0), 62, "scene timings exactly fill selected episode target");
  assert.ok(episodeOne.body.package.episode.scenes.every((scene: { durationSeconds: number }) => scene.durationSeconds <= 8), "each Flow clip stays at or below eight seconds");
  assert.equal(episodeOne.body.package.productionBudget.estimatedCredits, 80);
  assert.equal(episodeOne.body.package.productionBudget.reserveCredits, 20);
  assert.ok(episodeOne.body.package.episode.scenes.every((scene: { googleFlow: { prompt: string } }) => scene.googleFlow.prompt.includes("hand-painted") && scene.googleFlow.prompt.includes("No 3D")), "Flow prompts preserve the locked 2D style");
  const episodeOneRetry = await storyAiPost("episodes/1/generate", { requestId: episodeOneRequestId, model: "mock/story-model" });
  assert.deepEqual(episodeOneRetry.body.package, episodeOne.body.package, "episode generation retry replays same saved draft");
  assert.equal(queryCount("SELECT COUNT(*) AS count FROM story_generation_requests WHERE request_id = ?", episodeOneRequestId), 1, "episode retry does not create duplicate request records");

  const generatedEpisodeTwo = await storyAiPost("episodes/2/generate", { requestId: randomUUID(), model: "mock/story-model" });
  assert.equal(generatedEpisodeTwo.status, 200, "next selected episode can generate after episode one handoff");
  assert.equal(generatedEpisodeTwo.body.package.episode.previousEpisodeSummary, "User-reviewed episode one synopsis.", "episode two uses approved plan and prior episode summary");
  assert.match(generatedEpisodeTwo.body.package.episode.continuityHandoff.nextEpisodeSetup, /The Long House · Revised/);
  const reloadedDraft = await fetch(`${baseUrl}/api/story-generation/drafts/${storyDraftId}`).then((response) => response.json());
  assert.equal(reloadedDraft.source.storyText, storySource.storyText, "reload keeps story source unchanged");
  assert.equal(reloadedDraft.approvedPlan[0].title, "The Long House · Revised", "reload keeps manually reviewed plan");
  assert.equal(Object.keys(reloadedDraft.episodeDrafts).length, 2, "reload keeps both selected episode drafts");
  assert.equal(queryCount("SELECT COUNT(*) AS count FROM ai_generation_attempts"), storyAiAttemptsBefore, "mocked Development story workflow records no Gemini request or quota use");

  const editedEpisodePackage = structuredClone(reloadedDraft.episodeDrafts["1"].package);
  editedEpisodePackage.episode.scenes[0].googleFlow.prompt += " Human prompt edit; preserve this wording.";
  const promptSave = await fetch(`${baseUrl}/api/story-generation/drafts/${storyDraftId}/episodes/1`, { method: "PUT", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify({ package: editedEpisodePackage }) });
  assert.equal(promptSave.status, 200, "generated Flow prompt remains editable as draft");
  const savedEpisodePackage = await fetch(`${baseUrl}/api/story-generation/drafts/${storyDraftId}`).then((response) => response.json());
  assert.match(savedEpisodePackage.episodeDrafts["1"].package.episode.scenes[0].googleFlow.prompt, /Human prompt edit/);
  const importedGeneratedOne = await importStorySeries(editedEpisodePackage, randomUUID());
  assert.equal(importedGeneratedOne.status, 201, "generated episode enters existing Story Series import adapter");
  assert.equal(importedGeneratedOne.body.project.visualStoryboard.scenes.length, 8);
  assert.ok(importedGeneratedOne.body.project.visualStoryboard.scenes[0].flowPrompt.includes("Traditional flat 2D hand-painted horror animation"));
  assert.match(importedGeneratedOne.body.project.visualStoryboard.scenes[0].storySeries.googleFlow.authoredPrompt, /Human prompt edit/);
  assert.equal(importedGeneratedOne.body.project.visualStoryboard.scenes[0].flowStatus, "prompt-ready", "storyboard remains a draft and generates no Flow media");
  assert.equal(importedGeneratedOne.body.project.visualAssets.length, 0, "episode generation makes no image asset or automatic media");
  const importedGeneratedTwo = await importStorySeries(generatedEpisodeTwo.body.package, randomUUID());
  assert.equal(importedGeneratedTwo.status, 201, "continuation episode uses same production pipeline");
  const generatedSeriesAfterImport = await fetch(`${baseUrl}/api/story-series/${generatedSeriesId}`).then((response) => response.json());
  assert.equal(generatedSeriesAfterImport.episodeCount, 2, "generated episodes persist in reusable series library");

  const longSource = { ...storySource, title: "Long target story", targetDurationSeconds: 70 };
  const longDraftResult = await createStoryDraft(longSource, randomUUID());
  assert.equal(longDraftResult.status, 201);
  const longDraftId = longDraftResult.body.id as string;
  const longAnalysis = await storyAiPostFor(longDraftId, "analyze", { requestId: randomUUID(), model: "mock/story-model" });
  assert.equal(longAnalysis.body.plan[0].estimatedFlowClips, 9, "70-second target reports nine clips, not eight fabricated clips");
  assert.equal(longAnalysis.body.plan[0].estimatedCredits, 90);
  const longPlanSave = await fetch(`${baseUrl}/api/story-generation/drafts/${longDraftId}/plan`, { method: "PUT", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify({ episodes: longAnalysis.body.plan }) });
  assert.equal(longPlanSave.status, 200);
  const longPlanApproval = await fetch(`${baseUrl}/api/story-generation/drafts/${longDraftId}/approve-plan`, { method: "POST", headers: { "content-type": "application/json", origin: baseUrl } });
  assert.equal(longPlanApproval.status, 200, "over-limit plan can be reviewed and approved while episode generation remains blocked");
  const longBible = await storyAiPostFor(longDraftId, "story-bible/generate", { requestId: randomUUID(), model: "mock/story-model" });
  assert.equal(longBible.status, 200);
  const longBibleApproval = await fetch(`${baseUrl}/api/story-generation/drafts/${longDraftId}/story-bible/approve`, { method: "POST", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify({ draft: longBible.body.bibleDraft }) });
  assert.equal(longBibleApproval.status, 201);
  const blockedLongEpisode = await storyAiPostFor(longDraftId, "episodes/1/generate", { requestId: randomUUID(), model: "mock/story-model" });
  assert.equal(blockedLongEpisode.status, 409);
  assert.equal(blockedLongEpisode.body.code, "flow-clip-limit", "over-64-second episode is blocked before AI generation");
  assert.equal(blockedLongEpisode.body.budget.plannedClips, 9);

  viteServer = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"], {
    cwd: process.cwd(),
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), VITE_PORT: String(vitePort) },
    stdio: "ignore",
  });
  let viteReady = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      if ((await fetch(`${viteUrl}/api/status`)).ok) { viteReady = true; break; }
    } catch { /* Vite or proxy still starting */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(viteReady, true, "Vite frontend and API proxy should start on configured port");
  const migratedProject = await fetch(`${baseUrl}/api/projects/${legacyProjectId}`).then((response) => response.json());
  assert.equal(migratedProject.researchPackage.schemaVersion, "1.1", "legacy v1.0 project should migrate on read");
  assert.equal(migratedProject.creationMode, "legacy", "projects without origin metadata receive safe legacy default");
  assert.equal(migratedProject.latestJob.rendererVersion, 1, "legacy jobs should retain V1 renderer metadata");
  assert.equal(migratedProject.latestJobContentCurrent, true, "legacy snapshot should remain current after compatible migration");
  const migratedStatus = await fetch(`${baseUrl}/api/status`).then((response) => response.json());
  assert.equal(migratedStatus.jobsUsed, 1, "legacy jobs should backfill rolling quota history");
  assert.equal(migratedStatus.generationMode, "development");
  assert.equal(migratedStatus.nextAllowedAt, null, "Development status hides production quota countdown");
  const [ttsStatus, ttsCatalog] = await Promise.all([
    fetch(`${baseUrl}/api/tts/status`).then((response) => response.json()),
    fetch(`${baseUrl}/api/tts/voices?locale=id-ID`).then((response) => response.json()),
  ]);
  assert.equal(ttsStatus.requestsRemaining, ttsStatus.dailyLimit, "TTS status reports rolling synthesis quota without secrets");
  assert.equal(ttsCatalog.locales[0].locale, "id-ID", "Indonesian should be first/default locale");
  assert.ok(ttsCatalog.voices.length > 0, "official prebuilt fallback catalog should keep voice selector populated");
  assert.equal(ttsCatalog.catalogSource, "fallback");

  const getAiSettings = () => fetch(`${baseUrl}/api/settings/ai-generation`);
  const initialAiSettings = await getAiSettings().then((response) => response.json());
  assert.equal(initialAiSettings.mode, "development", "AI generation defaults to Development independent of NODE_ENV");
  assert.equal(initialAiSettings.generationAvailable, true, "Development mode exposes the explicit manual prompt/import flow");
  assert.equal(initialAiSettings.providers.development.id, "opencode-local");
  assert.equal(initialAiSettings.providers.development.configured, false, "Development status fails closed without a valid authenticated OpenCode loopback endpoint");
  assert.equal(JSON.stringify(initialAiSettings).includes("smoke-password"), false, "OpenCode auth never reaches browser settings response");
  assert.equal(initialAiSettings.providers.production.configured, false);
  assert.equal(typeof initialAiSettings.providers.production.apiKeyConfigured, "boolean", "settings expose only backend key presence, never key value");
  assert.equal(initialAiSettings.providers.production.quotaMonitoring.usageSource, "local-records");
  assert.equal(initialAiSettings.providers.production.quotaMonitoring.tpm.used, null, "TPM stays unavailable until provider reports token usage");
  assert.ok(!("apiKey" in initialAiSettings.providers.production), "API key must not be exposed to frontend");
  const developmentRequest = { input: { topic: "Kenapa langit biru?", language: "id-ID", targetDurationSec: 30, deliveryStyle: "edukatif", additionalInstructions: "", sourceUrls: [] }, model: "openai/gpt-5-mini" };
  const missingOrigin = await fetch(`${baseUrl}/api/ai-generation`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(developmentRequest) });
  assert.equal(missingOrigin.status, 403, "model-trigger endpoint requires same-origin request");
  const crossOrigin = await fetch(`${baseUrl}/api/ai-generation`, { method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.example" }, body: JSON.stringify(developmentRequest) });
  assert.equal(crossOrigin.status, 403, "cross-origin model trigger is rejected");
  const unproxiedFrontendOrigin = await fetch(`${baseUrl}/api/ai-generation`, { method: "POST", headers: { "content-type": "application/json", origin: viteUrl }, body: JSON.stringify(developmentRequest) });
  assert.equal(unproxiedFrontendOrigin.status, 403, "frontend-port Origin is rejected when request did not pass through trusted Vite proxy");
  const proxiedCrossOrigin = await fetch(`${viteUrl}/api/ai-generation`, { method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.example" }, body: JSON.stringify(developmentRequest) });
  assert.equal(proxiedCrossOrigin.status, 403, "Vite proxy marker does not bypass remote-origin rejection");
  const proxiedGeneration = await fetch(`${viteUrl}/api/ai-generation`, {
    method: "POST", headers: { "content-type": "application/json", origin: viteUrl }, body: JSON.stringify(developmentRequest),
  });
  assert.equal(proxiedGeneration.status, 503, "request through configured Vite port passes Origin guard and reaches OpenCode provider gate");
  assert.equal((await proxiedGeneration.json()).code, "opencode-unavailable", "proxy request is not rejected as invalid-origin");
  const developmentGeneration = await fetch(`${baseUrl}/api/ai-generation`, {
    method: "POST", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify(developmentRequest),
  });
  assert.equal(developmentGeneration.status, 503, "Development one-click generation requires authenticated loopback OpenCode");
  assert.equal((await developmentGeneration.json()).code, "opencode-unavailable");
  assert.equal((await fetch(`${baseUrl}/api/settings/ai-generation`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "staging" }) })).status, 400, "backend validates mode values");
  assert.equal((await fetch(`${baseUrl}/api/settings/ai-generation`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "production" }) })).status, 409, "unconfigured/paid-capable Production cannot be selected");
  const unchangedAiSettings = await getAiSettings().then((response) => response.json());
  assert.equal(unchangedAiSettings.mode, "development", "rejected Production change must leave persisted mode unchanged");
  assert.equal((await fetch(`${baseUrl}/api/tts/status`).then((response) => response.json())).requestsUsed, ttsStatus.requestsUsed, "AI settings do not consume TTS quota");
  assert.equal((await fetch(`${baseUrl}/api/settings/ai-generation`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "development" }) })).status, 200, "Development choice persists through backend settings");
  const settingsDb = new DatabaseSync(path.join(dataPath, "ai-facts-studio.sqlite"));
  assert.equal((settingsDb.prepare("SELECT mode FROM ai_generation_settings WHERE id = 1").get() as { mode: string }).mode, "development", "mode preference is stored in SQLite");
  const generationColumns = settingsDb.prepare("PRAGMA table_info(ai_generation_attempts)").all() as Array<{ name: string }>;
  assert.ok(["input_tokens", "output_tokens", "total_tokens"].every((name) => generationColumns.some((column) => column.name === name)), "existing AI usage table migrates optional token usage fields");
  settingsDb.close();

  const research = await fetch(`${baseUrl}/api/sample`).then((response) => response.json());
  const outroFixturePath = path.join(tempDir, "outro-moving.mp4");
  const outroFixtureTwoPath = path.join(tempDir, "outro-moving-two.mp4");
  await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=360x640:rate=24:duration=1.4", "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=44100:duration=1.4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-movflags", "+faststart", "-y", outroFixturePath], { timeout: 60_000 });
  await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=24:duration=1.3", "-vf", "hue=h=t*100", "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", outroFixtureTwoPath], { timeout: 60_000 });
  const uploadOutro = async (fixturePath: string, name: string) => {
    const form = new FormData();
    form.append("outro", new Blob([await readFile(fixturePath)], { type: "video/mp4" }), name);
    const response = await fetch(`${baseUrl}/api/outros`, { method: "POST", body: form });
    assert.equal(response.status, 201, `valid local MP4 uploads to Outro Library: ${await response.clone().text()}`);
    const result = await response.json() as { asset: { id: string; file: string; posterFile: string; durationSec: number; audioCodec: string | null; localAvailable: boolean }; outros: Array<{ id: string; isDefault: boolean }>; defaultOutroId: string | null };
    outroAssetIds.push(result.asset.id);
    assert.ok(result.asset.durationSec > 1 && result.asset.durationSec <= 120, "Outro metadata stores normalized duration");
    assert.equal(result.asset.audioCodec, fixturePath === outroFixturePath ? "aac" : null, "Outro metadata records normalized optional audio stream");
    assert.equal(result.asset.localAvailable, true, "uploaded Outro is available in local storage");
    const servedVideo = await fetch(`${baseUrl}/outros/${result.asset.file}`);
    assert.equal(servedVideo.status, 200, "normalized Outro media is served locally");
    assert.match(servedVideo.headers.get("content-type") ?? "", /^video\/mp4/i, "Outro media endpoint serves MP4, not SPA fallback");
    const servedPoster = await fetch(`${baseUrl}/outros/${result.asset.posterFile}`);
    assert.equal(servedPoster.status, 200, "Outro poster is served locally");
    assert.match(servedPoster.headers.get("content-type") ?? "", /^image\/jpeg/i, "Outro poster endpoint serves JPEG");
    return result.asset;
  };
  const firstOutro = await uploadOutro(outroFixturePath, "Outro A.mp4");
  const secondOutro = await uploadOutro(outroFixtureTwoPath, "Outro B.mp4");
  const renamedOutro = await fetch(`${baseUrl}/api/outros/${firstOutro.id}`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Outro A renamed" }),
  });
  assert.equal(renamedOutro.status, 200, "library supports renaming custom Outro");
  assert.equal((await renamedOutro.json()).asset.name, "Outro A renamed");
  assert.equal((await fetch(`${baseUrl}/api/outros/${firstOutro.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "" }) })).status, 400, "empty Outro names are rejected");
  await fetch(`${baseUrl}/api/outros/${firstOutro.id}/default`, { method: "POST" }).then(async (response) => { assert.equal(response.status, 200, await response.text()); });
  const projectRequestId = randomUUID();
  const manualCreationMetadata = { creationMode: "manual", creationBrief: { deliveryStyle: "edukatif", additionalInstructions: "" } };
  const defaultProject = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: research, requestId: projectRequestId, animationStyleId: "2d-paper-cutout", ...manualCreationMetadata }),
  }).then((response) => response.json());
  outroProjectIds.push(defaultProject.id);
  assert.equal(defaultProject.creationMode, "manual", "manual project stores origin metadata alongside default Outro");
  assert.equal(defaultProject.animationStyleId, "2d-paper-cutout", "selected stable animation-style ID persists at project creation");
  assert.equal(defaultProject.outro.assetId, firstOutro.id, "new projects snapshot current library default at creation");
  await fetch(`${baseUrl}/api/outros/${secondOutro.id}/default`, { method: "POST" }).then(async (response) => { assert.equal(response.status, 200, await response.text()); });
  const retriedCreate = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: research, requestId: projectRequestId, ...manualCreationMetadata }),
  }).then((response) => response.json());
  assert.equal(retriedCreate.id, defaultProject.id, "idempotent project retry survives a library-default change");
  assert.equal(retriedCreate.outro.assetId, firstOutro.id, "idempotent retry preserves original project Outro selection");
  assert.equal(retriedCreate.animationStyleId, "2d-paper-cutout", "idempotent retry preserves original animation-style selection");
  const switchedLibrary = await fetch(`${baseUrl}/api/outros`).then((response) => response.json());
  assert.equal(switchedLibrary.defaultOutroId, secondOutro.id, "only selected library item becomes default");
  assert.equal(switchedLibrary.outros.filter((asset: { isDefault: boolean }) => asset.isDefault).length, 1, "library has at most one active default");
  const explicitNoOutro = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: research, outroId: null }),
  }).then((response) => response.json());
  outroProjectIds.push(explicitNoOutro.id);
  assert.equal(explicitNoOutro.outro, null, "Tanpa Outro overrides library default at project creation");
  assert.equal(explicitNoOutro.animationStyleId, "expressive-2d-cartoon", "older create clients receive the default style");
  const projectOutro = { ...defaultProject.outro, trimInSec: 0.1, trimOutSec: 0.9, audioEnabled: true };
  const projectOutroSave = await fetch(`${baseUrl}/api/projects/${defaultProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: defaultProject.researchPackage, outro: projectOutro, animationStyleId: "stylized-3d-cartoon" }),
  });
  assert.equal(projectOutroSave.status, 200, await projectOutroSave.clone().text());
  const reopenedOutroProject = await fetch(`${baseUrl}/api/projects/${defaultProject.id}`).then((response) => response.json());
  assert.deepEqual(reopenedOutroProject.outro, projectOutro, "per-project enabled/trim/audio settings persist independently of default changes");
  assert.equal(reopenedOutroProject.animationStyleId, "stylized-3d-cartoon", "project animation-style setting persists across reload");
  const invalidAnimationStyleSave = await fetch(`${baseUrl}/api/projects/${defaultProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: reopenedOutroProject.researchPackage, animationStyleId: "Kartun 3D Stylized" }),
  });
  assert.equal(invalidAnimationStyleSave.status, 400, "display names cannot be used as animation-style IDs");
  assert.equal((await fetch(`${baseUrl}/api/projects/${defaultProject.id}`).then((response) => response.json())).animationStyleId, "stylized-3d-cartoon", "invalid style update does not mutate saved project");
  const archivedOutroResponse = await fetch(`${baseUrl}/api/outros/${firstOutro.id}`, { method: "DELETE" });
  const archivedOutro = await archivedOutroResponse.json();
  assert.equal(archivedOutroResponse.status, 200);
  assert.equal(archivedOutro.archived, true, "deleting a referenced Outro archives it instead of breaking projects");
  assert.equal(archivedOutro.projectReferences, 1);
  assert.equal((await fetch(`${baseUrl}/api/projects/${defaultProject.id}`).then((response) => response.json())).outroAsset.archived, true, "archived Outro remains attached to its existing project");
  assert.match((await fetch(`${baseUrl}/outros/${firstOutro.file}`)).headers.get("content-type") ?? "", /^video\/mp4/i, "archive keeps referenced media available");
  const archivedRetryResponse = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: research, requestId: projectRequestId, outroId: firstOutro.id, ...manualCreationMetadata }),
  });
  assert.equal(archivedRetryResponse.status, 200, "idempotent replay succeeds even after original Outro is archived");
  assert.equal((await archivedRetryResponse.json()).id, defaultProject.id, "archived-asset replay returns the original project");
  await fetch(`${baseUrl}/api/projects/${defaultProject.id}`, { method: "DELETE" }).then(async (response) => { assert.equal(response.status, 200, await response.text()); });
  outroProjectIds.splice(outroProjectIds.indexOf(defaultProject.id), 1);
  assert.doesNotMatch((await fetch(`${baseUrl}/outros/${firstOutro.file}`)).headers.get("content-type") ?? "", /^video\/mp4/i, "archived Outro is cleaned only after referencing project is deleted");
  const removedOutroResponse = await fetch(`${baseUrl}/api/outros/${secondOutro.id}`, { method: "DELETE" });
  assert.equal(removedOutroResponse.status, 200);
  assert.equal((await removedOutroResponse.json()).archived, false, "unreferenced custom Outro can be permanently deleted");
  outroAssetIds.splice(outroAssetIds.indexOf(firstOutro.id), 1);
  outroAssetIds.splice(outroAssetIds.indexOf(secondOutro.id), 1);
  for (const id of [...outroProjectIds]) {
    await fetch(`${baseUrl}/api/projects/${id}`, { method: "DELETE" });
    outroProjectIds.splice(outroProjectIds.indexOf(id), 1);
  }
  const noDefaultProject = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: research }),
  }).then((response) => response.json());
  outroProjectIds.push(noDefaultProject.id);
  assert.equal(noDefaultProject.outro, null, "Tanpa Outro remains default when no library asset is marked default");
  await fetch(`${baseUrl}/api/projects/${noDefaultProject.id}`, { method: "DELETE" });
  outroProjectIds.splice(outroProjectIds.indexOf(noDefaultProject.id), 1);
  const invalidOutroForm = new FormData();
  invalidOutroForm.append("outro", new Blob([Buffer.from("not an mp4")], { type: "video/mp4" }), "invalid.mp4");
  assert.equal((await fetch(`${baseUrl}/api/outros`, { method: "POST", body: invalidOutroForm })).status, 422, "invalid MP4 bytes are rejected after MIME/extension checks");

  const volcanoSampleResponse = await fetch(`${baseUrl}/api/sample?topic=volcano-formation`);
  assert.equal(volcanoSampleResponse.status, 200, "volcano education sample is available through explicit topic selection");
  const volcanoSample = await volcanoSampleResponse.json();
  assert.equal(volcanoSample.id, "volcano-formation-id");
  assert.equal(volcanoSample.scenes.length, 6);
  const approveScene = (scene: VisualStoryboardScene) => {
    const approved = { ...scene, authoringStatus: scene.authoringStatus === "needs_review" ? "ready_for_review" : scene.authoringStatus, approved: true };
    return { ...approved, approvedFingerprint: visualApprovalFingerprint(approved) };
  };
  const approveVisuals = async (id: string) => {
    const current = await fetch(`${baseUrl}/api/projects/${id}`).then((response) => response.json());
    const storyboard = { ...current.visualStoryboard, scenes: current.visualStoryboard.scenes.map(approveScene) };
    const response = await fetch(`${baseUrl}/api/projects/${id}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: current.researchPackage, visualStoryboard: storyboard }),
    });
    assert.equal(response.status, 200, "approved storyboard persists through project API");
    return response.json();
  };
  const requestId = "7ae1a87d-c840-4a13-9a17-55de36cce721";
  const createIdempotently = (researchPackage: unknown) => fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage, requestId }),
  });
  const projectCountBeforeIdempotentCreate = (await fetch(`${baseUrl}/api/projects`).then((response) => response.json())).length;
  const firstIdempotentCreate = await createIdempotently(research);
  const firstIdempotentProject = await firstIdempotentCreate.json();
  assert.equal(firstIdempotentProject.researchPackage.scenes.length, research.scenes.length, "saved record retains all narrative scenes");
  assert.equal(firstIdempotentProject.visualStoryboard.scenes.length, research.scenes.length, "saved record includes generated Visual Storyboard");
  const approvedSavedBoard = { ...firstIdempotentProject.visualStoryboard, scenes: firstIdempotentProject.visualStoryboard.scenes.map(approveScene) };
  const boardSave = await fetch(`${baseUrl}/api/projects/${firstIdempotentProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: firstIdempotentProject.researchPackage, visualStoryboard: approvedSavedBoard }),
  });
  assert.equal(boardSave.status, 200);
  const reopenedSavedProject = await fetch(`${baseUrl}/api/projects/${firstIdempotentProject.id}`).then((response) => response.json());
  assert.ok(reopenedSavedProject.visualStoryboard.scenes.every((scene: { approved: boolean }) => scene.approved), "reopening record restores per-scene approvals");
  assert.deepEqual(reopenedSavedProject.researchPackage.scenes.map((scene: { narrationText: string }) => scene.narrationText), research.scenes.map((scene: { narrationText: string }) => scene.narrationText), "reopening record restores narration");
  const repeatedIdempotentCreate = await createIdempotently(research);
  const repeatedIdempotentProject = await repeatedIdempotentCreate.json();
  assert.equal(firstIdempotentCreate.status, 201);
  assert.equal(repeatedIdempotentCreate.status, 200);
  assert.equal(repeatedIdempotentProject.id, firstIdempotentProject.id, "same AI draft request ID must not create duplicate projects");
  assert.ok(repeatedIdempotentProject.visualStoryboard.scenes.every((scene: { approved: boolean }) => scene.approved), "idempotent save keeps persisted review approvals");
  assert.equal((await fetch(`${baseUrl}/api/projects`).then((response) => response.json())).length, projectCountBeforeIdempotentCreate + 1, "retry creates exactly one Video Library record");
  assert.equal((await createIdempotently({ ...research, title: `${research.title} changed` })).status, 409, "request ID cannot be reused for a different project payload");
  assert.equal((await fetch(`${baseUrl}/api/projects/${firstIdempotentProject.id}`, { method: "DELETE" })).status, 200);

  const manualRequestId = randomUUID();
  const manualResearch = buildManualResearchPackage({ topic: "Topik manual smoke", language: "id-ID", targetDurationSec: 30, deliveryStyle: "edukatif", additionalInstructions: "", sourceUrls: [] }, manualRequestId);
  const manualPayload = { researchPackage: manualResearch, requestId: manualRequestId, creationMode: "manual", creationBrief: { deliveryStyle: "edukatif", additionalInstructions: "" }, outroId: null };
  const generationAttemptCount = () => {
    const smokeDb = new DatabaseSync(databasePath);
    const row = smokeDb.prepare("SELECT COUNT(*) AS count FROM ai_generation_attempts").get() as { count: number };
    smokeDb.close();
    return row.count;
  };
  const attemptsBeforeManual = generationAttemptCount();
  const projectsBeforeManual = (await fetch(`${baseUrl}/api/projects`).then((response) => response.json())).length;
  const [manualFirstResponse, manualRetryResponse] = await Promise.all([
    fetch(`${baseUrl}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(manualPayload) }),
    fetch(`${baseUrl}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(manualPayload) }),
  ]);
  const [manualFirst, manualRetry] = await Promise.all([manualFirstResponse.json(), manualRetryResponse.json()]);
  assert.deepEqual([manualFirstResponse.status, manualRetryResponse.status].sort(), [200, 201], "concurrent manual submissions replay one idempotent create");
  assert.equal(manualFirst.id, manualRetry.id, "manual retry returns same project ID");
  assert.equal(manualFirst.creationMode, "manual");
  assert.deepEqual(manualFirst.creationBrief, manualPayload.creationBrief);
  assert.equal(manualFirst.researchReviewStatus, "needs-review", "manual project starts unverified");
  assert.equal(manualFirst.audio, null, "manual project starts without audio");
  assert.deepEqual(manualFirst.visualAssets, [], "manual project starts without generated or Flow visuals");
  assert.equal(manualFirst.researchPackage.references.length, 0, "manual project starts without references unless user supplied them");
  assert.ok(manualFirst.visualStoryboard.scenes.every((scene: { approved: boolean }) => !scene.approved), "manual placeholder scene starts without approval");
  assert.equal((await fetch(`${baseUrl}/api/projects/${manualFirst.id}`).then((response) => response.json())).creationMode, "manual", "manual origin persists after reload");
  assert.equal((await fetch(`${baseUrl}/api/projects`).then((response) => response.json())).length, projectsBeforeManual + 1, "double submit creates only one manual project");
  const blockedManualTts = await fetch(`${baseUrl}/api/projects/${manualFirst.id}/tts`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale: "id-ID", voiceId: "test-voice", speakingRate: 1, style: "documentary" }),
  });
  assert.equal(blockedManualTts.status, 400, "placeholder narration blocks TTS before provider use");
  assert.equal((await blockedManualTts.json()).code, "narration-incomplete");
  assert.equal(generationAttemptCount(), attemptsBeforeManual, "manual creation and blocked placeholder TTS make no AI research-generation request");
  assert.equal((await fetch(`${baseUrl}/api/projects/${manualFirst.id}`, { method: "DELETE" })).status, 200);

  const recoveryProject = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: research }),
  }).then((response) => response.json());
  const recoveryDb = new DatabaseSync(databasePath);
  const recoveryRow = recoveryDb.prepare("SELECT data_json FROM projects WHERE id = ?").get(recoveryProject.id) as { data_json: string };
  const invalidData = JSON.parse(recoveryRow.data_json);
  invalidData.visualStoryboard.scenes[0].sceneId = "preserved-invalid-scene-id";
  recoveryDb.prepare("UPDATE projects SET data_json = ? WHERE id = ?").run(JSON.stringify(invalidData), recoveryProject.id);
  recoveryDb.close();
  const invalidProject = await fetch(`${baseUrl}/api/projects/${recoveryProject.id}`).then((response) => response.json());
  assert.match(invalidProject.visualStoryboardError, /tidak cocok/i, "malformed storyboard reports recovery state");
  assert.equal(invalidProject.visualStoryboard.scenes[0].sceneId, "preserved-invalid-scene-id", "malformed storyboard data stays intact on read");
  const blockedWrite = await fetch(`${baseUrl}/api/projects/${recoveryProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: recoveryProject.researchPackage }),
  });
  assert.equal(blockedWrite.status, 409, "malformed storyboard blocks project writes");
  assert.equal((await blockedWrite.json()).code, "invalid-visual-storyboard");
  assert.equal((await fetch(`${baseUrl}/api/projects/${recoveryProject.id}/audio`, { method: "DELETE" })).status, 409, "malformed storyboard blocks subresource mutation");
  assert.equal((await fetch(`${baseUrl}/api/projects/${recoveryProject.id}`, { method: "DELETE" })).status, 200, "project deletion remains available for recovery");

  const preparationProject = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: research }),
  }).then((response) => response.json());
  const preparationBoard = structuredClone(preparationProject.visualStoryboard);
  preparationBoard.scenes[1] = approveScene(preparationBoard.scenes[1]);
  preparationBoard.scenes[0] = {
    ...preparationBoard.scenes[0],
    composition: { background: preparationBoard.palette.canvas, layers: [{ id: "visual-world", depth: 0.5, nodes: [{ type: "shape", shape: "rect", x: 0, y: 0, width: 1080, height: 1920, fill: preparationBoard.palette.canvas }] }] },
    compositionSource: "existing", authoringStatus: "needs_visual_authoring", authoringConfirmed: false,
    missingVisuals: ["mountain scene"], warnings: ["test: unresolved visual"], approved: false, approvedFingerprint: null,
  };
  const preparationSave = await fetch(`${baseUrl}/api/projects/${preparationProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: preparationProject.researchPackage, visualStoryboard: preparationBoard }),
  });
  assert.equal(preparationSave.status, 200, "test project stores one approved and one unresolved scene");
  const preparationRequestId = "143d8d30-ef0b-4928-a48d-86d3df7c95e4";
  const preparationHeaders = { "content-type": "application/json", origin: baseUrl };
  const preparationStart = await fetch(`${baseUrl}/api/projects/${preparationProject.id}/visual-preparation`, {
    method: "POST", headers: preparationHeaders, body: JSON.stringify({ requestId: preparationRequestId }),
  });
  assert.equal(preparationStart.status, 202);
  const startedJob = await preparationStart.json();
  const preparationReplay = await fetch(`${baseUrl}/api/projects/${preparationProject.id}/visual-preparation`, {
    method: "POST", headers: preparationHeaders, body: JSON.stringify({ requestId: preparationRequestId }),
  }).then((response) => response.json());
  assert.equal(preparationReplay.job.id, startedJob.job.id, "duplicate preparation request reuses persisted job");
  const changedPreparationReplay = await fetch(`${baseUrl}/api/projects/${preparationProject.id}/visual-preparation`, {
    method: "POST", headers: preparationHeaders, body: JSON.stringify({ requestId: preparationRequestId, sceneIds: [preparationBoard.scenes[0].sceneId] }),
  });
  assert.equal(changedPreparationReplay.status, 409, "request ID cannot be reused with different scene selection");
  assert.equal((await changedPreparationReplay.json()).code, "idempotency-conflict");
  let finalPreparation: any;
  for (let attempt = 0; attempt < 100; attempt++) {
    finalPreparation = await fetch(`${baseUrl}/api/projects/${preparationProject.id}/visual-preparation`).then((response) => response.json());
    if (finalPreparation.job?.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(["completed", "partial_failure", "failed"].includes(finalPreparation.job.status), "batch reaches persisted terminal status");
  assert.equal(finalPreparation.job.processed, finalPreparation.job.total, "batch progress accounts for every project scene");
  assert.equal(finalPreparation.job.approved, 1, "already-approved scene is counted and never regenerated");
  const reopenedPreparation = await fetch(`${baseUrl}/api/projects/${preparationProject.id}`).then((response) => response.json());
  assert.equal(reopenedPreparation.visualPreparation.id, startedJob.job.id, "project reopening restores preparation status");
  assert.equal(reopenedPreparation.visualStoryboard.scenes[1].approved, true, "batch preserves existing approval and fingerprint");
  assert.ok(reopenedPreparation.visualStoryboard.scenes[0].composition.layers.length > 1, "Smart Hybrid replaced unresolved placeholder with local composition");
  assert.equal((await fetch(`${baseUrl}/api/projects/${preparationProject.id}`, { method: "DELETE" })).status, 200);

  const silentProject = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: research }),
  }).then((response) => response.json());
  const blockedVisualRender = await fetch(`${baseUrl}/api/projects/${silentProject.id}/generate`, { method: "POST" });
  assert.equal(blockedVisualRender.status, 409, "unapproved Visual Storyboard blocks snapshot creation");
  assert.equal((await blockedVisualRender.json()).code, "visual-storyboard-not-approved");
  await approveVisuals(silentProject.id);
  const silentJob = await fetch(`${baseUrl}/api/projects/${silentProject.id}/generate`, { method: "POST" }).then((response) => response.json());
  assert.equal(silentJob.job.state, "preview-ready");
  const silentRenderResponse = await fetch(`${baseUrl}/api/jobs/${silentJob.job.id}/render`, { method: "POST" });
  const silentRender = await silentRenderResponse.json();
  assert.equal(silentRenderResponse.status, 409);
  assert.equal(silentRender.code, "silent-render-confirmation-required", "API also requires explicit confirmation for a silent snapshot");
  assert.equal((await fetch(`${baseUrl}/api/projects/${silentProject.id}`, { method: "DELETE" })).status, 200);

  const assetProject = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: research }),
  }).then((response) => response.json());
  assetProjectId = assetProject.id;
  const tablerSearch = await fetch(`${baseUrl}/api/asset-packs/tabler?q=rainbow&page=1&pageSize=1`).then((response) => response.json());
  assert.equal(tablerSearch.icons.length, 1, "Tabler search returns bounded page");
  assert.ok(tablerSearch.total >= 1 && tablerSearch.categories.length > 0, "Tabler index exposes real package metadata and category facets");
  const tablerPreview = await fetch(`${baseUrl}/api/asset-packs/tabler/icons/rainbow.svg`);
  const tablerSvg = await tablerPreview.text();
  assert.equal(tablerPreview.status, 200);
  assert.match(tablerSvg, /<svg/);
  assert.doesNotMatch(tablerSvg, /script|onload|foreignObject/i, "Tabler preview contains only generated safe path nodes");
  const importedTablerResponse = await fetch(`${baseUrl}/api/projects/${assetProject.id}/asset-packs/tabler/rainbow/import`, { method: "POST" });
  const importedTabler = await importedTablerResponse.json();
  assert.equal(importedTablerResponse.status, 201, importedTabler.error);
  assert.equal(importedTabler.asset.license, "MIT License");
  assert.match(importedTabler.asset.attribution, /Copyright.*Paweł Kuna.*MIT/i);
  assert.equal(importedTabler.asset.format, "svg");
  const blockedThumbnail = await fetch(`${baseUrl}/api/openverse/thumbnail?url=${encodeURIComponent("https://127.0.0.1/private.png")}`);
  assert.equal(blockedThumbnail.status, 502, "thumbnail proxy refuses URLs not returned by an active Openverse search");
  const unselectedOpenverseImport = await fetch(`${baseUrl}/api/projects/${assetProject.id}/openverse/00000000-0000-0000-0000-000000000000/import`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Unselected fixture" }),
  });
  const unselectedResult = await unselectedOpenverseImport.json();
  assert.equal(unselectedOpenverseImport.status, 502);
  assert.match(unselectedResult.error, /Pilih ulang gambar dari hasil pencarian Openverse/, "API import rejects IDs absent from active selected search results without an external request");
  const pngPath = path.join(tempDir, "illustration.png");
  const fixtureSeed = Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 6), 16);
  const fixtureColor = (offset: number) => `0x${((fixtureSeed + offset * 7919) & 0xffffff).toString(16).padStart(6, "0")}`;
  await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${fixtureColor(1)}:s=128x96:d=1`, "-frames:v", "1", "-y", pngPath]);
  const pngBytes = await readFile(pngPath);
  const imageForm = new FormData();
  imageForm.append("illustration", new Blob([pngBytes], { type: "image/png" }), "ocean.png");
  imageForm.append("name", "Ocean layer");
  const imageUpload = await fetch(`${baseUrl}/api/projects/${assetProject.id}/visual-assets`, { method: "POST", body: imageForm });
  const uploadedVisual = await imageUpload.json();
  assert.equal(imageUpload.status, 201, uploadedVisual.error);
  assert.ok(["png", "webp"].includes(uploadedVisual.asset.format), "valid raster upload may retain or optimize to WebP");
  assert.equal(uploadedVisual.asset.width, 128);
  assert.equal(uploadedVisual.asset.source, "user-upload");
  assert.equal(uploadedVisual.asset.originalName, "ocean.png");
  assert.equal(uploadedVisual.asset.originalMimeType, "image/png");
  assert.equal(uploadedVisual.asset.originalBytes, pngBytes.length);
  assert.match(uploadedVisual.asset.originalSha256, /^[a-f0-9]{64}$/);
  assetUploadPath = path.resolve("public/visual-assets", uploadedVisual.asset.file);
  assert.equal((await fetch(`${baseUrl}/visual-assets/${uploadedVisual.asset.file}`)).status, 200, "content-hash image route serves uploaded asset");

  const batchColors = [2, 3, 4, 5, 6].map(fixtureColor);
  const batchForm = new FormData();
  const batchMetadata = [];
  for (const [index, color] of batchColors.entries()) {
    const batchPath = path.join(tempDir, `batch-${index}.png`);
    await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${color}:s=128x96:d=1`, "-frames:v", "1", "-y", batchPath]);
    batchForm.append("illustrations", new Blob([await readFile(batchPath)], { type: "image/png" }), `flow-scene-${index + 1}.png`);
    batchMetadata.push({ name: `Flow batch ${index + 1}`, source: "ai-generated", prompt: `Prompt scene ${index + 1}`, provider: "Google Flow (manual import)", model: "Google Flow", license: "User-provided; Google Flow output imported manually", semanticTags: [`scene-${index + 1}`], supportedConcepts: [`concept-${index + 1}`] });
  }
  batchForm.append("illustrations", new Blob([Buffer.from("invalid image bytes")], { type: "image/png" }), "flow-scene-invalid.png");
  batchMetadata.push({ name: "Invalid scene", source: "ai-generated", prompt: "Invalid fixture", provider: "Google Flow (manual import)" });
  batchForm.append("illustrations", new Blob([Buffer.alloc(10 * 1024 * 1024 + 1)], { type: "image/png" }), "flow-scene-oversized.png");
  batchMetadata.push({ name: "Oversized scene", source: "ai-generated", prompt: "Oversized fixture", provider: "Google Flow (manual import)" });
  batchForm.append("metadata", JSON.stringify(batchMetadata));
  const batchResponse = await fetch(`${baseUrl}/api/projects/${assetProject.id}/visual-assets/batch`, { method: "POST", body: batchForm });
  const batchUpload = await batchResponse.json();
  assert.equal(batchResponse.status, 201, batchUpload.error);
  assert.equal(batchUpload.results.length, 5, "six-file batch persists every valid image");
  assert.equal(batchUpload.failures.length, 2, "invalid and oversized images do not discard successful batch imports");
  assert.equal(batchUpload.failures[0].index, 5, "partial failure maps to original file order");
  assert.equal(batchUpload.failures[1].index, 6, "oversized file failure maps to original file order");
  assert.match(batchUpload.failures[1].message, /10 MB/, "oversized file receives actionable per-file error");
  assert.equal(batchUpload.project.visualAssets.length, uploadedVisual.project.visualAssets.length + 5, "batch response includes all project assets");
  assert.deepEqual(batchUpload.results.map((entry: { index: number }) => entry.index), [0, 1, 2, 3, 4], "batch results preserve file order");
  assert.ok(batchUpload.results.every((entry: { asset: { source: string; provider: string; prompt: string } }, index: number) => entry.asset.source === "ai-generated" && entry.asset.provider === "Google Flow (manual import)" && entry.asset.prompt === `Prompt scene ${index + 1}`), "batch keeps per-file Flow metadata");

  const flowPngPath = path.join(tempDir, "flow-fixture.png");
  await execFileAsync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=${fixtureColor(7)}:s=128x96:d=1`, "-frames:v", "1", "-y", flowPngPath]);
  const flowPngBytes = await readFile(flowPngPath);
  const flowForm = new FormData();
  flowForm.append("illustration", new Blob([flowPngBytes], { type: "image/png" }), "flow-scene-01.png");
  flowForm.append("name", "Flow scene one fixture");
  flowForm.append("source", "ai-generated");
  flowForm.append("provider", "Google Flow (manual import)");
  flowForm.append("model", "Google Flow");
  flowForm.append("prompt", "One premium editorial illustration for scene one.");
  flowForm.append("license", "User-provided; Google Flow output imported manually");
  const flowUpload = await fetch(`${baseUrl}/api/projects/${assetProject.id}/visual-assets`, { method: "POST", body: flowForm });
  const flowVisual = await flowUpload.json();
  assert.equal(flowUpload.status, 201, flowVisual.error);
  assert.equal(flowVisual.asset.source, "ai-generated");
  assert.equal(flowVisual.asset.provider, "Google Flow (manual import)");
  assert.equal(flowVisual.asset.prompt, "One premium editorial illustration for scene one.");
  assert.equal(flowVisual.asset.originalName, "flow-scene-01.png");
  assert.equal(flowVisual.asset.originalMimeType, "image/png");
  assert.equal(flowVisual.asset.originalBytes, flowPngBytes.length);
  assert.match(flowVisual.asset.originalSha256, /^[a-f0-9]{64}$/);
  assert.match(flowVisual.asset.usageMetadata, /imported manually; provider origin not independently verified/);
  flowAssetPath = path.resolve("public/visual-assets", flowVisual.asset.file);

  const wrongMimeForm = new FormData();
  wrongMimeForm.append("illustration", new Blob([pngBytes], { type: "image/jpeg" }), "spoof.jpg");
  const wrongMime = await fetch(`${baseUrl}/api/projects/${assetProject.id}/visual-assets`, { method: "POST", body: wrongMimeForm });
  assert.equal(wrongMime.status, 400, "uploaded MIME must match raster signature");

  const imageScene = uploadedVisual.project.visualStoryboard.scenes[0];
  const imageBoard = structuredClone(uploadedVisual.project.visualStoryboard);
  imageBoard.styleLock.referenceAssetIds = [flowVisual.asset.id];
  const imageComposition = (assetId: string) => ({ background: imageBoard.palette.canvas, layers: [{ id: "user-illustration", depth: 0.72, nodes: [{ type: "image", asset: assetId, x: 100, y: 510, width: 880, height: 900 }] }] });
  imageBoard.scenes[0] = { ...imageScene, flowPrompt: "One finished raster illustration; do not render text.", flowStatus: "illustration-imported", composition: imageComposition(`upload-${"f".repeat(64)}.png`), compositionSource: "manual", layout: "existing-composition", authoringStatus: "needs_review", authoringConfirmed: false, approved: false, approvedFingerprint: null, relationships: [] };
  const unknownAssetSave = await fetch(`${baseUrl}/api/projects/${assetProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: uploadedVisual.project.researchPackage, visualStoryboard: imageBoard }),
  });
  assert.equal(unknownAssetSave.status, 400, "project cannot reference an asset it does not own");
  imageBoard.scenes[0] = { ...imageBoard.scenes[0], composition: imageComposition(flowVisual.asset.id) };
  const validAssetSave = await fetch(`${baseUrl}/api/projects/${assetProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: uploadedVisual.project.researchPackage, visualStoryboard: imageBoard }),
  });
  assert.equal(validAssetSave.status, 200, "owned upload persists in Visual Storyboard");
  const reopenedFlowProject = await fetch(`${baseUrl}/api/projects/${assetProject.id}`).then((response) => response.json());
  assert.equal(reopenedFlowProject.visualStoryboard.styleLock.referenceAssetIds[0], flowVisual.asset.id, "project Style Lock reference persists through SQLite");
  assert.equal(reopenedFlowProject.visualStoryboard.scenes[0].flowPrompt, imageBoard.scenes[0].flowPrompt, "edited Flow prompt persists through SQLite");
  assert.equal(reopenedFlowProject.visualStoryboard.scenes[0].sceneToken, imageScene.sceneToken, "stable scene token survives project save/reload");
  assert.equal(reopenedFlowProject.visualStoryboard.scenes[0].flowStatus, "illustration-imported");
  const invalidReferenceBoard = structuredClone(reopenedFlowProject.visualStoryboard);
  invalidReferenceBoard.styleLock.referenceAssetIds = [`upload-${"e".repeat(64)}.webp`];
  assert.equal((await fetch(`${baseUrl}/api/projects/${assetProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: reopenedFlowProject.researchPackage, visualStoryboard: invalidReferenceBoard }),
  })).status, 400, "Style Lock cannot reference another project's or missing asset");
  const approvedFlowBoard = structuredClone(reopenedFlowProject.visualStoryboard);
  approvedFlowBoard.scenes[0] = approveScene(approvedFlowBoard.scenes[0]);
  assert.equal((await fetch(`${baseUrl}/api/projects/${assetProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: reopenedFlowProject.researchPackage, visualStoryboard: approvedFlowBoard }),
  })).status, 200, "imported illustration can be approved after review");
  let approvedFlowProject = await fetch(`${baseUrl}/api/projects/${assetProject.id}`).then((response) => response.json());
  const animationPromptBoard = structuredClone(approvedFlowProject.visualStoryboard);
  animationPromptBoard.scenes[0] = { ...animationPromptBoard.scenes[0], flowPrompt: "Imported illustration remains; this animation prompt is only metadata.", flowVisualMode: "animated-video", flowPromptMode: "animated-video", flowPromptAnimationStyleId: "expressive-2d-cartoon" };
  assert.equal((await fetch(`${baseUrl}/api/projects/${assetProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: approvedFlowProject.researchPackage, visualStoryboard: animationPromptBoard, animationStyleId: "expressive-2d-cartoon" }),
  })).status, 200, "animation prompt style metadata persists with imported visual");
  assert.equal((await fetch(`${baseUrl}/api/projects/${assetProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: approvedFlowProject.researchPackage, visualStoryboard: animationPromptBoard, animationStyleId: "stylized-3d-cartoon" }),
  })).status, 200, "changing project animation style does not require prompt regeneration");
  approvedFlowProject = await fetch(`${baseUrl}/api/projects/${assetProject.id}`).then((response) => response.json());
  assert.equal(approvedFlowProject.animationStyleId, "stylized-3d-cartoon", "changed project style persists on reload");
  assert.equal(approvedFlowProject.visualStoryboard.scenes[0].flowPromptAnimationStyleId, "expressive-2d-cartoon", "old prompt metadata remains stale until explicit regeneration");
  assert.equal(approvedFlowProject.visualStoryboard.scenes[0].approved, true, "style change preserves unrelated media approval");
  assert.deepEqual(approvedFlowProject.visualStoryboard.scenes[0].composition, animationPromptBoard.scenes[0].composition, "style change preserves imported visual composition");
  const promptOnlyEdit = structuredClone(approvedFlowProject.visualStoryboard);
  promptOnlyEdit.scenes[0].flowPrompt += "\nOptional hand-edited details.";
  assert.equal((await fetch(`${baseUrl}/api/projects/${assetProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: approvedFlowProject.researchPackage, visualStoryboard: promptOnlyEdit }),
  })).status, 200, "editing external prompt does not stale approval for unchanged rendered art");
  assert.equal((await fetch(`${baseUrl}/api/projects/${assetProject.id}`).then((response) => response.json())).visualStoryboard.scenes[0].approved, true);
  const replaceFlowBoard = structuredClone(promptOnlyEdit);
  replaceFlowBoard.scenes[0] = { ...replaceFlowBoard.scenes[0], composition: imageComposition(uploadedVisual.asset.id), approved: false, approvedFingerprint: null, authoringConfirmed: false, flowStatus: "illustration-imported" };
  assert.equal((await fetch(`${baseUrl}/api/projects/${assetProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: approvedFlowProject.researchPackage, visualStoryboard: replaceFlowBoard }),
  })).status, 200, "replacing imported raster persists only after explicit approval invalidation");
  assert.equal((await fetch(`${baseUrl}/api/projects/${assetProject.id}`).then((response) => response.json())).visualStoryboard.scenes[0].approved, false, "new artwork requires fresh scene approval");
  const styleOnlyBoard = structuredClone(replaceFlowBoard);
  styleOnlyBoard.scenes[0] = { ...styleOnlyBoard.scenes[0], composition: imageComposition(uploadedVisual.asset.id) };
  assert.equal((await fetch(`${baseUrl}/api/projects/${assetProject.id}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: approvedFlowProject.researchPackage, visualStoryboard: styleOnlyBoard }),
  })).status, 200);
  const protectedStyleReference = await fetch(`${baseUrl}/api/projects/${assetProject.id}/visual-assets/${encodeURIComponent(flowVisual.asset.id)}`, { method: "DELETE" });
  assert.equal(protectedStyleReference.status, 409, "Style Lock visual reference prevents deleting its source asset");
  assert.equal((await protectedStyleReference.json()).code, "visual-asset-in-use");
  assert.equal((await fetch(`${baseUrl}/api/projects/${assetProject.id}/generate`, { method: "POST" })).status, 409, "manual upload still requires review and approval");
  const sourceScene = assetProject.visualStoryboard.scenes[0];
  const sourceResearchScene = assetProject.researchPackage.scenes[0];
  const reusableResponse = await fetch(`${baseUrl}/api/projects/${assetProject.id}/reusable-scenes`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      name: "Smoke reusable river composition", tags: ["smoke", "river", "ocean"], concepts: ["river carries mineral to sea"],
      styleId: "clean-flat-2d", layout: "existing-composition", compositionType: "hero-object-focus",
      composition: imageComposition(uploadedVisual.asset.id), palette: assetProject.visualStoryboard.palette,
      motionIntent: sourceScene.motionIntent, motionSummary: sourceScene.motionSummary, motionPlan: sourceResearchScene.motionPlan,
      objects: sourceScene.objects, relationships: sourceScene.relationships, visualFocus: sourceScene.visualFocus,
      assetIds: [uploadedVisual.asset.id], thumbnailDataUrl: `data:image/png;base64,${pngBytes.toString("base64")}`,
      provenance: "API smoke only; FFmpeg solid-color fixture, not educational art or AI.",
    }),
  });
  const reusable = await reusableResponse.json();
  assert.equal(reusableResponse.status, 201, reusable.error);
  assert.equal(reusable.version, 1);
  const reusableSearch = await fetch(`${baseUrl}/api/reusable-scenes?q=smoke+river&page=1&pageSize=2`).then((response) => response.json());
  assert.ok(reusableSearch.scenes.some((scene: { id: string }) => scene.id === reusable.id), "FTS finds saved reusable composition");
  const creditCsv = await fetch(`${baseUrl}/api/projects/${assetProject.id}/visual-assets/credits.csv`).then((response) => response.text());
  assert.match(creditCsv, /Ocean layer/);
  assert.match(creditCsv, /License URL/);
  const reusableTarget = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: research }),
  }).then((response) => response.json());
  reusableTargetId = reusableTarget.id;
  const attachedReusable = await fetch(`${baseUrl}/api/projects/${reusableTarget.id}/reusable-scenes/${reusable.id}/attach`, { method: "POST" });
  assert.equal(attachedReusable.status, 200, "reusable scene attaches local asset metadata without modifying template JSON");
  const targetAfterAttach = await fetch(`${baseUrl}/api/projects/${reusableTarget.id}`).then((response) => response.json());
  assert.ok(targetAfterAttach.visualAssets.some((asset: { id: string }) => asset.id === uploadedVisual.asset.id));
  assert.equal((await fetch(`${baseUrl}/api/reusable-scenes?q=smoke`).then((response) => response.json())).scenes.find((scene: { id: string }) => scene.id === reusable.id).usageCount, 1);
  assert.equal((await fetch(`${baseUrl}/api/projects/${assetProject.id}`, { method: "DELETE" })).status, 200);
  assert.equal(existsSync(assetUploadPath), true, "asset remains while reusable template/project still references it");
  assert.equal((await fetch(`${baseUrl}/api/projects/${reusableTarget.id}`, { method: "DELETE" })).status, 200);
  reusableTargetId = undefined;
  const deletedReusable = await fetch(`${baseUrl}/api/reusable-scenes/${reusable.id}`, { method: "DELETE" });
  assert.equal(deletedReusable.status, 200);
  assert.equal(existsSync(assetUploadPath), false, "asset cleanup drains after last project and reusable-scene reference is removed");
  assetUploadPath = undefined;
  assetProjectId = undefined;

  const createdResponse = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: research }),
  });
  const project = await createdResponse.json();
  assert.equal(createdResponse.status, 201);
  assert.equal(project.researchPackage.schemaVersion, "1.1", "v1.0 package should upgrade compatibly on import");
  projectId = project.id;
  const verifiedProject = await fetch(`${baseUrl}/api/projects/${projectId}/review`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "verified-by-author" }),
  }).then((response) => response.json());
  assert.equal(verifiedProject.researchReviewStatus, "verified-by-author");
  const editedResearch = { ...research, title: `${research.title} (edited)` };
  const editedProject = await fetch(`${baseUrl}/api/projects/${projectId}`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ researchPackage: editedResearch }),
  }).then((response) => response.json());
  assert.equal(editedProject.researchReviewStatus, "needs-review", "editing research invalidates author verification");
  const motionRequestId = randomUUID();
  const motionBatchResponse = await fetch(`${baseUrl}/api/projects/${projectId}/motion-preparation`, {
    method: "POST", headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ requestId: motionRequestId, intensity: "balanced" }),
  });
  assert.equal(motionBatchResponse.status, 202, "deterministic motion batch starts without model/provider request");
  const startedMotion = await motionBatchResponse.json();
  let persistedMotionJob: any;
  for (let attempt = 0; attempt < 120; attempt++) {
    persistedMotionJob = await fetch(`${baseUrl}/api/projects/${projectId}/motion-preparation`).then((response) => response.json());
    if (persistedMotionJob.job?.status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(persistedMotionJob.job.id, startedMotion.job.id, "motion progress persists under the initial job ID");
  assert.equal(persistedMotionJob.job.status, "completed", "all-scene motion batch completes locally");
  assert.equal(persistedMotionJob.job.processed, persistedMotionJob.job.total, "persisted motion progress reaches every scene");
  const motionProject = await fetch(`${baseUrl}/api/projects/${projectId}`).then((response) => response.json());
  assert.equal(motionProject.motionPreparation.id, startedMotion.job.id, "reopening project returns latest motion job");
  assert.ok(motionProject.researchPackage.scenes.some((scene: { motionActions: unknown[] }) => scene.motionActions.length > 0), "motion actions persist into Research Package");
  const motionReplay = await fetch(`${baseUrl}/api/projects/${projectId}/motion-preparation`, {
    method: "POST", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify({ requestId: motionRequestId, intensity: "balanced" }),
  });
  assert.equal(motionReplay.status, 200);
  assert.equal((await motionReplay.json()).replay, true, "same motion request ID replays durable job");
  const motionConflict = await fetch(`${baseUrl}/api/projects/${projectId}/motion-preparation`, {
    method: "POST", headers: { "content-type": "application/json", origin: baseUrl }, body: JSON.stringify({ requestId: motionRequestId, intensity: "expressive" }),
  });
  assert.equal(motionConflict.status, 409, "reused motion request ID with changed intensity conflicts");
  await approveVisuals(project.id);
  const approvedMotionProject = await fetch(`${baseUrl}/api/projects/${projectId}`).then((response) => response.json());
  const staleMotionBoard = structuredClone(approvedMotionProject.visualStoryboard);
  const animatedScene = staleMotionBoard.scenes.find((scene: { motionActions: Array<{ durationFrames: number }> }) => scene.motionActions.length > 0);
  assert.ok(animatedScene, "approval invalidation fixture has planned motion");
  animatedScene.motionActions[0].durationFrames += 1;
  const staleApprovalResponse = await fetch(`${baseUrl}/api/projects/${projectId}`, {
    method: "PUT", headers: { "content-type": "application/json" },
    body: JSON.stringify({ researchPackage: approvedMotionProject.researchPackage, visualStoryboard: staleMotionBoard }),
  });
  assert.equal(staleApprovalResponse.status, 400, "changing motion after approval rejects stale approval fingerprint");

  const audioPath = path.join(tempDir, "voice.wav");
  await execFileAsync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "pcm_s16le", audioPath]);
  const incompleteManualId = randomUUID();
  const incompleteManual = await fetch(`${baseUrl}/api/projects`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ researchPackage: buildManualResearchPackage({ topic: "Manual upload gate", language: "id-ID", targetDurationSec: 30, deliveryStyle: "edukatif", additionalInstructions: "", sourceUrls: [] }, incompleteManualId), requestId: incompleteManualId, creationMode: "manual", creationBrief: { deliveryStyle: "edukatif", additionalInstructions: "" }, outroId: null }),
  }).then((response) => response.json());
  const incompleteAudioForm = new FormData();
  incompleteAudioForm.append("audio", new Blob([await readFile(audioPath)], { type: "audio/wav" }), "incomplete.wav");
  const blockedManualUpload = await fetch(`${baseUrl}/api/projects/${incompleteManual.id}/audio`, { method: "POST", body: incompleteAudioForm });
  assert.equal(blockedManualUpload.status, 400, "placeholder narration blocks manual audio upload before timing changes");
  assert.equal((await blockedManualUpload.json()).code, "narration-incomplete");
  assert.equal((await fetch(`${baseUrl}/api/projects/${incompleteManual.id}`).then((response) => response.json())).audio, null, "blocked upload leaves draft audio unchanged");
  await fetch(`${baseUrl}/api/projects/${incompleteManual.id}`, { method: "DELETE" });
  const form = new FormData();
  form.append("audio", new Blob([await readFile(audioPath)], { type: "audio/wav" }), "voice.wav");
  const uploadedResponse = await fetch(`${baseUrl}/api/projects/${projectId}/audio`, { method: "POST", body: form });
  const uploaded = await uploadedResponse.json();
  assert.equal(uploadedResponse.status, 201, uploaded.error);
  assert.ok(Math.abs(uploaded.audio.durationSec - 2) < 0.2, "ffprobe duration should persist");
  projectUploadPath = path.resolve("public", uploaded.audio.file);

  const generate = () => fetch(`${baseUrl}/api/projects/${projectId}/generate`, { method: "POST" });
  async function changeProjectTitle(suffix: string) {
    const current = await fetch(`${baseUrl}/api/projects/${projectId}`).then((response) => response.json());
    const updated = await fetch(`${baseUrl}/api/projects/${projectId}`, {
      method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ researchPackage: { ...current.researchPackage, title: `${research.title} · ${suffix}` }, visualStoryboard: current.visualStoryboard }),
    });
    assert.equal(updated.status, 200, `project title should change for ${suffix} quota snapshot`);
  }
  const beforeRender = await fetch(`${baseUrl}/api/projects/${projectId}`).then((response) => response.json());
  const researchCheck = parseResearchPackage(beforeRender.researchPackage);
  assert.equal(researchCheck.success, true, `Research Package remains valid before render: ${researchCheck.success ? "" : JSON.stringify(researchCheck.error.issues)}`);
  const firstResponse = await generate();
  const first = await firstResponse.json();
  assert.ok(first.job, `first render snapshot is created: ${JSON.stringify(first)}`);
  const second = await generate().then((response) => response.json());
  assert.equal(first.job.id, second.job.id, "unchanged snapshot should reuse idempotent job");
  assert.equal(first.job.rendererVersion, RENDERER_VERSION, "new snapshot should record current renderer version");
  jobId = first.job.id;
  jobSnapshotPath = path.join(tempDir, "data", "jobs", first.job.id, "snapshot.json");
  const snapshot = JSON.parse(await readFile(jobSnapshotPath, "utf8"));
  assert.equal(snapshot.rendererVersion, RENDERER_VERSION, "new job snapshot records current renderer version");
  assert.equal(first.job.rendererVersion, RENDERER_VERSION);
  assert.ok(snapshot.audio.file.startsWith("audio/jobs/"), "job snapshot should reference immutable audio copy");
  assert.equal(snapshot.audio.source, "upload");
  assert.equal(snapshot.audio.sha256, uploaded.audio.sha256, "snapshot preserves approved audio identity");
  assert.ok(snapshot.research.scenes.some((scene: { motionActions: unknown[] }) => scene.motionActions.length > 0), "immutable renderer snapshot includes approved motion actions");
  jobAudioPath = path.resolve("public", snapshot.audio.file);
  await readFile(jobAudioPath);
  renderOutputPath = path.join("renders", first.job.id, "attempt-1.mp4");
  await mkdir(path.dirname(renderOutputPath), { recursive: true });
  await writeFile(renderOutputPath, "smoke-render-placeholder");

  const removed = await fetch(`${baseUrl}/api/projects/${projectId}/audio`, { method: "DELETE" });
  assert.equal(removed.status, 200);
  await readFile(jobAudioPath);
  assert.equal((await generate()).status, 201, "Development creates snapshots beyond production daily cap");
  const developmentQuotaStatus = await fetch(`${baseUrl}/api/status`).then((response) => response.json());
  assert.equal(developmentQuotaStatus.generationMode, "development");
  assert.equal(developmentQuotaStatus.jobsUsed, 4, "Development jobs remain in rolling history");
  assert.equal(developmentQuotaStatus.nextAllowedAt, null, "Development status omits quota countdown even over production limit");

  setPersistedAiMode("production");
  const productionQuotaStatus = await fetch(`${baseUrl}/api/status`).then((response) => response.json());
  assert.equal(productionQuotaStatus.generationMode, "production");
  assert.equal(productionQuotaStatus.jobsUsed, 4, "switching mode preserves all recent job history");
  assert.ok(productionQuotaStatus.nextAllowedAt, "Production status exposes rolling quota reset time");
  await changeProjectTitle("production-blocked");
  assert.deepEqual(JSON.parse(await readFile(jobSnapshotPath, "utf8")), snapshot, "project edits never mutate existing motion/render snapshot");
  assert.equal((await generate()).status, 429, "Production counts Development-created jobs against daily limit");

  setPersistedAiMode("development");
  await changeProjectTitle("development-unlimited-again");
  assert.equal((await generate()).status, 201, "switching back to Development restores unlimited local snapshots");
  const switchedBackStatus = await fetch(`${baseUrl}/api/status`).then((response) => response.json());
  assert.equal(switchedBackStatus.jobsUsed, 5, "new Development job is still recorded in history");
  assert.equal(switchedBackStatus.nextAllowedAt, null);

  setPersistedAiMode("production");
  await changeProjectTitle("production-still-limited");
  assert.equal((await generate()).status, 429, "switching back to Production cannot reset quota history");

  const secondForm = new FormData();
  secondForm.append("audio", new Blob([await readFile(audioPath)], { type: "audio/wav" }), "again.wav");
  const secondUpload = await fetch(`${baseUrl}/api/projects/${projectId}/audio`, { method: "POST", body: secondForm }).then((response) => response.json());
  projectUploadPath = path.resolve("public", secondUpload.audio.file);
  const deleted = await fetch(`${baseUrl}/api/projects/${projectId}`, { method: "DELETE" });
  const deletion = await deleted.json();
  assert.equal(deleted.status, 200);
  assert.equal(deletion.deleted, true);
  assert.equal(deletion.cleanupPending, 0, "cleanup queue should drain after project deletion");
  assert.equal((await fetch(`${baseUrl}/api/projects/${projectId}`).then((response) => response.status)), 404, "deleted project should disappear");
  assert.equal((await fetch(`${baseUrl}/api/jobs/${jobId}`).then((response) => response.status)), 404, "project jobs should be deleted");
  await assert.rejects(readFile(projectUploadPath), "project upload should be deleted");
  await assert.rejects(readFile(jobSnapshotPath), "job snapshot should be deleted");
  await assert.rejects(readFile(renderOutputPath), "job MP4 should be deleted");
  await readFile(jobAudioPath); // content-addressed audio remains a shared immutable cache
  const finalQuotaStatus = await fetch(`${baseUrl}/api/status`).then((response) => response.json());
  assert.equal(finalQuotaStatus.jobsUsed, 5, "deleting a project must not reset rolling job history");
  assert.equal(finalQuotaStatus.generationMode, "production");
  projectId = undefined;
  console.log(`PASS: Outro library CRUD/default/archive/project settings; production UI/API, Vite proxy Origin/CSRF, import/idempotency, AI mode validation/persistence + TTS quota isolation, review, cleanup, shared audio, quota. Gemini configured=${ttsStatus.configured}.`);
} finally {
  for (const id of outroProjectIds) await fetch(`${baseUrl}/api/projects/${id}`, { method: "DELETE" }).catch(() => {});
  for (const id of outroAssetIds) await fetch(`${baseUrl}/api/outros/${id}`, { method: "DELETE" }).catch(() => {});
  if (projectId) await fetch(`${baseUrl}/api/projects/${projectId}`, { method: "DELETE" }).catch(() => {});
  if (assetProjectId) await fetch(`${baseUrl}/api/projects/${assetProjectId}`, { method: "DELETE" }).catch(() => {});
  if (reusableTargetId) await fetch(`${baseUrl}/api/projects/${reusableTargetId}`, { method: "DELETE" }).catch(() => {});
  if (jobAudioPath) await rm(jobAudioPath, { force: true });
  if (assetUploadPath) await rm(assetUploadPath, { force: true });
  if (flowAssetPath) await rm(flowAssetPath, { force: true });
  if (renderOutputPath) await rm(path.dirname(renderOutputPath), { recursive: true, force: true });
  viteServer?.kill();
  if (viteServer) await new Promise<void>((resolve) => {
    if (viteServer!.exitCode !== null) return resolve();
    viteServer!.once("exit", () => resolve());
    setTimeout(resolve, 3000);
  });
  server.kill();
  await new Promise<void>((resolve) => {
    if (server.exitCode !== null) return resolve();
    server.once("exit", () => resolve());
    setTimeout(resolve, 3000);
  });
  await rm(tempDir, { recursive: true, force: true });
}
