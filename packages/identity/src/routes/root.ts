import type { Route } from "../context.js";
import { redirect } from "../http.js";
import { currentSession } from "../session.js";

/** `GET /`: the account when signed in, else the chooser. */
export const rootRoute: Route = async (ctx) => {
  return redirect((await currentSession(ctx)) ? "/account" : "/login");
};
