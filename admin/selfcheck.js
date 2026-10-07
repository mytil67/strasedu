/* ==========================================================================
   Portail Outils — auto-vérification de l'application d'administration
   --------------------------------------------------------------------------
   Pilote l'interface comme le ferait un administrateur, sur un catalogue
   temporaire, et vérifie chaque capacité demandée :

     • ajouter, modifier, supprimer un outil ;
     • lui affecter une icône, puis la retirer ;
     • créer une catégorie, la renommer, vérifier que les outils suivent ;
     • définir le logo officiel ;
     • enregistrer, puis publier sur le partage avec incrément de version ;
     • refuser un catalogue invalide en nommant l'outil fautif.

   Écrit aussi des captures d'écran dans .preview/admin/.

   Le bac d'essai est dans le projet (.selfcheck) : un dossier temporaire
   système peut être refusé en écriture selon la stratégie de sécurité du poste.

   Usage : npm run selfcheck:admin    (échec = code de sortie 1)
   ========================================================================== */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WORK = path.join(ROOT, ".selfcheck");
const CATALOG = path.join(WORK, "apps.json");
const SHARE = path.join(WORK, "partage");
const SHOTS = path.join(ROOT, ".preview", "admin");

console.log("Auto-vérification — préparation de " + WORK);
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(SHARE, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
fs.copyFileSync(path.join(ROOT, "apps.json"), CATALOG);

process.env.PORTAIL_ADMIN_CATALOG = CATALOG;
process.env.PORTAIL_ADMIN_SHARE = SHARE;

const { app, BrowserWindow, nativeImage } = require("electron");
app.setPath("userData", path.join(WORK, "profil"));

require("./main.js"); // démarre l'application d'administration

/* ─── Harnais ────────────────────────────────────────────────────────────── */

const results = [];
let failures = 0;
const consoleErrors = [];

function check(label, condition, detail) {
  const ok = !!condition;
  if (!ok) failures += 1;
  results.push((ok ? "  ok     " : "  ÉCHEC  ") + label + (!ok && detail ? "  → " + detail : ""));
}

function step(label) {
  console.log("  … " + label);
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Borne toute attente : une étape bloquée doit se signaler, pas figer le test. */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_resolve, reject) =>
      setTimeout(() => reject(new Error("délai dépassé : " + label)), ms)
    )
  ]);
}

/* ─── Scénario ───────────────────────────────────────────────────────────── */

async function run(win) {
  // Chaque appel est numéroté : en cas de blocage, la dernière ligne tracée
  // désigne l'instruction fautive.
  let jsCount = 0;
  const js = (code) => {
    jsCount += 1;
    console.log("    js#" + jsCount + "  " + String(code).replace(/\s+/g, " ").slice(0, 76));
    return withTimeout(win.webContents.executeJavaScript(code, true), 8000, "js#" + jsCount);
  };

  const setField = (id, value) =>
    js(
      "(()=>{const e=document.getElementById(" + JSON.stringify(id) + ");" +
      "e.value=" + JSON.stringify(value) + ";" +
      "e.dispatchEvent(new Event('input',{bubbles:true}));" +
      "e.dispatchEvent(new Event('change',{bubbles:true}));return e.value;})()"
    );

  const click = (selector) =>
    js(
      "(()=>{const e=document.querySelector(" + JSON.stringify(selector) + ");" +
      "if(!e) return 'ABSENT';e.click();return 'ok';})()"
    );

  const clickData = (attribute, value) =>
    js(
      "(()=>{const e=[...document.querySelectorAll('[" + attribute + "]')]" +
      ".find(n=>n.getAttribute('" + attribute + "')===" + JSON.stringify(value) + ");" +
      "if(!e) return 'ABSENT';e.click();return 'ok';})()"
    );

  const model = () =>
    js(
      "(()=>{const s=window.__adminState;return {" +
      "apps:s.catalog.apps.map(a=>({id:a.id,name:a.name,category:a.category,type:a.type," +
      "url:a.url,path:a.path,icon:a.icon||null,mark:a.mark,keywords:a.keywords,badge:a.badge}))," +
      "categories:s.catalog.categories.slice()," +
      "meta:JSON.parse(JSON.stringify(s.catalog.categoryMeta))," +
      "logo:!!s.catalog.logo,version:s.catalog.version,filePath:s.filePath};})()"
    );

  const getApp = (id) => model().then((m) => m.apps.find((a) => a.id === id) || null);

  // La capture est un confort : si elle traîne, le test continue.
  const shot = async (name) => {
    try {
      const image = await withTimeout(win.webContents.capturePage(), 8000, "capture " + name);
      fs.writeFileSync(path.join(SHOTS, name + ".png"), image.toPNG());
    } catch (error) {
      console.log("    (capture ignorée : " + name + " — " + error.message + ")");
    }
  };

  /* ── 1. Catalogue livré, avec les trois nouvelles tuiles ───────────────── */
  step("chargement du catalogue");
  await wait(800);
  let m = await model();
  check("catalogue chargé", m.apps.length === 23, m.apps.length + " outils");
  check("catégories chargées", m.categories.length === 6, m.categories.join(", "));
  check("catégorie Services créée", m.categories.indexOf("Services") >= 0);
  check("métadonnées de Services", !!m.meta.Services && m.meta.Services.color === "#65A30D");

  const prim = m.apps.find((a) => a.id === "prim-a");
  check("tuile PRIM-A", !!prim && prim.category === "IA" && prim.icon === "sparkles" &&
    prim.url === "https://prim-a.ac-strasbourg.fr/", JSON.stringify(prim));
  const forge = m.apps.find((a) => a.id === "forge-communs");
  check("tuile Forge des communs numériques", !!forge && forge.category === "Services" &&
    forge.icon === "globe" && forge.url === "https://forge.apps.education.fr/", JSON.stringify(forge));
  const pix = m.apps.find((a) => a.id === "pix-junior");
  check("tuile PIX Junior", !!pix && pix.category === "Services" &&
    pix.icon === "book" && pix.url === "https://junior.pix.fr/", JSON.stringify(pix));

  const domCount = await js("document.querySelectorAll('#app-list .admin-item').length");
  check("liste rendue à l'écran", domCount === 23, String(domCount));
  await shot("01-outils");

  /* ── 2. Ajouter un outil et le renseigner ──────────────────────────────── */
  step("ajout d'un outil");
  await click('[data-act="app-add"]');
  await wait(200);
  await setField("f-name", "Wikipédia");
  await setField("f-url", "https://fr.wikipedia.org");
  await setField("f-description", "Encyclopédie collaborative libre.");
  await setField("f-meta", "Sans compte");
  await setField("f-keywords", "encyclopedie, recherche, articles");
  await setField("f-badge", "4");
  await wait(300);

  let wiki = await getApp("wikipedia");
  check("outil ajouté", !!wiki, JSON.stringify(await model().then((x) => x.apps.map((a) => a.id))));
  check("identifiant déduit du nom", !!wiki && wiki.id === "wikipedia");
  check("adresse enregistrée", !!wiki && wiki.url === "https://fr.wikipedia.org");
  check("mots-clés découpés", !!wiki && wiki.keywords.length === 3, wiki && wiki.keywords.join("|"));
  check("pastille chiffrée", !!wiki && wiki.badge === 4, wiki && String(wiki.badge));

  // Le champ « chemin » ne doit pas rester affiché pour un outil web : un
  // « display » explicite l'emporterait sur l'attribut hidden.
  const hiddenWhenWeb = await js(
    "getComputedStyle(document.getElementById('row-path')).display === 'none' &&" +
    "getComputedStyle(document.getElementById('row-url')).display !== 'none'"
  );
  check("champs adresse/chemin masqués selon le type", hiddenWhenWeb);

  /* ── 3. Icône d'outil ──────────────────────────────────────────────────── */
  step("affectation d'icône");
  await setField("f-category", "Services");
  await clickData("data-icon", "book");
  await wait(300);
  wiki = await getApp("wikipedia");
  check("icône affectée", !!wiki && wiki.icon === "book", wiki && String(wiki.icon));
  check("catégorie changée", !!wiki && wiki.category === "Services");

  const markShowsIcon = await js(
    "!!document.querySelector('#app-list [aria-selected=\"true\"] svg')"
  );
  check("icône rendue dans la liste", markShowsIcon);

  await clickData("data-icon", "");
  await wait(250);
  wiki = await getApp("wikipedia");
  check("icône retirée", !!wiki && wiki.icon === null, wiki && String(wiki.icon));

  /* ── 4. Catégories ─────────────────────────────────────────────────────── */
  step("catégories");
  await click('[data-tab="categories"]');
  await wait(200);
  await click('[data-act="cat-add"]');
  await wait(250);
  await setField("c-name", "Vie scolaire");
  await wait(600);
  m = await model();
  check("catégorie créée", m.categories.indexOf("Vie scolaire") >= 0, m.categories.join(", "));
  check("catégorie paramétrée par défaut", !!m.meta["Vie scolaire"]);
  await shot("02-categories");

  // Ranger un outil dedans, puis renommer : il doit suivre.
  await click('[data-tab="apps"]');
  await wait(200);
  await clickData("data-app", "wikipedia");
  await wait(250);
  await setField("f-category", "Vie scolaire");
  await wait(300);
  await click('[data-tab="categories"]');
  await wait(200);
  await clickData("data-cat", "Vie scolaire");
  await wait(250);
  await setField("c-name", "Vie de l'élève");
  await wait(700);

  m = await model();
  check("catégorie renommée", m.categories.indexOf("Vie de l'élève") >= 0, m.categories.join(", "));
  check("ancien nom retiré", m.categories.indexOf("Vie scolaire") < 0);
  check("métadonnées suivies", !!m.meta["Vie de l'élève"] && !m.meta["Vie scolaire"]);
  wiki = m.apps.find((a) => a.id === "wikipedia");
  check("outil rattaché au nouveau nom", !!wiki && wiki.category === "Vie de l'élève",
    wiki && wiki.category);

  // Couleur de catégorie, contrôlée aussi par le rendu de l'aperçu.
  await setField("c-color-text", "#b91c1c");
  await wait(500);
  m = await model();
  check("couleur de catégorie appliquée", m.meta["Vie de l'élève"].color === "#b91c1c",
    m.meta["Vie de l'élève"] && m.meta["Vie de l'élève"].color);
  const previewColor = await js(
    "(()=>{const e=document.querySelector('#c-preview .sample');" +
    "return e?getComputedStyle(e).getPropertyValue('--cat-color').trim():'';})()"
  );
  check("aperçu de couleur rendu", previewColor === "#b91c1c", previewColor);

  /* ── 5. Logo officiel ──────────────────────────────────────────────────── */
  step("logo officiel");
  // Le choix de fichier passe par une boîte de dialogue, non automatisable :
  // on vérifie ici toute la chaîne de traitement (lecture, réduction par la
  // couche native, encodage, acceptation par la validation partagée).
  const { safeLogo } = require("../lib/catalog");
  const base64 = await js(
    "(()=>{const c=document.createElement('canvas');c.width=600;c.height=400;" +
    "const x=c.getContext('2d');x.fillStyle='#0b6b3a';x.fillRect(0,0,600,400);" +
    "x.fillStyle='#ffffff';x.font='bold 200px sans-serif';x.fillText('SE',140,280);" +
    "return c.toDataURL('image/png').split(',')[1];})()"
  );
  const source = nativeImage.createFromBuffer(Buffer.from(base64, "base64"));
  const reduced = source.resize({ height: 128, quality: "best" }).toDataURL();
  check("logo source lu", source.getSize().width === 600, JSON.stringify(source.getSize()));
  check("logo réduit à 128 px", nativeImage.createFromDataURL(reduced).getSize().height === 128);
  check("logo accepté par la validation", !!safeLogo(reduced), reduced.length + " caractères");
  check("logo trop lourd refusé", safeLogo("data:image/png;base64," + "A".repeat(300000)) === null);
  check("type d'image refusé", safeLogo("data:text/html;base64,PHNjcmlwdD4=") === null);
  check("logo conservé par la normalisation",
    !!safeLogo(require("../lib/catalog").normalizeCatalog(
      Object.assign({}, JSON.parse(fs.readFileSync(CATALOG, "utf-8")), { logo: reduced })
    ).logo));

  // Rendu réel : on publie un catalogue contenant le logo, puis on le recharge
  // par le chemin normal de l'outil.
  const withLogo = JSON.parse(await js("JSON.stringify(window.__adminState.catalog)"));
  withLogo.logo = reduced;
  fs.writeFileSync(path.join(SHARE, "apps.json"), JSON.stringify(withLogo, null, 2), "utf-8");
  await click('[data-tab="establishment"]');
  await wait(200);
  await click('[data-act="share-load"]');
  await wait(900);
  check("aperçu du logo rendu", await js("!!document.querySelector('#logo-preview img')"));
  check("logo dans la barre latérale", await js("!!document.querySelector('#brand-mark img')"));
  // Charger le catalogue publié ne doit pas détourner la cible
  // d'enregistrement : seul « Publier » écrit sur le partage, avec incrément
  // de version. Sinon on diffuserait sans que les postes se mettent à jour.
  check("cible d'enregistrement inchangée après chargement du partage",
    await js("window.__adminState.filePath") === CATALOG,
    await js("window.__adminState.filePath"));
  await shot("03-etablissement");

  /* ── 6. Enregistrement ─────────────────────────────────────────────────── */
  step("enregistrement");
  await click('[data-act="save"]');
  await wait(800);
  let onDisk = null;
  try {
    onDisk = JSON.parse(fs.readFileSync(CATALOG, "utf-8"));
  } catch (error) {
    onDisk = null;
  }
  check("fichier écrit", !!onDisk);
  check("outil ajouté sur le disque", !!onDisk && onDisk.apps.some((a) => a.id === "wikipedia"));
  check("catégorie renommée sur le disque",
    !!onDisk && onDisk.categories.indexOf("Vie de l'élève") >= 0);
  check("couleur sur le disque",
    !!onDisk && onDisk.categoryMeta["Vie de l'élève"].color === "#b91c1c");
  check("logo écrit sur le disque",
    !!onDisk && typeof onDisk.logo === "string" && onDisk.logo.startsWith("data:image/png"));
  check("aucun fichier temporaire résiduel", !fs.existsSync(CATALOG + ".tmp"));

  /* ── 7. Publication ────────────────────────────────────────────────────── */
  step("publication");
  const versionBefore = onDisk.version;
  await click('[data-act="publish"]');
  await wait(1000);
  let published = null;
  try {
    published = JSON.parse(fs.readFileSync(path.join(SHARE, "apps.json"), "utf-8"));
  } catch (error) {
    published = null;
  }
  check("catalogue publié sur le partage", !!published);
  check("version incrémentée", !!published && published.version !== versionBefore,
    versionBefore + " -> " + (published && published.version));
  check("date de mise à jour écrite",
    !!published && /^\d{4}-\d{2}-\d{2}$/.test(published.lastUpdated),
    published && published.lastUpdated);
  check("outils conservés", !!published && published.apps.length === 24,
    published && String(published.apps.length));
  check("aucun fichier temporaire sur le partage", !fs.existsSync(path.join(SHARE, "apps.json.tmp")));
  const shown = await js("document.getElementById('e-version').value");
  check("version affichée après publication", shown === (published && published.version), shown);

  /* ── 8. Refus d'un catalogue invalide ──────────────────────────────────── */
  step("refus d'un catalogue invalide");
  await click('[data-tab="apps"]');
  await wait(200);
  await clickData("data-app", "wikipedia");
  await wait(250);
  await setField("f-url", "javascript:alert(1)");
  await wait(1200);

  const status = await js("document.getElementById('st-state').textContent");
  check("adresse invalide signalée", /problème/i.test(status), status);
  check("outil fautif marqué dans la liste", await js("!!document.querySelector('.admin-item-flag')"));

  const refused = await js(
    "window.admin.publish(window.__adminState.catalog).then(r=>({ok:r.ok,problems:r.problems,badIds:r.badIds}))"
  );
  check("publication refusée", !!refused && refused.ok === false, JSON.stringify(refused));
  check("outil fautif nommé",
    !!refused && refused.badIds.indexOf("wikipedia") >= 0,
    JSON.stringify(refused && refused.badIds));
  check("catalogue publié inchangé après refus",
    JSON.parse(fs.readFileSync(path.join(SHARE, "apps.json"), "utf-8")).version ===
      (published && published.version));
  await shot("04-invalide");

  // Doublon d'identifiant : autre règle, autre message.
  const dup = await js(
    "(()=>{const c=JSON.parse(JSON.stringify(window.__adminState.catalog));" +
    "c.apps.push(Object.assign({},c.apps.find(a=>a.id==='prim-a')));" +
    "return window.admin.validate(c).then(r=>({ok:r.ok,n:r.problems.length}));})()"
  );
  check("identifiant en double refusé", !!dup && dup.ok === false, JSON.stringify(dup));

  // Correction, puis suppression.
  await setField("f-url", "https://fr.wikipedia.org");
  await wait(1200);
  const fixed = await js(
    "window.admin.validate(window.__adminState.catalog).then(r=>({ok:r.ok,problems:r.problems}))"
  );
  check("catalogue de nouveau valide", !!fixed && fixed.ok === true,
    JSON.stringify(fixed && fixed.problems));

  // La confirmation est simulée : l'expression doit renvoyer une valeur
  // sérialisable, sinon le pont IPC refuse de transmettre une fonction.
  await js("(()=>{window.confirm=()=>true;return 'ok';})()");
  await click('[data-act="app-delete"]');
  await wait(600);
  m = await model();
  check("outil supprimé", !m.apps.some((a) => a.id === "wikipedia"));
  check("compte d'outils revenu à 23", m.apps.length === 23, String(m.apps.length));

  /* ── 9. Silence de la console ──────────────────────────────────────────── */
  check("aucune erreur JavaScript", consoleErrors.length === 0, consoleErrors.join(" | "));
}

/* ─── Exécution ──────────────────────────────────────────────────────────── */

app.whenReady().then(async () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) {
    console.error("Fenêtre d'administration introuvable.");
    app.exit(1);
    return;
  }

  win.webContents.on("console-message", (...args) => {
    // Signature historique : (event, niveau, message, …) ; récente : (event, détails).
    const details = args[1];
    if (details && typeof details === "object") {
      if (details.level === "error") consoleErrors.push(details.message);
    } else if (typeof details === "number" && details >= 3) {
      consoleErrors.push(args[2]);
    }
  });

  try {
    if (win.webContents.isLoading()) {
      await new Promise((resolve) => win.webContents.once("did-finish-load", resolve));
    }
    await run(win);
  } catch (error) {
    failures += 1;
    results.push("  ÉCHEC  exception : " + (error && error.stack ? error.stack : error));
  }

  console.log("\n=== Auto-vérification de l'administration ===");
  results.forEach((line) => console.log(line));
  console.log(
    "\n" + (results.length - failures) + "/" + results.length + " vérifications réussies" +
    (failures ? "  —  " + failures + " ÉCHEC(S)" : "  —  tout est vert")
  );
  console.log("Captures : " + SHOTS);

  app.exit(failures ? 1 : 0);
});
