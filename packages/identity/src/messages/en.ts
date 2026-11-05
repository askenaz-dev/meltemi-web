import { accountEn } from "./account.js";
import { commonEn } from "./common.js";
import { docsAiEn } from "./docs-ai.js";
import { signinEn } from "./signin.js";

export const en = { common: commonEn, signin: signinEn, account: accountEn, docsAi: docsAiEn };

/** The shape of the catalog: the Spanish one must have it exactly. */
export type Messages = typeof en;
