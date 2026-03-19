"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Blocks,
  Plus,
  Terminal,
  Radio,
  Unplug,
  Search,
  X,
} from "lucide-react";
import { TransportToggle } from "./TransportToggle";
import { MCPServerCard } from "./MCPServerCard";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";
import {
  fetchMCPServers,
  addMCPServer,
  removeMCPServer,
  type MCPServer,
} from "../api/mcp-api";

/* ── animation variants ── */
const listContainer = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.02, delayChildren: 0 },
  },
};

const listItem = {
  hidden: { opacity: 0, y: 6 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.12, ease: "easeOut" as const },
  },
};

/* ── shimmer skeleton matching card shape ── */
function ServerSkeleton() {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div className="h-9 w-9 shrink-0 rounded-lg skeleton-shimmer" />
        <div className="h-4 w-14 skeleton-shimmer" />
      </div>
      <div className="mt-3 h-4 w-28 skeleton-shimmer" />
      <div className="mt-2 min-h-[2.5rem] space-y-1.5">
        <div className="h-3 w-full skeleton-shimmer" />
        <div className="h-3 w-3/4 skeleton-shimmer" />
      </div>
      <div className="mt-auto pt-3">
        <div className="h-2.5 w-24 skeleton-shimmer" />
      </div>
    </div>
  );
}

export function MCPPage() {
  const { t } = useTranslation();
  const [servers, setServers] = useState<readonly MCPServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  // Add form state
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formTransport, setFormTransport] = useState<"stdio" | "sse">("sse");
  const [formCommand, setFormCommand] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Delete confirmation
  const [serverToDelete, setServerToDelete] = useState<string | null>(null);

  const loadServers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchMCPServers();
      setServers(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load servers");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  const resetForm = () => {
    setFormName("");
    setFormCommand("");
    setFormUrl("");
    setShowForm(false);
  };

  const handleAdd = async () => {
    if (!formName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await addMCPServer({
        name: formName.trim(),
        transport: formTransport,
        command: formTransport === "stdio" ? formCommand : "",
        url: formTransport === "sse" ? formUrl : "",
      });
      resetForm();
      await loadServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add server");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!serverToDelete) return;
    setError(null);
    try {
      await removeMCPServer(serverToDelete);
      setServerToDelete(null);
      await loadServers();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to remove server",
      );
    }
  };

  const connectedCount = servers.filter(
    (s) => s.status === "connected",
  ).length;

  const displayServers = filter
    ? servers.filter(
        (s) =>
          s.name.toLowerCase().includes(filter.toLowerCase()) ||
          s.command?.toLowerCase().includes(filter.toLowerCase()) ||
          s.url?.toLowerCase().includes(filter.toLowerCase()),
      )
    : servers;

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Header ── */}
      <motion.div
        className="shrink-0 border-b border-border px-6 py-5"
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.12, ease: "easeOut" }}
      >
        <div className="mx-auto flex max-w-5xl items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">
              <Blocks className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-foreground">
                {t("mcp.title")}
              </h1>
              <p className="text-xs text-muted-foreground">
                {t("mcp.subtitle")}
              </p>
            </div>
          </div>
          {servers.length > 0 && (
            <div className="flex items-center gap-1.5 rounded-md bg-secondary px-2.5 py-1">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  connectedCount > 0
                    ? "bg-accent-emerald"
                    : "bg-muted-foreground/40",
                )}
              />
              <span className="text-xs font-medium text-muted-foreground">
                {connectedCount}/{servers.length}
              </span>
            </div>
          )}
        </div>
      </motion.div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-5xl space-y-5">
          {/* Error banner */}
          {error && (
            <motion.div
              className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-4 py-2.5"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
              <p className="flex-1 text-sm text-destructive">{error}</p>
              <button
                type="button"
                onClick={() => setError(null)}
                className="rounded-sm p-0.5 text-destructive/60 transition-colors hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          )}

          {/* Section header with search + add */}
          <div className="flex items-center gap-3">
            <h2 className="text-[15px] font-medium text-muted-foreground">
              {t("mcp.mcpServers")}
            </h2>
            <div className="flex-1" />
            {servers.length > 3 && (
              <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 text-muted-foreground-dim" />
                <input
                  type="text"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder={t("mcp.filterPlaceholder")}
                  className="w-32 bg-transparent text-xs text-foreground placeholder:text-muted-foreground-dim outline-none"
                />
                {filter && (
                  <button
                    type="button"
                    aria-label={t("mcp.clearFilter")}
                    onClick={() => setFilter("")}
                    className="rounded-sm p-0.5 text-muted-foreground-dim hover:text-muted-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowForm(true)}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              {t("mcp.addServer")}
            </Button>
          </div>

          {/* ── Server grid ── */}
          {loading && servers.length === 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <ServerSkeleton />
              <ServerSkeleton />
              <ServerSkeleton />
              <ServerSkeleton />
              <ServerSkeleton />
              <ServerSkeleton />
            </div>
          ) : displayServers.length === 0 && filter ? (
            <motion.div
              className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-12"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
            >
              <Search className="h-5 w-5 text-muted-foreground-dim" />
              <p className="text-sm text-muted-foreground">
                {t("mcp.noServersMatching", { filter })}
              </p>
            </motion.div>
          ) : servers.length === 0 ? (
            <motion.div
              className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-14"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.12, delay: 0.05 }}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-secondary">
                <Unplug className="h-5 w-5 text-muted-foreground-dim" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">
                  {t("mcp.noServers")}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("mcp.noServersHint")}
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
              variants={listContainer}
              initial="hidden"
              animate="show"
            >
              {displayServers.map((server) => (
                <motion.div key={server.name} variants={listItem} className="h-full">
                  <MCPServerCard
                    server={server}
                    onDelete={setServerToDelete}
                  />
                </motion.div>
              ))}
            </motion.div>
          )}

        </div>
      </div>

      {/* ── Add server dialog ── */}
      <Dialog open={showForm} onOpenChange={(open) => { if (!open) resetForm(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("mcp.addFormTitle")}</DialogTitle>
            <DialogDescription>{t("mcp.subtitle")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Error inside dialog */}
            {error && (
              <div className="flex items-center gap-2 rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
                <p className="flex-1 text-sm text-destructive">{error}</p>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="rounded-sm p-0.5 text-destructive transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {/* Name */}
            <div className="space-y-1.5">
              <Label htmlFor="mcp-name" className="text-xs">
                {t("mcp.name")}
              </Label>
              <Input
                id="mcp-name"
                placeholder={t("mcp.namePlaceholder")}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="font-mono"
                autoFocus
              />
            </div>

            {/* Transport toggle */}
            <div className="space-y-1.5">
              <Label className="text-xs">{t("mcp.transport")}</Label>
              <TransportToggle value={formTransport} onChange={setFormTransport} />
            </div>

            {/* Transport-specific field */}
            {formTransport === "stdio" ? (
              <div className="space-y-1.5">
                <Label htmlFor="mcp-command" className="text-xs">
                  {t("mcp.command")}
                </Label>
                <Input
                  id="mcp-command"
                  placeholder={t("mcp.commandPlaceholder")}
                  value={formCommand}
                  onChange={(e) => setFormCommand(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && formName.trim() && !submitting) {
                      handleAdd();
                    }
                  }}
                  className="font-mono"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="mcp-url" className="text-xs">
                  {t("mcp.urlLabel")}
                </Label>
                <Input
                  id="mcp-url"
                  placeholder={t("mcp.urlPlaceholder")}
                  value={formUrl}
                  onChange={(e) => setFormUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && formName.trim() && !submitting) {
                      handleAdd();
                    }
                  }}
                  className="font-mono"
                />
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={resetForm}
              >
                {t("mcp.cancel")}
              </Button>
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={submitting || !formName.trim()}
              >
                {submitting && (
                  <span className="mr-1.5 inline-block h-3.5 w-3.5 skeleton-shimmer rounded-sm" />
                )}
                {t("mcp.connect")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirmation ── */}
      <AlertDialog
        open={serverToDelete !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setServerToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("mcp.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("mcp.removeDesc", { name: serverToDelete ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t("mcp.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
            >
              {t("mcp.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
