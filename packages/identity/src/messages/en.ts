import { accountEn } from "./account.js";
import { commonEn } from "./common.js";
import { signinEn } from "./signin.js";

export const en = { common: commonEn, signin: signinEn, account: accountEn };

/** The shape of the catalog: the Spanish one must have it exactly. */
export type Messages = typeof en;
