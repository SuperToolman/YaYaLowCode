"use client";

import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";

export default function RecordsImageViewer({ images, index, onClose }: {
  images: Array<{ src: string; alt: string }>;
  index: number;
  onClose: () => void;
}) {
  return <Lightbox
    open
    close={onClose}
    slides={images}
    index={index}
    plugins={[Zoom]}
    zoom={{ scrollToZoom: true, maxZoomPixelRatio: 3 }}
    carousel={{ finite: true }}
    labels={{ Close: "关闭", Previous: "上一张", Next: "下一张", "Zoom in": "放大", "Zoom out": "缩小" }}
  />;
}
