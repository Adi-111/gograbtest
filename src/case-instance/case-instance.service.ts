import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, SenderType, Status, CaseHandler } from '@prisma/client';
import { ChatService } from 'src/chat/chat.service';
import { CustomerService } from 'src/customer/customer.service';
import { PrismaService } from 'src/prisma/prisma.service';

type DateRange = { start?: Date; end?: Date };
export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

@Injectable()
export class CaseInstanceService {
    private readonly logger = new Logger(CaseInstanceService.name);
    constructor(private readonly prisma: PrismaService,
        private readonly customerServiceL: CustomerService
    ) { }

    /** Utils */
    private whereByRange(table: 'Message' | 'Case' | 'CustomerOrderDetails' | 'StatusEvent', range?: DateRange, field?: string) {
        const ts =
            field ??
            (table === 'Message' ? 'timestamp'
                : table === 'Case' ? 'createdAt'
                    : table === 'CustomerOrderDetails' ? 'orderTime'
                        : /*StatusEvent*/ 'timestamp');

        const where: Record<string, any> = {};
        if (range?.start) where[ts] = { ...(where[ts] ?? {}), gte: range.start };
        if (range?.end) where[ts] = { ...(where[ts] ?? {}), lte: range.end };
        return where;
    }

    /** ============= 1) Total Chats per Agent (per day / range) =============
     * "Total chats handled per agent in a day"
     * Distinct caseIds with at least ONE USER message by agent within the range.
     */
    async totalChatsPerAgent(range?: DateRange) {
        const rows = await this.prisma.$queryRaw<
            { userId: number | null; totalChats: bigint }[]
        >(Prisma.sql`
      SELECT m."userId", COUNT(DISTINCT m."caseId") AS "totalChats"
      FROM "Message" m
      WHERE m."senderType" = 'USER'
        ${range?.start ? Prisma.sql`AND m."timestamp" >= ${range.start}` : Prisma.empty}
        ${range?.end ? Prisma.sql`AND m."timestamp" <= ${range.end}` : Prisma.empty}
      GROUP BY m."userId"
    `);

        const userIds = rows.map(r => r.userId).filter((x): x is number => x !== null);
        const users = userIds.length
            ? await this.prisma.user.findMany({
                where: { id: { in: userIds } },
                select: { id: true, firstName: true, lastName: true, email: true }
            })
            : [];
        const map = new Map(users.map(u => [u.id, u]));

        return rows.map(r => {
            const u = r.userId ? map.get(r.userId) : undefined;
            return {
                userId: r.userId,
                agentName: u ? `${u.firstName} ${u.lastName}` : 'Unassigned',
                email: u?.email ?? null,
                totalChats: Number(r.totalChats),
            };
        });
    }

    /** ============= 2) Chat Volume per Machine =============
     * "Total chats tagged to each machine"
     * Distinct caseIds for which ANY case instance has machine_id = X and
     * the case had activity in range (any message in range).
     */
    async chatVolumePerMachine(range?: DateRange) {
        const rows = await this.prisma.$queryRaw<
            { machine_id: string; totalChats: number }[]
        >(Prisma.sql`
      WITH active_cases AS (
        SELECT DISTINCT m."caseId"
        FROM "Message" m
        WHERE 1=1
          ${range?.start ? Prisma.sql`AND m."timestamp" >= ${range.start}` : Prisma.empty}
          ${range?.end ? Prisma.sql`AND m."timestamp" <= ${range.end}` : Prisma.empty}
      )
      SELECT
        COALESCE(ci."machine_id", 'unknown') AS machine_id,
        COUNT(DISTINCT ci."caseId")::int      AS "totalChats"
      FROM "CaseInstance" ci
      JOIN active_cases ac ON ac."caseId" = ci."caseId"
      GROUP BY machine_id
      ORDER BY "totalChats" DESC
    `);
        return rows;
    }

    /** ============= 3) First Contact Resolution (FCR) =============
     * "% of chats resolved without agent's interaction"
     * Denominator: cases SOLVED in range (by StatusEvent->SOLVED timestamp).
     * Numerator: those solved cases where there are ZERO USER messages.
     */
    async firstContactResolution(range?: DateRange) {
        const solved = await this.prisma.statusEvent.findMany({
            where: { newStatus: Status.SOLVED, ...this.whereByRange('StatusEvent', range) },
            select: { caseId: true },
            distinct: ['caseId'],
        });
        const totalSolved = solved.length;
        if (!totalSolved) return { count: 0, totalSolved: 0, rate: 0 };

        const ids = solved.map(s => s.caseId);

        const withoutAgent = await this.prisma.$queryRaw<
            { caseId: number }[]
        >(Prisma.sql`
      SELECT c."id" as "caseId"
      FROM "Case" c
      WHERE c."id" = ANY(${ids})
        AND NOT EXISTS (
          SELECT 1 FROM "Message" m
          WHERE m."caseId" = c."id" AND m."senderType" = 'USER'
        )
    `);

        const count = withoutAgent.length;
        return { count, totalSolved, rate: count / totalSolved };
    }

    /** ============= 4) Chat-to-Transaction Ratio (per machine) =============
     * "Total chats / Total transactions per machine – show top 10 by ratio desc"
     * Chats per machine: distinct caseIds (activity in range) with caseInstance.machine_id
     * Transactions per machine: CustomerOrderDetails grouped by machine_id (if you store it),
     * otherwise by joining your vend details table; here we assume `machine_id` exists on CustomerOrderDetails.
     */
    async chatToTransactionRatioTop(range?: DateRange, top = 10) {
        // Chats per machine
        const chats = await this.prisma.$queryRaw<
            { machine_id: string; chats: number }[]
        >(Prisma.sql`
      WITH active_cases AS (
        SELECT DISTINCT m."caseId"
        FROM "Message" m
        WHERE 1=1
          ${range?.start ? Prisma.sql`AND m."timestamp" >= ${range.start}` : Prisma.empty}
          ${range?.end ? Prisma.sql`AND m."timestamp" <= ${range.end}` : Prisma.empty}
      )
      SELECT COALESCE(ci."machine_id", 'unknown') as machine_id,
             COUNT(DISTINCT ci."caseId")::int     as chats
      FROM "CaseInstance" ci
      JOIN active_cases ac ON ac."caseId" = ci."caseId"
      GROUP BY machine_id
    `);

        // Transactions per machine (assumes machine_id exists on CustomerOrderDetails)
        const tx = await this.prisma.$queryRaw<
            { machine_id: string | null; txns: number }[]
        >(Prisma.sql`
      SELECT COALESCE(cod."machine_id",'unknown') as machine_id,
             COUNT(*)::int                        as txns
      FROM "CustomerOrderDetails" cod
      WHERE 1=1
        ${range?.start ? Prisma.sql`AND cod."orderTime" >= ${range.start}` : Prisma.empty}
        ${range?.end ? Prisma.sql`AND cod."orderTime" <= ${range.end}` : Prisma.empty}
      GROUP BY machine_id
    `);

        const txMap = new Map(tx.map(r => [r.machine_id ?? 'unknown', r.txns]));
        const rows = chats.map(c => {
            const t = txMap.get(c.machine_id) ?? 0;
            return {
                machine_id: c.machine_id,
                chats: c.chats,
                transactions: t,
                ratio: t > 0 ? c.chats / t : null,
            };
        });

        rows.sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1));
        return rows.slice(0, top);
    }

    /** ============= 5) First Response Time (FRT) =============
     * "Avg. time from bot's last message to agent's first message"
     * For each case:
     *  - find the FIRST USER message timestamp (agent first reply)
     *  - find the LAST BOT message timestamp *before* that time
     * diff = agentFirstTs - lastBotBeforeTs
     * Return avg/p50/p90 (minutes).
     */
    async firstResponseTime(range?: DateRange) {
        const rows = await this.prisma.$queryRaw<
            { diff_minutes: number }[]
        >(Prisma.sql`
      WITH first_agent AS (
        SELECT m."caseId", MIN(m."timestamp") AS first_agent_ts
        FROM "Message" m
        WHERE m."senderType" = 'USER'
          ${range?.start ? Prisma.sql`AND m."timestamp" >= ${range.start}` : Prisma.empty}
          ${range?.end ? Prisma.sql`AND m."timestamp" <= ${range.end}` : Prisma.empty}
        GROUP BY m."caseId"
      ),
      last_bot_before AS (
        SELECT
          fa."caseId",
          MAX(m2."timestamp") AS last_bot_ts
        FROM first_agent fa
        JOIN "Message" m2
          ON m2."caseId" = fa."caseId"
         AND m2."senderType" = 'BOT'
         AND m2."timestamp" < fa.first_agent_ts
        GROUP BY fa."caseId"
      )
      SELECT EXTRACT(EPOCH FROM (fa.first_agent_ts - lb.last_bot_ts))/60.0 AS diff_minutes
      FROM first_agent fa
      JOIN last_bot_before lb ON lb."caseId" = fa."caseId"
      WHERE fa.first_agent_ts > lb.last_bot_ts
    `);

        if (!rows.length) return { avg: null, p50: null, p90: null, samples: 0 };

        const diffs = rows.map(r => r.diff_minutes).sort((a, b) => a - b);
        const avg = diffs.reduce((a, b) => a + b, 0) / diffs.length;
        const p = (q: number) => diffs[Math.floor((q / 100) * (diffs.length - 1))];
        return { avg, p50: p(50), p90: p(90), samples: diffs.length };
    }

    /** ============= 6) % Chats > 4h Unresolved =============
     * "% of chats open for 4+ hours (both solved and unsolved)"
     * For each case active in the range:
     *  - start = first CUSTOMER message (ever or within range)
     *  - end   = SOLVED timestamp if solved else now
     * If (end - start) > 4h → counts as ">4h open"
     * Percentage over all such cases.
     */
    async pctChatsOver4h(range?: DateRange, now = new Date()) {
        // consider cases that had any message in range
        const activeCases = await this.prisma.$queryRaw<{ caseId: number }[]>(Prisma.sql`
      SELECT DISTINCT m."caseId" FROM "Message" m
      WHERE 1=1
        ${range?.start ? Prisma.sql`AND m."timestamp" >= ${range.start}` : Prisma.empty}
        ${range?.end ? Prisma.sql`AND m."timestamp" <= ${range.end}` : Prisma.empty}
    `);
        const ids = activeCases.map(r => r.caseId);
        if (!ids.length) return { total: 0, over4h: 0, pct: 0 };

        // first customer ts
        const firstCust = await this.prisma.$queryRaw<{ caseId: number; ts: Date }[]>(Prisma.sql`
      SELECT m."caseId", MIN(m."timestamp") AS ts
      FROM "Message" m
      WHERE m."caseId" = ANY(${ids}) AND m."senderType" = 'CUSTOMER'
      GROUP BY m."caseId"
    `);
        const firstMap = new Map(firstCust.map(r => [r.caseId, new Date(r.ts)]));

        // solved ts (if any)
        const solvedEvents = await this.prisma.$queryRaw<{ caseId: number; ts: Date }[]>(Prisma.sql`
      SELECT se."caseId", MIN(se."timestamp") AS ts
      FROM "StatusEvent" se
      WHERE se."caseId" = ANY(${ids}) AND se."newStatus" = 'SOLVED'
      GROUP BY se."caseId"
    `);
        const solvedMap = new Map(solvedEvents.map(r => [r.caseId, new Date(r.ts)]));

        const fourHours = 4 * 60 * 60 * 1000;
        let total = 0, over4h = 0;

        for (const id of ids) {
            const start = firstMap.get(id);
            if (!start) continue;
            const end = solvedMap.get(id) ?? now;
            total++;
            if (end.getTime() - start.getTime() > fourHours) over4h++;
        }

        return { total, over4h, pct: total ? over4h / total : 0 };
    }

    /** ============= 7) Chat Abandonment Rate =============
     * "% of chats where the user dropped off without closure"
     * We define "dropped off":
     *  - Case not SOLVED
     *  - No USER (agent) reply ever
     *  - Last CUSTOMER message > 24h ago
     * Denominator: cases opened in range (by createdAt).
     */
    async chatAbandonmentRate(range?: DateRange, now = new Date()) {
        const opened = await this.prisma.case.findMany({
            where: this.whereByRange('Case', range, 'createdAt'),
            select: { id: true },
        });
        const totalOpened = opened.length;
        if (!totalOpened) return { abandoned: 0, totalOpened: 0, rate: 0 };

        const ids = opened.map(c => c.id);

        // Exclude cases that were SOLVED
        const solved = await this.prisma.statusEvent.findMany({
            where: { caseId: { in: ids }, newStatus: Status.SOLVED },
            select: { caseId: true },
            distinct: ['caseId'],
        });
        const solvedSet = new Set(solved.map(s => s.caseId));

        // Cases with any USER reply
        const withAgent = await this.prisma.message.findMany({
            where: { caseId: { in: ids }, senderType: SenderType.USER },
            select: { caseId: true },
            distinct: ['caseId'],
        });
        const withAgentSet = new Set(withAgent.map(x => x.caseId));

        // Last CUSTOMER message ts
        const lastCust = await this.prisma.$queryRaw<{ caseId: number; ts: Date }[]>(Prisma.sql`
      SELECT m."caseId", MAX(m."timestamp") AS ts
      FROM "Message" m
      WHERE m."caseId" = ANY(${ids}) AND m."senderType" = 'CUSTOMER'
      GROUP BY m."caseId"
    `);
        const lastMap = new Map(lastCust.map(r => [r.caseId, new Date(r.ts)]));

        const threshold = 24 * 60 * 60 * 1000;
        let abandoned = 0;
        for (const id of ids) {
            if (solvedSet.has(id)) continue;
            if (withAgentSet.has(id)) continue;
            const last = lastMap.get(id);
            if (!last) continue;
            if (now.getTime() - last.getTime() > threshold) abandoned++;
        }

        return { abandoned, totalOpened, rate: abandoned / totalOpened };
    }

    /** ============= 8) Refunds Processed (Manual) =============
     * "# of refunds processed manually per agent"
     * Heuristic:
     *  - SOLVED events in range by a USER (agent)
     *  - Case tagged with 'refund' OR any note contains 'refund'
     * Grouped by agent (StatusEvent.userId).
     */
    async refundsProcessedManual(range?: DateRange) {
        const solved = await this.prisma.statusEvent.findMany({
            where: { newStatus: Status.SOLVED, ...this.whereByRange('StatusEvent', range) },
            select: { caseId: true, userId: true },
        });
        if (!solved.length) return [];

        const caseIds = Array.from(new Set(solved.map(s => s.caseId)));
        const refundTagged = await this.prisma.case.findMany({
            where: { id: { in: caseIds }, tags: { some: { text: { contains: 'refund', mode: 'insensitive' } } } },
            select: { id: true },
        });
        const refundNoted = await this.prisma.note.findMany({
            where: { caseId: { in: caseIds }, text: { contains: 'refund', mode: 'insensitive' } },
            select: { caseId: true },
            distinct: ['caseId'],
        });
        const refundSet = new Set<number>([
            ...refundTagged.map(c => c.id),
            ...refundNoted.map(n => n.caseId),
        ]);

        // count by agent
        const byAgent = new Map<number, number>();
        for (const s of solved) {
            if (!s.userId) continue;
            if (!refundSet.has(s.caseId)) continue;
            byAgent.set(s.userId, (byAgent.get(s.userId) ?? 0) + 1);
        }

        if (byAgent.size === 0) return [];

        const users = await this.prisma.user.findMany({
            where: { id: { in: Array.from(byAgent.keys()) } },
            select: { id: true, firstName: true, lastName: true, email: true },
        });
        const map = new Map(users.map(u => [u.id, u]));

        return Array.from(byAgent.entries()).map(([userId, count]) => {
            const u = map.get(userId);
            return {
                userId,
                agentName: u ? `${u.firstName} ${u.lastName}` : `User#${userId}`,
                email: u?.email ?? null,
                refundsProcessed: count,
            };
        });
    }


    /** -------- CASE LIST + SEARCH (for table view) -------- */
    async listCases(params: {
        query?: string;
        status?: Status;
        machine_id?: string;
        page?: number;
        pageSize?: number;
    }): Promise<Page<any>> {
        const { query, status, machine_id, page = 1, pageSize = 20 } = params;

        // Filter by machine_id via CaseInstance (any instance on that case tagged to machine)
        const caseIdsByMachine = machine_id
            ? await this.prisma.caseInstance.findMany({
                where: { machine_id },
                select: { caseId: true },
                distinct: ['caseId'],
            }).then(r => r.map(x => x.caseId))
            : undefined;

        const where: Prisma.CaseWhereInput = {
            ...(status ? { status } : {}),
            ...(query
                ? {
                    OR: [
                        { id: Number.isNaN(Number(query)) ? -1 : Number(query) },
                        { customer: { name: { contains: query, mode: 'insensitive' } } },
                        { customer: { phoneNo: { contains: query, mode: 'insensitive' } } },
                        { notes: { some: { text: { contains: query, mode: 'insensitive' } } } },
                        { tags: { some: { text: { contains: query, mode: 'insensitive' } } } },
                    ],
                }
                : {}),
            ...(caseIdsByMachine ? { id: { in: caseIdsByMachine } } : {}),
        };

        const [total, items] = await this.prisma.$transaction([
            this.prisma.case.count({ where }),
            this.prisma.case.findMany({
                where,
                orderBy: [{ updatedAt: 'desc' }],
                skip: (page - 1) * pageSize,
                take: pageSize,
                include: {
                    customer: true,
                    tags: true,
                    instances: {
                        orderBy: { sequence: 'desc' },
                        take: 1,
                        select: { id: true, sequence: true, status: true, machine_id: true, startedAt: true, endedAt: true },
                    },
                },
            }),
        ]);

        return { items, total, page, pageSize };
    }

    /** -------- CASE DETAIL (header + current episode + last messages) -------- */
    async getCaseDetail(caseId: number) {
        const c = await this.prisma.case.findUnique({
            where: { id: caseId },
            include: {
                customer: true,
                tags: true,
                notes: { orderBy: { createdAt: 'desc' }, take: 50, include: { user: true } },
                instances: {
                    orderBy: { sequence: 'desc' },
                    include: { messages: { orderBy: { timestamp: 'desc' }, take: 1 } },
                },
            },
        });
        if (!c) throw new NotFoundException('Case not found');

        const currentInstance = await this.prisma.case.findUnique({
            where: { id: caseId },
            select: { currentInstanceId: true },
        });

        // last 100 messages for view (paginate if needed)
        const messages = await this.prisma.message.findMany({
            where: { caseId },
            orderBy: { timestamp: 'desc' },
            take: 100,
            include: { media: true, user: true, bot: true },
        });

        return { case: c, currentInstanceId: currentInstance?.currentInstanceId ?? null, messages };
    }



    /** -------- UPDATE CASE: status/assignee/timer -------- */
    async updateCase(caseId: number, dto: { status?: Status; assignedTo?: CaseHandler; timer?: Date }) {
        if (dto.status) {
            await this.customerServiceL.setCaseStatus(caseId, dto.status, /*actorUserId*/ 5, dto.assignedTo);
        } else if (dto.assignedTo) {
            await this.prisma.case.update({ where: { id: caseId }, data: { assignedTo: dto.assignedTo } });
        }
        if (dto.timer) {
            await this.prisma.case.update({ where: { id: caseId }, data: { timer: dto.timer } });
        }
        return this.getCaseDetail(caseId);
    }

    /** -------- NOTES: add / delete / edit -------- */
    async addNote(caseId: number, userId: number, text: string) {
        const cur = await this.prisma.case.findUnique({ where: { id: caseId }, select: { currentInstanceId: true } });
        await this.prisma.note.create({
            data: {
                caseId,
                userId,
                text,
                caseInstanceId: cur?.currentInstanceId ?? null,
            },
        });
        return this.getCaseDetail(caseId);
    }

    async updateNote(noteId: number, userId: number, text: string) {
        const n = await this.prisma.note.findUnique({ where: { id: noteId } });
        if (!n) throw new NotFoundException('Note not found');
        await this.prisma.note.update({ where: { id: noteId }, data: { text, updatedAt: new Date(), userId } });
        return { ok: true };
    }

    async deleteNote(noteId: number) {
        await this.prisma.note.delete({ where: { id: noteId } });
        return { ok: true };
    }

    /** -------- TAGS: attach / detach to a case -------- */
    async addTag(caseId: number, userId: number, text: string) {
        // Upsert Tag
        const tag = await this.prisma.tag.upsert({
            where: { text },
            update: {},
            create: { text, userId },
        });

        await this.prisma.case.update({
            where: { id: caseId },
            data: { tags: { connect: { id: tag.id } } },
        });

        return this.getCaseDetail(caseId);
    }

    async removeTag(caseId: number, tagId: number) {
        await this.prisma.case.update({
            where: { id: caseId },
            data: { tags: { disconnect: { id: tagId } } },
        });
        return this.getCaseDetail(caseId);
    }

    /** -------- EPISODE: set machine_id on a CaseInstance -------- */
    async updateInstance(instanceId: number, dto: { machine_id?: string; status?: Status }) {
        if (dto.machine_id !== undefined) {
            await this.prisma.caseInstance.update({ where: { id: instanceId }, data: { machine_id: dto.machine_id } });
        }
        if (dto.status) {
            const inst = await this.prisma.caseInstance.findUnique({ where: { id: instanceId }, select: { caseId: true } });
            if (!inst) throw new NotFoundException('Instance not found');
            await this.customerServiceL.setCaseStatus(inst.caseId, dto.status, 5);
        }
        return this.prisma.caseInstance.findUnique({ where: { id: instanceId } });
    }

    /** -------- MESSAGES: list (paged) for a case or instance -------- */
    async listMessages(params: { caseId?: number; caseInstanceId?: number; page?: number; pageSize?: number }) {
        const { caseId, caseInstanceId, page = 1, pageSize = 50 } = params;
        const where: Prisma.MessageWhereInput = {
            ...(caseId ? { caseId } : {}),
            ...(caseInstanceId ? { caseInstanceId } : {}),
        };
        const [total, items] = await this.prisma.$transaction([
            this.prisma.message.count({ where }),
            this.prisma.message.findMany({
                where,
                orderBy: { timestamp: 'desc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
                include: { media: true, user: true, bot: true },
            }),
        ]);
        return { items, total, page, pageSize };
    }

    /** -------- BOT CONTENT: BotReplies CRUD -------- */
    async listBotReplies() {
        return this.prisma.botReplies.findMany({ orderBy: { updatedAt: 'desc' } });
    }
    async createBotReply(dto: {
        nodeId: string; flowNodeType: string; header?: any; body?: any; footer?: any; action?: any; replies?: any; botId?: string;
    }) {
        return this.prisma.botReplies.create({ data: dto as any });
    }
    async updateBotReply(nodeId: string, dto: Partial<{
        flowNodeType: string; header: any; body: any; footer: any; action: any; replies: any; botId: string;
    }>) {
        return this.prisma.botReplies.update({ where: { nodeId }, data: { ...dto, updatedAt: new Date() } as any });
    }
    async deleteBotReply(nodeId: string) {
        await this.prisma.botReplies.delete({ where: { nodeId } });
        return { ok: true };
    }

    /** -------- QUICK REPLIES CRUD -------- */
    async listQuickReplies() {
        return this.prisma.quickReplies.findMany({ orderBy: { updatedAt: 'desc' } });
    }
    async createQuickReply(dto: {
        flowNodeType: string; header?: any; body?: any; footer?: any; action?: any; replies?: any;
    }) {
        return this.prisma.quickReplies.create({ data: dto as any });
    }
    async updateQuickReply(id: number, dto: Partial<{
        flowNodeType: string; header: any; body: any; footer: any; action: any; replies: any;
    }>) {
        return this.prisma.quickReplies.update({ where: { id }, data: { ...dto, updatedAt: new Date() } as any });
    }
    async deleteQuickReply(id: number) {
        await this.prisma.quickReplies.delete({ where: { id } });
        return { ok: true };
    }


    async getInstancesByCase(caseId: number) {
        return this.prisma.caseInstance.findMany({
            where: { caseId },
            include: {
                messages: true,
                statusEvents: true,
                notes: { include: { user: true } },
            },
            orderBy: { sequence: 'asc' },
        });
    }

    /** Get a single instance with its full history */
    async getInstanceById(id: number) {
        const instance = await this.prisma.caseInstance.findUnique({
            where: { id },
            include: {
                messages: {
                    include: { whatsAppCustomer: true, media: true, user: true },
                    orderBy: { timestamp: 'asc' },
                },
                notes: { include: { user: true } },
                statusEvents: { include: { user: true } },
            },
        });
        if (!instance) throw new NotFoundException('CaseInstance not found');
        return instance;
    }

    /** Add a note inside an instance */


    /** Mark instance ended */
    async closeInstance(instanceId: number) {
        return this.prisma.caseInstance.update({
            where: { id: instanceId },
            data: {
                endedAt: new Date(),
            },
        });
    }

    /** Reopen instance (starts a new one with incremented sequence) */
    async reopenInstance(caseId: number) {
        const lastSeq = await this.prisma.caseInstance.aggregate({
            where: { caseId },
            _max: { sequence: true },
        });

        return this.prisma.caseInstance.create({
            data: {
                caseId,
                sequence: (lastSeq._max.sequence ?? 0) + 1,
                status: Status.INITIATED,
                assignedTo: CaseHandler.BOT,
            },
        });
    }

    /** Update meta for UI purposes */
    async updateMeta(instanceId: number, meta: any) {
        return this.prisma.caseInstance.update({
            where: { id: instanceId },
            data: { meta },
        });
    }




}
