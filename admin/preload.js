/* ==========================================================================
   StrasEdu — pont de l'application d'administration
   --------------------------------------------------------------------------
   Surface étroite : lire et écrire un catalogue, choisir des fichiers, et
   publier. Aucune exécution de programme, aucune URL arbitraire.
   ========================================================================== */

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("admin", {
  /** État initial : catalogue courant, chemins mémorisés, thème système. */
  getState: () => ipcRenderer.invoke("admin:state"),

  /** Choisir un catalogue existant. */
  open: () => ipcRenderer.invoke("admin:open"),

  /** Lire le catalogue actuellement publié sur le partage. */
  loadShare: () => ipcRenderer.invoke("admin:load-share"),

  /** Enregistrer (valide avant d'écrire). */
  save: (catalog, targetPath) => ipcRenderer.invoke("admin:save", catalog, targetPath),

  /** Enregistrer sous un autre nom. */
  saveAs: (catalog) => ipcRenderer.invoke("admin:save-as", catalog),

  /** Choisir le dossier de publication. */
  chooseShare: () => ipcRenderer.invoke("admin:choose-share"),

  /** Publier : validation, version incrémentée, écriture atomique. */
  publish: (catalog) => ipcRenderer.invoke("admin:publish", catalog),

  /** Choisir le logo officiel (réduit par la couche native). */
  pickLogo: () => ipcRenderer.invoke("admin:pick-logo"),

  /** Vérifier le catalogue sans rien écrire. */
  validate: (catalog) => ipcRenderer.invoke("admin:validate", catalog),

  /** Montrer le fichier dans l'Explorateur. */
  reveal: (filePath) => ipcRenderer.invoke("admin:reveal", filePath)
});
