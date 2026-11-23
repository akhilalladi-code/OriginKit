const DB_NAME = 'originkit-local-workspace';
const DB_VERSION = 1;
let databasePromise;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Browser storage request failed.'));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Browser storage transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Browser storage transaction was cancelled.'));
  });
}

export function openDatabase() {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('This browser does not support IndexedDB. Use a current version of Chrome, Edge, Firefox or Safari.'));
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('assets')) {
          const assets = db.createObjectStore('assets', { keyPath: 'id' });
          assets.createIndex('projectId', 'projectId', { unique: false });
          assets.createIndex('sha256', 'sha256', { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); databasePromise = undefined; };
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error('Could not open browser storage.'));
      request.onblocked = () => reject(new Error('Another OriginKit tab is blocking a storage upgrade. Close other OriginKit tabs and reload.'));
    });
  }
  return databasePromise;
}

async function readAll(storeName) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readonly');
  const done = transactionDone(tx);
  const values = await requestResult(tx.objectStore(storeName).getAll());
  await done;
  return values;
}

async function write(storeName, method, value) {
  const db = await openDatabase();
  const tx = db.transaction(storeName, 'readwrite');
  const done = transactionDone(tx);
  tx.objectStore(storeName)[method](value);
  await done;
}

export const getProjects = () => readAll('projects');
export const getAssets = () => readAll('assets');
export const saveProject = (project) => write('projects', 'put', project);
export const saveAsset = (asset) => write('assets', 'put', asset);
export const removeProject = (id) => write('projects', 'delete', id);
export const removeAsset = (id) => write('assets', 'delete', id);

export async function replaceWorkspace(projects, assets) {
  const db = await openDatabase();
  const tx = db.transaction(['projects', 'assets'], 'readwrite');
  const done = transactionDone(tx);
  const projectStore = tx.objectStore('projects');
  const assetStore = tx.objectStore('assets');
  projectStore.clear();
  assetStore.clear();
  for (const project of projects) projectStore.put(project);
  for (const asset of assets) assetStore.put(asset);
  await done;
}

export async function estimateStorage() {
  if (!navigator.storage?.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}

export async function clearWorkspace() {
  await replaceWorkspace([], []);
}
