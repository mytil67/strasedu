/* ==========================================================================
   StrasEdu — validation et normalisation du catalogue
   --------------------------------------------------------------------------
   Module partagé par les deux processus principaux :

     • main.js       — valide ce qu'elle reçoit du réseau ou d'un partage
                       avant de l'installer (frontière de confiance) ;
     • admin/main.js — valide avant d'enregistrer ou de publier, pour ne jamais
                       diffuser un catalogue que les postes écarteraient en
                       silence.

   Une seule implémentation des règles : elles ne peuvent pas diverger.

   Aucune dépendance à Electron : testable seul.
   ========================================================================== */

"use strict";

const path = require("path");

const ALLOWED_LOCAL_EXT = [".exe", ".lnk"];

/** Taille maximale du logo, en caractères de data URI (~190 Ko d'image). */
const MAX_LOGO_CHARS = 256 * 1024;

/** Taille maximale d'un visuel d'outil ou d'information (vignette, bandeau). */
const MAX_IMAGE_CHARS = 512 * 1024;

/** Nombre maximal de captures d'écran par outil. */
const MAX_SCREENSHOTS = 4;

/** Nombre maximal d'informations du département. */
const MAX_NEWS_ITEMS = 12;

/** Nombre maximal de mises en avant composées par l'administrateur. */
const MAX_HIGHLIGHTS = 3;

/** Enveloppe maximale des visuels d'outils, en caractères de data URI. */
const MAX_APP_IMAGES_CHARS = 6 * 1024 * 1024;

/** Data URI d'image acceptée : logo, vignette d'outil, bandeau d'information. */
const IMAGE_PATTERN = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/;

/** Ancien nom, conservé pour les appelants existants. */
const LOGO_PATTERN = IMAGE_PATTERN;

/** Nom d'icône : camelCase simple, tel que déclaré dans renderer/icons.js. */
const ICON_PATTERN = /^[a-z][a-zA-Z]{0,39}$/;

function asText(value, max) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return max ? trimmed.slice(0, max) : trimmed;
}

function safeExternalUrl(value) {
  const raw = asText(value, 2048);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function safeLocalPath(value, allowedRoots) {
  const raw = asText(value, 1024);
  if (!raw || !path.isAbsolute(raw)) return null;
  if (ALLOWED_LOCAL_EXT.indexOf(path.extname(raw).toLowerCase()) < 0) return null;

  let resolved;
  try {
    resolved = path.resolve(raw);
  } catch {
    return null;
  }

  if (allowedRoots && allowedRoots.length) {
    const lowered = resolved.toLowerCase();
    const allowed = allowedRoots.some(
      (root) => lowered === root || lowered.startsWith(root + path.sep)
    );
    if (!allowed) return null;
  }
  return resolved;
}

/**
 * Valide une image embarquée : data URI d'image, sous le plafond demandé.
 * @param {unknown} value
 * @param {number} [maxChars]
 * @returns {string|null}
 */
function safeImage(value, maxChars) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  if (raw.length > (maxChars || MAX_IMAGE_CHARS)) return null;
  return IMAGE_PATTERN.test(raw) ? raw : null;
}

function safeLogo(value) {
  return safeImage(value, MAX_LOGO_CHARS);
}

/**
 * Valide et normalise un catalogue. Toute entrée inexploitable est écartée
 * plutôt que de faire échouer l'ensemble : un catalogue partiellement erroné
 * reste utilisable en classe.
 *
 * @param {object} raw      catalogue brut
 * @param {object} [options]
 * @param {string[]} [options.allowedLocalRoots] racines autorisées pour les
 *        outils « local ». Absent = tout chemin absolu en .exe/.lnk.
 * @param {(message: string) => void} [options.onNotice] journal des rejets
 */
function normalizeCatalog(raw, options) {
  const opts = options || {};
  const roots = Array.isArray(opts.allowedLocalRoots) ? opts.allowedLocalRoots : null;
  const notice = typeof opts.onNotice === "function" ? opts.onNotice : () => {};

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("catalogue illisible");
  }

  const rawApps = Array.isArray(raw.apps) ? raw.apps : [];
  const apps = [];
  const seen = new Set();
  let rejected = 0;
  let imageBudget = MAX_APP_IMAGES_CHARS;

  for (const entry of rawApps) {
    if (!entry || typeof entry !== "object") {
      rejected += 1;
      continue;
    }
    const id = asText(entry.id, 64);
    if (!id || seen.has(id)) {
      rejected += 1;
      continue;
    }

    const name = asText(entry.name, 120) || id;
    const type = entry.type === "local" ? "local" : "web";
    const appEntry = {
      id,
      name,
      category: asText(entry.category, 60) || "Autres",
      description: asText(entry.description, 400),
      mark: asText(entry.mark, 4) || name.slice(0, 2),
      meta: asText(entry.meta, 80),
      badge: Number.isFinite(entry.badge) ? Math.max(0, Math.min(999, Math.floor(entry.badge))) : 0,
      keywords: Array.isArray(entry.keywords)
        ? entry.keywords.map((word) => asText(word, 40)).filter(Boolean).slice(0, 24)
        : [],
      type
    };

    // Icône explicite, choisie dans renderer/icons.js. Un nom inconnu est sans
    // conséquence : le rendu retombe sur la pastille à deux lettres.
    const icon = asText(entry.icon, 40);
    if (icon && ICON_PATTERN.test(icon)) appEntry.icon = icon;

    // Visuels de l'outil : une vignette, puis jusqu'à quatre captures d'écran.
    // Embarqués en data URI pour qu'une seule publication suffise ; le budget
    // global empêche qu'un catalogue devienne impossible à distribuer.
    const image = safeImage(entry.image, MAX_IMAGE_CHARS);
    if (image && imageBudget >= image.length) {
      appEntry.image = image;
      imageBudget -= image.length;
    } else if (image) {
      notice("budget d'images atteint : vignette ignorée pour « " + name + " »");
    }

    const rawShots = Array.isArray(entry.screenshots) ? entry.screenshots : [];
    const screenshots = [];
    for (const shot of rawShots) {
      if (screenshots.length >= MAX_SCREENSHOTS) break;
      const clean = safeImage(shot, MAX_IMAGE_CHARS);
      if (!clean) {
        if (shot) notice("capture d'écran refusée pour « " + name + " »");
        continue;
      }
      if (imageBudget < clean.length) {
        notice("budget d'images atteint : captures suivantes ignorées");
        break;
      }
      screenshots.push(clean);
      imageBudget -= clean.length;
    }
    if (screenshots.length) appEntry.screenshots = screenshots;

    if (type === "web") {
      const url = safeExternalUrl(entry.url);
      if (!url) {
        rejected += 1;
        continue;
      }
      appEntry.url = url;
    } else {
      const localPath = safeLocalPath(entry.path, roots);
      if (!localPath) {
        notice("chemin local refusé pour « " + name + " » : " + asText(entry.path, 120));
        rejected += 1;
        continue;
      }
      appEntry.path = localPath;
    }

    seen.add(id);
    apps.push(appEntry);
  }

  const declared = Array.isArray(raw.categories) ? raw.categories : [];
  const categories = [];
  for (const item of declared) {
    const label = typeof item === "string" ? item : item && (item.name || item.label);
    const clean = asText(label, 60);
    if (clean && categories.indexOf(clean) < 0) categories.push(clean);
  }
  for (const entry of apps) {
    if (categories.indexOf(entry.category) < 0) categories.push(entry.category);
  }

  const rawMeta = raw.categoryMeta && typeof raw.categoryMeta === "object" ? raw.categoryMeta : {};
  const categoryMeta = {};
  for (const [key, value] of Object.entries(rawMeta)) {
    if (!value || typeof value !== "object") continue;
    const meta = {};
    const icon = asText(value.icon, 40);
    if (icon && ICON_PATTERN.test(icon)) meta.icon = icon;
    if (/^#[0-9a-f]{6}$/i.test(asText(value.color, 9))) meta.color = asText(value.color, 9);
    if (asText(value.description, 300)) meta.description = asText(value.description, 300);
    if (Object.keys(meta).length) categoryMeta[key] = meta;
  }

  if (!apps.length) throw new Error("aucun outil valide dans le catalogue");

  // Informations du département informatique : carrousel poussé par
  // l'administration. Chaque élément porte un texte, et éventuellement une
  // image et un lien.
  let news = null;
  const rawNews =
    raw.news && typeof raw.news === "object" && !Array.isArray(raw.news) ? raw.news : null;
  if (rawNews) {
    const items = [];
    const list = Array.isArray(rawNews.items) ? rawNews.items : [];
    for (const item of list) {
      if (items.length >= MAX_NEWS_ITEMS) break;
      if (!item || typeof item !== "object") continue;

      const title = asText(item.title, 120);
      const text = asText(item.text, 600);
      const image = safeImage(item.image, MAX_IMAGE_CHARS);
      const url = safeExternalUrl(item.url);
      if (!title && !text && !image) continue;

      const clean = { id: asText(item.id, 64) || "info-" + (items.length + 1), title, text };
      if (image) clean.image = image;
      if (url) {
        clean.url = url;
        clean.linkLabel = asText(item.linkLabel, 60) || "En savoir plus";
      }
      const date = asText(item.date, 32);
      if (date) clean.date = date;
      items.push(clean);
    }
    if (items.length) {
      news = { items };
      const heading = asText(rawNews.title, 120);
      if (heading) news.title = heading;
      const subtitle = asText(rawNews.subtitle, 200);
      if (subtitle) news.subtitle = subtitle;
    }
  }

  // Mises en avant composées par l'administrateur (« du moment », « du mois »).
  // Les identifiants inconnus sont écartés : le rendu ne pointe jamais dans le
  // vide, même si un outil a été retiré après coup.
  const highlights = [];
  const known = new Set(apps.map((app) => app.id));
  const rawHighlights = Array.isArray(raw.highlights) ? raw.highlights : [];
  for (const group of rawHighlights) {
    if (highlights.length >= MAX_HIGHLIGHTS) break;
    if (!group || typeof group !== "object") continue;

    const declared = Array.isArray(group.appIds) ? group.appIds : [];
    const ids = [];
    for (const value of declared) {
      const id = asText(value, 64);
      if (!id || !known.has(id) || ids.indexOf(id) >= 0) continue;
      ids.push(id);
      if (ids.length >= 12) break;
    }
    if (!ids.length) continue;
    highlights.push({ label: asText(group.label, 60) || "À la une", appIds: ids });
  }

  const result = {
    schema: 2,
    version: asText(raw.version, 32) || "0.0.0",
    lastUpdated: asText(raw.lastUpdated, 32),
    categories,
    categoryMeta,
    apps,
    rejected
  };

  // Logo de StrasEdu : embarqué dans le catalogue plutôt que livré comme
  // fichier séparé, pour qu'une seule publication suffise.
  const logo = safeLogo(raw.logo);
  if (logo) result.logo = logo;
  if (news) result.news = news;
  if (highlights.length) result.highlights = highlights;

  return result;
}

module.exports = {
  MAX_LOGO_CHARS,
  MAX_IMAGE_CHARS,
  MAX_SCREENSHOTS,
  MAX_NEWS_ITEMS,
  MAX_HIGHLIGHTS,
  MAX_APP_IMAGES_CHARS,
  IMAGE_PATTERN,
  asText,
  safeExternalUrl,
  safeLocalPath,
  safeImage,
  safeLogo,
  normalizeCatalog
};
