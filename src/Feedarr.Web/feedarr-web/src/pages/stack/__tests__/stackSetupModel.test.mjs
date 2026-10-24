import test from "node:test";
import assert from "node:assert/strict";
import { appUrl, isValidUsername, passwordProblems, statusOf } from "../stackSetupModel.js";

test("passwordProblems follows the Poisonarr policy", () => {
  assert.deepEqual(passwordProblems("Er0s-Jelszo!2026"), []);
  assert.deepEqual(passwordProblems("short"), ["length", "upper", "digit", "symbol"]);
  assert.ok(passwordProblems("alllowercase1!x").includes("upper"));
});

test("isValidUsername", () => {
  assert.equal(isValidUsername("richard"), true);
  assert.equal(isValidUsername("ab"), false);
  assert.equal(isValidUsername("with space"), false);
});

test("appUrl builds host:port urls", () => {
  assert.equal(appUrl(8989, "192.168.1.20"), "http://192.168.1.20:8989");
  assert.equal(appUrl(5055, "fe80::1"), "http://[fe80::1]:5055");
});

test("statusOf finds an app", () => {
  const s = { apps: [{ type: "radarr", online: true }] };
  assert.equal(statusOf(s, "radarr").online, true);
  assert.equal(statusOf(s, "sonarr"), null);
});
