"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Copy, Check, ExternalLink, AlertCircle, CheckCircle2 } from "lucide-react";
import { useTranslation } from "@/i18n";
import {
  createLinkToken,
  deleteTelegramBotConfig,
  getChannelStatus,
  listChannelAccounts,
  saveTelegramBotConfig,
  unlinkChannelAccount,
  type TelegramProviderStatus,
} from "../api/channel-api";
import { ChannelProviderIcon } from "./ChannelProviderIcon";

interface ChannelAccount {
  id: string;
  provider: string;
  provider_user_id: string;
  display_name: string | null;
  status: string;
  linked_at: string;
}

interface LinkTokenData {
  token: string;
  provider: string;
  expires_in_minutes: number;
}

function StatusPill({ status }: { status: "linked" | "configured" | "not_configured" }) {
  if (status === "linked") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-accent-emerald/10 px-2 py-0.5 text-xs font-medium text-accent-emerald ring-1 ring-accent-emerald/20">
        <CheckCircle2 className="h-3 w-3" />
        Linked
      </span>
    );
  }
  if (status === "configured") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-accent-blue/10 px-2 py-0.5 text-xs font-medium text-accent-blue ring-1 ring-accent-blue/20">
        <span className="h-1.5 w-1.5 rounded-full bg-accent-blue" />
        Configured
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
      Not configured
    </span>
  );
}

export function TelegramLinkCard() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TelegramProviderStatus | null>(null);
  const [account, setAccount] = useState<ChannelAccount | null>(null);
  const [linkToken, setLinkToken] = useState<LinkTokenData | null>(null);
  const [botTokenInput, setBotTokenInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      setError(null);
      const [statusRes, accountsRes] = await Promise.all([
        getChannelStatus(),
        listChannelAccounts(),
      ]);
      setStatus(statusRes.providers.telegram);
      const telegramAccount = accountsRes.accounts.find((item) => item.provider === "telegram");
      setAccount(telegramAccount ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("channels.telegram.errorLoadStatus"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleSaveBot = async () => {
    try {
      setActionLoading(true);
      setError(null);
      await saveTelegramBotConfig(botTokenInput.trim());
      setBotTokenInput("");
      setLinkToken(null);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("channels.telegram.errorSaveToken"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteBot = async () => {
    try {
      setActionLoading(true);
      setError(null);
      await deleteTelegramBotConfig();
      setLinkToken(null);
      setAccount(null);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("channels.telegram.errorDisableBot"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreateLinkToken = async () => {
    try {
      setActionLoading(true);
      setError(null);
      const token = await createLinkToken("telegram");
      setLinkToken(token);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("channels.telegram.errorGenerateToken"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleUnlink = async () => {
    if (!account) return;
    try {
      setActionLoading(true);
      setError(null);
      await unlinkChannelAccount(account.id);
      setLinkToken(null);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("channels.telegram.errorUnlink"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!linkToken) return;
    try {
      await navigator.clipboard.writeText(`/start ${linkToken.token}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t("channels.telegram.errorCopy"));
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 animate-pulse rounded-xl bg-muted" />
          <div className="space-y-2">
            <div className="h-3.5 w-20 animate-pulse rounded bg-muted" />
            <div className="h-3 w-32 animate-pulse rounded bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  const configured = status?.configured ?? false;
  const linked = status?.linked ?? false;
  const canGenerateLinkToken = configured && status?.enabled && status?.webhook_status === "active";
  const cardStatus: "linked" | "configured" | "not_configured" = linked ? "linked" : configured ? "configured" : "not_configured";

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-card)]">
      {/* Card header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-3.5">
        <ChannelProviderIcon provider="telegram" size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">Telegram</h3>
            <StatusPill status={cardStatus} />
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {t("channels.telegram.description")}
          </p>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-destructive/8 px-3 py-2.5 text-xs text-destructive ring-1 ring-destructive/20">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Not configured — token input */}
        {!configured && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-foreground" htmlFor="telegram-bot-token">
                {t("channels.telegram.botTokenLabel")}
              </label>
              <input
                id="telegram-bot-token"
                type="password"
                value={botTokenInput}
                onChange={(event) => setBotTokenInput(event.target.value)}
                placeholder="123456789:AAF..."
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent-blue/50 focus:ring-2 focus:ring-accent-blue/10"
              />
              <p className="text-[11px] text-muted-foreground">
                {t("channels.telegram.botTokenHint")}
              </p>
            </div>

            {/* Help accordion */}
            <div className="rounded-lg border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => setHelpOpen((prev) => !prev)}
                className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <span className="flex items-center gap-1.5">
                  <ExternalLink className="h-3 w-3" />
                  {t("channels.telegram.helpTitle")}
                </span>
                {helpOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {helpOpen && (
                <ol className="space-y-1 border-t border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
                  {[
                    t("channels.telegram.helpStep1"),
                    t("channels.telegram.helpStep2"),
                    t("channels.telegram.helpStep3"),
                    t("channels.telegram.helpStep4"),
                    t("channels.telegram.helpStep5"),
                  ].map((step, idx) => (
                    <li key={idx} className="flex gap-2">
                      <span className="shrink-0 font-semibold text-foreground/60">{idx + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <button
              type="button"
              disabled={actionLoading || !botTokenInput.trim()}
              onClick={handleSaveBot}
              className="w-full rounded-lg bg-[#2AABEE] px-4 py-2 text-sm font-medium text-white shadow-sm transition-all hover:bg-[#229ED9] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {actionLoading ? t("channels.telegram.verifyingButton") : t("channels.telegram.saveButton")}
            </button>
          </div>
        )}

        {/* Configured — bot info & actions */}
        {configured && status && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5 ring-1 ring-border/50">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">@{status.bot_username}</p>
                <p className="text-[11px] text-muted-foreground">{t("channels.telegram.maskedToken", { token: status.masked_token ?? "" })}</p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${
                  status.webhook_status === "active"
                    ? "bg-accent-emerald/10 text-accent-emerald ring-accent-emerald/20"
                    : "bg-amber-500/10 text-amber-600 ring-amber-500/20"
                }`}
              >
                {status.webhook_status}
              </span>
            </div>

            {status.last_error && (
              <div className="flex items-start gap-2 rounded-lg bg-destructive/8 px-3 py-2 text-xs text-destructive ring-1 ring-destructive/20">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{status.last_error}</span>
              </div>
            )}

            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={handleCreateLinkToken}
                disabled={actionLoading || !canGenerateLinkToken}
                className="rounded-lg bg-[#2AABEE] px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-all hover:bg-[#229ED9] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionLoading ? t("channels.telegram.workingButton") : t("channels.telegram.generateLinkToken")}
              </button>
              <button
                type="button"
                onClick={handleDeleteBot}
                disabled={actionLoading}
                className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("channels.telegram.disableBot")}
              </button>
              {linked && account && (
                <button
                  type="button"
                  onClick={handleUnlink}
                  disabled={actionLoading}
                  className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t("channels.telegram.unlinkChat")}
                </button>
              )}
            </div>

            {!canGenerateLinkToken && (
              <p className="text-[11px] text-muted-foreground">
                {t("channels.telegram.fixSetupHint")}
              </p>
            )}
          </div>
        )}

        {/* Link token display */}
        {linkToken && status?.bot_username && (
          <div className="rounded-lg border border-[#2AABEE]/20 bg-[#2AABEE]/5 p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              {t("channels.telegram.linkInstructionsPre")}
              <strong className="text-foreground">@{status.bot_username}</strong>
              {t("channels.telegram.linkInstructionsPost")}
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded-md bg-card border border-border px-2.5 py-1.5 font-mono text-xs text-foreground">
                /start {linkToken.token}
              </code>
              <button
                type="button"
                onClick={handleCopy}
                className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                {copied ? <Check className="h-3 w-3 text-accent-emerald" /> : <Copy className="h-3 w-3" />}
                {copied ? t("channels.telegram.copiedButton") : t("channels.telegram.copyButton")}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground/70">
              {t("channels.telegram.tokenExpiry", { minutes: linkToken.expires_in_minutes })}
            </p>
          </div>
        )}

        {/* Linked account info */}
        {linked && account && (
          <div className="flex items-center gap-3 rounded-lg bg-accent-emerald/5 px-3 py-2.5 ring-1 ring-accent-emerald/20">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent-emerald/15 text-sm font-semibold text-accent-emerald">
              {(account.display_name ?? account.provider_user_id).charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">
                {account.display_name ?? account.provider_user_id}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("channels.telegram.linkedAt", { date: new Date(account.linked_at).toLocaleDateString() })}
              </p>
            </div>
            <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-accent-emerald" />
          </div>
        )}
      </div>
    </div>
  );
}
