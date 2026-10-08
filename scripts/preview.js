/* ==========================================================================
   StrasEdu — captures d'écran de contrôle
   --------------------------------------------------------------------------
   Ouvre l'interface avec un catalogue d'exemple, la pilote (navigation,
   palette de commandes, réglages) et enregistre une image par étape dans
   .preview/. Sert à vérifier le rendu réel avant de livrer.

   Usage : npm run preview
   ========================================================================== */

"use strict";

const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, ".preview");

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Étapes : nom de fichier, thème, densité, actions dans le rendu. */
const SHOTS = [
  { name: "01-accueil-clair", theme: "light", density: "comfortable", script: null },
  {
    name: "02-categorie-audio",
    theme: "light",
    density: "comfortable",
    script: "document.querySelector('[data-route=\"cat:Audio\"]').click()"
  },
  {
    name: "03-palette-clair",
    theme: "light",
    density: "comfortable",
    script: "document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}))"
  },
  {
    name: "04-accueil-sombre",
    theme: "dark",
    density: "comfortable",
    script: "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"
  },
  {
    name: "05-categorie-ia-compact",
    theme: "dark",
    density: "compact",
    script: "document.querySelector('[data-route=\"cat:IA\"]').click()"
  },
  {
    name: "06-recherche",
    theme: "light",
    density: "comfortable",
    script:
      "(()=>{const i=document.getElementById('search');i.value='montage';" +
      "i.dispatchEvent(new Event('input',{bubbles:true}));})()"
  },
  {
    name: "07-reglages",
    theme: "light",
    density: "comfortable",
    script:
      "(()=>{const i=document.getElementById('search');i.value='';" +
      "i.dispatchEvent(new Event('input',{bubbles:true}));" +
      "document.getElementById('btn-settings').click();})()"
  },
  {
    name: "08-aide",
    theme: "dark",
    density: "comfortable",
    script:
      "(()=>{document.getElementById('btn-settings').click();" +
      "document.getElementById('btn-help').click();})()"
  },
  {
    name: "09-recherche-sans-accent",
    theme: "light",
    density: "comfortable",
    script:
      "(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));" +
      "const i=document.getElementById('search');i.value='video';" +
      "i.dispatchEvent(new Event('input',{bubbles:true}));})()"
  },
  {
    name: "10-palette-requete",
    theme: "light",
    density: "comfortable",
    script:
      "(()=>{const i=document.getElementById('search');i.value='';" +
      "i.dispatchEvent(new Event('input',{bubbles:true}));" +
      "document.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}));" +
      "const p=document.getElementById('palette-input');p.value='pod';" +
      "p.dispatchEvent(new Event('input',{bubbles:true}));})()"
  }
];

async function capture(win, name) {
  const image = await win.webContents.capturePage();
  const file = path.join(OUT, name + ".png");
  fs.writeFileSync(file, image.toPNG());
  const { width, height } = image.getSize();
  console.log("  ✓ " + path.basename(file) + "  " + width + "x" + height);
}

function createWindow(theme, density) {
  process.env.PREVIEW_THEME = theme;
  process.env.PREVIEW_DENSITY = density;

  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: true,
    backgroundColor: theme === "dark" ? "#171a1c" : "#f3f6f5",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preview-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  win.loadFile(path.join(ROOT, "index.html"));
  return win;
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });

  let current = null;
  let key = "";

  for (const shot of SHOTS) {
    const signature = shot.theme + "/" + shot.density;
    if (signature !== key) {
      if (current && !current.isDestroyed()) current.destroy();
      current = createWindow(shot.theme, shot.density);
      key = signature;
      await new Promise((resolve) => current.webContents.once("did-finish-load", resolve));
      await wait(700);
    }

    if (shot.script) {
      try {
        await current.webContents.executeJavaScript(shot.script, true);
      } catch (error) {
        console.error("  ! script en échec pour " + shot.name + " : " + error.message);
      }
      await wait(420);
    }

    const errors = await current.webContents.executeJavaScript(
      "window.__previewErrors ? window.__previewErrors.join(' | ') : ''",
      true
    );
    if (errors) console.error("  ! erreurs de page : " + errors);

    await capture(current, shot.name);
  }

  if (current && !current.isDestroyed()) current.destroy();
  console.log("\nCaptures écrites dans " + OUT);
}

app.whenReady().then(() => {
  run()
    .then(() => app.exit(0))
    .catch((error) => {
      console.error("Échec de la prévisualisation :", error);
      app.exit(1);
    });
});

// Pas de sortie automatique : le script recrée une fenêtre entre deux thèmes,
// ce qui déclencherait « window-all-closed » au milieu de la série.
app.on("window-all-closed", () => {
  /* géré par run() */
});
