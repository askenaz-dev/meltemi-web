// The portal's words in Spanish, with the English catalog's type.

import type { Messages } from "./en.js";

export const es: Messages = {
  lang: "es",
  portal: {
    pill: "Docs",
    title: "Documentación de Meltemi",
    description:
      "La documentación de la familia Meltemi: Meltemi Diagrams, Meltemi IDE y Meltemi Web, en inglés y en español, tal como la trae la última release de cada uno.",
  },
  sections: {
    diagrams: {
      name: "Meltemi Diagrams",
      blurb:
        "Diagramas como código, ajustados en un lienzo: el lenguaje .meltemi, la línea de comandos, el editor para VS Code, la app web, las exportaciones y las historias.",
      action: "Leer las guías de Diagrams",
    },
    ide: {
      name: "Meltemi IDE",
      blurb:
        "El plano de control guiado por specs para agentes de código: instálalo, abre una sesión gobernada y lee el método, los agentes y las releases.",
      action: "Leer las guías del IDE",
    },
    web: {
      name: "Meltemi Web",
      blurb:
        "Tu cuenta compartida de Meltemi: inicia sesión, gestiona tu perfil, preferencias y sesiones, y usa las herramientas de administración autorizadas.",
      action: "Leer las guías de la cuenta",
    },
  },
  home: {
    title: "La documentación de Meltemi",
    tagline:
      "Todas las guías de la familia en un solo lugar, en inglés y en español, tal como las trae la última release de cada producto. Búscalas o hazles una pregunta.",
    searchHint: "Busca en todas las guías con",
    askHint: "o haz una pregunta con Pregunta a la documentación.",
    released: "Se muestra desde",
  },
  sidebar: {
    overview: "Resumen",
    other: "Otras páginas",
  },
  search: {
    button: "Buscar",
    close: "Cerrar búsqueda",
    scope: "Buscar en",
    all: "Toda la documentación",
    inProduct: (product: string) => `Buscar en ${product}`,
    unavailable: "No se pudo cargar la búsqueda. Cierra el diálogo e inténtalo de nuevo.",
  },
  footer: {
    from: (product: string) => `Desde ${product}`,
    published: (date: string) => `publicada el ${date}`,
    source: "Código en GitHub",
  },
  notice: {
    only: "Esta guía sólo existe en inglés.",
    read: "Leerla en inglés",
    lang: "en",
  },
  pictures: {
    label: (page: string, title: string) => (title ? `${title}, un diagrama de ${page}` : page),
  },
  account: {
    account: "Cuenta",
    navigation: "Cuenta personal",
    administration: "Administración",
    profile: "Perfil",
    preferences: "Preferencias",
    security: "Seguridad de la cuenta",
    signOut: "Cerrar sesión",
    checking: "Comprobando cuenta…",
  },
  ask: {
    button: "Preguntar",
    title: "Pregunta a la documentación",
    scope: "Usar guías de",
    intro:
      "Haz una pregunta con tus palabras: la respuesta se escribe sólo con las páginas del portal y nombra las páginas que usó.",
    placeholder: "¿Cómo exporto una historia como video?",
    label: "Tu pregunta",
    submit: "Preguntar",
    close: "Cerrar",
    counter: "{used} de {limit} caracteres",
    thinking: "Leyendo la documentación…",
    checking: "Comprobando disponibilidad…",
    sources: "Fuentes",
    notCovered: "La documentación no cubre esto.",
    allowance:
      "Las respuestas de IA no están disponibles temporalmente. Puedes seguir leyendo y buscando en las guías.",
    disabled:
      "Las respuestas de IA están desactivadas. Puedes seguir leyendo y buscando en todas las guías.",
    control:
      "Las respuestas de IA no están disponibles ahora. Vuelve a abrir Preguntar para reintentar o busca en las guías.",
    limit:
      "Ya son diez preguntas en un minuto. Espera un momento y vuelve a preguntar, o busca en las páginas.",
    index:
      "Las respuestas no están disponibles en esta versión del portal. La búsqueda sigue encontrando todas las páginas.",
    invalid: "Escribe una pregunta de 1 a 500 caracteres.",
    error: "No se pudo obtener la respuesta. Inténtalo de nuevo o busca en las páginas.",
    search: "Buscar en las páginas",
    privacy:
      "Tu pregunta se envía a Cloudflare Workers AI para responderla y no se guarda. Las respuestas pueden equivocarse: revisa las fuentes.",
    privacyLink: "Aviso de privacidad",
    privacyUrl: "https://meltemi.dev/es/privacy/",
    daily:
      "La lectura y la búsqueda siguen disponibles cuando las respuestas de IA están en pausa o no están disponibles.",
  },
};
