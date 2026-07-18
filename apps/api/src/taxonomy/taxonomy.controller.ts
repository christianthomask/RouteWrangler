import { Controller, Get } from '@nestjs/common';
import type { TaxonomyResponse } from '@routewrangler/contracts';
import { TaxonomyService } from './taxonomy.service';

@Controller('taxonomy')
export class TaxonomyController {
  constructor(private readonly taxonomy: TaxonomyService) {}

  /** GET /taxonomy — seeded lookup tables for UI labels (BUILD_SPEC §9). */
  @Get()
  get(): Promise<TaxonomyResponse> {
    return this.taxonomy.getTaxonomy();
  }
}
