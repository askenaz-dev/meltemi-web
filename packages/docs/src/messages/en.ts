// The portal's words in English. The Spanish catalog (`es.ts`) has this one's type, so a word
// added here and forgotten there fails `pnpm typecheck`. Starlight's own interface words (search,
// theme, language, table of contents) come from Starlight's catalogs in both languages.

export type Section = "diagrams" | "ide" | "web";

export const en = {
  lang: "en",
  portal: {
    pill: "Docs",
    title: "Meltemi docs",
    description:
      "The documentation of the Meltemi family: Meltemi Diagrams, the Meltemi IDE and Meltemi Web, in English and Spanish, as each one's latest release holds it.",
  },
  sections: {
    diagrams: {
      name: "Meltemi Diagrams",
      blurb:
        "Diagrams as code, adjusted on a canvas: the .meltemi language, the command line, the editor for VS Code, the web app, exports and stories.",
      action: "Read the Diagrams guides",
    },
    ide: {
      name: "Meltemi IDE",
      blurb:
        "The spec-driven control plane for coding agents: install it, start a governed session, read the method, the agents and the releases.",
      action: "Read the IDE guides",
    },
    web: {
      name: "Meltemi Web",
      blurb:
        "Your shared Meltemi account: sign in, manage your profile, preferences and sessions, and use authorized administration tools.",
      action: "Read the account guides",
    },
  } satisfies Record<Section, { name: string; blurb: string; action: string }>,
  home: {
    title: "The Meltemi documentation",
    tagline:
      "Every guide of the family in one place, in English and Spanish, as each product's latest release holds it. Search it, or ask it a question.",
    searchHint: "Search every guide with",
    askHint: "or ask a question with Ask the docs.",
    released: "Shown from",
    seaPause: "Pause animation",
    seaPlay: "Play animation",
  },
  sidebar: {
    overview: "Overview",
    other: "Other pages",
  },
  search: {
    button: "Search",
    close: "Close search",
    scope: "Search in",
    all: "All documentation",
    inProduct: (product: string) => `Search ${product}`,
    unavailable: "Search could not load. Close the dialog and try again.",
  },
  footer: {
    from: (product: string) => `From ${product}`,
    published: (date: string) => `published ${date}`,
    source: "Source on GitHub",
  },
  notice: {
    /** Shown on the English twin of a guide that exists in Spanish only. */
    only: "This guide exists in Spanish only.",
    read: "Read it in Spanish",
    lang: "es",
  },
  pictures: {
    label: (page: string, title: string) => (title ? `${title}, a diagram of ${page}` : page),
  },
  account: {
    account: "Account",
    navigation: "Personal account",
    administration: "Administration",
    profile: "Profile",
    preferences: "Preferences",
    security: "Account security",
    signOut: "Sign out",
    checking: "Checking account…",
  },
  ask: {
    button: "Ask",
    title: "Ask the docs",
    scope: "Use guides from",
    intro:
      "Ask a question in your own words: the answer is written from the portal's pages only, and names the pages it used.",
    placeholder: "How do I export a story as a video?",
    label: "Your question",
    submit: "Ask",
    close: "Close",
    /** `{used}` and `{limit}` are replaced by the dialog. */
    counter: "{used} of {limit} characters",
    thinking: "Reading the documentation…",
    checking: "Checking availability…",
    sources: "Sources",
    notCovered: "The documentation does not cover this.",
    allowance: "AI answers are temporarily unavailable. You can still read and search the guides.",
    disabled: "AI answers are turned off. You can still read and search all guides.",
    control: "AI answers are unavailable right now. Reopen Ask to try again, or search the guides.",
    limit: "That is ten questions in a minute. Wait a moment and ask again, or search the pages.",
    index:
      "Answers are not available for this build of the portal. The search still finds every page.",
    invalid: "Write a question of 1 to 500 characters.",
    error: "The answer could not be fetched. Try again, or search the pages.",
    search: "Search the pages",
    privacy:
      "Your question is sent to Cloudflare Workers AI to be answered and is not stored. Answers can be wrong: check the sources.",
    privacyLink: "Privacy notice",
    privacyUrl: "https://meltemi.dev/privacy/",
    daily: "Reading and search remain available when AI answers are paused or unavailable.",
  },
};

/** The shape of the catalog: the Spanish one must have it exactly. */
export type Messages = typeof en;
