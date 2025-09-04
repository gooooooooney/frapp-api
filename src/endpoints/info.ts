import { OpenAPIRoute, Str } from "chanfana";
import { z } from "zod";
import { type AppContext } from "../types";

export class Info extends OpenAPIRoute {
  schema = {
    tags: ["Info"],
    summary: "Get API Info",
    description: "Returns API endpoint information",
    responses: {
      "200": {
        description: "Returns API endpoint URL",
        content: {
          "text/plain": {
            schema: z.string(),
          },
        },
      },
    },
  };

  async handle(c: AppContext) {
    const url = new URL(c.req.url);
    return c.text(`https://${url.hostname}/openai/v1`);
  }
}