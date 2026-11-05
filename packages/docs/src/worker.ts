// The portal's Worker (design decision 5): the static assets, and `POST /api/ask`. Everything it
// does is in `bindings.ts` and `ask.ts`; a Worker module exports its handlers and nothing else.

import { handle, type Env } from "./bindings.js";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handle(request, env);
  },
};
