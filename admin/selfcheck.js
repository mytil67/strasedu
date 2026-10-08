/* ==========================================================================
   StrasEdu — auto-vérification de l'application d'administration
   --------------------------------------------------------------------------
   Pilote l'interface comme le ferait un administrateur, sur un catalogue
   temporaire, et vérifie chaque capacité demandée :

     • ajouter, modifier, supprimer un outil ;
     • lui affecter une icône, puis la retirer ;
     • lui poser une vignette et des captures d'écran, et respecter le plafond ;
     • créer une catégorie, la renommer, vérifier que les outils suivent ;
     • composer les mises en avant : groupes, ordre, outils retenus, plafonds,
       suppression des identifiants que les postes écarteraient ;
     • composer le carrousel du département : en-tête, informations, ordre,
       date, refus d'une adresse de lien qui n'est pas http(s) ;
     • définir le logo officiel ;
     • enregistrer, puis publier sur le partage avec incrément de version ;
     • peser le catalogue : avertissement avant l'enregistrement, refus de
       publication avant la limite au-delà de laquelle les postes l'écartent ;
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

process.env.STRASEDU_ADMIN_CATALOG = CATALOG;
process.env.STRASEDU_ADMIN_SHARE = SHARE;

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
  await click('[data-tab="application"]');
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
  await shot("03-application");

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

  /* ── 9. Couleur propre à l'administration ──────────────────────────────── */
  step("couleur d'accent");
  // Les règles de admin.css doivent l'emporter sur celles de app.css dans les
  // deux thèmes : c'est un raisonnement de cascade, donc à vérifier.
  const accents = await js(
    "(()=>{const r=document.documentElement;const before=r.getAttribute('data-theme');" +
    "const read=()=>getComputedStyle(r).getPropertyValue('--accent').trim();" +
    "r.setAttribute('data-theme','light');const light=read();" +
    "r.setAttribute('data-theme','dark');const dark=read();" +
    "r.setAttribute('data-theme',before);return {light:light,dark:dark};})()"
  );
  check("accent violet en thème clair", accents.light === "#7c3aed", accents.light);
  check("accent violet clair en thème sombre", accents.dark === "#a78bfa", accents.dark);
  check("accent distinct du vert des enseignants",
    accents.light !== "#0f9d63" && accents.dark !== "#0f9d63",
    accents.light + " / " + accents.dark);

  /* ── 10. Visuels d'un outil ────────────────────────────────────────────── */
  step("visuels d'un outil");
  // Les images viennent normalement d'un sélecteur de fichier natif, qu'un
  // automate ne peut pas piloter : on fabrique ici ce que la couche native
  // rendrait (un data URI réduit), puis on écrit dans l'état et on redemande
  // le rendu, comme le ferait le dialogue.
  const makeImage = (w, h, color, label) =>
    js(
      "(()=>{const c=document.createElement('canvas');c.width=" + w + ";c.height=" + h + ";" +
      "const x=c.getContext('2d');x.fillStyle=" + JSON.stringify(color) + ";" +
      "x.fillRect(0,0," + w + "," + h + ");x.fillStyle='#ffffff';" +
      "x.font='bold " + Math.round(h / 3) + "px sans-serif';" +
      "x.fillText(" + JSON.stringify(label) + ",20," + Math.round(h * 0.62) + ");" +
      "return c.toDataURL('image/png');})()"
    );

  const thumb = await makeImage(320, 200, "#2563eb", "OUTIL");
  const shots = await js(
    "(()=>{const out=[];const colors=['#0f766e','#b45309','#7c3aed','#be123c'];" +
    "for(let i=0;i<4;i++){const c=document.createElement('canvas');c.width=320;c.height=200;" +
    "const x=c.getContext('2d');x.fillStyle=colors[i];x.fillRect(0,0,320,200);" +
    "x.fillStyle='#ffffff';x.font='bold 90px sans-serif';x.fillText(String(i+1),130,140);" +
    "out.push(c.toDataURL('image/png'));}return out;})()"
  );
  check("images de travail encodées", thumb.indexOf("data:image/png;base64,") === 0 &&
    shots.length === 4 && shots[0].indexOf("data:image/") === 0);

  // Le dialogue de choix de fichier n'est pas automatisable — comme pour le
  // logo — mais tout ce qu'il fait après le choix l'est : réduction à la
  // hauteur demandée, puis acceptation par la validation partagée.
  const { safeImage, MAX_IMAGE_CHARS } = require("../lib/catalog");
  const bigImage = source.resize({ height: 320, quality: "best" }).toDataURL();
  check("vignette réduite à 320 px",
    nativeImage.createFromDataURL(bigImage).getSize().height === 320);
  check("vignette acceptée par la validation partagée", !!safeImage(bigImage, MAX_IMAGE_CHARS),
    bigImage.length + " caractères");
  check("bandeau réduit à 200 px accepté",
    !!safeImage(source.resize({ height: 200, quality: "best" }).toDataURL(), MAX_IMAGE_CHARS));
  check("visuel au-delà du plafond refusé",
    safeImage("data:image/png;base64," + "A".repeat(600000), MAX_IMAGE_CHARS) === null);

  const visualApp = await js(
    "(()=>{const s=window.__adminState;const app=s.catalog.apps.find(a=>a.id===s.appId);" +
    "app.image=" + JSON.stringify(thumb) + ";window.__adminRefresh();return app.id;})()"
  );
  check("vignette posée sur l'outil sélectionné", !!visualApp, String(visualApp));
  check("vignette rendue dans la liste des outils",
    await js("!!document.querySelector('#app-list [aria-selected=\"true\"] .admin-item-mark img')"));
  check("vignette rendue dans l'aperçu du formulaire",
    await js("!!document.querySelector('#app-image-preview img')"));

  await click('[data-act="app-image-clear"]');
  await wait(250);
  check("vignette retirée de l'outil",
    (await js("!!window.__adminState.catalog.apps.find(" +
      "a=>a.id===window.__adminState.appId).image")) === false);
  // Reposée aussitôt : la publication doit la retrouver intacte.
  await js(
    "(()=>{const s=window.__adminState;const app=s.catalog.apps.find(a=>a.id===s.appId);" +
    "app.image=" + JSON.stringify(thumb) + ";window.__adminRefresh();return 'ok';})()"
  );
  check("vignette reposée sur l'outil",
    await js("!!document.querySelector('#app-image-preview img')"));

  await js(
    "(()=>{const s=window.__adminState;const app=s.catalog.apps.find(a=>a.id===s.appId);" +
    "app.screenshots=" + JSON.stringify(shots) + ";window.__adminRefresh();return 'ok';})()"
  );
  check("quatre captures affichées",
    (await js("document.querySelectorAll('#app-shots .shot-thumb img').length")) === 4);
  check("ajout de capture désactivé au plafond",
    (await js("document.getElementById('app-shot-add').disabled")) === true);

  // Un bouton désactivé n'émet aucun clic : le sélecteur natif ne s'ouvre donc
  // pas, et le plafond reste tenu.
  await click('[data-act="shot-add"]');
  await wait(250);
  check("plafond de 4 captures respecté",
    (await js("window.__adminState.catalog.apps.find(" +
      "a=>a.id===window.__adminState.appId).screenshots.length")) === 4);

  await click('#app-shots [data-act="shot-remove"]');
  await wait(250);
  check("capture retirée",
    (await js("window.__adminState.catalog.apps.find(" +
      "a=>a.id===window.__adminState.appId).screenshots.length")) === 3);
  check("ajout de capture de nouveau possible",
    (await js("document.getElementById('app-shot-add').disabled")) === false);
  // Le bloc « Visuels » est bas dans le formulaire : on l'amène à l'écran pour
  // que la capture le montre.
  await js("(()=>{const f=document.getElementById('app-image-preview')" +
    ".closest('.admin-form');f.scrollTop=f.scrollHeight;return f.scrollTop;})()");
  await shot("06-visuels");

  /* ── 11. Département : informations du carrousel ───────────────────────── */
  step("département");
  const newsModel = () =>
    js(
      "(()=>{const s=window.__adminState;const n=s.catalog.news;" +
      "return {title:(n&&n.title)||'',subtitle:(n&&n.subtitle)||'',index:s.newsIndex," +
      "items:((n&&Array.isArray(n.items))?n.items:[]).map(i=>({id:i.id,title:i.title," +
      "text:i.text,date:i.date||null,url:i.url||null,linkLabel:i.linkLabel||null," +
      "image:!!i.image}))};})()"
    );

  await click('[data-tab="department"]');
  await wait(250);
  check("onglet Département ouvert",
    (await js("document.querySelector('[data-panel=\"department\"]').hidden")) === false);
  check("onglet Département marqué actif",
    (await js("document.querySelector('[data-tab=\"department\"]').getAttribute('aria-pressed')")) ===
      "true");
  check("panneau des outils refermé",
    (await js("document.querySelector('[data-panel=\"apps\"]').hidden")) === true);

  // Le catalogue livré porte déjà un carrousel : l'outil doit l'afficher tel
  // quel, et les vérifications suivantes se mesurent par rapport à lui, sans
  // supposer qu'il soit vide.
  const shipped = await newsModel();
  check("carrousel livré lu et affiché",
    shipped.items.length >= 1 &&
      (await js("document.querySelectorAll('#news-list .news-item').length")) ===
        shipped.items.length,
    shipped.items.length + " informations");
  check("en-tête du carrousel livré affiché",
    (await js("document.getElementById('d-title').value")) === shipped.title, shipped.title);

  const base = shipped.items.length;
  await setField("d-title", "Informations du département");
  await setField("d-subtitle", "Maintenance et ENT");
  await click('[data-act="news-add"]');
  await wait(300);
  let news = await newsModel();
  check("information ajoutée", news.items.length === base + 1,
    news.items.length + " (avant : " + base + ")");
  check("information ajoutée sélectionnée", news.index === base, String(news.index));
  check("en-tête du carrousel écrit", news.title === "Informations du département", news.title);
  check("sous-titre du carrousel écrit", news.subtitle === "Maintenance et ENT", news.subtitle);
  check("identifiant d'information généré", /^info-/.test(news.items[base].id),
    news.items[base].id);

  await setField("n-title", "Coupure de courant jeudi");
  await setField("n-text", "Le bâtiment B sera hors tension de 8 h à 12 h.");
  await wait(300);
  news = await newsModel();
  check("titre de l'information écrit", news.items[news.index].title === "Coupure de courant jeudi",
    news.items[news.index].title);
  check("texte de l'information écrit",
    news.items[news.index].text === "Le bâtiment B sera hors tension de 8 h à 12 h.",
    news.items[news.index].text);

  const counters = await js(
    "(()=>({titre:document.getElementById('n-title-count').textContent," +
    "long:document.getElementById('n-title').value.length," +
    "texte:document.getElementById('n-text-count').textContent}))()"
  );
  check("compteur du titre à jour", counters.titre === counters.long + " / 120",
    JSON.stringify(counters));

  // Adresse refusée : elle serait écartée en silence par la validation du
  // catalogue, donc l'outil doit la repousser et l'expliquer.
  await setField("n-url", "javascript:alert(1)");
  await wait(250);
  news = await newsModel();
  check("lien non http(s) refusé", news.items[news.index].url === null,
    JSON.stringify(news.items[news.index]));
  check("refus du lien expliqué",
    /http/i.test(await js("document.getElementById('n-url-note').textContent")));
  check("champ du lien marqué invalide",
    (await js("document.getElementById('n-url').getAttribute('aria-invalid')")) === "true");
  check("libellé de lien inutilisable sans lien",
    (await js("document.getElementById('n-link-label').disabled")) === true);

  await setField("n-url", "https://www.strasbourg.fr/info");
  await setField("n-link-label", "Consulter l'annonce");
  await wait(300);
  news = await newsModel();
  check("lien http(s) enregistré", news.items[news.index].url === "https://www.strasbourg.fr/info",
    String(news.items[news.index].url));
  check("libellé de lien enregistré", news.items[news.index].linkLabel === "Consulter l'annonce",
    String(news.items[news.index].linkLabel));
  check("libellé de lien activé",
    (await js("document.getElementById('n-link-label').disabled")) === false);

  const banner = await makeImage(320, 180, "#0ea5a5", "INFO");
  await js(
    "(()=>{const s=window.__adminState;" +
    "s.catalog.news.items[s.newsIndex].image=" + JSON.stringify(banner) + ";" +
    "window.__adminRefresh();return 'ok';})()"
  );
  check("bandeau rendu dans le formulaire",
    await js("!!document.querySelector('#n-image-preview img')"));
  check("vignette rendue dans la liste des informations",
    await js("!!document.querySelector('#news-list .news-thumb img')"));
  await shot("05-departement");

  // Deuxième information, puis réordonnancement : le carrousel suit l'ordre.
  const added = news.index;
  await click('[data-act="news-add"]');
  await wait(250);
  await setField("n-title", "Nouvelle version de l'ENT");
  await wait(250);
  check("deux informations ajoutées",
    (await js("window.__adminState.catalog.news.items.length")) === base + 2);
  await click('[data-news-index="' + (added + 1) + '"] [data-act="news-up"]');
  await wait(300);
  news = await newsModel();
  check("information remontée", news.items[added].title === "Nouvelle version de l'ENT",
    news.items[added].title);
  check("sélection suivie par l'index", news.index === added, String(news.index));

  // La corbeille d'une ligne vise cette ligne, celle du formulaire vise la
  // sélection : les deux chemins sont éprouvés ici. Après le déplacement,
  // « Nouvelle version de l'ENT » occupe la ligne « added ».
  await click('[data-news-index="' + added + '"] [data-act="news-delete"]');
  await wait(300);
  news = await newsModel();
  check("information supprimée", news.items.length === base + 1,
    news.items.length + " (avant : " + (base + 2) + ")");
  check("information restante intacte", news.items[added].title === "Coupure de courant jeudi",
    news.items[added].title);

  await click('#news-form [data-act="news-delete"]');
  await wait(300);
  news = await newsModel();
  check("carrousel livré préservé par les suppressions", news.items.length === base,
    news.items.length + " (attendu " + base + ")");
  check("suppression de la dernière information retirée",
    news.items.every((item) => item.title !== "Coupure de courant jeudi"));

  /* ── 12. Plafond des informations ──────────────────────────────────────── */
  step("plafond des informations");
  const newsCap = await js(
    "(()=>{const s=window.__adminState;const items=[];" +
    "for(let i=0;i<12;i++)items.push({id:'info-'+i,title:'Information '+(i+1),text:'Texte '+(i+1)});" +
    "s.catalog.news=Object.assign({},s.catalog.news,{items:items});s.newsIndex=0;" +
    "window.__adminRefresh();" +
    "return document.getElementById('news-add').disabled;})()"
  );
  check("ajout d'information désactivé à 12", newsCap === true, String(newsCap));
  await click('[data-act="news-add"]');
  await wait(250);
  check("plafond de 12 informations respecté",
    (await js("window.__adminState.catalog.news.items.length")) === 12);

  /* ── 13. Publication des nouveautés ────────────────────────────────────── */
  step("publication des nouveautés");
  await js(
    "(()=>{const s=window.__adminState;const app=s.catalog.apps.find(a=>a.id===s.appId);" +
    "s.catalog.highlights=[{label:'Du moment',appIds:[app.id]}];" +
    "window.__adminRefresh();return 'ok';})()"
  );
  const noveltyCheck = await js(
    "window.admin.validate(window.__adminState.catalog).then(r=>({ok:r.ok,problems:r.problems}))"
  );
  check("catalogue avec nouveautés valide", !!noveltyCheck && noveltyCheck.ok === true,
    JSON.stringify(noveltyCheck && noveltyCheck.problems));

  const republished = await js(
    "window.admin.publish(window.__adminState.catalog).then(" +
    "r=>({ok:r.ok,version:r.version,problems:r.problems}))"
  );
  check("publication des nouveautés acceptée", !!republished && republished.ok === true,
    JSON.stringify(republished && republished.problems));

  const { normalizeCatalog, MAX_NEWS_ITEMS, MAX_SCREENSHOTS } = require("../lib/catalog");
  const rawPublished = JSON.parse(fs.readFileSync(path.join(SHARE, "apps.json"), "utf-8"));
  check("carrousel écrit sur le partage",
    !!rawPublished.news && rawPublished.news.items.length === 12,
    rawPublished.news && String(rawPublished.news.items.length));
  check("plafonds du modèle respectés à l'écriture",
    rawPublished.news.items.length <= MAX_NEWS_ITEMS &&
      rawPublished.apps.every((a) => !Array.isArray(a.screenshots) ||
        a.screenshots.length <= MAX_SCREENSHOTS));

  const normalized = normalizeCatalog(rawPublished);
  check("carrousel conservé par la normalisation",
    !!normalized.news && normalized.news.items.length === 12,
    normalized.news && String(normalized.news.items.length));
  check("en-tête du carrousel conservé",
    !!normalized.news && normalized.news.title === "Informations du département");
  check("mises en avant conservées",
    Array.isArray(normalized.highlights) && normalized.highlights.length === 1 &&
      normalized.highlights[0].appIds.length === 1,
    JSON.stringify(normalized.highlights));
  const shownApp = normalized.apps.find((a) => a.id === visualApp);
  check("vignette d'outil conservée",
    !!shownApp && shownApp.image === thumb, shownApp && String(shownApp.image).slice(0, 32));
  check("captures d'écran conservées",
    !!shownApp && Array.isArray(shownApp.screenshots) && shownApp.screenshots.length === 3,
    shownApp && String((shownApp.screenshots || []).length));
  check("outils toujours présents après normalisation",
    normalized.apps.length === rawPublished.apps.length,
    normalized.apps.length + " / " + rawPublished.apps.length);

  /* ── 14. Mise en avant ─────────────────────────────────────────────────── */
  step("mise en avant");
  const highModel = () =>
    js(
      "(()=>{const s=window.__adminState;const h=Array.isArray(s.catalog.highlights)" +
      "?s.catalog.highlights:null;return {present:!!h,index:s.highIndex," +
      "groups:(h||[]).map(g=>({label:g.label,appIds:(g.appIds||[]).slice()}))," +
      "ids:s.catalog.apps.map(a=>a.id)};})()"
    );

  await click('[data-tab="highlights"]');
  await wait(250);
  check("onglet Mise en avant ouvert",
    (await js("document.querySelector('[data-panel=\"highlights\"]').hidden")) === false);
  check("onglet Mise en avant marqué actif",
    (await js("document.querySelector('[data-tab=\"highlights\"]').getAttribute('aria-pressed')")) ===
      "true");
  check("panneau du département refermé",
    (await js("document.querySelector('[data-panel=\"department\"]').hidden")) === true);

  // Le catalogue porte déjà des mises en avant : elles doivent s'afficher
  // telles quelles, et le reste du scénario se mesure par rapport à elles.
  let high = await highModel();
  const shippedGroups = high.groups.length;
  check("mises en avant du catalogue lues et affichées",
    high.present && shippedGroups >= 1 &&
      (await js("document.querySelectorAll('#high-list .admin-item').length")) === shippedGroups,
    JSON.stringify(high.groups));

  // Un catalogue sans mise en avant ne doit pas en gagner une par simple
  // enregistrement : c'est le cas des catalogues 1.x.
  await js("(()=>{delete window.__adminState.catalog.highlights;" +
    "window.__adminRefresh();return 'ok';})()");
  check("catalogue sans mise en avant accepté",
    (await js("document.querySelectorAll('#high-list .admin-item').length")) === 0);
  await click('[data-act="save"]');
  await wait(900);
  const withoutHighlights = JSON.parse(fs.readFileSync(CATALOG, "utf-8"));
  check("mise en avant absente non créée par l'enregistrement",
    !Object.prototype.hasOwnProperty.call(withoutHighlights, "highlights"),
    JSON.stringify(withoutHighlights.highlights));

  // Ajout d'un groupe, puis renommage.
  await click('[data-act="high-add"]');
  await wait(300);
  high = await highModel();
  check("mise en avant ajoutée", high.groups.length === 1, JSON.stringify(high.groups));
  check("groupe ajouté sélectionné", high.index === 0, String(high.index));
  check("libellé par défaut du groupe", high.groups[0].label === "À la une", high.groups[0].label);
  check("groupe sans outil signalé",
    await js("!!document.querySelector('#high-list .admin-item-warn')"));
  check("une case à cocher par outil",
    (await js("document.querySelectorAll('#h-choices input[data-pick]').length")) === high.ids.length,
    String(high.ids.length));

  await setField("h-label", "Du moment");
  await wait(250);
  high = await highModel();
  check("libellé écrit", high.groups[0].label === "Du moment", high.groups[0].label);
  const labelCounts = await js(
    "(()=>({compte:document.getElementById('h-label-count').textContent," +
    "long:document.getElementById('h-label').value.length}))()"
  );
  check("compteur du libellé à jour", labelCounts.compte === labelCounts.long + " / 60",
    JSON.stringify(labelCounts));
  check("libellé repris dans la liste",
    (await js("document.querySelector('#high-list .admin-item-name').textContent")) === "Du moment");

  // Cases à cocher : l'ordre de sélection est l'ordre d'affichage.
  const picks = high.ids.slice(0, 3);
  const boxOf = (id) => '#h-choices input[data-pick="' + id + '"]';
  for (const id of picks) {
    await click(boxOf(id));
    await wait(180);
  }
  high = await highModel();
  check("outils cochés dans l'ordre de sélection",
    JSON.stringify(high.groups[0].appIds) === JSON.stringify(picks),
    JSON.stringify(high.groups[0].appIds));
  check("numéros d'ordre affichés",
    (await js("[...document.querySelectorAll('#h-choices .pick-order')]" +
      ".map(n=>n.textContent).join(',')")) === "1,2,3");
  check("bouton de retrait par outil retenu",
    (await js("document.querySelectorAll('#h-choices [data-act=\"high-drop\"]').length")) === 3);
  check("compte des outils retenus affiché",
    /^3 \/ 12/.test(await js("document.getElementById('h-note').textContent")),
    await js("document.getElementById('h-note').textContent"));
  await shot("07-mise-en-avant");

  await click(boxOf(picks[1]));
  await wait(250);
  high = await highModel();
  check("outil décoché retiré du groupe",
    JSON.stringify(high.groups[0].appIds) === JSON.stringify([picks[0], picks[2]]),
    JSON.stringify(high.groups[0].appIds));

  await click(boxOf(picks[1]));
  await wait(250);
  high = await highModel();
  check("outil recoché placé en fin d'ordre",
    JSON.stringify(high.groups[0].appIds) === JSON.stringify([picks[0], picks[2], picks[1]]),
    JSON.stringify(high.groups[0].appIds));

  await click('#h-choices [data-act="high-drop"][data-high-app="' + picks[0] + '"]');
  await wait(250);
  high = await highModel();
  check("bouton de retrait efficace",
    JSON.stringify(high.groups[0].appIds) === JSON.stringify([picks[2], picks[1]]),
    JSON.stringify(high.groups[0].appIds));

  // Filtre par nom : il ne doit masquer que la liste, jamais le champ.
  await setField("h-filter", picks[2]);
  await wait(250);
  const filtered = await js("document.querySelectorAll('#h-choices .pick-item').length");
  check("filtre du sélecteur d'outils", filtered >= 1 && filtered < high.ids.length,
    filtered + " / " + high.ids.length);
  await setField("h-filter", "");
  await wait(250);

  /* ── 15. Plafonds et nettoyage des mises en avant ──────────────────────── */
  step("plafonds des mises en avant");
  const capPicks = high.ids.slice(0, 12);
  await js(
    "(()=>{const s=window.__adminState;s.catalog.highlights[s.highIndex].appIds=" +
    JSON.stringify(capPicks) + ";window.__adminRefresh();return 'ok';})()"
  );
  const boxes = await js(
    "(()=>{const all=[...document.querySelectorAll('#h-choices input[data-pick]')];" +
    "return {total:all.length,disabled:all.filter(i=>i.disabled).length};})()"
  );
  check("cases non cochées désactivées au plafond de 12",
    boxes.disabled === boxes.total - 12, JSON.stringify(boxes));
  check("note de plafond affichée",
    /plafond atteint/i.test(await js("document.getElementById('h-note').textContent")),
    await js("document.getElementById('h-note').textContent"));

  // Une case désactivée n'émet aucun clic : le treizième outil ne peut pas
  // entrer, et rien n'est reconstruit.
  await click(boxOf(high.ids[12]));
  await wait(250);
  check("plafond de 12 outils respecté",
    (await highModel()).groups[0].appIds.length === 12,
    String((await highModel()).groups[0].appIds.length));

  while ((await highModel()).groups.length < 3) {
    await click('[data-act="high-add"]');
    await wait(250);
  }
  check("trois mises en avant", (await highModel()).groups.length === 3);
  check("ajout désactivé au plafond de 3",
    (await js("document.getElementById('high-add').disabled")) === true);
  await click('[data-act="high-add"]');
  await wait(250);
  check("plafond de 3 mises en avant respecté", (await highModel()).groups.length === 3);

  // Un identifiant inconnu introduit de force doit disparaître à
  // l'enregistrement : le poste ne doit jamais recevoir une mise en avant
  // pointant dans le vide.
  await js(
    "(()=>{const s=window.__adminState;" +
    "s.catalog.highlights[0].appIds.push('outil-fantome');" +
    "s.catalog.highlights[0].label='  Du moment  ';window.__adminRefresh();return 'ok';})()"
  );
  check("identifiant inconnu présent dans l'état avant enregistrement",
    (await highModel()).groups[0].appIds.indexOf("outil-fantome") >= 0);
  await click('[data-act="save"]');
  await wait(900);
  const savedHighlights = JSON.parse(fs.readFileSync(CATALOG, "utf-8"));
  check("identifiant inconnu retiré avant enregistrement",
    !!savedHighlights.highlights &&
      savedHighlights.highlights.every((g) => g.appIds.indexOf("outil-fantome") < 0),
    JSON.stringify(savedHighlights.highlights));
  check("identifiant inconnu retiré de l'état aussi",
    (await highModel()).groups[0].appIds.indexOf("outil-fantome") < 0);
  check("groupe sans outil écarté avant enregistrement",
    !!savedHighlights.highlights && savedHighlights.highlights.length === 1,
    savedHighlights.highlights && String(savedHighlights.highlights.length));
  check("libellé ramené à sa forme publiée",
    !!savedHighlights.highlights && savedHighlights.highlights[0].label === "Du moment",
    savedHighlights.highlights && savedHighlights.highlights[0].label);

  // Ordre des groupes : c'est l'ordre des cartes sur l'accueil.
  const twoGroups = await js(
    "(()=>{const s=window.__adminState;" +
    "s.catalog.highlights=[{label:'Du moment',appIds:['" + picks[2] + "']}," +
    "{label:'Du mois',appIds:['" + picks[1] + "']}];s.highIndex=1;window.__adminRefresh();" +
    "return s.catalog.highlights.map(g=>g.label);})()"
  );
  check("deux groupes en place", JSON.stringify(twoGroups) === '["Du moment","Du mois"]',
    JSON.stringify(twoGroups));
  await click('[data-high-index="1"] [data-act="high-up"]');
  await wait(300);
  high = await highModel();
  check("groupe remonté", high.groups[0].label === "Du mois", JSON.stringify(high.groups));
  check("sélection suivie par l'index", high.index === 0, String(high.index));
  await click('[data-high-index="0"] [data-act="high-down"]');
  await wait(300);
  check("groupe redescendu",
    JSON.stringify((await highModel()).groups.map((g) => g.label)) === '["Du moment","Du mois"]',
    JSON.stringify((await highModel()).groups));
  await click('[data-high-index="0"] [data-act="high-delete"]');
  await wait(300);
  high = await highModel();
  check("groupe supprimé", high.groups.length === 1 && high.groups[0].label === "Du mois",
    JSON.stringify(high.groups));
  await click('[data-high-index="0"] [data-act="high-delete"]');
  await wait(300);
  check("dernier groupe supprimé : liste oubliée",
    (await highModel()).present === false);
  check("liste des groupes vidée",
    (await js("document.querySelectorAll('#high-list .admin-item').length")) === 0);

  /* ── 16. Date d'une information ────────────────────────────────────────── */
  step("date d'une information");
  await click('[data-tab="department"]');
  await wait(250);
  // Le plafond de 12 informations a été atteint plus haut : on repart d'un
  // carrousel court pour pouvoir en ajouter une.
  await js("(()=>{const s=window.__adminState;" +
    "s.catalog.news.items=s.catalog.news.items.slice(0,3);" +
    "window.__adminRefresh();return 'ok';})()");
  await click('[data-act="news-add"]');
  await wait(300);
  await setField("n-title", "Tournoi de robots");
  await setField("d-date", "8 octobre 2026");
  await wait(300);
  let dated = await newsModel();
  const dateIndex = dated.index;
  check("date écrite dans l'information",
    dated.items[dateIndex].date === "8 octobre 2026", String(dated.items[dateIndex].date));
  const dateCounts = await js(
    "(()=>({compte:document.getElementById('d-date-count').textContent," +
    "long:document.getElementById('d-date').value.length}))()"
  );
  check("compteur de date à jour", dateCounts.compte === dateCounts.long + " / 32",
    JSON.stringify(dateCounts));

  await setField("d-date", "");
  await wait(250);
  dated = await newsModel();
  check("information sans date acceptée", dated.items[dateIndex].date === null,
    String(dated.items[dateIndex].date));

  await setField("d-date", "8 octobre 2026");
  await wait(250);
  await click('[data-act="save"]');
  await wait(900);
  const savedNews = JSON.parse(fs.readFileSync(CATALOG, "utf-8"));
  const savedDated = savedNews.news.items.find((item) => item.title === "Tournoi de robots");
  check("date enregistrée sur le disque",
    !!savedDated && savedDated.date === "8 octobre 2026",
    savedDated && String(savedDated.date));

  // Relecture par le chemin normal de l'outil : publier, puis recharger le
  // catalogue publié. Une mise en avant composée ici doit survivre aux deux.
  await js(
    "(()=>{const s=window.__adminState;" +
    "s.catalog.highlights=[{label:'Du moment',appIds:[" + JSON.stringify(picks[2]) + "]}];" +
    "window.__adminRefresh();return 'ok';})()"
  );
  await click('[data-tab="application"]');
  await wait(200);
  await click('[data-act="publish"]');
  await wait(1200);
  const publishedDated = JSON.parse(fs.readFileSync(path.join(SHARE, "apps.json"), "utf-8"));
  const reread = publishedDated.news.items.find((item) => item.title === "Tournoi de robots");
  check("date conservée à la publication",
    !!reread && reread.date === "8 octobre 2026", reread && String(reread.date));
  check("mise en avant conservée à la publication",
    Array.isArray(publishedDated.highlights) && publishedDated.highlights.length === 1 &&
      publishedDated.highlights[0].label === "Du moment",
    JSON.stringify(publishedDated.highlights));

  await click('[data-act="share-load"]');
  await wait(1200);
  const rereadIndex = await js(
    "(()=>{const s=window.__adminState;return s.catalog.news.items" +
    ".findIndex(i=>i.title==='Tournoi de robots');})()"
  );
  check("date relue dans le catalogue rechargé", rereadIndex >= 0 &&
    (await js("window.__adminState.catalog.news.items[" + rereadIndex + "].date")) ===
      "8 octobre 2026");
  await click('[data-news-index="' + rereadIndex + '"] [data-act="news-select"]');
  await wait(300);
  check("date affichée dans le formulaire après relecture",
    (await js("document.getElementById('d-date').value")) === "8 octobre 2026",
    await js("document.getElementById('d-date').value"));

  /* ── 17. Poids du catalogue : avertissement, puis refus de publication ─── */
  step("poids du catalogue");
  // Les postes refusent le catalogue ENTIER au-delà de MAX_CATALOG_BYTES : le
  // budget des visuels doit donc rester sous cette limite, et l'administrateur
  // doit être averti AVANT de diffuser un fichier que personne ne reprendrait.
  const { MAX_CATALOG_BYTES } = require("../lib/catalog");
  // Même seuil que MAX_PUBLISH_BYTES dans admin/main.js : la constante n'y est
  // pas exportée, on la recalcule ici pour viser franchement au-dessus.
  const publishLimitBytes = MAX_CATALOG_BYTES - 128 * 1024;
  // Même mise en forme que writeCatalogFile() : indentation de deux espaces, en
  // octets UTF-8, plus le saut de ligne final. Les seuils s'appliquent à cette
  // sérialisation-là, pas à l'objet en mémoire.
  const catalogBytes = () =>
    js(
      "(()=>{const c=window.__adminState.catalog;" +
      "return new TextEncoder().encode(JSON.stringify(c,null,2)).length+" +
      os.EOL.length + ";})()"
    );

  // Sous les seuils, rien ne doit changer : c'est le point de comparaison de
  // tout ce qui suit.
  const normalBytes = await catalogBytes();
  const normalCheck = await js(
    "window.admin.validate(window.__adminState.catalog).then(" +
    "r=>({ok:r.ok,warnings:r.warnings,problems:r.problems}))"
  );
  check("catalogue normal valide", !!normalCheck && normalCheck.ok === true,
    JSON.stringify(normalCheck && normalCheck.problems));
  check("catalogue normal : aucun avertissement de poids",
    !!normalCheck && (normalCheck.warnings || []).every((w) => !/pèse/.test(w)),
    JSON.stringify(normalCheck && normalCheck.warnings));

  // Le catalogue en mémoire est gonflé par un visuel factice, comme le ferait
  // une vignette trop lourde. Le plafond d'un visuel le fait écarter des
  // images — l'outil reste valide — mais le fichier sérialisé, lui, dépasse
  // largement les deux seuils : c'est bien la taille qui est éprouvée ici, pas
  // la validité des champs. La vignette déjà posée est mémorisée pour être
  // remise en place au nettoyage.
  const FAKE_PREFIX = "data:image/png;base64,";
  const fakeImageChars = MAX_CATALOG_BYTES + 256 * 1024;
  const savedImage = await js(
    "(()=>{const s=window.__adminState;const a=s.catalog.apps.find(x=>x.id===s.appId);" +
    "return a&&typeof a.image==='string'?a.image:null;})()"
  );
  const heavyApp = await js(
    "(()=>{const s=window.__adminState;const a=s.catalog.apps.find(x=>x.id===s.appId);" +
    "if(!a)return null;" +
    "a.image=" + JSON.stringify(FAKE_PREFIX) + "+'A'.repeat(" + fakeImageChars + ");" +
    "window.__adminRefresh();return a.id;})()"
  );
  const heavyBytes = await catalogBytes();
  // Tracé dans le journal : le poids observé est la preuve chiffrée du contrôle.
  console.log("    poids gonflé : " + Math.round(heavyBytes / 1024) + " Ko (seuil de publication " +
    Math.round(publishLimitBytes / 1024) + " Ko, avant gonflage " +
    Math.round(normalBytes / 1024) + " Ko)");
  check("catalogue gonflé au-delà du seuil de publication",
    !!heavyApp && heavyBytes > publishLimitBytes,
    heavyApp + " — " + heavyBytes + " octets (seuil de publication " +
      publishLimitBytes + ", avant gonflage " + normalBytes + ")");

  const heavyCheck = await js(
    "window.admin.validate(window.__adminState.catalog).then(" +
    "r=>({ok:r.ok,warnings:r.warnings,problems:r.problems}))"
  );
  // Un enregistrement local reste possible : perdre le travail en cours serait
  // pire que le mal, seul le poids est signalé.
  check("catalogue trop lourd encore acceptable en local",
    !!heavyCheck && heavyCheck.ok === true,
    JSON.stringify(heavyCheck && heavyCheck.problems));
  const heavyWarnings = (heavyCheck && heavyCheck.warnings) || [];
  check("avertissement de poids produit",
    heavyWarnings.some((w) => /pèse/.test(w) && /Ko/.test(w)),
    JSON.stringify(heavyWarnings));

  // La pastille d'état ne dit que « 1 avertissement(s) » : le détail doit être
  // lisible au survol. renderStatus() n'est rappelé qu'après une validation, et
  // le rafraîchissement seul ne recalcule pas l'état : on redemande donc la
  // vérification par le chemin normal du formulaire — une saisie identique
  // déclenche la vérification différée — avant de relire la pastille.
  await setField("e-version", await js("window.__adminState.catalog.version"));
  await wait(900);
  const heavyTitle = await js("document.getElementById('st-state').getAttribute('title')");
  console.log("    pastille d'état : " + JSON.stringify(
    String(heavyTitle).split("\n").find((line) => /pèse/.test(line)) || ""));
  check("détail du poids dans le titre de la pastille d'état",
    /pèse/.test(String(heavyTitle)) && /Ko/.test(String(heavyTitle)),
    String(heavyTitle).slice(0, 160));

  // Le partage d'essai doit rester intact : publier un catalogue que les postes
  // refuseraient ferait croire à une diffusion qui n'a pas eu lieu.
  const shareFile = path.join(SHARE, "apps.json");
  const beforeShare = fs.readFileSync(shareFile, "utf-8");
  const beforeShareStat = fs.statSync(shareFile);
  const beforeShareCatalog = JSON.parse(beforeShare);

  const refusedHeavy = await js(
    "window.admin.publish(window.__adminState.catalog).then(" +
    "r=>({ok:r.ok,problems:r.problems,warnings:r.warnings}))"
  );
  check("publication d'un catalogue trop lourd refusée",
    !!refusedHeavy && refusedHeavy.ok === false,
    JSON.stringify(refusedHeavy && refusedHeavy.problems));
  // Le message doit dire pourquoi, et nommer la limite des postes — en Ko comme
  // dans la constante, ou en Mo : sans elle, l'administrateur ne sait pas
  // jusqu'où alléger.
  const limitPattern = new RegExp(
    "(" + Math.round(MAX_CATALOG_BYTES / 1024) + "\\s*Ko|" +
    MAX_CATALOG_BYTES / (1024 * 1024) + "\\s*Mo)"
  );
  check("refus nommant la limite des postes",
    !!refusedHeavy && (refusedHeavy.problems || []).some(
      (p) => /pèse/.test(p) && limitPattern.test(p)),
    JSON.stringify(refusedHeavy && refusedHeavy.problems));

  const afterShare = fs.readFileSync(shareFile, "utf-8");
  const afterShareStat = fs.statSync(shareFile);
  const afterShareCatalog = JSON.parse(afterShare);
  check("fichier du partage non réécrit après refus", afterShare === beforeShare);
  check("version du partage inchangée",
    afterShareCatalog.version === beforeShareCatalog.version,
    beforeShareCatalog.version + " -> " + afterShareCatalog.version);
  check("date de mise à jour du partage inchangée",
    afterShareCatalog.lastUpdated === beforeShareCatalog.lastUpdated,
    beforeShareCatalog.lastUpdated + " -> " + afterShareCatalog.lastUpdated);
  check("fichier du partage non modifié sur le disque",
    afterShareStat.mtimeMs === beforeShareStat.mtimeMs,
    new Date(beforeShareStat.mtimeMs).toISOString() + " -> " +
      new Date(afterShareStat.mtimeMs).toISOString());
  check("aucun fichier temporaire sur le partage après refus",
    !fs.existsSync(shareFile + ".tmp"));

  // Nettoyage : le visuel factice disparaît, la vignette mémorisée est remise
  // en place, et les contrôles suivants retrouvent le catalogue normal.
  await js(
    "(()=>{const s=window.__adminState;const a=s.catalog.apps.find(x=>x.id===s.appId);" +
    (savedImage ? "a.image=" + JSON.stringify(savedImage) + ";" : "delete a.image;") +
    "window.__adminRefresh();return 'ok';})()"
  );
  const cleanedBytes = await catalogBytes();
  const stateImage = await js(
    "(()=>{const s=window.__adminState;const a=s.catalog.apps.find(x=>x.id===s.appId);" +
    "const len=a&&typeof a.image==='string'?a.image.length:0;" +
    "return {len:len,fake:len===" + (FAKE_PREFIX.length + fakeImageChars) + "};})()"
  );
  check("visuel factice retiré de l'outil", !!stateImage && stateImage.fake === false,
    JSON.stringify(stateImage));
  check("poids de l'état revenu au niveau initial", cleanedBytes === normalBytes,
    cleanedBytes + " octets (avant gonflage : " + normalBytes + ")");

  const cleanCheck = await js(
    "window.admin.validate(window.__adminState.catalog).then(" +
    "r=>({ok:r.ok,warnings:r.warnings,problems:r.problems}))"
  );
  check("catalogue normal retrouvé : valide",
    !!cleanCheck && cleanCheck.ok === true,
    JSON.stringify(cleanCheck && cleanCheck.problems));
  check("catalogue normal retrouvé : aucun avertissement de poids",
    !!cleanCheck && (cleanCheck.warnings || []).every((w) => !/pèse/.test(w)),
    JSON.stringify(cleanCheck && cleanCheck.warnings));

  // La pastille ne doit pas rester sur l'avertissement : l'état a repris son
  // poids normal.
  await setField("e-version", await js("window.__adminState.catalog.version"));
  await wait(900);
  const cleanTitle = await js("document.getElementById('st-state').getAttribute('title')");
  check("titre de la pastille d'état sans avertissement de poids",
    !/pèse/.test(String(cleanTitle)), String(cleanTitle).slice(0, 160));

  // Et la publication doit fonctionner comme avant : le refus ne visait que le
  // poids, il ne laisse aucune trace dans l'outil.
  const afterCleanup = await js(
    "window.admin.publish(window.__adminState.catalog).then(" +
    "r=>({ok:r.ok,version:r.version,problems:r.problems}))"
  );
  check("publication de nouveau acceptée sous les seuils",
    !!afterCleanup && afterCleanup.ok === true,
    JSON.stringify(afterCleanup && afterCleanup.problems));

  /* ── 18. Silence de la console ─────────────────────────────────────────── */
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
