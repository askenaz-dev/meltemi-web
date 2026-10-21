// The words of the sign-in pages: the chooser, the refusals of the flow and the account-exists
// page. Written by the sign-in routes (`routes/login.ts`, `routes/callback.ts`). A function holds a
// sentence with a name in it; its result is plain text and the page escapes it.

export const signinEn = {
  /** The providers' own names: the same in every language. */
  providers: { github: "GitHub", google: "Google" },

  chooserTitle: "Sign in",
  chooserIntro:
    "One Meltemi account for every Meltemi product. Choose how you want to sign in; there is no password to create or remember.",
  continueWith: (provider: string) => `Continue with ${provider}`,
  chooserNote:
    "Meltemi keeps the name, picture and email your provider shares, and the devices you are signed in on. Nothing else.",

  unknownProviderTitle: "That sign-in option does not exist",
  unknownProviderBody: "Meltemi signs you in with GitHub or with Google, and with nothing else.",
  returnToInvalidTitle: "That return address is not allowed",
  returnToInvalidBody:
    "Meltemi only sends you back to its own sites, so the sign-in was not started.",
  stateMismatchTitle: "This sign-in could not be confirmed",
  stateMismatchBody:
    "It did not start in this browser, it took more than ten minutes, or it was already used. Nothing was changed. Start again.",
  deniedTitle: "You were not signed in",
  deniedBody: (provider: string) =>
    `${provider} did not share your account with Meltemi, so nothing was created. You can try again whenever you like.`,
  unavailableTitle: (provider: string) => `${provider} did not answer`,
  unavailableBody: (provider: string) =>
    `Meltemi could not finish signing you in with ${provider}, and nothing was created. Try again in a moment, or use the other option.`,
  takenTitle: "That sign-in is already in use",
  takenBody: (provider: string) =>
    `This ${provider} account is already linked to another Meltemi account, so it was not added to this one. Nothing was changed.`,

  chooseAgain: "Choose how to sign in",
  tryAgain: "Try again",
  tryProviderAgain: (provider: string) => `Try ${provider} again`,
  goBack: "Go back",
  continue: "Continue",
  openAccount: "Open your account",
  signInWith: (provider: string) => `Sign in with ${provider}`,

  existsTitle: "An account with this email already exists",
  existsIntro: (current: string, existing: string, email: string, days: number) =>
    `You signed in with ${current} and a new Meltemi account was created for you. Another account already uses ${email} through ${existing}, but the last time Meltemi saw ${existing} confirm that address was more than ${days} days ago, so it did not join the two on its own.`,
  signedInAs: "Signed in as",
  existsOptions: (existing: string, current: string) =>
    `To use the account that already exists, sign in with ${existing}. To have one account for both, first delete this new account from its account page, then sign in with ${existing} and link ${current} from the account page there.`,
};

export const signinEs: typeof signinEn = {
  providers: { github: "GitHub", google: "Google" },

  chooserTitle: "Inicia sesión",
  chooserIntro:
    "Una sola cuenta de Meltemi para todos los productos de Meltemi. Elige cómo quieres iniciar sesión; no hay contraseña que crear ni recordar.",
  continueWith: (provider: string) => `Continuar con ${provider}`,
  chooserNote:
    "Meltemi guarda el nombre, la imagen y el correo que comparte tu proveedor, y los dispositivos en los que has iniciado sesión. Nada más.",

  unknownProviderTitle: "Esa opción de inicio de sesión no existe",
  unknownProviderBody: "Meltemi inicia sesión con GitHub o con Google, y con nada más.",
  returnToInvalidTitle: "Esa dirección de regreso no está permitida",
  returnToInvalidBody:
    "Meltemi solo te devuelve a sus propios sitios, así que no se inició el inicio de sesión.",
  stateMismatchTitle: "No se pudo confirmar este inicio de sesión",
  stateMismatchBody:
    "No empezó en este navegador, tardó más de diez minutos o ya se había usado. No se cambió nada. Empieza de nuevo.",
  deniedTitle: "No se inició sesión",
  deniedBody: (provider: string) =>
    `${provider} no compartió tu cuenta con Meltemi, así que no se creó nada. Puedes intentarlo de nuevo cuando quieras.`,
  unavailableTitle: (provider: string) => `${provider} no respondió`,
  unavailableBody: (provider: string) =>
    `Meltemi no pudo terminar de iniciar tu sesión con ${provider} y no se creó nada. Inténtalo de nuevo en un momento, o usa la otra opción.`,
  takenTitle: "Ese inicio de sesión ya está en uso",
  takenBody: (provider: string) =>
    `Esta cuenta de ${provider} ya está vinculada a otra cuenta de Meltemi, así que no se añadió a esta. No se cambió nada.`,

  chooseAgain: "Elegir cómo iniciar sesión",
  tryAgain: "Intentarlo de nuevo",
  tryProviderAgain: (provider: string) => `Intentar de nuevo con ${provider}`,
  goBack: "Volver",
  continue: "Continuar",
  openAccount: "Abrir tu cuenta",
  signInWith: (provider: string) => `Iniciar sesión con ${provider}`,

  existsTitle: "Ya existe una cuenta con este correo",
  existsIntro: (current: string, existing: string, email: string, days: number) =>
    `Iniciaste sesión con ${current} y se creó una cuenta nueva de Meltemi para ti. Otra cuenta ya usa ${email} a través de ${existing}, pero la última vez que Meltemi vio a ${existing} confirmar esa dirección fue hace más de ${days} días, así que no unió las dos por su cuenta.`,
  signedInAs: "Sesión iniciada como",
  existsOptions: (existing: string, current: string) =>
    `Para usar la cuenta que ya existe, inicia sesión con ${existing}. Para tener una sola cuenta con ambos, primero elimina esta cuenta nueva desde su página de cuenta, luego inicia sesión con ${existing} y vincula ${current} desde la página de cuenta de allí.`,
};
