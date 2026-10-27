# PRODUCT REQUIREMENTS DOCUMENT (PRD)
## AI Facts Studio — V1.0 (Local-first, Free-first)

**Status:** Ready for implementation  
**Tanggal:** 24 Oktober 2026  
**Jenis:** Personal web application / educational motion-graphics video generator  
**Target pengguna:** Solo creator, bahasa Indonesia  
**Prioritas:** Satu video berkualitas per hari, minim biaya dan beban komputer

---

## 1. Ringkasan produk

AI Facts Studio adalah aplikasi lokal yang mengubah **research package** terverifikasi (dihasilkan bersama ChatGPT atau ditulis manual) menjadi video edukasi pendek vertikal melalui template animasi 2D berbasis kode. Pengguna memilih model konten, mengimpor/menyunting riset, memeriksa storyboard dan naskah, lalu menekan **Generate** untuk menyiapkan narasi, scene, subtitle, preview, dan render MP4 di GitHub Actions bila tersedia. Output **ditinjau pengguna sebelum diunduh atau dipublikasikan secara manual**.

**Prinsip arsitektur utama:** OpenCode adalah **coding agent untuk pengembangan aplikasi** dan **opsional untuk pembuatan komponen scene baru**; OpenCode **bukan dependensi runtime wajib** untuk setiap video. Renders reusable harus berhasil tanpa satu pun panggilan LLM. Tidak menjalankan model AI/video diffusion lokal. Tidak membuat janji biaya nol atau rendering cloud tak terbatas.

## 2. Masalah dan sasaran

**Masalah:** Video informasi bergaya vector motion graphic dengan sinkronisasi narasi dan animasi membutuhkan riset, storyboard, aset, timing, dan rendering. Generator AI video berbasis GPU cenderung memakan biaya/kuota atau membutuhkan komputer kuat.

**Sasaran V1:**
1. Pengguna membuat **maksimum 1 job video baru per rolling 24 jam** (default dapat dikonfigurasi) dalam alur normal; preview/rerender job yang sama tidak dihitung sebagai job baru.
2. Mendukung riset yang dapat diperiksa sumbernya; tidak mengarang fakta, data, atau sumber.
3. Menghasilkan video **MP4 H.264 + AAC**, rasio **9:16**, final 1080×1920, target 30–60 detik, dengan scene yang memvisualisasikan narasi.
4. Preview hemat sumber daya secara lokal dan render final di cloud bila runner tersedia.
5. Membatasi penggunaan OpenCode/model gratis: **nol panggilan AI pada happy path berbasis template**, fallback manual saat layanan AI/TTS/cloud tidak tersedia.
6. Menggunakan komponen scene dan aset yang dapat digunakan ulang untuk produksi harian.

**Bukan sasaran V1:** auto-posting TikTok/Instagram/YouTube, riset otomatis langsung dari internet dalam aplikasi, klaim TTS gratis tanpa kuota, text-to-video diffusion, sistem multi-user/billing, generator ilustrasi fotorealistik, pengeditan timeline setara Premiere, proses asinkron tanpa mesin lokal aktif untuk orkestrasi (kecuali pekerjaan GitHub Actions yang sudah dipicu).

## 3. Pengguna dan skenario utama

**Persona:** kreator edukasi individu yang menulis prompt riset di ChatGPT, memiliki komputer kelas menengah, menginginkan video fakta menarik 1x/hari.

**Skenario utama:**
1. ChatGPT menyiapkan dan memverifikasi topik (misalnya, 'Bagaimana gunung bisa terbentuk?') dan menghasilkan JSON research package.
2. Pengguna membuka AI Facts Studio → Create Video → memilih kategori dan gaya visual → impor file JSON.
3. Sistem memvalidasi skema, durasi, serta daftar sumber; pengguna mengoreksi narasi/storyboard bila perlu.
4. Pengguna menambah audio voice-over manual **atau** memilih provider TTS bila tersedia dan dikonfigurasi.
5. Klik Generate: aplikasi menyusun timeline dan aset dari visual library, lalu menampilkan preview ringan.
6. Klik Render Final: kirim job aman ke GitHub Actions (atau beri instruksi alternatif lokal jika cloud tidak dikonfigurasi).
7. Pengguna melihat status, mengambil MP4, mengecek kualitas, lalu menandai Approved/Needs Revision. Tidak auto-upload.

## 4. Model konten dan gaya visual

**Kategori konten:** Fakta Unik, Sains & Antariksa, Sejarah & Misteri, Tubuh Manusia, Hewan & Alam, Teknologi, Geografi. Kategori bersifat metadata, tidak mengubah fakta.

**Visual preset terpisah dari kategori:**
- **Flat 2D Storytelling:** landscape, bangunan, karakter siluet, props SVG, layer dan transisi.
- **Animated Infographic:** diagram, panah, perbandingan, angka, chart non-menyesatkan.
- **Cinematic Parallax:** layer background/midground/foreground, camera pan/zoom, ambient FX.

**Gaya dasar:** 9:16, warna navy/teal/oranye, font bebas lisensi yang dapat dibundel, kontras teks tinggi, safe area Shorts/Reels, caption sinkron, kamera tidak berlebihan, transisi tidak mengganggu isi. Preview memakai aset deterministik dan tidak perlu mengambil gambar acak dari internet.

## 5. Kebutuhan fungsional (P0 = wajib, P1 = setelah MVP end-to-end)

### F01 Dashboard (P0)
- Daftar video dan status: Draft, Research Ready, Audio Pending, Ready to Generate, Generating, Preview Ready, Rendering, Rendered, Approved, Needs Revision, Failed, Cancelled.
- Ringkasan produksi hari ini, jendela limit berikutnya, riwayat job, error yang dapat ditindaklanjuti.

### F02 Create & Research Package (P0)
- Buat draft judul, kategori, visual preset, durasi target, bahasa, rasio.
- Upload JSON dan editor data utama. Validasi memakai Zod/JSON Schema serta pesan kesalahan per field.
- Setiap klaim penting dapat dihubungkan ke URL sumber yang kredibel; sumber disimpan beserta judul, penerbit, tanggal jika tersedia, dan retrieval date bila relevan.
- Impor riset **bukan** bukti otomatis bahwa klaim benar; tampilkan status Verified by Author / Needs Review. Tidak diam-diam melengkapi fakta.
- Tanpa URL/sumber yang cukup, tampilkan warning; publikasi memerlukan konfirmasi review pengguna.
- Lindungi dari file berbahaya, invalid JSON, path traversal, dan instruksi tersembunyi dalam research package; perlakukan data sebagai data, bukan perintah shell/AI.

### F03 Naskah dan storyboard (P0)
- Scene list berurutan dengan start/end relatif, narrationText, onscreenText, visual instructions, visualPreset, templateId, motion cues, SFX cues, sumber fakta.
- Timeline awal dari target durasi; **durasi final diukur dari audio sebenarnya**. Jika audio tidak cocok, adaptasikan scene dengan kebijakan yang terlihat dan minta review.
- Editing scene metadata, durasi, hook, caption, serta template tanpa harus memanggil AI.

### F04 Audio/TTS (P0 manual, P1 provider)
- P0 upload voice-over MP3/WAV/M4A yang didukung pipeline; validasi format, ukuran dan metadata; konversi offline jika perlu.
- P0 fallback silent preview dan subtitle; final render harus memberi warning jelas jika audio voice-over tidak ada (atau pengguna mengizinkan tanpa narasi).
- P1 provider TTS yang dipilih secara eksplisit, adapters pluggable; cek syarat penggunaan dan kuota provider; tidak mengunci provider tertentu dan tidak menyimpan kunci di frontend.
- Timing caption: P0 segment-level + sync per scene; P1 forced alignment jika tool yang tersedia mendukung. Jangan klaim sinkron per kata tanpa data timing.
- Musik/SFX hanya dari aset berlisensi sesuai; audio dinormalisasi dan ducking selama voice-over.

### F05 Animation Library & preview (P0)
- Remotion React compositions; reusable SVG primitives untuk gunung, awan, laut, pohon, kota, karakter siluet, planet, lapisan Bumi, panah, diagram, volcano, rain, particles.
- Motion cues terbatas/tervalidasi (fadeIn, slide, scale, pan, zoom, parallax, reveal, pulse, cut, dissolve); tidak mengevaluasi JS dari JSON.
- Preview resolusi turun (mis. 360×640 atau 540×960) dan capped FPS/performance budget; preview tidak memerlukan video render penuh.
- Default template video contoh 'Bagaimana gunung bisa terbentuk?' dengan 7 scene dan proper animasi plate collision, folding/uplift, Himalaya, volcano; hindari misrepresentasi proses saintifik.

### F06 Generate & job orchestration (P0)
- Generate membuat **snapshot immutable** dari input dan komposisi untuk job. Idempotency key, persistent job state, single concurrency per device/account.
- Batas 1 **video baru**/rolling 24h untuk operasi pengguna; simpan waktu UTC, tampilkan countdown timezone lokal. Draft tidak dihitung; preview ulang dan render ulang job sama diperbolehkan dengan pembatasan retry.
- Jika gagal di tahap audio/template, user boleh Retry/Resume **job yang sama** tanpa mengkonsumsi slot baru.
- Checkpoint dan log job terstruktur, pembatalan aman saat tahap masih cancellable, timeout untuk task, tidak ada loop retry tak terbatas.
- Tidak perlu OpenCode pada jalur happy path; semua template normal diproses deterministik.

### F07 OpenCode (P1; integrasi opsional)
- Halaman Settings menunjukkan status CLI dan provider/model yang dikonfigurasi; model free harus ditemukan secara dinamis dari CLI, tidak hardcode nama model.
- Aksi **Generate Custom Scene** adalah aksi eksplisit, opt-in, dengan preview estimasi jumlah panggilan dan hard cap per job.
- OpenCode output ke workspace sementara yang disandbox: tanpa kredensial, tanpa akses arbitrary FS, tanpa command injection, dengan review manusia sebelum komponen masuk repository. Kode tidak dieksekusi secara otomatis.
- Jika model offline, rate-limited, atau berbayar saja, tampilkan fallback template/manual dan jangan auto-upgrade ke paid.

### F08 Cloud Render (P0)
- GitHub Actions workflow_dispatch/repository_dispatch dengan permission minimal. Gunakan tag/commit yang sudah dipercaya + snapshot input; jangan jalankan kode dari JSON tanpa validasi.
- Job cloud mengunduh/mengambil snapshot dari mekanisme terautentikasi/aman; hindari memasukkan script, private voice-over, atau secret ke repo publik/artifact publik.
- Pilihan MVP paling aman: repo **privat** dan artifact terenkripsi/akses terbatas; perhatikan kuota Actions. Jangan bergantung pada repository publik demi gratis jika asetnya sensitif.
- Status: queued, in_progress, completed, failed, cancelled, unknown; polling adaptif dengan interval wajar, exponential backoff.
- MP4 downloadable dari artifact dengan autentikasi GitHub yang disimpan server-side/OS keychain dan tidak bocor di client. Alternatif: tautan ke halaman workflow GitHub untuk unduh manual.
- Hasil diperiksa (audio, video, rasio, codec, resolusi, durasi, file size, SHA-256). Re-render mempertahankan job id dengan render attempt baru.
- Saat GitHub belum disetup: tetap bisa impor, edit, preview. UI menampilkan setup checklist; jangan pura-pura job cloud berhasil.

### F09 Review and library (P0)
- Video detail memiliki metadata, daftar sumber, storyboard, preview, log render, unduh MP4, status Approved/Needs Revision.
- Tidak ada auto-publish. Pengguna bertanggung jawab meninjau kebenaran narasi, lisensi dan visual sebelum upload.
- Simpan history dan output manifest; cleanup artifact menurut retention configurable.

### F10 Settings (P0)
- GitHub owner/repo dan diagnostic authorization, limits, default subtitle, storage path, render profile, dan audio settings.
- Secrets di environment variables/OS secret store, **tidak** di database plaintext, git, API response, log atau browser localStorage.

## 6. Data model (minimum)

**VideoProject:** id, title, category, visualPreset, language, targetDurationSec, researchPackage, researchReviewStatus, status, createdAt, updatedAt.

**Scene:** id, projectId, position, narrationText, onScreenText, startSec, endSec, templateId, visualData (validated), animationCues, sfxCues, references[] (IDs).

**Asset:** id, projectId, role (voice/music/sfx/svg), storagePath, mimeType, bytes, checksumSha256, licenseMetadata.

**ProductionJob:** id, projectId, sourceSnapshotSha256, idempotencyKey, createdAt, state, timestamps, errorCode, errorSafeMessage, attemptCount.

**RenderAttempt:** id, productionJobId, githubRunId, githubWorkflowUrl, state, requestedAt, finishedAt, manifest, artifactLocation.

**Reference:** id, title, publisher, url, publishedAt?, checkedAt, verifiedByUser.

**UsageLedger:** id, action, provider?, model?, jobId?, callCount, estimatedTokens?, timestamp, outcome. No invented token usage when unavailable.

## 7. Research package JSON contract

Root:
```json
{
  "schemaVersion": "1.0",
  "id": "facts-001",
  "title": "Bagaimana Gunung Bisa Terbentuk?",
  "category": "Sains & Antariksa",
  "visualPreset": "cinematic-parallax",
  "language": "id-ID",
  "targetDurationSec": 56,
  "aspectRatio": "9:16",
  "narration": "...",
  "references": [{"id":"ref1","title":"...","publisher":"USGS","url":"https://...","checkedAt":"2026-10-24"}],
  "scenes": [{
    "id": "scene01", "order": 1, "startSec": 0, "endSec": 7,
    "narrationText": "...", "onScreenText": "...",
    "templateId": "mountain-reveal", "visualDescription": "...",
    "motionCues": ["zoom", "fadeIn"], "sfxCues": [], "referenceIds": ["ref1"]
  }]
}
```

Schema **versi 1.0 adalah kontrak target**, bukan jaminan kompatibilitas dengan file JSON dari percakapan sebelumnya. Implementer wajib membuat adapter **legacy import** berbasis inspeksi file contoh bila tersedia, dan melaporkan field yang perlu dipetakan; jangan diam-diam membuang data.

Validasi: sceneIds unik, positions monoton, time nonnegatif, no overlap kecuali fitur overlay eksplisit, max 120s, URL referensi berprotokol http/https, strings length cap, cue allowlist, templateId allowlist, asset size cap.

## 8. Arsitektur teknis

**Stack rekomendasi:** Monorepo sederhana Next.js + TypeScript + Tailwind (UI, local API) + Remotion (scene renderer) + SQLite (Prisma/Drizzle; pilih salah satu) + Zod + FFmpeg + GitHub Actions. Kode UI dan renderer berbagi schema types.

**Flow data:** User JSON → schema validation → editable research package → scene compiler → Remotion composition + audio pipeline → local preview → signed/trusted render payload → GitHub workflow → validated MP4 artifact → review.

**Privacy/security:** binding local web server ke `127.0.0.1` by default; validasi semua uploads; secret backend only; safe subprocess args; avoid outbound requests from imported data; strict GitHub workflow permissions; avoid executing arbitrary user-provided JSX. Gunakan checksum snapshot untuk konsistensi render.

**Cloud feasibility:** Browser/Next.js lokal membutuhkan proses aktif untuk memicu cloud render dan menerima progress; GitHub Actions melanjutkan render di cloud sesudah terpicu. Jika aplikasi mati, status dapat dipulihkan pada startup berikutnya dari run ID. Untuk P0, hindari desain yang memerlukan server publik/webhook.

## 9. Status flow & error recovery

Draft → Research Ready → Audio Pending (jika diperlukan) → Ready → Generating → Preview Ready → Rendering → Rendered → Approved / Needs Revision. Failure dari setiap tahap menyimpan stage dan bisa resume dengan action eksplisit; Cancel hanya saat operasi dapat dibatalkan. Jangan menampilkan progress palsu: gunakan tahap yang sebenarnya dan persentase hanya bila tersedia dari process output.

**Failure modes:** invalid research JSON, missing audio, TTS quota, OpenCode model unavailable, Actions quota/permissions, GH token expired, artifact expired, FFmpeg missing, render timeout, invalid output. Masing-masing memiliki pesan dan langkah perbaikan di UI.

## 10. Performance & cost

- Default **zero AI calls per video** bila seluruh scene menggunakan library template.
- Non-default OpenCode custom scene max 2 panggilan/job dan bisa dimatikan, configurable.
- Local preview low-res, lazy-loaded, cached; hindari render 1080p di laptop.
- Satu render final aktif pada satu waktu; tidak ada parallel batch.
- Daily cap pada **new production jobs**, bukan draft/storyboard edit.
- Monitor GitHub free quota sesuai plan dan jenis repo; bila hampir habis, hentikan auto-dispatch dan fallback preview/manual. Tidak ada klaim 'unlimited'.
- Jangan melakukan konversi narasi dengan layanan TTS eksternal tanpa persetujuan pengguna.

## 11. UX/pages

1. **Dashboard:** status terakhir, today's allowance, Create Video, library.
2. **Create Video:** metadata, category/preset, JSON import/editor, validation summary.
3. **Storyboard:** ordered scenes, details, sources, timings, preview panel.
4. **Audio:** upload recording / TTS adapter optional, audio quality preview.
5. **Generate:** build stages, errors, scene template mapping, preview.
6. **Render Detail:** status cloud + run URL, re-render, verified MP4 download.
7. **Settings:** runner status, CLI status, secrets checklist, quality presets, quota.

Default UI: bersih, responsif, aksesibilitas dasar (keyboard, labels, contrasts), tidak perlu admin/multi-tenant.

## 12. Fase implementasi / Definition of Done

**Phase 0 — Audit & foundation:** audit repo, dependencies, licensing, GH auth, secret handling, README setup; finalisasi schema + sample; repo bisa build dan test.

**Phase 1 — MVP UI & importer:** Dashboard, Create, import JSON, editor, validation, database, sample fakta gunung; unit test import and invalid input.

**Phase 2 — deterministic video engine:** 7-scene mountain demo, vector scene library, captions, audio upload, preview. Dengan sample package + audio, hasil preview menggambarkan scene, bukan slide teks statis.

**Phase 3 — cloud render:** GitHub Actions workflow, secure transport/snapshot, statuses, artifact MP4 valid, rerender, failure handling. **Critical acceptance:** setidaknya satu MP4 dari workflow nyata jika kredensial GitHub disediakan; bila belum, tandai unverified, bukan completed.

**Phase 4 — stabilization:** limits, retries, usage ledger, checklist QA, responsiveness, documentation, 3 test packages (mountains, space, animals). OpenCode custom scene bisa dikerjakan P1 setelah P0 stabil.

**Project accepted when:**
- Import sample JSON → edit storyboard → attach audio → generate → preview → render cloud → download MP4 untuk satu job end-to-end.
- Rendered MP4 mempunyai 9:16 1080×1920, H.264 video dan AAC audio (jika audio tersedia), durasi sesuai audio dalam toleransi wajar (mis. ±2 detik setelah penyesuaian).
- Fakta/sumber dari package terjaga; UI menunjukkan user review.
- 1 job/rolling 24h teruji, retry job sama tidak membuat job baru.
- Tidak ada OpenCode model invocation di template path.
- Pipeline bisa dimulai tanpa GitHub dan menampilkan pesan setup/preview, tanpa mengklaim MP4 berhasil.
- Unit/integration/smoke tests lolos; lint/typecheck/build lolos; secrets tidak masuk commit atau log.
- Dokumentasi **ditulis/diperbarui berdasarkan hasil implementasi yang benar-benar bekerja**, termasuk known limitations.

## 13. Testing & observability

Automated tests: schema valid/invalid, unsafe URLs, time overlaps, daily limit, idempotency, cancel/retry, scene template resolution, unknown cues, GH workflow payload, status mapping, artifact checksum. Render smoke test minimal scene + ffprobe video/audio metadata. Manual UX test create/preview/error/retry/download. Log error tanpa secrets atau raw user audio.

## 14. Dokumentasi wajib (dibuat agent selama implementasi)

- `README.md`: tujuan, prerequisites, install, develop, testing, screenshot/flow.
- `docs/ARCHITECTURE.md`: modular boundaries, data flow, local/cloud behavior, security trust boundaries.
- `docs/RESEARCH_PACKAGE_SCHEMA.md`: valid schema, examples, legacy importer, validation.
- `docs/VIDEO_PIPELINE.md`: renderer architecture, scene templates, animation cues, timeline and audio synchronization.
- `docs/GITHUB_ACTIONS_SETUP.md`: token scope, secret setup, private repo caveats, quota and download paths.
- `docs/OPENCODE_INTEGRATION.md`: role optional, free models, safe usage, budgets, no-auto-paid.
- `docs/USER_GUIDE.md`: import → preview → render → review → download; troubleshooting.
- `docs/TESTING_AND_LIMITATIONS.md`: tests performed/results, what was mocked/unverified, performance budget, limitations.
- `docs/IMPLEMENTATION_STATUS.md`: phase checklist with actual working state, changed files, blockers, next steps.

**Aturan:** agent boleh menyusun docs selama implementasi, tapi harus menyelaraskan/memperbaruinya setelah kode dan tes; dilarang menulis klaim 'selesai/live-tested' hanya berdasarkan mocks.

## 15. Risiko dan keputusan terbuka

- **TTS gratis tak terjamin:** audio manual adalah jalur utama V1.
- **Kuota OpenCode gratis berubah:** OpenCode bukan dependency mandatory per video.
- **Github Actions bukan unlimited:** ada kuota, storage retention, rate limit, permission controls.
- **Licensing Remotion:** pastikan sesuai kategori pengguna dan penggunaan yang berjalan; dokumentasikan perubahan lisensi.
- **Copyright & ilmiah:** verifikasi fakta dan aset; jangan mengunduh ilustrasi non-lisensi secara otomatis.
- **Timing narasi:** timecodes dari riset hanya target; audio aktual menentukan durasi akhir.
- **Tidak mengandalkan hosted backend:** karena local-first, job cloud dimonitor kembali saat app dibuka.

## 16. Referensi teknologi yang harus diperiksa ulang agent saat setup

- OpenCode CLI: https://docs.opencode.ai/docs/cli/
- OpenCode models: https://opencode.ai/docs/models/
- Remotion license: https://github.com/remotion-dev/remotion/blob/main/LICENSE.md
- Remotion docs: https://www.remotion.dev/docs/
- GitHub Actions billing: https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions

**Instruksi akhir:** Implementasikan MVP end-to-end terlebih dahulu. Hindari fitur besar yang belum dibutuhkan dan optimalkan kualitas animasi ketimbang banyak fitur setengah jadi.
