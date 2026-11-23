import {
  buildAttributions, buildManifest, classifyFile, escapeHtml, filterAssets,
  formatBytes, readiness, safeFilename, summarizeAssets, toCsv, validateAssetRecord,
  validateProjectName,
} from './domain.js';
import { clearWorkspace, estimateStorage, getAssets, getProjects, openDatabase, removeAsset, removeProject, saveAsset, saveProject } from './storage.js';
import { createStoredZip, readStoredZip } from './zip.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const state = {
  projects: [], assets: [], view: location.hash.slice(1) || 'overview', projectFilter: 'all',
  search: '', statusFilter: 'all', typeFilter: 'all', selected: new Set(), previews: new Map(),
};
const root = $('#viewRoot');
const dialog = $('#recordDialog');
const dialogContent = $('#dialogContent');
const filePicker = $('#filePicker');
const backupPicker = $('#backupPicker');

function id() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }
function projectName(projectId) { return state.projects.find((project) => project.id === projectId)?.name ?? 'Unassigned'; }
function statusBadge(asset) {
  const item = readiness(asset);
  return `<span class="status-pill status-${item.status}"><i></i>${item.label}</span>`;
}
function fileGlyph(kind) {
  return ({ image: '▧', font: 'Aa', video: '▶', audio: '♫', document: 'PDF', design: '✳', file: '↗' })[kind] ?? '↗';
}
function previewFor(asset) {
  if (asset.kind !== 'image' || !asset.file) return `<span class="file-glyph">${fileGlyph(asset.kind)}</span>`;
  if (!state.previews.has(asset.id)) state.previews.set(asset.id, URL.createObjectURL(asset.file));
  return `<img src="${state.previews.get(asset.id)}" alt="" loading="lazy">`;
}
function progressClass(percent) { return `progress-${Math.max(0, Math.min(100, Math.round(percent / 10) * 10))}`; }
function projectOptions(selected = '') {
  return `<option value="">Unassigned</option>${state.projects.map((project) => `<option value="${escapeHtml(project.id)}" ${project.id === selected ? 'selected' : ''}>${escapeHtml(project.name)}</option>`).join('')}`;
}
function pageTitle(title, eyebrow, description, action = '') {
  return `<div class="page-heading"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${description}</p></div>${action}</div>`;
}
function emptyState(title, description, actionLabel, action) {
  return `<div class="empty-state"><div class="empty-illustration"><span class="empty-orbit orbit-one"></span><span class="empty-orbit orbit-two"></span><span class="empty-core">O<span>·</span></span></div><h3>${title}</h3><p>${description}</p><button class="button button-primary" data-action="${action}">＋ ${actionLabel}</button></div>`;
}
function assetRows(assets) {
  if (!assets.length) return `<tr><td colspan="6"><div class="table-empty">No assets match these filters.</div></td></tr>`;
  return assets.map((asset) => `<tr>
    <td class="select-cell"><input type="checkbox" aria-label="Select ${escapeHtml(asset.name)}" data-action="toggle-select" data-id="${escapeHtml(asset.id)}" ${state.selected.has(asset.id) ? 'checked' : ''}></td>
    <td><button class="asset-name-cell" data-action="edit-asset" data-id="${escapeHtml(asset.id)}"><span class="asset-thumb">${previewFor(asset)}</span><span class="asset-name-copy"><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(asset.kind.toUpperCase())} · ${formatBytes(asset.size)}${asset.duplicateOf ? ' · EXACT DUPLICATE' : ''}</small></span></button></td>
    <td><span class="muted-cell">${escapeHtml(projectName(asset.projectId))}</span></td>
    <td><span class="license-cell">${escapeHtml(asset.licenseName || 'Not recorded')}</span></td>
    <td>${statusBadge(asset)}</td>
    <td><button class="icon-button" data-action="edit-asset" data-id="${escapeHtml(asset.id)}" aria-label="Edit ${escapeHtml(asset.name)}">↗</button></td>
  </tr>`).join('');
}
function renderOverview() {
  const stats = summarizeAssets(state.assets);
  const recent = [...state.assets].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 5);
  const projectCount = state.projects.filter((project) => !project.archived).length;
  return `${pageTitle('Know every asset’s story.', 'YOUR CREATIVE RIGHTS DESK', 'A clear record of where creative files came from, what you can do with them, and what still needs attention.', `<button class="button button-secondary" data-action="new-project">＋ New project</button>`)}
    <section class="welcome-strip"><div class="welcome-copy"><span class="welcome-kicker">THE PROVENANCE WORKSPACE</span><h2>${stats.total ? 'Your creative work deserves' : 'Good creative work deserves'}<br><em>good records.</em></h2><p>Bring your assets in. Capture the source, rights and attribution once. Hand off with confidence.</p><button class="button button-lime" data-action="add-assets">${stats.total ? 'Add more assets' : 'Add your first assets'} <span>↗</span></button></div><div class="welcome-art" aria-hidden="true"><div class="art-ring ring-a"></div><div class="art-ring ring-b"></div><div class="art-card card-back"><span>LICENSE / 04</span><b>CC BY 4.0</b><i>✓ verified record</i></div><div class="art-card card-front"><span>ASSET ORIGIN</span><b>visual-identity.png</b><i><span class="art-dot"></span> source documented</i></div><div class="art-stamp">OK<br><small>ORIGIN<br>KNOWN</small></div></div></section>
    <section class="stat-grid" aria-label="Workspace summary">
      <article class="stat-card"><span class="stat-label">TOTAL ASSETS <span>↗</span></span><strong>${stats.total}</strong><small>Across ${projectCount} active project${projectCount === 1 ? '' : 's'}</small></article>
      <article class="stat-card stat-cleared"><span class="stat-label">CLEARED <span>✓</span></span><strong>${stats.cleared}</strong><small>Required records completed</small></article>
      <article class="stat-card stat-review"><span class="stat-label">NEEDS REVIEW <span>◷</span></span><strong>${stats.review}</strong><small>Missing or unconfirmed details</small></article>
      <article class="stat-card stat-blocked"><span class="stat-label">BLOCKED <span>!</span></span><strong>${stats.blocked}</strong><small>Expiry or denied permission</small></article>
    </section>
    <section class="content-panel"><div class="panel-heading"><div><div class="eyebrow">RECENTLY ADDED</div><h2>Asset activity</h2></div><a href="#assets" class="text-link" data-view="assets">View asset library <span>↗</span></a></div>
      ${recent.length ? `<div class="asset-list">${recent.map((asset) => `<button class="asset-list-row" data-action="edit-asset" data-id="${escapeHtml(asset.id)}"><span class="asset-thumb">${previewFor(asset)}</span><span class="asset-list-name"><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(projectName(asset.projectId))} · Added ${new Date(asset.addedAt).toLocaleDateString()}${asset.duplicateOf ? ' · Exact duplicate' : ''}</small></span><span class="asset-list-license">${escapeHtml(asset.licenseName || 'License not recorded')}</span>${statusBadge(asset)}<span class="row-arrow">↗</span></button>`).join('')}</div>` : emptyState('Your asset library starts here.', 'Add a file to create its provenance record. Your original file stays in this browser.', 'Add assets', 'add-assets')}
    </section>
    <section class="bottom-note"><span class="note-mark">i</span><div><strong>What does “Cleared” mean?</strong><p>OriginKit checks whether your own records are complete and consistent. It does not verify a license with its publisher or provide legal advice.</p></div><a href="#settings" data-view="settings">Read about privacy <span>↗</span></a></section>`;
}
function renderAssets() {
  const filtered = filterAssets(state.assets, { query: state.search, status: state.statusFilter, type: state.typeFilter, projectId: state.projectFilter });
  const selectedCount = state.selected.size;
  const projectFilter = `<select id="projectFilter" aria-label="Filter by project"><option value="all">All projects</option>${state.projects.map((project) => `<option value="${escapeHtml(project.id)}" ${state.projectFilter === project.id ? 'selected' : ''}>${escapeHtml(project.name)}</option>`).join('')}</select>`;
  return `${pageTitle('Asset library', 'YOUR FILES, WITH CONTEXT', 'One searchable register for source links, licensing evidence, permissions and attribution.', `<button class="button button-primary" data-action="add-assets">＋ Add assets</button>`)}
    <section class="library-toolbar"><div class="filter-group"><label class="filter-search"><span>⌕</span><input id="assetSearch" type="search" value="${escapeHtml(state.search)}" placeholder="Search this library" aria-label="Search this library"></label>${projectFilter}<select id="statusFilter" aria-label="Filter by rights status"><option value="all">All statuses</option><option value="cleared" ${state.statusFilter === 'cleared' ? 'selected' : ''}>Cleared</option><option value="review" ${state.statusFilter === 'review' ? 'selected' : ''}>Needs review</option><option value="blocked" ${state.statusFilter === 'blocked' ? 'selected' : ''}>Blocked</option></select><select id="typeFilter" aria-label="Filter by file type"><option value="all">All file types</option>${['image','font','video','audio','document','design','file'].map((type) => `<option value="${type}" ${state.typeFilter === type ? 'selected' : ''}>${type[0].toUpperCase()}${type.slice(1)}</option>`).join('')}</select></div><span class="result-count">${filtered.length} of ${state.assets.length} assets</span></section>
    ${selectedCount ? `<div class="selection-bar"><strong>${selectedCount} selected</strong><button class="button button-small button-secondary" data-action="export-selected">Export selected CSV</button><button class="text-button" data-action="clear-selection">Clear selection</button></div>` : ''}
    <section class="content-panel table-panel"><div class="table-scroll"><table class="asset-table"><thead><tr><th class="select-cell"><span class="sr-only">Select</span></th><th>ASSET</th><th>PROJECT</th><th>LICENSE</th><th>RIGHTS READINESS</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${assetRows(filtered)}</tbody></table></div></section>
    <p class="microcopy">Select an asset to edit its record. Statuses are calculated from the information you enter.</p>`;
}
function renderProjects() {
  const active = state.projects.filter((project) => !project.archived);
  const archived = state.projects.filter((project) => project.archived);
  const cards = (items) => items.map((project) => {
    const assets = state.assets.filter((asset) => asset.projectId === project.id);
    const stats = summarizeAssets(assets);
    return `<article class="project-card"><div class="project-card-top"><span class="project-icon">${escapeHtml(project.name.slice(0, 1).toUpperCase())}</span><button class="icon-button" data-action="edit-project" data-id="${escapeHtml(project.id)}" aria-label="Edit ${escapeHtml(project.name)}">···</button></div><h3>${escapeHtml(project.name)}</h3><p>${escapeHtml(project.client || 'No client specified')}</p><div class="project-card-meta"><span>${assets.length} assets</span><span>${stats.cleared} cleared</span><span>${stats.review + stats.blocked} to review</span></div><div class="project-card-progress ${progressClass(assets.length ? (stats.cleared / assets.length) * 100 : 0)}"><span></span></div><div class="project-card-actions"><button class="text-link" data-action="open-project" data-id="${escapeHtml(project.id)}">Open assets <span>↗</span></button><button class="text-button" data-action="edit-project" data-id="${escapeHtml(project.id)}">Edit details</button></div></article>`;
  }).join('');
  return `${pageTitle('Projects', 'KEEP WORK ORGANIZED', 'Group files by client, campaign or delivery. Each project carries its own asset register.', `<button class="button button-primary" data-action="new-project">＋ New project</button>`)}
    ${active.length ? `<section class="project-grid">${cards(active)}</section>` : emptyState('Start with a project.', 'Create a client, campaign or internal project before adding your creative files.', 'Create a project', 'new-project')}
    ${archived.length ? `<section class="archived-section"><div class="eyebrow">ARCHIVED</div><div class="project-grid">${cards(archived)}</div></section>` : ''}`;
}
function renderExports() {
  const stats = summarizeAssets(state.assets);
  return `${pageTitle('Handoff & exports', 'TAKE YOUR RECORDS WITH YOU', 'Create portable rights manifests, attribution sheets and full local backups.', '')}
    <div class="export-layout"><section class="export-main"><article class="export-feature"><div class="export-feature-copy"><div class="eyebrow">CLIENT-READY HANDOFF</div><h2>Make the paper trail<br><em>part of the delivery.</em></h2><p>Package the records behind your creative files in formats clients and collaborators can actually use.</p><button class="button button-lime" data-action="export-manifest">Download rights manifest <span>↓</span></button></div><div class="manifest-preview" aria-hidden="true"><div class="manifest-top"><span>ORIGIN MANIFEST</span><span>JSON / v1</span></div><div class="manifest-code"><i>{</i><b> "asset":</b> "campaign-visual.png",<br><b> "source":</b> "documented",<br><b> "license":</b> "CC BY 4.0",<br><b> "rights":</b> <em>"cleared"</em>,<br><b> "attribution":</b> true<br><i>}</i></div><div class="manifest-stamp">RECORD<br>COMPLETE</div></div></article>
      <div class="export-grid"><article class="export-card"><span class="export-icon">¶</span><div><h3>Attribution sheet</h3><p>Markdown list of recorded creators, sources, license names and required attribution text.</p></div><button class="text-link" data-action="export-attributions">Download .md <span>↓</span></button></article><article class="export-card"><span class="export-icon">▤</span><div><h3>Asset register</h3><p>Spreadsheet-friendly CSV with source, permission, expiry and readiness columns.</p></div><button class="text-link" data-action="export-csv">Download .csv <span>↓</span></button></article><article class="export-card"><span class="export-icon">▧</span><div><h3>Printable report</h3><p>A clean HTML report for review, printing or saving as PDF from your browser.</p></div><button class="text-link" data-action="export-report">Download report <span>↓</span></button></article></div>
    </section><aside class="export-aside"><div class="aside-label">WORKSPACE BACKUP</div><div class="backup-icon">⇧</div><h3>Your records. Your files. Your copy.</h3><p>Create a portable backup containing project data, licensing records and the original files stored in this browser.</p><button class="button button-secondary button-full" data-action="backup">Download backup (.originzip)</button><button class="button button-quiet button-full" data-action="restore">Restore from backup</button><div class="backup-warning">Backups may contain client files. Store and share them securely.</div><div class="export-total"><span>ASSETS IN WORKSPACE</span><strong>${stats.total}</strong></div></aside></div>`;
}
async function renderSettings() {
  const estimate = await estimateStorage();
  const used = estimate?.usage ? formatBytes(estimate.usage) : 'Unavailable';
  const quota = estimate?.quota ? formatBytes(estimate.quota) : 'Browser-managed';
  return `${pageTitle('Settings & privacy', 'YOUR DATA, YOUR DEVICE', 'OriginKit is designed to work without an account or upload server.', '')}
    <div class="settings-grid"><section class="settings-card"><div class="settings-card-head"><span class="settings-icon">◉</span><div><h3>Local storage</h3><p>Projects, records and original files are saved in this browser profile using IndexedDB.</p></div></div><div class="storage-meter"><div><span>Estimated browser storage used</span><strong>${used}</strong></div><div class="storage-track ${progressClass(estimate?.quota && estimate?.usage ? Math.min(100, (estimate.usage / estimate.quota) * 100) : 0)}"><span></span></div><small>Browser quota: ${quota}. Actual limits and eviction policies depend on your browser and device.</small></div><div class="settings-actions"><button class="button button-secondary" data-action="backup">Download a full backup</button><button class="button button-quiet" data-action="restore">Restore a backup</button></div></section>
    <section class="settings-card"><div class="settings-card-head"><span class="settings-icon">⌁</span><div><h3>What OriginKit stores</h3><p>Files are not sent to an OriginKit server. This static app makes no analytics or third-party requests.</p></div></div><ul class="privacy-list"><li><span>✓</span> Original files and metadata stay in IndexedDB on this device.</li><li><span>✓</span> SHA-256 fingerprints are calculated in your browser.</li><li><span>✓</span> Exports are generated locally when you request them.</li><li><span>!</span> Clearing browser data or changing devices can remove your workspace. Keep backups.</li></ul></section>
    <section class="settings-card settings-danger"><div class="settings-card-head"><span class="settings-icon">⌫</span><div><h3>Clear local workspace</h3><p>Permanently delete every project, asset record and stored original file from this browser profile.</p></div></div><button class="button button-danger" data-action="clear-workspace">Clear all local data</button></section>
    <section class="settings-card about-card"><div class="eyebrow">ABOUT ORIGINKIT</div><h3>Provenance is a practice.</h3><p>OriginKit helps organize evidence and usage decisions you enter. It does not fetch license terms, authenticate a rights holder, determine copyright ownership or replace legal review.</p><div class="about-version">VERSION 1.0.0 <span>·</span> MIT LICENSE</div></section></div>`;
}

async function render() {
  const views = { overview: renderOverview, assets: renderAssets, projects: renderProjects, exports: renderExports, settings: renderSettings };
  if (!views[state.view]) state.view = 'overview';
  $('#currentCrumb').textContent = state.view.toUpperCase().replace('-', ' ');
  $$('.nav-link[data-view], .mobile-nav [data-view]').forEach((link) => link.classList.toggle('is-active', link.dataset.view === state.view));
  $('#navAssetCount').textContent = String(state.assets.length);
  $('#globalSearch').value = state.search;
  root.innerHTML = await views[state.view]();
}

async function refresh() {
  state.projects = (await getProjects()).sort((a, b) => a.name.localeCompare(b.name));
  state.assets = (await getAssets()).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  const ids = new Set(state.assets.map((asset) => asset.id));
  for (const [assetId, url] of state.previews) {
    if (!ids.has(assetId)) { URL.revokeObjectURL(url); state.previews.delete(assetId); }
  }
  state.selected = new Set([...state.selected].filter((assetId) => ids.has(assetId)));
  await render();
}

function toast(message, tone = 'success') {
  const region = $('#toastRegion');
  const item = document.createElement('div');
  item.className = `toast toast-${tone}`;
  item.textContent = message;
  region.append(item);
  window.setTimeout(() => item.remove(), 4200);
}
function showProgress(message, detail = '') {
  $('#progressRegion').innerHTML = `<div class="progress-card"><span class="spinner"></span><div><strong>${escapeHtml(message)}</strong><small>${escapeHtml(detail)}</small></div></div>`;
}
function hideProgress() { $('#progressRegion').replaceChildren(); }
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.rel = 'noopener';
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}
function downloadText(text, filename, type) { downloadBlob(new Blob([text], { type }), filename); }
function openDialog(markup) { dialogContent.innerHTML = markup; dialog.showModal(); }
function closeDialog() { dialog.close(); dialogContent.replaceChildren(); }

function openProjectDialog(project = null) {
  const editing = Boolean(project);
  openDialog(`<div class="modal-head"><div><div class="eyebrow">${editing ? 'PROJECT DETAILS' : 'NEW WORKSPACE'}</div><h2>${editing ? 'Edit project' : 'Create a project'}</h2><p>Use a client, campaign or internal name to keep assets organized.</p></div><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">×</button></div>
    <form data-form="project" class="modal-form"><label>Project name <span>*</span><input name="name" required maxlength="80" value="${escapeHtml(project?.name ?? '')}" placeholder="e.g. Summer campaign 2026"></label><label>Client / organization<input name="client" maxlength="100" value="${escapeHtml(project?.client ?? '')}" placeholder="Client or team name"></label><label>Short description<textarea name="description" rows="3" maxlength="500" placeholder="What is this project for?">${escapeHtml(project?.description ?? '')}</textarea></label><div class="form-error" id="formError" role="alert"></div><div class="modal-actions"><button type="button" class="button button-quiet" data-action="close-dialog">Cancel</button><button type="submit" class="button button-primary">${editing ? 'Save changes' : 'Create project'}</button></div></form>`);
}

function permissionSelect(name, label, value) {
  const selected = value === true ? 'true' : value === false ? 'false' : 'unknown';
  return `<label>${label}<select name="${name}"><option value="unknown" ${selected === 'unknown' ? 'selected' : ''}>Not recorded</option><option value="true" ${selected === 'true' ? 'selected' : ''}>Allowed</option><option value="false" ${selected === 'false' ? 'selected' : ''}>Not allowed</option></select></label>`;
}
function openAssetDialog(asset) {
  const stateInfo = readiness(asset);
  const reasons = stateInfo.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('');
  openDialog(`<div class="modal-head"><div><div class="eyebrow">ASSET PROVENANCE RECORD</div><h2>Edit asset details</h2><p>Record what you know. OriginKit will flag what is missing.</p></div><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">×</button></div>
    <div class="record-status ${stateInfo.status}"><div>${statusBadge(asset)}<span>${escapeHtml(stateInfo.reasons[0])}</span></div><details><summary>Why this status?</summary><ul>${reasons}</ul></details></div>
    <form data-form="asset" data-id="${escapeHtml(asset.id)}" class="modal-form record-form">
      <div class="form-section-title">01 / FILE & PROJECT</div><div class="form-grid"><label class="span-two">Asset name <span>*</span><input name="name" required maxlength="180" value="${escapeHtml(asset.name)}"></label><label>Project<select name="projectId">${projectOptions(asset.projectId)}</select></label><label>Asset type<input value="${escapeHtml(asset.kind)}" disabled></label><label>File size<input value="${formatBytes(asset.size)}" disabled></label><label>SHA-256 fingerprint<input value="${escapeHtml(asset.sha256 || 'Unavailable')}" disabled></label></div>
      <div class="form-section-title">02 / ORIGIN & LICENSE</div><div class="form-grid"><label>Creator / rights holder<input name="creator" maxlength="160" value="${escapeHtml(asset.creator ?? '')}" placeholder="Person or organization"></label><label>Provider / source platform<input name="provider" maxlength="120" value="${escapeHtml(asset.provider ?? '')}" placeholder="e.g. Adobe Stock, client"></label><label class="span-two">Original source URL<input name="sourceUrl" type="url" value="${escapeHtml(asset.sourceUrl ?? '')}" placeholder="https://…"></label><label>License / permission basis<input name="licenseName" maxlength="160" value="${escapeHtml(asset.licenseName ?? '')}" placeholder="e.g. CC BY 4.0, client-owned"></label><label>License evidence URL<input name="evidenceUrl" type="url" value="${escapeHtml(asset.evidenceUrl ?? '')}" placeholder="https://…"></label><label class="span-two">Evidence note<textarea name="evidenceNote" rows="2" maxlength="500" placeholder="Where is the agreement, receipt or permission stored?">${escapeHtml(asset.evidenceNote ?? '')}</textarea></label></div>
      <div class="form-section-title">03 / USAGE PERMISSIONS</div><p class="form-hint">Choose “Not recorded” until you have checked the applicable license or permission.</p><div class="form-grid three-col">${permissionSelect('commercialUse', 'Commercial use', asset.permissions?.commercialUse)}${permissionSelect('modification', 'Modification', asset.permissions?.modification)}${permissionSelect('redistribution', 'Redistribution', asset.permissions?.redistribution)}</div>
      <div class="form-section-title">04 / ATTRIBUTION & AI ORIGIN</div><div class="form-grid"><label>AI origin<select name="aiOrigin"><option value="unknown" ${!asset.aiOrigin || asset.aiOrigin === 'unknown' ? 'selected' : ''}>Not recorded</option><option value="not-ai" ${asset.aiOrigin === 'not-ai' ? 'selected' : ''}>Not AI-generated</option><option value="ai-generated" ${asset.aiOrigin === 'ai-generated' ? 'selected' : ''}>AI-generated</option><option value="ai-assisted" ${asset.aiOrigin === 'ai-assisted' ? 'selected' : ''}>AI-assisted</option></select></label><label>License expiry date<input name="expiresAt" type="date" value="${escapeHtml(asset.expiresAt ?? '')}"></label><label class="check-field"><input type="checkbox" name="attributionRequired" ${asset.attributionRequired ? 'checked' : ''}><span>Attribution is required</span></label><label class="span-two">Required attribution text<textarea name="attribution" rows="2" maxlength="1000" placeholder="Exact attribution wording…">${escapeHtml(asset.attribution ?? '')}</textarea></label><label class="span-two">Internal notes<textarea name="notes" rows="2" maxlength="1000" placeholder="Restrictions, approvals, contact or context…">${escapeHtml(asset.notes ?? '')}</textarea></label></div>
      <div class="form-error" id="formError" role="alert"></div><div class="modal-actions modal-actions-between"><button type="button" class="button button-danger-quiet" data-action="delete-asset" data-id="${escapeHtml(asset.id)}">Delete asset</button><div><button type="button" class="button button-quiet" data-action="close-dialog">Cancel</button><button type="submit" class="button button-primary">Save record</button></div></div>
    </form>`);
}

async function addFiles(files) {
  const list = [...files];
  if (!list.length) return;
  if (list.length > 100) { toast('Choose up to 100 files per import.', 'error'); return; }
  const maxBytes = 100 * 1024 * 1024;
  let added = 0;
  let firstAddedId = null;
  try {
    await openDatabase();
    for (let index = 0; index < list.length; index += 1) {
      const file = list[index];
      showProgress(`Adding ${index + 1} of ${list.length}`, file.name);
      if (file.size > maxBytes) { toast(`${file.name} was skipped: the per-file limit is 100 MB.`, 'error'); continue; }
      const bytes = await file.arrayBuffer();
      let sha256 = '';
      try { sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
      catch { toast(`Fingerprint unavailable for ${file.name}; the file was still added.`, 'error'); }
      let dimensions = null;
      if (file.type.startsWith('image/') && 'createImageBitmap' in window) {
        try { const bitmap = await createImageBitmap(file); dimensions = { width: bitmap.width, height: bitmap.height }; bitmap.close(); } catch { /* unsupported image decoder */ }
      }
      const duplicate = sha256 ? state.assets.find((asset) => asset.sha256 === sha256) : null;
      const asset = {
        id: id(), projectId: state.projectFilter === 'all' ? null : state.projectFilter,
        name: file.name, kind: classifyFile(file), mimeType: file.type || 'application/octet-stream',
        size: file.size, lastModified: file.lastModified || null, sha256, dimensions,
        file, creator: '', provider: '', sourceUrl: '', licenseName: '', evidenceUrl: '', evidenceNote: '',
        permissions: { commercialUse: null, modification: null, redistribution: null },
        attributionRequired: false, attribution: '', aiOrigin: 'unknown', expiresAt: '', notes: '',
        duplicateOf: duplicate?.id ?? null, addedAt: now(), updatedAt: now(),
      };
      await saveAsset(asset);
      state.assets.push(asset);
      firstAddedId ??= asset.id;
      added += 1;
    }
    await refresh();
    if (added) {
      toast(`${added} asset${added === 1 ? '' : 's'} added to your local library.`);
      const first = state.assets.find((asset) => asset.id === firstAddedId);
      if (first) openAssetDialog(first);
    }
  } catch (error) {
    toast(error.message || 'Could not save these files in browser storage.', 'error');
  } finally { hideProgress(); filePicker.value = ''; }
}

function selectedPermission(value) {
  return value === 'true' ? true : value === 'false' ? false : null;
}

async function handleSubmit(event) {
  const form = event.target.closest('form[data-form]');
  if (!form) return;
  event.preventDefault();
  const data = new FormData(form);
  const errorNode = $('#formError', form);
  if (form.dataset.form === 'project') {
    const name = String(data.get('name') ?? '').trim();
    const error = validateProjectName(name);
    if (error) { errorNode.textContent = error; return; }
    const existingId = form.dataset.id;
    const existing = state.projects.find((project) => project.id === existingId);
    const project = { id: existingId || id(), name, client: String(data.get('client') ?? '').trim(), description: String(data.get('description') ?? '').trim(), archived: existing?.archived ?? false, createdAt: existing?.createdAt ?? now(), updatedAt: now() };
    await saveProject(project);
    closeDialog(); await refresh(); toast(existing ? 'Project details saved.' : 'Project created.');
    return;
  }
  if (form.dataset.form === 'asset') {
    const asset = state.assets.find((item) => item.id === form.dataset.id);
    if (!asset) { errorNode.textContent = 'This asset is no longer in the workspace. Reload and try again.'; return; }
    const updated = {
      ...asset, name: String(data.get('name') ?? '').trim(), projectId: String(data.get('projectId') ?? '') || null,
      creator: String(data.get('creator') ?? '').trim(), provider: String(data.get('provider') ?? '').trim(),
      sourceUrl: String(data.get('sourceUrl') ?? '').trim(), licenseName: String(data.get('licenseName') ?? '').trim(),
      evidenceUrl: String(data.get('evidenceUrl') ?? '').trim(), evidenceNote: String(data.get('evidenceNote') ?? '').trim(),
      permissions: { commercialUse: selectedPermission(data.get('commercialUse')), modification: selectedPermission(data.get('modification')), redistribution: selectedPermission(data.get('redistribution')) },
      attributionRequired: data.get('attributionRequired') === 'on', attribution: String(data.get('attribution') ?? '').trim(),
      aiOrigin: String(data.get('aiOrigin') ?? 'unknown'), expiresAt: String(data.get('expiresAt') ?? ''), notes: String(data.get('notes') ?? '').trim(), updatedAt: now(),
    };
    const errors = validateAssetRecord(updated);
    if (errors.length) { errorNode.textContent = errors.join(' '); return; }
    await saveAsset(updated);
    closeDialog(); await refresh(); toast('Asset provenance record saved.');
  }
}

function makeReportHtml(projects, assets) {
  const manifest = buildManifest(projects, assets);
  const rows = manifest.assets.map((asset) => `<tr><td>${escapeHtml(asset.name)}</td><td>${escapeHtml(asset.projectName)}</td><td>${escapeHtml(asset.creator || '—')}</td><td>${escapeHtml(asset.licenseName || 'Not recorded')}</td><td><span class="status ${asset.rightsStatus}">${escapeHtml(asset.rightsStatus)}</span></td><td>${escapeHtml(asset.sourceUrl || '—')}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>OriginKit asset report</title><style>body{font:15px/1.55 system-ui,sans-serif;color:#202720;margin:40px auto;max-width:1100px;padding:0 24px}h1{font-size:32px;letter-spacing:-1px}p{color:#59645b}table{border-collapse:collapse;width:100%;margin-top:28px}th,td{text-align:left;padding:12px;border-bottom:1px solid #dce2da;vertical-align:top}th{font-size:11px;text-transform:uppercase;color:#647065}.status{font-size:11px;text-transform:uppercase;font-weight:700}.cleared{color:#28724a}.review{color:#986b16}.blocked{color:#a43e36}.notice{padding:14px;background:#f2f5ef;border-radius:10px;margin-top:24px}@media print{body{margin:0;max-width:none}button{display:none}}</style><body><p>ORIGINKIT / CREATIVE RIGHTS DESK</p><h1>Asset provenance report</h1><p>Generated ${new Date().toLocaleString()} · ${assets.length} assets · ${projects.length} projects</p><div class="notice">This report reflects user-entered records. It does not verify external licenses or provide legal advice.</div><table><thead><tr><th>Asset</th><th>Project</th><th>Creator</th><th>License</th><th>Status</th><th>Source</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No assets recorded.</td></tr>'}</tbody></table></body></html>`;
}

async function exportBackup() {
  showProgress('Preparing workspace backup', 'Collecting records and original files locally…');
  try {
    const projects = state.projects;
    const assets = state.assets;
    const backupAssets = [];
    const entries = [];
    let totalBackupBytes = 0;
    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index];
      showProgress(`Preparing file ${index + 1} of ${assets.length}`, asset.name);
      const filePath = asset.file ? `files/${asset.id}/${safeFilename(asset.name, 'asset')}` : null;
      const { file, ...record } = asset;
      backupAssets.push({ ...record, filePath });
      if (file) {
        totalBackupBytes += file.size;
        if (totalBackupBytes > 500 * 1024 * 1024) throw new Error('The full backup exceeds the 500 MB export limit. Export a smaller set of assets or use CSV/manifest exports.');
        entries.push({ name: filePath, bytes: new Uint8Array(await file.arrayBuffer()) });
      }
    }
    const metadata = { format: 'originkit-backup', schemaVersion: 1, createdAt: now(), projects, assets: backupAssets };
    entries.unshift({ name: 'origin-kit-backup.json', bytes: new TextEncoder().encode(JSON.stringify(metadata, null, 2)) });
    const blob = createStoredZip(entries);
    downloadBlob(blob, `originkit-backup-${new Date().toISOString().slice(0, 10)}.originzip`);
    toast('Workspace backup created. Keep it somewhere secure.');
  } catch (error) { toast(error.message || 'Could not create backup.', 'error'); }
  finally { hideProgress(); }
}

async function restoreBackup(file) {
  if (!file) return;
  showProgress('Checking backup', file.name);
  try {
    if (file.size > 500 * 1024 * 1024) throw new Error('Backup files must be 500 MB or smaller.');
    const files = readStoredZip(await file.arrayBuffer());
    const metadataBytes = files.get('origin-kit-backup.json');
    if (!metadataBytes) throw new Error('This ZIP does not contain an OriginKit backup manifest.');
    const metadata = JSON.parse(new TextDecoder().decode(metadataBytes));
    if (metadata.format !== 'originkit-backup' || metadata.schemaVersion !== 1 || !Array.isArray(metadata.projects) || !Array.isArray(metadata.assets)) throw new Error('Unsupported or invalid OriginKit backup format.');
    if (metadata.projects.length > 1000 || metadata.assets.length > 10000) throw new Error('This backup contains too many records to restore safely.');
    const projectIds = new Map(metadata.projects.map((project) => [project.id, id()]));
    const restoredProjects = metadata.projects.map((project) => ({ ...project, id: projectIds.get(project.id), name: `${project.name} (restored)` , createdAt: now(), updatedAt: now() }));
    const restoredAssets = [];
    for (let index = 0; index < metadata.assets.length; index += 1) {
      const asset = metadata.assets[index];
      showProgress(`Restoring ${index + 1} of ${metadata.assets.length}`, asset.name);
      let fileBlob = null;
      if (asset.filePath) {
        if (!String(asset.filePath).startsWith('files/')) throw new Error(`Unsafe file path in backup for ${asset.name}.`);
        const bytes = files.get(asset.filePath);
        if (!bytes) throw new Error(`The backup is missing the original file for ${asset.name}.`);
        fileBlob = new Blob([bytes], { type: asset.mimeType || 'application/octet-stream' });
      }
      const { filePath, ...record } = asset;
      restoredAssets.push({ ...record, id: id(), projectId: projectIds.get(asset.projectId) ?? null, file: fileBlob, addedAt: now(), updatedAt: now(), duplicateOf: null });
    }
    for (const project of restoredProjects) await saveProject(project);
    for (const asset of restoredAssets) await saveAsset(asset);
    await refresh();
    toast(`Restored ${restoredProjects.length} projects and ${restoredAssets.length} assets. Existing records were kept.`);
  } catch (error) { toast(error.message || 'Could not restore this backup.', 'error'); }
  finally { hideProgress(); backupPicker.value = ''; }
}

async function handleAction(action, button) {
  const assetId = button.dataset.id;
  const projectId = button.dataset.id;
  switch (action) {
    case 'add-assets': filePicker.click(); break;
    case 'new-project': openProjectDialog(); break;
    case 'close-dialog': closeDialog(); break;
    case 'edit-asset': { const asset = state.assets.find((item) => item.id === assetId); if (asset) openAssetDialog(asset); break; }
    case 'edit-project': { const project = state.projects.find((item) => item.id === projectId); if (project) { openProjectDialog(project); $('form[data-form="project"]').dataset.id = project.id; } break; }
    case 'open-project': state.projectFilter = projectId; state.view = 'assets'; location.hash = 'assets'; await render(); break;
    case 'delete-asset': {
      if (!window.confirm('Delete this asset and its locally stored original file? This cannot be undone.')) break;
      await removeAsset(assetId); closeDialog(); await refresh(); toast('Asset deleted.'); break;
    }
    case 'toggle-select': {
      if (state.selected.has(assetId)) state.selected.delete(assetId); else state.selected.add(assetId);
      await render(); break;
    }
    case 'clear-selection': state.selected.clear(); await render(); break;
    case 'export-selected': {
      const selected = state.assets.filter((asset) => state.selected.has(asset.id));
      downloadText(toCsv(selected, state.projects), 'originkit-selected-assets.csv', 'text/csv;charset=utf-8');
      toast(`${selected.length} selected records exported.`); break;
    }
    case 'export-manifest': downloadText(JSON.stringify(buildManifest(state.projects, state.assets), null, 2), 'origin-manifest.json', 'application/json'); toast('Rights manifest downloaded.'); break;
    case 'export-attributions': downloadText(buildAttributions(state.assets, state.projects), 'ATTRIBUTIONS.md', 'text/markdown;charset=utf-8'); toast('Attribution sheet downloaded.'); break;
    case 'export-csv': downloadText(toCsv(state.assets, state.projects), 'originkit-asset-register.csv', 'text/csv;charset=utf-8'); toast('Asset register downloaded.'); break;
    case 'export-report': downloadText(makeReportHtml(state.projects, state.assets), 'originkit-provenance-report.html', 'text/html;charset=utf-8'); toast('Printable report downloaded.'); break;
    case 'backup': await exportBackup(); break;
    case 'restore': backupPicker.click(); break;
    case 'clear-workspace': {
      if (!window.confirm('Permanently delete all OriginKit projects, records and original files from this browser? Download a backup first if you may need them.')) break;
      await clearWorkspace(); state.selected.clear(); state.projectFilter = 'all';
      for (const url of state.previews.values()) URL.revokeObjectURL(url);
      state.previews.clear(); await refresh(); toast('Local workspace cleared.'); break;
    }
    case 'archive-project': {
      const project = state.projects.find((item) => item.id === projectId);
      if (!project) break;
      await saveProject({ ...project, archived: !project.archived, updatedAt: now() });
      closeDialog(); await refresh(); toast(project.archived ? 'Project restored.' : 'Project archived.'); break;
    }
    case 'delete-project': {
      const related = state.assets.filter((asset) => asset.projectId === projectId);
      if (!window.confirm(`Delete this project? ${related.length} asset record(s) will become unassigned; original files will be kept.`)) break;
      for (const asset of related) await saveAsset({ ...asset, projectId: null, updatedAt: now() });
      if (state.projectFilter === projectId) state.projectFilter = 'all';
      await removeProject(projectId); closeDialog(); await refresh(); toast('Project deleted; its assets were kept.'); break;
    }
  }
}

function openProjectEditDialog(project) {
  openProjectDialog(project);
  $('form[data-form="project"]').dataset.id = project.id;
  const actions = $('.modal-actions', dialogContent);
  actions.insertAdjacentHTML('afterbegin', `<button type="button" class="button button-quiet" data-action="archive-project" data-id="${escapeHtml(project.id)}">${project.archived ? 'Restore project' : 'Archive project'}</button><button type="button" class="button button-danger-quiet" data-action="delete-project" data-id="${escapeHtml(project.id)}">Delete</button>`);
}

for (const navigation of [$('.sidebar'), $('.mobile-nav')]) {
  navigation.addEventListener('click', async (event) => {
    const link = event.target.closest('[data-view]');
    if (!link) return;
    event.preventDefault();
    state.view = link.dataset.view;
    if (location.hash !== `#${state.view}`) location.hash = state.view;
    await render();
  });
}

root.addEventListener('click', async (event) => {
  const viewLink = event.target.closest('[data-view]');
  if (viewLink) {
    const view = viewLink.dataset.view;
    if (view) { state.view = view; if (location.hash !== `#${view}`) location.hash = view; await render(); return; }
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (button.dataset.action === 'edit-project') {
    const project = state.projects.find((item) => item.id === button.dataset.id);
    if (project) openProjectEditDialog(project);
    return;
  }
  await handleAction(button.dataset.action, button);
});

dialogContent.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action]');
  if (button) await handleAction(button.dataset.action, button);
});
dialogContent.addEventListener('submit', handleSubmit);
root.addEventListener('change', async (event) => {
  const target = event.target;
  if (target.id === 'projectFilter') state.projectFilter = target.value;
  if (target.id === 'statusFilter') state.statusFilter = target.value;
  if (target.id === 'typeFilter') state.typeFilter = target.value;
  if (target.id === 'projectFilter' || target.id === 'statusFilter' || target.id === 'typeFilter') await render();
});
root.addEventListener('input', (event) => {
  if (event.target.id === 'assetSearch') {
    state.search = event.target.value;
    const cursor = event.target.selectionStart;
    render().then(() => { const input = $('#assetSearch'); if (input) { input.focus(); input.setSelectionRange(cursor, cursor); } });
  }
});
$('#globalSearch').addEventListener('input', (event) => {
  state.search = event.target.value;
  if (state.view !== 'assets') { state.view = 'assets'; location.hash = 'assets'; }
  render();
});
filePicker.addEventListener('change', (event) => addFiles(event.target.files));
backupPicker.addEventListener('change', (event) => restoreBackup(event.target.files?.[0]));
window.addEventListener('hashchange', () => { state.view = location.hash.slice(1) || 'overview'; render(); });
dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDialog(); });
dialog.addEventListener('cancel', () => { dialogContent.replaceChildren(); });

root.addEventListener('dragover', (event) => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); root.classList.add('is-dragging'); } });
root.addEventListener('dragleave', (event) => { if (!root.contains(event.relatedTarget)) root.classList.remove('is-dragging'); });
root.addEventListener('drop', (event) => { if (event.dataTransfer?.files?.length) { event.preventDefault(); root.classList.remove('is-dragging'); addFiles(event.dataTransfer.files); } });

async function start() {
  try {
    await openDatabase();
    await refresh();
  } catch (error) {
    root.innerHTML = `<div class="fatal-state"><span>!</span><h1>Local storage is unavailable</h1><p>${escapeHtml(error.message)}</p><p>Try a current browser in a normal (non-private) window, then reload OriginKit.</p></div>`;
  }
}

start();
