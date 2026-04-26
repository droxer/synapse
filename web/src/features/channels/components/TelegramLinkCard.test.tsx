import { describe, expect, it, jest } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";

jest.mock("@/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

jest.mock("../api/channel-api", () => ({
  createLinkToken: jest.fn(),
  deleteTelegramBotConfig: jest.fn(),
  getChannelStatus: jest.fn(),
  listChannelAccounts: jest.fn(),
  saveTelegramBotConfig: jest.fn(),
  unlinkChannelAccount: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TelegramLinkCard } = require("./TelegramLinkCard");

describe("TelegramLinkCard modal-only rendering", () => {
  it("renders nothing while hidden and closed, including the loading skeleton", () => {
    const html = renderToStaticMarkup(
      <TelegramLinkCard hideCard open={false} onOpenChange={() => undefined} />,
    );

    expect(html).toBe("");
    expect(html).not.toContain("skeleton-shimmer");
  });
});
