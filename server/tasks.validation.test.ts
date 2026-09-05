import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

function createContext(): TrpcContext {
  return {
    user: undefined,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

describe("tasks input validation", () => {
  it("rejects empty and whitespace-only captures before touching the database", async () => {
    const caller = appRouter.createCaller(createContext());

    await expect(caller.tasks.create({ text: "   " })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.tasks.create({ text: "" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects captures longer than the server limit", async () => {
    const caller = appRouter.createCaller(createContext());
    const longText = "a".repeat(501);

    await expect(caller.tasks.create({ text: longText })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects invalid completion identifiers", async () => {
    const caller = appRouter.createCaller(createContext());

    await expect(caller.tasks.setCompleted({ id: 0, completed: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller.tasks.setCompleted({ id: 1.5, completed: true })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
