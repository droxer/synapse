import type { LucideIcon } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/shared/components/ui/tooltip";

interface IconButtonProps {
  icon: LucideIcon;
  label: string;
  size?: "icon-xs" | "icon-sm";
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  className?: string;
  variant?: "ghost" | "default";
}

export function IconButton({
  icon: Icon,
  label,
  size = "icon-sm",
  onClick,
  disabled,
  type = "button",
  className = "text-muted-foreground",
  variant = "ghost",
}: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={variant}
          size={size}
          type={type}
          onClick={onClick}
          disabled={disabled}
          className={className}
          aria-label={label}
        >
          <Icon />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
