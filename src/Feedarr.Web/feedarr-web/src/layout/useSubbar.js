import { useContext } from "react";
import { SubbarContentContext, SubbarSetterContext } from "./subbarContextStore.js";

export function useSubbar() {
  const content = useContext(SubbarContentContext);
  const setContent = useContext(SubbarSetterContext);
  if (setContent === undefined) throw new Error("useSubbar must be used inside SubbarProvider");
  return { content, setContent };
}

export function useSubbarSetter() {
  const setContent = useContext(SubbarSetterContext);
  if (setContent === undefined) throw new Error("useSubbarSetter must be used inside SubbarProvider");
  return setContent;
}

/** Like useSubbarSetter, but returns null outside a SubbarProvider (e.g. the setup shell). */
export function useOptionalSubbarSetter() {
  const setContent = useContext(SubbarSetterContext);
  return setContent === undefined ? null : setContent;
}
