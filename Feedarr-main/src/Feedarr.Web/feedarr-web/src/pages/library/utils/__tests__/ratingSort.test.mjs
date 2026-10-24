import test from "node:test";
import assert from "node:assert/strict";
import { ratingSortValue } from "../ratingSort.js";

test("ratingSortValue prefers IMDb score over provider rating", () => {
  assert.equal(ratingSortValue({ extImdbScore: 8.4, rating: 7.1 }), 8.4);
});

test("ratingSortValue falls back to provider rating", () => {
  assert.equal(ratingSortValue({ extImdbScore: null, rating: 6.5 }), 6.5);
  assert.equal(ratingSortValue({ extImdbScore: 0, rating: "7.2" }), 7.2);
});

test("ratingSortValue puts unrated items last", () => {
  assert.equal(ratingSortValue({}), -1);
  assert.equal(ratingSortValue(null), -1);
  const sorted = [{ id: 1 }, { id: 2, rating: 5 }, { id: 3, extImdbScore: 9 }]
    .sort((a, b) => ratingSortValue(b) - ratingSortValue(a))
    .map((x) => x.id);
  assert.deepEqual(sorted, [3, 2, 1]);
});
