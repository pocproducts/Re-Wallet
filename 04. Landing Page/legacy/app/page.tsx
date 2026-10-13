import { Navbar } from "@/components/navbar"
import { HeroSection } from "@/components/hero-section"
import { FeatureGrid } from "@/components/feature-grid"
import { ShowcaseSection } from "@/components/showcase-section"
import { PricingSection, RoadmapSection } from "@/components/pricing-section"
import { AboutSection } from "@/components/about-section"
import { Footer } from "@/components/footer"

/* Order is the pitch: the product first, the stack and the plan last.
   The showcase sits right after the feature grid: the reader has just been
   told what the product does, and now sees the one screen that is real. It is
   below the hero, so the "Try now" CTA stays in the first block of the scroll.
   The hero CTA stays in the first block, so it is never pushed down. */
export default function Page() {
  return (
    <div className="min-h-screen dot-grid-bg">
      <Navbar />
      <main>
        <HeroSection />
        <FeatureGrid />
        <ShowcaseSection />
        <PricingSection />
        <AboutSection />
        <RoadmapSection />
      </main>
      <Footer />
    </div>
  )
}
