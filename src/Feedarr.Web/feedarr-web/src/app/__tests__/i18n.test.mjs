import test from "node:test";
import assert from "node:assert/strict";
import { languageCode, pick } from "../i18n.js";

test("languageCode maps ui languages", () => {
  assert.equal(languageCode("hu-HU"), "hu");
  assert.equal(languageCode("en-US"), "en");
  assert.equal(languageCode("fr-FR"), "fr");
  assert.equal(languageCode(""), "fr");
});

test("pick returns the variant of the active language with fallbacks", () => {
  assert.equal(pick("Mentés", "Save", "Enregistrer", "hu-HU"), "Mentés");
  assert.equal(pick("Mentés", "Save", "Enregistrer", "en-US"), "Save");
  assert.equal(pick("Mentés", "Save", "Enregistrer", "fr-FR"), "Enregistrer");
  assert.equal(pick("Mentés", "Save", undefined, "fr-FR"), "Save");
});
