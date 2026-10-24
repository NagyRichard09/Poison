import test from "node:test";
import assert from "node:assert/strict";
import { translateUiText } from "../runtimeTranslation.js";

test("French stays untouched in French", () => {
  assert.equal(translateUiText("Rechercher dans la bibliothèque", "fr-FR"), "Rechercher dans la bibliothèque");
});

test("whole phrases are translated instead of word by word", () => {
  assert.equal(translateUiText("Rechercher dans la bibliothèque", "hu-HU"), "Keresés a könyvtárban");
  assert.equal(translateUiText("Rechercher dans la bibliothèque", "en-US"), "Search the library");
  assert.equal(translateUiText("Chargement des paramètres…", "hu-HU"), "Beállítások betöltése…");
});

test("end punctuation is kept once, also after a French space", () => {
  assert.equal(translateUiText("Impossible de charger les indexeurs.", "hu-HU"), "Nem sikerült betölteni az indexelőket.");
  assert.equal(
    translateUiText("Reclasser l'existant pour cette source ?", "hu-HU"),
    "Újrasoroljuk a meglévő elemeket ennél a forrásnál?"
  );
});

test("pattern translations have Hungarian output", () => {
  assert.equal(translateUiText("Dernière synchro : 12:00", "hu-HU"), "Utolsó szinkron: 12:00");
  assert.equal(translateUiText("Dernière synchro : 12:00", "en-US"), "Last sync: 12:00");
  assert.equal(translateUiText("3 doublons supprimés", "hu-HU"), "3 duplikátum törölve");
});
