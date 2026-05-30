import localFont from "next/font/local";
import { Montserrat } from "next/font/google";

/* DESIGN.md system font: Optimistic VF (proprietary, not licensable).
   Montserrat is the first declared fallback and the closest humanist-geometric match. */
export const montserrat = Montserrat({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-montserrat",
  display: "swap",
});

export const geistMono = localFont({
  src: "./font-assets/geist-mono-variable.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

export const notoSansSC = localFont({
  src: "./font-assets/noto-sans-sc-variable.otf",
  variable: "--font-noto-sans-sc",
  weight: "100 900",
  display: "swap",
});

export const notoSansTC = localFont({
  src: "./font-assets/noto-sans-tc-variable.otf",
  variable: "--font-noto-sans-tc",
  weight: "100 900",
  display: "swap",
});
