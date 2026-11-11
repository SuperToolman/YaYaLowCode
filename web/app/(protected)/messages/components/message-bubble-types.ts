import type { ReactNode } from "react";
import type { CommunicationMessageResponse } from "@/features/communication/api";

export type BubbleMessage = CommunicationMessageResponse & {
  deliveryState?: "sending" | "failed" | "delivered";
};
export type MessageBubbleProps = {
  message: BubbleMessage;
  mine: boolean;
  showSenderIdentity: boolean;
  canRecall: boolean;
  senderName: string;
  senderAvatarUrl?: string | null;
  senderAvatar?: ReactNode;
  children?: ReactNode;
  onRecall: () => void;
  onReedit: () => void;
  onRetry: () => void;
  onApprovalAction: (action: "approve" | "reject") => Promise<void>;
};
