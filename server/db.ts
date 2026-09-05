import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, tasks, Task, InsertTask, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = { openId: user.openId };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) values.lastSignedIn = new Date();
    if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

    await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

export async function listTasks(): Promise<Task[]> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  return db.select().from(tasks).orderBy(desc(tasks.createdAt));
}

export async function createTask(input: InsertTask): Promise<Task> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");

  const result = await db.insert(tasks).values(input);
  const created = await db.select().from(tasks).where(eq(tasks.id, result[0].insertId)).limit(1);
  if (!created[0]) throw new Error("Task could not be created");
  return created[0];
}

export async function updateTaskCompletion(id: number, completed: boolean): Promise<Task> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");

  await db.update(tasks).set({ completed, updatedAt: new Date() }).where(eq(tasks.id, id));
  const updated = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!updated[0]) throw new Error("Task could not be updated");
  return updated[0];
}

export async function deleteCompletedTasks(): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.delete(tasks).where(eq(tasks.completed, true));
  return result[0].affectedRows ?? 0;
}

export async function deleteAllTasks(): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database is not available");
  const result = await db.delete(tasks);
  return result[0].affectedRows ?? 0;
}
