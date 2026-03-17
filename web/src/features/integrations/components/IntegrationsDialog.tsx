"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Trash2,
  Plus,
  Terminal,
  Radio,
  Unplug,
  Wrench,
} from "lucide-react";
import { TransportToggle } from "./TransportToggle";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/shared/components/ui/dialog";
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
const listItem = {
  hidden: { opacity: 0, y: 4 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.2, ease: "easeOut" as const },
  },
};

/* ── shimmer skeleton ── */
function ServerSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
      <div className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/20 animate-shimmer" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-24 rounded bg-muted-foreground/10 animate-shimmer" />
        <div className="h-3 w-16 rounded bg-muted-foreground/8 animate-shimmer" />
      </div>
    </div>
  );
}

interface IntegrationsDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

export function IntegrationsDialog({
  open,
  onOpenChange,
}: IntegrationsDialogProps) {
  const [servers, setServers] = useState<readonly MCPServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formTransport, setFormTransport] = useState<"stdio" | "sse">("stdio");
  const [formCommand, setFormCommand] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
    if (open) {
      loadServers();
    }
  }, [open, loadServers]);

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

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Integrations</DialogTitle>
            <DialogDescription>
              Connect MCP servers to extend your agent&apos;s capabilities.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Error banner */}
            <AnimatePresence>
              {error && (
                <motion.div
                  className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
                  <p className="text-sm text-destructive">{error}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Section header */}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-muted-foreground">
                MCP Servers
              </h3>
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

            {/* Server list */}
            <div className="space-y-2">
              {loading && servers.length === 0 ? (
                <>
                  <ServerSkeleton />
                  <ServerSkeleton />
                </>
              ) : servers.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2.5 rounded-lg border border-dashed border-border py-10">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary">
                    <Unplug className="h-4 w-4 text-muted-foreground/50" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    No MCP servers configured
                  </p>
                </div>
              ) : (
                servers.map((server) => (
                  <motion.div
                    key={server.name}
                    variants={listItem}
                    initial="hidden"
                    animate="show"
                    className="group flex items-center gap-3 rounded-lg border border-border px-4 py-3 transition-shadow duration-200 hover:shadow-card-hover"
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
                          {server.transport === "stdio" ? (
                            <Terminal className="h-3 w-3" />
                          ) : (
                            <Radio className="h-3 w-3" />
                          )}
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
                ))
              )}
            </div>

            {/* Add form */}
            <AnimatePresence>
              {showForm && (
                <motion.div
                  className="space-y-4 rounded-lg border border-border bg-card p-4"
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.2, ease: "easeOut" }}
                >
                  <h3 className="text-sm font-semibold text-foreground">
                    Add MCP Server
                  </h3>

                  {/* Name */}
                  <div className="space-y-1.5">
                    <Label htmlFor="mcp-dialog-name" className="text-xs">
                      Name
                    </Label>
                    <Input
                      id="mcp-dialog-name"
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
                      <Label htmlFor="mcp-dialog-command" className="text-xs">
                        Command
                      </Label>
                      <Input
                        id="mcp-dialog-command"
                        placeholder="npx -y @modelcontextprotocol/server-example"
                        value={formCommand}
                        onChange={(e) => setFormCommand(e.target.value)}
                        className="font-mono"
                      />
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <Label htmlFor="mcp-dialog-url" className="text-xs">
                        URL
                      </Label>
                      <Input
                        id="mcp-dialog-url"
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
                        <span className="mr-1.5 inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-shimmer" />
                      )}
                      Connect
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
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
    </>
  );
}
