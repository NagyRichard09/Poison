import test from "node:test";
import assert from "node:assert/strict";
import { diskTone, fmtDiskBytes, usedPercent } from "../diskFormat.js";

test("fmtDiskBytes uses binary units and decimal comma", () => {
  assert.equal(fmtDiskBytes(0), "0 B");
  assert.equal(fmtDiskBytes(512), "512 B");
  assert.equal(fmtDiskBytes(1536 * 1024 * 1024), "1,5 GB");
  assert.equal(fmtDiskBytes(2 * 1024 ** 4), "2,0 TB");
});

test("usedPercent is clamped and rounded", () => {
  assert.equal(usedPercent({ totalBytes: 1000, freeBytes: 250 }), 75);
  assert.equal(usedPercent({ totalBytes: 0, freeBytes: 0 }), 0);
  assert.equal(usedPercent({ totalBytes: 100, freeBytes: 200 }), 0);
});

test("diskTone flags low volumes as critical", () => {
  assert.equal(diskTone({ isLow: true, totalBytes: 100, freeBytes: 90 }), "critical");
  assert.equal(diskTone({ totalBytes: 100, freeBytes: 10 }), "warn");
  assert.equal(diskTone({ totalBytes: 100, freeBytes: 50 }), "ok");
});
