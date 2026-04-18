import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ChannelsListening } from "./ChannelsListening";

jest.mock("framer-motion", () => ({
  __esModule: true,
  motion: {
    div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) =>
      createElement("div", props, children),
  },
}));

jest.mock("@/i18n", () => ({
  __esModule: true,
  useTranslation: () => ({
    t: (key: string) => {
      const messages: Record<string, string> = {
        "channels.listening.activeTitle": "Bot is active",
        "channels.listening.activeDescription":
          "Send any message to your Telegram bot to start a conversation.",
        "channels.listening.openTelegram": "Open Telegram",
        "channels.listening.openTelegramHintPrefix":
          "Search for your bot and send",
      };
      return messages[key] ?? key;
    },
  }),
}));

describe("ChannelsListening", () => {
  it("shows the linked-user CTA as any message instead of /start", () => {
    const html = renderToStaticMarkup(createElement(ChannelsListening));

    expect(html).toContain("hello");
    expect(html).not.toContain("/start");
  });
});
