/* ==========================================================================
   StrasEdu — processus principal Electron
   --------------------------------------------------------------------------
   Responsabilités :
     • charger, valider et mettre à jour le catalogue d'outils ;
     • conserver les préférences, les favoris et l'historique d'usage ;
     • créer la fenêtre Windows 11 (effet Mica, accent système) et la zone de
       notification ;
     • n'exposer au rendu qu'une surface IPC étroite et sans confiance.

   Principe de sécurité : le rendu n'envoie jamais d'URL ni de chemin à
   exécuter. Il envoie un identifiant d'outil, et le processus principal
   résout la cible depuis le catalogue qu'il a lui-même validé.
   ========================================================================== */

"use strict";

const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  session,
  shell,
  systemPreferences
} = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");
const http = require("http");

// La limite de taille du catalogue est partagée avec l'outil d'administration
// et le validateur : une seule valeur, sinon la publication laisse passer ce
// que les postes refusent.
const { MAX_CATALOG_BYTES } = require("./lib/catalog");

/* ─── Trace de démarrage ─────────────────────────────────────────────────── */
/*
   Écrite avant toute autre chose, donc disponible même si le profil
   utilisateur n'est pas encore accessible. C'est le seul moyen de savoir
   jusqu'où va un démarrage qui échoue sans rien afficher.

   Deux emplacements :
     • le dossier temporaire, toujours disponible ;
     • le dossier de l'exécutable — indispensable pour la version portable,
       dont le dossier temporaire d'extraction disparaît à la fermeture.
*/
const TRACE_NAME = "StrasEdu-demarrage.log";
const BOM = "\ufeff";

const TRACE_TARGETS = (function () {
  const list = [path.join(os.tmpdir(), TRACE_NAME)];
  const beside = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
  if (beside) list.push(path.join(beside, TRACE_NAME));
  return list;
})();

function trace(step) {
  const line = new Date().toISOString() + "  " + step + os.EOL;
  for (const target of TRACE_TARGETS) {
    try {
      // Le BOM permet à tous les éditeurs Windows de lire les accents.
      if (!fs.existsSync(target) || fs.statSync(target).size > 256 * 1024) {
        fs.writeFileSync(target, BOM, "utf-8");
      }
      fs.appendFileSync(target, line, "utf-8");
    } catch {
      /* emplacement non inscriptible : la trace ne doit jamais bloquer */
    }
  }
  try {
    process.stdout.write("[StrasEdu] " + step + os.EOL);
  } catch {
    /* pas de console : sans conséquence */
  }
}

trace(
  "── démarrage ── version=" + app.getVersion() +
  " portable=" + (process.env.PORTABLE_EXECUTABLE_DIR ? "oui" : "non") +
  " empaqueté=" + (app.isPackaged ? "oui" : "non")
);

/* ─── Constantes ─────────────────────────────────────────────────────────── */

const APP_ID = "fr.strasedu.app";
const APP_NAME = "StrasEdu";

const FETCH_TIMEOUT_MS = 12000;
const MAX_USAGE_ENTRIES = 200;
const DEFAULT_CHECK_INTERVAL_MIN = 30;

/* ─── Configuration externe ──────────────────────────────────────────────── */
/*
   Deux sources possibles pour l'URL du catalogue distant, et la variable
   d'environnement l'emporte : elle permet de reprendre l'adresse sur tout un
   parc par GPO, sans toucher au disque des postes. À défaut, le premier
   strasedu.config.json trouvé est lu — celui du dossier resources de
   l'installation, puis celui du dossier de l'application.
   Détail dans docs/DEPLOIEMENT.md.
*/
function readDeployConfig() {
  const candidates = [
    path.join(process.resourcesPath || "", "strasedu.config.json"),
    path.join(__dirname, "strasedu.config.json")
  ];
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) {
        let raw = fs.readFileSync(candidate, "utf-8");
        if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
        return JSON.parse(raw);
      }
    } catch (error) {
      log("Configuration illisible (" + candidate + ") : " + error.message);
    }
  }
  return {};
}

const DEPLOY = readDeployConfig();
const REMOTE_APPS_URL = process.env.STRASEDU_REMOTE_URL || DEPLOY.remoteAppsUrl || "";
const CHECK_INTERVAL_MS =
  (Number(DEPLOY.checkIntervalMinutes) || DEFAULT_CHECK_INTERVAL_MIN) * 60 * 1000;
const ALLOWED_LOCAL_ROOTS = Array.isArray(DEPLOY.allowedLocalRoots)
  ? DEPLOY.allowedLocalRoots.map((entry) => path.resolve(String(entry)).toLowerCase())
  : null;

trace("configuration lue — catalogue distant : " + (REMOTE_APPS_URL ? "configuré" : "absent"));

/* ─── Journal ────────────────────────────────────────────────────────────── */

let logFile = null;
let logBytes = 0;

function log(message) {
  const line = new Date().toISOString() + "  " + message;
  console.log("[StrasEdu] " + message);
  try {
    if (!logFile) {
      const dir = path.join(app.getPath("userData"), "logs");
      fs.mkdirSync(dir, { recursive: true });
      logFile = path.join(dir, "strasedu.log");
      logBytes = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
    }
    if (logBytes > 512 * 1024) {
      fs.renameSync(logFile, logFile + ".1");
      logBytes = 0;
    }
    fs.appendFileSync(logFile, line + os.EOL, "utf-8");
    logBytes += line.length + os.EOL.length;
  } catch {
    /* Le journal ne doit jamais interrompre l'application. */
  }
}

/* ─── Fichiers d'état ────────────────────────────────────────────────────── */

function userFile(name) {
  return path.join(app.getPath("userData"), name);
}

/**
 * Lit un fichier JSON en tolérant le BOM UTF-8.
 *
 * Indispensable : PowerShell (`Set-Content -Encoding UTF8`) et le Bloc-notes
 * écrivent un BOM en tête de fichier, et `JSON.parse` le refuse. Sans ce
 * nettoyage, un `strasedu.config.json` rédigé par le service informatique est
 * déclaré illisible et la configuration distante est silencieusement ignorée.
 */
function readJSON(filePath, fallback) {
  try {
    let raw = fs.readFileSync(filePath, "utf-8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Écriture atomique : un fichier temporaire puis un remplacement. */
function writeJSON(filePath, data) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temp = filePath + ".tmp";
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf-8");
    fs.renameSync(temp, filePath);
    return true;
  } catch (error) {
    log("Écriture impossible (" + filePath + ") : " + error.message);
    return false;
  }
}

/* ─── Validation du catalogue ────────────────────────────────────────────── */

// Règles partagées avec l'application d'administration : une seule
// implémentation, donc aucune dérive possible entre ce que l'administrateur
// publie et ce que les postes acceptent.
const { normalizeCatalog, safeExternalUrl } = require("./lib/catalog");

/** Options de validation issues de la configuration de déploiement. */
function catalogOptions() {
  return { allowedLocalRoots: ALLOWED_LOCAL_ROOTS, onNotice: log };
}

/* ─── Chargement du catalogue ────────────────────────────────────────────── */

function bundledCatalogPath() {
  const beside = path.join(process.resourcesPath || "", "apps.json");
  if (process.resourcesPath && fs.existsSync(beside)) return beside;
  return path.join(__dirname, "apps.json");
}

let catalogCache = null;

function loadCatalog() {
  if (catalogCache) return catalogCache;

  const localPath = userFile("apps.json");
  const candidates = [localPath, bundledCatalogPath()];

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const raw = JSON.parse(fs.readFileSync(candidate, "utf-8"));
      const parsed = normalizeCatalog(raw, catalogOptions());

      if (candidate === localPath) {
        catalogCache = parsed;
      } else {
        // Premier démarrage : la copie embarquée devient la copie de travail.
        writeJSON(localPath, raw);
        catalogCache = parsed;
      }

      if (parsed.rejected) {
        log(parsed.rejected + " entrée(s) du catalogue ignorée(s) car invalides.");
      }
      return catalogCache;
    } catch (error) {
      log("Catalogue ignoré (" + candidate + ") : " + error.message);
      if (candidate === localPath) {
        // Copie locale corrompue : mise de côté pour diagnostic.
        try {
          fs.renameSync(localPath, localPath + ".corrupt");
        } catch {
          /* sans conséquence */
        }
      }
    }
  }

  throw new Error("aucun catalogue exploitable n'a été trouvé");
}

/* ─── État utilisateur ───────────────────────────────────────────────────── */

const DEFAULT_PREFS = {
  theme: "system",
  density: "comfortable",
  mica: true,
  rail: "expanded",
  // Démarrage en plein écran : un lanceur occupe l'écran d'un poste de classe.
  // F11 bascule à tout moment, sans passer par les réglages.
  fullscreen: false,
  windowBounds: null
};

function getPrefs() {
  const stored = readJSON(userFile("prefs.json"), {});
  return Object.assign({}, DEFAULT_PREFS, stored && typeof stored === "object" ? stored : {});
}

function savePrefs(patch) {
  const next = Object.assign(getPrefs(), patch || {});
  writeJSON(userFile("prefs.json"), next);
  return next;
}

function getFavorites() {
  const stored = readJSON(userFile("favorites.json"), []);
  return Array.isArray(stored) ? stored.filter((id) => typeof id === "string").slice(0, 200) : [];
}

function getUsage() {
  const stored = readJSON(userFile("usage.json"), {});
  return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
}

function recordUsage(appId) {
  const usage = getUsage();
  const entry = usage[appId] || { count: 0, last: 0 };
  usage[appId] = { count: (entry.count || 0) + 1, last: Date.now() };

  const ids = Object.keys(usage);
  if (ids.length > MAX_USAGE_ENTRIES) {
    ids
      .sort((a, b) => (usage[a].last || 0) - (usage[b].last || 0))
      .slice(0, ids.length - MAX_USAGE_ENTRIES)
      .forEach((id) => delete usage[id]);
  }
  writeJSON(userFile("usage.json"), usage);
  return usage;
}

/* ─── État de synchronisation ────────────────────────────────────────────── */

let syncState = { state: "ok", text: "Catalogue local", lastChecked: 0 };

function setSyncState(state, text) {
  syncState = { state, text, lastChecked: Date.now() };
  broadcast({ type: "sync-state", state, text });
}

function broadcast(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("strasedu:event", payload);
  }
}

/* ─── Catalogue distant ──────────────────────────────────────────────────── */

/*
   Deux modes de collecte, selon la nature de l'adresse configurée :

   • http(s) — requête conditionnelle : l'ETag renvoyé par le serveur est
     mémorisé et renvoyé en « If-None-Match ». Le serveur répond alors 304
     sans corps. À l'échelle d'un parc, c'est la différence entre 750 Mo et
     29 Mo par jour pour 2000 postes.

   • fichier ou partage réseau — la date et la taille du fichier servent de
     signal de changement. Un partage SMB ne demande ni serveur web, ni
     jeton d'authentification, et reste l'option la plus économique en
     établissement : « \\serveur\partage\StrasEdu\apps.json ».
*/

let catalogEtag = null;
let localCatalogStamp = null;

/** Vrai si l'adresse désigne un fichier local ou un partage réseau. */
function isLocalCatalogSource(source) {
  return (
    /^file:/i.test(source) ||
    /^\\\\/.test(source) ||
    /^[a-zA-Z]:[\\/]/.test(source)
  );
}

/** Chemin exploitable par le système de fichiers. */
function localCatalogPath(source) {
  if (!/^file:/i.test(source)) return source;
  try {
    return require("url").fileURLToPath(source);
  } catch {
    return null;
  }
}

/**
 * Lit le catalogue depuis le système de fichiers.
 * Renvoie null si le fichier n'a pas changé depuis la dernière lecture.
 */
function readLocalCatalog(sourcePath) {
  const stat = fs.statSync(sourcePath);
  if (stat.size > MAX_CATALOG_BYTES) {
    throw new Error("catalogue trop volumineux (" + Math.round(stat.size / 1024) + " Ko)");
  }

  const stamp = stat.size + ":" + stat.mtimeMs;
  if (stamp === localCatalogStamp) return null;
  localCatalogStamp = stamp;

  let raw = fs.readFileSync(sourcePath, "utf-8");
  // Bloc-notes et PowerShell écrivent un BOM : JSON.parse le refuse.
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw);
}

function fetchCatalog(url, redirects) {
  return new Promise((resolve, reject) => {
    if ((redirects || 0) > 4) return reject(new Error("trop de redirections"));
    const client = url.startsWith("https") ? https : http;

    const headers = {
      "User-Agent": "StrasEdu/" + app.getVersion(),
      Accept: "application/json"
    };
    if (catalogEtag) headers["If-None-Match"] = catalogEtag;

    const request = client.get(url, { headers }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, url).toString();
        return resolve(fetchCatalog(next, (redirects || 0) + 1));
      }

      // 304 : le catalogue n'a pas changé, rien à télécharger.
      if (response.statusCode === 304) {
        response.resume();
        return resolve(null);
      }

      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error("HTTP " + response.statusCode));
      }

      let body = "";
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_CATALOG_BYTES) {
          request.destroy();
          reject(new Error("catalogue distant trop volumineux"));
          return;
        }
        body += chunk;
      });
      response.on("end", () => {
        if (response.headers.etag) catalogEtag = response.headers.etag;
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error("catalogue distant illisible : " + error.message));
        }
      });
    });

    request.setTimeout(FETCH_TIMEOUT_MS, () => {
      request.destroy();
      reject(new Error("délai dépassé"));
    });
    request.on("error", reject);
  });
}

async function checkForUpdates(options) {
  const notify = !options || options.notify !== false;

  if (!REMOTE_APPS_URL) {
    if (notify) setSyncState("warn", "Catalogue local (aucune source distante)");
    return { ok: true, updated: false, reason: "no-remote-url" };
  }

  setSyncState("checking", "Vérification du catalogue…");

  const fromFile = isLocalCatalogSource(REMOTE_APPS_URL);

  try {
    let remote;
    if (fromFile) {
      const sourcePath = localCatalogPath(REMOTE_APPS_URL);
      if (!sourcePath) throw new Error("adresse de catalogue illisible");
      remote = readLocalCatalog(sourcePath);
    } else {
      remote = await fetchCatalog(REMOTE_APPS_URL);
    }

    // Rien n'a changé à la source : on ne touche à rien.
    if (remote === null) {
      const local = catalogCache || loadCatalog();
      setSyncState("ok", "Catalogue à jour (v" + local.version + ")");
      return { ok: true, updated: false, reason: "not-modified", version: local.version };
    }

    const normalized = normalizeCatalog(remote, catalogOptions());
    const local = catalogCache || loadCatalog();

    if (normalized.version === local.version) {
      setSyncState("ok", "Catalogue à jour (v" + normalized.version + ")");
      return { ok: true, updated: false, reason: "up-to-date", version: normalized.version };
    }

    // La copie locale n'est écrasée qu'une fois la nouvelle version validée ;
    // l'ancienne est conservée pour pouvoir revenir en arrière.
    try {
      fs.copyFileSync(userFile("apps.json"), userFile("apps.previous.json"));
    } catch {
      /* première mise à jour : rien à sauvegarder */
    }
    writeJSON(userFile("apps.json"), remote);
    catalogCache = normalized;

    setSyncState("warn", "Nouvelle version " + normalized.version + " du catalogue");
    broadcast({
      type: "catalog-updated",
      version: normalized.version,
      previousVersion: local.version
    });
    log("Catalogue mis à jour : v" + local.version + " → v" + normalized.version);
    return {
      ok: true,
      updated: true,
      version: normalized.version,
      previousVersion: local.version
    };
  } catch (error) {
    log("Échec de la mise à jour du catalogue : " + error.message);
    const ou = fromFile ? "Fichier de catalogue inaccessible" : "Mise à jour impossible";
    setSyncState("warn", ou + " (" + error.message + ")");
    return { ok: false, updated: false, reason: error.message };
  }
}

/* ─── Ressources ─────────────────────────────────────────────────────────── */

/**
 * Les icônes sont livrées à côté de l'archive applicative (extraResources) :
 * la couche native de Windows attend un vrai chemin de fichier, et non une
 * entrée interne à l'archive asar.
 */
function assetPath(...parts) {
  const packaged = path.join(process.resourcesPath || "", ...parts);
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, ...parts);
}

/* ─── Fenêtre ────────────────────────────────────────────────────────────── */

let mainWindow = null;
let tray = null;
let quitting = false;

function isWindows11() {
  if (process.platform !== "win32") return false;
  const parts = os.release().split(".");
  return Number(parts[0]) >= 10 && Number(parts[2]) >= 22000;
}

function capabilities() {
  let accent = "#0f9d63";
  try {
    const raw = systemPreferences.getAccentColor();
    if (raw && raw.length >= 6) accent = "#" + raw.slice(0, 6);
  } catch {
    /* accent système indisponible : on garde la teinte de la charte */
  }

  return {
    platform: process.platform,
    windows11: isWindows11(),
    osName: os.type() + " " + os.release(),
    dark: nativeTheme.shouldUseDarkColors,
    accent,
    version: app.getVersion(),
    catalogPath: userFile("apps.json"),
    remoteConfigured: Boolean(REMOTE_APPS_URL),
    // Affichée dans les réglages : sans elle, un poste qui ne se met pas à jour
    // ne laisse rien voir d'autre que « aucune source distante configurée ».
    remoteSource: REMOTE_APPS_URL,
    fullscreen: Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isFullScreen()),
    micaSupported: isWindows11()
  };
}

function createWindow() {
  const prefs = getPrefs();
  const bounds = prefs.windowBounds || {};
  const useMica = prefs.mica !== false && isWindows11();

  mainWindow = new BrowserWindow({
    width: bounds.width || 1240,
    height: bounds.height || 820,
    x: bounds.x,
    y: bounds.y,
    minWidth: 880,
    minHeight: 560,
    title: APP_NAME,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: useMica
      ? "#00000000"
      : nativeTheme.shouldUseDarkColors
        ? "#171a1c"
        : "#f3f6f5",
    backgroundMaterial: useMica ? "mica" : "none",
    icon: assetPath("icons", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: !app.isPackaged
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  trace("fenêtre créée, chargement de l'interface (Mica=" + (useMica ? "activé" : "désactivé") + ")");

  /*
     L'affichage ne doit pas dépendre du seul événement « ready-to-show » : sur
     certaines configurations graphiques il n'arrive jamais, et l'application
     tourne alors avec une fenêtre invisible — le symptôme exact de « rien ne
     s'ouvre ». Un délai de sécurité garantit l'affichage, et la trace indique
     lequel des deux chemins a été emprunté.
  */
  let revealed = false;
  const startHidden = DEPLOY.startMinimized === true;

  const revealWindow = (origine) => {
    if (revealed || !mainWindow || mainWindow.isDestroyed()) return;
    revealed = true;

    // Déploiement en parc : l'application peut être lancée à l'ouverture de
    // session sans ouvrir de fenêtre, et rester disponible dans la zone de
    // notification. La fenêtre s'ouvre au premier clic sur l'icône.
    if (startHidden) {
      trace("démarrage masqué (startMinimized) — fenêtre laissée en notification");
      return;
    }

    mainWindow.show();
    trace("fenêtre affichée (" + origine + ")");
    if (bounds.maximized) {
      mainWindow.maximize();
    } else if (prefs.fullscreen === true) {
      mainWindow.setFullScreen(true);
    }
  };

  mainWindow.once("ready-to-show", () => revealWindow("ready-to-show"));
  setTimeout(() => {
    if (!revealed) {
      trace("ready-to-show non reçu après 3 s — affichage forcé");
      revealWindow("délai de sécurité");
    }
  }, 3000);

  mainWindow.webContents.on("did-fail-load", (_e, code, description, url) => {
    trace("échec de chargement de l'interface : " + description + " (" + code + ") " + url);
  });
  mainWindow.webContents.on("render-process-gone", (_e, details) => {
    trace("le rendu s'est arrêté : " + JSON.stringify(details));
  });

  // Aucune fenêtre interne : tout lien sortant part vers le navigateur du
  // poste, et uniquement en http(s).
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const safe = safeExternalUrl(url);
    if (safe) shell.openExternal(safe);
    return { action: "deny" };
  });

  // Redimensionner ou déplacer une fenêtre déclenche des dizaines d'événements
  // par seconde : sans temporisation, chaque pixel parcouru réécrit prefs.json.
  const persistBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return;
    const maximized = mainWindow.isMaximized();
    const area = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds();
    savePrefs({ windowBounds: Object.assign({}, area, { maximized }) });
  };

  let boundsTimer = null;
  const saveBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(persistBounds, 400);
  };

  mainWindow.on("resize", saveBounds);
  mainWindow.on("move", saveBounds);

  mainWindow.on("close", (event) => {
    // Fermer la fenêtre laisse StrasEdu actif dans la zone de notification :
    // c'est un lanceur, il doit rester à portée de clic.
    if (!quitting) {
      event.preventDefault();
      if (boundsTimer) clearTimeout(boundsTimer);
      persistBounds();
      mainWindow.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

/** Recrée la fenêtre : indispensable pour appliquer un changement de matériau. */
function recreateWindow() {
  const previous = mainWindow;
  mainWindow = null;
  if (previous && !previous.isDestroyed()) previous.destroy();
  createWindow();
}

/* ─── Zone de notification ───────────────────────────────────────────────── */

function trayImage() {
  // nativeImage charge automatiquement tray@2x.png / tray@3x.png selon le
  // facteur d'échelle de l'écran : l'icône reste nette à 100, 150 et 200 %.
  const image = nativeImage.createFromPath(assetPath("icons", "tray.png"));
  return image.isEmpty() ? nativeImage.createEmpty() : image;
}

function createTray() {
  tray = new Tray(trayImage());
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Ouvrir StrasEdu", click: showWindow },
      { type: "separator" },
      { label: "Vérifier les mises à jour", click: () => checkForUpdates() },
      {
        label: "Ouvrir le dossier du catalogue",
        click: () => shell.showItemInFolder(userFile("apps.json"))
      },
      { type: "separator" },
      {
        label: "Quitter",
        click: () => {
          quitting = true;
          app.quit();
        }
      }
    ])
  );

  tray.on("click", showWindow);
  tray.on("double-click", showWindow);
}

/* ─── IPC ────────────────────────────────────────────────────────────────── */

function snapshot() {
  let catalog;
  try {
    catalog = loadCatalog();
    trace("catalogue chargé — " + catalog.apps.length + " outils, v" + catalog.version);
  } catch (error) {
    trace("CATALOGUE INDISPONIBLE : " + error.message);
    catalog = {
      schema: 2,
      version: "0",
      lastUpdated: "",
      establishment: APP_NAME,
      user: { initials: "", name: "", role: "" },
      categories: [],
      categoryMeta: {},
      apps: []
    };
  }
  return {
    catalog,
    prefs: getPrefs(),
    favorites: getFavorites(),
    usage: getUsage(),
    capabilities: capabilities(),
    sync: syncState
  };
}

function registerIpc() {
  ipcMain.handle("strasedu:snapshot", () => snapshot());

  ipcMain.handle("strasedu:open-app", async (_event, appId) => {
    let entry;
    try {
      entry = loadCatalog().apps.find((item) => item.id === appId);
    } catch (error) {
      return { ok: false, error: "Catalogue indisponible : " + error.message };
    }
    if (!entry) return { ok: false, error: "Outil inconnu du catalogue." };

    try {
      if (entry.type === "local") {
        if (!fs.existsSync(entry.path)) {
          return {
            ok: false,
            error: "Le logiciel n'est pas installé sur ce poste (" + entry.path + ")."
          };
        }
        const message = await shell.openPath(entry.path);
        if (message) return { ok: false, error: message };
      } else {
        await shell.openExternal(entry.url);
      }
      recordUsage(entry.id);
      log("Ouverture de « " + entry.name + " »");
      return { ok: true };
    } catch (error) {
      log("Échec d'ouverture de « " + entry.name + " » : " + error.message);
      return { ok: false, error: error.message };
    }
  });

  // Information du département : le rendu transmet un identifiant, le processus
  // principal résout le lien dans le catalogue qu'il a lui-même validé.
  ipcMain.handle("strasedu:open-news", async (_event, itemId) => {
    let item;
    try {
      const news = loadCatalog().news;
      const items = news && Array.isArray(news.items) ? news.items : [];
      item = items.find((entry) => entry.id === itemId);
    } catch (error) {
      return { ok: false, error: "Catalogue indisponible : " + error.message };
    }
    if (!item) return { ok: false, error: "Information inconnue du catalogue." };
    if (!item.url) return { ok: false, error: "Cette information n'a pas de lien." };

    try {
      await shell.openExternal(item.url);
      log("Ouverture du lien de « " + item.title + " »");
      return { ok: true };
    } catch (error) {
      log("Échec d'ouverture du lien : " + error.message);
      return { ok: false, error: error.message };
    }
  });

  ipcMain.handle("strasedu:set-fullscreen", (_event, value) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { fullscreen: false };
    const wanted = typeof value === "boolean" ? value : !mainWindow.isFullScreen();
    mainWindow.setFullScreen(wanted);
    return { fullscreen: wanted };
  });

  ipcMain.handle("strasedu:set-favorites", (_event, ids) => {
    const clean = Array.isArray(ids)
      ? ids.filter((id) => typeof id === "string").slice(0, 200)
      : [];
    writeJSON(userFile("favorites.json"), clean);
    return clean;
  });

  ipcMain.handle("strasedu:set-prefs", (_event, patch) => {
    const allowed = {};
    if (patch && typeof patch === "object") {
      if (patch.theme === "system" || patch.theme === "light" || patch.theme === "dark") {
        allowed.theme = patch.theme;
      }
      if (patch.density === "comfortable" || patch.density === "compact") {
        allowed.density = patch.density;
      }
      if (patch.rail === "expanded" || patch.rail === "compact") allowed.rail = patch.rail;
      if (typeof patch.mica === "boolean") allowed.mica = patch.mica;
      if (typeof patch.fullscreen === "boolean") allowed.fullscreen = patch.fullscreen;
    }
    const next = savePrefs(allowed);
    if (allowed.theme) nativeTheme.themeSource = allowed.theme;
    return next;
  });

  ipcMain.handle("strasedu:set-mica", (_event, enabled) => {
    savePrefs({ mica: Boolean(enabled) });
    if (isWindows11()) {
      recreateWindow();
      return { ok: true, restarted: true };
    }
    return { ok: true, restarted: false };
  });

  ipcMain.handle("strasedu:set-theme", (_event, theme) => {
    if (theme === "system" || theme === "light" || theme === "dark") {
      savePrefs({ theme });
      nativeTheme.themeSource = theme;
    }
    return getPrefs();
  });

  ipcMain.handle("strasedu:check-update", () => checkForUpdates({ notify: true }));
  ipcMain.handle("strasedu:reveal-catalog", () => shell.showItemInFolder(userFile("apps.json")));
  ipcMain.handle("strasedu:version", () => app.getVersion());
}

/* ─── Durcissement ───────────────────────────────────────────────────────── */

function hardenSession() {
  // StrasEdu n'a besoin ni de caméra, ni de micro, ni de notifications.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false);
  });

  app.on("web-contents-created", (_event, contents) => {
    contents.on("will-navigate", (event, url) => {
      event.preventDefault();
      const safe = safeExternalUrl(url);
      if (safe) shell.openExternal(safe);
    });
    contents.on("will-attach-webview", (event) => event.preventDefault());
  });
}

/* ─── Cycle de vie ───────────────────────────────────────────────────────── */

// Verrou d'instance unique : installé avant toute création de fenêtre, sinon
// une seconde instance peut ouvrir une fenêtre avant de s'arrêter.
if (!app.requestSingleInstanceLock()) {
  trace("une instance est déjà en cours — cette invocation se termine");
  app.quit();
} else {
  trace("verrou d'instance unique obtenu");
  app.on("second-instance", showWindow);

  app.setAppUserModelId(APP_ID);
  app.setName(APP_NAME);

  app.whenReady().then(() => {
    trace("application prête");
    hardenSession();
    nativeTheme.themeSource = getPrefs().theme || "system";

    registerIpc();
    createWindow();
    createTray();
    trace("zone de notification créée");

    /*
       Les vérifications sont étalées aléatoirement. Sans cela, 2000 postes
       démarrés à la même heure interrogent le serveur dans la même seconde,
       puis restent en cadence : un pic inutile toutes les demi-heures.
    */
    const nextDelay = () =>
      Math.round(CHECK_INTERVAL_MS * (0.85 + Math.random() * 0.3));

    function scheduleSync(delay) {
      setTimeout(() => {
        Promise.resolve()
          .then(() => checkForUpdates({ notify: false }))
          .catch(() => undefined)
          .then(() => scheduleSync(nextDelay()));
      }, delay);
    }

    // Le premier passage est réparti sur la minute qui suit l'ouverture de
    // session : le catalogue local est utilisé en attendant.
    scheduleSync(4000 + Math.round(Math.random() * 45000));

    nativeTheme.on("updated", () => {
      broadcast({ type: "system-theme", dark: nativeTheme.shouldUseDarkColors });
    });

    app.on("activate", showWindow);
  });

  /*
     Un démarrage qui échoue doit se voir. Sans cela, l'application se termine
     en silence et l'utilisateur conclut simplement que « rien ne s'ouvre ».
  */
  process.on("uncaughtException", (error) => {
    trace("EXCEPTION : " + (error && error.stack ? error.stack : String(error)));
    try {
      dialog.showErrorBox(
        APP_NAME + " — erreur au démarrage",
        "L'application n'a pas pu démarrer.\n\n" +
          (error && error.message ? error.message : String(error)) +
          "\n\nDétail complet dans :\n" +
          TRACE_TARGETS.join("\n")
      );
    } catch {
      /* la boîte de dialogue elle-même peut échouer : la trace reste écrite */
    }
    app.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    trace("PROMESSE REJETÉE : " + (reason && reason.stack ? reason.stack : String(reason)));
  });

  // Sur Windows, fermer la dernière fenêtre ne quitte pas : StrasEdu reste
  // disponible dans la zone de notification.
  app.on("window-all-closed", () => {
    if (process.platform !== "win32") app.quit();
  });

  app.on("before-quit", () => {
    quitting = true;
  });
}
