import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { config } from "../config";

export interface StructuredRequest<S extends z.ZodType> {
  schema: S;
  system: string;
  prompt: string;
}

export interface LlmClient {
  readonly model: string;
  structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>>;
}

export class LlmRefusalError extends Error {}

class ClaudeClient implements LlmClient {
  private readonly client = new Anthropic();
  constructor(readonly model: string) {}

  async structured<S extends z.ZodType>(req: StructuredRequest<S>): Promise<z.infer<S>> {
    const response = await this.client.messages.parse({
      model: this.model,
      max_tokens: 16000,
      system: req.system,
      messages: [{ role: "user", content: req.prompt }],
      output_config: { effort: "medium", format: zodOutputFormat(req.schema) },
    });
    if (response.stop_reason === "refusal") {
      throw new LlmRefusalError("Claude declined this request");
    }
    if (response.parsed_output == null) {
      throw new Error(`Claude returned no parsable output (stop_reason=${response.stop_reason})`);
    }
    return req.schema.parse(response.parsed_output);
  }
}

let cached: LlmClient | null | undefined;

/** Claude client when ANTHROPIC_API_KEY is configured, otherwise null (deterministic engine). */
export function getLlm(): LlmClient | null {
  if (cached === undefined) {
    cached = config.anthropicEnabled ? new ClaudeClient(config.claudeModel) : null;
  }
  return cached;
}
