import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { API_BASE } from "@/shared/constants";
import { fetchEvents } from "./history-api";

describe("fetchEvents", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("requests the latest max-size event page", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValue({
        ok: true,
        json: async () => ({ events: [] }),
      } as Response);

    await fetchEvents("conv-1");

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/conversations/conv-1/events/history?limit=2000&latest=true`,
    );
  });
});
