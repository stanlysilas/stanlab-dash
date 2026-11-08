const DB_NAME = "stanlab-dash-preferences";
const STORE_NAME = "settings";
const WALLPAPER_KEY = "wallpaper";

export async function readWallpaper(): Promise<Blob | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(WALLPAPER_KEY);
    request.onsuccess = () =>
      resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () =>
      reject(request.error ?? new Error("Could not read the saved wallpaper."));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(
        transaction.error ?? new Error("Could not read the saved wallpaper."),
      );
    };
  });
}

export async function saveWallpaper(image: Blob | null): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    if (image) store.put(image, WALLPAPER_KEY);
    else store.delete(WALLPAPER_KEY);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(
        transaction.error ?? new Error("Could not save wallpaper settings."),
      );
    };
    transaction.onabort = () => {
      db.close();
      reject(
        transaction.error ?? new Error("Wallpaper settings were not saved."),
      );
    };
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Browser storage is unavailable."));
    request.onblocked = () =>
      reject(
        new Error(
          "Browser storage is busy. Close other Stanlab Dash tabs and try again.",
        ),
      );
  });
}
