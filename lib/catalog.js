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

/** Data URI d'image acceptée pour le logo. */
const LOGO_PATTERN = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/;

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

function safeLogo(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  if (raw.length > MAX_LOGO_CHARS) return null;
  return LOGO_PATTERN.test(raw) ? raw : null;
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

  return result;
}

module.exports = {
  MAX_LOGO_CHARS,
  asText,
  safeExternalUrl,
  safeLocalPath,
  safeLogo,
  normalizeCatalog
};
