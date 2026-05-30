import { notFound } from "next/navigation";
import { Truck, RotateCcw, ShieldCheck, CreditCard } from "lucide-react";

import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { Card } from "@/shared/components/ui/card";
import { Input } from "@/shared/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/shared/components/ui/tabs";
import { ColorSwatch } from "@/shared/components/marketing/color-swatch";
import { FeatureIconRow } from "@/shared/components/marketing/feature-icon-row";
import { FooterRegion } from "@/shared/components/marketing/footer-region";
import { HeroBand } from "@/shared/components/marketing/hero-band";
import { PromoBanner } from "@/shared/components/marketing/promo-banner";

/**
 * Live gallery for the Meta-aligned design system documented in /DESIGN.md.
 * Dev-only — surfaces tokens, primitives, and signature components for visual review.
 */
export default function DesignSystemPage() {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main id="main" className="min-h-screen bg-canvas text-ink-deep">
      <PromoBanner action={<a href="#">Learn more</a>}>
        Get 25% off the #1 selling AI agent — limited time only.
      </PromoBanner>

      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-[80px] px-8 py-[64px] md:px-12">
        <Header />
        <ColorSection />
        <TypographySection />
        <RadiusSection />
        <ButtonSection />
        <BadgeSection />
        <CardSection />
        <InputSection />
        <FocusSection />
        <TabsSection />
        <SidebarNavSection />
        <DarkThemeSection />
        <HeroBandSection />
        <FeatureRowSection />
      </div>

      <FooterRegion
        columns={[
          {
            heading: "Product",
            links: [
              { label: "Synapse for teams", href: "#" },
              { label: "Synapse for solo", href: "#" },
              { label: "Channels", href: "#" },
            ],
          },
          {
            heading: "Resources",
            links: [
              { label: "Docs", href: "#" },
              { label: "API reference", href: "#" },
              { label: "Release notes", href: "#" },
            ],
          },
          {
            heading: "Company",
            links: [
              { label: "About", href: "#" },
              { label: "Brand", href: "#" },
              { label: "Careers", href: "#" },
            ],
          },
          {
            heading: "Legal",
            links: [
              { label: "Privacy", href: "#" },
              { label: "Terms", href: "#" },
              { label: "Cookies", href: "#" },
            ],
          },
        ]}
        legal={<>&copy; Synapse 2026 · All rights reserved</>}
      />
    </main>
  );
}

function Header() {
  return (
    <header className="flex flex-col gap-4">
      <span className="text-body-sm-bold uppercase tracking-[0.1em] text-steel">
        DESIGN.md gallery
      </span>
      <h1 className="text-display-lg">A system, on canvas.</h1>
      <p className="text-subtitle-md max-w-[640px] text-charcoal">
        Tokens, primitives, and signature components rebuilt to mirror the Meta-inspired
        DESIGN.md — cobalt for action, black pills for marketing, 32px photographic cards,
        and a 4px spacing rhythm.
      </p>
    </header>
  );
}

function Section({
  title,
  eyebrow,
  children,
}: {
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        {eyebrow ? (
          <span className="text-body-sm-bold uppercase tracking-[0.1em] text-steel">
            {eyebrow}
          </span>
        ) : null}
        <h2 className="text-heading-lg">{title}</h2>
      </div>
      {children}
    </section>
  );
}

/** Color swatch grid keyed off the canonical `--color-*` tokens. */
const COLOR_TOKENS: Array<{ name: string; var: string; onDark?: boolean }> = [
  { name: "cobalt", var: "--color-cobalt", onDark: true },
  { name: "cobalt-deep", var: "--color-cobalt-deep", onDark: true },
  { name: "cobalt-soft", var: "--color-cobalt-soft", onDark: true },
  { name: "ink-button", var: "--color-ink-button", onDark: true },
  { name: "ink-deep", var: "--color-ink-deep", onDark: true },
  { name: "ink", var: "--color-ink", onDark: true },
  { name: "charcoal", var: "--color-charcoal", onDark: true },
  { name: "steel", var: "--color-steel", onDark: true },
  { name: "stone", var: "--color-stone" },
  { name: "hairline", var: "--color-hairline" },
  { name: "hairline-soft", var: "--color-hairline-soft" },
  { name: "surface-soft", var: "--color-surface-soft" },
  { name: "success", var: "--color-success", onDark: true },
  { name: "attention", var: "--color-attention" },
  { name: "warning", var: "--color-warning" },
  { name: "critical", var: "--color-critical", onDark: true },
  { name: "fb-blue", var: "--color-fb-blue", onDark: true },
  { name: "oculus-purple", var: "--color-oculus-purple", onDark: true },
];

function ColorSection() {
  return (
    <Section eyebrow="01 · Tokens" title="Colors">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {COLOR_TOKENS.map((s) => (
          <div key={s.name} className="overflow-hidden rounded-xl border border-hairline-soft">
            <div className="h-20" style={{ background: `var(${s.var})` }} />
            <div className="bg-canvas px-3 py-2">
              <div className="text-body-sm-bold text-ink-deep">{s.name}</div>
              <div className="text-caption-bold text-steel">
                {s.var}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

const TYPE_ROLES = [
  { className: "text-hero-display", label: "hero-display · 64 / 500" },
  { className: "text-display-lg", label: "display-lg · 48 / 500" },
  { className: "text-heading-lg", label: "heading-lg · 36 / 500" },
  { className: "text-heading-md", label: "heading-md · 28 / 300 (editorial light)" },
  { className: "text-heading-sm", label: "heading-sm · 24 / 500" },
  { className: "text-subtitle-lg", label: "subtitle-lg · 18 / 700" },
  { className: "text-subtitle-md", label: "subtitle-md · 18 / 400" },
  { className: "text-body-md", label: "body-md · 16 / 400 · -0.16px" },
  { className: "text-body-sm", label: "body-sm · 14 / 400 · -0.14px" },
  { className: "text-caption-bold", label: "caption-bold · 12 / 700" },
] as const;

function TypographySection() {
  return (
    <Section eyebrow="02 · Tokens" title="Typography">
      <div className="flex flex-col gap-4">
        {TYPE_ROLES.map((r) => (
          <div
            key={r.label}
            className="flex flex-col gap-1 border-b border-hairline-soft pb-4"
          >
            <span className="text-caption-bold text-steel">
              {r.label}
            </span>
            <span className={r.className}>Made for prescriptions. Built for comfort.</span>
          </div>
        ))}
      </div>
    </Section>
  );
}

const RADII = [
  { name: "xs · 2", varName: "--radius-xs" },
  { name: "sm · 4", varName: "--radius-sm" },
  { name: "md · 6", varName: "--radius-md" },
  { name: "lg · 8", varName: "--radius-lg" },
  { name: "xl · 16", varName: "--radius-xl" },
  { name: "xxl · 24", varName: "--radius-xxl" },
  { name: "xxxl · 32", varName: "--radius-xxxl" },
  { name: "feature · 40", varName: "--radius-feature" },
  { name: "full · 100", varName: "--radius-full" },
] as const;

function RadiusSection() {
  return (
    <Section eyebrow="03 · Tokens" title="Radius">
      <div className="grid grid-cols-3 gap-4 md:grid-cols-5 lg:grid-cols-9">
        {RADII.map((r) => (
          <div key={r.name} className="flex flex-col items-center gap-2">
            <div
              className="size-16 bg-cobalt"
              style={{ borderRadius: `var(${r.varName})` }}
            />
            <span className="text-caption-bold text-steel">
              {r.name}
            </span>
          </div>
        ))}
      </div>
    </Section>
  );
}

function ButtonSection() {
  return (
    <Section eyebrow="04 · Primitives" title="Buttons">
      <div className="flex flex-wrap items-center gap-3">
        <Button>Send</Button>
        <Button variant="marketing">Shop now</Button>
        <Button variant="secondary">Learn more</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="destructive">Delete</Button>
        <Button variant="link">Read the docs</Button>
        <Button disabled>Disabled</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg">Continue · lg</Button>
        <Button size="default">Continue · md</Button>
        <Button size="sm">Continue · sm</Button>
        <Button size="xs">Continue · xs</Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="pill-tab" size="tab">
          Glasses
        </Button>
        <Button variant="pill-tab-active" size="tab">
          Agents
        </Button>
        <Button variant="pill-tab" size="tab">
          Channels
        </Button>
      </div>
    </Section>
  );
}

function BadgeSection() {
  return (
    <Section eyebrow="05 · Primitives" title="Badges">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="success">In stock</Badge>
        <Badge variant="promo-yellow">Limited time</Badge>
        <Badge variant="attention">Almost gone</Badge>
        <Badge variant="critical">Out of stock</Badge>
        <Badge variant="outline">New</Badge>
        <Badge variant="secondary">Beta</Badge>
      </div>
    </Section>
  );
}

function CardSection() {
  return (
    <Section eyebrow="06 · Primitives" title="Cards">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card variant="product-feature">
          <h3 className="text-heading-sm">Product feature</h3>
          <p className="text-body-md text-charcoal">
            32px radius, 32px padding, hairline-soft border. The default photographic surface chrome.
          </p>
          <div>
            <Button>Configure</Button>
          </div>
        </Card>
        <Card variant="promo-strip">
          <h3 className="text-heading-md text-canvas">Look forward.</h3>
          <p className="text-subtitle-md max-w-[440px] opacity-90">
            Dark promo strip — ink-deep on canvas, 64px pad, 32px radius. Used sparingly between marketing zones.
          </p>
          <div>
            <Button variant="marketing">Pre-order</Button>
          </div>
        </Card>
        <Card variant="checkout-summary">
          <h3 className="text-subtitle-lg">Checkout summary</h3>
          <p className="text-body-sm text-steel">16px radius, level-2 shadow.</p>
          <Button>Add to cart</Button>
        </Card>
        <Card variant="warranty">
          <h3 className="text-subtitle-lg">1y Warranty</h3>
          <p className="text-body-sm text-charcoal">
            Surface-soft tile, 24px radius. Reserved for warranty + finance offers.
          </p>
        </Card>
      </div>
    </Section>
  );
}

function InputSection() {
  return (
    <Section eyebrow="07 · Primitives" title="Inputs">
      <div className="grid max-w-md grid-cols-1 gap-4">
        <label className="flex flex-col gap-2">
          <span className="text-body-sm-bold">Email</span>
          <Input type="email" placeholder="you@synapse.com" />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-body-sm-bold">Error state</span>
          <Input aria-invalid placeholder="Please enter a valid email" />
          <span className="text-body-sm text-critical-strong">That email looks off.</span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-body-sm-bold">Swatches</span>
        <ColorSwatch color="var(--color-ink-deep)" label="Ink" />
        <ColorSwatch color="var(--color-cobalt)" label="Cobalt" selected />
        <ColorSwatch color="var(--color-attention)" label="Attention" />
        <ColorSwatch color="var(--color-oculus-purple)" label="Oculus" />
      </div>
    </Section>
  );
}

function FocusSection() {
  return (
    <Section eyebrow="08 · Primitives" title="Focus contract">
      <p className="text-body-sm text-steel max-w-[640px]">
        Default interactive focus: 2px ring on fb-blue with 2px canvas offset. Text inputs swap to a 2px solid fb-blue border.
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Button className="focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas">
          Tab to focus
        </Button>
        <Input className="max-w-xs" placeholder="Focus me" aria-label="Focus demo input" />
      </div>
    </Section>
  );
}

function SidebarNavSection() {
  const items = ["New chat", "Library", "Channels", "Skills"];
  return (
    <Section eyebrow="09 · Shell" title="Sidebar pill nav">
      <p className="text-body-sm text-steel max-w-[640px]">
        Dense sidebar rows use the same pill geometry as buttons — rounded-full with sidebar-active/hover tokens.
      </p>
      <nav className="flex w-full max-w-xs flex-col gap-1 rounded-xxl bg-sidebar-bg p-2">
        {items.map((item, index) => (
          <button
            key={item}
            type="button"
            className={
              index === 0
                ? "flex w-full items-center gap-2.5 rounded-full bg-sidebar-active px-3 py-2 text-body-sm-bold text-ink-deep outline-none focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                : "flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-body-sm-bold text-sidebar-foreground-muted outline-none hover:bg-sidebar-hover hover:text-ink-deep focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            }
          >
            {item}
          </button>
        ))}
      </nav>
    </Section>
  );
}

function DarkThemeSection() {
  return (
    <Section eyebrow="10 · Themes" title="Dark mode spot-check">
      <p className="text-body-sm text-steel max-w-[640px]">
        Dark tokens are synthesised (not in DESIGN.md). Validate cobalt and critical contrast before shipping new dark surfaces.
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xxxl border border-hairline-soft bg-canvas p-6">
          <span className="text-body-sm-bold text-ink-deep">Light canvas</span>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm">Cobalt action</Button>
            <Badge variant="critical">Error</Badge>
          </div>
        </div>
        <div className="dark rounded-xxxl border border-hairline-soft bg-canvas p-6">
          <span className="text-body-sm-bold text-ink-deep">Dark canvas (.dark)</span>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm">Cobalt action</Button>
            <Badge variant="critical">Error</Badge>
          </div>
        </div>
      </div>
    </Section>
  );
}

function TabsSection() {
  return (
    <Section eyebrow="11 · Primitives" title="Pill tabs">
      <Tabs defaultValue="agents">
        <TabsList variant="pill">
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="channels">Channels</TabsTrigger>
          <TabsTrigger value="library">Library</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
        </TabsList>
      </Tabs>
    </Section>
  );
}

function HeroBandSection() {
  return (
    <Section eyebrow="12 · Signature" title="Hero band">
      <HeroBand
        eyebrow="New · 2026"
        title="Made for prescriptions. Built for comfort."
        subtitle="Confident hardware merchandising voice, applied to a workspace product. Dual-CTA pair below."
        actions={
          <>
            <Button variant="marketing">Shop now</Button>
            <Button variant="secondary">Learn more</Button>
          </>
        }
      />
    </Section>
  );
}

function FeatureRowSection() {
  return (
    <Section eyebrow="13 · Signature" title="Feature row">
      <FeatureIconRow
        items={[
          {
            icon: <Truck />,
            title: "Free 2-day delivery",
            description: "On orders over $35 — almost everywhere.",
          },
          {
            icon: <RotateCcw />,
            title: "Free 30-day returns",
            description: "If it isn't right, send it back free.",
          },
          {
            icon: <ShieldCheck />,
            title: "Worry-free warranty",
            description: "One year of coverage from us.",
          },
          {
            icon: <CreditCard />,
            title: "Buy now, pay later",
            description: "Split eligible orders into 4 payments.",
          },
        ]}
      />
    </Section>
  );
}
