import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { BridgeService } from './bridge.service';

@Controller('bridge')
export class BridgeController {
  constructor(private readonly bridge: BridgeService) {}

  @Post('stories/:issueKey/groom-links')
  async linkStoryToSession(
    @Param('issueKey') issueKey: string,
    @Body() body: { sessionId: string; linkType?: string },
  ) {
    // Resolve issueKey → issueId
    return this.bridge.linkStoryToSession(
      issueKey, // caller must resolve to ID or we extend the service
      body.sessionId,
      body.linkType,
    );
  }

  @Get('stories/:issueKey/groom-sessions')
  async getGroomSessions(@Param('issueKey') issueKey: string) {
    return this.bridge.getGroomSessionsForStory(issueKey);
  }

  @Get('repos/:repoSlug/review-metrics')
  async getReviewMetrics(
    @Param('repoSlug') repoSlug: string,
    @Query('days') days?: string,
  ) {
    return this.bridge.getReviewMetrics(repoSlug, days ? parseInt(days) : 30);
  }

  @Get('stories/:issueKey/knowledge')
  async getKnowledge(@Param('issueKey') issueKey: string) {
    return this.bridge.getKnowledgeForIssue(issueKey);
  }

  @Get('repos/:repoSlug/behavioral-patterns')
  async getBehavioralPatterns(@Param('repoSlug') repoSlug: string) {
    return this.bridge.getActivePatternsForRepo(repoSlug);
  }

  @Get('repos/:repoSlug/code-intelligence')
  async getCodeIntelligence(@Param('repoSlug') repoSlug: string) {
    return this.bridge.getCodeIntelligenceSummary(repoSlug);
  }
}
