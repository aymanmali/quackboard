"use client";

import React, { useEffect, useState } from "react";
import { Check, KeyRound, ShieldCheck, Sparkles, X } from "lucide-react";
import {
  fetchAiStatus,
  loadAiConfig,
  saveAiConfig,
  ServerAiStatusResponse,
} from "@/lib/ai/ai-client";
import { AiProviderId } from "@/lib/ai/types";

interface AiSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export function AiSettingsModal({ open, onClose }: AiSettingsModalProps) {
  const [provider, setProvider] = useState<AiProviderId>("auto");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [serverStatus, setServerStatus] = useState<ServerAiStatusResponse | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (!open) return;
    const cfg = loadAiConfig();
    setProvider(cfg.provider);
    setApiKey(cfg.apiKey ?? "");
    setModel(cfg.model ?? "");
    setSavedNotice(false);
    fetchAiStatus().then(setServerStatus);
  }, [open]);

  if (!open) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    saveAiConfig({
      provider,
      apiKey: apiKey.trim(),
      model: model.trim(),
    });
    setSavedNotice(true);
    setTimeout(() => {
      onClose();
    }, 550);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-xs flex items-center justify-center p-4">
      <form
        onSubmit={handleSave}
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-6 shadow-xl space-y-5"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-950/60 text-violet-600 dark:text-violet-300 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-base text-slate-900 dark:text-white">
                QuackBoard AI Settings
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Powered by Vercel AI SDK + Built-in Local Fallback
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Server AI availability banner */}
        {serverStatus && (
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 p-3 text-xs space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-200">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>
                {serverStatus.anyServerProvider
                  ? "Server AI keys configured + Zero-Key Local Fallback active"
                  : "Zero-Key Local AI Fallback active (add a BYOK key below for LLM power)"}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 pl-5">
              Your own API key is stored only in your browser&apos;s localStorage and sent per
              request—never persisted on the server. Raw data rows stay private in DuckDB-Wasm.
            </p>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              AI Engine / Provider
            </label>
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as AiProviderId)}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium"
            >
              <option value="auto">Auto (Server Key → BYOK → Local Fallback)</option>
              <option value="google">Google Gemini (BYOK / Server)</option>
              <option value="openai">OpenAI GPT (BYOK / Server)</option>
              <option value="anthropic">Anthropic Claude (BYOK / Server)</option>
              <option value="local">Built-in Local AI Only (100% Offline / Zero Key)</option>
            </select>
          </div>

          {provider !== "local" && (
            <>
              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                  <span>API Key (Optional — Bring Your Own Key)</span>
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    provider === "openai"
                      ? "sk-..."
                      : provider === "anthropic"
                      ? "sk-ant-..."
                      : "AIza... (or leave blank for Auto/Local)"
                  }
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Custom Model Override (Optional)
                </label>
                <input
                  type="text"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="Default: gemini-2.5-flash / gpt-4.1-mini / claude-3-5-haiku-latest"
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
                />
              </div>
            </>
          )}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
          {savedNotice ? (
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              <Check className="w-4 h-4" />
              Preferences saved
            </span>
          ) : (
            <span className="text-[11px] text-slate-400">Applies immediately across QuackBoard</span>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-lg text-xs font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs font-semibold shadow-sm cursor-pointer"
            >
              Save AI Settings
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
