import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../common/auth.guard";
import { DatabaseService } from "../common/database.service";
import type { AppRequest } from "../common/request";
import { WorkspaceService } from "./workspace.service";

@Controller("api/v1")
@UseGuards(AuthGuard)
export class WorkspaceController {
  constructor(
    private readonly database: DatabaseService,
    private readonly workspace: WorkspaceService,
  ) {}
  @Get("workspace") async index(@Req() req: AppRequest, @Query('conversation_id') conversationId?: unknown) {
    return {
      data: await this.workspace.snapshot(
        await this.database.tenant(Number(req.user!.id)), conversationId,
      ),
    };
  }
  @Get('customers') async customers(@Req() req: AppRequest, @Query() query: unknown) {
    return this.workspace.customers(await this.database.tenant(Number(req.user!.id)), query);
  }
  @Get('customers/:id/conversation') async customerConversation(@Req() req: AppRequest, @Param('id', ParseIntPipe) id: number) {
    return this.workspace.customerConversation(await this.database.tenant(Number(req.user!.id)), id);
  }
  @Post("conversations/:id/messages") async message(
    @Req() req: AppRequest,
    @Param("id", ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.workspace.message(
      await this.database.tenant(Number(req.user!.id), true),
      id,
      body,
    );
  }
  @Post("conversations/:id/simulate") async simulate(
    @Req() req: AppRequest,
    @Param("id", ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.workspace.simulate(
      await this.database.tenant(Number(req.user!.id), true),
      id,
      body,
    );
  }
  @Post("customers/import") async importCustomers(@Req() req: AppRequest, @Body() body: unknown) {
    return this.workspace.importCustomers(await this.database.tenant(Number(req.user!.id), true), body);
  }
  @Post(":resource") async store(
    @Req() req: AppRequest,
    @Param("resource") resource: string,
    @Body() body: unknown,
  ) {
    return this.workspace.store(
      await this.database.tenant(Number(req.user!.id), true),
      resource,
      body,
    );
  }
  @Patch(":resource/:id") async update(
    @Req() req: AppRequest,
    @Param("resource") resource: string,
    @Param("id", ParseIntPipe) id: number,
    @Body() body: unknown,
  ) {
    return this.workspace.update(
      await this.database.tenant(Number(req.user!.id), true),
      resource,
      id,
      body,
    );
  }
}
