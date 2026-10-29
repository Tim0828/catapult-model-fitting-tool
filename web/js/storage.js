/**
 * Persistence of a team's work: localStorage for "keep it on this device" and
 * a URL hash for "bookmark it / send it to a teammate". Both hold the same
 * versioned JSON document. Storage can be unavailable (private mode, blocked
 * site data), so every access is guarded and failures are non-fatal.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CatapultStorage = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const STORAGE_KEY = "catapult-challenge/v1";
  const HASH_PREFIX = "#s=";
  const VERSION = 1;

  function toBase64Url(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = "";
    bytes.forEach((b) => (bin += String.fromCharCode(b)));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromBase64Url(encoded) {
    const b64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  /** Parse and minimally validate a saved document; returns null if unusable. */
  function parse(json) {
    try {
      const doc = JSON.parse(json);
      if (!doc || typeof doc !== "object" || doc.version !== VERSION) return null;
      return doc;
    } catch (e) {
      return null;
    }
  }

  function encodeHash(state) {
    return HASH_PREFIX + toBase64Url(JSON.stringify(Object.assign({}, state, { version: VERSION })));
  }

  function decodeHash(hash) {
    if (!hash || hash.indexOf(HASH_PREFIX) !== 0) return null;
    try {
      return parse(fromBase64Url(hash.slice(HASH_PREFIX.length)));
    } catch (e) {
      return null;
    }
  }

  function save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.assign({}, state, { version: VERSION })));
      return true;
    } catch (e) {
      return false;
    }
  }

  function load() {
    try {
      return parse(localStorage.getItem(STORAGE_KEY));
    } catch (e) {
      return null;
    }
  }

  function clear() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      /* nothing stored, nothing to clear */
    }
  }

  return { VERSION, encodeHash, decodeHash, save, load, clear };
});
