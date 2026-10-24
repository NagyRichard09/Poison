/**
 * Rating used for sorting: IMDb score (OMDb) first, TMDB/provider rating as fallback.
 * Both are on a 0-10 scale; unrated items sort last (-1).
 */
export function ratingSortValue(item) {
  const imdb = Number(item?.extImdbScore);
  if (Number.isFinite(imdb) && imdb > 0) return imdb;
  const rating = Number(item?.rating);
  if (Number.isFinite(rating) && rating > 0) return rating;
  return -1;
}
