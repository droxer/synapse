import { describe, expect, it, jest } from "@jest/globals";
import { submitChannelMessage } from "./channel-chat-submit";

describe("submitChannelMessage", () => {
  it("uses the normal follow-up endpoint when there is no pending prompt", async () => {
    const sendFollowUp = jest.fn(async (_message: string) => undefined);
    const respondToPrompt = jest.fn(async (_response: string) => undefined);

    const result = await submitChannelMessage({
      message: "hello",
      pendingAsk: null,
      sendFollowUp,
      respondToPrompt,
    });

    expect(result).toBe("follow_up");
    expect(sendFollowUp).toHaveBeenCalledWith("hello");
    expect(respondToPrompt).not.toHaveBeenCalled();
  });

  it("uses the respond endpoint when the channel turn is waiting for ask_user input", async () => {
    const sendFollowUp = jest.fn(async (_message: string) => undefined);
    const respondToPrompt = jest.fn(async (_response: string) => undefined);

    const result = await submitChannelMessage({
      message: "my answer",
      pendingAsk: { requestId: "req_1", question: "Need your answer" },
      sendFollowUp,
      respondToPrompt,
    });

    expect(result).toBe("prompt_response");
    expect(respondToPrompt).toHaveBeenCalledWith("my answer");
    expect(sendFollowUp).not.toHaveBeenCalled();
  });
});
