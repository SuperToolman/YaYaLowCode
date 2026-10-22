"use client";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import type { ConversationImage } from "./message-images";
export default function MessageImageViewer({ images, activeId, onClose, onView }: { images: ConversationImage[]; activeId: string; onClose: () => void; onView: (id: string) => void }) {
  return <Lightbox open close={onClose} slides={images} index={Math.max(0, images.findIndex(image => image.id === activeId))} plugins={[Zoom]} zoom={{ scrollToZoom: true, maxZoomPixelRatio: 3 }} carousel={{ finite: true }} on={{ view: ({ index }) => { if (images[index]) onView(images[index].id); } }} labels={{ Close: "关闭", Previous: "上一张", Next: "下一张", "Zoom in": "放大", "Zoom out": "缩小" }} />;
}
