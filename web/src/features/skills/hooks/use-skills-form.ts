"use client";

import { useState } from "react";

export type InstallSource = "git" | "upload";

export function useSkillsForm() {
  const [showForm, setShowForm] = useState(false);
  const [installSource, setInstallSource] = useState<InstallSource>("upload");
  const [formUrl, setFormUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[] | null>(null);
  const [isFolderUpload, setIsFolderUpload] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  const resetForm = () => {
    setFormUrl("");
    setSelectedFiles(null);
    setIsFolderUpload(false);
    setFolderName("");
    setInstallSource("upload");
    setShowForm(false);
  };

  return {
    showForm,
    setShowForm,
    installSource,
    setInstallSource,
    formUrl,
    setFormUrl,
    submitting,
    setSubmitting,
    selectedFiles,
    setSelectedFiles,
    isFolderUpload,
    setIsFolderUpload,
    folderName,
    setFolderName,
    isDragging,
    setIsDragging,
    resetForm,
  };
}
