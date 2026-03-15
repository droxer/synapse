import Image from "next/image";

export default function Loading() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background">
      <Image
        src="/logo.png"
        alt="HiAgent"
        width={48}
        height={48}
        className="animate-pulse rounded-lg"
        priority
      />
    </div>
  );
}
