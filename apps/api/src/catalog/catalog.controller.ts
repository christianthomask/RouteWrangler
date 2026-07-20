import { Controller, Get, Query } from '@nestjs/common';
import type { ClientListResponse, RouteListResponse } from '@routewrangler/contracts';
import { Roles } from '../auth/roles.decorator';
import { CatalogService } from './catalog.service';

@Roles('supervisor', 'admin')
@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('clients')
  async clients(): Promise<ClientListResponse> {
    return { clients: await this.catalog.clients() };
  }

  @Get('routes')
  async routes(
    @Query('clientId') clientId?: string,
    @Query('cycleId') cycleId?: string,
  ): Promise<RouteListResponse> {
    return { routes: await this.catalog.routes(clientId, cycleId) };
  }
}
