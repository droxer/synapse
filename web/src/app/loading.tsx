import { LogoMark } from "@/shared/components/Logo";

export default function Loading() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <LogoMark size={48} className="animate-pulse" />
    </div>
  );
}
