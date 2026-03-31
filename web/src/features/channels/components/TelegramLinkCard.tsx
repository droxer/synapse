"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Copy, Check, ExternalLink, AlertCircle, X, Settings, Link } from "lucide-react";
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
      <span className="inline-flex items-center gap-1.5 rounded-sm bg-accent-emerald/10 px-1.5 py-0.5 text-micro font-medium text-accent-emerald ring-1 ring-accent-emerald/20 uppercase">
        Linked
      </span>
    );
  }
  if (status === "configured") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-sm bg-accent-blue/10 px-1.5 py-0.5 text-micro font-medium text-accent-blue ring-1 ring-accent-blue/20 uppercase">
        Ready
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-sm bg-accent-amber/8 px-1.5 py-0.5 text-micro font-medium text-accent-amber ring-1 ring-accent-amber/25 uppercase">
      <span className="h-1 w-1 rounded-full bg-accent-amber" />
      Setup
    </span>
  );
}

// ── Modal ──────────────────────────────────────────────────────────────────

interface TelegramConfigModalProps {
  status: TelegramProviderStatus | null;
  account: ChannelAccount | null;
  linkToken: LinkTokenData | null;
  botTokenInput: string;
  isEditingToken: boolean;
  actionLoading: boolean;
  error: string | null;
  copied: boolean;
  helpOpen: boolean;
  configured: boolean;
  linked: boolean;
  canGenerateLinkToken: boolean;
  onClose: () => void;
  onBotTokenChange: (value: string) => void;
  onSaveBot: () => void;
  onDeleteBot: () => void;
  onCreateLinkToken: () => void;
  onUnlink: () => void;
  onCopy: () => void;
  onHelpToggle: () => void;
  onStartEditToken: () => void;
  onCancelEditToken: () => void;
}

function TelegramConfigModal({
  status,
  account,
  linkToken,
  botTokenInput,
  isEditingToken,
  actionLoading,
  error,
  copied,
  helpOpen,
  configured,
  linked,
  canGenerateLinkToken,
  onClose,
  onBotTokenChange,
  onSaveBot,
  onDeleteBot,
  onCreateLinkToken,
  onUnlink,
  onCopy,
  onHelpToggle,
  onStartEditToken,
  onCancelEditToken,
}: TelegramConfigModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) onClose();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-md transition-all"
    >
      <div className="animate-in fade-in slide-in-from-bottom-2 duration-150 relative w-full max-w-md overflow-hidden rounded-xl border border-border bg-card shadow-elevated">
        {/* Header */}
        <div className="relative flex items-center gap-3.5 px-6 py-4 border-b border-border overflow-hidden">
          <div
            className="absolute inset-0 opacity-[0.04]"
            style={{ background: "linear-gradient(135deg, #2AABEE 0%, transparent 60%)" }}
          />
          <ChannelProviderIcon provider="telegram" size="lg" className="relative ring-1 ring-border rounded-xl shadow-sm" />
          <div className="relative flex-1 min-w-0">
            <h2 className="text-base font-semibold tracking-tight text-foreground">Telegram Integration</h2>
            <p className="text-xs text-muted-foreground truncate">
              Configure your bot and link your account.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="relative px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto w-full">

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="leading-snug">{error}</span>
            </div>
          )}

          {/* ── Not configured: setup form ── */}
          {!configured && (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground" htmlFor="tg-bot-token">
                  API Token
                </label>
                <input
                  id="tg-bot-token"
                  type="password"
                  value={botTokenInput}
                  onChange={(e) => onBotTokenChange(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && botTokenInput.trim() && !actionLoading) onSaveBot(); }}
                  placeholder="123456789:AAFx..."
                  autoFocus
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-border-active focus:ring-[3px] focus:ring-ring/50 shadow-sm focus:shadow-md"
                />
              </div>

              {/* Help accordion */}
              <div className="rounded-md border border-border overflow-hidden bg-secondary/30">
                <button
                  type="button"
                  onClick={onHelpToggle}
                  className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <span className="flex items-center gap-2">
                    <ExternalLink className="h-3.5 w-3.5" />
                    How to acquire token
                  </span>
                  {helpOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                {helpOpen && (
                  <ol className="space-y-2 border-t border-border bg-secondary/40 px-4 py-3 leading-normal text-muted-foreground">
                    {[
                      "Message @BotFather on Telegram",
                      "Send /newbot and follow prompts",
                      "Copy the HTTP API Token",
                      "Paste token above",
                      "Save and verify connection",
                    ].map((step, idx) => (
                      <li key={idx} className="flex items-start gap-2.5">
                        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent-purple/10 text-micro font-semibold text-accent-purple">
                          {idx + 1}
                        </span>
                        <span className="text-xs text-foreground">{step}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <button
                type="button"
                disabled={actionLoading || !botTokenInput.trim()}
                onClick={onSaveBot}
                className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {actionLoading ? "Verifying..." : "Initialize"}
              </button>
            </div>
          )}

          {/* ── Configured: bot info & actions ── */}
          {configured && status && (
            <div className="space-y-4">

              <div className="flex items-center justify-between rounded-md border border-border bg-card p-3 shadow-sm">
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm font-medium text-foreground tracking-tight">@{status.bot_username}</p>
                  <p className="text-xs text-muted-foreground font-mono">
                    {status.masked_token}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <span
                    className={`shrink-0 rounded-sm px-1.5 py-0.5 text-micro font-medium uppercase ring-1 ${
                      status.webhook_status === "active"
                        ? "bg-accent-emerald/10 text-accent-emerald ring-accent-emerald/20"
                        : "bg-accent-amber/10 text-accent-amber ring-accent-amber/20"
                    }`}
                  >
                    {status.webhook_status}
                  </span>
                </div>
              </div>

              {status.last_error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{status.last_error}</span>
                </div>
              )}

              {isEditingToken && (
                <div className="rounded-md border border-border bg-secondary/50 p-3 space-y-2">
                  <p className="text-sm font-medium text-foreground">
                    Update Token
                  </p>
                  <input
                    type="password"
                    value={botTokenInput}
                    onChange={(e) => onBotTokenChange(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && botTokenInput.trim() && !actionLoading) onSaveBot(); if (e.key === "Escape") onCancelEditToken(); }}
                    placeholder="New API Token..."
                    autoFocus
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-border-active focus:ring-[3px] focus:ring-ring/50 shadow-sm focus:shadow-md"
                  />
                  <div className="flex gap-2 pt-1">
                    <button
                      type="button"
                      disabled={actionLoading || !botTokenInput.trim()}
                      onClick={onSaveBot}
                      className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
                    >
                      {actionLoading ? "Saving..." : "Confirm"}
                    </button>
                    <button
                      type="button"
                      onClick={onCancelEditToken}
                      className="rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onCreateLinkToken}
                  disabled={actionLoading || !canGenerateLinkToken}
                  className="col-span-2 flex items-center justify-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Link className="h-4 w-4" />
                  {actionLoading ? "Generating..." : "Generate Link Token"}
                </button>

                {!isEditingToken && (
                  <button
                    type="button"
                    onClick={onStartEditToken}
                    disabled={actionLoading}
                    className="flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
                  >
                    Update Token
                  </button>
                )}
                <button
                  type="button"
                  onClick={onDeleteBot}
                  disabled={actionLoading}
                  className="flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-secondary hover:text-destructive hover:border-destructive/30 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
                >
                  Disable Bot
                </button>
              </div>

              {!canGenerateLinkToken && (
                <p className="text-center text-xs text-muted-foreground mt-2">
                  System awaits valid webhook status.
                </p>
              )}
            </div>
          )}

          {/* Link token display */}
          {linkToken && status?.bot_username && (
            <div className="space-y-2">
              <a
                href={`https://t.me/${status.bot_username.replace(/^@/, '')}?start=${linkToken.token}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#2AABEE] px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-[#229ED9] active:scale-[0.98]"
              >
                <ExternalLink className="h-4 w-4" />
                Open in Telegram
              </a>

              <p className="text-xs text-muted-foreground text-center px-1">
                Or copy this command and send it to <strong className="text-foreground">@{status.bot_username}</strong>
              </p>

              <div className="flex items-center gap-0 rounded-lg border border-border overflow-hidden bg-secondary/60">
                <code className="flex-1 px-3 py-2.5 font-mono text-xs text-foreground truncate">
                  /start {linkToken.token}
                </code>
                <button
                  type="button"
                  onClick={onCopy}
                  className="flex shrink-0 items-center justify-center gap-1.5 border-l border-border bg-card px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-accent-emerald" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>

              <p className="text-micro text-muted-foreground-dim text-center">
                Expires in {linkToken.expires_in_minutes} min
              </p>
            </div>
          )}

          {/* Linked account */}
          {linked && account && (
            <div className="flex items-center gap-3 rounded-md border border-border bg-card p-3 shadow-sm">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-purple/10 text-sm font-semibold text-accent-purple">
                {(account.display_name ?? account.provider_user_id).charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground truncate">
                  {account.display_name ?? account.provider_user_id}
                </p>
                <p className="text-xs text-muted-foreground-dim">
                  {new Date(account.linked_at).toLocaleDateString()}
                </p>
              </div>
              <button
                type="button"
                onClick={onUnlink}
                disabled={actionLoading}
                className="shrink-0 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-destructive shadow-sm transition-colors hover:bg-destructive/5 hover:border-destructive/30 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
              >
                Unlink
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Card ───────────────────────────────────────────────────────────────────

interface TelegramLinkCardProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hideCard?: boolean;
}

export function TelegramLinkCard({ open, onOpenChange, hideCard }: TelegramLinkCardProps = {}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<TelegramProviderStatus | null>(null);
  const [account, setAccount] = useState<ChannelAccount | null>(null);
  const [linkToken, setLinkToken] = useState<LinkTokenData | null>(null);
  const [botTokenInput, setBotTokenInput] = useState("");
  const [isEditingToken, setIsEditingToken] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const modalOpen = open !== undefined ? open : isModalOpen;
  const setModalOpen = (val: boolean) => {
    setIsModalOpen(val);
    onOpenChange?.(val);
  };
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  // Clear pending copy timer on unmount
  useEffect(() => () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); }, []);

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
  }, [t]);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleSaveBot = async () => {
    try {
      setActionLoading(true);
      setError(null);
      await saveTelegramBotConfig(botTokenInput.trim());
      setBotTokenInput("");
      setIsEditingToken(false);
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
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setError(t("channels.telegram.errorCopy"));
    }
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setError(null);
    if (isEditingToken) {
      setBotTokenInput("");
      setIsEditingToken(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-sm">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 shrink-0 rounded-xl skeleton-shimmer" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-14 skeleton-shimmer" />
            <div className="h-2.5 w-10 skeleton-shimmer" />
          </div>
          <div className="h-6 w-6 rounded-md skeleton-shimmer" />
        </div>
      </div>
    );
  }

  const configured = status?.configured ?? false;
  const linked = status?.linked ?? false;
  const canGenerateLinkToken = !!(configured && status?.enabled && status?.webhook_status === "active");
  const cardStatus: "linked" | "configured" | "not_configured" = linked
    ? "linked"
    : configured
    ? "configured"
    : "not_configured";

  return (
    <>
      {!hideCard && (
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        className="group relative flex w-full flex-col gap-2 overflow-hidden rounded-lg border border-border bg-card p-3 text-left shadow-card transition-all hover:border-border-strong hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {/* Telegram brand color strip */}
        <div
          className="absolute inset-x-0 top-0 h-0.5 rounded-t-lg opacity-60"
          style={{ background: "linear-gradient(90deg, #2AABEE, #229ED9)" }}
        />
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2.5">
            <ChannelProviderIcon provider="telegram" size="md" />
            <div className="space-y-0.5">
              <span className="text-sm font-semibold text-foreground">Telegram</span>
              <div className="flex items-center">
                <StatusPill status={cardStatus} />
              </div>
            </div>
          </div>
          <div className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-all group-hover:bg-secondary group-hover:text-foreground group-hover:border-border-strong">
            {configured ? <Settings className="h-3 w-3" /> : <ChevronDown className="h-3.5 w-3.5 -rotate-90" />}
          </div>
        </div>

        {configured && status?.bot_username && (
          <p className="text-xs text-muted-foreground truncate font-mono">@{status.bot_username}</p>
        )}
      </button>
      )}

      {/* Modal */}
      {modalOpen && (
        <TelegramConfigModal
          status={status}
          account={account}
          linkToken={linkToken}
          botTokenInput={botTokenInput}
          isEditingToken={isEditingToken}
          actionLoading={actionLoading}
          error={error}
          copied={copied}
          helpOpen={helpOpen}
          configured={configured}
          linked={linked}
          canGenerateLinkToken={canGenerateLinkToken}
          onClose={handleCloseModal}
          onBotTokenChange={setBotTokenInput}
          onSaveBot={handleSaveBot}
          onDeleteBot={handleDeleteBot}
          onCreateLinkToken={handleCreateLinkToken}
          onUnlink={handleUnlink}
          onCopy={handleCopy}
          onHelpToggle={() => setHelpOpen((prev) => !prev)}
          onStartEditToken={() => setIsEditingToken(true)}
          onCancelEditToken={() => { setBotTokenInput(""); setIsEditingToken(false); }}
        />
      )}
    </>
  );
}
