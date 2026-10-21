// The words every page shares. Each section of the catalog lives in its own file with both
// languages side by side; `en.ts` and `es.ts` gather them, and the Spanish object has the English
// one's type, so a missing or different word does not compile.

export const commonEn = {
  brand: "Meltemi",
  privacy: "Privacy notice",
  terms: "Terms",
  /** Before the code of an error, as in "Code: provider.unknown". */
  codeLabel: "Code",
  notFoundTitle: "Not found",
  notFoundBody: "There is nothing at this address.",
  internalTitle: "Something went wrong",
  internalBody:
    "The service could not finish this request, and nothing was changed. Try again in a moment.",
  badRequestTitle: "This request cannot be used",
  requestForbiddenTitle: "This request was refused",
  requestForbiddenBody:
    "It did not come from a page of this service, so nothing was changed. Go back and try again from the page.",
};

export const commonEs: typeof commonEn = {
  brand: "Meltemi",
  privacy: "Aviso de privacidad",
  terms: "Términos",
  codeLabel: "Código",
  notFoundTitle: "No encontrado",
  notFoundBody: "No hay nada en esta dirección.",
  internalTitle: "Algo salió mal",
  internalBody:
    "El servicio no pudo terminar esta petición y no se cambió nada. Inténtalo de nuevo en un momento.",
  badRequestTitle: "Esta petición no se puede usar",
  requestForbiddenTitle: "Se rechazó esta petición",
  requestForbiddenBody:
    "No venía de una página de este servicio, así que no se cambió nada. Vuelve atrás e inténtalo desde la página.",
};
