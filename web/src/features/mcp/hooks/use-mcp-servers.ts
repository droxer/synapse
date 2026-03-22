"use client";

import { useState, useCallback } from "react";
import {
  fetchMCPServers,
  addMCPServer,
  removeMCPServer,
  toggleMCPServer,
  type MCPServer,
} from "../api/mcp-api";

export function useMCPServers() {
  const [servers, setServers] = useState<readonly MCPServer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const resetForm = useCallback(() => {
    setFormName("");
    setFormCommand("");
    setFormUrl("");
    setFormTransport("sse");
    setShowForm(false);
  }, []);

  const handleAdd = useCallback(async () => {
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
  }, [formName, formTransport, formCommand, formUrl, resetForm, loadServers]);

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
    confirmDelete,
    cancelDelete,
  };
}
