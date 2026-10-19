import OpenAI from "openai";
import { ENV } from "./env";

export type Role = "system" | "user" | "assistant" | "tool" | "function";

export type TextContent = {
  type: "text";
  text: string;
};

export type ImageContent = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: "auto" | "low" | "high";
  };
};

export type FileContent = {
  type: "file_url";
  file_url: {
    url: string;
    mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4";
  };
};

export type MessageContent = string | TextContent | ImageContent | FileContent;

export type Message = {
  role: Role;
  content: MessageContent | MessageContent[];
  name?: string;
  tool_call_id?: string;
};

export type Tool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type ToolChoicePrimitive = "none" | "auto" | "required";
export type ToolChoiceByName = { name: string };
export type ToolChoiceExplicit = {
  type: "function";
  function: {
    name: string;
  };
};

export type ToolChoice = ToolChoicePrimitive | ToolChoiceByName | ToolChoiceExplicit;

export type InvokeParams = {
  messages: Message[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  tool_choice?: ToolChoice;
  maxTokens?: number;
  max_tokens?: number;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  enableWebSearch?: boolean;
  /**
   * Overrides the web_search tool's max_uses (default 4) when enableWebSearch
   * is set. NOTE (OpenAI migration): OpenAI's Responses API `web_search`
   * tool does not expose a documented per-call max-uses parameter the way
   * Anthropic's did, so this is currently a no-op against the OpenAI
   * provider — kept in the type only so existing callers (e.g.
   * scripts/curate/ai.ts) keep compiling/working without passing an unknown
   * field through. Only the model's own judgment and maxTokens bound actual
   * search volume. Revisit if OpenAI adds an equivalent control.
   */
  webSearchMaxUses?: number;
  /** Overrides ENV.openaiModel for this call (e.g. a cheaper model for simple, non-creative tasks like translation). */
  model?: string;
  /** Per-request timeout in milliseconds, overriding the SDK default — useful for long web-search-enabled calls. */
  timeoutMs?: number;
};

export type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type InvokeResult = {
  id: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: Role;
      content: string | Array<TextContent | ImageContent | FileContent>;
      tool_calls?: ToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    /** Count of server-side web_search tool invocations billed for this request, when any were made. */
    web_search_requests?: number;
  };
};

export type JsonSchema = {
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
};

export type OutputSchema = JsonSchema;

export type ResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | { type: "json_schema"; json_schema: JsonSchema };

const ensureArray = (value: MessageContent | MessageContent[]): MessageContent[] =>
  Array.isArray(value) ? value : [value];

const normalizeContentPart = (part: MessageContent): TextContent | ImageContent | FileContent => {
  if (typeof part === "string") {
    return { type: "text", text: part };
  }

  if (part.type === "text") {
    return part;
  }

  if (part.type === "image_url") {
    return part;
  }

  if (part.type === "file_url") {
    return part;
  }

  throw new Error("Unsupported message content part");
};

const normalizeToolChoice = (
  toolChoice: ToolChoice | undefined,
  tools: Tool[] | undefined,
): "none" | "auto" | ToolChoiceExplicit | undefined => {
  if (!toolChoice) return undefined;

  if (toolChoice === "none" || toolChoice === "auto") {
    return toolChoice;
  }

  if (toolChoice === "required") {
    if (!tools || tools.length === 0) {
      throw new Error("tool_choice 'required' was provided but no tools were configured");
    }

    if (tools.length > 1) {
      throw new Error(
        "tool_choice 'required' needs a single tool or specify the tool name explicitly",
      );
    }

    return {
      type: "function",
      function: { name: tools[0].function.name },
    };
  }

  if ("name" in toolChoice) {
    return {
      type: "function",
      function: { name: toolChoice.name },
    };
  }

  return toolChoice;
};

const normalizeResponseFormat = ({
  responseFormat,
  response_format,
  outputSchema,
  output_schema,
}: {
  responseFormat?: ResponseFormat;
  response_format?: ResponseFormat;
  outputSchema?: OutputSchema;
  output_schema?: OutputSchema;
}):
  | { type: "json_schema"; json_schema: JsonSchema }
  | { type: "text" }
  | { type: "json_object" }
  | undefined => {
  const explicitFormat = responseFormat || response_format;
  if (explicitFormat) {
    if (explicitFormat.type === "json_schema" && !explicitFormat.json_schema?.schema) {
      throw new Error("responseFormat json_schema requires a defined schema object");
    }
    return explicitFormat;
  }

  const schema = outputSchema || output_schema;
  if (!schema) return undefined;

  if (!schema.name || !schema.schema) {
    throw new Error("outputSchema requires both name and schema");
  }

  return {
    type: "json_schema",
    json_schema: {
      name: schema.name,
      schema: schema.schema,
      ...(typeof schema.strict === "boolean" ? { strict: schema.strict } : {}),
    },
  };
};

// ─── OpenAI (Responses API) conversion helpers ─────────────────────────────
//
// invokeLLM's wire shape (messages w/ role system/user/assistant/tool, tools
// as {type:"function",function:{name,parameters}}, outputSchema →
// json_schema) was always intentionally OpenAI-flavored — this file used to
// translate that shape INTO Anthropic's API; it now talks to OpenAI's
// Responses API directly, chosen over Chat Completions because (a) OpenAI's
// own web-search tool guidance (as of 2026) points new work at Responses —
// the Chat Completions *-search-preview models are deprecated — and (b)
// Responses is where `text.format: {type:"json_schema", strict:true}`
// Structured Outputs is documented as the primary path. See the migration
// report for sources.

const dataUrlPattern = /^data:([^;]+);base64,(.+)$/;

type ResponsesInputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail?: "auto" | "low" | "high" }
  | { type: "input_file"; file_url?: string; file_data?: string; filename?: string }
  | { type: "output_text"; text: string };

const toOpenAIContentPart = (
  part: TextContent | ImageContent | FileContent,
  forRole: "assistant" | "other",
): ResponsesInputContent => {
  if (part.type === "text") {
    return forRole === "assistant" ? { type: "output_text", text: part.text } : { type: "input_text", text: part.text };
  }

  if (part.type === "image_url") {
    return { type: "input_image", image_url: part.image_url.url, detail: part.image_url.detail };
  }

  // file_url: only PDFs map to a native Responses API input_file block;
  // other media (audio/video) isn't supported as structured document input
  // here, so it's passed through as a text pointer (same fallback the prior
  // Anthropic-backed implementation used).
  if (part.file_url.mime_type === "application/pdf") {
    const url = part.file_url.url;
    const match = url.match(dataUrlPattern);
    if (match) {
      return { type: "input_file", file_data: match[2], filename: "document.pdf" };
    }
    return { type: "input_file", file_url: url };
  }

  return { type: "input_text", text: `[attachment: ${part.file_url.url}]` };
};

type ResponsesInputItem =
  | { role: "system" | "developer" | "user" | "assistant"; content: ResponsesInputContent[] }
  | { type: "function_call_output"; call_id: string; output: string };

/**
 * Maps our provider-agnostic Message[] to Responses API `input` items.
 * `system` → `developer` (OpenAI's current recommended role name for
 * top-of-conversation instructions; `system` is still accepted by the API
 * but `developer` is what current docs model new examples around).
 * `tool`/`function` role messages (tool results) become a dedicated
 * `function_call_output` item keyed by `tool_call_id`, matching how the
 * Responses API represents function results (no "tool" role on messages).
 */
const toOpenAIInput = (messages: Message[]): ResponsesInputItem[] => {
  const result: ResponsesInputItem[] = [];

  for (const message of messages) {
    if (message.role === "tool" || message.role === "function") {
      const text = ensureArray(message.content)
        .map((part) => (typeof part === "string" ? part : JSON.stringify(part)))
        .join("\n");
      result.push({ type: "function_call_output", call_id: message.tool_call_id ?? "", output: text });
      continue;
    }

    const role: "system" | "developer" | "user" | "assistant" =
      message.role === "system" ? "developer" : message.role === "assistant" ? "assistant" : "user";
    const parts = ensureArray(message.content).map(normalizeContentPart);
    result.push({
      role,
      content: parts.map((p) => toOpenAIContentPart(p, role === "assistant" ? "assistant" : "other")),
    });
  }

  return result;
};

const toOpenAITools = (tools: Tool[] | undefined): Array<Record<string, unknown>> | undefined => {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    type: "function" as const,
    name: tool.function.name,
    description: tool.function.description,
    parameters: tool.function.parameters ?? { type: "object", properties: {} },
    // Non-strict function tools (free-form tool-calling) — strict schema
    // enforcement is handled separately via `text.format` for the
    // structured-output use case this codebase actually relies on.
    strict: false,
  }));
};

const toOpenAIToolChoice = (
  choice: "none" | "auto" | ToolChoiceExplicit | undefined,
): "none" | "auto" | { type: "function"; name: string } | undefined => {
  if (!choice) return undefined;
  if (choice === "auto" || choice === "none") return choice;
  return { type: "function", name: choice.function.name };
};

const stripJsonCodeFences = (text: string): string => {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : trimmed;
};

let openaiClient: OpenAI | null = null;

const getClient = (): OpenAI => {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: ENV.openaiApiKey });
  }
  return openaiClient;
};

const assertApiKey = () => {
  if (!ENV.openaiApiKey) {
    throw new Error(
      "OPENAI_API_KEY is not configured. Set it in the server environment (Codespaces secret or a local .env the server process reads) before calling the itinerary/AI endpoints — there is no automatic fallback to another provider.",
    );
  }
};

/** Maps a Responses API `response.status` (+ incomplete_details) to the Chat-Completions-style finish_reason this abstraction exposes. */
const mapFinishReason = (
  status: string,
  incompleteReason: string | null | undefined,
  hasToolCalls: boolean,
): string => {
  if (status === "incomplete") {
    return incompleteReason === "max_output_tokens" ? "length" : "stop";
  }
  if (hasToolCalls) return "tool_calls";
  return "stop";
};

export async function invokeLLM(params: InvokeParams): Promise<InvokeResult> {
  assertApiKey();

  const {
    messages,
    tools,
    toolChoice,
    tool_choice,
    outputSchema,
    output_schema,
    responseFormat,
    response_format,
    maxTokens,
    max_tokens,
    enableWebSearch,
  } = params;

  const input = toOpenAIInput(messages);
  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });

  let openaiTools = toOpenAITools(tools);
  let openaiToolChoice = toOpenAIToolChoice(normalizeToolChoice(toolChoice || tool_choice, tools));
  let textFormat: Record<string, unknown> | undefined;

  if (normalizedResponseFormat?.type === "json_object") {
    textFormat = { type: "json_object" };
  } else if (normalizedResponseFormat?.type === "json_schema") {
    textFormat = {
      type: "json_schema",
      name: normalizedResponseFormat.json_schema.name,
      schema: normalizedResponseFormat.json_schema.schema,
      strict: normalizedResponseFormat.json_schema.strict ?? false,
    };
  }

  if (enableWebSearch) {
    openaiTools = [...(openaiTools ?? []), { type: "web_search" }];
    // The model must decide on its own whether/when to search, so it can't
    // be locked into a forced tool_choice (e.g. a specific function tool).
    openaiToolChoice = "auto";
  }

  const client = getClient();
  const requestBody: Record<string, unknown> = {
    model: params.model ?? ENV.openaiModel,
    input,
    max_output_tokens: maxTokens ?? max_tokens ?? 8192,
  };
  if (openaiTools) requestBody.tools = openaiTools;
  if (openaiToolChoice) requestBody.tool_choice = openaiToolChoice;
  if (textFormat) requestBody.text = { format: textFormat };

  let response: any;
  try {
    response = await client.responses.create(
      requestBody as any,
      params.timeoutMs ? { timeout: params.timeoutMs } : undefined,
    );
  } catch (err) {
    // Surface a clear, actionable error for the two most common misconfig
    // cases rather than letting a generic SDK error bubble up unexplained.
    const status = (err as { status?: number })?.status;
    if (status === 401) {
      throw new Error("OpenAI API request failed: invalid or unauthorized OPENAI_API_KEY.");
    }
    if (status === 429) {
      throw new Error("OpenAI API rate limit or quota exceeded.");
    }
    throw err;
  }

  if (response.status === "failed" || response.status === "cancelled") {
    const reason = response.error?.message || response.incomplete_details?.reason || response.status;
    throw new Error(`OpenAI response did not complete: ${reason}`);
  }

  const outputItems: any[] = Array.isArray(response.output) ? response.output : [];

  // `output_text` is a first-class field on the Response object (the SDK's
  // own recommended way to read the final text, rather than assuming the
  // first output item is the answer) — this is also exactly what ends up
  // holding the JSON string when Structured Outputs (`text.format`) is used.
  let content: string = typeof response.output_text === "string" ? response.output_text : "";

  const functionCalls = outputItems.filter((item) => item.type === "function_call");
  const toolCalls: ToolCall[] | undefined =
    functionCalls.length > 0
      ? functionCalls.map((fc) => ({
          id: fc.call_id ?? fc.id ?? "",
          type: "function" as const,
          function: { name: fc.name, arguments: fc.arguments ?? "{}" },
        }))
      : undefined;

  if (normalizedResponseFormat?.type === "json_object") {
    content = stripJsonCodeFences(content);
  }

  const webSearchRequests = outputItems.filter((item) => item.type === "web_search_call").length;

  return {
    id: response.id,
    created: typeof response.created_at === "number" ? response.created_at : Math.floor(Date.now() / 1000),
    model: response.model ?? requestBody.model as string,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: mapFinishReason(response.status, response.incomplete_details?.reason, !!toolCalls),
      },
    ],
    usage: response.usage
      ? {
          prompt_tokens: response.usage.input_tokens ?? 0,
          completion_tokens: response.usage.output_tokens ?? 0,
          total_tokens: response.usage.total_tokens ?? 0,
          ...(webSearchRequests > 0 ? { web_search_requests: webSearchRequests } : {}),
        }
      : undefined,
  };
}
