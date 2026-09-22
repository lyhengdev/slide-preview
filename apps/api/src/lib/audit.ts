import type { FastifyRequest } from "fastify";
import { prisma } from "@ke/database";

interface AuditEntry {
  adminId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  request?: FastifyRequest;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  await prisma.auditLog.create({
    data: {
      adminId: entry.adminId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      metadata: (entry.metadata as object) ?? undefined,
      ip: entry.request?.ip ?? null,
      userAgent: entry.request?.headers["user-agent"] ?? null,
    },
  });
}