# OriginKit

**A local-first creative asset provenance and licensing workspace.** Track where files came from, who created them, which license or permission applies, what uses are allowed, and what needs review before a client handoff.

OriginKit runs as a static website. It does not require an account, API key, upload server or third-party analytics. Original files and project records are stored in IndexedDB in the browser profile where the app is opened.

## What it does

- **Asset intake:** add multiple files by picker or drag and drop; record file type, size, image dimensions and SHA-256 fingerprint.
- **Duplicate awareness:** flag exact file matches by SHA-256 without deleting or merging either record.
- **Project organization:** group records by client, campaign or internal project; archive or delete projects without deleting their assets.
- **Provenance records:** record creator or rights holder, provider, original source URL, license or permission basis, evidence URL or note, attribution, expiry and AI origin.
- **Permission register:** explicitly record commercial use, modification and redistribution as allowed, not allowed or not recorded.
- **Rights-readiness checks:** calculate `Cleared`, `Needs review` or `Blocked` from the fields you record. Expired records and explicitly denied permissions are blocked; missing evidence or unconfirmed permissions need review.
- **Portable handoffs:** export a JSON rights manifest, attribution Markdown, CSV register and printable HTML report.
- **Full local backup:** create and restore an `.originzip` containing project records, asset metadata and stored original files. Restore merges records and does not overwrite the existing workspace.
- **Privacy controls:** estimate browser storage where supported and clear the local workspace when requested.

## Quick start

No install or build step is required to use the deployed static app. For local development, use any static file server from the repository root. A current browser with IndexedDB, Web Crypto and ES modules is required. The site should be served over HTTPS or localhost for cryptographic fingerprints.

For project checks:

```bash
npm run verify
```

There are no runtime or development package dependencies. The scripts use Node.js built-ins only (Node.js 20 or newer).

## Deploy to GitHub Pages

1. Push this repository to the `main` branch.
2. In **Settings → Pages**, set **Build and deployment** to **GitHub Actions**.
3. The workflow at `.github/workflows/pages.yml` runs checks, tests and a production copy build, then deploys `dist/`.
4. Open the Pages URL shown in the deployment job. For a user site or project site, all asset paths are relative so a repository subpath works.

The workflow uses Node 24 and the current major versions of the official GitHub Pages actions.

## Using OriginKit

1. Create a project, or add files directly to the unassigned library.
2. Add one or more creative files. The original file is saved locally in this browser profile.
3. Open each asset and record its creator, source, license, evidence and permission decisions.
4. Add attribution wording and expiry information when applicable.
5. Resolve every `Needs review` or `Blocked` item before you rely on the register for a handoff.
6. Export the manifest, attribution sheet or CSV, or create a full backup before changing devices or browser profiles.

### Rights-readiness rules

- **Blocked:** the recorded expiry date has passed, or any tracked permission is explicitly marked `Not allowed`.
- **Needs review:** a source URL, creator, license, evidence note/URL, permission confirmation or AI-origin classification is missing; or required attribution text is missing.
- **Cleared:** the required fields are present and all three tracked permissions are explicitly marked `Allowed`.

These are completeness checks on user-entered data. OriginKit does not crawl providers, authenticate rights holders, inspect legal agreements, determine copyright ownership, verify whether a license is current, or decide whether a use is lawful. “Cleared” means the record meets the app's completeness rules; it is not legal clearance. Review the actual license and obtain professional advice where needed.

## Data, privacy and backup

- Files and records are stored in IndexedDB on the current browser profile and device.
- No file upload, remote database, analytics beacon or third-party font/image request is used by the app.
- Browser storage can be cleared by the user, browser policy or device cleanup. Browser quota and persistence behavior vary.
- Use **Handoff & exports → Download backup** regularly. Backups contain original files and may include confidential client material; store them securely.
- Restoring a backup adds a new copy of its projects and assets to the current workspace. It does not replace or delete existing records.
- If a browser does not support IndexedDB or Web Crypto, OriginKit shows an error or records the fingerprint as unavailable; it does not silently upload files elsewhere.

## Browser support

Use a current release of Chrome, Edge, Firefox or Safari. Drag-and-drop, IndexedDB, Web Crypto, `createImageBitmap` and the File System APIs are browser-dependent; image dimensions are optional metadata and may be unavailable for unsupported formats.

## Development and QA

```bash
npm run check
npm run lint
npm test
npm run build
```

`npm run verify` runs the static checks, lint rules, automated tests and production build. Tests cover rights status rules, validation, filtering, CSV escaping, attribution output, HTML escaping, file classification, safe filenames and backup ZIP integrity/path validation.

## License

MIT. See [LICENSE](./LICENSE).

Copyright (c) 2026 Akhil Alladi
