"use client";

import { Button, Input, Modal, TextArea } from "@heroui/react";

type EmailMessageModalProps = {
  open: boolean;
  subject: string;
  body: string;
  onOpenChange: (open: boolean) => void;
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  onSend: () => void;
};

export function EmailMessageModal({
  open, subject, body, onOpenChange, onSubjectChange, onBodyChange, onSend,
}: EmailMessageModalProps) {
  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop className="theme-modal-backdrop" isDismissable>
        <Modal.Container placement="center" size="md">
          <Modal.Dialog>
            <Modal.Header>
              <Modal.Heading>发送邮件消息</Modal.Heading>
              <Modal.CloseTrigger aria-label="关闭" />
            </Modal.Header>
            <Modal.Body>
              <Input
                autoFocus
                fullWidth
                placeholder="邮件主题"
                value={subject}
                onChange={(event) =>
                  onSubjectChange(event.currentTarget.value)
                }
              />
              <TextArea
                fullWidth
                placeholder="邮件正文"
                value={body}
                onChange={(event) =>
                  onBodyChange(event.currentTarget.value)
                }
              />
            </Modal.Body>
            <Modal.Footer>
              <Button onPress={() => onOpenChange(false)}>取消</Button>
              <Button
                isDisabled={!subject.trim() || !body.trim()}
                onPress={() => {
                  onSend();
                }}
              >
                发送
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
