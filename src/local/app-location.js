export const appBase = import.meta.env.BASE_URL;
export const storageKey = (key) =>
  appBase === "/" ? key : "sourcebook-7:" + appBase + ":" + key;
