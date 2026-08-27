"use client";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const questions = [
  {
    value: "chatbot",
    question: "Is this just a chatbot that reads a file?",
    answer:
      "Answering from a file is one behavior. The product is the inbox, the widget, and the handoff into a human conversation. Without the inbox, it is a demo. With only the inbox, it is a chat toy.",
  },
  {
    value: "live-chat",
    question: "Is this live chat?",
    answer:
      "Yes, after handoff. Before that it is a grounded assistant in the same thread. Replies persist first, then show on the other side within a second or two.",
  },
  {
    value: "unknown",
    question: "What happens when the assistant does not know?",
    answer:
      "It may only use the extracted passages and the current thread. If nothing matches, it says it does not know. Talk to a person is always visible, not only a sentence in the model output.",
  },
  {
    value: "email",
    question: "Do visitors have to leave a name or email first?",
    answer:
      "No. The first action is typing, or tapping a starter chip. After handoff they may leave an email so you can see it on the inbox row.",
  },
  {
    value: "files",
    question: "What can I upload?",
    answer:
      "One source at a time: a PDF, Word (.docx), Markdown, or .txt file, or Markdown pasted into the box. At most 10 MB.",
  },
  {
    value: "delete",
    question: "What if I replace or delete the file?",
    answer:
      "Replace extracts again. The next assistant answer uses the new text. Old messages stay. Delete takes the widget down until another source is ready.",
  },
];

export function HomeFaq() {
  return (
    <section
      id="faq"
      className="mx-auto flex w-full max-w-5xl scroll-mt-24 flex-col gap-12 px-4 py-24 sm:py-32"
    >
      <h2 className="max-w-xl text-3xl font-medium tracking-[-0.03em] sm:text-4xl">
        Questions we already have answers for
      </h2>
      <Accordion defaultValue={["chatbot"]} className="border-t">
        {questions.map((item) => (
          <AccordionItem key={item.value} value={item.value}>
            <AccordionTrigger className="py-6 text-[17px] font-medium hover:no-underline">
              {item.question}
            </AccordionTrigger>
            <AccordionContent className="max-w-2xl pb-6 text-[15px] leading-relaxed text-muted-foreground">
              {item.answer}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </section>
  );
}
