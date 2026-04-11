"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import {
  Blocks,
  Plus,
  Unplug,
  Search,
} from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/shared/components/EmptyState";
import { ErrorBanner } from "@/shared/components/ErrorBanner";
import { SearchInput } from "@/shared/components/SearchInput";
import { MCPServerCard } from "./MCPServerCard";
import { MCPServerForm } from "./MCPServerForm";
import { Button } from "@/shared/components/ui/button";
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
import { listVariants } from "@/shared/lib/animations";
import { useTranslation } from "@/i18n";
import { useMCPServers } from "../hooks/use-mcp-servers";

/* ── shimmer skeleton matching card shape ── */
function ServerSkeleton() {
  return (
    <div className="surface-panel flex flex-col p-4">
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
  const [filter, setFilter] = useState("");

  const {
    servers,
    loading,
    error,
    setError,
    showForm,
    setShowForm,
    formName,
    setFormName,
    formTransport,
    setFormTransport,
    formCommand,
    setFormCommand,
    formUrl,
    setFormUrl,
    submitting,
    serverToDelete,
    setServerToDelete,
    loadServers,
    resetForm,
    handleAdd,
    handleDelete,
    handleToggle,
  } = useMCPServers();

  useEffect(() => {
    loadServers();
  }, [loadServers]);

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
        <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="chip-muted flex h-9 w-9 shrink-0 items-center justify-center">
              <Blocks className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                {t("mcp.title")}
              </h1>
              <p className="text-xs text-muted-foreground">
                {t("mcp.subtitle")}
              </p>
            </div>
          </div>
          {servers.length > 0 && (
            <div className="status-pill chip-muted px-2.5 py-1">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  connectedCount > 0
                    ? "bg-foreground"
                    : "bg-border-strong",
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
            <ErrorBanner message={error} onDismiss={() => setError(null)} />
          )}

          {/* Section header with search + add */}
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-medium text-muted-foreground">
              {t("mcp.mcpServers")}
            </h2>
            <div className="flex-1" />
            {servers.length > 3 && (
              <SearchInput
                value={filter}
                onChange={setFilter}
                placeholder={t("mcp.filterPlaceholder")}
                clearLabel={t("mcp.clearFilter")}
              />
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
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.15 }}
            >
              <EmptyState
                icon={Search}
                description={t("mcp.noServersMatching", { filter })}
                dashed
              />
            </motion.div>
          ) : servers.length === 0 ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.12, delay: 0.05 }}
            >
              <EmptyState
                icon={Unplug}
                title={t("mcp.noServers")}
                description={t("mcp.noServersHint")}
                dashed
              />
            </motion.div>
          ) : (
            <motion.div
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
              variants={listVariants.container}
              initial="hidden"
              animate="show"
            >
              {displayServers.map((server) => (
                <motion.div key={server.name} variants={listVariants.item} className="h-full">
                  <MCPServerCard
                    server={server}
                    onDelete={setServerToDelete}
                    onToggle={handleToggle}
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

          <MCPServerForm
            error={error}
            onDismissError={() => setError(null)}
            formName={formName}
            onFormNameChange={setFormName}
            formTransport={formTransport}
            onFormTransportChange={setFormTransport}
            formCommand={formCommand}
            onFormCommandChange={setFormCommand}
            formUrl={formUrl}
            onFormUrlChange={setFormUrl}
            submitting={submitting}
            onSubmit={handleAdd}
            onCancel={resetForm}
            idPrefix="mcp-page"
          />
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
