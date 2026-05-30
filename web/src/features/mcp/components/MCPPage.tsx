"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Blocks, Plus, Unplug, Search } from "lucide-react";
import { EmptyState } from "@/shared/components/EmptyState";
import { ErrorBanner } from "@/shared/components/ErrorBanner";
import { ProductPageHeader, ProductSectionHeader, ProductStatCard } from "@/shared/components/ProductPage";
import { SearchInput } from "@/shared/components/SearchInput";
import { ToolingCardSkeletonGrid } from "@/shared/components/ToolingCard";
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

  const connectedCount = servers.filter((s) => s.status === "connected").length;
  const httpCount = servers.filter((s) => s.transport === "streamablehttp").length;
  const sseCount = servers.filter((s) => s.transport === "sse").length;

  const displayServers = filter
    ? servers.filter(
        (s) =>
          s.name.toLowerCase().includes(filter.toLowerCase()) ||
          s.url?.toLowerCase().includes(filter.toLowerCase()),
      )
    : servers;

  return (
    <div className="flex h-full flex-col bg-canvas">
      <ProductPageHeader
        icon={<Blocks className="h-5 w-5 text-steel" />}
        eyebrow={t("mcp.mcpServers")}
        title={t("mcp.title")}
        description={t("mcp.subtitle")}
        stats={
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
                <span className="ml-1 text-sm text-steel">/ {servers.length}</span>
              </>
            }
            description={`HTTP ${httpCount} · SSE ${sseCount}`}
          />
        }
        statsClassName="grid-cols-1 lg:min-w-[18rem]"
      />

      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-6xl space-y-5">
          {error && (
            <ErrorBanner message={error} onDismiss={() => setError(null)} />
          )}

          <ProductSectionHeader
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
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowForm(true)}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  {t("mcp.addServer")}
                </Button>
              </>
            }
          />

          {loading && servers.length === 0 ? (
            <ToolingCardSkeletonGrid />
          ) : displayServers.length === 0 && filter ? (
            <EmptyState
              icon={Search}
              description={t("mcp.noServersMatching", { filter })}
              dashed
            />
          ) : servers.length === 0 ? (
            <EmptyState
              icon={Unplug}
              title={t("mcp.noServers")}
              description={t("mcp.noServersHint")}
              dashed
            />
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
            <AlertDialogCancel>{t("mcp.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-critical text-white hover:bg-critical/90"
            >
              {t("mcp.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
