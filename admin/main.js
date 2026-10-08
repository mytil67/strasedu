/* ==========================================================================
   StrasEdu — application d'administration
   --------------------------------------------------------------------------
   Fenêtre unique permettant au service informatique de composer le catalogue
   sans éditer de JSON :

     • ajouter, modifier, supprimer un outil ;
     • lui affecter une icône parmi celles de StrasEdu ;
     • créer et paramétrer les catégories (icône, couleur, description) ;
     • définir le logo officiel de l'établissement ;
     • publier le catalogue vers un dossier partagé ou une adresse HTTP,
       version incrémentée.

   La validation est celle de l'application (lib/catalog.js) : ce que
   l'administration accepte, les postes l'acceptent.
   ========================================================================== */

"use strict";

const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  safeStorage,
  shell
} = require("electron");
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const tls = require("tls");

const {
  normalizeCatalog,
  asText,
  safeLogo,
  safeImage,
  MAX_LOGO_CHARS,
  MAX_IMAGE_CHARS,
  MAX_CATALOG_BYTES,
  MAX_PUBLISH_BYTES,
  WARN_CATALOG_BYTES
} = require("../lib/catalog");

const APP_NAME = "StrasEdu Administration";
const PROJECT_DIR = path.resolve(__dirname, "..");

/**
 * Hauteur de réduction d'un visuel, selon l'usage. Les bornes évitent qu'un
 * appelant fasse produire une image minuscule (illisible dans l'application)
 * ou énorme (refusée par le plafond du catalogue, après un long encodage).
 */
const IMAGE_HEIGHT_MIN = 200;
const IMAGE_HEIGHT_MAX = 360;
const IMAGE_HEIGHT_DEFAULT = 320;

/**
 * Ressource livrée à côté de l'archive applicative. La couche native de
 * Windows attend un vrai chemin de fichier, pas une entrée d'asar.
 */
function assetPath(...parts) {
  const packaged = path.join(process.resourcesPath || "", ...parts);
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.join(PROJECT_DIR, ...parts);
}

/** Catalogue livré avec l'outil : le point de départ de l'administrateur. */
function bundledCatalog() {
  return assetPath("apps.json");
}

/**
 * Copie de travail, dans le profil de l'utilisateur. L'application installée
 * ne peut pas écrire dans sa propre archive : on travaille donc sur une copie,
 * créée au premier lancement à partir du catalogue livré.
 */
function workingCatalogPath() {
  return path.join(app.getPath("userData"), "apps.json");
}

function ensureWorkingCatalog() {
  const target = workingCatalogPath();
  if (fs.existsSync(target)) return target;

  const source = bundledCatalog();
  if (!fs.existsSync(source)) return null;

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    return target;
  } catch {
    return null;
  }
}

let mainWindow = null;

/* ─── Préférences de l'outil (dernier fichier, partage) ──────────────────── */

function prefsFile() {
  return path.join(app.getPath("userData"), "admin-prefs.json");
}

/**
 * Valeurs imposées par l'environnement. Elles permettent de lancer l'outil
 * directement sur un catalogue et un partage donnés — déploiement automatisé
 * ou auto-vérification — sans passer par les boîtes de dialogue.
 */
function environmentOverrides() {
  const forced = {};
  if (process.env.STRASEDU_ADMIN_CATALOG) forced.lastFilePath = process.env.STRASEDU_ADMIN_CATALOG;
  if (process.env.STRASEDU_ADMIN_SHARE) forced.sharePath = process.env.STRASEDU_ADMIN_SHARE;
  return forced;
}

function readPrefs() {
  let stored = {};
  try {
    let raw = fs.readFileSync(prefsFile(), "utf-8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    stored = JSON.parse(raw);
  } catch {
    stored = {};
  }
  return Object.assign({}, stored, environmentOverrides());
}

function writePrefs(patch, remove) {
  const next = Object.assign(readPrefs(), patch || {});
  // Un jeton en clair ecrit par une version anterieure n'a rien a faire sur le
  // disque : on l'oublie a la premiere ecriture.
  delete next.publishToken;
  (remove || []).forEach((key) => {
    delete next[key];
  });
  try {
    fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
    fs.writeFileSync(prefsFile(), JSON.stringify(next, null, 2), "utf-8");
  } catch {
    /* les préférences de l'outil ne doivent jamais bloquer */
  }
  return next;
}

/* ─── Lecture et écriture du catalogue ───────────────────────────────────── */

function readCatalogFile(filePath) {
  let raw = fs.readFileSync(filePath, "utf-8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  return JSON.parse(raw);
}

/** Écriture atomique : un poste qui lit ne voit jamais un fichier tronqué. */
function writeCatalogFile(filePath, catalog) {
  const text = JSON.stringify(catalog, null, 2) + os.EOL;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = filePath + ".tmp";
  fs.writeFileSync(temp, text, "utf-8");
  fs.renameSync(temp, filePath);
  return filePath;
}

/**
 * Poids du catalogue tel qu'il sera écrit — même mise en forme que
 * writeCatalogFile, pour que la mesure corresponde au fichier publié.
 */
function catalogBytes(catalog) {
  try {
    return Buffer.byteLength(JSON.stringify(catalog, null, 2) + os.EOL, "utf-8");
  } catch {
    return 0;
  }
}

/** Message commun aux deux seuils : il nomme la limite et la conséquence. */
function tooHeavyMessage(bytes) {
  return (
    "Le catalogue pèse " + Math.round(bytes / 1024) + " Ko ; au-delà de " +
    Math.round(MAX_CATALOG_BYTES / 1024) +
    " Ko les postes le refusent en entier. Allégez les visuels (Onglet Outils et Département)."
  );
}

/* ─── Publication par HTTPS ─────────────────────────────────────────────── */

/**
 * Delai maximal d'un echange, redirections comprises. Un serveur muet doit se
 * signaler par une erreur explicite : l'administrateur attend devant sa fenetre
 * et ne doit pas croire a une publication en cours.
 */
const PUBLISH_TIMEOUT_MS = 12000;

/** Meme plafond de redirections que fetchCatalog() dans l'application. */
const PUBLISH_REDIRECT_MAX = 4;

/**
 * Plafonds du service de depot du Raspberry : il refuse tout document au-dela
 * de 1 Mo, et l'outil previent des 850 Ko. Inutile d'aller chercher un refus
 * 413 sur le reseau, et inutile de laisser croire qu'un catalogue trop lourd
 * sera diffuse.
 */
const MAX_API_BYTES = 1000000;
const WARN_API_BYTES = 850000;

/** Port de lecture du service : le depot est en https sur 443, la lecture en
 *  http sur 3000, sans jeton ni certificat. */
const READ_PORT = 3000;

/** Bornes des preferences saisies dans l'onglet Application. */
const MAX_TOKEN_CHARS = 512;
const MAX_FINGERPRINT_CHARS = 128;

/**
 * Une destination en URL se depose par requete ; tout le reste est un dossier
 * partage. C'est le seul critere qui choisit le mode de publication, pour que
 * le comportement des installations existantes (partage SMB) soit inchange.
 */
function isHttpDestination(destination) {
  return /^https?:\/\//i.test(String(destination || "").trim());
}

/**
 * Seul https transporte le jeton. En http il circulerait en clair sur le
 * reseau : l'outil refuse donc d'y publier, meme si l'adresse repond.
 */
function isHttpsDestination(destination) {
  return /^https:\/\//i.test(String(destination || "").trim());
}

/**
 * Adresse montrable. Les identifiants eventuellement poses dans l'URL
 * (http://utilisateur:motdepasse@serveur/...) ne doivent apparaitre ni dans un
 * rapport, ni dans un message d'erreur, ni dans une trace.
 */
function displayUrl(value) {
  return String(value || "").replace(/\/\/[^/@\s]*@/, "//");
}

/**
 * Empreinte de certificat comparable : les separateurs « : » et les espaces
 * sont ignores, et la casse n'importe pas — un administrateur recopie souvent
 * l'empreinte telle que Windows l'affiche.
 */
function normalizeFingerprint(value) {
  return String(value || "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

/** Une empreinte SHA-256 utilisable : exactement 64 caracteres hexadecimaux. */
function fingerprintIsValid(value) {
  return /^[0-9A-F]{64}$/.test(normalizeFingerprint(value));
}

/**
 * Agent TLS qui epingle le certificat du serveur.
 *
 * Le certificat du Raspberry n'est pas reconnu par Windows : la chaine ne peut
 * donc pas etre validee, et `rejectUnauthorized: false` est indispensable. Ce
 * reglage n'est acceptable QU'accompagne de ce controle : sur `secureConnect`,
 * l'empreinte SHA-256 du certificat presente est comparee a celle attendue, et
 * la connexion est coupee AVANT que la socket ne soit remise au client HTTP —
 * donc avant que le moindre octet, et en particulier l'en-tete Authorization,
 * ne parte. Desactiver la verification sans ce controle laisserait n'importe
 * quel serveur se faire passer pour le Pi et capter le jeton.
 */
function pinnedAgent(expected) {
  const agent = new https.Agent({ keepAlive: false });

  agent.createConnection = function (options, callback) {
    const socket = tls.connect(Object.assign({}, options, { rejectUnauthorized: false }));

    const refuse = function (message) {
      socket.destroy();
      callback(explicitError(message));
    };

    socket.once("secureConnect", function () {
      let seen = "";
      try {
        const certificate = socket.getPeerCertificate();
        seen = normalizeFingerprint(certificate && certificate.fingerprint256);
      } catch {
        seen = "";
      }

      if (!seen) {
        refuse("Certificat du serveur illisible : publication interrompue avant tout envoi.");
        return;
      }
      if (seen !== expected) {
        refuse("Le certificat présenté par le serveur ne correspond pas à l'empreinte attendue (" +
          seen.slice(0, 8) + "… au lieu de " + expected.slice(0, 8) +
          "…) : publication interrompue avant tout envoi.");
        return;
      }
      callback(null, socket);
    });

    socket.once("error", function (error) {
      callback(error);
    });
  };

  return agent;
}

/* ─── Jeton de publication : jamais en clair ─────────────────────────────── */

/**
 * Jeton fourni pendant la session, quand le systeme ne propose pas de coffre.
 * Il n'est alors jamais ecrit : il ne vit que le temps de la session de l'outil.
 */
let sessionToken = null;

/** Coffre du systeme disponible (DPAPI sous Windows) ? */
function secureStorageAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

/**
 * Jeton utilisable a l'instant : la memoire d'abord, puis le coffre du systeme.
 * Le dechiffrement peut echouer — profil different, coffre indisponible : on
 * repond alors « pas de jeton », jamais un jeton approximatif.
 */
function storedToken() {
  if (sessionToken) return sessionToken;
  const cipher = readPrefs().publishTokenCipher;
  if (!cipher || !secureStorageAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(String(cipher), "base64")) || null;
  } catch {
    return null;
  }
}

/**
 * Adresse de lecture des postes, deduite de l'adresse de depot quand elle n'est
 * pas renseignee : meme hote, meme chemin, en http sur le port 3000 — c'est le
 * couple decrit par le service (depot https avec jeton, lecture http sans).
 */
function derivedReadUrl(writeUrl) {
  try {
    const parsed = new URL(String(writeUrl || "").trim());
    if (parsed.protocol !== "https:") return "";
    const host = parsed.hostname.indexOf(":") >= 0 ? "[" + parsed.hostname + "]" : parsed.hostname;
    return "http://" + host + ":" + READ_PORT + parsed.pathname + parsed.search;
  } catch {
    return "";
  }
}

/** Adresse de lecture effective : celle saisie, sinon celle deduite. */
function readAddress(prefs) {
  const stored = String((prefs && prefs.readUrl) || "").trim();
  return isHttpDestination(stored) ? stored : derivedReadUrl((prefs && prefs.sharePath) || "");
}

/** Message du service de depot : il nomme la limite et la consequence. */
function apiTooHeavyMessage(bytes) {
  return "Le catalogue pèse " + Math.round(bytes / 1024) +
    " Ko ; le service de dépôt refuse au-delà de 1 Mo. Allégez les visuels " +
    "(Onglet Outils et Département).";
}

function apiNearLimitMessage(bytes) {
  return "Le catalogue pèse " + Math.round(bytes / 1024) +
    " Ko : proche de la limite de 1 Mo du service de dépôt.";
}

/** En-tetes communs : le serveur doit pouvoir identifier l'outil appelant. */
function baseHeaders() {
  return {
    Accept: "application/json",
    "User-Agent": "StrasEdu-Administration/" + app.getVersion()
  };
}

/** Erreur deja redigee pour l'administrateur : son message part tel quel. */
function explicitError(message) {
  const error = new Error(message);
  error.explicit = true;
  return error;
}

function timeoutError() {
  return explicitError(
    "Le serveur n'a pas répondu dans les " + Math.round(PUBLISH_TIMEOUT_MS / 1000) + " secondes."
  );
}

/**
 * Message commun aux deux modes, selon le code repondu. Il dit quoi faire :
 * « HTTP 412 » seul ne dirait pas a l'administrateur que quelqu'un d'autre a
 * publie entre-temps.
 */
function httpFailure(status, method) {
  if (status === 400) {
    return "Le serveur a refusé le document (HTTP 400) : il attend un objet JSON.";
  }
  if (status === 401) {
    return "Jeton de publication refusé (HTTP 401) : demandez un nouveau jeton au " +
      "service qui gère le dépôt. L'outil ne réessaie pas.";
  }
  if (status === 403) return "Le serveur refuse l'accès à cette adresse (HTTP 403).";
  if (status === 404) return "Adresse introuvable sur le serveur.";
  if (status === 405) {
    return method === "PUT"
      ? "Le serveur n'accepte pas le dépôt (PUT) à cette adresse."
      : "Le serveur n'accepte pas la lecture (GET) à cette adresse.";
  }
  if (status === 412) {
    return "Le catalogue publié a changé depuis la lecture : il a été modifié par " +
      "quelqu'un d'autre. Rechargez « Charger le catalogue publié », puis republiez.";
  }
  if (status === 413) {
    return "Le serveur refuse le document : il dépasse 1 Mo. Allégez les visuels " +
      "(Onglets Outils et Département).";
  }
  if (status === 503) {
    return "Le service de dépôt est indisponible sur le serveur (service désactivé, " +
      "ou jeton non configuré côté Raspberry).";
  }
  return "Le serveur a répondu HTTP " + status + ".";
}

/**
 * Echange HTTP borne dans le temps, sur le modele de fetchCatalog() de
 * l'application : suivi des redirections et lecture plafonnee. Le delai couvre
 * l'ensemble du dialogue ; sinon quatre renvois successifs tiendraient
 * l'administrateur bien plus longtemps que le delai annonce.
 *
 * Le corps envoye est un Buffer : Content-Length compte alors des octets, pas
 * des caracteres — un catalogue accentue ferait echouer un serveur strict si on
 * annoncait le nombre de caracteres.
 */
function httpExchange(method, url, options, deadline, redirects) {
  const opts = options || {};
  return new Promise((resolve, reject) => {
    const left = deadline - Date.now();
    if (left <= 0) return reject(timeoutError());

    let target;
    try {
      target = new URL(url);
    } catch {
      return reject(explicitError("Adresse invalide : " + displayUrl(url)));
    }

    const client = target.protocol === "https:" ? https : http;
    const headers = Object.assign(baseHeaders(), opts.headers || {});
    if (opts.body) headers["Content-Length"] = Buffer.byteLength(opts.body);

    const request = client.request(target, {
      method,
      headers,
      // L'agent epingle est fourni pour https ; sinon, une connexion propre a
      // cet appel, refermee aussitot : l'outil publie rarement, et une socket
      // laissee ouverte dans la reserve de l'agent retiendrait le serveur — un
      // serveur d'essai ne pourrait pas se fermer.
      agent: opts.agent || false
    }, (response) => {
      const status = response.statusCode || 0;

      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if ((redirects || 0) >= PUBLISH_REDIRECT_MAX) {
          return reject(explicitError(
            "Trop de redirections (au-delà de " + PUBLISH_REDIRECT_MAX + ")."
          ));
        }
        const next = new URL(response.headers.location, target).toString();
        return resolve(httpExchange(method, next, opts, deadline, (redirects || 0) + 1));
      }

      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_CATALOG_BYTES) {
          request.destroy();
          reject(explicitError("Le serveur a renvoyé une réponse trop volumineuse."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        // Les en-tetes remontent avec le corps : c'est l'ETag qui permet le
        // controle de concurrence du depot suivant.
        resolve({
          status,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf-8")
        });
      });
    });

    request.setTimeout(left, () => request.destroy(timeoutError()));
    request.on("error", (error) => {
      if (error && error.explicit) return reject(error);
      reject(explicitError("Le serveur est injoignable : " + error.message));
    });

    if (opts.body) request.write(opts.body);
    request.end();
  });
}

/** Retire le BOM : un serveur peut servir ce que le Bloc-notes a produit. */
function withoutBom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Lecture tolerante d'un corps JSON : un serveur peut repondre du texte. */
function parseJsonBody(text) {
  try {
    return JSON.parse(withoutBom(String(text || "")));
  } catch {
    return null;
  }
}

/** Version portee par un document deja lu. */
function versionOf(document) {
  return document && typeof document.version === "string" ? document.version : null;
}

/**
 * Relit le catalogue a l'adresse que les postes utilisent (http, sans jeton).
 * Un service peut accepter le depot et continuer a servir autre chose — cache,
 * mauvais dossier, chemin different : sans cette relecture, l'administrateur
 * croirait avoir diffuse. C'est exactement la panne silencieuse qu'on veut voir.
 */
async function verifyServedVersion(readUrl, expected) {
  if (!isHttpDestination(readUrl)) {
    return {
      ok: false,
      address: "",
      served: null,
      message: "Vérification non effectuée : adresse de lecture inconnue."
    };
  }

  let response;
  try {
    // Sans jeton : c'est la lecture des postes, telle quelle.
    response = await httpExchange("GET", readUrl, {}, Date.now() + PUBLISH_TIMEOUT_MS, 0);
  } catch (error) {
    return {
      ok: false,
      address: displayUrl(readUrl),
      served: null,
      message: "Vérification impossible sur " + displayUrl(readUrl) + " (" + error.message + ")."
    };
  }

  if (response.status !== 200) {
    return {
      ok: false,
      address: displayUrl(readUrl),
      served: null,
      message: "Le dépôt a été accepté, mais la lecture des postes échoue sur " +
        displayUrl(readUrl) + " : " + httpFailure(response.status, "GET")
    };
  }

  const served = versionOf(parseJsonBody(response.body));
  if (served !== expected) {
    return {
      ok: false,
      address: displayUrl(readUrl),
      served,
      message: "Le serveur a accepté le dépôt (v" + expected + ") mais l'adresse de lecture " +
        displayUrl(readUrl) + " sert encore la version " + (served || "inconnue") +
        " : vérifiez le chemin servi aux postes."
    };
  }

  return {
    ok: true,
    address: displayUrl(readUrl),
    served,
    message: "L'adresse de lecture " + displayUrl(readUrl) + " sert bien la version " +
      expected + "."
  };
}

/**
 * Meme verification pour un dossier : relire le fichier ecrit prouve que le
 * poste qui le lira y trouvera bien la version annoncee.
 */
function verifyServedFile(file, expected) {
  try {
    const served = versionOf(readCatalogFile(file));
    if (served !== expected) {
      return {
        ok: false,
        served,
        message: "Le fichier publié (v" + expected + ") porte la version " +
          (served || "inconnue") + " : vérifiez le dossier de publication."
      };
    }
    return { ok: true, served, message: "Fichier relu après écriture : version " + expected + "." };
  } catch (error) {
    return {
      ok: false,
      served: null,
      message: "Le fichier publié n'a pas pu être relu (" + error.message + ")."
    };
  }
}

/** Refus de publication, dans la forme attendue par l'interface. */
function refusePublish(problems, check, warnings) {
  return { ok: false, problems, badIds: check.badIds, warnings };
}

/**
 * Depot par le service du Raspberry : lecture prealable de l'ETag, envoi du
 * document avec If-Match, puis relecture de ce que les postes recoivent.
 *
 * Rien n'est retente en silence : un 412 signifie que quelqu'un d'autre a
 * publie, et rejouer le depot ecraserait son travail. Le jeton, lui, ne circule
 * que sur https, vers un certificat dont l'empreinte est verifiee avant tout
 * envoi.
 */
async function publishOverHttps(url, published, previousVersion, prefs, check, bytes) {
  const warnings = check.warnings.slice();

  // 1. Le jeton ne circule jamais en clair.
  if (!isHttpsDestination(url)) {
    return refusePublish([
      "Publication refusée : le jeton de publication ne circule qu'en HTTPS. En http, " +
        "il passerait en clair sur le réseau, lisible par n'importe qui — le port " + READ_PORT +
        " ne sert qu'à la lecture du catalogue."
    ], check, warnings);
  }

  // 2. Sans empreinte, aucune confiance possible dans le certificat presente.
  const rawFingerprint = String(prefs.certFingerprint || "").trim();
  if (!rawFingerprint) {
    return refusePublish([
      "Publication refusée : aucune empreinte de certificat n'est enregistrée. Sans elle, " +
        "l'outil ne peut pas vérifier l'identité du serveur et refuse de s'y connecter " +
        "(Onglet Application → Empreinte SHA-256 du certificat)."
    ], check, warnings);
  }
  const fingerprint = normalizeFingerprint(rawFingerprint);
  if (!fingerprintIsValid(fingerprint)) {
    return refusePublish([
      "Empreinte de certificat illisible : 64 caractères hexadécimaux sont attendus " +
        "(les « : » et la casse n'ont pas d'importance)."
    ], check, warnings);
  }

  // 3. Le jeton est indispensable : le service repondrait 401.
  const token = storedToken();
  if (!token) {
    return refusePublish([
      "Publication refusée : aucun jeton de publication n'est enregistré. Renseignez-le " +
        "dans l'onglet Application (il est chiffré par le système avant d'être écrit)."
    ], check, warnings);
  }

  // 4. Taille : inutile d'aller chercher un refus 413 sur le reseau.
  if (bytes > MAX_API_BYTES) {
    return refusePublish([apiTooHeavyMessage(bytes)], check, warnings);
  }
  if (bytes > WARN_API_BYTES) warnings.push(apiNearLimitMessage(bytes));

  const agent = pinnedAgent(fingerprint);
  const withToken = function (extra) {
    return Object.assign({ Authorization: "Bearer " + token }, extra || {});
  };

  try {
    // Lecture prealable : c'est elle qui donne l'ETag a renvoyer en If-Match.
    let head;
    try {
      head = await httpExchange("GET", url, { headers: withToken(), agent },
        Date.now() + PUBLISH_TIMEOUT_MS, 0);
    } catch (error) {
      return refusePublish(["Publication impossible : " + error.message], check, warnings);
    }
    if (head.status !== 200) {
      return refusePublish([httpFailure(head.status, "GET")], check, warnings);
    }

    const etag = head.headers && head.headers.etag ? String(head.headers.etag) : "";
    if (!etag) {
      warnings.push("Le serveur n'a pas renvoyé d'ETag : le dépôt s'est fait sans contrôle " +
        "de concurrence (If-Match).");
    }

    // Envoi : le corps est exactement la serialisation de writeCatalogFile,
    // pour que le document depose soit celui qu'un partage aurait recu.
    const putHeaders = { "Content-Type": "application/json" };
    if (etag) putHeaders["If-Match"] = etag;
    const body = Buffer.from(JSON.stringify(published, null, 2) + os.EOL, "utf-8");

    let response;
    try {
      response = await httpExchange("PUT", url, { headers: withToken(putHeaders), body, agent },
        Date.now() + PUBLISH_TIMEOUT_MS, 0);
    } catch (error) {
      return refusePublish(["Publication impossible : " + error.message], check, warnings);
    }

    // Le service repond 200 ; on tolere les autres formes de succes.
    if ([200, 201, 204].indexOf(response.status) < 0) {
      return refusePublish([httpFailure(response.status, "PUT")], check, warnings);
    }

    const ack = parseJsonBody(response.body) || {};
    const verification = await verifyServedVersion(readAddress(prefs), published.version);
    if (!verification.ok) warnings.push(verification.message);

    return {
      ok: true,
      status: response.status,
      version: published.version,
      previousVersion,
      path: displayUrl(url),
      etag: ack.etag ? String(ack.etag) : (etag || ""),
      modifieLe: ack.modifieLe ? String(ack.modifieLe) : "",
      catalog: published,
      warnings,
      verification
    };
  } finally {
    agent.destroy();
  }
}

/* ─── Validation avant enregistrement ou publication ─────────────────────── */

/**
 * Reprend exactement les règles de l'application, et nomme les outils fautifs
 * plutôt que de se contenter d'un compteur.
 */
function validateCatalog(catalog) {
  const problems = [];
  const warnings = [];
  const badIds = [];

  if (!catalog || typeof catalog !== "object") {
    return { ok: false, problems: ["Catalogue illisible."], badIds, warnings };
  }

  const version = asText(catalog.version, 32);
  if (!version) {
    problems.push("La version est vide : sans elle, aucun poste ne se mettra à jour.");
  }

  const declared = Array.isArray(catalog.categories) ? catalog.categories : [];
  if (!declared.length) warnings.push("Aucune catégorie déclarée : tous les outils iront dans « Autres ».");

  const meta = catalog.categoryMeta && typeof catalog.categoryMeta === "object" ? catalog.categoryMeta : {};
  for (const name of declared) {
    if (!meta[name]) warnings.push("Catégorie « " + name + " » sans icône ni description.");
  }
  for (const key of Object.keys(meta)) {
    if (declared.indexOf(key) < 0) warnings.push("Catégorie « " + key + " » paramétrée mais non déclarée.");
  }

  // Chaque outil est validé seul, avec les règles de l'application : s'il ne
  // survit pas à l'aller-retour, il serait écarté en silence sur les postes.
  const apps = Array.isArray(catalog.apps) ? catalog.apps : [];
  if (!apps.length) problems.push("Le catalogue ne contient aucun outil.");

  const seen = new Set();
  for (const entry of apps) {
    const label = asText(entry && entry.name, 60) || asText(entry && entry.id, 60) || "(sans nom)";
    const id = asText(entry && entry.id, 64);

    if (!id) {
      problems.push("« " + label + " » : identifiant manquant.");
      badIds.push(entry && entry.id);
      continue;
    }
    if (seen.has(id)) {
      problems.push("« " + label + " » : l'identifiant « " + id + " » est déjà utilisé.");
      badIds.push(id);
      continue;
    }
    seen.add(id);

    try {
      const single = normalizeCatalog({ version: "0", apps: [entry], categories: declared });
      if (!single.apps.length) {
        problems.push("« " + label + " » : adresse ou chemin refusé.");
        badIds.push(id);
      }
    } catch {
      problems.push("« " + label + " » : entrée invalide.");
      badIds.push(id);
    }
  }

  if (catalog.logo && !safeLogo(catalog.logo)) {
    problems.push(
      "Le logo dépasse " + Math.round(MAX_LOGO_CHARS / 1024) + " Ko ou n'est pas une image acceptée."
    );
  }

  // Poids du fichier : avertissement ici, refus à la publication. Un
  // enregistrement local reste possible — on ne perd pas le travail en cours.
  const bytes = catalogBytes(catalog);
  if (bytes > WARN_CATALOG_BYTES) warnings.push(tooHeavyMessage(bytes));

  return { ok: problems.length === 0, problems, badIds, warnings };
}

function bumpVersion(version) {
  const parts = String(version || "0.0.0").split(".");
  while (parts.length < 3) parts.push("0");
  parts[2] = String((parseInt(parts[2], 10) || 0) + 1);
  return parts.slice(0, 3).join(".");
}

/**
 * Encode une image en data URI sous le plafond du catalogue. Le PNG convient
 * aux captures d'écran (aplats, texte) ; une photographie, elle, le dépasse :
 * on retombe alors sur du JPEG à qualité décroissante, plutôt que de refuser
 * une image que l'administrateur a légitimement choisie.
 */
function encodeWithinBudget(image, maxChars) {
  const png = "data:image/png;base64," + image.toPNG().toString("base64");
  if (png.length <= maxChars) return png;

  for (const quality of [90, 80, 70, 60, 50]) {
    const jpeg = "data:image/jpeg;base64," + image.toJPEG(quality).toString("base64");
    if (jpeg.length <= maxChars) return jpeg;
  }
  return null;
}

/* ─── Fenêtre ────────────────────────────────────────────────────────────── */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1020,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#171a1c" : "#f3f6f5",
    autoHideMenuBar: true,
    icon: assetPath("icons-admin", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  return mainWindow;
}

/* ─── IPC ────────────────────────────────────────────────────────────────── */

function registerIpc() {
  ipcMain.handle("admin:state", () => {
    const prefs = readPrefs();

    // Fichier de travail : le dernier ouvert, sinon une copie du catalogue
    // livré, créée dans le profil pour être modifiable.
    let filePath = prefs.lastFilePath && fs.existsSync(prefs.lastFilePath)
      ? prefs.lastFilePath
      : null;
    if (!filePath) filePath = ensureWorkingCatalog();

    let catalog = null;
    let error = null;
    if (filePath) {
      try {
        catalog = readCatalogFile(filePath);
      } catch (err) {
        error = "Lecture impossible : " + err.message;
      }
    }

    return {
      catalog,
      filePath,
      sharePath: prefs.sharePath || "",
      readUrl: prefs.readUrl || "",
      certFingerprint: prefs.certFingerprint || "",
      // Le jeton lui-meme ne traverse jamais le pont : l'interface n'a besoin
      // que de savoir s'il y en a un, et sous quelle forme il est garde.
      hasToken: !!storedToken(),
      secureStorage: secureStorageAvailable(),
      tokenPersisted: !!prefs.publishTokenCipher && secureStorageAvailable(),
      defaultCatalog: bundledCatalog(),
      appVersion: app.getVersion(),
      dark: nativeTheme.shouldUseDarkColors,
      error
    };
  });

  /**
   * Preferences de l'onglet Application : destination, adresse de lecture,
   * empreinte de certificat et jeton.
   *
   * Le jeton n'est jamais ecrit en clair : il passe par le coffre du systeme
   * (DPAPI sous Windows). Si ce coffre n'existe pas, il reste en memoire pour la
   * session — et l'interface le dit, plutot que de l'ecrire en clair. Il n'est
   * jamais renvoye non plus : rien ne doit pouvoir le relire par erreur.
   */
  ipcMain.handle("admin:set-prefs", (_event, patch) => {
    const input = patch && typeof patch === "object" ? patch : {};
    const next = {};
    const remove = [];

    if (typeof input.sharePath === "string") next.sharePath = asText(input.sharePath, 2048);
    if (typeof input.readUrl === "string") next.readUrl = asText(input.readUrl, 2048);
    // L'empreinte n'est pas un secret : on la garde normalisee, pour que la
    // comparaison au certificat presente soit directe.
    if (typeof input.certFingerprint === "string") {
      next.certFingerprint = normalizeFingerprint(input.certFingerprint).slice(0, MAX_FINGERPRINT_CHARS);
    }

    if (typeof input.publishToken === "string" && input.publishToken) {
      const token = input.publishToken.slice(0, MAX_TOKEN_CHARS);
      if (secureStorageAvailable()) {
        try {
          next.publishTokenCipher = safeStorage.encryptString(token).toString("base64");
          sessionToken = null;
        } catch {
          // Le coffre a refuse : le jeton reste en memoire, jamais sur le disque.
          sessionToken = token;
        }
      } else {
        sessionToken = token;
      }
    }
    if (input.clearToken === true) {
      sessionToken = null;
      remove.push("publishTokenCipher");
    }

    const stored = writePrefs(next, remove);
    return {
      ok: true,
      hasToken: !!storedToken(),
      secureStorage: secureStorageAvailable(),
      tokenPersisted: !!stored.publishTokenCipher && secureStorageAvailable()
    };
  });

  ipcMain.handle("admin:open", async () => {
    const prefs = readPrefs();
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Ouvrir un catalogue",
      defaultPath: prefs.lastFilePath || bundledCatalog(),
      filters: [{ name: "Catalogue", extensions: ["json"] }],
      properties: ["openFile"]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };

    const filePath = result.filePaths[0];
    try {
      const catalog = readCatalogFile(filePath);
      writePrefs({ lastFilePath: filePath });
      return { ok: true, catalog, filePath };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  });

  /**
   * Lit le catalogue actuellement publié : dossier, ou adresse http(s).
   *
   * Par https, la lecture se fait avec le certificat épinglé et le jeton, comme
   * le dépôt. Par http, elle se fait SANS jeton — c'est la lecture des postes,
   * et un jeton y circulerait en clair.
   */
  ipcMain.handle("admin:load-share", async () => {
    const prefs = readPrefs();
    const share = String(prefs.sharePath || "").trim();
    if (!share) return { ok: false, error: "Aucune destination configurée." };

    if (isHttpDestination(share)) {
      const headers = {};
      let agent = null;

      if (isHttpsDestination(share)) {
        const fingerprint = normalizeFingerprint(prefs.certFingerprint);
        if (!fingerprintIsValid(fingerprint)) {
          return {
            ok: false,
            error: "Empreinte de certificat absente ou illisible : renseignez-la dans " +
              "l'onglet Application avant de lire par https."
          };
        }
        const token = storedToken();
        if (!token) {
          return { ok: false, error: "Aucun jeton de publication n'est enregistré." };
        }
        headers.Authorization = "Bearer " + token;
        agent = pinnedAgent(fingerprint);
      }

      try {
        const response = await httpExchange("GET", share, { headers, agent },
          Date.now() + PUBLISH_TIMEOUT_MS, 0);
        if (response.status !== 200) {
          return { ok: false, error: httpFailure(response.status, "GET") };
        }
        const catalog = parseJsonBody(response.body);
        if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
          return {
            ok: false,
            error: "Catalogue illisible : le serveur n'a pas renvoyé un objet JSON."
          };
        }
        return { ok: true, catalog, filePath: displayUrl(share) };
      } catch (error) {
        return { ok: false, error: "Lecture impossible : " + error.message };
      } finally {
        if (agent) agent.destroy();
      }
    }

    const file = path.join(share, "apps.json");
    try {
      return { ok: true, catalog: readCatalogFile(file), filePath: file };
    } catch (error) {
      return { ok: false, error: "Lecture impossible : " + error.message };
    }
  });

  ipcMain.handle("admin:save", (_event, catalog, targetPath) => {
    const check = validateCatalog(catalog);
    if (!check.ok) {
      return { ok: false, problems: check.problems, badIds: check.badIds, warnings: check.warnings };
    }

    const filePath = targetPath || readPrefs().lastFilePath || ensureWorkingCatalog();
    if (!filePath) {
      return {
        ok: false,
        problems: ["Aucun catalogue de travail : utilisez « Enregistrer sous… »."],
        badIds: check.badIds,
        warnings: check.warnings
      };
    }
    try {
      writeCatalogFile(filePath, catalog);
      writePrefs({ lastFilePath: filePath });
      return { ok: true, filePath, warnings: check.warnings };
    } catch (error) {
      return {
        ok: false,
        problems: ["Écriture impossible : " + error.message],
        badIds: check.badIds,
        warnings: check.warnings
      };
    }
  });

  ipcMain.handle("admin:save-as", async (_event, catalog) => {
    const check = validateCatalog(catalog);
    if (!check.ok) {
      return { ok: false, problems: check.problems, badIds: check.badIds, warnings: check.warnings };
    }

    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Enregistrer le catalogue",
      defaultPath: readPrefs().lastFilePath || workingCatalogPath(),
      filters: [{ name: "Catalogue", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };

    try {
      writeCatalogFile(result.filePath, catalog);
      writePrefs({ lastFilePath: result.filePath });
      return { ok: true, filePath: result.filePath, warnings: check.warnings };
    } catch (error) {
      return { ok: false, problems: ["Écriture impossible : " + error.message], badIds: check.badIds, warnings: check.warnings };
    }
  });

  ipcMain.handle("admin:choose-share", async () => {
    // Garde-fou : une destination en URL ne doit pas etre remplacee par un
    // dossier sans que l'administrateur l'ait demande. L'interface desactive deja
    // ce bouton dans ce cas ; ce refus couvre un appel direct.
    if (isHttpDestination(readPrefs().sharePath)) {
      return {
        ok: false,
        error: "La destination est une adresse http : effacez-la pour choisir un dossier."
      };
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choisir le dossier de publication (partage réseau)",
      defaultPath: readPrefs().sharePath || undefined,
      properties: ["openDirectory", "createDirectory"]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    writePrefs({ sharePath: result.filePaths[0] });
    return { ok: true, sharePath: result.filePaths[0] };
  });

  /**
   * Publie : validation, version incrémentée, puis dépôt — dossier partagé
   * (écriture atomique) ou service HTTPS (dépôt par requête), selon la forme de
   * la destination.
   */
  ipcMain.handle("admin:publish", async (_event, catalog) => {
    const check = validateCatalog(catalog);
    if (!check.ok) {
      return { ok: false, problems: check.problems, badIds: check.badIds, warnings: check.warnings };
    }

    const bytes = catalogBytes(catalog);
    const prefs = readPrefs();
    const share = String(prefs.sharePath || "").trim();
    if (!share) {
      return {
        ok: false,
        problems: ["Aucune destination de publication configurée."],
        badIds: check.badIds,
        warnings: check.warnings
      };
    }

    // Destination URL : les plafonds du service de depot s'appliquent, et ils
    // sont plus serres que ceux du fichier — publishOverHttps les controle avant
    // toute requete. Un catalogue trop lourd ecarte en silence par les postes ne
    // se verrait nulle part : on refuse ici, en nommant la limite.
    if (!isHttpDestination(share) && bytes > MAX_PUBLISH_BYTES) {
      return {
        ok: false,
        problems: [tooHeavyMessage(bytes)],
        badIds: check.badIds,
        warnings: check.warnings
      };
    }

    const published = Object.assign({}, catalog, {
      version: bumpVersion(catalog.version),
      lastUpdated: new Date().toISOString().slice(0, 10)
    });

    // Destination en URL : depot par requete. Tout le reste : ecriture fichier,
    // strictement inchangee — les installations sur partage SMB ne bougent pas.
    if (isHttpDestination(share)) {
      return publishOverHttps(share, published, catalog.version, prefs, check, bytes);
    }

    const target = path.join(share, "apps.json");
    try {
      writeCatalogFile(target, published);
    } catch (error) {
      return {
        ok: false,
        problems: ["Publication impossible : " + error.message],
        badIds: check.badIds,
        warnings: check.warnings
      };
    }

    const warnings = check.warnings.slice();
    const verification = verifyServedFile(target, published.version);
    if (!verification.ok) warnings.push(verification.message);

    return {
      ok: true,
      version: published.version,
      previousVersion: catalog.version,
      path: target,
      catalog: published,
      warnings,
      verification
    };
  });

  /** Logo officiel : image choisie, réduite par la couche native, en data URI. */
  ipcMain.handle("admin:pick-logo", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choisir le logo de l'établissement",
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "ico"] }],
      properties: ["openFile"]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };

    const image = nativeImage.createFromPath(result.filePaths[0]);
    if (image.isEmpty()) return { ok: false, error: "Image illisible." };

    const size = image.getSize();
    // Réduction à 128 px de haut : suffisant pour la vignette de StrasEdu, et
    // le logo reste petit dans le catalogue publié.
    const resized = size.height > 128 ? image.resize({ height: 128, quality: "best" }) : image;
    const dataUri = resized.toDataURL();

    if (!safeLogo(dataUri)) {
      return { ok: false, error: "Image trop lourde une fois encodée." };
    }
    return { ok: true, logo: dataUri, source: result.filePaths[0] };
  });

  /**
   * Visuel d'outil ou d'information : même traitement que le logo, à une
   * hauteur choisie par l'appelant (320 px pour une vignette, 200 px pour un
   * bandeau) et sous le plafond des images d'outil.
   */
  ipcMain.handle("admin:pick-image", async (_event, options) => {
    const opts = options && typeof options === "object" ? options : {};
    const asked = Math.round(Number(opts.height));
    const height = Number.isFinite(asked)
      ? Math.max(IMAGE_HEIGHT_MIN, Math.min(IMAGE_HEIGHT_MAX, asked))
      : IMAGE_HEIGHT_DEFAULT;

    const result = await dialog.showOpenDialog(mainWindow, {
      title: asText(opts.title, 80) || "Choisir une image",
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp"] }],
      properties: ["openFile"]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };

    const image = nativeImage.createFromPath(result.filePaths[0]);
    if (image.isEmpty()) return { ok: false, error: "Image illisible." };

    // Une image déjà plus petite que la cible n'est pas agrandie : cela
    // n'ajouterait que du poids au catalogue.
    const size = image.getSize();
    const resized = size.height > height ? image.resize({ height, quality: "best" }) : image;

    const dataUri = encodeWithinBudget(resized, MAX_IMAGE_CHARS);
    if (!dataUri || !safeImage(dataUri, MAX_IMAGE_CHARS)) {
      return { ok: false, error: "Image trop lourde une fois encodée." };
    }
    return { ok: true, image: dataUri, source: result.filePaths[0] };
  });

  ipcMain.handle("admin:reveal", (_event, filePath) => {
    if (filePath && fs.existsSync(filePath)) shell.showItemInFolder(filePath);
    return true;
  });

  ipcMain.handle("admin:validate", (_event, catalog) => {
    const check = validateCatalog(catalog);

    // Destination en URL : les plafonds du service de depot sont plus serres que
    // ceux du fichier. L'administrateur doit les voir AVANT de publier, dans la
    // barre d'etat, plutot que de decouvrir un refus au moment du depot.
    const prefs = readPrefs();
    if (isHttpDestination(prefs.sharePath)) {
      const bytes = catalogBytes(catalog);
      if (bytes > MAX_API_BYTES) {
        check.problems.push(apiTooHeavyMessage(bytes));
        check.ok = false;
      } else if (bytes > WARN_API_BYTES) {
        check.warnings.push(apiNearLimitMessage(bytes));
      }
    }

    return check;
  });
}

/* ─── Cycle de vie ───────────────────────────────────────────────────────── */

app.setName(APP_NAME);

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
