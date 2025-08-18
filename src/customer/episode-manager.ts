// episode-manager.ts (or inside CustomerService)
import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class EpisodeManager {
  constructor(private readonly prisma: PrismaService) {}

  /** Ensure a current CaseInstance exists for this Case (create if missing). */
  async getOrCreateCurrentInstance(caseId: number, meta?: Record<string, any>) {
    const c = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: {
        id: true,
        currentInstanceId: true,
        instances: { select: { id: true, sequence: true }, orderBy: { sequence: 'desc' }, take: 1 }
      }
    });

    // Already has current
    if (c?.currentInstanceId) {
      return this.prisma.caseInstance.findUnique({ where: { id: c.currentInstanceId } });
    }

    const nextSeq = (c?.instances?.[0]?.sequence ?? 0) + 1;

    // create new instance and point Case.currentInstanceId to it
    const inst = await this.prisma.caseInstance.create({
      data: {
        caseId,
        sequence: nextSeq,
        status: 'INITIATED',
        startedAt: new Date(),
        meta: meta ?? {},
      },
    });

    await this.prisma.case.update({
      where: { id: caseId },
      data: { currentInstanceId: inst.id, firstOpenedAt: { set: (await this._maybeFirstOpenedAt(caseId)) ?? new Date() } },
    });

    return inst;
  }

  private async _maybeFirstOpenedAt(caseId: number) {
    const c = await this.prisma.case.findUnique({ where: { id: caseId }, select: { firstOpenedAt: true } });
    return c?.firstOpenedAt ?? null;
  }

  /** Close the current instance (SOLVED/UNSOLVED), compute duration, clear pointer. */
  async closeCurrentInstance(caseId: number, newStatus: 'SOLVED' | 'UNSOLVED') {
    const c = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { currentInstanceId: true }
    });

    if (!c?.currentInstanceId) return null;

    const now = new Date();
    const inst = await this.prisma.caseInstance.update({
      where: { id: c.currentInstanceId },
      data: {
        status: newStatus,
        endedAt: now,
        durationMins: {
          set: this._minutesSince((await this.prisma.caseInstance.findUnique({
            where: { id: c.currentInstanceId },
            select: { startedAt: true }
          }))!.startedAt, now)
        }
      }
    });

    await this.prisma.case.update({
      where: { id: caseId },
      data: {
        currentInstanceId: null,
        lastClosedAt: now
      }
    });

    return inst;
  }

  /** Start a fresh instance (used on reopen/auto-reopen). */
  async openNewInstance(caseId: number, meta?: Record<string, any>) {
    // In case something was left open, close it softly first
    const cur = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { currentInstanceId: true }
    });
    if (cur?.currentInstanceId) {
      await this.closeCurrentInstance(caseId, 'UNSOLVED');
    }
    return this.getOrCreateCurrentInstance(caseId, meta);
  }

  private _minutesSince(a: Date, b: Date) {
    return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
  }
}
