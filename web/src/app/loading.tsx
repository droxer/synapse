import { LogoMark } from "@/shared/components/Logo";

export default function Loading() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background" role="status">
      <LogoMark size={48} className="animate-pulse" />
      <span className="sr-only">Loading...</span>
    </div>
  );
}
