import { FeatureSection } from "@/components/feature-section";
import { Header } from "@/components/header";
import { HeroSection } from "@/components/hero";
import { HomeFaq } from "@/components/home/faq";
import { HomeQuote } from "@/components/home/quote";
import { SiteFooter } from "@/components/home/site-footer";

export function PublicHome() {
  return (
    <div className="relative flex flex-1 flex-col bg-background">
      <Header />
      <main>
        <HeroSection />
        <FeatureSection />
        <HomeQuote />
        <HomeFaq />
      </main>
      <SiteFooter />
    </div>
  );
}
