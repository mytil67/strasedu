/* ==========================================================================
   StrasEdu — application d'administration
   --------------------------------------------------------------------------
   Fenêtre unique permettant au service informatique de composer le catalogue
   sans éditer de JSON :

     • ajouter, modifier, supprimer un outil ;
     • lui affecter une icône parmi celles de StrasEdu ;
     • créer et paramétrer les catégories (icône, couleur, description) ;
     • définir le logo officiel de l'établissement ;
     • publier le catalogue sur le partage réseau, version incrémentée.

   La validation est celle de l'application (lib/catalog.js) : ce que
   l'administration accepte, les postes l'acceptent.
   ========================================================================== */

"use strict";

const { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, shell } = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  normalizeCatalog,
  asText,
  safeLogo,
  safeImage,
  MAX_LOGO_CHARS,
  MAX_IMAGE_CHARS,
  MAX_CATALOG_BYTES,
  MAX_PUBLISH_BYTES,
  WARN_CATALOG_BYTES
} = require("../lib/catalog");

const APP_NAME = "StrasEdu Administration";
const PROJECT_DIR = path.resolve(__dirname, "..");

/**
 * Hauteur de réduction d'un visuel, selon l'usage. Les bornes évitent qu'un
 * appelant fasse produire une image minuscule (illisible dans l'application)
 * ou énorme (refusée par le plafond du catalogue, après un long encodage).
 */
const IMAGE_HEIGHT_MIN = 200;
const IMAGE_HEIGHT_MAX = 360;
const IMAGE_HEIGHT_DEFAULT = 320;

/**
 * Ressource livrée à côté de l'archive applicative. La couche native de
 * Windows attend un vrai chemin de fichier, pas une entrée d'asar.
 */
function assetPath(...parts) {
  const packaged = path.join(process.resourcesPath || "", ...parts);
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.join(PROJECT_DIR, ...parts);
}

/** Catalogue livré avec l'outil : le point de départ de l'administrateur. */
function bundledCatalog() {
  return assetPath("apps.json");
}

/**
 * Copie de travail, dans le profil de l'utilisateur. L'application installée
 * ne peut pas écrire dans sa propre archive : on travaille donc sur une copie,
 * créée au premier lancement à partir du catalogue livré.
 */
function workingCatalogPath() {
  return path.join(app.getPath("userData"), "apps.json");
}

function ensureWorkingCatalog() {
  const target = workingCatalogPath();
  if (fs.existsSync(target)) return target;

  const source = bundledCatalog();
  if (!fs.existsSync(source)) return null;

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    return target;
  } catch {
    return null;
  }
}

let mainWindow = null;

/* ─── Préférences de l'outil (dernier fichier, partage) ──────────────────── */

function prefsFile() {
  return path.join(app.getPath("userData"), "admin-prefs.json");
}

/**
 * Valeurs imposées par l'environnement. Elles permettent de lancer l'outil
 * directement sur un catalogue et un partage donnés — déploiement automatisé
 * ou auto-vérification — sans passer par les boîtes de dialogue.
 */
function environmentOverrides() {
  const forced = {};
  if (process.env.STRASEDU_ADMIN_CATALOG) forced.lastFilePath = process.env.STRASEDU_ADMIN_CATALOG;
  if (process.env.STRASEDU_ADMIN_SHARE) forced.sharePath = process.env.STRASEDU_ADMIN_SHARE;
  return forced;
}

function readPrefs() {
  let stored = {};
  try {
    let raw = fs.readFileSync(prefsFile(), "utf-8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    stored = JSON.parse(raw);
  } catch {
    stored = {};
  }
  return Object.assign({}, stored, environmentOverrides());
}

function writePrefs(patch) {
  const next = Object.assign(readPrefs(), patch || {});
  try {
    fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
    fs.writeFileSync(prefsFile(), JSON.stringify(next, null, 2), "utf-8");
  } catch {
    /* les préférences de l'outil ne doivent jamais bloquer */
  }
  return next;
}

/* ─── Lecture et écriture du catalogue ───────────────────────────────────── */

function readCatalogFile(filePath) {
  let raw = fs.readFileSync(filePath, "utf-8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw);
}

/** Écriture atomique : un poste qui lit ne voit jamais un fichier tronqué. */
function writeCatalogFile(filePath, catalog) {
  const text = JSON.stringify(catalog, null, 2) + os.EOL;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = filePath + ".tmp";
  fs.writeFileSync(temp, text, "utf-8");
  fs.renameSync(temp, filePath);
  return filePath;
}

/**
 * Poids du catalogue tel qu'il sera écrit — même mise en forme que
 * writeCatalogFile, pour que la mesure corresponde au fichier publié.
 */
function catalogBytes(catalog) {
  try {
    return Buffer.byteLength(JSON.stringify(catalog, null, 2) + os.EOL, "utf-8");
  } catch {
    return 0;
  }
}

/** Message commun aux deux seuils : il nomme la limite et la conséquence. */
function tooHeavyMessage(bytes) {
  return (
    "Le catalogue pèse " + Math.round(bytes / 1024) + " Ko ; au-delà de " +
    Math.round(MAX_CATALOG_BYTES / 1024) +
    " Ko les postes le refusent en entier. Allégez les visuels (Onglet Outils et Département)."
  );
}

/* ─── Validation avant enregistrement ou publication ─────────────────────── */

/**
 * Reprend exactement les règles de l'application, et nomme les outils fautifs
 * plutôt que de se contenter d'un compteur.
 */
function validateCatalog(catalog) {
  const problems = [];
  const warnings = [];
  const badIds = [];

  if (!catalog || typeof catalog !== "object") {
    return { ok: false, problems: ["Catalogue illisible."], badIds, warnings };
  }

  const version = asText(catalog.version, 32);
  if (!version) {
    problems.push("La version est vide : sans elle, aucun poste ne se mettra à jour.");
  }

  const declared = Array.isArray(catalog.categories) ? catalog.categories : [];
  if (!declared.length) warnings.push("Aucune catégorie déclarée : tous les outils iront dans « Autres ».");

  const meta = catalog.categoryMeta && typeof catalog.categoryMeta === "object" ? catalog.categoryMeta : {};
  for (const name of declared) {
    if (!meta[name]) warnings.push("Catégorie « " + name + " » sans icône ni description.");
  }
  for (const key of Object.keys(meta)) {
    if (declared.indexOf(key) < 0) warnings.push("Catégorie « " + key + " » paramétrée mais non déclarée.");
  }

  // Chaque outil est validé seul, avec les règles de l'application : s'il ne
  // survit pas à l'aller-retour, il serait écarté en silence sur les postes.
  const apps = Array.isArray(catalog.apps) ? catalog.apps : [];
  if (!apps.length) problems.push("Le catalogue ne contient aucun outil.");

  const seen = new Set();
  for (const entry of apps) {
    const label = asText(entry && entry.name, 60) || asText(entry && entry.id, 60) || "(sans nom)";
    const id = asText(entry && entry.id, 64);

    if (!id) {
      problems.push("« " + label + " » : identifiant manquant.");
      badIds.push(entry && entry.id);
      continue;
    }
    if (seen.has(id)) {
      problems.push("« " + label + " » : l'identifiant « " + id + " » est déjà utilisé.");
      badIds.push(id);
      continue;
    }
    seen.add(id);

    try {
      const single = normalizeCatalog({ version: "0", apps: [entry], categories: declared });
      if (!single.apps.length) {
        problems.push("« " + label + " » : adresse ou chemin refusé.");
        badIds.push(id);
      }
    } catch {
      problems.push("« " + label + " » : entrée invalide.");
      badIds.push(id);
    }
  }

  if (catalog.logo && !safeLogo(catalog.logo)) {
    problems.push(
      "Le logo dépasse " + Math.round(MAX_LOGO_CHARS / 1024) + " Ko ou n'est pas une image acceptée."
    );
  }

  // Poids du fichier : avertissement ici, refus à la publication. Un
  // enregistrement local reste possible — on ne perd pas le travail en cours.
  const bytes = catalogBytes(catalog);
  if (bytes > WARN_CATALOG_BYTES) warnings.push(tooHeavyMessage(bytes));

  return { ok: problems.length === 0, problems, badIds, warnings };
}

function bumpVersion(version) {
  const parts = String(version || "0.0.0").split(".");
  while (parts.length < 3) parts.push("0");
  parts[2] = String((parseInt(parts[2], 10) || 0) + 1);
  return parts.slice(0, 3).join(".");
}

/**
 * Encode une image en data URI sous le plafond du catalogue. Le PNG convient
 * aux captures d'écran (aplats, texte) ; une photographie, elle, le dépasse :
 * on retombe alors sur du JPEG à qualité décroissante, plutôt que de refuser
 * une image que l'administrateur a légitimement choisie.
 */
function encodeWithinBudget(image, maxChars) {
  const png = "data:image/png;base64," + image.toPNG().toString("base64");
  if (png.length <= maxChars) return png;

  for (const quality of [90, 80, 70, 60, 50]) {
    const jpeg = "data:image/jpeg;base64," + image.toJPEG(quality).toString("base64");
    if (jpeg.length <= maxChars) return jpeg;
  }
  return null;
}

/* ─── Fenêtre ────────────────────────────────────────────────────────────── */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1020,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#171a1c" : "#f3f6f5",
    autoHideMenuBar: true,
    icon: assetPath("icons-admin", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  return mainWindow;
}

/* ─── IPC ────────────────────────────────────────────────────────────────── */

function registerIpc() {
  ipcMain.handle("admin:state", () => {
    const prefs = readPrefs();

    // Fichier de travail : le dernier ouvert, sinon une copie du catalogue
    // livré, créée dans le profil pour être modifiable.
    let filePath = prefs.lastFilePath && fs.existsSync(prefs.lastFilePath)
      ? prefs.lastFilePath
      : null;
    if (!filePath) filePath = ensureWorkingCatalog();

    let catalog = null;
    let error = null;
    if (filePath) {
      try {
        catalog = readCatalogFile(filePath);
      } catch (err) {
        error = "Lecture impossible : " + err.message;
      }
    }

    return {
      catalog,
      filePath,
      sharePath: prefs.sharePath || "",
      defaultCatalog: bundledCatalog(),
      appVersion: app.getVersion(),
      dark: nativeTheme.shouldUseDarkColors,
      error
    };
  });

  ipcMain.handle("admin:open", async () => {
    const prefs = readPrefs();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Ouvrir un catalogue",
      defaultPath: prefs.lastFilePath || bundledCatalog(),
      filters: [{ name: "Catalogue", extensions: ["json"] }],
      properties: ["openFile"]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };

    const filePath = result.filePaths[0];
    try {
      const catalog = readCatalogFile(filePath);
      writePrefs({ lastFilePath: filePath });
      return { ok: true, catalog, filePath };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  /** Lit le catalogue actuellement publié sur le partage (pour le corriger). */
  ipcMain.handle("admin:load-share", () => {
    const prefs = readPrefs();
    const share = prefs.sharePath;
    if (!share) return { ok: false, error: "Aucun partage configuré." };
    const file = path.join(share, "apps.json");
    try {
      return { ok: true, catalog: readCatalogFile(file), filePath: file };
    } catch (error) {
      return { ok: false, error: "Lecture impossible : " + error.message };
    }
  });

  ipcMain.handle("admin:save", (_event, catalog, targetPath) => {
    const check = validateCatalog(catalog);
    if (!check.ok) {
      return { ok: false, problems: check.problems, badIds: check.badIds, warnings: check.warnings };
    }

    const filePath = targetPath || readPrefs().lastFilePath || ensureWorkingCatalog();
    if (!filePath) {
      return {
        ok: false,
        problems: ["Aucun catalogue de travail : utilisez « Enregistrer sous… »."],
        badIds: check.badIds,
        warnings: check.warnings
      };
    }
    try {
      writeCatalogFile(filePath, catalog);
      writePrefs({ lastFilePath: filePath });
      return { ok: true, filePath, warnings: check.warnings };
    } catch (error) {
      return {
        ok: false,
        problems: ["Écriture impossible : " + error.message],
        badIds: check.badIds,
        warnings: check.warnings
      };
    }
  });

  ipcMain.handle("admin:save-as", async (_event, catalog) => {
    const check = validateCatalog(catalog);
    if (!check.ok) {
      return { ok: false, problems: check.problems, badIds: check.badIds, warnings: check.warnings };
    }

    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Enregistrer le catalogue",
      defaultPath: readPrefs().lastFilePath || workingCatalogPath(),
      filters: [{ name: "Catalogue", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };

    try {
      writeCatalogFile(result.filePath, catalog);
      writePrefs({ lastFilePath: result.filePath });
      return { ok: true, filePath: result.filePath, warnings: check.warnings };
    } catch (error) {
      return { ok: false, problems: ["Écriture impossible : " + error.message], badIds: check.badIds, warnings: check.warnings };
    }
  });

  ipcMain.handle("admin:choose-share", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choisir le dossier de publication (partage réseau)",
      defaultPath: readPrefs().sharePath || undefined,
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    writePrefs({ sharePath: result.filePaths[0] });
    return { ok: true, sharePath: result.filePaths[0] };
  });

  /** Publie : validation, version incrémentée, écriture atomique sur le partage. */
  ipcMain.handle("admin:publish", (_event, catalog) => {
    const check = validateCatalog(catalog);
    if (!check.ok) {
      return { ok: false, problems: check.problems, badIds: check.badIds, warnings: check.warnings };
    }

    // Publier un catalogue trop lourd ne se verrait nulle part : les postes
    // l'écarteraient en silence et l'administrateur croirait avoir diffusé.
    const bytes = catalogBytes(catalog);
    if (bytes > MAX_PUBLISH_BYTES) {
      return {
        ok: false,
        problems: [tooHeavyMessage(bytes)],
        badIds: check.badIds,
        warnings: check.warnings
      };
    }

    const share = readPrefs().sharePath;
    if (!share) {
      return {
        ok: false,
        problems: ["Aucun partage réseau configuré."],
        badIds: check.badIds,
        warnings: check.warnings
      };
    }

    const target = path.join(share, "apps.json");
    const published = Object.assign({}, catalog, {
      version: bumpVersion(catalog.version),
      lastUpdated: new Date().toISOString().slice(0, 10)
    });

    try {
      writeCatalogFile(target, published);
    } catch (error) {
      return {
        ok: false,
        problems: ["Publication impossible : " + error.message],
        badIds: check.badIds,
        warnings: check.warnings
      };
    }

    return {
      ok: true,
      version: published.version,
      previousVersion: catalog.version,
      path: target,
      catalog: published,
      warnings: check.warnings
    };
  });

  /** Logo officiel : image choisie, réduite par la couche native, en data URI. */
  ipcMain.handle("admin:pick-logo", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choisir le logo de l'établissement",
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "ico"] }],
      properties: ["openFile"]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };

    const image = nativeImage.createFromPath(result.filePaths[0]);
    if (image.isEmpty()) return { ok: false, error: "Image illisible." };

    const size = image.getSize();
    // Réduction à 128 px de haut : suffisant pour la vignette de StrasEdu, et
    // le logo reste petit dans le catalogue publié.
    const resized = size.height > 128 ? image.resize({ height: 128, quality: "best" }) : image;
    const dataUri = resized.toDataURL();

    if (!safeLogo(dataUri)) {
      return { ok: false, error: "Image trop lourde une fois encodée." };
    }
    return { ok: true, logo: dataUri, source: result.filePaths[0] };
  });

  /**
   * Visuel d'outil ou d'information : même traitement que le logo, à une
   * hauteur choisie par l'appelant (320 px pour une vignette, 200 px pour un
   * bandeau) et sous le plafond des images d'outil.
   */
  ipcMain.handle("admin:pick-image", async (_event, options) => {
    const opts = options && typeof options === "object" ? options : {};
    const asked = Math.round(Number(opts.height));
    const height = Number.isFinite(asked)
      ? Math.max(IMAGE_HEIGHT_MIN, Math.min(IMAGE_HEIGHT_MAX, asked))
      : IMAGE_HEIGHT_DEFAULT;

    const result = await dialog.showOpenDialog(mainWindow, {
      title: asText(opts.title, 80) || "Choisir une image",
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
      properties: ["openFile"]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };

    const image = nativeImage.createFromPath(result.filePaths[0]);
    if (image.isEmpty()) return { ok: false, error: "Image illisible." };

    // Une image déjà plus petite que la cible n'est pas agrandie : cela
    // n'ajouterait que du poids au catalogue.
    const size = image.getSize();
    const resized = size.height > height ? image.resize({ height, quality: "best" }) : image;

    const dataUri = encodeWithinBudget(resized, MAX_IMAGE_CHARS);
    if (!dataUri || !safeImage(dataUri, MAX_IMAGE_CHARS)) {
      return { ok: false, error: "Image trop lourde une fois encodée." };
    }
    return { ok: true, image: dataUri, source: result.filePaths[0] };
  });

  ipcMain.handle("admin:reveal", (_event, filePath) => {
    if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
    return true;
  });

  ipcMain.handle("admin:validate", (_event, catalog) => validateCatalog(catalog));
}

/* ─── Cycle de vie ───────────────────────────────────────────────────────── */

app.setName(APP_NAME);

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
