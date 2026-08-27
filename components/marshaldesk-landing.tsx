"use client";

import { useRef } from "react";
import {
  motion,
  useInView,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "framer-motion";
import { ArrowRight, Check } from "lucide-react";
import { NavbarAuthActions } from "@/components/auth/navbar-auth-actions";

const revealEase = [0.16, 1, 0.3, 1] as const;

const heroVideo =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260405_170732_8a9ccda6-5cff-4628-b164-059c500a2b41.mp4";
const featureVideo =
  "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260406_133058_0504132a-0cf3-4450-a370-8ea3b05c95d4.mp4";

const features = [
  {
    id: "knowledge",
    number: "01",
    title: "Answers from your source.",
    image:
      "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260405_171918_4a5edc79-d78f-4637-ac8b-53c43c220606.png&w=1280&q=85",
    points: [
      "Upload a PDF, Word, Markdown, or text file.",
      "Answers stay grounded in its extracted passages.",
      "When the source is silent, the assistant says so.",
      "A human handoff is always one click away.",
    ],
  },
  {
    id: "widget",
    number: "02",
    title: "A widget that feels like yours.",
    image:
      "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260405_171741_ed9845ab-f5b2-4018-8ce7-07cc01823522.png&w=1280&q=85",
    points: [
      "Set the display name, greeting, theme, and position.",
      "See every change in a live preview.",
      "Copy one snippet to install it on your site.",
    ],
  },
  {
    id: "inbox",
    number: "03",
    title: "The inbox takes it from here.",
    image:
      "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260405_171809_f56666dc-c099-4778-ad82-9ad4f209567b.png&w=1280&q=85",
    points: [
      "Human handoffs arrive in a readable thread.",
      "Reply in the same conversation your visitor started.",
      "Resolve the conversation without losing its history.",
    ],
  },
];

function WordsPullUp({
  text,
  className = "",
  showAsterisk = false,
}: {
  text: string;
  className?: string;
  showAsterisk?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-40px" });
  const shouldReduceMotion = useReducedMotion();
  const words = text.split(" ");

  return (
    <span ref={ref} className={`inline-flex flex-wrap ${className}`}>
      {words.map((word, index) => {
        const isLastWord = index === words.length - 1;

        return (
          <span
            key={`${word}-${index}`}
            className="inline-block overflow-visible pb-[0.08em] pr-[0.18em]"
          >
            <motion.span
              className="inline-block"
              initial={shouldReduceMotion ? false : { opacity: 0, transform: "translateY(20px)" }}
              animate={isInView ? { opacity: 1, transform: "translateY(0px)" } : undefined}
              transition={{ duration: 0.64, delay: index * 0.08, ease: revealEase }}
            >
              {showAsterisk && isLastWord ? (
                <span className="relative inline-block">
                  {word}
                  <sup className="absolute -right-[0.3em] top-[0.65em] text-[0.31em] leading-none">
                    *
                  </sup>
                </span>
              ) : (
                word
              )}
            </motion.span>
          </span>
        );
      })}
    </span>
  );
}

function WordsPullUpMultiStyle({
  segments,
  className = "",
}: {
  segments: Array<{ text: string; className?: string }>;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-40px" });
  const shouldReduceMotion = useReducedMotion();
  const words = segments.flatMap((segment) =>
    segment.text.split(" ").map((word) => ({
      word,
      className: segment.className ?? "",
    })),
  );

  return (
    <span ref={ref} className={`inline-flex flex-wrap justify-center ${className}`}>
      {words.map(({ word, className: wordClassName }, index) => (
        <span
          key={`${word}-${index}`}
          className="inline-block overflow-hidden pb-[0.08em] pr-[0.22em]"
        >
          <motion.span
            className={`inline-block ${wordClassName}`}
            initial={shouldReduceMotion ? false : { opacity: 0, transform: "translateY(20px)" }}
            animate={isInView ? { opacity: 1, transform: "translateY(0px)" } : undefined}
            transition={{ duration: 0.64, delay: index * 0.08, ease: revealEase }}
          >
            {word}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

function AnimatedLetter({
  character,
  progress,
  index,
  total,
}: {
  character: string;
  progress: MotionValue<number>;
  index: number;
  total: number;
}) {
  const characterProgress = index / total;
  const opacity = useTransform(
    progress,
    [characterProgress - 0.1, characterProgress + 0.05],
    [0.2, 1],
  );

  return (
    <motion.span
      aria-hidden="true"
      className={character === " " ? "inline-block w-[0.27em]" : "inline-block"}
      style={{ opacity }}
    >
      {character}
    </motion.span>
  );
}

function ScrollRevealParagraph({ text }: { text: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start 0.8", "end 0.2"],
  });

  return (
    <p
      ref={ref}
      className="mx-auto mt-8 max-w-2xl text-xs leading-[1.55] text-[#dedbc8] sm:mt-10 sm:text-sm md:text-base"
      aria-label={text}
    >
      {Array.from(text).map((character, index) => (
        <AnimatedLetter
          key={`${character}-${index}`}
          character={character}
          progress={scrollYProgress}
          index={index}
          total={text.length}
        />
      ))}
    </p>
  );
}

function FeatureCard({
  feature,
  index,
}: {
  feature: (typeof features)[number];
  index: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.article
      id={feature.id}
      ref={ref}
      initial={shouldReduceMotion ? false : { opacity: 0, transform: "scale(0.95)" }}
      animate={isInView ? { opacity: 1, transform: "scale(1)" } : undefined}
      transition={{ duration: 0.66, delay: index * 0.15, ease: [0.22, 1, 0.36, 1] }}
      className="flex min-h-[315px] flex-col rounded-2xl bg-[#212121] p-5 sm:min-h-[350px] sm:p-6 lg:min-h-0"
    >
      <span
        aria-hidden="true"
        className="h-10 w-10 rounded-lg bg-cover bg-center sm:h-12 sm:w-12"
        style={{ backgroundImage: `url("${feature.image}")` }}
      />
      <div className="mt-8 flex items-start justify-between gap-4 sm:mt-10">
        <h3 className="max-w-[12ch] text-lg leading-[0.98] tracking-[-0.045em] text-[#e1e0cc] sm:text-xl">
          {feature.title}
        </h3>
        <span className="text-[10px] text-gray-500 sm:text-xs">{feature.number}</span>
      </div>
      <ul className="mt-7 space-y-2.5 text-[11px] leading-[1.35] text-gray-400 sm:mt-8 sm:text-xs">
        {feature.points.map((point) => (
          <li key={point} className="flex gap-2">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" strokeWidth={2} />
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <a
        href="#about"
        className="group mt-auto flex w-fit items-center gap-2 pt-7 text-xs text-primary transition-[gap] duration-200 ease-out focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
      >
        See how it works
        <ArrowRight className="h-4 w-4 -rotate-45 transition-transform duration-200 ease-out group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </a>
    </motion.article>
  );
}

function VideoFeatureCard() {
  const ref = useRef<HTMLElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.article
      ref={ref}
      initial={shouldReduceMotion ? false : { opacity: 0, transform: "scale(0.95)" }}
      animate={isInView ? { opacity: 1, transform: "scale(1)" } : undefined}
      transition={{ duration: 0.66, ease: [0.22, 1, 0.36, 1] }}
      className="relative min-h-[315px] overflow-hidden rounded-2xl bg-[#212121] sm:min-h-[350px] lg:min-h-0"
    >
      <video
        className="absolute inset-0 h-full w-full object-cover"
        autoPlay
        loop
        muted
        playsInline
        preload="metadata"
      >
        <source src={featureVideo} type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />
      <p className="absolute inset-x-5 bottom-5 text-xl leading-none tracking-[-0.045em] text-[#e1e0cc] sm:inset-x-6 sm:bottom-6 sm:text-2xl">
        One conversation, from answer to human.
      </p>
    </motion.article>
  );
}

export function MarshalDeskLanding() {
  const shouldReduceMotion = useReducedMotion();

  return (
    <main className="flex-1 bg-black text-[#e1e0cc]">
      <section className="h-[100svh] min-h-[640px] bg-black p-4 md:p-6">
        <div className="relative h-full overflow-hidden rounded-2xl bg-[#101010] md:rounded-[2rem]">
          <video
            className="absolute inset-0 h-full w-full object-cover"
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
          >
            <source src={heroVideo} type="video/mp4" />
          </video>
          <div className="noise-overlay pointer-events-none absolute inset-0 mix-blend-overlay opacity-70" />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/60" />

          <nav
            aria-label="Primary navigation"
            className="absolute inset-x-0 top-0 z-10 px-4 pt-4 sm:px-6 md:px-8"
          >
            <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 rounded-full bg-black/90 px-3 py-2 backdrop-blur-sm sm:px-4">
              <a
                href="#about"
                className="shrink-0 whitespace-nowrap px-1 text-xs font-medium text-[#e1e0cc] transition-opacity duration-200 ease-out hover:opacity-75 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary sm:text-sm"
              >
                MarshalDesk
              </a>
              <div className="hidden items-center gap-5 lg:flex">
                {[
                  { label: "How it works", href: "#about" },
                  { label: "Knowledge", href: "#knowledge" },
                  { label: "Widget", href: "#widget" },
                  { label: "Inbox", href: "#inbox" },
                ].map((item) => (
                  <a
                    key={item.label}
                    href={item.href}
                    className="whitespace-nowrap text-sm text-[#e1e0cc]/80 transition-colors duration-200 ease-out hover:text-[#e1e0cc] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary"
                  >
                    {item.label}
                  </a>
                ))}
              </div>
              <NavbarAuthActions />
            </div>
          </nav>

          <div className="absolute inset-x-0 bottom-0 z-[1] grid gap-7 px-6 pb-7 sm:px-9 sm:pb-9 md:grid-cols-12 md:items-end md:gap-8 md:px-10 lg:px-14 lg:pb-12">
            <h1 className="md:col-span-8">
              <WordsPullUp
                text="MarshalDesk"
                className="text-[14vw] font-medium leading-[0.85] tracking-[-0.07em] text-[#e1e0cc] sm:text-[14vw] md:text-[14vw] lg:text-[13vw] xl:text-[12vw] 2xl:text-[12vw]"
              />
            </h1>
            <div className="max-w-md md:col-span-4 md:mb-1">
              <motion.p
                initial={shouldReduceMotion ? false : { opacity: 0, transform: "translateY(20px)" }}
                animate={{ opacity: 1, transform: "translateY(0px)" }}
                transition={{ duration: 0.64, delay: 0.5, ease: revealEase }}
                className="text-xs leading-[1.2] text-primary/70 sm:text-sm md:text-base"
              >
                Give visitors answers from your knowledge source. When it cannot help, they can reach a person in the same conversation.
              </motion.p>
              <motion.a
                href="#features"
                initial={shouldReduceMotion ? false : { opacity: 0, transform: "translateY(20px)" }}
                animate={{ opacity: 1, transform: "translateY(0px)" }}
                transition={{ duration: 0.64, delay: 0.7, ease: revealEase }}
                whileTap={shouldReduceMotion ? undefined : { scale: 0.97 }}
                className="group mt-5 inline-flex items-center gap-2 rounded-full bg-primary py-1.5 pl-4 pr-1.5 text-sm font-medium text-black transition-[gap] duration-200 ease-out hover:gap-3 sm:mt-6 sm:text-base"
              >
                See how it works
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black text-[#e1e0cc] transition-transform duration-200 ease-out group-hover:scale-110 sm:h-10 sm:w-10">
                  <ArrowRight className="h-4 w-4" />
                </span>
              </motion.a>
            </div>
          </div>
        </div>
      </section>

      <section id="about" className="bg-black px-4 py-20 sm:px-6 sm:py-28 md:py-36">
        <div className="mx-auto max-w-6xl bg-[#101010] px-6 py-16 text-center sm:px-12 sm:py-20 md:px-16 md:py-28">
          <p className="text-xs text-primary sm:text-sm">Grounded support, human when needed</p>
          <h2 className="mx-auto mt-7 max-w-3xl text-3xl font-normal leading-[0.95] tracking-[-0.055em] text-[#e1e0cc] sm:text-4xl sm:leading-[0.9] md:text-5xl lg:text-6xl xl:text-7xl">
            <WordsPullUpMultiStyle
              segments={[
                { text: "Every visitor starts with a grounded answer." },
                { text: "When they need you,", className: "font-serif italic" },
                { text: "the same thread reaches a person." },
              ]}
            />
          </h2>
          <ScrollRevealParagraph text="Upload a PDF, Word, Markdown, or text file. MarshalDesk answers only from its extracted passages, then gives visitors a clear way to talk to a person without leaving the thread." />
        </div>
      </section>

      <section id="features" className="relative min-h-screen overflow-hidden bg-black px-4 py-20 sm:px-6 sm:py-28 md:py-36">
        <div className="bg-noise pointer-events-none absolute inset-0 opacity-15" />
        <div className="relative mx-auto max-w-7xl">
          <h2 className="max-w-3xl text-xl font-normal leading-[1.05] tracking-[-0.035em] sm:text-2xl md:text-3xl lg:text-4xl">
            <WordsPullUpMultiStyle
              className="justify-start"
              segments={[
                { text: "Everything a visitor needs in one small widget." },
                { text: "Grounded answers when your source has them. A clear handoff when it does not.", className: "text-gray-500" },
              ]}
            />
          </h2>
          <div className="mt-12 grid gap-3 sm:mt-16 sm:gap-2 md:grid-cols-2 md:gap-1 lg:h-[480px] lg:grid-cols-4">
            <VideoFeatureCard />
            {features.map((feature, index) => (
              <FeatureCard key={feature.number} feature={feature} index={index + 1} />
            ))}
          </div>
        </div>
      </section>

      <section id="footer" className="bg-black px-4 pb-12 sm:px-6 sm:pb-16">
        <div className="mx-auto flex max-w-7xl items-center justify-between border-t border-white/10 py-6 text-xs text-gray-500 sm:text-sm">
          <span>MarshalDesk</span>
          <a className="text-primary transition-colors duration-200 ease-out hover:text-[#e1e0cc]" href="#about">
            Grounded answers. Real handoffs.
          </a>
        </div>
      </section>
    </main>
  );
}
