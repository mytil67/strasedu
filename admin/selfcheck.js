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
     • enregistrer, puis publier : vers un dossier partagé (écriture atomique) et
     vers le service HTTPS du Raspberry (GET de l'ETag, PUT avec If-Match,
     certificat épinglé par empreinte, vérification par la lecture des postes) ;
     • refuser un dépôt en http — le jeton y serait en clair — et un dépôt sans
       empreinte de certificat, sans émettre la moindre requête ;
     • peser le catalogue : avertissement avant l'enregistrement, refus de
       publication avant la limite au-delà de laquelle les postes l'écartent ;
     • refuser un catalogue invalide en nommant l'outil fautif.

   Écrit aussi des captures d'écran dans .preview/admin/.

   Le bac d'essai est dans le projet (.selfcheck) : un dossier temporaire
   système peut être refusé en écriture selon la stratégie de sécurité du poste.

   Usage : npm run selfcheck:admin    (échec = code de sortie 1)
   ========================================================================== */

"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");

/* ─── Matériel de test ───────────────────────────────────────────────────── */

/**
 * Jeton de test, de la forme de ceux du service. Il est cherché explicitement,
 * à la fin, dans TOUTE la trace produite par le test : c'est la preuve qu'il
 * n'apparaît ni dans un journal, ni dans un message d'erreur, ni dans un détail
 * de contrôle.
 */
const SERVER_TOKEN = "sedu_jeton_de_test_3f9a1c7e";

/**
 * Certificat et clé auto-signés, jetables : « certificat de test, sans valeur ».
 * Ils servent uniquement à présenter à l'outil un certificat que Windows ne
 * reconnaît pas, afin d'éprouver l'épinglage par empreinte. L'empreinte
 * attendue est calculée à l'exécution depuis ce même certificat ; aucun
 * certificat réel n'entre dans ce fichier.
 */
const TLS_KEY = [
  "-----BEGIN PRIVATE KEY-----",
  "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDXCITQ2Auys0UG",
  "bDBzRriqwC0YqBTK3bvabPSbXQ1ZOCabtt0Tczd3ipvns63ku6lo1RX3/Q50XzMY",
  "1mw0mdx5JV1x1PYMM0Mmo2VW0+nPdfrMTXavm//83G2aYABkFNcVBbpqMUomCwD7",
  "K5WBlsqt4NgfXz3AB5GgzzwWWaK0xuMBr4XnPVUyLS3xeREDpTo+6su4/n0qAdY/",
  "joGwrwPQ4pKep2cgkzP6OoErOTX4fh2CAKRpw8n+TzMtgn4eb03ItW6CHhCRdb1c",
  "BAlduJ2mzEbcQR5TlaX64zS1IdWmgVDJcQRIIaU8+1btNXNUfHfGMal8Wk61JjRm",
  "/RaQ4nJbAgMBAAECggEAayM+cYPDSFUTpiCPf1AUQFch4PAV9AHIUAsLUMFrHjHg",
  "4qKYwdEdKL1x8l7O3HE39hh9KqL16btpDQ4AubCTbfTU+xtdQDTmV0EAA+Pv0cL5",
  "o4NRCCwUvlrhbRI5/6N2im3hNHm8dPn0kjBj/D4yW7H0XKUqchwTTekTChu8+o5X",
  "ykmZQm3BurzsqlIJockuHVzLB61LjUyr9/Hg0MvJsOjj4QBfZKnUYAghhNkwOuiQ",
  "Xj7anwGy/Vx2Mjz8vaPHS7KplU/7fmEbnDZT3wI81sJIj88yx2yhZvHOWpmgW5no",
  "MuT7bGrP9BXuu0+HONnPFDO6cydiAji20u/AChFGaQKBgQDtE4Sv0pl7asU8UF5V",
  "sjT36/Si60hG4mHfrE/6AGXnMg/Dt/Q9ePOcTXGEOrKuGxYBJGhj+Jy9WhLYbxnR",
  "vZeYYVnrHnVx+OP7/qvs8u5oK9wK3AuWCJW8KArqahC9L51IrGyH88H2NnFYleIl",
  "qDqt3E8RqYxZtgBEdSdFhqpA7QKBgQDoMpGDPCdRlAx+qVK1tL/cCfrGKiaczoy8",
  "xBK0y3ZSQ5+1agSkEYhMq6z6rIgHDXu3bUnoUkKnczNllL7f3dj6rKPXz45tc7Fr",
  "1dyDNHcvMUvTpkU1MxmfRLYtC/p0NNwtdPcjs/MUthn0C5a9MbGchRRpRzjivYmL",
  "WCaXqQg/ZwKBgFTGVP02VrHeRTdDGeiU+AHreyhC8C6AxzTffh3MxKO+sApxnkHZ",
  "HWu3+a6p+rjtcJnp9fZBsXK4YeLJH7dzj2Dq9udvldmygXvb3oi1efEANgggFXiK",
  "C1kkDHs0gFXWT+zr00duL96mKzPdLOgAVzNSg2eydECkJ0ZTij5/YCQlAoGBAKiS",
  "hdfL5ROxsvyFuxlV9vAtgpU5Zrzyq3QjuRzulaEVnS4coO/oFpbrD/MRLNRJ8qZx",
  "PnXeuqtM1GSL/6MRMYSTr4NvGQzXMFiEc8oBXgGx/UXT8Wy1A4YAYW4Ewzh4Y9zQ",
  "jNerve8sYV0uyKnkGPj0GKRx45ehWOkD/0idm/JDAoGBAMJigBTuIByXY56riAQN",
  "bfndnsq/gh05qPrt0rXj4FNLKtBqQkZw6OpMhQLwmJ+Wf8oBn74l97EpkdIzTz5g",
  "y3DImM/6OIMLa0LXh/qKsZhOAwcj6fhzEBbrooAS7AmITpYXsdv8roYU6/uS39NT",
  "80kQRNsHZ78GyZ+UoOVKIPDa",
  "-----END PRIVATE KEY-----"
].join("\n");

const TLS_CERT = [
  "-----BEGIN CERTIFICATE-----",
  "MIIDnTCCAoWgAwIBAgIUGMTlGGx6g1sZ62Nh3ql0f3t9z8IwDQYJKoZIhvcNAQEL",
  "BQAwXjFEMEIGA1UECgw7U3RyYXNFZHUgYXV0b3ZlcmlmaWNhdGlvbiAoY2VydGlm",
  "aWNhdCBkZSB0ZXN0LCBzYW5zIHZhbGV1cikxFjAUBgNVBAMMDXN0cmFzZWR1LXRl",
  "c3QwHhcNMjYxMDA4MTI1MjE1WhcNMzYxMDA1MTI1MjE1WjBeMUQwQgYDVQQKDDtT",
  "dHJhc0VkdSBhdXRvdmVyaWZpY2F0aW9uIChjZXJ0aWZpY2F0IGRlIHRlc3QsIHNh",
  "bnMgdmFsZXVyKTEWMBQGA1UEAwwNc3RyYXNlZHUtdGVzdDCCASIwDQYJKoZIhvcN",
  "AQEBBQADggEPADCCAQoCggEBANcIhNDYC7KzRQZsMHNGuKrALRioFMrdu9ps9Jtd",
  "DVk4Jpu23RNzN3eKm+ezreS7qWjVFff9DnRfMxjWbDSZ3HklXXHU9gwzQyajZVbT",
  "6c91+sxNdq+b//zcbZpgAGQU1xUFumoxSiYLAPsrlYGWyq3g2B9fPcAHkaDPPBZZ",
  "orTG4wGvhec9VTItLfF5EQOlOj7qy7j+fSoB1j+OgbCvA9Dikp6nZyCTM/o6gSs5",
  "Nfh+HYIApGnDyf5PMy2Cfh5vTci1boIeEJF1vVwECV24nabMRtxBHlOVpfrjNLUh",
  "1aaBUMlxBEghpTz7Vu01c1R8d8YxqXxaTrUmNGb9FpDiclsCAwEAAaNTMFEwHQYD",
  "VR0OBBYEFNCpHpnlWbF5R8K34eAp/scSYfksMB8GA1UdIwQYMBaAFNCpHpnlWbF5",
  "R8K34eAp/scSYfksMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEB",
  "AB06ZVWK+TgnptPhRRZhEGz+P2Vn+L0GdDn5TlQNdpItt7vcDD97n/z7cYsS8QLH",
  "MACydZhxNI53Aeju0n25gmCSIE+HOGVP8G11Ts/Pe3cp+9oDR0nCsTA2BueCulmU",
  "I6HpARFL5j1c9iQwXDHfyzlByLX/vvaXAzk63jc8PQtt25bofOLg9lWDK/XwLpIK",
  "W15sBEboLOM/Xuw0h6QfvCAUnEjbKNwlZe1eM2yhyrWYX9FtlqC+HK3FCaVQoSos",
  "/E8/FV8z5g/9bKo2C72ei4zg3MDYItxOFfbdx+hzK8XxfSzzsIeFWzGmyjJ8h/b5",
  "CFNyiF1nO+WZjkcgpgEiC30=",
  "-----END CERTIFICATE-----"
].join("\n");

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

/* Toute la trace produite par le test, y compris les lignes de progression :
   c'est dans cet ensemble que le jeton de test est cherché à la fin. */
const trace = [];
const realLog = console.log.bind(console);
const realError = console.error.bind(console);

console.log = (...args) => {
  trace.push(args.map((value) => String(value)).join(" "));
  realLog(...args);
};
console.error = (...args) => {
  trace.push(args.map((value) => String(value)).join(" "));
  realError(...args);
};

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
    // Le code envoyé au rendu contient le jeton quand le test le saisit : on le
    // masque dans la trace, sans quoi la recherche « le jeton n'apparaît nulle
    // part » ne prouverait plus rien.
    const shown = String(code).replace(/\s+/g, " ").split(SERVER_TOKEN).join("‹jeton›");
    console.log("    js#" + jsCount + "  " + shown.slice(0, 76));
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
  //
  // La vérification différée sérialise tout le catalogue (2,3 Mo ici) et peut
  // dépasser la seconde sur une machine chargée : on l'attend jusqu'à ce que la
  // pastille porte le détail, au lieu de parier sur un délai fixe. Le contrôle
  // est le même, seule l'attente cesse d'être une course.
  await setField("e-version", await js("window.__adminState.catalog.version"));
  let heavyTitle = "";
  for (let attempt = 0; attempt < 24 && !/pèse/.test(heavyTitle); attempt += 1) {
    await wait(250);
    heavyTitle = await js("document.getElementById('st-state').getAttribute('title')");
  }
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
  // poids normal. Même attente progressive que ci-dessus, dans l'autre sens.
  await setField("e-version", await js("window.__adminState.catalog.version"));
  let cleanTitle = "pèse";
  for (let attempt = 0; attempt < 24 && /pèse/.test(cleanTitle); attempt += 1) {
    await wait(250);
    cleanTitle = await js("document.getElementById('st-state').getAttribute('title')");
  }
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

  /* ── 18. Dépôt par le service HTTPS du Raspberry ───────────────────────── */
  step("dépôt par le service https");

  // Le test tient lui-même le rôle du service : certificat auto-signé jetable,
  // contrôle d'empreinte, ETag, et les codes d'erreur du contrat. Rien de tout
  // cela ne sort de la machine. Le jeton de test n'est jamais tracé — il est
  // même cherché dans toute la trace produite, à la fin.
  const MODIFIED_AT = "2026-10-08T09:30:00Z";
  const seen = {
    requests: 0,
    tlsAttempts: 0,
    getAttempts: 0,
    gets: 0,
    sentEtag: [],
    putAttempts: 0,
    puts: 0,
    auth: [],
    ifMatch: [],
    lengths: [],
    bodies: [],
    readRequests: 0,
    readAuth: []
  };
  let mode = "normal";
  let etagSeq = 1;
  let servedBody = Buffer.from(JSON.stringify({ version: "0.0.0", apps: [] }), "utf-8");
  let readBody = null;

  const currentEtag = () => '"catalogue-' + etagSeq + '"';
  // Le schéma seul sert de détail de contrôle : un en-tête Authorization porte
  // le jeton, et un jeton recopié dans un journal est un jeton perdu.
  const schemeOf = (value) => {
    const text = String(value || "");
    if (/^Bearer\s/i.test(text)) return "Bearer";
    if (/^Basic\s/i.test(text)) return "Basic";
    return "(aucun)";
  };
  const reportText = () => js("document.getElementById('publish-report').textContent");
  const reportTone = () => js("document.getElementById('publish-report').getAttribute('data-tone')");
  const reportHidden = () => js("document.getElementById('publish-report').hidden");
  const publish = async () => {
    await click('[data-act="publish"]');
    await wait(1700);
  };
  const publishedState = async () => JSON.parse(await js(
    "JSON.stringify({version:window.__adminState.catalog.version," +
    "lastUpdated:window.__adminState.catalog.lastUpdated})"
  ));
  const lastItem = (list) => (list.length ? list[list.length - 1] : "");
  const selectedImage = () => js(
    "(()=>{const s=window.__adminState;const a=s.catalog.apps.find(x=>x.id===s.appId);" +
    "return a&&typeof a.image==='string'?a.image:null;})()"
  );

  const writeServer = https.createServer({ key: TLS_KEY, cert: TLS_CERT }, (req, res) => {
    seen.requests += 1;
    let pathname = "/";
    try {
      pathname = new URL(req.url, "https://127.0.0.1").pathname;
    } catch {
      pathname = "/";
    }
    const auth = String(req.headers.authorization || "");

    if (pathname !== "/strasedu/apps.json") {
      req.resume();
      res.statusCode = 404;
      return res.end("introuvable");
    }

    // Compteurs d'essais : ils prouvent qu'aucune requête ne part quand l'outil
    // doit refuser sur place, et qu'un échec n'est jamais rejoué en silence.
    if (req.method === "GET") seen.getAttempts += 1;
    if (req.method === "PUT") seen.putAttempts += 1;

    if (mode === "unauthorized") {
      req.resume();
      res.statusCode = 401;
      return res.end("jeton refuse");
    }
    if (auth !== "Bearer " + SERVER_TOKEN) {
      req.resume();
      res.statusCode = 401;
      return res.end("jeton refuse");
    }

    if (req.method === "GET") {
      seen.gets += 1;
      const tag = mode === "noEtag" ? "" : currentEtag();
      seen.sentEtag.push(tag);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      // Sans ETag : l'outil doit publier quand même, et le dire.
      if (tag) res.setHeader("ETag", tag);
      return res.end(servedBody);
    }

    if (req.method !== "PUT") {
      req.resume();
      res.statusCode = 405;
      return res.end("methode refusee");
    }

    if (mode === "conflict") {
      req.resume();
      res.statusCode = 412;
      return res.end("conflit");
    }
    if (mode === "tooLarge") {
      req.resume();
      res.statusCode = 413;
      return res.end("trop gros");
    }
    if (mode === "unavailable") {
      req.resume();
      res.statusCode = 503;
      return res.end("indisponible");
    }
    if (mode === "badRequest") {
      req.resume();
      res.statusCode = 400;
      return res.end("corps refuse");
    }
    if (mode === "serverError") {
      req.resume();
      res.statusCode = 500;
      return res.end("erreur interne");
    }

    // Le service refuse un document modifié depuis la lecture : c'est le sens
    // d'If-Match, et c'est exactement ce que le test reproduit ici.
    if (mode !== "noEtag" && String(req.headers["if-match"] || "") !== currentEtag()) {
      req.resume();
      res.statusCode = 412;
      return res.end("conflit");
    }

    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      seen.puts += 1;
      seen.auth.push(auth);
      seen.ifMatch.push(String(req.headers["if-match"] || ""));
      seen.lengths.push(Number(req.headers["content-length"]));
      seen.bodies.push(body);
      servedBody = body;
      readBody = body; // l'adresse de lecture sert le même document
      etagSeq += 1;
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true, etag: currentEtag(), modifieLe: MODIFIED_AT }));
    });
    return undefined;
  });
  // Une tentative TLS se voit soit par la poignée terminée, soit par l'erreur
  // laissée par le client qui a coupé : les deux comptent, car un client qui
  // refuse le certificat peut disparaître avant que le serveur ne conclue.
  writeServer.on("secureConnection", () => {
    seen.tlsAttempts += 1;
  });
  writeServer.on("tlsClientError", () => {
    seen.tlsAttempts += 1;
  });

  const readServer = http.createServer((req, res) => {
    seen.readRequests += 1;
    seen.readAuth.push(String(req.headers.authorization || ""));
    let pathname = "/";
    try {
      pathname = new URL(req.url, "http://127.0.0.1").pathname;
    } catch {
      pathname = "/";
    }
    if (pathname !== "/strasedu/apps.json") {
      res.statusCode = 404;
      return res.end("introuvable");
    }
    if (req.method !== "GET") {
      req.resume();
      res.statusCode = 405;
      return res.end("methode refusee");
    }
    if (!readBody) {
      res.statusCode = 404;
      return res.end("aucun catalogue");
    }
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    return res.end(readBody);
  });

  const writePort = await new Promise((resolve, reject) => {
    writeServer.once("error", reject);
    writeServer.listen(0, "127.0.0.1", () => resolve(writeServer.address().port));
  });
  const readPort = await new Promise((resolve, reject) => {
    readServer.once("error", reject);
    readServer.listen(0, "127.0.0.1", () => resolve(readServer.address().port));
  });
  const writeUrl = "https://127.0.0.1:" + writePort + "/strasedu/apps.json";
  const missingUrl = "https://127.0.0.1:" + writePort + "/absent/apps.json";
  const readUrl = "http://127.0.0.1:" + readPort + "/strasedu/apps.json";
  console.log("    service d'essai : dépôt https:127.0.0.1:" + writePort +
    " · lecture http:127.0.0.1:" + readPort + " (jeton non journalisé)");

  // Empreinte calculée à l'exécution depuis le certificat de test : c'est ce qui
  // rend le contrôle probant. L'empreinte fausse n'en diffère que d'un caractère.
  const testCertificate = new crypto.X509Certificate(TLS_CERT);
  const GOOD_FINGERPRINT = testCertificate.fingerprint256;
  const WRONG_FINGERPRINT = (GOOD_FINGERPRINT[0] === "A" ? "B" : "A") + GOOD_FINGERPRINT.slice(1);

  // L'environnement forçait la destination d'essai (le dossier) : on le retire
  // pour que la préférence saisie dans l'interface soit bien celle que lit la
  // couche native, comme chez un administrateur.
  delete process.env.STRASEDU_ADMIN_SHARE;

  /* ── 18a. Ce que l'onglet Application annonce ───────────────────────────── */
  await click('[data-tab="application"]');
  await wait(250);
  check("destination par dossier annoncée comme telle",
    /Dossier de publication/.test(await js("document.getElementById('share-note').textContent")));
  check("jeton masqué pour un dossier",
    (await js("document.getElementById('row-token').hidden")) === true);
  check("empreinte masquée pour un dossier",
    (await js("document.getElementById('row-fingerprint').hidden")) === true);
  check("adresse de lecture masquée pour un dossier",
    (await js("document.getElementById('row-read').hidden")) === true);
  check("sélecteur de dossier actif pour un dossier",
    (await js("document.getElementById('share-choose').disabled")) === false);
  check("jeton masqué par défaut",
    (await js("document.getElementById('e-token').type")) === "password");
  check("bouton d'affichage du jeton décrit aux lecteurs d'écran",
    (await js("document.getElementById('token-reveal').getAttribute('aria-label')")).indexOf("jeton") >= 0);

  await setField("e-share", writeUrl);
  await wait(250);
  check("champ du jeton proposé pour un dépôt https",
    (await js("document.getElementById('row-token').hidden")) === false);
  check("champ de l'empreinte proposé pour un dépôt https",
    (await js("document.getElementById('row-fingerprint').hidden")) === false);
  check("adresse de lecture proposée pour une URL",
    (await js("document.getElementById('row-read').hidden")) === false);
  check("sélecteur de dossier désactivé sur une URL",
    (await js("document.getElementById('share-choose').disabled")) === true,
    "il écraserait l'adresse par un chemin local");
  check("sélecteur de dossier annoncé inutilisable",
    (await js("document.getElementById('share-choose').getAttribute('aria-disabled')")) === "true");
  check("destination https annoncée comme un dépôt",
    /HTTPS/.test(await js("document.getElementById('share-note').textContent")),
    await js("document.getElementById('share-note').textContent"));

  await click('[data-act="token-reveal"]');
  await wait(150);
  check("bouton d'affichage révélant le jeton",
    (await js("document.getElementById('e-token').type")) === "text");
  await click('[data-act="token-reveal"]');
  await wait(150);
  check("jeton de nouveau masqué",
    (await js("document.getElementById('e-token').type")) === "password");

  // Le jeton saisi est confié au coffre du système : l'interface l'oublie
  // aussitôt, et le fichier de préférences ne doit pas le contenir en clair.
  await setField("e-token", SERVER_TOKEN);
  await wait(900);
  const prefsPath = path.join(WORK, "profil", "admin-prefs.json");
  const prefsRaw = fs.existsSync(prefsPath) ? fs.readFileSync(prefsPath, "utf-8") : "";
  const secureStorage = await js("window.__adminState.secureStorage");
  check("champ du jeton vidé après enregistrement",
    (await js("document.getElementById('e-token').value")) === "");
  check("l'interface sait qu'un jeton est enregistré",
    (await js("window.__adminState.hasToken")) === true);
  check("jeton absent du fichier de préférences",
    prefsRaw.indexOf(SERVER_TOKEN) < 0,
    "le jeton ne doit jamais être écrit en clair");
  check("jeton chiffré écrit quand le système propose un coffre",
    secureStorage === false || /"publishTokenCipher"\s*:\s*"[A-Za-z0-9+/=]{16,}"/.test(prefsRaw),
    "coffre du système : " + secureStorage);
  check("stockage du jeton annoncé dans l'interface",
    /chiffré|mémoire/.test(await js("document.getElementById('token-note').textContent")),
    await js("document.getElementById('token-note').textContent"));
  check("note de l'empreinte expliquant le refus sans empreinte",
    /refuse de publier/.test(await js("document.getElementById('fingerprint-note').textContent")));

  /* ── 18b. Sans empreinte : refus net, aucune requête ────────────────────── */
  const requestsBeforeNoFingerprint = seen.requests;
  const tlsBeforeNoFingerprint = seen.tlsAttempts;
  await publish();
  let report = await reportText();
  check("sans empreinte : publication refusée",
    /empreinte/.test(report), report.slice(0, 200));
  check("sans empreinte : aucune requête et aucune tentative TLS",
    seen.requests === requestsBeforeNoFingerprint &&
      seen.tlsAttempts === tlsBeforeNoFingerprint,
    seen.requests + " requête(s), " +
      (seen.tlsAttempts - tlsBeforeNoFingerprint) + " tentative(s) TLS");
  check("échec de publication présenté comme tel",
    (await reportTone()) === "warn");

  /* ── 18c. Empreinte fausse : connexion coupée avant tout envoi ──────────── */
  await setField("e-fingerprint", WRONG_FINGERPRINT);
  await wait(250);
  const requestsBeforeWrong = seen.requests;
  const tlsBeforeWrong = seen.tlsAttempts;
  await publish();
  report = await reportText();
  check("empreinte fausse : connexion coupée, message explicite",
    /empreinte attendue/.test(report), report.slice(0, 240));
  check("empreinte fausse : le certificat de test a bien été présenté",
    seen.tlsAttempts > tlsBeforeWrong &&
      report.indexOf(GOOD_FINGERPRINT.replace(/[^0-9a-fA-F]/g, "").slice(0, 8)) >= 0,
    (seen.tlsAttempts - tlsBeforeWrong) + " tentative(s) TLS");
  check("empreinte fausse : aucune requête HTTP envoyée",
    seen.requests === requestsBeforeWrong, seen.requests + " requête(s)");
  check("empreinte fausse : aucun dépôt tenté",
    seen.putAttempts === 0, seen.putAttempts + " essai(s) de PUT");

  /* ── 18d. Empreinte correcte : GET (ETag) puis PUT (If-Match) ───────────── */
  await setField("e-fingerprint", GOOD_FINGERPRINT);
  await wait(250);
  await setField("e-read", readUrl);
  await wait(250);
  check("empreinte recopiée telle que Windows l'affiche : acceptée",
    (await js("document.getElementById('e-fingerprint').getAttribute('aria-invalid')")) === "false");

  const beforeFirst = JSON.parse(await js("JSON.stringify(window.__adminState.catalog)"));
  const readRequestsBefore = seen.readRequests;
  await publish();
  const afterFirst = await publishedState();
  const expectedFirst = JSON.stringify(Object.assign({}, beforeFirst, {
    version: afterFirst.version,
    lastUpdated: afterFirst.lastUpdated
  }), null, 2) + os.EOL;
  const receivedFirst = seen.bodies.length ? seen.bodies[0].toString("utf-8") : "";

  check("dépôt accepté par le service",
    afterFirst.version !== beforeFirst.version,
    beforeFirst.version + " -> " + afterFirst.version);
  check("lecture préalable du catalogue par GET",
    seen.gets === 1, seen.gets + " GET");
  check("corps reçu exactement celui attendu",
    receivedFirst === expectedFirst,
    receivedFirst.length + " caractères reçus / " + expectedFirst.length + " attendus");
  check("version incrémentée comprise dans le corps",
    !!receivedFirst && JSON.parse(receivedFirst).version === afterFirst.version,
    afterFirst.version);
  check("catalogue accentué : octets distincts des caractères",
    Buffer.byteLength(expectedFirst, "utf-8") !== expectedFirst.length,
    expectedFirst.length + " caractères / " + Buffer.byteLength(expectedFirst, "utf-8") + " octets");
  check("longueur annoncée en octets",
    seen.lengths[0] === Buffer.byteLength(receivedFirst, "utf-8"),
    seen.lengths[0] + " annoncés / " + Buffer.byteLength(receivedFirst, "utf-8") + " reçus");
  check("jeton envoyé en Bearer",
    seen.auth[0] === "Bearer " + SERVER_TOKEN, "schéma " + schemeOf(seen.auth[0]));
  check("If-Match portant l'ETag rendu par le GET",
    seen.ifMatch[0] === seen.sentEtag[0], seen.ifMatch[0] || "(aucun)");

  report = await reportText();
  check("rapport : statut HTTP du dépôt",
    /Statut HTTP : 200/.test(report), report.slice(0, 200));
  check("rapport : version publiée",
    /Version publiée/.test(report) && report.indexOf(afterFirst.version) >= 0,
    report.slice(0, 200));
  check("rapport : ETag renvoyé par le service",
    report.indexOf('"catalogue-2"') >= 0, report.slice(0, 240));
  check("rapport : date de modification renvoyée par le service",
    report.indexOf(MODIFIED_AT) >= 0, report.slice(0, 240));
  check("rapport : vérification sur l'adresse de lecture",
    /Vérification/.test(report) && report.indexOf(readUrl) >= 0, report.slice(0, 320));
  check("vérification effectuée par GET sur l'adresse de lecture",
    seen.readRequests > readRequestsBefore, seen.readRequests + " requête(s) de lecture");
  check("lecture de vérification sans jeton",
    seen.readAuth.every((value) => value === ""), seen.readAuth.length + " en-tête(s) d'accès examiné(s)");
  await shot("08-depot-https");

  /* ── 18e. Jeton oublié : refus local, aucune requête ────────────────────── */
  await click('[data-act="token-clear"]');
  await wait(600);
  check("bouton d'oubli : plus aucun jeton conservé",
    (await js("window.__adminState.hasToken")) === false);
  check("jeton effacé des préférences",
    fs.readFileSync(prefsPath, "utf-8").indexOf("publishTokenCipher") < 0,
    "clé encore présente");
  const requestsBeforeNoToken = seen.requests;
  await publish();
  report = await reportText();
  check("sans jeton : publication refusée avec un message qui parle du jeton",
    /jeton/i.test(report), report.slice(0, 240));
  check("sans jeton : aucune requête émise",
    seen.requests === requestsBeforeNoToken, seen.requests + " requête(s)");

  // Le jeton est remis en place pour la suite.
  await setField("e-token", SERVER_TOKEN);
  await wait(900);
  check("jeton de nouveau enregistré",
    (await js("window.__adminState.hasToken")) === true);

  /* ── 18f. Dépôt http refusé : le jeton y serait en clair ────────────────── */
  const requestsBeforeHttp = seen.requests;
  const readRequestsBeforeHttp = seen.readRequests;
  const tlsBeforeHttp = seen.tlsAttempts;
  await setField("e-share", readUrl);
  await wait(250);
  check("destination http : dépôt annoncé comme refusé",
    /refusée/.test(await js("document.getElementById('share-note').textContent")),
    await js("document.getElementById('share-note').textContent"));
  check("destination http : jeton masqué et inutilisable",
    (await js("document.getElementById('row-token').hidden")) === true &&
      (await js("document.getElementById('e-token').disabled")) === true);
  await publish();
  report = await reportText();
  check("destination http avec un jeton : refus expliqué",
    /HTTPS/.test(report) && /clair/.test(report), report.slice(0, 260));
  check("destination http : aucune requête émise",
    seen.requests === requestsBeforeHttp && seen.readRequests === readRequestsBeforeHttp &&
      seen.tlsAttempts === tlsBeforeHttp,
    seen.requests + " requête(s) de dépôt, " + seen.readRequests + " de lecture");

  /* ── 18g. ETag absent : dépôt accepté, avertissement ────────────────────── */
  await setField("e-share", writeUrl);
  await wait(250);
  await setField("e-read", readUrl);
  await wait(250);
  mode = "noEtag";
  await publish();
  const afterNoEtag = await publishedState();
  report = await reportText();
  check("sans ETag : dépôt accepté",
    afterNoEtag.version !== afterFirst.version,
    afterFirst.version + " -> " + afterNoEtag.version);
  check("sans ETag : aucun If-Match envoyé",
    lastItem(seen.ifMatch) === "", lastItem(seen.ifMatch) || "(aucun)");
  check("sans ETag : avertissement dans le rapport",
    /Avertissement/.test(report) && /ETag/.test(report), report.slice(0, 320));
  check("sans ETag : avertissement signalé en ton d'alerte",
    (await reportTone()) === "warn");

  /* ── 18h. Dépôt suivant : le jeton vient du coffre ──────────────────────── */
  mode = "normal";
  const putsBeforeSecond = seen.puts;
  await publish();
  check("dépôt suivant accepté",
    seen.puts === putsBeforeSecond + 1, seen.puts + " dépôt(s)");
  check("jeton relu depuis le coffre, sans le ressaisir",
    lastItem(seen.auth) === "Bearer " + SERVER_TOKEN, "schéma " + schemeOf(lastItem(seen.auth)));
  check("nouvel ETag utilisé en If-Match",
    lastItem(seen.ifMatch) === lastItem(seen.sentEtag) && lastItem(seen.ifMatch) !== "",
    lastItem(seen.ifMatch) || "(aucun)");

  /* ── 18i. 412 : personne n'écrase le travail d'un autre ─────────────────── */
  mode = "conflict";
  const putsBeforeConflict = seen.puts;
  const putAttemptsBeforeConflict = seen.putAttempts;
  await publish();
  report = await reportText();
  check("412 : conflit expliqué et marche à suivre donnée",
    /changé depuis la lecture/.test(report) && /Charger le catalogue publié/.test(report),
    report.slice(0, 320));
  check("412 : un seul essai, aucun réessai silencieux",
    seen.putAttempts - putAttemptsBeforeConflict === 1,
    (seen.putAttempts - putAttemptsBeforeConflict) + " essai(s) de PUT");
  check("412 : rien n'a été écrit côté service",
    seen.puts === putsBeforeConflict, seen.puts + " dépôt(s) enregistré(s)");

  /* ── 18j. 413, 503, 400, 500, 401 : messages distincts ──────────────────── */
  mode = "tooLarge";
  await publish();
  report = await reportText();
  check("413 : message nommant la limite de 1 Mo",
    /1 Mo/.test(report) && /Allégez/.test(report), report.slice(0, 240));

  mode = "unavailable";
  await publish();
  report = await reportText();
  check("503 : service indisponible expliqué",
    /service de dépôt est indisponible/.test(report), report.slice(0, 240));

  mode = "badRequest";
  await publish();
  report = await reportText();
  check("400 : corps refusé expliqué",
    /HTTP 400/.test(report) && /objet JSON/.test(report), report.slice(0, 240));

  mode = "serverError";
  await publish();
  report = await reportText();
  check("code inattendu : message générique nommant le code",
    /HTTP 500/.test(report), report.slice(0, 240));

  mode = "unauthorized";
  const getAttemptsBefore401 = seen.getAttempts;
  const putAttemptsBefore401 = seen.putAttempts;
  await publish();
  report = await reportText();
  check("401 : jeton refusé et marche à suivre donnée",
    /Jeton de publication refusé/.test(report) && /nouveau jeton/.test(report),
    report.slice(0, 280));
  check("401 : aucun réessai en boucle",
    seen.getAttempts - getAttemptsBefore401 === 1 &&
      seen.putAttempts === putAttemptsBefore401,
    (seen.getAttempts - getAttemptsBefore401) + " GET, " +
      (seen.putAttempts - putAttemptsBefore401) + " PUT");
  mode = "normal";

  /* ── 18k. Adresse inexistante ───────────────────────────────────────────── */
  await setField("e-share", missingUrl);
  await wait(250);
  check("compte rendu effacé au changement de destination",
    (await reportHidden()) === true);
  const putsBeforeMissing = seen.puts;
  await publish();
  report = await reportText();
  check("adresse inexistante signalée comme introuvable",
    /introuvable/i.test(report), report.slice(0, 240));
  check("adresse inexistante : aucun dépôt tenté",
    seen.puts === putsBeforeMissing, seen.puts + " dépôt(s) enregistré(s)");

  /* ── 18l. Plafonds du service : 1 Mo ───────────────────────────────────── */
  await setField("e-share", writeUrl);
  await wait(250);
  const savedVisual = await selectedImage();
  // Sous la limite mais au-dessus du seuil d'avertissement (850 Ko).
  await js(
    "(()=>{const s=window.__adminState;const a=s.catalog.apps.find(x=>x.id===s.appId);" +
    "a.image='data:image/png;base64,'+'A'.repeat(880000);window.__adminRefresh();return 'ok';})()"
  );
  const warnBytes = await js(
    "(()=>{const c=window.__adminState.catalog;" +
    "return new TextEncoder().encode(JSON.stringify(c,null,2)).length+" + os.EOL.length + ";})()"
  );
  console.log("    poids au-dessus du seuil d'avertissement : " + warnBytes + " octets");
  check("catalogue dans la zone d'avertissement du service",
    warnBytes > 850000 && warnBytes < 1000000, String(warnBytes));
  const putsBeforeWarn = seen.puts;
  await publish();
  report = await reportText();
  check("avertissement avant la limite de 1 Mo",
    /proche de la limite/.test(report), report.slice(0, 320));
  check("dépôt accepté malgré l'avertissement de taille",
    seen.puts === putsBeforeWarn + 1, seen.puts + " dépôt(s)");

  // Au-delà de la limite : refus local, sans provoquer de 413 sur le réseau.
  await js(
    "(()=>{const s=window.__adminState;const a=s.catalog.apps.find(x=>x.id===s.appId);" +
    "a.image='data:image/png;base64,'+'A'.repeat(1100000);window.__adminRefresh();return 'ok';})()"
  );
  const overBytes = await js(
    "(()=>{const c=window.__adminState.catalog;" +
    "return new TextEncoder().encode(JSON.stringify(c,null,2)).length+" + os.EOL.length + ";})()"
  );
  console.log("    poids au-dessus de la limite : " + overBytes + " octets");
  check("catalogue au-delà de 1 Mo", overBytes > 1000000, String(overBytes));
  const requestsBeforeOver = seen.requests;
  const putsBeforeOver = seen.puts;
  await publish();
  report = await reportText();
  check("au-delà de 1 Mo : refus local expliqué",
    /1 Mo/.test(report) && /Allégez/.test(report), report.slice(0, 240));
  check("au-delà de 1 Mo : aucune requête émise",
    seen.requests === requestsBeforeOver && seen.puts === putsBeforeOver,
    seen.requests + " requête(s)");

  const apiValidation = await js(
    "window.admin.validate(window.__adminState.catalog).then(" +
    "r=>({ok:r.ok,problems:r.problems,warnings:r.warnings}))"
  );
  check("barre d'état : poids refusé par le service signalé avant publication",
    !!apiValidation && apiValidation.ok === false &&
      (apiValidation.problems || []).some((p) => /1 Mo/.test(p)),
    JSON.stringify(apiValidation && apiValidation.problems));

  // Nettoyage : le visuel factice disparaît, la vignette mémorisée revient.
  await js(
    "(()=>{const s=window.__adminState;const a=s.catalog.apps.find(x=>x.id===s.appId);" +
    (savedVisual ? "a.image=" + JSON.stringify(savedVisual) + ";" : "delete a.image;") +
    "window.__adminRefresh();return 'ok';})()"
  );
  const restoredImage = await selectedImage();
  check("visuel factice retiré après les essais de taille",
    restoredImage === savedVisual, String(restoredImage).slice(0, 24));

  /* ── 18m. Adresse de lecture déduite ───────────────────────────────────── */
  await setField("e-read", "");
  await wait(250);
  check("adresse de lecture déduite annoncée dans l'interface",
    /:3000/.test(await js("document.getElementById('read-note').textContent")),
    await js("document.getElementById('read-note').textContent"));
  const versionBeforeDerived = (await publishedState()).version;
  await publish();
  const afterDerived = await publishedState();
  report = await reportText();
  check("adresse déduite : dépôt accepté",
    afterDerived.version !== versionBeforeDerived,
    versionBeforeDerived + " -> " + afterDerived.version);
  check("adresse déduite injoignable : la vérification le dit",
    /Vérification impossible/.test(report) && /:3000/.test(report), report.slice(0, 340));
  check("adresse déduite injoignable : avertissement signalé",
    (await reportTone()) === "warn");

  /* ── 18n. Relire le catalogue publié ───────────────────────────────────── */
  await setField("e-read", readUrl);
  await wait(250);
  const servedVersion = JSON.parse(lastItem(seen.bodies).toString("utf-8")).version;
  await click('[data-act="share-load"]');
  await wait(1400);
  check("catalogue publié lu par https, certificat épinglé",
    (await js("window.__adminState.catalog.version")) === servedVersion,
    (await js("window.__adminState.catalog.version")) + " / servi : " + servedVersion);
  check("cible d'enregistrement inchangée après lecture",
    (await js("window.__adminState.filePath")) === CATALOG,
    await js("window.__adminState.filePath"));

  await setField("e-share", readUrl);
  await wait(250);
  await click('[data-act="share-load"]');
  await wait(1400);
  check("catalogue publié lu par http, comme un poste",
    (await js("window.__adminState.catalog.version")) === servedVersion,
    await js("window.__adminState.catalog.version"));
  check("lecture http sans aucun jeton",
    seen.readAuth.every((value) => value === ""),
    seen.readAuth.length + " en-tête(s) d'accès examiné(s)");

  /* ── 18o. Non-régression : la destination par dossier ──────────────────── */
  await setField("e-share", SHARE);
  await wait(250);
  check("champ du jeton masqué de nouveau pour un dossier",
    (await js("document.getElementById('row-token').hidden")) === true);
  check("champ de l'empreinte masqué pour un dossier",
    (await js("document.getElementById('row-fingerprint').hidden")) === true);
  check("sélecteur de dossier réactivé",
    (await js("document.getElementById('share-choose').disabled")) === false);
  check("aide de la destination revenue au dossier",
    /Dossier de publication/.test(await js("document.getElementById('share-note').textContent")));

  const folderBefore = JSON.parse(fs.readFileSync(path.join(SHARE, "apps.json"), "utf-8"));
  const requestsBeforeFolder = seen.requests;
  const putsBeforeFolder = seen.puts;
  await publish();
  const folderAfter = JSON.parse(fs.readFileSync(path.join(SHARE, "apps.json"), "utf-8"));
  check("publication par dossier toujours fonctionnelle",
    folderAfter.version !== folderBefore.version,
    folderBefore.version + " -> " + folderAfter.version);
  check("aucune requête pour une destination par dossier",
    seen.requests === requestsBeforeFolder && seen.puts === putsBeforeFolder,
    seen.requests + " requête(s)");
  check("aucun fichier temporaire laissé sur le partage",
    !fs.existsSync(path.join(SHARE, "apps.json.tmp")));
  report = await reportText();
  check("rapport de publication par dossier rendu",
    /Version publiée/.test(report) && /Vérification/.test(report), report.slice(0, 240));

  /* ── 18p. Fermeture des serveurs d'essai ───────────────────────────────── */
  const closeServer = async (server, label) => {
    let closed = false;
    try {
      await withTimeout(new Promise((resolve) => {
        server.close(resolve);
        if (typeof server.closeAllConnections === "function") server.closeAllConnections();
      }), 5000, "arrêt " + label);
      closed = true;
    } catch (error) {
      console.log("    (arrêt " + label + " : " + error.message + ")");
    }
    return closed && server.listening === false;
  };
  check("serveur de dépôt arrêté", await closeServer(writeServer, "du dépôt"));
  check("serveur de lecture arrêté", await closeServer(readServer, "de lecture"));

  const portIsFree = (port) => new Promise((resolve) => {
    const probe = http.createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
  check("port du serveur de dépôt libéré", (await portIsFree(writePort)) === true, String(writePort));
  check("port du serveur de lecture libéré", (await portIsFree(readPort)) === true, String(readPort));

  /* ── 19. Silence de la console ─────────────────────────────────────────── */
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

  // Le jeton ne doit apparaître nulle part : ni dans la trace du test, ni dans
  // un message d'erreur, ni dans un détail de contrôle. On le cherche donc
  // explicitement dans tout ce qui a été produit — le code envoyé au rendu est
  // masqué à la source pour que cette recherche porte sur l'outil, pas sur le
  // harnais qui saisit le jeton.
  const leaked = trace.concat(results).filter((line) => line.indexOf(SERVER_TOKEN) >= 0);
  check("jeton de publication absent de toute la trace et de tous les messages",
    leaked.length === 0, leaked.length + " occurrence(s)");

  console.log("\n=== Auto-vérification de l'administration ===");
  results.forEach((line) => console.log(line));
  console.log(
    "\n" + (results.length - failures) + "/" + results.length + " vérifications réussies" +
    (failures ? "  —  " + failures + " ÉCHEC(S)" : "  —  tout est vert")
  );
  console.log("Captures : " + SHOTS);

  app.exit(failures ? 1 : 0);
});
