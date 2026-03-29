import { PrismaService } from '../prisma/prisma.service';
import { FilterQueryDto } from '../common/dto';
export declare class ReposController {
    private readonly prisma;
    constructor(prisma: PrismaService);
    listRepos(filters: FilterQueryDto): Promise<{
        data: ({
            _count: {
                branches: number;
                commits: number;
                pullRequests: number;
            };
        } & {
            id: string;
            externalId: string;
            name: string;
            createdAt: Date;
            organizationId: string;
            teamId: string | null;
            url: string | null;
            slug: string;
            defaultBranch: string;
        })[];
    }>;
    getRepoDetail(id: string, filters: FilterQueryDto): Promise<{
        error: string;
        data?: undefined;
    } | {
        data: {
            repo: {
                branches: {
                    id: string;
                    name: string;
                    createdAt: Date | null;
                    issueKey: string | null;
                    repositoryId: string;
                }[];
            } & {
                id: string;
                externalId: string;
                name: string;
                createdAt: Date;
                organizationId: string;
                teamId: string | null;
                url: string | null;
                slug: string;
                defaultBranch: string;
            };
            recentCommits: {
                id: string;
                repositoryId: string;
                sha: string;
                message: string;
                authorId: string | null;
                authorEmail: string | null;
                timestamp: Date;
                additions: number | null;
                deletions: number | null;
                filesChanged: number | null;
            }[];
            openPRs: ({
                author: {
                    id: string;
                    createdAt: Date;
                    organizationId: string;
                    displayName: string;
                    email: string | null;
                    externalIds: import("@prisma/client/runtime/library").JsonValue;
                } | null;
                reviews: ({
                    reviewer: {
                        id: string;
                        createdAt: Date;
                        organizationId: string;
                        displayName: string;
                        email: string | null;
                        externalIds: import("@prisma/client/runtime/library").JsonValue;
                    };
                } & {
                    id: string;
                    createdAt: Date;
                    state: string;
                    pullRequestId: string;
                    reviewerId: string;
                })[];
            } & {
                id: string;
                externalId: string;
                createdAt: Date;
                state: string;
                description: string | null;
                updatedAt: Date;
                repositoryId: string;
                authorId: string | null;
                additions: number | null;
                deletions: number | null;
                title: string;
                sourceBranch: string;
                targetBranch: string;
                mergedAt: Date | null;
                closedAt: Date | null;
                commentCount: number;
            })[];
            mergedPRCount: number;
            staleBranchCount: number;
        };
        error?: undefined;
    }>;
}
//# sourceMappingURL=repos.controller.d.ts.map