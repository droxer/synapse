"use client";

import Image from "next/image";

interface ArtifactScreenshotGalleryProps {
  readonly conversationId: string;
  readonly artifactIds: readonly string[];
  readonly alt: string;
}

export function ArtifactScreenshotGallery({
  conversationId,
  artifactIds,
  alt,
}: ArtifactScreenshotGalleryProps) {
  return (
    <div className="mb-2 rounded-md bg-muted p-1.5">
      <div className="flex flex-col gap-2">
        {artifactIds.map((artifactId) => (
          <div
            key={artifactId}
            className="relative aspect-video w-full overflow-hidden rounded-md bg-background"
          >
            <Image
              src={`/api/conversations/${conversationId}/artifacts/${artifactId}`}
              alt={alt}
              fill
              unoptimized
              sizes="(max-width: 1024px) 100vw, 44vw"
              className="object-contain"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
