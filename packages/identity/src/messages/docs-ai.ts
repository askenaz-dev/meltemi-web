export const docsAiEn = {
  title: "Documentation AI",
  intro:
    "Global control for Ask the docs, shared across all product environments. The guides and page search stay available.",
  enabled: "Answers are enabled.",
  disabled: "Answers are paused.",
  effect:
    "Pausing stops new AI requests and new documentation embeddings. Requests already running may finish. This setting survives deployments.",
  enable: "Enable answers",
  disable: "Pause answers",
  unavailableTitle: "The AI setting is unavailable",
  unavailableBody:
    "No new AI requests are allowed until its saved state can be read. Try again later.",
  invalidTitle: "Choose an explicit action",
  invalidBody: "Choose Enable answers or Pause answers. Nothing was changed.",
};

export const docsAiEs: typeof docsAiEn = {
  title: "IA de la documentación",
  intro:
    "Control global de Pregunta a la documentación, compartido entre todos los entornos de los productos. Las guías y la búsqueda de páginas siguen disponibles.",
  enabled: "Las respuestas están activadas.",
  disabled: "Las respuestas están en pausa.",
  effect:
    "La pausa detiene las nuevas solicitudes de IA y los nuevos embeddings de la documentación. Las solicitudes en curso pueden terminar. Esta configuración se conserva entre despliegues.",
  enable: "Activar respuestas",
  disable: "Pausar respuestas",
  unavailableTitle: "La configuración de IA no está disponible",
  unavailableBody:
    "No se permiten nuevas solicitudes de IA hasta poder leer el estado guardado. Inténtalo más tarde.",
  invalidTitle: "Elige una acción explícita",
  invalidBody: "Elige Activar respuestas o Pausar respuestas. No se cambió nada.",
};
