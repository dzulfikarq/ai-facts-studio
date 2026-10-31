# Local Outro Library

Users store reusable outro MP4s in local app storage; repository ships no MP4. Uploads pass media validation and FFmpeg normalization to H.264/30 fps, with local poster, hash, and stream metadata. Files are content-addressed under `public/outros/`; asset records live in SQLite `outro_assets`.

## Project and render behavior

- A new project snapshots current library default unless request explicitly selects an asset or `null` (**Tanpa Outro**). Project selection, enabled state, trim range, and source-audio choice persist in project JSON; later default changes do not update existing projects.
- Video Editor keeps video-level outro controls outside scene Inspector. A selected, enabled outro is a separate timeline segment appended after scene content. Preview and renderer V6 use the same file/trim; source audio is opt-in. Scene overlays do not cover outro.
- V6 snapshots include asset identity, local path, SHA-256, bytes, duration, trim, and audio choice. Render validates asset integrity and refuses missing/changed media. No automatic fallback. Renderer V1–V5 remain supported and do not acquire outro behavior.
- Delete permanently removes unreferenced assets. Project/snapshot references archive the library record and retain files; cleanup runs after references disappear. Missing legacy references remain visible and can be explicitly detached/reselected.

## Local API

- `GET /api/outros`: active/archived library metadata and default.
- `POST /api/outros`: multipart MP4 upload (`outro` field).
- `PATCH /api/outros/:id`: rename (`{ "name": "..." }`).
- `POST /api/outros/:id/default`: set active library default.
- `DELETE /api/outros/:id`: permanently delete or archive while referenced.
- Project create accepts `outroId` (omitted = current default, `null` = none); project update persists `outro` selection/settings.

The upload limit follows `MAX_UPLOAD_MB`, capped at 100 MB. Media validation also enforces supported dimensions, frame rate, and duration; invalid uploads return an actionable API error. This library is local to this app installation, not cloud-synced.
