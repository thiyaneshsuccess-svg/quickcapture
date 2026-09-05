import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import {
  createTask,
  deleteAllTasks,
  deleteCompletedTasks,
  listTasks,
  updateTaskCompletion,
} from "./db";

const taskText = z
  .string()
  .trim()
  .min(1, "Capture something before pressing Enter.")
  .max(500, "Keep captures under 500 characters.");

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  tasks: router({
    list: publicProcedure.query(() => listTasks()),
    create: publicProcedure
      .input(z.object({ text: taskText }))
      .mutation(({ input }) => createTask({ text: input.text, completed: false })),
    setCompleted: publicProcedure
      .input(z.object({ id: z.number().int().positive(), completed: z.boolean() }))
      .mutation(({ input }) => updateTaskCompletion(input.id, input.completed)),
    clearCompleted: publicProcedure.mutation(() => deleteCompletedTasks()),
    clearAll: publicProcedure.mutation(() => deleteAllTasks()),
  }),
});

export type AppRouter = typeof appRouter;
