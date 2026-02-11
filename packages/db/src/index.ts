import { PrismaClient } from "@prisma/client";

export type {
  Prisma,
  User,
  Project,
  Agent,
  Run,
  ProviderAccount,
  Group,
  GroupMember,
  GroupMessage,
  Session,
  Message
} from "@prisma/client";

export const prisma = new PrismaClient();
