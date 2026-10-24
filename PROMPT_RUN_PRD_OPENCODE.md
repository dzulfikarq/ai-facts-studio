# RUN PRD — PROMPT UNTUK OPENCODE CODING AGENT

Kamu bertindak sebagai **senior full-stack engineer + motion graphics engineer** yang diminta membangun aplikasi **AI Facts Studio V1** berdasarkan PRD di repository ini:

`PRD_AI_Facts_Studio_V1.md`

## Misi

Implementasikan aplikasi yang benar-benar bekerja, **local-first, free-first**, untuk membuat video edukasi fakta menarik vertikal 9:16 dari research package JSON dan voice-over. Prioritaskan alur **import → storyboard → generate deterministik → preview → cloud render GitHub Actions → unduh MP4**. UI modern dan sederhana. Render final tidak boleh membebani komputer lokal.

## Aturan pengerjaan

1. **Baca PRD secara menyeluruh sebelum coding.** Audit isi repo lebih dulu. Bila kosong, scaffold proyek; bila ada aplikasi, ikuti pola existing tanpa merusak kode yang ada.
2. Verifikasi versi dan kompatibilitas stack serta dokumentasi API terbaru. Jangan menganggap detail API/library tertentu selalu sama dengan contoh PRD.
3. Pilih Next.js, TypeScript, Tailwind, Remotion, FFmpeg, SQLite, Zod, dan GitHub Actions kecuali audit mengungkap alasan kuat untuk penyesuaian. Catat keputusan penting.
4. **Jangan ketergantungan pada OpenCode runtime untuk tiap video.** OpenCode dipakai untuk menulis aplikasi; produksi normal harus 100% memakai template animasi reusable. Integrasi OpenCode untuk custom-scene bersifat opsional P1, dengan budget panggilan, explicit opt-in dan human review.
5. **Hindari klaim serba gratis:** model gratis, TTS, Actions dan lisensi dapat berubah. Jangan pernah mengaktifkan model berbayar atau billing otomatis. Jalur dasar dapat memakai upload audio manual.
6. **Jangan gunakan gambar acak dari internet** untuk mengisi scene. Bangun aset SVG/code-based sehingga style konsisten dan lisensinya aman.
7. **Input JSON adalah data tak tepercaya.** Validate, sanitize, enforce allowlists. Jangan execute script dari JSON atau menjalankan shell memakai nilai JSON yang belum divalidasi. GitHub credential hanya di server/secret store; jangan pernah commit atau log secret.
8. Maksimum 1 job video **baru** per 24 jam (configurable), dengan resume/rerender job yang sama tanpa memakan slot baru. Status progress harus nyata, bukan persentase karangan.
9. Kerjakan **bertahap tetapi teruskan ke implementasi**; jangan berhenti hanya pada desain atau dokumen. Jika kredensial eksternal belum tersedia, implementasikan jalur/adapter nyata dan test dengan mocks, lalu tandai live testing sebagai *belum terverifikasi*.
10. Setiap fase harus menghasilkan kode, validasi, dan dokumentasi yang konsisten. Jangan membuat banyak abstraksi atau fitur non-P0 sebelum video contoh bisa dirender.

## Urutan kerja wajib

### Tahap 0 — Audit dan rencana singkat
- Inspeksi folder, dependency, repo, environment, video/audio pipeline yang sudah ada.
- Temukan research package JSON yang tersedia (jika ada). Bila skemanya berbeda dari kontrak PRD, buat importer/adapter yang mengonversi tanpa hilang data; jika tidak ada file, buat sample sesuai PRD.
- Tulis checklist implementasi ringkas, identifikasi risiko dan asumsi. Lanjut kerjakan tanpa meminta persetujuan untuk keputusan teknis minor.

### Tahap 1 — Fondasi dan data
- Scaffold aplikasi UI/API, types/schema, database, job/status handling.
- Implement Dashboard, Create, import/editor research package, validasi dan error handling.
- Sediakan sample video fakta 'Bagaimana Gunung Bisa Terbentuk?' 7 scene dengan referensi nyata.

### Tahap 2 — Mesin animasi & preview
- Implement Remotion composition, reusable 2D SVG scene library, subtitle, motion presets dan visual effects.
- Buat animasi gunung yang benar-benar memvisualisasikan collision/folding/uplift; tidak cukup presentasi teks.
- Implement upload audio, probe durasi, sinkron scene/captions (tunjukkan jika timing hanya estimated).
- Preview low-resolution agar tidak membebani laptop.

### Tahap 3 — Render cloud
- Implement workflow GitHub Actions yang menjalankan renderer tepercaya dari repository.
- Buat mekanisme aman pengiriman job snapshot/aset dan pemulihan status dengan run ID.
- Output MP4 1080x1920 H.264/AAC; verifikasi dengan ffprobe dan checksum.
- Support download artifact dan fallback instruksi GitHub manual bila token belum tersedia.
- Implement retry/rerender/idempotency/error/recovery, tanpa infinite retries.

### Tahap 4 — Stabilization dan optional OpenCode
- Pastikan happy path tidak memakai token AI sama sekali.
- Buat settings untuk OpenCode integration jika feasible, disabled default; jika tidak layak untuk V1, dokumentasikan deferred feature sesuai PRD.
- Performance tuning, typecheck/lint/build, automated tests, smoke render, UX verification.

## Dokumentasi wajib: JANGAN DILEWATI

**Buat dan perbarui dokumentasi teknis setelah audit serta selaraskan dengan kode sesudah setiap fase:**
- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/RESEARCH_PACKAGE_SCHEMA.md`
- `docs/VIDEO_PIPELINE.md`
- `docs/GITHUB_ACTIONS_SETUP.md`
- `docs/OPENCODE_INTEGRATION.md`
- `docs/USER_GUIDE.md`
- `docs/TESTING_AND_LIMITATIONS.md`
- `docs/IMPLEMENTATION_STATUS.md`

Dokumentasi tidak boleh sekadar template rencana: sertakan instruksi setup yang benar, contoh .env.example tanpa secrets, cara mulai dev, cara import sample JSON, cara preview, trigger Actions, unduh MP4, troubleshooting, arsitektur dan batasan nyata. Tandai tegas **implemented / tested locally / mocked / not live-tested / blocked** pada setiap fitur terkait. Jangan klaim cloud render atau autentikasi GitHub sudah live-tested tanpa tes yang benar-benar dilakukan.

## Acceptance gate

- Research package valid → project dibuat → storyboard bisa diedit.
- Scene gunung 2D bergerak dengan parallax/tectonic uplift, bukan slideshow.
- Audio upload/scene timing terintegrasi dan preview berjalan tanpa model AI.
- Workflow cloud siap dan punya test yang relevan; jika token tersedia, lakukan satu end-to-end cloud render nyata dan verifikasi MP4; jika tidak, tuliskan blocker.
- Daily limit, idempotency, retry, schema validation, secrets, error paths diuji.
- Semua lint/typecheck/build/tests yang relevan lulus atau hasil kegagalan dilaporkan apa adanya.
- README dan seluruh dokumen di atas mencerminkan implementasi aktual.

## Format laporan akhir yang harus kamu kirim

1. Ringkasan perubahan dan fase yang diselesaikan.
2. Fitur yang benar-benar berjalan; fitur yang masih mocked/terhalang.
3. Daftar file utama dan dokumen yang dibuat/diubah.
4. Bukti perintah test/build/smoke render dan hasilnya.
5. Langkah setup yang harus dilakukan user (GitHub secrets, FFmpeg, CLI), bila diperlukan.
6. Langkah berikutnya untuk mencapai satu video MP4 produksi pertama.

**Mulai sekarang:** audit repository, baca PRD, lalu implementasikan secara nyata dengan prioritas satu sample video animasi lengkap yang bisa diproduksi berulang tanpa token AI per scene.
