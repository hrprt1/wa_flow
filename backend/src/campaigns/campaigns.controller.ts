import { Body, Controller, Get, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import { DatabaseService } from '../common/database.service';
import type { AppRequest } from '../common/request';
import { CampaignsService } from './campaigns.service';

@Controller('api/v1/campaigns')
@UseGuards(AuthGuard)
export class CampaignsController {
  constructor(private readonly database: DatabaseService, private readonly campaigns: CampaignsService) {}
  @Post(':id/preview') async preview(@Req() req: AppRequest, @Param('id', ParseIntPipe) id: number) {
    return { data: await this.campaigns.preview(await this.database.tenant(Number(req.user!.id), true), id) };
  }
  @Post(':id/schedule') async schedule(@Req() req: AppRequest, @Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return { data: await this.campaigns.schedule(await this.database.tenant(Number(req.user!.id), true), id, body) };
  }
  @Post(':id/cancel') async cancel(@Req() req: AppRequest, @Param('id', ParseIntPipe) id: number) {
    return { data: await this.campaigns.cancel(await this.database.tenant(Number(req.user!.id), true), id) };
  }
  @Get(':id/status') async status(@Req() req: AppRequest, @Param('id', ParseIntPipe) id: number) {
    return { data: await this.campaigns.status(await this.database.tenant(Number(req.user!.id)), id) };
  }
}
