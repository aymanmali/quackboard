import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import { AiClientConfig } from "./types";

export interface ResolvedAiModel {
  model: LanguageModel;
  engineLabel: string;
  usingServerKey: boolean;
}

export function getServerAiStatus() {
  const hasGoogle = Boolean(
    process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY
  );
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);

  return {
    google: hasGoogle,
    openai: hasOpenAI,
    anthropic: hasAnthropic,
    anyServerProvider: hasGoogle || hasOpenAI || hasAnthropic,
    localFallbackReady: true,
  };
}

/**
 * Resolves a Vercel AI SDK LanguageModel from BYOK client config or server environment variables.
 * Returns null if no API key is available or user explicitly selected "local".
 */
export function resolveAiModel(config?: AiClientConfig): ResolvedAiModel | null {
  const requested = config?.provider ?? "auto";
  if (requested === "local") return null;

  const clientKey = config?.apiKey?.trim() || "";
  const googleKey =
    (requested === "google" || requested === "auto") && clientKey
      ? clientKey
      : process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || "";
  const openaiKey =
    requested === "openai" && clientKey ? clientKey : process.env.OPENAI_API_KEY || "";
  const anthropicKey =
    requested === "anthropic" && clientKey ? clientKey : process.env.ANTHROPIC_API_KEY || "";

  if (requested === "google" || (requested === "auto" && googleKey)) {
    if (!googleKey) return null;
    const modelName = config?.model?.trim() || "gemini-2.5-flash";
    const google = createGoogleGenerativeAI({ apiKey: googleKey });
    return {
      model: google(modelName),
      engineLabel: `Google ${modelName}${clientKey ? " (BYOK)" : ""}`,
      usingServerKey: !clientKey,
    };
  }

  if (requested === "openai" || (requested === "auto" && openaiKey)) {
    if (!openaiKey) return null;
    const modelName = config?.model?.trim() || "gpt-4.1-mini";
    const openai = createOpenAI({ apiKey: openaiKey });
    return {
      model: openai(modelName),
      engineLabel: `OpenAI ${modelName}${clientKey ? " (BYOK)" : ""}`,
      usingServerKey: !clientKey,
    };
  }

  if (requested === "anthropic" || (requested === "auto" && anthropicKey)) {
    if (!anthropicKey) return null;
    const modelName = config?.model?.trim() || "claude-3-5-haiku-latest";
    const anthropic = createAnthropic({ apiKey: anthropicKey });
    return {
      model: anthropic(modelName),
      engineLabel: `Anthropic ${modelName}${clientKey ? " (BYOK)" : ""}`,
      usingServerKey: !clientKey,
    };
  }

  return null;
}
