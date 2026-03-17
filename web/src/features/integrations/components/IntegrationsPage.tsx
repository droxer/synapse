"use client";

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Blocks,
  Trash2,
  Plus,
  Terminal,
  Radio,
  Unplug,
  Wrench,
} from "lucide-react";
import { TransportToggle } from "./TransportToggle";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { Badge } from "@/shared/components/ui/badge";
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
    transition: { staggerChildren: 0.06, delayChildren: 0.15 },
  },
};

const listItem = {
  hidden: { opacity: 0, y: 6 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: "easeOut" as const },
  },
};

/* ── shimmer skeleton for loading state ── */
function ServerSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/20 animate-shimmer" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-28 rounded bg-muted-foreground/10 animate-shimmer" />
        <div className="h-3 w-20 rounded bg-muted-foreground/8 animate-shimmer" />
      </div>
    </div>
  );
}

/* ── transport icon helper ── */
function TransportIcon({
  transport,
  className,
}: {
  readonly transport: "stdio" | "sse";
  readonly className?: string;
}) {
  return transport === "stdio" ? (
    <Terminal className={cn("h-3 w-3", className)} />
  ) : (
    <Radio className={cn("h-3 w-3", className)} />
  );
}

export function IntegrationsPage() {
  const [servers, setServers] = useState<readonly MCPServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add form state
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formTransport, setFormTransport] = useState<"stdio" | "sse">("stdio");
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

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Header ── */}
      <motion.div
        className="shrink-0 border-b border-border px-6 py-5"
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: "easeOut" }}
      >
        <div className="mx-auto flex max-w-2xl items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary">
              <Blocks className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <h1 className="text-base font-semibold tracking-tight text-foreground">
                Integrations
              </h1>
              <p className="text-xs text-muted-foreground">
                Connect MCP servers to extend your agent&apos;s capabilities
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
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-2xl space-y-5">
          {/* Error banner */}
          {error && (
            <motion.div
              className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2.5"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
              <p className="text-sm text-destructive">{error}</p>
            </motion.div>
          )}

          {/* Section header */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">
              MCP Servers
            </h2>
            {!showForm && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowForm(true)}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add Server
              </Button>
            )}
          </div>

          {/* ── Server list ── */}
          {loading && servers.length === 0 ? (
            <div className="space-y-2">
              <ServerSkeleton />
              <ServerSkeleton />
            </div>
          ) : servers.length === 0 ? (
            <motion.div
              className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-14"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.1 }}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary">
                <Unplug className="h-5 w-5 text-muted-foreground/50" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground/80">
                  No servers connected
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Add an MCP server to extend your agent with new tools
                </p>
              </div>
            </motion.div>
          ) : (
            <motion.div
              className="space-y-2"
              variants={listContainer}
              initial="hidden"
              animate="show"
            >
              {servers.map((server) => (
                <motion.div
                  key={server.name}
                  variants={listItem}
                  className="group flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-shadow duration-200 hover:shadow-card-hover"
                >
                  {/* Status dot */}
                  <span
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full transition-colors",
                      server.status === "connected"
                        ? "bg-accent-emerald"
                        : "bg-muted-foreground/30",
                    )}
                  />

                  {/* Server info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-foreground">
                        {server.name}
                      </span>
                      <Badge
                        variant="secondary"
                        className="gap-1 font-mono text-xs"
                      >
                        <TransportIcon transport={server.transport} />
                        {server.transport}
                      </Badge>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Wrench className="h-3 w-3" />
                      <span>
                        {server.tool_count} tool
                        {server.tool_count !== 1 ? "s" : ""}
                      </span>
                      {server.command && (
                        <>
                          <span className="text-border">|</span>
                          <span className="truncate font-mono">
                            {server.command}
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Delete */}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground group-focus-within:text-muted-foreground hover:text-destructive"
                    onClick={() => setServerToDelete(server.name)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* ── Add form ── */}
          {showForm && (
            <motion.div
              className="space-y-4 rounded-lg border border-border bg-card p-5"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              <h3 className="text-sm font-semibold text-foreground">
                Add MCP Server
              </h3>

              {/* Name */}
              <div className="space-y-1.5">
                <Label htmlFor="mcp-name" className="text-xs">
                  Name
                </Label>
                <Input
                  id="mcp-name"
                  placeholder="my-server"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="font-mono"
                />
              </div>

              {/* Transport toggle */}
              <div className="space-y-1.5">
                <Label className="text-xs">Transport</Label>
                <TransportToggle value={formTransport} onChange={setFormTransport} />
              </div>

              {/* Transport-specific field */}
              {formTransport === "stdio" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-command" className="text-xs">
                    Command
                  </Label>
                  <Input
                    id="mcp-command"
                    placeholder="npx -y @modelcontextprotocol/server-example"
                    value={formCommand}
                    onChange={(e) => setFormCommand(e.target.value)}
                    className="font-mono"
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="mcp-url" className="text-xs">
                    URL
                  </Label>
                  <Input
                    id="mcp-url"
                    placeholder="http://localhost:3001/sse"
                    value={formUrl}
                    onChange={(e) => setFormUrl(e.target.value)}
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
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleAdd}
                  disabled={submitting || !formName.trim()}
                >
                  {submitting && (
                    <span className="mr-1.5 inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  )}
                  Connect
                </Button>
              </div>
            </motion.div>
          )}
        </div>
      </div>

      {/* ── Delete confirmation ── */}
      <AlertDialog
        open={serverToDelete !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen) setServerToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove server</AlertDialogTitle>
            <AlertDialogDescription>
              Disconnect and remove{" "}
              <span className="font-mono font-medium text-foreground">
                {serverToDelete}
              </span>
              ? Its tools will no longer be available.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-primary-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
