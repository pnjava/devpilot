import { PrismaService } from '../prisma/prisma.service';
import { FilterQueryDto } from '../common/dto';
export declare class PeopleController {
    private readonly prisma;
    constructor(prisma: PrismaService);
    listPeople(filters: FilterQueryDto): Promise<{
        data: ({
            _count: {
                assignedIssues: number;
                reportedIssues: number;
                prReviews: number;
                wikiEdits: number;
            };
            memberships: ({
                team: {
                    id: string;
                    programId: string | null;
                    name: string;
                    createdAt: Date;
                    organizationId: string;
                    slug: string;
                };
            } & {
                id: string;
                startDate: Date;
                endDate: Date | null;
                teamId: string;
                personId: string;
                role: string;
            })[];
        } & {
            id: string;
            createdAt: Date;
            organizationId: string;
            displayName: string;
            email: string | null;
            externalIds: import("@prisma/client/runtime/library").JsonValue;
        })[];
    }>;
    getPersonDetail(id: string, filters: FilterQueryDto): Promise<{
        error: string;
        data?: undefined;
    } | {
        data: {
            person: {
                memberships: ({
                    team: {
                        id: string;
                        programId: string | null;
                        name: string;
                        createdAt: Date;
                        organizationId: string;
                        slug: string;
                    };
                } & {
                    id: string;
                    startDate: Date;
                    endDate: Date | null;
                    teamId: string;
                    personId: string;
                    role: string;
                })[];
            } & {
                id: string;
                createdAt: Date;
                organizationId: string;
                displayName: string;
                email: string | null;
                externalIds: import("@prisma/client/runtime/library").JsonValue;
            };
            contributions: {
                reviewsGiven: number;
                wikiEdits: number;
                prComments: number;
                storiesCompleted: number;
            };
            currentWork: {
                id: string;
                issueKey: string;
                summary: string;
                canonicalState: string;
                updatedAt: Date;
            }[];
        };
        error?: undefined;
    }>;
}
//# sourceMappingURL=people.controller.d.ts.map