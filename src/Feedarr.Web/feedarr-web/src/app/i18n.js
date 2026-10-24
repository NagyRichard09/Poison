import { useCallback, useEffect, useState } from "react";
import { getActiveUiLanguage } from "./locale.js";

/**
 * Explicit three-language text for new screens (hu / en / fr).
 *
 * The older screens are written in French and translated at runtime by
 * runtimeTranslation.js. New screens pass all three variants and mark their root
 * with data-no-ui-translate="1" so the runtime translator leaves them alone.
 */
export function languageCode(uiLanguage = getActiveUiLanguage()) {
  const raw = String(uiLanguage || "").trim().toLowerCase();
  if (raw.startsWith("hu")) return "hu";
  if (raw.startsWith("en")) return "en";
  return "fr";
}

export function pick(hu, en, fr, uiLanguage = getActiveUiLanguage()) {
  const code = languageCode(uiLanguage);
  if (code === "hu") return hu;
  if (code === "en") return en ?? hu;
  return fr ?? en ?? hu;
}

/** Current UI language, re-rendering when it changes (feedarr:ui-language-changed). */
export function useUiLanguage() {
  const [language, setLanguage] = useState(() => getActiveUiLanguage());
  useEffect(() => {
    const onChange = (event) => setLanguage(event?.detail?.language || getActiveUiLanguage());
    window.addEventListener("feedarr:ui-language-changed", onChange);
    return () => window.removeEventListener("feedarr:ui-language-changed", onChange);
  }, []);
  return language;
}

/** Hook returning L(hu, en, fr). */
export function useL() {
  const language = useUiLanguage();
  return useCallback((hu, en, fr) => pick(hu, en, fr, language), [language]);
}

/** Props that stop the runtime (French → x) translator from touching a subtree. */
export const NO_RUNTIME_TRANSLATE = { "data-no-ui-translate": "1" };
