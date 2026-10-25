import { MODULE_ID, L } from "./config.mjs";
import { handle, request } from "./socket.mjs";

/*
 * Pictures go into the module's persistent storage folder, which survives module updates. Players can't upload
 * files by default, so theirs are shrunk in the browser and handed to the active GM, whose client uploads them.
 */

/** A picture sent through the GM is shrunk until its data URL is shorter than this, to stay within socket limits. */
const RELAY_LIMIT = 900000;

/** Longest side, in pixels, tried in turn when shrinking a picture for the GM. */
const RELAY_SIZES = [1600, 1280, 1024, 800, 640];

/** Folders already known to exist on the server. */
const folders = new Set();

export function registerUploads() {
  handle("upload", async ({ name, data }, user) => {
    if ( (typeof data !== "string") || !data.startsWith("data:image/") ) throw new Error("Not a picture.");
    if ( data.length > (RELAY_LIMIT * 1.5) ) throw new Error("That picture is too large.");
    const blob = await (await fetch(data)).blob();
    const file = new File([blob], String(name || "picture.webp"), { type: blob.type });
    return { path: await uploadFile(file, `notes/${user.id}`) };
  });
}

/** Can the current user put files on the server themselves? */
export function canUpload() {
  return game.user.can("FILES_UPLOAD");
}

/** Can the current user browse the server's files to pick an existing picture? */
export function canBrowse() {
  return game.user.can("FILES_BROWSE");
}

/**
 * Upload a picture and return its path.
 * @param {File} file
 * @param {string} folder   A folder inside the module's storage, such as "maps" or "notes".
 */
export async function uploadImage(file, folder) {
  if ( !file?.type?.startsWith("image/") ) throw new Error(game.i18n.localize(`${L}.Errors.NotImage`));
  if ( canUpload() ) return uploadFile(file, folder);
  const data = await shrink(file);
  const name = `${file.name.replace(/\.[^.]+$/, "")}.webp`;
  const { path } = await request("upload", { name, data });
  return path;
}

async function uploadFile(file, folder) {
  const FilePicker = foundry.applications.apps.FilePicker.implementation;
  await ensureFolder(`modules/${MODULE_ID}/storage/${folder}`);
  const named = new File([file], uniqueName(file.name), { type: file.type });
  const response = await FilePicker.uploadPersistent(MODULE_ID, folder, named, {}, { notify: false });
  if ( !response?.path ) throw new Error(game.i18n.localize(`${L}.Errors.UploadFailed`));
  return response.path;
}

/** Create each missing folder along a path. */
async function ensureFolder(path) {
  const FilePicker = foundry.applications.apps.FilePicker.implementation;
  const parts = path.split("/");
  for ( let i = 1; i <= parts.length; i++ ) {
    const target = parts.slice(0, i).join("/");
    if ( (i < 3) || folders.has(target) ) continue; // "modules" and the module's own folder always exist
    try {
      await FilePicker.browse("data", target);
    } catch {
      await FilePicker.createDirectory("data", target).catch(() => {});
    }
    folders.add(target);
  }
}

/** A short random prefix keeps two uploads of "map.png" from overwriting each other. */
function uniqueName(name) {
  const clean = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "picture";
  return `${foundry.utils.randomID(6)}-${clean}`;
}

/** Redraw a picture as WebP, smaller each try, until it fits in one socket message. */
async function shrink(file) {
  const bitmap = await createImageBitmap(file);
  try {
    for ( const size of RELAY_SIZES ) {
      const scale = Math.min(1, size / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      for ( const quality of [0.85, 0.7] ) {
        const data = canvas.toDataURL("image/webp", quality);
        if ( data.length <= RELAY_LIMIT ) return data;
      }
    }
  } finally {
    bitmap.close();
  }
  throw new Error(game.i18n.localize(`${L}.Errors.TooLarge`));
}

/** Read a text, Markdown or HTML file into HTML for a note. */
export async function readTextFile(file) {
  const text = await file.text();
  if ( /\.html?$/i.test(file.name) || (file.type === "text/html") ) return foundry.utils.cleanHTML(text);
  const escape = foundry.utils.escapeHTML;
  return text.split(/\r?\n\s*\r?\n/).map(p => p.trim()).filter(Boolean)
    .map(p => `<p>${escape(p).replace(/\r?\n/g, "<br>")}</p>`).join("");
}
