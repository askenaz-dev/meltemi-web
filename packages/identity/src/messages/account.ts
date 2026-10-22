// The words of the account pages: sign-out, the account page, its refusals and the page that says
// the account is gone. Written by the account routes (`routes/logout.ts`, `routes/account.ts`).
// Every value is plain text (no markup, no apostrophes): the pages escape it.

export const accountEn = {
  // Signing out
  logoutTitle: "Sign out",
  logoutBody:
    "You are about to sign out of your Meltemi account on this browser. Your account stays as it is, and you can sign in again at any time.",
  logoutButton: "Sign out",
  logoutStay: "Stay signed in",

  // Ways forward from a refusal
  backToAccount: "Back to your account",
  backToSite: "Go to the Meltemi site",
  /** Before the host of the product a person came from: "Back to diagrams.meltemi.dev". */
  backTo: "Back to",

  // Refusals (their stable codes are on the page)
  returnToInvalidTitle: "This return address is not allowed",
  returnToInvalidBody: "Only addresses of Meltemi products can be used. Nothing was changed.",
  identityLastTitle: "This is your only sign-in",
  identityLastBody:
    "An account needs at least one linked sign-in. Link another provider first, then unlink this one. Nothing was changed.",
  providerUnknownTitle: "Unknown provider",
  providerUnknownBody: "Meltemi signs you in with GitHub or Google only. Nothing was changed.",
  confirmMismatchTitle: "The confirmation does not match",
  confirmMismatchBody:
    "Type the word shown next to the field exactly as it appears. Nothing was deleted.",
  sessionCurrentTitle: "This is the session you are using",
  sessionCurrentBody:
    "To sign out here, use Sign out on the row of this session. Nothing was changed.",
  sessionNotFoundTitle: "Session not found",
  sessionNotFoundBody: "None of your sessions has that id. Nothing was changed.",

  // The account page
  accountTitle: "Your account",
  accountIntro: "One account signs you in to every Meltemi product.",
  identitiesHeading: "Linked sign-ins",
  colProvider: "Provider",
  colAccount: "Account",
  colLinked: "Linked",
  providerGithub: "GitHub",
  providerGoogle: "Google",
  unlinkButton: "Unlink",
  onlyIdentityNote: "This is your only sign-in. Link another provider before you unlink it.",
  linkHeading: "Link another provider",
  linkGithub: "Link GitHub",
  linkGoogle: "Link Google",
  sessionsHeading: "Where you are signed in",
  colDevice: "Device",
  colSignedIn: "Signed in",
  colLastSeen: "Last seen",
  thisSession: "This session",
  /** Joins the browser and the system of a session label: "Edge on Windows". */
  labelJoin: "on",
  otherBrowser: "Other browser",
  otherSystem: "Other system",
  revokeOthersNote: "Ends every other session. You stay signed in here.",
  revokeOthersButton: "Sign out of other devices",
  signOutButton: "Sign out",
  /** On the row of another session: ends that one only. */
  signOutDevice: "Sign out",
  deleteHeading: "Delete your account",
  deleteBody:
    "This removes your account, its linked sign-ins and every session, and every Meltemi product deletes the data it holds about you within seven days. It cannot be undone.",
  /** Before and after the word to type: "Type delete to confirm". */
  deleteConfirmBefore: "Type",
  deleteConfirmAfter: "to confirm",
  /** The word that confirms a deletion on a page in this language. */
  deleteWord: "delete",
  deleteButton: "Delete my account",

  // The page after a deletion
  deletedTitle: "Account deleted",
  deletedBody:
    "Your account, its linked sign-ins and its sessions are gone. The Meltemi products delete the data they hold about you within seven days.",
  deletedLink: "Go to the Meltemi site",
};

export const accountEs: typeof accountEn = {
  // Cerrar sesión
  logoutTitle: "Cerrar sesión",
  logoutBody:
    "Vas a cerrar la sesión de tu cuenta de Meltemi en este navegador. Tu cuenta sigue como está y puedes volver a entrar cuando quieras.",
  logoutButton: "Cerrar sesión",
  logoutStay: "Seguir con la sesión iniciada",

  backToAccount: "Volver a tu cuenta",
  backToSite: "Ir al sitio de Meltemi",
  backTo: "Volver a",

  returnToInvalidTitle: "Esta dirección de retorno no está permitida",
  returnToInvalidBody:
    "Solo se pueden usar direcciones de los productos de Meltemi. No se cambió nada.",
  identityLastTitle: "Es tu único inicio de sesión",
  identityLastBody:
    "Una cuenta necesita al menos un inicio de sesión vinculado. Vincula antes otro proveedor y después desvincula este. No se cambió nada.",
  providerUnknownTitle: "Proveedor desconocido",
  providerUnknownBody: "Meltemi solo inicia sesión con GitHub o Google. No se cambió nada.",
  confirmMismatchTitle: "La confirmación no coincide",
  confirmMismatchBody:
    "Escribe exactamente la palabra que aparece junto al campo. No se eliminó nada.",
  sessionCurrentTitle: "Es la sesión que estás usando",
  sessionCurrentBody:
    "Para cerrar la sesión aquí, usa Cerrar sesión en la fila de esta sesión. No se cambió nada.",
  sessionNotFoundTitle: "Sesión no encontrada",
  sessionNotFoundBody: "Ninguna de tus sesiones tiene ese identificador. No se cambió nada.",

  accountTitle: "Tu cuenta",
  accountIntro: "Una sola cuenta inicia sesión en todos los productos de Meltemi.",
  identitiesHeading: "Inicios de sesión vinculados",
  colProvider: "Proveedor",
  colAccount: "Cuenta",
  colLinked: "Vinculado",
  providerGithub: "GitHub",
  providerGoogle: "Google",
  unlinkButton: "Desvincular",
  onlyIdentityNote: "Es tu único inicio de sesión. Vincula otro proveedor antes de desvincularlo.",
  linkHeading: "Vincular otro proveedor",
  linkGithub: "Vincular GitHub",
  linkGoogle: "Vincular Google",
  sessionsHeading: "Dónde tienes la sesión iniciada",
  colDevice: "Dispositivo",
  colSignedIn: "Sesión iniciada",
  colLastSeen: "Última actividad",
  thisSession: "Esta sesión",
  labelJoin: "en",
  otherBrowser: "Otro navegador",
  otherSystem: "otro sistema",
  revokeOthersNote: "Cierra todas las demás sesiones. En esta sigues con la sesión iniciada.",
  revokeOthersButton: "Cerrar sesión en los otros dispositivos",
  signOutButton: "Cerrar sesión",
  signOutDevice: "Cerrar sesión",
  deleteHeading: "Eliminar tu cuenta",
  deleteBody:
    "Esto elimina tu cuenta, sus inicios de sesión vinculados y todas las sesiones, y cada producto de Meltemi borra los datos que guarda sobre ti en un plazo de siete días. No se puede deshacer.",
  deleteConfirmBefore: "Escribe",
  deleteConfirmAfter: "para confirmar",
  deleteWord: "eliminar",
  deleteButton: "Eliminar mi cuenta",

  deletedTitle: "Cuenta eliminada",
  deletedBody:
    "Tu cuenta, sus inicios de sesión vinculados y sus sesiones han desaparecido. Los productos de Meltemi borran los datos que guardan sobre ti en un plazo de siete días.",
  deletedLink: "Ir al sitio de Meltemi",
};
