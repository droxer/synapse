"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import {
  Trash2,
  Pencil,
  Plus,
  Radio,
  Unplug,
  Wrench,
  Globe,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/components/ui/dialog";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";
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
import { listContainer, listItem } from "@/shared/lib/animations";
import { useTranslation } from "@/i18n";
import { useMCPServers } from "../hooks/use-mcp-servers";
import { MCPAddServerDialog } from "./MCPAddServerDialog";

/* ── shimmer skeleton ── */
function ServerSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
      <div className="h-2 w-2 shrink-0 rounded-full skeleton-shimmer" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-24 rounded skeleton-shimmer" />
        <div className="h-3 w-16 rounded skeleton-shimmer" />
      </div>
    </div>
  );
}

interface MCPDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function MCPDialog({
  open,
  onOpenChange,
}: MCPDialogProps) {
  const { t } = useTranslation();
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
    if (open) {
      loadServers();
    }
  }, [open, loadServers]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("mcp.title")}</DialogTitle>
            <DialogDescription>
              {t("mcp.subtitle")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Section header */}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-muted-foreground">
                {t("mcp.mcpServers")}
              </h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowForm(true)}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t("mcp.addServer")}
              </Button>
            </div>

            {/* Server list */}
            <div className="space-y-2">
              {loading && servers.length === 0 ? (
                <>
                  <ServerSkeleton />
                  <ServerSkeleton />
                </>
              ) : servers.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2.5 rounded-lg border border-dashed border-border py-14">
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
                </div>
              ) : (
                <motion.div className="space-y-2" variants={listContainer} initial="hidden" animate="show">
                {servers.map((server) => (
                  <motion.div
                    key={server.name}
                    variants={listItem}
                    initial="hidden"
                    animate="show"
                    className={cn(
                      "group flex items-center gap-3 rounded-lg border px-4 py-3 transition-[border-color,background-color] duration-200 ease-out",
                      server.enabled === false
                        ? "border-border hover:border-border"
                        : "border-border hover:border-border-strong hover:bg-muted",
                    )}
                  >
                    {/* Status dot */}
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full transition-colors duration-200",
                        server.enabled === false
                          ? "bg-border-strong"
                          : server.status === "connected"
                            ? "bg-foreground"
                            : "bg-border-strong",
                      )}
                    />
                    <span className="sr-only">
                      {server.status === "connected" ? t("mcp.connected") : t("mcp.disconnected")}
                    </span>

                    {/* Server info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "truncate text-sm font-medium transition-colors duration-200",
                          server.enabled === false ? "text-muted-foreground" : "text-foreground",
                        )}>
                          {server.name}
                        </span>
                        <Badge
                          variant="secondary"
                          className={cn(
                            "gap-1 font-mono text-xs transition-opacity duration-200",
                            server.enabled === false && "opacity-60",
                          )}
                        >
                          {server.transport === "streamablehttp" ? (
                            <Globe className="h-3 w-3" />
                          ) : (
                            <Radio className="h-3 w-3" />
                          )}
                          {server.transport}
                        </Badge>
                      </div>
                      <div className={cn(
                        "mt-0.5 flex items-center gap-1.5 text-xs transition-colors duration-200",
                        server.enabled === false ? "text-muted-foreground-dim" : "text-muted-foreground",
                      )}>
                        <Wrench className="h-3 w-3" />
                        <span>
                          {server.tool_count === 1
                            ? t("mcp.toolCount", { count: server.tool_count })
                            : t("mcp.toolsCount", { count: server.tool_count })}
                        </span>
                        {server.url && (
                          <>
                            <span className="text-border">|</span>
                            <span className="truncate font-mono">
                              {server.url}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Toggle */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={server.enabled !== false}
                      aria-label={server.enabled !== false ? t("mcp.disable") : t("mcp.enable")}
                      className={cn(
                        "flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-micro font-medium transition-colors duration-150",
                        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                        server.enabled === false
                          ? "bg-secondary text-muted-foreground-dim hover:bg-secondary hover:text-muted-foreground"
                          : "border border-border bg-muted text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                      onClick={() => handleToggle(server.name, server.enabled === false)}
                    >
                      <span className={cn(
                        "h-1.5 w-1.5 rounded-full transition-colors duration-150",
                        server.enabled === false ? "bg-border-strong" : "bg-foreground",
                      )} />
                      {server.enabled === false ? t("mcp.disabled") : t("mcp.enabled")}
                    </button>

                    {/* Delete */}
                    {server.editable !== false && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="shrink-0 text-transparent transition-colors group-hover:text-muted-foreground group-focus-within:text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                            onClick={() => startEdit(server)}
                            aria-label={t("mcp.editServer", { name: server.name })}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {t("mcp.editServer", { name: server.name })}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 text-transparent transition-colors group-hover:text-muted-foreground group-focus-within:text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                      onClick={() => setServerToDelete(server.name)}
                      aria-label={t("mcp.removeServer", { name: server.name })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </motion.div>
                ))
                }
                </motion.div>
              )}
            </div>

          </div>
        </DialogContent>
      </Dialog>

      <MCPAddServerDialog
        open={showForm}
        onOpenChange={(isOpen) => { if (!isOpen) resetForm(); }}
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
        idPrefix="mcp-dialog"
      />

      {/* Delete confirmation */}
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
    </>
  );
}
