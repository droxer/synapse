"use client";

import { motion } from "framer-motion";
import { ArrowUp } from "lucide-react";
import { cn } from "@/shared/lib/utils";
import { useTranslation } from "@/i18n";

interface SendButtonProps {
  readonly disabled?: boolean;
  readonly hasContent?: boolean;
}

export function SendButton({ disabled = false, hasContent = false }: SendButtonProps) {
  const { t } = useTranslation();
  return (
    <motion.button
      type="submit"
      disabled={disabled || !hasContent}
      aria-label={hasContent ? t("chat.sendMessage") : t("chat.typeToSend")}
      initial={{ scale: 0.85, opacity: 0 }}
      animate={{
        scale: hasContent ? 1 : 0.85,
        opacity: hasContent ? 1 : 0.5,
      }}
      exit={{ scale: 0.85, opacity: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-full",
        "transition-colors transition-transform duration-200 ease-out",
        "outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        hasContent
          ? [
              "bg-cobalt text-on-cobalt",
              "hover:bg-cobalt-deep",
              "active:scale-95",
            ]
          : "bg-transparent text-stone cursor-default",
      )}
    >
      <ArrowUp
        className="h-3.5 w-3.5 transition-transform duration-200"
        strokeWidth={2.5}
      />
    </motion.button>
  );
}
