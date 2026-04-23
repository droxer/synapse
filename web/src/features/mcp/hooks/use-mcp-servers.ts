"use client";

import { useState, useCallback } from "react";
import {
  fetchMCPServers,
  addMCPServer,
  removeMCPServer,
  toggleMCPServer,
  type MCPServer,
} from "../api/mcp-api";
import { useTranslation } from "@/i18n";
import {
  parseMCPConfig,
  type MCPTransport,
} from "../lib/parse-mcp-config";

export function useMCPServers() {
  const { t } = useTranslation();
  const [servers, setServers] = useState<readonly MCPServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add form state
  const [showForm, setShowForm] = useState(false);
  const [formSchema, setFormSchema] = useState("");
  const [formName, setFormName] = useState("");
  const [formTransport, setFormTransport] =
    useState<MCPTransport>("streamablehttp");
  const [formUrl, setFormUrl] = useState("");
  const [formHeaders, setFormHeaders] =
    useState<Readonly<Record<string, string>>>({});
  const [formTimeout, setFormTimeout] = useState<number | undefined>(undefined);
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

  const resetForm = useCallback(() => {
    setFormSchema("");
    setFormName("");
    setFormUrl("");
    setFormHeaders({});
    setFormTimeout(undefined);
    setFormTransport("streamablehttp");
    setShowForm(false);
  }, []);

  const applySchema = useCallback((value?: string) => {
    const source = value ?? formSchema;
    try {
      const parsed = parseMCPConfig(source);
      setFormSchema(source);
      setFormName(parsed.name);
      setFormTransport(parsed.transport);
      setFormUrl(parsed.url);
      setFormHeaders(parsed.headers);
      setFormTimeout(parsed.timeout);
      setError(null);
    } catch {
      setError(t("mcp.invalidSchema"));
    }
  }, [formSchema, t]);

  const handleAdd = useCallback(async () => {
    if (!formName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await addMCPServer({
        name: formName.trim(),
        transport: formTransport,
        url: formUrl,
        headers: formHeaders,
        timeout: formTimeout,
      });
      resetForm();
      await loadServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add server");
    } finally {
      setSubmitting(false);
    }
  }, [
    formName,
    formTransport,
    formUrl,
    formHeaders,
    formTimeout,
    resetForm,
    loadServers,
  ]);

  const handleDelete = useCallback(async () => {
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
  }, [serverToDelete, loadServers]);

  const handleToggle = useCallback(async (name: string, enabled: boolean) => {
    setError(null);
    try {
      await toggleMCPServer(name, enabled);
      await loadServers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to toggle server");
    }
  }, [loadServers]);

  const confirmDelete = useCallback(() => {
    handleDelete();
  }, [handleDelete]);

  const cancelDelete = useCallback(() => {
    setServerToDelete(null);
  }, []);

  return {
    servers,
    loading,
    error,
    setError,
    showForm,
    setShowForm,
    formSchema,
    setFormSchema,
    formName,
    setFormName,
    formTransport,
    setFormTransport,
    formUrl,
    setFormUrl,
    formHeaders,
    submitting,
    serverToDelete,
    setServerToDelete,
    loadServers,
    resetForm,
    applySchema,
    handleAdd,
    handleDelete,
    handleToggle,
    confirmDelete,
    cancelDelete,
  };
}
