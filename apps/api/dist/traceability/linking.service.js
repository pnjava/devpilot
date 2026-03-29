"use strict";
// ──────────────────────────────────────────────────────────────
// Traceability / Linking Service
//
// Connects engineering artifacts (branches, commits, PRs, wiki
// pages) to Jira issues with confidence scoring.
// ──────────────────────────────────────────────────────────────
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var LinkingService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.LinkingService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const shared_1 = require("@devpilot/shared");
let LinkingService = LinkingService_1 = class LinkingService {
    prisma;
    logger = new common_1.Logger(LinkingService_1.name);
    issueKeyPattern;
    constructor(prisma) {
        this.prisma = prisma;
        this.issueKeyPattern = new RegExp(shared_1.DEFAULT_THRESHOLDS.issueKeyPattern, 'g');
    }
    // ── Public entry point ───────────────────────────────────────
    async recomputeAllLinks(organizationId) {
        this.logger.log('Recomputing all traceability links...');
        // Load custom issue key pattern if configured
        const settings = await this.prisma.organizationSettings.findUnique({
            where: { organizationId },
        });
        if (settings?.issueKeyPattern) {
            this.issueKeyPattern = new RegExp(settings.issueKeyPattern, 'g');
        }
        // Gather valid issue keys
        const issues = await this.prisma.issue.findMany({ select: { issueKey: true, id: true } });
        const issueMap = new Map(issues.map((i) => [i.issueKey, i.id]));
        await this.linkBranches(issueMap);
        await this.linkCommits(issueMap);
        await this.linkPullRequests(issueMap);
        await this.linkWikiPages(issueMap);
        this.logger.log('Traceability link computation complete');
    }
    // ── Branch linking ───────────────────────────────────────────
    async linkBranches(issueMap) {
        const branches = await this.prisma.branch.findMany({ select: { id: true, name: true } });
        const candidates = [];
        for (const branch of branches) {
            const keys = this.extractIssueKeys(branch.name);
            for (const key of keys) {
                if (issueMap.has(key)) {
                    candidates.push({
                        issueKey: key,
                        artifactType: 'BRANCH',
                        artifactId: branch.id,
                        method: 'BRANCH_NAME',
                        confidence: 'HIGH',
                        confidenceScore: 95,
                    });
                    // Also update the branch record for convenience
                    await this.prisma.branch.update({
                        where: { id: branch.id },
                        data: { issueKey: key },
                    });
                }
            }
        }
        await this.upsertLinks(candidates, issueMap);
    }
    // ── Commit linking ───────────────────────────────────────────
    async linkCommits(issueMap) {
        const commits = await this.prisma.commit.findMany({
            select: { id: true, message: true },
        });
        const candidates = [];
        for (const commit of commits) {
            const keys = this.extractIssueKeys(commit.message);
            for (const key of keys) {
                if (issueMap.has(key)) {
                    candidates.push({
                        issueKey: key,
                        artifactType: 'COMMIT',
                        artifactId: commit.id,
                        method: 'COMMIT_MESSAGE',
                        confidence: 'HIGH',
                        confidenceScore: 90,
                    });
                }
            }
        }
        await this.upsertLinks(candidates, issueMap);
    }
    // ── Pull request linking ─────────────────────────────────────
    async linkPullRequests(issueMap) {
        const prs = await this.prisma.pullRequest.findMany({
            select: { id: true, title: true, description: true, sourceBranch: true },
        });
        const candidates = [];
        for (const pr of prs) {
            const seen = new Set();
            // Title (high confidence)
            for (const key of this.extractIssueKeys(pr.title)) {
                if (issueMap.has(key) && !seen.has(key)) {
                    seen.add(key);
                    candidates.push({
                        issueKey: key,
                        artifactType: 'PULL_REQUEST',
                        artifactId: pr.id,
                        method: 'PR_TITLE',
                        confidence: 'HIGH',
                        confidenceScore: 92,
                    });
                }
            }
            // Description (high confidence)
            if (pr.description) {
                for (const key of this.extractIssueKeys(pr.description)) {
                    if (issueMap.has(key) && !seen.has(key)) {
                        seen.add(key);
                        candidates.push({
                            issueKey: key,
                            artifactType: 'PULL_REQUEST',
                            artifactId: pr.id,
                            method: 'PR_DESCRIPTION',
                            confidence: 'HIGH',
                            confidenceScore: 88,
                        });
                    }
                }
            }
            // Source branch name (medium confidence)
            for (const key of this.extractIssueKeys(pr.sourceBranch)) {
                if (issueMap.has(key) && !seen.has(key)) {
                    seen.add(key);
                    candidates.push({
                        issueKey: key,
                        artifactType: 'PULL_REQUEST',
                        artifactId: pr.id,
                        method: 'BRANCH_NAME',
                        confidence: 'MEDIUM',
                        confidenceScore: 75,
                    });
                }
            }
        }
        await this.upsertLinks(candidates, issueMap);
    }
    // ── Wiki page linking ────────────────────────────────────────
    async linkWikiPages(issueMap) {
        const pages = await this.prisma.wikiPage.findMany({
            select: { id: true, title: true, labels: true },
        });
        const candidates = [];
        for (const page of pages) {
            const seen = new Set();
            // Title
            for (const key of this.extractIssueKeys(page.title)) {
                if (issueMap.has(key) && !seen.has(key)) {
                    seen.add(key);
                    candidates.push({
                        issueKey: key,
                        artifactType: 'WIKI_PAGE',
                        artifactId: page.id,
                        method: 'WIKI_TITLE',
                        confidence: 'HIGH',
                        confidenceScore: 85,
                    });
                }
            }
            // Labels
            const labels = page.labels;
            if (Array.isArray(labels)) {
                for (const label of labels) {
                    for (const key of this.extractIssueKeys(label)) {
                        if (issueMap.has(key) && !seen.has(key)) {
                            seen.add(key);
                            candidates.push({
                                issueKey: key,
                                artifactType: 'WIKI_PAGE',
                                artifactId: page.id,
                                method: 'WIKI_LABEL',
                                confidence: 'MEDIUM',
                                confidenceScore: 70,
                            });
                        }
                    }
                }
            }
        }
        await this.upsertLinks(candidates, issueMap);
    }
    // ── Manual link ──────────────────────────────────────────────
    async createManualLink(issueKey, artifactType, artifactId, authorId, reason) {
        const issue = await this.prisma.issue.findUnique({ where: { issueKey } });
        await this.prisma.artifactLink.upsert({
            where: {
                artifactType_artifactId_issueKey: { artifactType, artifactId, issueKey },
            },
            update: {
                isManual: true,
                confidence: 'MANUAL',
                confidenceScore: 100,
                method: 'MANUAL',
                overriddenBy: authorId,
                overrideReason: reason,
            },
            create: {
                issueKey,
                issueId: issue?.id,
                artifactType,
                artifactId,
                method: 'MANUAL',
                confidence: 'MANUAL',
                confidenceScore: 100,
                isManual: true,
                overriddenBy: authorId,
                overrideReason: reason,
            },
        });
    }
    async removeLink(linkId) {
        await this.prisma.artifactLink.delete({ where: { id: linkId } });
    }
    // ── Helpers ──────────────────────────────────────────────────
    extractIssueKeys(text) {
        if (!text)
            return [];
        const matches = text.match(this.issueKeyPattern);
        return matches ? [...new Set(matches)] : [];
    }
    async upsertLinks(candidates, issueMap) {
        for (const c of candidates) {
            // Don't overwrite manual links with automatic ones
            const existing = await this.prisma.artifactLink.findUnique({
                where: {
                    artifactType_artifactId_issueKey: {
                        artifactType: c.artifactType,
                        artifactId: c.artifactId,
                        issueKey: c.issueKey,
                    },
                },
            });
            if (existing?.isManual)
                continue;
            await this.prisma.artifactLink.upsert({
                where: {
                    artifactType_artifactId_issueKey: {
                        artifactType: c.artifactType,
                        artifactId: c.artifactId,
                        issueKey: c.issueKey,
                    },
                },
                update: {
                    method: c.method,
                    confidence: c.confidence,
                    confidenceScore: c.confidenceScore,
                },
                create: {
                    issueKey: c.issueKey,
                    issueId: issueMap.get(c.issueKey),
                    artifactType: c.artifactType,
                    artifactId: c.artifactId,
                    method: c.method,
                    confidence: c.confidence,
                    confidenceScore: c.confidenceScore,
                    isManual: false,
                },
            });
        }
    }
};
exports.LinkingService = LinkingService;
exports.LinkingService = LinkingService = LinkingService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], LinkingService);
//# sourceMappingURL=linking.service.js.map