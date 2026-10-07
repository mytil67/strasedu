/* ==========================================================================
   Portail Outils — pont de préchargement
   --------------------------------------------------------------------------
   Surface exposée volontairement étroite : le rendu ne peut ni lire le
   disque, ni exécuter de programme, ni ouvrir d'URL arbitraire. Il transmet
   des identifiants d'outils ; le processus principal décide.
   ========================================================================== */

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const EVENT_CHANNEL = "portail:event";

contextBridge.exposeInMainWorld("portail", {
  /** Catalogue validé, préférences, favoris, usage et capacités de la machine. */
  getSnapshot: () => ipcRenderer.invoke("portail:snapshot"),

  /** Ouvre un outil par son identifiant de catalogue. */
  openApp: (appId) => ipcRenderer.invoke("portail:open-app", appId),

  /** Remplace la liste des favoris. */
  setFavorites: (ids) => ipcRenderer.invoke("portail:set-favorites", ids),

  /** Enregistre un ou plusieurs réglages (thème, densité, menu, Mica). */
  setPrefs: (prefs) => ipcRenderer.invoke("portail:set-prefs", prefs),

  /** Aligne le thème de l'application sur celui de Windows. */
  setTheme: (theme) => ipcRenderer.invoke("portail:set-theme", theme),

  /** Active ou désactive l'effet Mica (recrée la fenêtre sous Windows 11). */
  setMica: (enabled) => ipcRenderer.invoke("portail:set-mica", enabled),

  /** Interroge la source distante du catalogue. */
  checkUpdate: () => ipcRenderer.invoke("portail:check-update"),

  /** Ouvre le dossier contenant apps.json dans l'Explorateur. */
  revealCatalog: () => ipcRenderer.invoke("portail:reveal-catalog"),

  /** Version de l'application. */
  getVersion: () => ipcRenderer.invoke("portail:version"),

  /**
   * S'abonne aux événements du processus principal
   * (catalogue mis à jour, thème système, état de synchronisation).
   */
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(EVENT_CHANNEL, listener);
    return () => ipcRenderer.removeListener(EVENT_CHANNEL, listener);
  }
});
