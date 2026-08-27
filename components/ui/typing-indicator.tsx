import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Message, MessageContent } from "@/components/ui/message";
import { MessageScrollerItem } from "@/components/ui/message-scroller";

export function TypingIndicator({
  messageId,
  label,
}: {
  messageId: string;
  label: string;
}) {
  return (
    <MessageScrollerItem messageId={messageId}>
      <Message
        align="start"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <MessageContent>
          <Bubble variant="ghost" align="start">
            <BubbleContent>
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-0.5" aria-hidden="true">
                  <span className="size-1 rounded-full bg-current motion-safe:animate-bounce motion-reduce:animate-none motion-safe:[animation-delay:-300ms]" />
                  <span className="size-1 rounded-full bg-current motion-safe:animate-bounce motion-reduce:animate-none motion-safe:[animation-delay:-150ms]" />
                  <span className="size-1 rounded-full bg-current motion-safe:animate-bounce motion-reduce:animate-none" />
                </span>
                {label}
              </span>
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    </MessageScrollerItem>
  );
}
