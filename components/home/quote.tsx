const portraits = [
  {
    title: "A shop with a refund policy",
    body: "The same three questions arrive every week. The policy answers those. You only see the thread when someone asks something it does not cover.",
  },
  {
    title: "A course with a written FAQ",
    body: "Paste the FAQ. The widget handles ‘where is the login’ at 11pm. In the morning you have the conversations that actually need you.",
  },
  {
    title: "A docs site that still gets stuck visitors",
    body: "They stay on the page. If the docs do not cover it they do not fill a form — they keep typing in the same bubble.",
  },
];

export function HomeQuote() {
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-16 px-4 py-24 sm:py-32">
      <p className="max-w-3xl text-3xl font-medium leading-[1.15] tracking-[-0.03em] text-pretty sm:text-4xl">
        Every answer comes out of your document. When there isn’t one, you get
        the conversation.
      </p>
      <div className="grid gap-10 border-t pt-12 md:grid-cols-3 md:gap-12">
        {portraits.map((portrait) => (
          <div key={portrait.title} className="flex flex-col gap-3">
            <h3 className="text-[15px] font-medium">{portrait.title}</h3>
            <p className="text-[14px] leading-relaxed text-muted-foreground text-pretty">
              {portrait.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
