import test from "node:test";
import assert from "node:assert/strict";
import { isMixedContent, isSafeAppUrl, resolveAppUrl, slugifyAppId } from "../appLinks.js";

test("resolveAppUrl replaces every {host}", () => {
  assert.equal(resolveAppUrl("http://{host}:8989", "192.168.1.20"), "http://192.168.1.20:8989");
  assert.equal(resolveAppUrl("http://{host}:1/{host}", "nas"), "http://nas:1/nas");
  assert.equal(resolveAppUrl("http://{host}:5055", "fe80::1"), "http://[fe80::1]:5055");
});

test("isSafeAppUrl only accepts http(s)", () => {
  assert.equal(isSafeAppUrl("http://{host}:8989"), true);
  assert.equal(isSafeAppUrl("https://sonarr.example.com"), true);
  assert.equal(isSafeAppUrl("javascript:alert(1)"), false);
  assert.equal(isSafeAppUrl("not a url"), false);
});

test("isMixedContent detects http frames on https pages", () => {
  assert.equal(isMixedContent("http://x:1", "https:"), true);
  assert.equal(isMixedContent("https://x:1", "https:"), false);
  assert.equal(isMixedContent("http://x:1", "http:"), false);
});

test("slugifyAppId creates unique, ascii ids", () => {
  assert.equal(slugifyAppId("Jellyfin Szerver"), "jellyfin-szerver");
  assert.equal(slugifyAppId("Ügyfél", []), "ugyfel");
  assert.equal(slugifyAppId("sonarr", ["sonarr", "sonarr-2"]), "sonarr-3");
});
