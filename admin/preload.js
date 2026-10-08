/* ==========================================================================
   StrasEdu — pont de l'application d'administration
   --------------------------------------------------------------------------
   Surface étroite : lire et écrire un catalogue, choisir des fichiers, et
   publier (dossier partagé ou service HTTPS). Aucune exécution de programme,
   aucune URL arbitraire.

   Le jeton de publication ne traverse jamais ce pont en sens inverse : il est
   confié à la couche native, qui le chiffre, et n'en revient qu'un booléen.
   ========================================================================== */

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("admin", {
  /** État initial : catalogue courant, chemins mémorisés, thème système. */
  getState: () => ipcRenderer.invoke("admin:state"),

  /** Mémoriser destination, adresse de lecture, empreinte et jeton. Le jeton
      n'est écrit en clair nulle part : voir admin/main.js. */
  setPrefs: (patch) => ipcRenderer.invoke("admin:set-prefs", patch),

  /** Choisir un catalogue existant. */
  open: () => ipcRenderer.invoke("admin:open"),

  /** Lire le catalogue actuellement publié (dossier ou adresse http(s)). */
  loadShare: () => ipcRenderer.invoke("admin:load-share"),

  /** Enregistrer (valide avant d'écrire). */
  save: (catalog, targetPath) => ipcRenderer.invoke("admin:save", catalog, targetPath),

  /** Enregistrer sous un autre nom. */
  saveAs: (catalog) => ipcRenderer.invoke("admin:save-as", catalog),

  /** Choisir le dossier de publication. */
  chooseShare: () => ipcRenderer.invoke("admin:choose-share"),

  /** Publier : validation, version incrémentée, dépôt (fichier ou service
      HTTPS avec certificat épinglé) puis relecture de ce que les postes
      reçoivent réellement. */
  publish: (catalog) => ipcRenderer.invoke("admin:publish", catalog),

  /** Choisir le logo officiel (réduit par la couche native). */
  pickLogo: () => ipcRenderer.invoke("admin:pick-logo"),

  /** Choisir un visuel (vignette d'outil, bandeau d'information), réduit sur
      une hauteur donnée puis encodé en data URI validé. */
  pickImage: (options) => ipcRenderer.invoke("admin:pick-image", options),

  /** Vérifier le catalogue sans rien écrire. */
  validate: (catalog) => ipcRenderer.invoke("admin:validate", catalog),

  /** Montrer le fichier dans l'Explorateur. */
  reveal: (filePath) => ipcRenderer.invoke("admin:reveal", filePath)
});
