import { PrismaClient } from "@prisma/client";

export type { Prisma, User, Project, Agent, Run, ProviderAccount } from "@prisma/client";

export const prisma = new PrismaClient();

