/* ==========================================================================
   StrasEdu — pont de préchargement
   --------------------------------------------------------------------------
   Surface exposée volontairement étroite : le rendu ne peut ni lire le
   disque, ni exécuter de programme, ni ouvrir d'URL arbitraire. Il transmet
   des identifiants d'outils ; le processus principal décide.
   ========================================================================== */

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const EVENT_CHANNEL = "strasedu:event";

contextBridge.exposeInMainWorld("strasedu", {
  /** Catalogue validé, préférences, favoris, usage et capacités de la machine. */
  getSnapshot: () => ipcRenderer.invoke("strasedu:snapshot"),

  /** Ouvre un outil par son identifiant de catalogue. */
  openApp: (appId) => ipcRenderer.invoke("strasedu:open-app", appId),

  /** Ouvre le lien d'une information du département, par son identifiant. */
  openNews: (itemId) => ipcRenderer.invoke("strasedu:open-news", itemId),

  /** Affiche le catalogue recu et deja installe localement. */
  reloadCatalog: () => ipcRenderer.invoke("strasedu:reload-catalog"),

  /** Bascule le plein écran ; sans valeur, inverse l'état courant. */
  setFullscreen: (value) => ipcRenderer.invoke("strasedu:set-fullscreen", value),

  /** Remplace la liste des favoris. */
  setFavorites: (ids) => ipcRenderer.invoke("strasedu:set-favorites", ids),

  /** Enregistre un ou plusieurs réglages (thème, densité, menu, Mica). */
  setPrefs: (prefs) => ipcRenderer.invoke("strasedu:set-prefs", prefs),

  /** Aligne le thème de l'application sur celui de Windows. */
  setTheme: (theme) => ipcRenderer.invoke("strasedu:set-theme", theme),

  /** Active ou désactive l'effet Mica (recrée la fenêtre sous Windows 11). */
  setMica: (enabled) => ipcRenderer.invoke("strasedu:set-mica", enabled),

  /** Interroge la source distante du catalogue. */
  checkUpdate: () => ipcRenderer.invoke("strasedu:check-update"),

  /** Ouvre le dossier contenant apps.json dans l'Explorateur. */
  revealCatalog: () => ipcRenderer.invoke("strasedu:reveal-catalog"),

  /** Version de l'application. */
  getVersion: () => ipcRenderer.invoke("strasedu:version"),

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
