import Anthropic from "@anthropic-ai/sdk";
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

// ─── Anthropic conversion helpers ──────────────────────────────────────────

const dataUrlPattern = /^data:([^;]+);base64,(.+)$/;

const toAnthropicContentBlock = (
  part: TextContent | ImageContent | FileContent,
): Anthropic.ContentBlockParam => {
  if (part.type === "text") {
    return { type: "text", text: part.text };
  }

  if (part.type === "image_url") {
    const url = part.image_url.url;
    const match = url.match(dataUrlPattern);
    if (match) {
      return {
        type: "image",
        source: { type: "base64", media_type: match[1] as Anthropic.Base64ImageSource["media_type"], data: match[2] },
      };
    }
    return { type: "image", source: { type: "url", url } };
  }

  // file_url: only PDFs map to a native Anthropic block; other media (audio/video)
  // isn't supported as document input, so it's passed through as a text pointer.
  if (part.file_url.mime_type === "application/pdf") {
    const url = part.file_url.url;
    const match = url.match(dataUrlPattern);
    if (match) {
      return {
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: match[2] },
      };
    }
    return { type: "document", source: { type: "url", url } };
  }

  return { type: "text", text: `[attachment: ${part.file_url.url}]` };
};

const toAnthropicMessages = (
  messages: Message[],
): { system: string | undefined; messages: Anthropic.MessageParam[] } => {
  const systemParts: string[] = [];
  const result: Anthropic.MessageParam[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      const text = ensureArray(message.content)
        .map((part) => (typeof part === "string" ? part : part.type === "text" ? part.text : ""))
        .filter(Boolean)
        .join("\n");
      if (text) systemParts.push(text);
      continue;
    }

    if (message.role === "tool" || message.role === "function") {
      const text = ensureArray(message.content)
        .map((part) => (typeof part === "string" ? part : JSON.stringify(part)))
        .join("\n");
      result.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: message.tool_call_id ?? "", content: text }],
      });
      continue;
    }

    const role = message.role === "assistant" ? "assistant" : "user";
    const parts = ensureArray(message.content).map(normalizeContentPart);

    if (parts.length === 1 && parts[0].type === "text") {
      result.push({ role, content: parts[0].text });
    } else {
      result.push({ role, content: parts.map(toAnthropicContentBlock) });
    }
  }

  return { system: systemParts.length ? systemParts.join("\n\n") : undefined, messages: result };
};

const toAnthropicTools = (tools: Tool[] | undefined): Anthropic.Tool[] | undefined => {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description,
    input_schema: (tool.function.parameters as Anthropic.Tool.InputSchema) ?? { type: "object" },
  }));
};

const toAnthropicToolChoice = (
  choice: "none" | "auto" | ToolChoiceExplicit | undefined,
): Anthropic.ToolChoice | undefined => {
  if (!choice) return undefined;
  if (choice === "auto") return { type: "auto" };
  if (choice === "none") return { type: "none" };
  return { type: "tool", name: choice.function.name };
};

const stripJsonCodeFences = (text: string): string => {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : trimmed;
};

const mapStopReason = (reason: Anthropic.Message["stop_reason"]): string | null => {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return reason;
  }
};

const toInvokeResult = (
  response: Anthropic.Message,
  opts: { jsonSchemaToolName?: string; stripJsonFences?: boolean },
): InvokeResult => {
  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text",
  );
  const toolUseBlocks = response.content.filter(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
  );

  let content = textBlocks.map((block) => block.text).join("");
  let toolCalls: ToolCall[] | undefined;

  if (opts.jsonSchemaToolName) {
    const match = toolUseBlocks.find((block) => block.name === opts.jsonSchemaToolName);
    if (match) {
      content = JSON.stringify(match.input);
    }
  } else {
    if (opts.stripJsonFences) {
      content = stripJsonCodeFences(content);
    }
    if (toolUseBlocks.length > 0) {
      toolCalls = toolUseBlocks.map((block) => ({
        id: block.id,
        type: "function" as const,
        function: { name: block.name, arguments: JSON.stringify(block.input) },
      }));
    }
  }

  return {
    id: response.id,
    created: Math.floor(Date.now() / 1000),
    model: response.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
          ...(toolCalls ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: mapStopReason(response.stop_reason),
      },
    ],
    usage: {
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      total_tokens: response.usage.input_tokens + response.usage.output_tokens,
    },
  };
};

let anthropicClient: Anthropic | null = null;

const getClient = (): Anthropic => {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: ENV.anthropicApiKey });
  }
  return anthropicClient;
};

const assertApiKey = () => {
  if (!ENV.anthropicApiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured");
  }
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
  } = params;

  const { system, messages: anthropicMessages } = toAnthropicMessages(messages);
  const normalizedResponseFormat = normalizeResponseFormat({
    responseFormat,
    response_format,
    outputSchema,
    output_schema,
  });

  let anthropicTools = toAnthropicTools(tools);
  let anthropicToolChoice = toAnthropicToolChoice(normalizeToolChoice(toolChoice || tool_choice, tools));
  let systemPrompt = system;
  let jsonSchemaToolName: string | undefined;

  if (normalizedResponseFormat?.type === "json_object") {
    systemPrompt = [systemPrompt, "Respond with valid JSON only — no prose, no markdown code fences."]
      .filter(Boolean)
      .join("\n\n");
  } else if (normalizedResponseFormat?.type === "json_schema") {
    jsonSchemaToolName = normalizedResponseFormat.json_schema.name;
    anthropicTools = [
      {
        name: jsonSchemaToolName,
        description: "Return the response matching the required schema.",
        input_schema: normalizedResponseFormat.json_schema.schema as Anthropic.Tool.InputSchema,
      },
    ];
    anthropicToolChoice = { type: "tool", name: jsonSchemaToolName };
  }

  const response = await getClient().messages.create({
    model: ENV.anthropicModel,
    max_tokens: maxTokens ?? max_tokens ?? 8192,
    system: systemPrompt,
    messages: anthropicMessages,
    tools: anthropicTools,
    tool_choice: anthropicToolChoice,
  });

  return toInvokeResult(response, {
    jsonSchemaToolName,
    stripJsonFences: normalizedResponseFormat?.type === "json_object",
  });
}
