/* ==========================================================================
   StrasEdu — pont de prévisualisation
   --------------------------------------------------------------------------
   Remplace preload.js pour les captures d'écran : alimente l'interface avec
   le catalogue local et un jeu de données d'exemple, sans processus principal
   ni accès disque depuis le rendu.
   ========================================================================== */

"use strict";

const { contextBridge } = require("electron");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "apps.json"), "utf-8"));

const now = Date.now();
const theme = process.env.PREVIEW_THEME === "dark" ? "dark" : "light";

const usage = {
  vocaroo: { count: 12, last: now - 4 * 60 * 1000 },
  clipchamp: { count: 5, last: now - 3 * 3600 * 1000 },
  nextcloud: { count: 8, last: now - 26 * 3600 * 1000 },
  claude: { count: 3, last: now - 2 * 24 * 3600 * 1000 },
  peertube: { count: 6, last: now - 5 * 24 * 3600 * 1000 }
};

const snapshot = {
  catalog,
  prefs: {
    theme,
    density: process.env.PREVIEW_DENSITY === "compact" ? "compact" : "comfortable",
    mica: false,
    rail: "expanded",
    fullscreen: false
  },
  favorites: ["podcastle", "peertube", "lechat", "pdfxchange"],
  usage,
  capabilities: {
    platform: "win32",
    windows11: true,
    osName: "Windows_NT 10.0.26200",
    dark: theme === "dark",
    accent: "#0f9d63",
    version: "2.0.0",
    catalogPath: "C:\\Users\\C.Marchand\\AppData\\Roaming\\StrasEdu\\apps.json",
    remoteConfigured: true,
    remoteSource: "\\\\serveur\\partage\\StrasEdu\\apps.json",
    fullscreen: false,
    micaSupported: true
  },
  sync: { state: "ok", text: "Catalogue à jour (v2.0.0)", lastChecked: now }
};

contextBridge.exposeInMainWorld("strasedu", {
  getSnapshot: async () => JSON.parse(JSON.stringify(snapshot)),
  openApp: async () => ({ ok: true }),
  openNews: async () => ({ ok: true }),
  setFullscreen: async () => ({ fullscreen: false }),
  setFavorites: async (ids) => ids,
  setPrefs: async (prefs) => Object.assign(snapshot.prefs, prefs),
  setTheme: async (value) => {
    snapshot.prefs.theme = value;
    return snapshot.prefs;
  },
  setMica: async () => ({ ok: true, restarted: false }),
  checkUpdate: async () => ({ ok: true, updated: false, reason: "up-to-date" }),
  revealCatalog: async () => undefined,
  getVersion: async () => "2.0.0",
  onEvent: () => () => undefined
});
