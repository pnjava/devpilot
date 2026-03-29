import { IsOptional, IsString, IsInt, Min, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export class FilterQueryDto {
  @IsOptional() @IsString() dateFrom?: string;
  @IsOptional() @IsString() dateTo?: string;
  @IsOptional() @IsString() teamId?: string;
  @IsOptional() @IsString() repoId?: string;
  @IsOptional() @IsString() projectKey?: string;
  @IsOptional() @IsString() sprintId?: string;
  @IsOptional() @IsString() issueType?: string;
  @IsOptional() @IsString() assigneeId?: string;
  @IsOptional() @IsString() epicKey?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number = 25;
  @IsOptional() @IsString() sortBy?: string;
  @IsOptional() @IsEnum(['asc', 'desc']) sortDir?: 'asc' | 'desc' = 'desc';
}

export class CreateManualLinkDto {
  @IsString() issueKey!: string;
  @IsString() artifactType!: string;
  @IsString() artifactId!: string;
  @IsOptional() @IsString() reason?: string;
}

export class CreateAnnotationDto {
  @IsString() targetType!: string;
  @IsString() targetId!: string;
  @IsString() note!: string;
}
