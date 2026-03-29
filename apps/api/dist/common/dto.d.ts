export declare class FilterQueryDto {
    dateFrom?: string;
    dateTo?: string;
    teamId?: string;
    repoId?: string;
    projectKey?: string;
    sprintId?: string;
    issueType?: string;
    assigneeId?: string;
    epicKey?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
}
export declare class CreateManualLinkDto {
    issueKey: string;
    artifactType: string;
    artifactId: string;
    reason?: string;
}
export declare class CreateAnnotationDto {
    targetType: string;
    targetId: string;
    note: string;
}
//# sourceMappingURL=dto.d.ts.map