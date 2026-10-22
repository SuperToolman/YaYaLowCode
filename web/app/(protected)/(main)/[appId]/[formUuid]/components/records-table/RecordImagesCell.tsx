"use client";
/* eslint-disable @next/next/no-img-element -- same-origin authenticated file downloads */

import dynamic from "next/dynamic";
import { useState } from "react";

const ImageViewer = dynamic(() => import("./RecordsImageViewer"), { ssr: false });

export function RecordImagesCell({ value }: { value: unknown }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const images = (Array.isArray(value) ? value : []).flatMap((item) => {
    if (!item || typeof item !== "object" || typeof item.fileId !== "string" || !item.fileId) return [];
    return [{
      src: `/api/files/${encodeURIComponent(item.fileId)}/download`,
      alt: typeof item.name === "string" && item.name ? item.name : "图片",
    }];
  });

  if (!images.length) return <span>-</span>;

  return <>
    <div className="flex items-center gap-1 overflow-x-auto" onClick={(event) => event.stopPropagation()}>
      {images.map((image, index) => (
        <button
          key={`${image.src}:${index}`}
          type="button"
          aria-label={`查看图片：${image.alt}`}
          className="h-[30px] w-[30px] shrink-0 overflow-hidden rounded outline-none focus-visible:ring-2 focus-visible:ring-focus"
          onClick={() => setActiveIndex(index)}
        >
          <img src={image.src} alt={image.alt} loading="lazy" className="block h-[30px] w-[30px] object-cover" />
        </button>
      ))}
    </div>
    {activeIndex !== null ? <ImageViewer images={images} index={activeIndex} onClose={() => setActiveIndex(null)} /> : null}
  </>;
}
