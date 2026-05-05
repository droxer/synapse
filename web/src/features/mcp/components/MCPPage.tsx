"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  Blocks,
  Globe,
  Plus,
  Unplug,
  Search,
  Radio,
} from "lucide-react";
import { EmptyState } from "@/shared/components/EmptyState";
import { ErrorBanner } from "@/shared/components/ErrorBanner";
import { ProductPageHeader, ProductSectionHeader, ProductStatCard } from "@/shared/components/ProductPage";
import { SearchInput } from "@/shared/components/SearchInput";
import { MCPServerCard } from "./MCPServerCard";
import { MCPAddServerDialog } from "./MCPAddServerDialog";
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
    formSchema,
    setFormSchema,
    formName,
    formTransport,
    formHeaders,
    serverToEdit,
    submitting,
    serverToDelete,
    setServerToDelete,
    loadServers,
    resetForm,
    applySchema,
    startEdit,
    handleSave,
    handleDelete,
    handleToggle,
  } = useMCPServers();

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  const connectedCount = servers.filter(
    (s) => s.status === "connected",
  ).length;
  const streamableCount = useMemo(
    () => servers.filter((s) => s.transport === "streamablehttp").length,
    [servers],
  );
  const sseCount = useMemo(
    () => servers.filter((s) => s.transport === "sse").length,
    [servers],
  );

  const displayServers = filter
    ? servers.filter(
        (s) =>
          s.name.toLowerCase().includes(filter.toLowerCase()) ||
          s.url?.toLowerCase().includes(filter.toLowerCase()),
      )
    : servers;

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Header ── */}
      <ProductPageHeader
        className="py-6"
        icon={<Blocks className="h-5 w-5 text-muted-foreground" />}
        eyebrow={t("mcp.mcpServers")}
        title={t("mcp.title")}
        description={t("mcp.subtitle")}
        statsClassName="grid-cols-1 sm:grid-cols-3 lg:min-w-[24rem]"
        stats={
          <>
            <ProductStatCard
              label={t("topbar.connected")}
              icon={
                <span
                  className={cn(
                    "block h-2 w-2 rounded-full",
                    connectedCount > 0 ? "bg-accent-emerald" : "bg-border-strong",
                  )}
                />
              }
              value={
                <>
                  {connectedCount}
                  <span className="ml-1 text-sm text-muted-foreground">/ {servers.length}</span>
                </>
              }
            />
            <ProductStatCard
              label="HTTP"
              icon={<Globe className="h-3.5 w-3.5" />}
              value={streamableCount}
            />
            <ProductStatCard
              label="SSE"
              icon={<Radio className="h-3.5 w-3.5" />}
              value={sseCount}
            />
          </>
        }
      />

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-6xl space-y-5">
          {/* Error banner */}
          {error && (
            <ErrorBanner message={error} onDismiss={() => setError(null)} />
          )}

          {/* Section header with search + add */}
          <ProductSectionHeader
            eyebrow={t("mcp.mcpServers")}
            description={
              servers.length > 0
                ? `${connectedCount}/${servers.length} ${t("topbar.connected")}`
                : t("mcp.subtitle")
            }
            actions={
              <>
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
              </>
            }
          />

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
                    onEdit={startEdit}
                    onDelete={setServerToDelete}
                    onToggle={handleToggle}
                  />
                </motion.div>
              ))}
            </motion.div>
          )}

        </div>
      </div>

      <MCPAddServerDialog
        open={showForm}
        onOpenChange={(open) => { if (!open) resetForm(); }}
        error={error}
        onDismissError={() => setError(null)}
        formSchema={formSchema}
        onFormSchemaChange={setFormSchema}
        formName={formName}
        formTransport={formTransport}
        headerCount={Object.keys(formHeaders).length}
        submitting={submitting}
        mode={serverToEdit ? "edit" : "add"}
        onApplySchema={applySchema}
        onSubmit={handleSave}
        onCancel={resetForm}
        idPrefix="mcp-page"
      />

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
